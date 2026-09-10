// @vitest-environment node
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadAuthorityBundle } from "./authorityBundle";
import { claimSigningBytes, trustRootSha256, type SignedClaim, type TrustRootManifest } from "./trust";

const directories: string[] = [];
const keys = generateKeyPairSync("ed25519");
const now = Date.parse("2026-09-10T11:00:00.000Z");
const policySha256 = "a".repeat(64);
const workflowSha256 = "b".repeat(64);

const root = (): TrustRootManifest => ({
  schemaVersion: "1.0",
  status: "ACTIVE",
  rootId: "root-bundle",
  repositoryId: "prabinpebam/watai",
  epoch: 1,
  validFrom: "2026-09-10T10:00:00.000Z",
  validUntil: "2026-09-11T10:00:00.000Z",
  backlogSha256: "0".repeat(64),
  policySha256,
  workflowSha256,
  planSchemaSha256: "1".repeat(64),
  controllerSha256: "c".repeat(64),
  evaluatorPackSha256: "d".repeat(64),
  testInventorySha256: "2".repeat(64),
  fixtureManifestSha256: "3".repeat(64),
  toolchainSha256: "4".repeat(64),
  dependencyLockSha256: "5".repeat(64),
  impactMapSha256: "6".repeat(64),
  negativeControlIds: ["NC-forged-proof"],
  issuers: [{
    issuerId: "owner-authority",
    publicKeySpkiPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    allowedKinds: ["authorization-grant", "deployment-observation"],
    allowedRoles: [],
  }],
  revokedArtifactIds: [],
});

function expectations(manifest: TrustRootManifest, expectedRootSha256 = trustRootSha256(manifest)) {
  return {
    expectedRootSha256,
    repositoryId: manifest.repositoryId,
    backlogSha256: manifest.backlogSha256,
    policySha256: manifest.policySha256,
    workflowSha256: manifest.workflowSha256,
    planSchemaSha256: manifest.planSchemaSha256,
    controllerSha256: manifest.controllerSha256,
    evaluatorPackSha256: manifest.evaluatorPackSha256,
    testInventorySha256: manifest.testInventorySha256,
    fixtureManifestSha256: manifest.fixtureManifestSha256,
    toolchainSha256: manifest.toolchainSha256,
    dependencyLockSha256: manifest.dependencyLockSha256,
    impactMapSha256: manifest.impactMapSha256,
    negativeControlIds: manifest.negativeControlIds,
    maxClockSkewMs: 5_000,
    maxClaimLifetimeMs: 24 * 60 * 60_000,
  };
}

function claim(manifest: TrustRootManifest): SignedClaim {
  const value: SignedClaim = {
    schemaVersion: "1.0",
    kind: "authorization-grant",
    artifactId: "grant-001",
    issuerId: "owner-authority",
    issuedAt: "2026-09-10T10:59:00.000Z",
    expiresAt: "2026-09-10T11:05:00.000Z",
    payload: {
      grantId: "grant-001",
      repositoryId: "prabinpebam/watai",
      policySha256,
      modes: ["implementation"],
      billing: {
        kind: "subscription",
        maxUsd: 0,
        maxInputTokens: 1000,
        maxOutputTokens: 100,
        maxRequests: 10,
        maxAiCredits: 10,
      },
    },
    signatureBase64: "",
  };
  value.signatureBase64 = sign(null, claimSigningBytes(manifest, value), keys.privateKey).toString("base64");
  return value;
}

function deploymentClaim(manifest: TrustRootManifest): SignedClaim {
  const value: SignedClaim = {
    schemaVersion: "1.0",
    kind: "deployment-observation",
    artifactId: "deployment-001",
    issuerId: "owner-authority",
    issuedAt: "2026-09-10T10:59:00.000Z",
    expiresAt: "2026-09-10T11:05:00.000Z",
    payload: {
      observationId: "deployment-001",
      repositoryId: "prabinpebam/watai",
      policySha256,
      observedAt: "2026-09-10T10:58:00.000Z",
      sourceSha: "e".repeat(40),
      frontendArtifactSha256: "7".repeat(64),
      apiArtifactSha256: "8".repeat(64),
      runtime: "node-22",
      region: "eastus2",
      configRevision: "config-1",
      infraRevision: "infra-1",
      dataSchemaRevision: "schema-1",
      queueGeneration: "queue-1",
      reason: "Observed by read-only fixture.",
    },
    signatureBase64: "",
  };
  value.signatureBase64 = sign(null, claimSigningBytes(manifest, value), keys.privateKey).toString("base64");
  return value;
}

