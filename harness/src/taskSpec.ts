import { createHash } from "node:crypto";
import {
  deriveModelEvaluationIds,
  validateImpactMap,
  type ImpactMap,
} from "./evaluatorInventory.js";

import {
  assessReadiness,
  type CapabilityAttestation,
  type HarnessMode,
  type HarnessPolicySummary,
  type ReadinessAuthorities,
  type RuntimeAuthorizationGrant,
} from "./readiness.js";

export interface AcceptanceDefinition {
  id: string;
  gate: string;
  check: string;
}

export interface SliceDefinition {
  id: string;
  title: string;
  milestone: string;
  ownerAgent: string;
  dependsOn: string[];
  findings: string[];
  risk: string;
  scope: string[];
  visibleChange: string;
  acceptance: AcceptanceDefinition[];
  gates: string[];
  evidence: string[];
  rollout: { profile: string; steps: string[] };
  rollback: string;
}

export interface BacklogContract {
  schemaVersion: string;
  status: string;
  auditCommit: string;
  sourceBaseline: string;
  slices: SliceDefinition[];
}

export interface RoleDefinition {
  id: string;
  canEditCandidate: boolean;
  canAttest: boolean;
  canRelease: boolean;
  canEditPolicy: boolean;
}

export interface ExecutionPolicy extends HarnessPolicySummary {
  roles: RoleDefinition[];
  gates: Array<{
    id: string;
    kind: "hard" | "final";
    name: string;
    authority: string;
    failure: string;
    definition: string;
  }>;
  mandatoryGates: string[];
  productMandatoryGates: string[];
  protectedPaths: string[];
  evidenceKinds: string[];
  limits: {
    productWip: number;
    builders: number;
    promotions: number;
    builderAttempts: number;
    candidateActiveMinutes: number;
    builderAttemptMinutes: number;
    maxClockSkewSeconds: number;
    candidateUsd: number;
    candidateInputTokens: number;
    candidateOutputTokens: number;
    candidateAiCredits: number;
    permitTtlSeconds: number;
  };
}

export interface SourceBinding {
  repositoryId: string;
  branch: string;
  baseSha: string;
  sourceSha: string;
  treeSha256: string;
  diffSha256: string;
  clean: boolean;
}

export interface AuthorityBindings {
  backlogSha256: string;
  policySha256: string;
  workflowSha256: string;
  planSchemaSha256: string;
  controllerSha256: string;
  evaluatorPackSha256: string;
  testInventorySha256: string;
  fixtureManifestSha256: string;
  toolchainSha256: string;
  dependencyLockSha256: string;
  impactMapSha256: string;
  negativeControlIds: string[];
}

