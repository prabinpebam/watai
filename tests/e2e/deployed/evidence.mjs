import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve, join, parse, relative, isAbsolute, sep } from 'node:path';
import { preparationDigest } from './preparation.mjs';
import { prepareEvidence, validateSemanticProfile } from './semantic.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
const pathKey = path => process.platform === 'win32' ? path.toLowerCase() : path;

function manifestPath(path) {
  if (typeof path !== 'string' || path.length > 240 || isAbsolute(path) || path.includes('\\')) throw new Error('UNSAFE_EVIDENCE_PATH');
  const parts = path.split('/');
  if (parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part.endsWith('.') ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error('UNSAFE_EVIDENCE_PATH');
  return parts;
}

async function inspectRoot(root) {
  const absolute = resolve(root);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('EVIDENCE_REPARSE_POINT');
  }
  if (pathKey(await realpath(absolute)) !== pathKey(absolute)) throw new Error('EVIDENCE_ROOT_CHANGED');
  return absolute;
}

async function readBounded(root, path, limit) {
  let target = root;
  const parts = manifestPath(path);
  for (const [index, part] of parts.entries()) {
    target = join(target, part);
    const info = await lstat(target);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new Error('EVIDENCE_REPARSE_POINT');
  }
  const canonical = await realpath(target);
  if (pathKey(canonical) !== pathKey(target)) throw new Error('EVIDENCE_PATH_CHANGED');
  const handle = await open(target, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit) throw new Error('EVIDENCE_FILE_OVERSIZED');
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        pathKey(await realpath(target)) !== pathKey(canonical)) throw new Error('EVIDENCE_CHANGED_DURING_READ');
    await inspectRoot(root);
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}

export async function readReviewEvidence({ attemptRoot, manifestSha256, flowId, preparationDigest: prepared,
  profile, verifyPrivacy, now = Date.now() }) {
  validateSemanticProfile(profile);
  if (!digestPattern.test(manifestSha256 ?? '') || !digestPattern.test(prepared ?? '') || typeof verifyPrivacy !== 'function') {
    throw new Error('EVIDENCE_ADMISSION_AUTHORITY_REQUIRED');
  }
  const root = await inspectRoot(attemptRoot);
  const manifestBytes = await readBounded(root, 'semantic-evidence.json', 65536);
  if (sha(manifestBytes) !== manifestSha256) throw new Error('EVIDENCE_MANIFEST_CHANGED');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 2 || manifest.flowId !== flowId || manifest.preparationDigest !== prepared ||
      typeof manifest.runId !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(manifest.runId) ||
      !manifest.events || !Array.isArray(manifest.assets) || manifest.assets.length > profile.maxToolCalls) throw new Error('INVALID_EVIDENCE_MANIFEST');
  const descriptors = [manifest.events, ...manifest.assets];
  const paths = new Set();
  const assetIds = new Set();
  for (const [index, descriptor] of descriptors.entries()) {
    if (!descriptor || !digestPattern.test(descriptor.sha256 ?? '') || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0) throw new Error('INVALID_EVIDENCE_DESCRIPTOR');
    manifestPath(descriptor.path);
    const key = descriptor.path.toLowerCase();
    if (paths.has(key) || key === 'semantic-evidence.json') throw new Error('DUPLICATE_EVIDENCE_PATH');
    paths.add(key);
    if (descriptor.bytes > (index === 0 ? profile.maxInputBytes : profile.maxAssetBytes)) throw new Error('EVIDENCE_FILE_OVERSIZED');
    if (index > 0) {
      if (typeof descriptor.id !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(descriptor.id) || assetIds.has(descriptor.id) ||
          !['image/png', 'image/jpeg', 'text/plain', 'application/json'].includes(descriptor.mime)) throw new Error('INVALID_EVIDENCE_ASSET');
      assetIds.add(descriptor.id);
    }
  }
  if (manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0) > profile.maxTotalAssetBytes) throw new Error('EVIDENCE_ASSETS_OVERSIZED');
  const unsigned = { ...manifest }; delete unsigned.privacy;
  const privacy = manifest.privacy;
  if (privacy?.subject !== preparationDigest(unsigned) || privacy.purpose !== 'semantic-llm-review' ||
      privacy.profileDigest !== preparationDigest(profile) || !(Date.parse(privacy.expiresAt) > now) ||
      typeof privacy.issuer !== 'string' || !privacy.issuer || typeof privacy.signature !== 'string' || !privacy.signature ||
      await Promise.resolve().then(() => verifyPrivacy(structuredClone(privacy))).catch(() => false) !== true) {
    throw new Error('EVIDENCE_PRIVACY_UNVERIFIED');
  }
  const readDescriptor = async descriptor => {
    const bytes = await readBounded(root, descriptor.path, descriptor.bytes);
    if (bytes.length !== descriptor.bytes || sha(bytes) !== descriptor.sha256) throw new Error('EVIDENCE_CONTENT_CHANGED');
    return bytes;
  };
  const journal = await readDescriptor(manifest.events);
  const events = journal.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  const assets = [];
  for (const descriptor of manifest.assets) assets.push({ ...descriptor, bytes: await readDescriptor(descriptor), redactionVerified: true });
  const evidence = prepareEvidence(events, assets, profile);
  return { runId: manifest.runId, flowId, manifestSha256, preparationDigest: prepared,
    evidenceDigest: evidence.digest, events, assets };
}

