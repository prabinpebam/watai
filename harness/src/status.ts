import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assessReadiness,
  type CapabilityAttestation,
  type HarnessMode,
  type HarnessPolicySummary,
  type ReadinessAuthorities,
  type RuntimeAuthorizationGrant,
} from "./readiness.js";
import { loadAuthorityBundle } from "./authorityBundle.js";
import { TrustBackedAuthorities } from "./trustAuthorities.js";

const modes = new Set<HarnessMode>(["rehearsal", "implementation", "evaluation", "release"]);
const requestedMode = (process.argv[2] ?? "implementation") as HarnessMode;
if (!modes.has(requestedMode)) {
  console.error("Usage: npm run harness:status -- [rehearsal|implementation|evaluation|release]");
  process.exitCode = 64;
} else {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const policyPath = resolve(
    root,
    "documentation",
    "implementation",
    "2026-09-10-autonomous-delivery",
    "contracts",
    "policy.json",
  );
  const workflowPath = resolve(
    root,
    "documentation",
    "implementation",
    "2026-09-10-autonomous-delivery",
    "contracts",
    "workflow.json",
  );
  const [policyText, workflowText, backlogText, schemaText, controllerBytes, rootLock, apiLock] = await Promise.all([
    readFile(policyPath, "utf8"),
    readFile(workflowPath, "utf8"),
    readFile(resolve(dirname(policyPath), "backlog.json"), "utf8"),
    readFile(resolve(dirname(policyPath), "plan.schema.json"), "utf8"),
    readFile(resolve(root, ".harness-dist", "controller.js")),
    readFile(resolve(root, "package-lock.json")),
    readFile(resolve(root, "api", "package-lock.json")),
  ]);
  const policy = JSON.parse(policyText) as HarnessPolicySummary & {
    limits: {
      maxClockSkewSeconds: number;
      permitTtlSeconds: number;
      validationMinutes: number;
    };
  };
  const policySha256 = createHash("sha256").update(policyText).digest("hex");
  const workflowSha256 = createHash("sha256").update(workflowText).digest("hex");
  const backlogSha256 = createHash("sha256").update(backlogText).digest("hex");
  const planSchemaSha256 = createHash("sha256").update(schemaText).digest("hex");
  const controllerSha256 = createHash("sha256").update(controllerBytes).digest("hex");
  const dependencyLockSha256 = createHash("sha256")
    .update(rootLock)
    .update("\0")
    .update(apiLock)
    .digest("hex");
  const repositoryId = process.env.WATAI_REPOSITORY_ID ?? "prabinpebam/watai";
  let capabilityAttestations: CapabilityAttestation[] = [];
  let authorizationGrant: RuntimeAuthorizationGrant | undefined;
  let authorityError: { code: string; message: string } | undefined;
  let authorities: ReadinessAuthorities = {
    now: () => Date.now(),
    verifyAuthorization: () => false,
    verifyCapability: () => false,
  };
  const authorityDirectory = process.env.WATAI_HARNESS_AUTHORITY_DIR;
  if (authorityDirectory) {
    try {
      const clock = { now: () => Date.now() };
      const bundle = await loadAuthorityBundle(root, authorityDirectory, clock, {
        expectedRootSha256: process.env.WATAI_HARNESS_ROOT_SHA256 ?? "",
        repositoryId,
        backlogSha256,
        policySha256,
        workflowSha256,
        planSchemaSha256,
        controllerSha256,
        dependencyLockSha256,
        maxClockSkewMs: policy.limits.maxClockSkewSeconds * 1_000,
        maxClaimLifetimeMs: 24 * 60 * 60_000,
      });
      authorities = new TrustBackedAuthorities(bundle.verifier, clock, {
        maxClockSkewMs: policy.limits.maxClockSkewSeconds * 1_000,
        maxGuardProofLifetimeMs: policy.limits.permitTtlSeconds * 1_000,
        maxPermitLifetimeMs: policy.limits.permitTtlSeconds * 1_000,
        maxEffectLifetimeMs: policy.limits.validationMinutes * 60_000,
      });
      capabilityAttestations = bundle.capabilityAttestations;
      authorizationGrant = bundle.authorizationGrants.find((grant) =>
        requestedMode !== "rehearsal" && grant.modes.includes(requestedMode));
      if (bundle.rejectedClaims.length > 0) {
        authorityError = {
          code: "AUTHORITY_CLAIMS_REJECTED",
          message: `${bundle.rejectedClaims.length} authority claim(s) were rejected.`,
        };
      }
    } catch (error) {
      authorityError = {
        code: (error as { code?: string }).code ?? "AUTHORITY_BUNDLE_INVALID",
        message: error instanceof Error ? error.message : "Authority bundle could not be loaded.",
      };
    }
  }

  const result = assessReadiness(
    policy,
    policySha256,
    requestedMode,
    capabilityAttestations,
    authorities,
    { repositoryId, authorizationGrant },
  );
  if (authorityError) result.blockers.unshift(authorityError);
  result.ready = result.blockers.length === 0;

  console.log(JSON.stringify({
    status: result.ready ? "READY" : "BLOCKED_SAFE",
    policySha256,
    authorizationGranted: policy.authorizationGranted,
    effectiveSpendUsd: policy.effectiveSpendUsd,
    authorityDirectoryConfigured: Boolean(authorityDirectory),
    ...result,
    note: authorityDirectory
      ? "Authority is accepted only from the externally pinned public-root bundle."
      : "Set WATAI_HARNESS_AUTHORITY_DIR to an external signed bundle; no embedded authority is used.",
  }, null, 2));
}