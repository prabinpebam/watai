// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bindReleaseCandidate, verifyReleaseCandidate, type ReleaseCandidateObservation } from "./releaseCandidate";

const observation = (): ReleaseCandidateObservation => ({
  repositoryId: "prabinpebam/watai",
  sourceSha: "a".repeat(40),
  sourceTreeSha: "b".repeat(40),
  clean: true,
  validationInputsSha256: "c".repeat(64),
  browserPackSha256: "d".repeat(64),
  frontendArtifactSha256: "e".repeat(64),
  apiArtifactSha256: "f".repeat(64),
});

describe("release candidate binding", () => {
  it("binds clean source, validation, browser, artifact, and rollback identities", () => {
    const manifest = bindReleaseCandidate(observation(), "0.2.2", "1".repeat(40), "2".repeat(64));
    expect(verifyReleaseCandidate(manifest, observation(), {
      frontendSha: "1".repeat(40), backendSha256: "2".repeat(64),
    })).toEqual([]);
  });

  it.each([
    "sourceSha",
    "sourceTreeSha",
    "validationInputsSha256",
    "browserPackSha256",
    "frontendArtifactSha256",
    "apiArtifactSha256",
  ] as const)("rejects changed %s after validation", (key) => {
    const manifest = bindReleaseCandidate(observation(), "0.2.2", "1".repeat(40), "2".repeat(64));
    const changed = observation();
    changed[key] = key.endsWith("Sha") ? "3".repeat(40) : "3".repeat(64);
    expect(verifyReleaseCandidate(manifest, changed, {
      frontendSha: "1".repeat(40), backendSha256: "2".repeat(64),
    })).toContain(`BINDING_MISMATCH:${key}`);
  });

  it("rejects dirty source, manifest tampering, and changed rollback targets", () => {
    const manifest = bindReleaseCandidate(observation(), "0.2.2", "1".repeat(40), "2".repeat(64));
    manifest.releaseVersion = "9.9.9";
    const changed = { ...observation(), clean: false };
    expect(verifyReleaseCandidate(manifest, changed, {
      frontendSha: "4".repeat(40), backendSha256: "5".repeat(64),
    })).toEqual(expect.arrayContaining([
      "MANIFEST_TAMPERED", "SOURCE_DIRTY", "ROLLBACK_FRONTEND_MISMATCH", "ROLLBACK_BACKEND_MISMATCH",
    ]));
  });
});