export async function createReviewJournal({ directory, verifyPrivateDirectory }) {
  const root = await inspectRoot(directory);
  if (typeof verifyPrivateDirectory !== 'function' || await verifyPrivateDirectory(root) !== true) throw new Error('PRIVATE_REVIEW_DIRECTORY_REQUIRED');
  const path = join(root, 'semantic-review.jsonl');
  const handle = await open(path, 'wx', 0o600);
  let queue = Promise.resolve();
  let sequence = 0;
  let totalBytes = 0;
  let previousSha256 = null;
  let closed = false;
  let terminal = false;
  let writeFailed = false;
  return {
    path,
    append(record) {
      const copy = structuredClone(record);
      const operation = queue.then(async () => {
        if (closed || terminal || writeFailed) throw new Error('REVIEW_JOURNAL_CLOSED');
        if (!copy || Object.keys(copy).some(key => !['type', 'payload'].includes(key)) ||
            !['prepared', 'turn-start', 'turn-end', 'dispatch', 'tool', 'terminal'].includes(copy.type)) throw new Error('INVALID_REVIEW_RECORD');
        const isTerminal = copy.type === 'terminal';
        const entry = { ...copy, sequence: sequence + 1, previousSha256, recordedAt: new Date().toISOString() };
        const line = Buffer.from(JSON.stringify(entry) + '\n');
        if (sequence + 1 > (isTerminal ? 128 : 127) || totalBytes + line.length > 262144 - (isTerminal ? 0 : 8192) ||
            line.length > (isTerminal ? 8192 : 131072)) throw new Error('REVIEW_JOURNAL_LIMIT');
        if (/(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:password|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*["']?\s*[:=]\s*["']?[^\s,"'}]+)/i.test(line.toString('utf8'))) throw new Error('UNSAFE_REVIEW_RECORD');
        try {
          await inspectRoot(root);
          await handle.writeFile(line);
          await handle.sync();
        } catch { writeFailed = true; throw new Error('REVIEW_JOURNAL_WRITE_FAILED'); }
        sequence++; totalBytes += line.length; previousSha256 = sha(line); terminal = isTerminal;
        return { sequence, recordDigest: preparationDigest(copy), sha256: previousSha256 };
      });
      queue = operation.catch(() => {});
      return operation;
    },
    async close() {
      await queue;
      if (!closed) { closed = true; await handle.close(); }
    },
  };
}