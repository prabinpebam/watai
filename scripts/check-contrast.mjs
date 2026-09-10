import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/design/tokens.css', import.meta.url), 'utf8');
const darkStart = css.indexOf(":root[data-theme='dark']");

function declarations(source) {
  return new Map([...source.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

const light = declarations(css.slice(0, darkStart));
const dark = new Map([...light, ...declarations(css.slice(darkStart))]);

function resolve(name, theme, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Circular token: ${name}`);
  seen.add(name);
  const value = theme.get(name);
  if (!value) throw new Error(`Missing token: ${name}`);
  const reference = /^var\(--([\w-]+)\)$/.exec(value);
  return reference ? resolve(reference[1], theme, seen) : value;
}

function luminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi)?.map((part) => Number.parseInt(part, 16) / 255);
  if (!channels || channels.length < 3) throw new Error(`Expected an opaque hex color, got ${hex}`);
  const linear = channels.slice(0, 3).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const foregrounds = ['color-text-secondary', 'color-text-tertiary'];
const backgrounds = ['color-bg', 'color-surface-1', 'color-surface-2', 'color-surface-3', 'color-user-bubble'];
const failures = [];
for (const [themeName, theme] of [['light', light], ['dark', dark]]) {
  for (const foregroundName of foregrounds) {
    for (const backgroundName of backgrounds) {
      const contrast = ratio(resolve(foregroundName, theme), resolve(backgroundName, theme));
      if (contrast < 4.5) failures.push(`${themeName} ${foregroundName} on ${backgroundName}: ${contrast.toFixed(2)}:1`);
    }
  }
}

if (failures.length) {
  console.error(`Informative text contrast failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('Contrast check passed: informative text is at least 4.5:1 on every semantic surface.');