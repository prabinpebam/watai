import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { aggregateFilesSha256 } from "./authorityInputs.js";
import { canonical, sha256 } from "./trust.js";

export interface ReleaseCandidateObservation {
  repositoryId: string;
  sourceSha: string;
  sourceTreeSha: string;
  clean: boolean;
  validationInputsSha256: string;
  browserPackSha256: string;
  frontendArtifactSha256: string;
  apiArtifactSha256: string;
}

export interface ReleaseCandidateManifest extends ReleaseCandidateObservation {
  schemaVersion: "1.0";
  status: "LOCAL_CANDIDATE_BOUND";
  releaseVersion: string;
  rollbackFrontendSha: string;
  rollbackBackendSha256: string;
  manifestSha256: string;
  claimsExcluded: string[];
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const gitShaPattern = /^[a-f0-9]{40}$/;

export function bindReleaseCandidate(
  observation: ReleaseCandidateObservation,
  releaseVersion: string,
  rollbackFrontendSha: string,
  rollbackBackendSha256: string,
): ReleaseCandidateManifest {
  if (!observation.clean) throw new Error("Release candidate source must be clean.");
  if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) throw new Error("Release version must be semantic x.y.z.");
  if (!gitShaPattern.test(observation.sourceSha) || !gitShaPattern.test(observation.sourceTreeSha)) {
    throw new Error("Release source identity is invalid.");
  }
  if (!gitShaPattern.test(rollbackFrontendSha) || !sha256Pattern.test(rollbackBackendSha256)) {
    throw new Error("Release rollback identity is invalid.");
  }
  const digests = [
    observation.validationInputsSha256,
    observation.browserPackSha256,
    observation.frontendArtifactSha256,
    observation.apiArtifactSha256,
  ];
  if (!digests.every((value) => sha256Pattern.test(value))) throw new Error("Release artifact identity is invalid.");
  const unsigned = {
    schemaVersion: "1.0" as const,
    status: "LOCAL_CANDIDATE_BOUND" as const,
    releaseVersion,
    ...observation,
    rollbackFrontendSha,
    rollbackBackendSha256,
    claimsExcluded: [
      "This local binding is not an independent signature or hosted CI attestation.",
      "This manifest grants no deployment authority.",
    ],
  };
  return { ...unsigned, manifestSha256: sha256(canonical(unsigned)) };
}

export function verifyReleaseCandidate(
  manifest: ReleaseCandidateManifest,
  observation: ReleaseCandidateObservation,
  expectedRollback: { frontendSha: string; backendSha256: string },
): string[] {
  const blockers: string[] = [];
  const expectedManifest = { ...manifest };
  delete (expectedManifest as Partial<ReleaseCandidateManifest>).manifestSha256;
  if (sha256(canonical(expectedManifest)) !== manifest.manifestSha256) blockers.push("MANIFEST_TAMPERED");
  if (!observation.clean) blockers.push("SOURCE_DIRTY");
  for (const key of [
    "repositoryId",
    "sourceSha",
    "sourceTreeSha",
    "validationInputsSha256",
    "browserPackSha256",
    "frontendArtifactSha256",
    "apiArtifactSha256",
  ] as const) {
    if (manifest[key] !== observation[key]) blockers.push(`BINDING_MISMATCH:${key}`);
  }
  if (manifest.rollbackFrontendSha !== expectedRollback.frontendSha) blockers.push("ROLLBACK_FRONTEND_MISMATCH");
  if (manifest.rollbackBackendSha256 !== expectedRollback.backendSha256) blockers.push("ROLLBACK_BACKEND_MISMATCH");
  return blockers;
}

async function filesUnder(root: string, directory: string): Promise<string[]> {
  const absolute = resolve(root, directory);
  const result: string[] = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const child = resolve(absolute, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(root, relative(root, child)));
    else if (entry.isFile()) result.push(relative(root, child).replaceAll("\\", "/"));
  }
  return result;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

export async function collectReleaseCandidateObservation(root: string): Promise<ReleaseCandidateObservation> {
  const validationPaths = [
    "package.json",
    "package-lock.json",
    "api/package.json",
    "api/package-lock.json",
    "playwright.config.ts",
    "vitest.config.ts",
    "api/vitest.config.ts",
    "harness/evaluator/inventory.json",
    "scripts/check-design-system.mjs",
    "scripts/check-contrast.mjs",
  ];
  const browserPaths = ["playwright.config.ts", ...await filesUnder(root, "tests/e2e")];
  const docsPaths = await filesUnder(root, "docs");
  const remote = git(root, ["config", "--get", "remote.origin.url"]);
  const repositoryMatch = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!repositoryMatch) throw new Error("Release repository identity is unavailable.");
  return {
    repositoryId: `${repositoryMatch[1]}/${repositoryMatch[2]}`,
    sourceSha: git(root, ["rev-parse", "HEAD"]),
    sourceTreeSha: git(root, ["rev-parse", "HEAD^{tree}"]),
    clean: git(root, ["status", "--porcelain=v1", "--untracked-files=all"]) === "",
    validationInputsSha256: await aggregateFilesSha256(root, validationPaths),
    browserPackSha256: await aggregateFilesSha256(root, browserPaths),
    frontendArtifactSha256: await aggregateFilesSha256(root, docsPaths),
    apiArtifactSha256: sha256(await readFile(resolve(root, "api/dist/index.cjs"))),
  };
}