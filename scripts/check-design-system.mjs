// Design-system guardrail (no dependencies). Fails if a hardcoded color literal appears where a
// token should be used:
//   1. hex colors in the design stylesheets (global.css / components.css) — only tokens.css may
//      hold raw color literals;
//   2. hex colors inside JSX `style={{ … }}` inline styles anywhere under src/.
// Colors must always come from CSS custom properties (see src/design/tokens.css).
//
// Run: `npm run lint:ds`  (also wired into `npm run build`).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** Stylesheets that must be token-only (tokens.css is the single allowed home for literals). */
const DESIGN_CSS = new Set(['src/design/global.css', 'src/design/components.css']);

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const INLINE_STYLE_HEX = /style=\{\{[^}]*#[0-9a-fA-F]{3,8}\b/;

/** @type {string[]} */
const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else checkFile(p);
  }
}

function checkFile(p) {
  const rel = relative(ROOT, p).replace(/\\/g, '/');
  const isDesignCss = DESIGN_CSS.has(rel);
  const isTsx = rel.endsWith('.tsx');
  if (!isDesignCss && !isTsx) return;

  const lines = readFileSync(p, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const ln = i + 1;
    if (isDesignCss) {
      const m = line.match(HEX);
      if (m && !line.includes('url(#')) {
        violations.push(`${rel}:${ln}  hardcoded hex "${m[0]}" — use a token from tokens.css`);
      }
    }
    if (isTsx) {
      const m = line.match(INLINE_STYLE_HEX);
      if (m) {
        violations.push(`${rel}:${ln}  hardcoded hex in an inline style — use var(--…)`);
      }
    }
  });
}

walk(SRC);

if (violations.length) {
  console.error(`\nDesign-system check FAILED — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error('  ' + v);
  console.error('\nColors must come from CSS custom properties (src/design/tokens.css), never literals.\n');
  process.exit(1);
}

console.log('Design-system check passed: no hardcoded colors in design CSS or inline styles.');
