/**
 * Memory capture smoke test — verifies the REAL extractor (the same `extractMemories` the app's
 * background worker calls) works with the configured model tiers:
 *   - routine tier (MEMORY_MODEL, mini): must produce `add` ops on clear capture prompts.
 *   - deep   tier (MEMORY_DEEP_MODEL, full): must reconcile a conflicting update against an
 *     existing memory (invalidate / merge / add).
 *
 * Uses the same key as the probe: reads WATAI_PROBE_BASEURL / WATAI_PROBE_KEY from api/.env.
 * Model tiers are read from MEMORY_MODEL / MEMORY_DEEP_MODEL (falling back to mini/full).
 *
 * Run: cd api && npm run memory:smoke
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMemories } from '../src/ai/memoryExtractor';
import type { DecryptedCredentials } from '../src/application/credentialService';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(resolve(HERE, '../.env'));

const ROUTINE = process.env.MEMORY_MODEL?.trim() || process.env.WATAI_PROBE_MINI_MODEL?.trim() || 'gpt-5.4-mini';
const DEEP = process.env.MEMORY_DEEP_MODEL?.trim() || process.env.WATAI_PROBE_FULL_MODEL?.trim() || 'gpt-5.4';

interface AddLike { op: string; kind?: string; text?: string }

async function main() {
  const baseUrl = process.env.WATAI_PROBE_BASEURL ?? '';
  const key = process.env.WATAI_PROBE_KEY ?? '';
  if (!baseUrl || !key) {
    console.error('Set WATAI_PROBE_BASEURL / WATAI_PROBE_KEY in api/.env first.');
    process.exit(1);
  }
  const creds = { baseUrl, key, models: { chat: DEEP } } as DecryptedCredentials;
  const now = new Date().toISOString();

  console.log(`routine (capture) model = ${ROUTINE}`);
  console.log(`deep  (merge/conflict) model = ${DEEP}\n`);

  // 1) Routine capture: clear "remember" commands, no existing memories → expect an `add`.
  const captures = [
    'Remember that my favorite color is teal.',
    'My manager is Dana and we do standup at 9am.',
    'Always call me by my nickname, Riz.',
  ];
  let captureAdds = 0;
  for (const text of captures) {
    const out = await extractMemories(creds, {
      mode: 'command', now, threadId: 't',
      messages: [{ id: 'm1', role: 'user', content: text, createdAt: now }],
      existingMemories: [],
    }, { model: ROUTINE });
    const ops = out.operations as AddLike[];
    const adds = ops.filter((o) => o.op === 'add');
    captureAdds += adds.length;
    const detail = adds.map((a) => `${a.kind ?? 'fact'}:"${a.text ?? ''}"`).join('; ');
    console.log(`[routine] "${text}"`);
    console.log(`   ops: ${ops.map((o) => o.op).join(', ') || '(none)'}${detail ? `  → ${detail}` : ''}`);
  }

  // 2) Deep reconcile: a conflicting update vs an existing memory → expect invalidate / merge / add.
  const existing = [{ id: 'mem-color', kind: 'fact', status: 'active', text: "User's favorite color is blue." }];
  const reconcile = 'Actually, my favorite color is teal now, not blue.';
  const out2 = await extractMemories(creds, {
    mode: 'rebuild', now, threadId: 't',
    messages: [{ id: 'm2', role: 'user', content: reconcile, createdAt: now }],
    existingMemories: existing,
  }, { model: DEEP });
  const ops2 = (out2.operations as AddLike[]).map((o) => o.op);
  console.log(`\n[deep] existing: "${existing[0].text}"`);
  console.log(`[deep] "${reconcile}"`);
  console.log(`   ops: ${ops2.join(', ') || '(none)'}`);

  const reconciled = ops2.some((op) => op === 'invalidate' || op === 'merge' || op === 'add');
  console.log(`\nSummary: routine produced ${captureAdds} add(s) across ${captures.length} capture prompt(s); deep ${reconciled ? 'reconciled the conflict' : 'did NOT reconcile the conflict'}.`);
  if (captureAdds === 0) console.log('WARNING: routine model produced no adds — memory capture may be too conservative for these prompts.');
}

main().catch((e) => { console.error(e); process.exit(1); });
