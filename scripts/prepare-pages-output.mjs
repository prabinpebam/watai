import { mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'docs');
await mkdir(root, { recursive: true });
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.name === 'releases') continue;
  await rm(resolve(root, entry.name), { recursive: true, force: true });
}