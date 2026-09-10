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

export interface ScheduleDecision {
  selected: SliceDefinition | null;
  ready: string[];
  blocked: Array<{ sliceId: string; reasons: string[] }>;
  reason: string;
}

const milestoneRank: Record<string, number> = { M0: 0, M1: 1, M2: 2, M3: 3, M4: 4 };
const riskRank: Record<string, number> = { critical: 0, high: 1, medium: 2 };
const terminalStates = new Set(["SHIPPED", "REJECTED", "BLOCKED_SAFE", "CANCELLED", "ROLLED_BACK"]);

export function selectNextSlice(
  backlog: BacklogContract,
  policy: ExecutionPolicy,
  completions: SliceCompletion[],
  activeCandidates: ActiveCandidate[],
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
  const ordered = ready
    .map((slice, index) => ({ slice, index: backlog.slices.indexOf(slice) }))
    .sort((left, right) =>
      (milestoneRank[left.slice.milestone] ?? 99) - (milestoneRank[right.slice.milestone] ?? 99) ||
      (riskRank[left.slice.risk] ?? 99) - (riskRank[right.slice.risk] ?? 99) ||
      left.index - right.index)
    .map((entry) => entry.slice);
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
    };
  }
  return {
    selected: eligible[0] ?? null,
    ready: ordered.map((slice) => slice.id),
    blocked,
    reason: eligible.length > 0 ? "NEXT_DEPENDENCY_READY_SLICE" : "NO_READY_SLICE",
  };
}