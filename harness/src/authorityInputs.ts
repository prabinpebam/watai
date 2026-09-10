import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

export async function aggregateFilesSha256(root: string, paths: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(resolve(root, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function compiledRuntimeFiles(root: string, directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await compiledRuntimeFiles(root, path));
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      result.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return result;
}

export async function compiledRuntimeSha256(root: string): Promise<string> {
  const paths = await compiledRuntimeFiles(root, resolve(root, ".harness-dist"));
  return aggregateFilesSha256(root, paths);
}