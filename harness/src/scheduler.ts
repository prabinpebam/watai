import type { BacklogContract, ExecutionPolicy, SliceDefinition } from "./taskSpec.js";

export interface SliceCompletion {
  sliceId: string;
  status: "SHIPPED";
  receiptSha256: string;
  verified: boolean;
}

export interface ActiveCandidate {
  runId: string;
  sliceId: string;
  state: string;
  ownerRole: string;
}

export interface ValueAssessment {
  assessmentId: string;
  sliceId: string;
  userValue: number;
  riskReduction: number;
  effort: number;
  confidence: number;
  rationaleSha256: string;
  policySha256: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface ScheduleDecision {
  selected: SliceDefinition | null;
  ready: string[];
  blocked: Array<{ sliceId: string; reasons: string[] }>;
  reason: string;
  priorityMode: "canonical" | "value-per-effort";
}

const milestoneRank: Record<string, number> = { M0: 0, M1: 1, M2: 2, M3: 3, M4: 4 };
const riskRank: Record<string, number> = { critical: 0, high: 1, medium: 2 };
const terminalStates = new Set(["SHIPPED", "REJECTED", "BLOCKED_SAFE", "CANCELLED", "ROLLED_BACK"]);

function safetyTier(slice: SliceDefinition): number {
  if (/^H0[1-5]$/.test(slice.id)) return 0;
  if (slice.rollout.profile === "contain-disabled" || slice.risk === "critical") return 1;
  if (slice.risk === "high") return 2;
  return 3;
}

function validAssessment(assessment: ValueAssessment): boolean {
  return (
    Number.isInteger(assessment.userValue) && assessment.userValue >= 1 && assessment.userValue <= 5 &&
    Number.isInteger(assessment.riskReduction) && assessment.riskReduction >= 1 && assessment.riskReduction <= 5 &&
    Number.isInteger(assessment.effort) && assessment.effort >= 1 && assessment.effort <= 5 &&
    Number.isFinite(assessment.confidence) && assessment.confidence > 0 && assessment.confidence <= 1 &&
    /^[a-f0-9]{64}$/.test(assessment.rationaleSha256)
  );
}

function valueScore(assessment: ValueAssessment): number {
  return ((assessment.riskReduction * 2) + assessment.userValue) * assessment.confidence / assessment.effort;
}

export function selectNextSlice(
  backlog: BacklogContract,
  policy: ExecutionPolicy,
  completions: SliceCompletion[],
  activeCandidates: ActiveCandidate[],
  valueAssessments: ValueAssessment[] = [],
): ScheduleDecision {
  const completed = new Set(
    completions
      .filter((completion) => completion.status === "SHIPPED" && completion.verified)
      .map((completion) => completion.sliceId),
  );
  const active = activeCandidates.filter((candidate) => !terminalStates.has(candidate.state));
  const activeIds = new Set(active.map((candidate) => candidate.sliceId));
  const blocked: ScheduleDecision["blocked"] = [];
  const ready = backlog.slices.filter((slice) => {
    if (completed.has(slice.id) || activeIds.has(slice.id)) return false;
    const missing = slice.dependsOn.filter((dependency) => !completed.has(dependency));
    if (missing.length > 0) {
      blocked.push({ sliceId: slice.id, reasons: missing.map((dependency) => `dependency:${dependency}`) });
      return false;
    }
    return true;
  });

  const activeProducts = active.filter((candidate) => candidate.sliceId.startsWith("S")).length;
  const activeBuilders = active.filter((candidate) => candidate.ownerRole === "builder").length;
  let priorityMode: ScheduleDecision["priorityMode"] = "canonical";
  let ordered = ready
    .map((slice, index) => ({ slice, index: backlog.slices.indexOf(slice) }))
    .sort((left, right) =>
      safetyTier(left.slice) - safetyTier(right.slice) ||
      (milestoneRank[left.slice.milestone] ?? 99) - (milestoneRank[right.slice.milestone] ?? 99) ||
      (riskRank[left.slice.risk] ?? 99) - (riskRank[right.slice.risk] ?? 99) ||
      left.index - right.index)
    .map((entry) => entry.slice);
  const assessments = new Map<string, ValueAssessment>();
  for (const assessment of valueAssessments) {
    if (assessments.has(assessment.sliceId)) {
      return {
        selected: null,
        ready: ordered.map((slice) => slice.id),
        blocked,
        reason: "PRIORITY_ASSESSMENT_AMBIGUOUS",
        priorityMode,
      };
    }
    if (!validAssessment(assessment)) {
      return {
        selected: null,
        ready: ordered.map((slice) => slice.id),
        blocked,
        reason: "PRIORITY_ASSESSMENT_INVALID",
        priorityMode,
      };
    }
    assessments.set(assessment.sliceId, assessment);
  }
  if (ordered.length > 0 && ordered.every((slice) => assessments.has(slice.id))) {
    priorityMode = "value-per-effort";
    const canonicalOrder = new Map(ordered.map((slice, index) => [slice.id, index]));
    ordered = [...ordered].sort((left, right) =>
      safetyTier(left) - safetyTier(right) ||
      valueScore(assessments.get(right.id)!) - valueScore(assessments.get(left.id)!) ||
      canonicalOrder.get(left.id)! - canonicalOrder.get(right.id)!);
  }
  const eligible = ordered.filter((slice) => {
    const reasons: string[] = [];
    if (slice.id.startsWith("S") && activeProducts >= policy.limits.productWip) {
      reasons.push("capacity:productWip");
    }
    if (slice.ownerAgent === "builder" && activeBuilders >= policy.limits.builders) {
      reasons.push("capacity:builders");
    }
    if (reasons.length > 0) blocked.push({ sliceId: slice.id, reasons });
    return reasons.length === 0;
  });

  if (ordered.length > 0 && eligible.length === 0) {
    return {
      selected: null,
      ready: ordered.map((slice) => slice.id),
      blocked,
      reason: "WIP_OR_BUILDER_LIMIT_REACHED",
      priorityMode,
    };
  }
  return {
    selected: eligible[0] ?? null,
    ready: ordered.map((slice) => slice.id),
    blocked,
    reason: eligible.length > 0 ? "NEXT_DEPENDENCY_READY_SLICE" : "NO_READY_SLICE",
    priorityMode,
  };
}