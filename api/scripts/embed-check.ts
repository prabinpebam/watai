/**
 * embed-check — diagnostic for the embeddings endpoint. Lists the models the configured endpoint
 * exposes and tries a few candidate embedding deployment names, printing the vector dimension on
 * success or the error body on failure. Reads api/.env (gitignored). Never prints the key.
 *
 *   npm run embed-check
 *   WATAI_EVAL_EMBED_MODEL=my-embed-deployment npm run embed-check
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v1Url } from '../src/ai/chat';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv(resolve(HERE, '../.env'));

const base = (process.env.WATAI_PROBE_BASEURL ?? '').trim();
const key = (process.env.WATAI_PROBE_KEY ?? '').trim();

async function main(): Promise<void> {
  if (!base || !key) {
    console.error('Set WATAI_PROBE_BASEURL and WATAI_PROBE_KEY in api/.env.');
    process.exit(1);
  }
  console.log(`endpoint host: ${new URL(base).host}`);

  try {
    const res = await fetch(v1Url(base, '/models'), { headers: { Authorization: `Bearer ${key}` } });
    console.log(`GET /models -> ${res.status}`);
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (json.data ?? []).map((m) => m.id).filter(Boolean) as string[];
      console.log(`  models (${ids.length}): ${ids.join(', ')}`);
      const embeds = ids.filter((id) => /embed/i.test(id));
      console.log(`  embedding-like: ${embeds.length ? embeds.join(', ') : '(none found)'}`);
    } else {
      console.log(`  ${(await res.text()).slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`GET /models error: ${(e as Error).message}`);
  }

  const candidates = (process.env.WATAI_EVAL_EMBED_MODEL ?? process.env.MEMORY_EMBED_MODEL ?? 'text-embedding-3-small,text-embedding-3-large,text-embedding-ada-002')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const model of candidates) {
    try {
      const res = await fetch(v1Url(base, '/embeddings'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: 'hello world' }),
      });
      const txt = await res.text();
      if (res.ok) {
        const dims = ((JSON.parse(txt) as { data?: Array<{ embedding?: number[] }> }).data?.[0]?.embedding ?? []).length;
        console.log(`POST /embeddings model=${model} -> ${res.status} OK, dims=${dims}`);
      } else {
        console.log(`POST /embeddings model=${model} -> ${res.status} ${txt.slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`POST /embeddings model=${model} error: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
