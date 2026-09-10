// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  analyzeNpmSources,
  evaluatePreflight,
  repositoryIdFromRemote,
  type LocalPreflightReport,
} from "./preflight";

const complete = (): Omit<LocalPreflightReport, "status" | "blockers" | "observations"> => ({
  schemaVersion: "1.0",
  releaseEligible: false,
  collectedAt: "2026-09-10T11:00:00.000Z",
  repository: {
    repositoryId: "prabinpebam/watai",
    branch: "candidate/H01/run-001",
    upstream: null,
    sourceSha: "a".repeat(40),
    treeSha256: "b".repeat(64),
    diffSha256: "c".repeat(64),
    clean: true,
    changedPaths: [],
  },
  contracts: {
    backlogSha256: "d".repeat(64),
    policySha256: "e".repeat(64),
    workflowSha256: "f".repeat(64),
    schemaSha256: "1".repeat(64),
  },
  dependencies: {
    rootLockSha256: "2".repeat(64),
    apiLockSha256: "3".repeat(64),
  },
  toolchain: {
    platform: "win32",
    architecture: "x64",
    node: { available: true, version: "v24" },
    npm: { available: true, version: "9" },
    git: { available: true, version: "2" },
    dockerClient: { available: true, version: "29" },
    dockerServer: { available: true, version: "29" },
    azureCli: { available: true, version: "2" },
    functionsCoreTools: { available: true, version: "4" },
    githubCli: { available: true, version: "2" },
  },
  packageSources: {
    npmRegistry: "https://packagefeedproxy.microsoft.io/npm/",
    approvedNpmRegistry: "https://packagefeedproxy.microsoft.io/npm/",
    compliant: true,
    observedRegistries: [
      { context: "root", key: "registry", location: "https://packagefeedproxy.microsoft.io/npm/", compliant: true },
      { context: "api", key: "registry", location: "https://packagefeedproxy.microsoft.io/npm/", compliant: true },
    ],
    violations: [],
  },
  validationInventory: {
    rootScripts: ["build", "test", "validate:harness"],
    apiScripts: ["build", "test", "typecheck"],
    requiredCommandsPresent: true,
  },
  deployment: {
    sourceSha: "a".repeat(40),
    frontendArtifactSha256: "4".repeat(64),
    apiArtifactSha256: "5".repeat(64),
    runtime: "node-22",
    region: "eastus2",
    configRevision: "config-1",
    infraRevision: "infra-1",
    dataSchemaRevision: "schema-1",
    queueGeneration: "queue-1",
    reason: "Observed by authorized fixture.",
  },
});

describe("local preflight", () => {
  it.each([
    ["https://github.com/prabinpebam/watai.git", "prabinpebam/watai"],
    ["git@github.com:prabinpebam/watai.git", "prabinpebam/watai"],
  ])("extracts repository identity without preserving remote credentials", (remote, expected) => {
    expect(repositoryIdFromRemote(remote)).toBe(expected);
  });

  it("marks a complete observation locally ready", () => {
    const result = evaluatePreflight(complete());
    expect(result.status).toBe("OBSERVED_LOCAL_COMPLETE");
    expect(result.blockers).toEqual([]);
  });

  it("fails closed on dirty source, wrong feed, missing isolation, and unknown deployment", () => {
    const report = complete();
    report.repository.clean = false;
    report.packageSources.compliant = false;
    report.toolchain.dockerServer = { available: false, reason: "not running" };
    report.deployment.sourceSha = null;
    report.deployment.runtime = null;
    report.deployment.region = null;
    report.deployment.configRevision = null;
    report.deployment.infraRevision = null;

    const result = evaluatePreflight(report);
    expect(result.status).toBe("OBSERVED_PARTIAL");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      "SOURCE_DIRTY",
      "NPM_FEED_NONCOMPLIANT",
      "WORKER_ISOLATION_UNAVAILABLE",
      "DEPLOYED_SOURCE_UNKNOWN",
      "DEPLOYMENT_RUNTIME_UNKNOWN",
      "DEPLOYMENT_CONFIG_UNKNOWN",
    ]));
  });

  it("rejects a noncompliant scoped registry even when the default is approved", () => {
    const result = analyzeNpmSources([
      {
        name: "root",
        config: {
          registry: "https://packagefeedproxy.microsoft.io/npm/",
          "@unsafe:registry": "https://registry.npmjs.org/",
        },
        manifestText: JSON.stringify({ dependencies: { example: "1.0.0" } }),
        lockText: JSON.stringify({ packages: {} }),
      },
    ]);

    expect(result.compliant).toBe(false);
    expect(result.violations).toContain("root:@unsafe:registry:unapproved-registry");
    expect(result.observedRegistries.find((entry) => entry.key === "@unsafe:registry")?.location)
      .toBe("https://registry.npmjs.org/");
  });

  it("rejects a public artifact URL embedded in a lockfile", () => {
    const result = analyzeNpmSources([
      {
        name: "root",
        config: { registry: "https://packagefeedproxy.microsoft.io/npm/" },
        manifestText: JSON.stringify({ dependencies: { example: "1.0.0" } }),
        lockText: JSON.stringify({
          packages: {
            "node_modules/example": {
              resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
            },
          },
        }),
      },
    ]);

    expect(result.compliant).toBe(false);
    expect(result.violations.some((violation) => violation.includes("unapproved-resolved"))).toBe(true);
  });

  it("rejects a shadowed unsafe source from an underlying npmrc layer", () => {
    const result = analyzeNpmSources(
      [{
        name: "root-effective",
        config: { registry: "https://packagefeedproxy.microsoft.io/npm/" },
        manifestText: JSON.stringify({ dependencies: {} }),
        lockText: JSON.stringify({ packages: {} }),
      }],
      ["https://packagefeedproxy.microsoft.io/npm/"],
      [{ name: "user-npmrc", config: { registry: "https://registry.npmjs.org/" } }],
    );

    expect(result.compliant).toBe(false);
    expect(result.violations).toContain("user-npmrc:registry:unapproved-registry");
  });
});