import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  bindReleaseCandidate,
  collectReleaseCandidateObservation,
  verifyReleaseCandidate,
  type ReleaseCandidateManifest,
} from "./releaseCandidate.js";

const root = resolve(process.cwd());
const mode = process.argv[2];
const path = resolve(process.env.WATAI_RELEASE_MANIFEST_PATH ?? ".harness-state/release-candidate.json");
const releaseVersion = process.env.WATAI_RELEASE_VERSION?.trim() ?? "";
const frontendSha = process.env.WATAI_ROLLBACK_FRONTEND_SHA?.trim() ?? "";
const backendSha256 = process.env.WATAI_ROLLBACK_BACKEND_SHA256?.trim() ?? "";
const observation = await collectReleaseCandidateObservation(root);

if (mode === "create") {
  const manifest = bindReleaseCandidate(observation, releaseVersion, frontendSha, backendSha256);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify(manifest, null, 2));
} else if (mode === "verify") {
  const manifest = JSON.parse(await readFile(path, "utf8")) as ReleaseCandidateManifest;
  const blockers = verifyReleaseCandidate(manifest, observation, { frontendSha, backendSha256 });
  console.log(JSON.stringify({ valid: blockers.length === 0, blockers, manifestSha256: manifest.manifestSha256 }, null, 2));
  if (blockers.length) process.exitCode = 1;
} else {
  throw new Error("Usage: releaseCandidateCli create|verify");
}