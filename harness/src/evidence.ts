import type { ExecutionPolicy, LockedTaskSpec } from "./taskSpec.js";

export interface EvidenceSubject {
  subjectId: string;
  kind: string;
  sha256: string;
  uri: string;
  evaluationId?: string;
  parents: Array<{ relation: string; subjectId: string }>;
}

export interface EvidenceCheck {
  checkId: string;
  acceptanceId: string | null;
  gate: string;
  resultSubjectId: string;
  producerRole: string;
  producerIdentity: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
  expected: number;
  attempted: number;
  passed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  supervisorObserved: boolean;
  processTerminated: boolean;
  reportSha256: string;
}

export interface NegativeControlResult {
  id: string;
  expected: "REJECT";
  observed: "REJECT" | "ACCEPT" | "MISSING";
  resultSubjectId: string;
}

export interface CandidateEvidencePacket {
  schemaVersion: "1.0";
  status: "EVALUATED";
  releaseEligible: false;
  packetId: string;
  runId: string;
  sliceId: string;
  taskSpecSha256: string;
  source: LockedTaskSpec["source"];
  bindings: LockedTaskSpec["bindings"];
  subjects: EvidenceSubject[];
  checks: EvidenceCheck[];
  negativeControls: NegativeControlResult[];
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface EvidenceAuthorities {
  now(): number;
  verifyEvidencePacket(packet: CandidateEvidencePacket): boolean;
  verifyEvidenceCheck(check: EvidenceCheck, packet: CandidateEvidencePacket): boolean;
}

export interface EvidenceAdmission {
  outcome: "CANDIDATE_VALID" | "FAILED" | "QUARANTINED";
  blockers: Array<{ code: string; message: string }>;
  passedGates: string[];
  acceptanceResults: Array<{ id: string; passed: boolean }>;
}

const digestPattern = /^[a-f0-9]{64}$/;
const parentRelations = new Set([
  "builtFrom",
  "testedArtifact",
  "evaluatedWith",
  "deployedWith",
  "supersedes",
  "derivedFrom",
]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

export function admitCandidateEvidence(
  task: LockedTaskSpec,
  policy: ExecutionPolicy,
  packet: CandidateEvidencePacket,
  authorities: EvidenceAuthorities,
): EvidenceAdmission {
  const blockers: EvidenceAdmission["blockers"] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  if (task.status !== "SPEC_LOCKED") block("TASK_NOT_LOCKED", "Evidence requires a locked TaskSpec.");
  if (
    packet.schemaVersion !== "1.0" ||
    packet.status !== "EVALUATED" ||
    packet.releaseEligible !== false ||
    !packet.packetId.trim() ||
    !packet.issuer.trim() ||
    !packet.signature.trim()
  ) {
    block("PACKET_INVALID", "Evidence packet header is invalid.");
  }
  if (
    packet.runId !== task.runId ||
    packet.sliceId !== task.sliceId ||
    packet.taskSpecSha256 !== task.taskSpecSha256 ||
    !same(packet.source, task.source) ||
    !same(packet.bindings, task.bindings)
  ) {
    block("PACKET_BINDING_MISMATCH", "Evidence packet does not bind the locked task and source exactly.");
  }
  const issuedAt = Date.parse(packet.issuedAt);
  const expiresAt = Date.parse(packet.expiresAt);
  const now = authorities.now();
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now ||
    now >= expiresAt ||
    issuedAt >= expiresAt ||
    expiresAt - issuedAt > policy.limits.permitTtlSeconds * 1_000
  ) {
    block("PACKET_STALE", "Evidence packet validity window is invalid or stale.");
  }
  if (!authorities.verifyEvidencePacket(packet)) {
    block("PACKET_SIGNATURE_INVALID", "Evidence packet signature is not trusted.");
  }

  const subjects = new Map<string, EvidenceSubject>();
  for (const subject of packet.subjects) {
    if (subjects.has(subject.subjectId)) {
      block("SUBJECT_DUPLICATE", `Duplicate evidence subject ${subject.subjectId}.`);
      continue;
    }
    const expectedUri = `runs/${packet.runId}/${packet.source.sourceSha}/${subject.kind}/${subject.sha256}`;
    if (
      !subject.subjectId.trim() ||
      !subject.kind.trim() ||
      !digestPattern.test(subject.sha256) ||
      subject.uri !== expectedUri ||
      (subject.kind === "model-eval"
        ? !subject.evaluationId || !/^[a-z][a-z0-9-]+$/.test(subject.evaluationId)
        : subject.evaluationId !== undefined) ||
      subject.parents.some((parent) => !parentRelations.has(parent.relation))
    ) {
      block("SUBJECT_INVALID", `Evidence subject ${subject.subjectId || "<unnamed>"} is malformed.`);
    }
    subjects.set(subject.subjectId, subject);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      block("SUBJECT_CYCLE", `Evidence DAG contains a cycle at ${id}.`);
      return;
    }
    if (visited.has(id)) return;
    const subject = subjects.get(id);
    if (!subject) {
      block("SUBJECT_PARENT_MISSING", `Evidence DAG references missing subject ${id}.`);
      return;
    }
    visiting.add(id);
    for (const parent of subject.parents) visit(parent.subjectId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const subject of subjects.values()) visit(subject.subjectId);
  for (const kind of task.requiredEvidenceKinds) {
    if (![...subjects.values()].some((subject) => subject.kind === kind)) {
      block("EVIDENCE_KIND_MISSING", `Required evidence kind ${kind} is absent.`);
    }
  }
  for (const evaluationId of task.requiredModelEvaluationIds) {
    if (![...subjects.values()].some((subject) =>
      subject.kind === "model-eval" && subject.evaluationId === evaluationId)) {
      block("MODEL_EVALUATION_MISSING", `Required live-model evaluation ${evaluationId} is absent.`);
    }
  }

  const policyGates = new Map(policy.gates.map((gate) => [gate.id, gate]));
  const acceptance = new Map(task.requiredAcceptance.map((item) => [item.id, item]));
  const seenChecks = new Set<string>();
  const seenAcceptance = new Set<string>();
  const passedGates = new Set<string>();
  const acceptanceResults: EvidenceAdmission["acceptanceResults"] = [];
  for (const check of packet.checks) {
    if (seenChecks.has(check.checkId)) block("CHECK_DUPLICATE", `Duplicate check ${check.checkId}.`);
    seenChecks.add(check.checkId);
    const gate = policyGates.get(check.gate);
    const resultSubject = subjects.get(check.resultSubjectId);
    const denominatorPass =
      Number.isSafeInteger(check.expected) &&
      check.expected > 0 &&
      check.attempted === check.expected &&
      check.passed === check.expected &&
      check.failed === 0 &&
      check.skipped === 0 &&
      check.timedOut === 0;
    const trustedProducer = Boolean(gate) &&
      check.producerRole === gate?.authority &&
      check.producerRole !== "builder" &&
      check.producerIdentity.trim().length > 0 &&
      check.signature.trim().length > 0 &&
      Number.isFinite(Date.parse(check.issuedAt)) &&
      Number.isFinite(Date.parse(check.expiresAt)) &&
      Date.parse(check.issuedAt) <= now &&
      now < Date.parse(check.expiresAt) &&
      Date.parse(check.issuedAt) < Date.parse(check.expiresAt) &&
      authorities.verifyEvidenceCheck(check, packet);
    const checkPass =
      check.checkId.trim().length > 0 &&
      task.requiredGates.includes(check.gate) &&
      Boolean(resultSubject) &&
      digestPattern.test(check.reportSha256) &&
      denominatorPass &&
      trustedProducer &&
      check.supervisorObserved &&
      check.processTerminated;
    if (!checkPass) block("CHECK_FAILED", `Check ${check.checkId || "<unnamed>"} is incomplete or untrusted.`);
    if (checkPass) passedGates.add(check.gate);

    if (check.acceptanceId !== null) {
      const expected = acceptance.get(check.acceptanceId);
      if (!expected || expected.gate !== check.gate || seenAcceptance.has(check.acceptanceId)) {
        block("ACCEPTANCE_MAPPING_INVALID", `Acceptance ${check.acceptanceId} is unknown, duplicated or on the wrong gate.`);
      } else {
        seenAcceptance.add(check.acceptanceId);
        acceptanceResults.push({ id: check.acceptanceId, passed: checkPass });
      }
    }
  }
  for (const item of task.requiredAcceptance) {
    if (!seenAcceptance.has(item.id)) {
      block("ACCEPTANCE_MISSING", `Required acceptance ${item.id} has no result.`);
      acceptanceResults.push({ id: item.id, passed: false });
    }
  }
  for (const gate of task.requiredGates) {
    if (!passedGates.has(gate)) block("GATE_MISSING", `Required gate ${gate} has no passing trusted check.`);
  }

  const negativeControls = new Map<string, NegativeControlResult>();
  for (const result of packet.negativeControls) {
    if (negativeControls.has(result.id)) block("NEGATIVE_CONTROL_DUPLICATE", `Duplicate control ${result.id}.`);
    negativeControls.set(result.id, result);
  }
  for (const id of task.negativeControlIds) {
    const result = negativeControls.get(id);
    if (
      !result ||
      result.expected !== "REJECT" ||
      result.observed !== "REJECT" ||
      !subjects.has(result.resultSubjectId)
    ) {
      block("NEGATIVE_CONTROL_FAILED", `Negative control ${id} did not reject with bound evidence.`);
    }
  }
  for (const id of negativeControls.keys()) {
    if (!task.negativeControlIds.includes(id)) block("NEGATIVE_CONTROL_UNDECLARED", `Control ${id} was not pinned by TaskSpec.`);
  }

  const quarantine = blockers.some((item) => [
    "PACKET_BINDING_MISMATCH",
    "PACKET_SIGNATURE_INVALID",
    "SUBJECT_CYCLE",
    "SUBJECT_PARENT_MISSING",
  ].includes(item.code));
  return {
    outcome: blockers.length === 0 ? "CANDIDATE_VALID" : quarantine ? "QUARANTINED" : "FAILED",
    blockers,
    passedGates: [...passedGates].sort(),
    acceptanceResults: acceptanceResults.sort((left, right) => left.id.localeCompare(right.id)),
  };
}