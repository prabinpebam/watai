/**
 * route-check — routing eval for the semantic manager. Replays representative conversations through
 * the REAL `routeTurn` against the configured endpoint and reports the chosen action against the
 * expected one. Reads api/.env (gitignored). Never prints the key.
 *
 *   npm run route-check
 *   npm run route-check -- --repeat 3
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeTurn, semanticRouterSystemPrompt, type SemanticAction } from '../src/ai/semanticRouter';
import type { Turn } from '../src/ai/orchestrator';

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
const model = (process.env.WATAI_PROBE_FULL_MODEL ?? 'gpt-5.4').trim();

const ALL: SemanticAction[] = ['respond', 'generate_image', 'code_interpreter', 'file_search', 'web_search'];

interface Case {
  name: string;
  expect: SemanticAction;
  available?: SemanticAction[];
  imageIds?: string[];
  turns: { role: 'user' | 'assistant'; text: string }[];
}

const LONG_RESTYLE =
  'Create an isometric rural Manipuri homestead scene using the uploaded image as the style color reference. ' +
  'Keep the camera strictly true isometric like a game screenshot, with no horizon and no perspective flattening. ' +
  'Preserve the same map-like layout and all key content from the isometric scene: a bamboo-pillared house with smooth ' +
  'mud platform foundation and mud walls, thatch roof, grey tabby cat on the roof, orange Indian street mongrel near the ' +
  'porch, central potted Tulsi/Basil plant on earthen ground, fenced cabbage patch, fenced rows of chives, pond with a ' +
  'tiny bamboo dock, lily pads and lily flowers, duck and ducklings, bamboo clothesline with plain clothes, chickens ' +
  'roaming, dirt yard and dirt paths, bamboo fencing, bamboo grove in one grouped area, banana grove in another grouped ' +
  'area, and separate trees as grove or standalone. Apply the art style and color treatment of the first uploaded ' +
  'reference image: clearer painterly illustration, softer and smoother rendering, warm house glow, deep but gentle ' +
  'forest greens, controlled contrast, lifted blacks compared with the current image, and a polished storybook game-art ' +
  'finish. Do not make it misty or blurry. Keep the image clear, calm, softly rendered, and not oversharpened. Preserve ' +
  'strict isometric readability like an in-game screenshot, but restyle the materials, lighting, palette, and rendering ' +
  'to match the first reference image. No text or banners anywhere.';

const CASES: Case[] = [
  {
    name: 'long restyle of an uploaded image (reported failure)',
    expect: 'generate_image',
    imageIds: ['att-1'],
    turns: [
      { role: 'user', text: `${LONG_RESTYLE}\n\n[Uploaded image id="att-1" name="image.png" reuse_mode=reference]` },
    ],
  },
  {
    name: 'plain new image',
    expect: 'generate_image',
    turns: [{ role: 'user', text: 'Draw a watercolor fox sitting in a misty forest.' }],
  },
  {
    name: 'follow-up variation on a generated image',
    expect: 'generate_image',
    imageIds: ['gen-1'],
    turns: [
      { role: 'user', text: 'Make a poster of a mountain lake at dawn.' },
      { role: 'assistant', text: 'Here is the poster.\n\n[Generated image id="gen-1" size="1024x1024" prompt="mountain lake at dawn"]' },
      { role: 'user', text: 'Make another one, warmer and less contrasty.' },
    ],
  },
  {
    name: 'image request phrased with layout/template words',
    expect: 'generate_image',
    turns: [{ role: 'user', text: 'Create a 1536x1024 game-art title screen layout with a castle and a banner-free composition.' }],
  },
  {
    name: 'genuine data deliverable stays on code interpreter',
    expect: 'code_interpreter',
    turns: [
      {
        role: 'user',
        text:
          'Here are the sales numbers:\nregion,quarter,revenue\nNorth,Q1,120000\nNorth,Q2,138500\n' +
          'South,Q1,98000\nSouth,Q2,101250\nEast,Q1,143750\nEast,Q2,151000\n\n' +
          'Give me an xlsx with a pivot of revenue by region and quarter, plus a total row.',
      },
    ],
  },
  {
    name: 'plain conversation stays respond',
    expect: 'respond',
    turns: [{ role: 'user', text: 'What is the difference between isometric and axonometric projection?' }],
  },
];

function turnsFor(c: Case): Turn[] {
  const available = c.available ?? ALL;
  return [
    { role: 'system', text: semanticRouterSystemPrompt(available) },
    ...c.turns.map((t) => ({ role: t.role, text: t.text })),
  ];
}

async function main(): Promise<void> {
  if (!base || !key) {
    console.error('Set WATAI_PROBE_BASEURL and WATAI_PROBE_KEY in api/.env.');
    process.exit(1);
  }
  const repeatFlag = process.argv.indexOf('--repeat');
  const repeat = repeatFlag > -1 ? Math.max(1, Number(process.argv[repeatFlag + 1]) || 1) : 1;
  console.log(`endpoint host: ${new URL(base).host}  model: ${model}  repeat: ${repeat}\n`);

  let pass = 0;
  let total = 0;
  for (const c of CASES) {
    for (let i = 0; i < repeat; i += 1) {
      total += 1;
      const startedAt = Date.now();
      const route = await routeTurn({
        baseUrl: base,
        key,
        model,
        turns: turnsFor(c),
        availableActions: c.available ?? ALL,
        imageIds: c.imageIds ?? [],
      }).catch((e) => {
        console.error('  threw:', e instanceof Error ? e.message : String(e));
        return null;
      });
      const got = route?.action ?? 'ROUTER-NULL';
      const ok = got === c.expect;
      if (ok) pass += 1;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${c.name}${repeat > 1 ? ` #${i + 1}` : ''}\n` +
          `      expected=${c.expect} got=${got} imageAction=${route?.imageAction ?? '-'} refs=${JSON.stringify(route?.referenceImageIds ?? [])} ${Date.now() - startedAt}ms\n` +
          `      rationale: ${route?.rationale ?? '(none)'}`,
      );
    }
  }
  console.log(`\n${pass}/${total} routed as expected.`);
  process.exit(pass === total ? 0 : 1);
}

void main();