export interface DependencyReceipt {
  receiptId: string;
  sliceId: string;
  status: "SHIPPED";
  receiptSha256: string;
  policySha256: string;
  compatibleWithSourceSha: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface ImpactAssessment {
  assessmentId: string;
  sliceId: string;
  executionDomain: ExecutionDomain;
  sourceSha: string;
  policySha256: string;
  impactMapSha256: string;
  authorizedRoots: string[];
  plannedPaths: string[];
  gateIds: string[];
  modelEvaluationIds: string[];
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface TaskSpecAuthorities extends ReadinessAuthorities {
  verifyDependencyReceipt(receipt: DependencyReceipt): boolean;
  verifyImpactAssessment(assessment: ImpactAssessment): boolean;
  verifyTaskSpecLock(proof: TaskSpecLockProof): boolean;
}

export type ExecutionDomain =
  | "read-only"
  | "policy"
  | "controller"
  | "evaluator"
  | "release-plane"
  | "release"
  | "product";

export type MutationClass = "read-only" | "candidate" | "control-plane" | "policy";

export interface TaskValidationCommand {
  id: string;
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface PrepareTaskInput {
  mode: "rehearsal" | "implementation";
  sliceId: string;
  runId: string;
  fencingEpoch: number;
  source: SourceBinding;
  bindings: AuthorityBindings;
  capabilityAttestations: CapabilityAttestation[];
  authorizationGrant?: RuntimeAuthorizationGrant;
  dependencyReceipts: DependencyReceipt[];
  impactAssessment?: ImpactAssessment;
  impactMap: ImpactMap;
  exactAllowedPaths: string[];
  nonGoals: string[];
  allowedTools: string[];
  agentRuntime: { providerId: string; model: string } | null;
  validationCommands: TaskValidationCommand[];
  modelNetworkHosts: string[];
  toolNetworkHosts: string[];
  preparedAt: string;
}

export interface TaskSpecDraft {
  schemaVersion: "1.0";
  status: "DRAFT";
  releaseEligible: false;
  mode: "rehearsal" | "implementation";
  runId: string;
  sliceId: string;
  title: string;
  milestone: string;
  risk: string;
  ownerRole: string;
  executionDomain: ExecutionDomain;
  mutationClass: MutationClass;
  fencingEpoch: number;
  source: SourceBinding;
  bindings: AuthorityBindings;
  dependencyClosure: string[];
  dependencyReceipts: Pick<DependencyReceipt, "sliceId" | "receiptSha256">[];
  allowedPaths: string[];
  nonGoals: string[];
  allowedTools: string[];
  agentRuntime: { providerId: string; model: string } | null;
  validationCommands: TaskValidationCommand[];
  modelNetworkHosts: string[];
  toolNetworkHosts: string[];
  deniedAuthorities: string[];
  requiredGates: string[];
  requiredAcceptanceIds: string[];
  requiredAcceptance: AcceptanceDefinition[];
  requiredEvidenceKinds: string[];
  requiredModelEvaluationIds: string[];
  negativeControlIds: string[];
  visibleOutcome: string;
  rolloutProfile: string;
  rolloutSteps: string[];
  rollback: string;
  budgets: {
    maxAttempts: number;
    maxActiveMinutes: number;
    maxAttemptMinutes: number;
    maxUsd: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxRequests: number;
    maxAiCredits: number;
  };
  preparedAt: string;
  deadline: string;
  taskSpecSha256: string;
}

export interface TaskSpecBlocker {
  code: string;
  message: string;
}

export interface TaskPreparation {
  outcome: "READY_FOR_REHEARSAL" | "READY_FOR_DISPATCH" | "BLOCKED_SAFE";
  draft: TaskSpecDraft;
  blockers: TaskSpecBlocker[];
  warnings: TaskSpecBlocker[];
}

export interface TaskSpecLockProof {
  lockId: string;
  taskSpecSha256: string;
  runId: string;
  sliceId: string;
  sourceSha: string;
  policySha256: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface LockedTaskSpec extends Omit<TaskSpecDraft, "status"> {
  status: "SPEC_LOCKED";
  dispatchAuthorized: boolean;
  lock: TaskSpecLockProof;
}

export class TaskSpecError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TaskSpecError";
  }
}

const digestPattern = /^[a-f0-9]{64}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/;

const gateEvidence: Record<string, string[]> = {
  G00: ["contract", "traceability"],
  G01: ["contract", "adversarial", "traceability"],
  G02: ["regression", "browser"],
  G03: ["regression", "adversarial"],
  G04: ["regression", "adversarial"],
  G05: ["regression", "adversarial", "observability"],
  G06: ["model-eval", "observability"],
  G07: ["browser", "regression"],
  G08: ["observability", "adversarial"],
  G09: ["release", "migration", "adversarial"],
  G10: ["release", "observability"],
  G11: ["traceability", "observability", "model-eval"],
  G12: ["contract", "adversarial", "traceability"],
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function normalizedPath(value: string): string | undefined {
  const path = value.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    return undefined;
  }
  return path;
}

function normalizedValidationDirectory(value: string): string | undefined {
  const path = value.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (path === "" || path === ".") return ".";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").some((segment) => segment === ".." || segment === ".")) {
    return undefined;
  }
  return path;
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function dependencyClosure(slice: SliceDefinition, slices: Map<string, SliceDefinition>): string[] {
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new TaskSpecError("BACKLOG_CYCLE", `Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    const dependency = slices.get(id);
    if (!dependency) throw new TaskSpecError("DEPENDENCY_UNKNOWN", `Unknown dependency ${id}`);
    visiting.add(id);
    for (const parent of dependency.dependsOn) visit(parent);
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  };
  for (const id of slice.dependsOn) visit(id);
  return ordered;
}

const roleDomains: Record<string, ExecutionDomain[]> = {
  planner: ["read-only"],
  "policy-maintainer": ["policy", "controller", "release-plane"],
  evaluator: ["evaluator"],
  "release-broker": ["release"],
  builder: ["product"],
};

function mutationClass(domain: ExecutionDomain): MutationClass {
  if (domain === "product") return "candidate";
  if (domain === "policy") return "policy";
  if (["controller", "evaluator", "release-plane"].includes(domain)) return "control-plane";
  return "read-only";
}

const addBlocker = (blockers: TaskSpecBlocker[], code: string, message: string) => {
  blockers.push({ code, message });
};

export function prepareTaskSpec(
  backlog: BacklogContract,
  policy: ExecutionPolicy,
  input: PrepareTaskInput,
  authorities: TaskSpecAuthorities,
): TaskPreparation {
  const blockers: TaskSpecBlocker[] = [];
  const warnings: TaskSpecBlocker[] = [];
  if (backlog.schemaVersion !== "1.0" || backlog.status !== "SPECIFIED") {
    addBlocker(blockers, "BACKLOG_UNSUPPORTED", "Backlog contract is not a supported locked version.");
  }

  const slices = new Map(backlog.slices.map((slice) => [slice.id, slice]));
  const slice = slices.get(input.sliceId);
  if (!slice) throw new TaskSpecError("SLICE_UNKNOWN", `Unknown slice ${input.sliceId}`);
  const role = policy.roles.find((candidate) => candidate.id === slice.ownerAgent);
  if (!role) throw new TaskSpecError("ROLE_UNKNOWN", `Unknown owner role ${slice.ownerAgent}`);
  const domain = input.impactAssessment?.executionDomain ?? "read-only";
  const mutation = mutationClass(domain);
  if (!(roleDomains[role.id] ?? []).includes(domain)) {
    addBlocker(
      blockers,
      "EXECUTION_DOMAIN_FORBIDDEN",
      `${role.id} cannot own ${domain} execution.`,
    );
  }

  if (!runIdPattern.test(input.runId)) {
    addBlocker(blockers, "RUN_ID_INVALID", "Run ID must be stable and filesystem-safe.");
  }
  if (!Number.isSafeInteger(input.fencingEpoch) || input.fencingEpoch < 1) {
    addBlocker(blockers, "FENCING_EPOCH_INVALID", "Fencing epoch must be a positive integer.");
  }
  if (!input.source.repositoryId.trim()) {
    addBlocker(blockers, "REPOSITORY_ID_MISSING", "Repository identity is required.");
  }
  if (!shaPattern.test(input.source.baseSha) || !shaPattern.test(input.source.sourceSha)) {
    addBlocker(blockers, "SOURCE_SHA_INVALID", "Base and source must be exact Git commit SHAs.");
  }
  if (!input.source.clean) {
    addBlocker(blockers, "SOURCE_DIRTY", "TaskSpec locking requires a clean source commit.");
  }
  const expectedBranch = `candidate/${slice.id}/${input.runId}`;
  if (input.source.branch !== expectedBranch) {
    addBlocker(
      blockers,
      "BRANCH_MISMATCH",
      `Expected ${expectedBranch}, received ${input.source.branch}.`,
    );
  }

  for (const [name, value] of Object.entries({
    treeSha256: input.source.treeSha256,
    diffSha256: input.source.diffSha256,
    ...input.bindings,
  })) {
    if (name === "negativeControlIds") continue;
    if (!digestPattern.test(String(value))) {
      addBlocker(blockers, "BINDING_INVALID", `${name} must be a SHA-256 digest.`);
    }
  }
  if (input.bindings.negativeControlIds.length === 0) {
    addBlocker(
      blockers,
      "NEGATIVE_CONTROLS_MISSING",
      "The independently pinned evaluator pack must name negative controls.",
    );
  }
  if (input.bindings.negativeControlIds.some((id) => !/^NC-[a-z0-9-]+$/.test(id))) {
    addBlocker(blockers, "NEGATIVE_CONTROL_ID_INVALID", "Negative-control IDs must use the canonical NC-name format.");
  }
  if (new Set(input.bindings.negativeControlIds).size !== input.bindings.negativeControlIds.length) {
    addBlocker(blockers, "NEGATIVE_CONTROLS_DUPLICATE", "Negative control IDs must be unique.");
  }

  const closure = dependencyClosure(slice, slices);
  const receipts = new Map<string, DependencyReceipt>();
  for (const receipt of input.dependencyReceipts) {
    if (receipts.has(receipt.sliceId)) {
      addBlocker(blockers, "DEPENDENCY_RECEIPT_DUPLICATE", `Duplicate receipt for ${receipt.sliceId}.`);
      continue;
    }
    receipts.set(receipt.sliceId, receipt);
  }
  for (const dependency of closure) {
    const receipt = receipts.get(dependency);
    if (!receipt) {
      addBlocker(blockers, "DEPENDENCY_NOT_SHIPPED", `${dependency} has no shipped receipt.`);
      continue;
    }
    const valid =
      receipt.receiptId.trim().length > 0 &&
      receipt.status === "SHIPPED" &&
      digestPattern.test(receipt.receiptSha256) &&
      receipt.policySha256 === input.bindings.policySha256 &&
      receipt.compatibleWithSourceSha === input.source.sourceSha &&
      receipt.issuer.trim().length > 0 &&
      Number.isFinite(Date.parse(receipt.issuedAt)) &&
      Number.isFinite(Date.parse(receipt.expiresAt)) &&
      Date.parse(receipt.issuedAt) <= authorities.now() &&
      authorities.now() < Date.parse(receipt.expiresAt) &&
      receipt.signature.trim().length > 0 &&
      authorities.verifyDependencyReceipt(receipt);
    if (!valid) {
      addBlocker(blockers, "DEPENDENCY_RECEIPT_INVALID", `${dependency} receipt is untrusted or stale.`);
    }
  }
  for (const receipt of receipts.values()) {
    if (!closure.includes(receipt.sliceId)) {
      warnings.push({
        code: "DEPENDENCY_RECEIPT_UNUSED",
        message: `${receipt.sliceId} is not in the dependency closure and was ignored.`,
      });
    }
  }

  const normalizedAllowedPaths = input.exactAllowedPaths.map(normalizedPath);
  if (normalizedAllowedPaths.some((path) => !path)) {
    addBlocker(blockers, "ALLOWED_PATH_INVALID", "Allowed paths must be repository-relative roots.");
  }
  const allowedPaths = [...new Set(normalizedAllowedPaths.filter((path): path is string => Boolean(path)))].sort();
  if (mutation === "read-only" && allowedPaths.length > 0) {
    addBlocker(blockers, "READ_ONLY_ROLE_MUTATION", `${role.id} cannot receive writable paths.`);
  }
  if (mutation !== "read-only" && allowedPaths.length === 0) {
    addBlocker(blockers, "ALLOWED_PATHS_MISSING", `${role.id} requires exact writable roots.`);
  }

  const protectedPaths = policy.protectedPaths
    .map(normalizedPath)
    .filter((path): path is string => Boolean(path));
  if (
    mutation === "candidate" &&
    allowedPaths.some((path) => protectedPaths.some((protectedPath) => pathsOverlap(path, protectedPath)))
  ) {
    addBlocker(
      blockers,
      "PROTECTED_PATH_OVERLAP",
      "A normal candidate TaskSpec cannot write a protected evaluator/policy path.",
    );
  }
  if (
    mutation === "policy" &&
    allowedPaths.some((path) => !protectedPaths.some(
      (protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}/`),
    ))
  ) {
    addBlocker(
      blockers,
      "POLICY_PATH_OUTSIDE_PROTECTED",
      "Policy evolution may write only inside explicitly protected roots.",
    );
  }
  if (
    mutation === "control-plane" &&
    allowedPaths.some((path) => !protectedPaths.some(
      (protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}/`),
    ))
  ) {
    addBlocker(
      blockers,
      "CONTROL_PATH_OUTSIDE_PROTECTED",
      "Controller, evaluator and release-plane work may write only protected roots.",
    );
  }

  const impact = input.impactAssessment;
  if (!impact) {
    addBlocker(blockers, "IMPACT_ASSESSMENT_MISSING", "A signed path/contract impact assessment is required.");
  } else {
    const plannedPaths = impact.plannedPaths.map(normalizedPath);
    const authorizedRoots = impact.authorizedRoots.map(normalizedPath);
    const impactValid =
      impact.sliceId === slice.id &&
      impact.sourceSha === input.source.sourceSha &&
      impact.policySha256 === input.bindings.policySha256 &&
      impact.impactMapSha256 === input.bindings.impactMapSha256 &&
      impact.assessmentId.trim().length > 0 &&
      impact.issuer.trim().length > 0 &&
      Number.isFinite(Date.parse(impact.issuedAt)) &&
      Number.isFinite(Date.parse(impact.expiresAt)) &&
      Date.parse(impact.issuedAt) <= authorities.now() &&
      authorities.now() < Date.parse(impact.expiresAt) &&
      impact.signature.trim().length > 0 &&
      authorizedRoots.every((path) => Boolean(path)) &&
      plannedPaths.every((path) => Boolean(path)) &&
      authorities.verifyImpactAssessment(impact);
    if (!impactValid) {
      addBlocker(blockers, "IMPACT_ASSESSMENT_INVALID", "Impact assessment is untrusted or misbound.");
    }
    for (const path of allowedPaths) {
      if (!authorizedRoots.filter((value): value is string => Boolean(value)).some(
        (root) => path === root || path.startsWith(`${root}/`),
      )) {
        addBlocker(blockers, "ALLOWED_PATH_NOT_AUTHORIZED", `${path} is outside signed impact roots.`);
      }
    }
    for (const path of plannedPaths.filter((value): value is string => Boolean(value))) {
      if (!allowedPaths.some((root) => pathsOverlap(root, path))) {
        addBlocker(blockers, "PLANNED_PATH_NOT_ALLOWED", `${path} is outside the writable roots.`);
      }
    }
  }

  if (input.nonGoals.length === 0 || input.nonGoals.some((value) => !value.trim())) {
    addBlocker(blockers, "NON_GOALS_MISSING", "TaskSpec must state explicit non-goals.");
  }
  if (input.allowedTools.length === 0 || input.allowedTools.some((tool) => !tool.trim() || tool.includes("*"))) {
    addBlocker(blockers, "TOOL_ALLOWLIST_INVALID", "Tools require a non-wildcard allowlist.");
  }
  const agentRuntime = input.agentRuntime
    ? { providerId: input.agentRuntime.providerId.trim(), model: input.agentRuntime.model.trim() }
    : null;
  if (
    mutation !== "read-only" &&
    (!agentRuntime || !agentRuntime.providerId || !agentRuntime.model || agentRuntime.providerId.includes("*") || agentRuntime.model.includes("*"))
  ) {
    addBlocker(blockers, "AGENT_RUNTIME_UNBOUND", "Mutation TaskSpecs must bind an exact provider and model.");
  }
  if (mutation === "read-only" && agentRuntime !== null) {
    addBlocker(blockers, "READ_ONLY_AGENT_RUNTIME", "Read-only TaskSpecs cannot authorize a model runtime.");
  }
  const validationIds = new Set<string>();
  for (const command of input.validationCommands) {
    const cwd = normalizedValidationDirectory(command.cwd);
    const invalid =
      !/^[A-Za-z0-9][A-Za-z0-9._-]{1,80}$/.test(command.id) ||
      validationIds.has(command.id) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{1,80}$/.test(command.executable) ||
      command.args.some((argument) => /[\r\n\0]/.test(argument)) ||
      !cwd ||
      !Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1 ||
      command.timeoutMs > policy.limits.builderAttemptMinutes * 60_000 ||
      !Number.isSafeInteger(command.maxOutputBytes) || command.maxOutputBytes < 1 || command.maxOutputBytes > 10 * 1024 * 1024;
    if (invalid) addBlocker(blockers, "VALIDATION_COMMAND_INVALID", `Validation command ${command.id || "<unnamed>"} is unsafe.`);
    validationIds.add(command.id);
  }
  if (mutation !== "read-only" && input.validationCommands.length === 0) {
    addBlocker(blockers, "VALIDATION_COMMANDS_MISSING", "Mutation TaskSpecs require fixed validation commands.");
  }
  if (mutation === "read-only" && input.validationCommands.length > 0) {
    addBlocker(blockers, "READ_ONLY_VALIDATION_COMMAND", "Read-only TaskSpecs cannot authorize validation execution.");
  }
  const allNetworkHosts = [...input.modelNetworkHosts, ...input.toolNetworkHosts];
  if (allNetworkHosts.some((host) => !host.trim() || host.includes("*") || host.includes("/"))) {
    addBlocker(blockers, "NETWORK_ALLOWLIST_INVALID", "Network hosts must be explicit hostnames without wildcards or paths.");
  }

  const readiness = assessReadiness(
    policy,
    input.bindings.policySha256,
    input.mode,
    input.capabilityAttestations,
    authorities,
    {
      repositoryId: input.source.repositoryId,
      authorizationGrant: input.authorizationGrant,
    },
  );
  blockers.push(...readiness.blockers);
  warnings.push(...readiness.warnings);
  const executionAuthorized = input.mode === "implementation" &&
    !readiness.blockers.some((blocker) => blocker.code === "AUTHORIZATION_NOT_GRANTED");
  const grantedBilling = input.authorizationGrant?.billing;

  const impactMapValidation = validateImpactMap(input.impactMap);
  if (!impactMapValidation.valid || impactMapValidation.sha256 !== input.bindings.impactMapSha256) {
    addBlocker(blockers, "IMPACT_MAP_BINDING_INVALID", "Model-impact rules do not match the pinned impact-map digest.");
  }
  const impactGates = impact?.gateIds ?? [];
  const requiredModelEvaluationIds = deriveModelEvaluationIds(input.impactMap, impact?.plannedPaths ?? []);
  if ((impact?.modelEvaluationIds ?? []).some((id) => !/^[a-z][a-z0-9-]+$/.test(id))) {
    addBlocker(blockers, "MODEL_EVALUATION_ID_INVALID", "Impact assessment contains an invalid live-model evaluation ID.");
  }
  if (canonical([...(impact?.modelEvaluationIds ?? [])].sort()) !== canonical(requiredModelEvaluationIds)) {
    addBlocker(blockers, "MODEL_EVALUATION_SCOPE_MISMATCH", "Signed model-evaluation IDs do not match the pinned path-impact rules.");
  }
  const requiredGates = [...new Set([
    ...policy.mandatoryGates,
    ...(slice.id.startsWith("S") ? policy.productMandatoryGates : []),
    ...slice.gates,
    ...slice.acceptance.map((acceptance) => acceptance.gate),
    ...impactGates,
    ...(mutation === "policy" || allowedPaths.some(
      (path) => protectedPaths.some((protectedPath) => pathsOverlap(path, protectedPath)),
    ) ? ["G12"] : []),
  ])].sort();
  const requiredEvidenceKinds = [...new Set([
    ...slice.evidence,
    ...(requiredModelEvaluationIds.length > 0 ? ["model-eval"] : []),
    ...requiredGates.flatMap((gate) => gateEvidence[gate] ?? []),
  ])].sort();
  for (const kind of requiredEvidenceKinds) {
    if (!policy.evidenceKinds.includes(kind)) {
      addBlocker(blockers, "EVIDENCE_KIND_UNKNOWN", `Evidence kind ${kind} is not allowed by policy.`);
    }
  }

  const preparedAt = Date.parse(input.preparedAt);
  const trustedNow = authorities.now();
  if (
    !Number.isFinite(preparedAt) ||
    !Number.isFinite(trustedNow) ||
    Math.abs(preparedAt - trustedNow) > policy.limits.maxClockSkewSeconds * 1_000
  ) {
    addBlocker(blockers, "PREPARED_AT_INVALID", "Prepared time must be an ISO timestamp.");
  }
  const policyDeadline = (Number.isFinite(preparedAt) ? preparedAt : 0) +
    policy.limits.candidateActiveMinutes * 60_000;
  const parsedGrantDeadline = input.authorizationGrant
    ? Date.parse(input.authorizationGrant.expiresAt)
    : Number.POSITIVE_INFINITY;
  const grantDeadline = Number.isFinite(parsedGrantDeadline)
    ? parsedGrantDeadline
    : policyDeadline;
  const deadline = new Date(Math.min(policyDeadline, grantDeadline)).toISOString();
  const draftWithoutDigest: Omit<TaskSpecDraft, "taskSpecSha256"> = {
    schemaVersion: "1.0",
    status: "DRAFT",
    releaseEligible: false,
    mode: input.mode,
    runId: input.runId,
    sliceId: slice.id,
    title: slice.title,
    milestone: slice.milestone,
    risk: slice.risk,
    ownerRole: role.id,
    executionDomain: domain,
    mutationClass: mutation,
    fencingEpoch: input.fencingEpoch,
    source: input.source,
    bindings: input.bindings,
    dependencyClosure: closure,
    dependencyReceipts: closure
      .flatMap((id) => receipts.has(id) ? [{ sliceId: id, receiptSha256: receipts.get(id)!.receiptSha256 }] : []),
    allowedPaths,
    nonGoals: input.nonGoals.map((value) => value.trim()),
    allowedTools: [...new Set(input.allowedTools)].sort(),
    agentRuntime,
    validationCommands: [...input.validationCommands].sort((left, right) => left.id.localeCompare(right.id)),
    modelNetworkHosts: [...new Set(input.modelNetworkHosts.map((host) => host.toLowerCase()))].sort(),
    toolNetworkHosts: [...new Set(input.toolNetworkHosts.map((host) => host.toLowerCase()))].sort(),
    deniedAuthorities: [
      "ambient-credentials",
      "policy-self-approval",
      "production-data",
      "production-network",
      "release-signing",
      "secret-store-read",
      "tool-widening",
    ],
    requiredGates,
    requiredAcceptanceIds: slice.acceptance.map((acceptance) => acceptance.id).sort(),
    requiredAcceptance: [...slice.acceptance].sort((left, right) => left.id.localeCompare(right.id)),
    requiredEvidenceKinds,
    requiredModelEvaluationIds,
    negativeControlIds: [...input.bindings.negativeControlIds].sort(),
    visibleOutcome: slice.visibleChange,
    rolloutProfile: slice.rollout.profile,
    rolloutSteps: [...slice.rollout.steps],
    rollback: slice.rollback,
    budgets: {
      maxAttempts: policy.limits.builderAttempts,
      maxActiveMinutes: policy.limits.candidateActiveMinutes,
      maxAttemptMinutes: policy.limits.builderAttemptMinutes,
      maxUsd: executionAuthorized
        ? Math.min(policy.limits.candidateUsd, grantedBilling?.maxUsd ?? policy.limits.candidateUsd)
        : 0,
      maxInputTokens: executionAuthorized
        ? Math.min(policy.limits.candidateInputTokens, grantedBilling?.maxInputTokens ?? policy.limits.candidateInputTokens)
        : 0,
      maxOutputTokens: executionAuthorized
        ? Math.min(policy.limits.candidateOutputTokens, grantedBilling?.maxOutputTokens ?? policy.limits.candidateOutputTokens)
        : 0,
      maxRequests: executionAuthorized ? grantedBilling?.maxRequests ?? 1 : 0,
      maxAiCredits: executionAuthorized
        ? Math.min(policy.limits.candidateAiCredits, grantedBilling?.maxAiCredits ?? policy.limits.candidateAiCredits)
        : 0,
    },
    preparedAt: input.preparedAt,
    deadline,
  };
  const draft: TaskSpecDraft = {
    ...draftWithoutDigest,
    taskSpecSha256: digest(draftWithoutDigest),
  };

  return {
    outcome: blockers.length > 0
      ? "BLOCKED_SAFE"
      : input.mode === "implementation"
        ? "READY_FOR_DISPATCH"
        : "READY_FOR_REHEARSAL",
    draft,
    blockers,
    warnings,
  };
}

export function lockTaskSpec(
  preparation: TaskPreparation,
  proof: TaskSpecLockProof,
  policy: ExecutionPolicy,
  authorities: TaskSpecAuthorities,
): LockedTaskSpec {
  if (preparation.blockers.length > 0) {
    throw new TaskSpecError("TASK_BLOCKED", "A blocked TaskSpec cannot be locked.");
  }
  const draft = preparation.draft;
  const issuedAt = Date.parse(proof.issuedAt);
  const expiresAt = Date.parse(proof.expiresAt);
  const now = authorities.now();
  const valid =
    proof.taskSpecSha256 === draft.taskSpecSha256 &&
    proof.runId === draft.runId &&
    proof.sliceId === draft.sliceId &&
    proof.sourceSha === draft.source.sourceSha &&
    proof.policySha256 === draft.bindings.policySha256 &&
    proof.lockId.trim().length > 0 &&
    proof.issuer.trim().length > 0 &&
    proof.signature.trim().length > 0 &&
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    issuedAt <= now &&
    now < expiresAt &&
    issuedAt < expiresAt &&
    expiresAt - issuedAt <= policy.limits.permitTtlSeconds * 1_000 &&
    authorities.verifyTaskSpecLock(proof);
  if (!valid) throw new TaskSpecError("TASK_LOCK_INVALID", "TaskSpec lock proof is invalid or stale.");

  return {
    ...draft,
    status: "SPEC_LOCKED",
    dispatchAuthorized: preparation.outcome === "READY_FOR_DISPATCH",
    lock: proof,
  };
}

export function verifyLockedTaskSpec(
  task: LockedTaskSpec,
  policy: ExecutionPolicy,
  authorities: TaskSpecAuthorities,
): boolean {
  if (task.status !== "SPEC_LOCKED") return false;
  const {
    status: _status,
    dispatchAuthorized,
    lock,
    ...draftFields
  } = task;
  const draft: TaskSpecDraft = { ...draftFields, status: "DRAFT" };
  const { taskSpecSha256: _claimedDigest, ...withoutDigest } = draft;
  if (digest(withoutDigest) !== task.taskSpecSha256) return false;
  try {
    const verified = lockTaskSpec({
      outcome: dispatchAuthorized ? "READY_FOR_DISPATCH" : "READY_FOR_REHEARSAL",
      draft,
      blockers: [],
      warnings: [],
    }, lock, policy, authorities);
    return canonical(verified) === canonical(task);
  } catch {
    return false;
  }
}