async function createBundle(repositoryRoot: string, manifest = root()): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "watai-authority-"));
  directories.push(directory);
  await writeBundle(directory, manifest);
  return directory;
}

async function writeBundle(directory: string, manifest = root()): Promise<void> {
  await mkdir(join(directory, "claims"));
  await writeFile(join(directory, "trust-root.json"), JSON.stringify(manifest), "utf8");
  await writeFile(join(directory, "claims", "grant.json"), JSON.stringify(claim(manifest)), "utf8");
  await writeFile(join(directory, "claims", "deployment.json"), JSON.stringify(deploymentClaim(manifest)), "utf8");
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("external authority bundle", () => {
  it("loads valid signed claims from outside the repository", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "watai-repo-"));
    directories.push(repositoryRoot);
    const authorityDirectory = await createBundle(repositoryRoot);
    const manifest = root();
    const bundle = await loadAuthorityBundle(
      repositoryRoot,
      authorityDirectory,
      { now: () => now },
      expectations(manifest),
    );

    expect(bundle.authorizationGrants).toHaveLength(1);
    expect(bundle.deploymentObservations).toHaveLength(1);
    expect(bundle.deploymentObservations[0]).toMatchObject({ runtime: "node-22", region: "eastus2" });
    expect(bundle.rejectedClaims).toEqual([]);
  });

  it("rejects authority material stored inside the candidate repository", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "watai-repo-"));
    directories.push(repositoryRoot);
    const authorityDirectory = join(repositoryRoot, "authority");
    await mkdir(authorityDirectory);
    await expect(loadAuthorityBundle(repositoryRoot, authorityDirectory, { now: () => now }, expectations(root())))
      .rejects.toMatchObject({ code: "AUTHORITY_INSIDE_REPOSITORY" });
  });

  it("rejects root pin substitution", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "watai-repo-"));
    directories.push(repositoryRoot);
    const authorityDirectory = await createBundle(repositoryRoot);
    const changedRoot = { ...root(), rootId: "substituted-root" };
    await writeFile(join(authorityDirectory, "trust-root.json"), JSON.stringify(changedRoot), "utf8");
    await expect(loadAuthorityBundle(repositoryRoot, authorityDirectory, { now: () => now }, expectations(root())))
      .rejects.toMatchObject({ code: "ROOT_DIGEST_MISMATCH" });
  });

  it("rejects evaluator-pack drift under an otherwise valid root", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "watai-repo-"));
    directories.push(repositoryRoot);
    const manifest = root();
    const authorityDirectory = await createBundle(repositoryRoot, manifest);
    await expect(loadAuthorityBundle(repositoryRoot, authorityDirectory, { now: () => now }, {
      ...expectations(manifest),
      evaluatorPackSha256: "f".repeat(64),
    })).rejects.toMatchObject({ code: "ROOT_CONTRACT_MISMATCH" });
  });

  it("rejects evaluator-pack drift under an otherwise valid root", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "watai-repo-"));
    directories.push(repositoryRoot);
    const manifest = root();
    const authorityDirectory = await createBundle(repositoryRoot, manifest);
    await expect(loadAuthorityBundle(repositoryRoot, authorityDirectory, { now: () => now }, {
      ...expectations(manifest),
      evaluatorPackSha256: "f".repeat(64),
    })).rejects.toMatchObject({ code: "ROOT_CONTRACT_MISMATCH" });
  });

  it("rejects an outside-looking junction that resolves into the repository", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "watai-repo-"));
    directories.push(repositoryRoot);
    const inside = join(repositoryRoot, "authority");
    await mkdir(inside);
    await writeBundle(inside);
    const external = await mkdtemp(join(tmpdir(), "watai-link-"));
    directories.push(external);
    const linked = join(external, "authority-link");
    await symlink(inside, linked, process.platform === "win32" ? "junction" : "dir");

    await expect(loadAuthorityBundle(repositoryRoot, linked, { now: () => now }, expectations(root())))
      .rejects.toMatchObject({ code: "AUTHORITY_INSIDE_REPOSITORY" });
  });
});