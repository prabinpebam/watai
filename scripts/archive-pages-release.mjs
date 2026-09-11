import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

async function filesUnder(root, directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === 'releases') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(root, path));
    else if (entry.isFile()) result.push(relative(root, path).replaceAll('\\', '/'));
  }
  return result.sort();
}

async function fileRecord(root, path) {
  const bytes = await readFile(resolve(root, path));
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const version = process.argv[2]?.trim();
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Usage: npm run release:archive-frontend -- <x.y.z>');
const repositoryRoot = resolve(process.cwd());
const docsRoot = resolve(repositoryRoot, 'docs');
const releasesRoot = resolve(docsRoot, 'releases');
const releaseRoot = resolve(releasesRoot, version);
const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
if (status) throw new Error('Frontend releases can only be archived from a clean source tree.');

await mkdir(releasesRoot, { recursive: true });
const manifestPath = resolve(releasesRoot, 'manifest.json');
let prior = { schemaVersion: '1.0', releases: [] };
try { prior = JSON.parse(await readFile(manifestPath, 'utf8')); } catch {}
if (prior.releases.some((item) => item.version === version)) throw new Error(`Release ${version} already exists in the manifest.`);
await mkdir(releaseRoot, { recursive: false });

const sourceFiles = await filesUnder(docsRoot, docsRoot);
if (!sourceFiles.includes('index.html') || !sourceFiles.some((path) => path.startsWith('assets/'))) {
  throw new Error('The current Pages build is incomplete.');
}
for (const path of sourceFiles) {
  await mkdir(resolve(releaseRoot, path, '..'), { recursive: true });
  await cp(resolve(docsRoot, path), resolve(releaseRoot, path), { errorOnExist: true });
}

const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const files = await Promise.all(sourceFiles.map((path) => fileRecord(releaseRoot, path)));
const unsigned = { schemaVersion: '1.0', version, sourceSha, files };
const release = {
  ...unsigned,
  artifactSha256: createHash('sha256').update(canonical(unsigned)).digest('hex'),
};
await writeFile(resolve(releaseRoot, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, { flag: 'wx' });

const manifest = {
  schemaVersion: '1.0',
  releases: [...prior.releases, { version, sourceSha, artifactSha256: release.artifactSha256, path: `./${version}/` }]
    .sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true })),
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ version, sourceSha, artifactSha256: release.artifactSha256, files: files.length }, null, 2));