import type { LocalPreflightReport } from "./preflight.js";
import type { ReadinessResult } from "./readiness.js";
import type { ScheduleDecision } from "./scheduler.js";

export type DoDStatus = "READY_FOR_EVIDENCE" | "IMPLEMENTED_LOCAL" | "BLOCKED" | "NOT_STARTED";

export interface DoDControl {
  id: string;
  status: DoDStatus;
  implemented: string[];
  blockers: string[];
  next: string;
}

export interface HarnessDoctorReport {
  schemaVersion: "1.0";
  status: "EXECUTION_READY" | "BLOCKED_SAFE";
  generatedAt: string;
  automatedImplementationReady: boolean;
  candidateEvaluationReady: boolean;
  releaseReady: boolean;
  nextSlice: string | null;
  nextSliceReason: string;
  hSlices: DoDControl[];
  gates: DoDControl[];
  blockers: Array<{ code: string; message: string }>;
  releaseBlockers: Array<{ code: string; message: string }>;
  nextActions: string[];
}

export interface DoctorInput {
  generatedAt: string;
  preflight: LocalPreflightReport;
  implementation: ReadinessResult;
  evaluation: ReadinessResult;
  release: ReadinessResult;
  schedule: ScheduleDecision;
  authorityError?: { code: string; message: string };
}

function codes(result: ReadinessResult, prefix?: string): string[] {
  return result.blockers
    .filter((blocker) => !prefix || blocker.code.includes(prefix))
    .map((blocker) => blocker.code);
}

function control(
  id: string,
  status: DoDStatus,
  implemented: string[],
  blockers: string[],
  next: string,
): DoDControl {
  return { id, status, implemented, blockers: [...new Set(blockers)], next };
}

export function buildDoctorReport(input: DoctorInput): HarnessDoctorReport {
  const preflightCodes = input.preflight.blockers.map((blocker) => blocker.code);
  const implementationReady = input.preflight.blockers.length === 0 && input.implementation.ready;
  const evaluationReady = implementationReady && input.evaluation.ready;
  const releaseReady = evaluationReady && input.release.ready;
  const schedulable = input.schedule.selected !== null;
  const hSlices: DoDControl[] = [
    control(
      "H01",
      input.preflight.blockers.length === 0 ? "READY_FOR_EVIDENCE" : "BLOCKED",
      ["local source/toolchain/feed collector", "explicit unknown deployment fields"],
      preflightCodes,
      "Observe deployed source, artifacts, runtime, region, configuration and infrastructure through authorized read-only identity.",
    ),
    control(
      "H02",
      input.implementation.verifiedCapabilities.includes("authorization-root") &&
        input.implementation.verifiedCapabilities.includes("guard-verifier")
        ? "READY_FOR_EVIDENCE"
        : "BLOCKED",
      ["Ed25519 public-root verifier", "external authority loader", "old-root policy floor"],
      codes(input.implementation).filter((code) =>
        code.includes("AUTHORIZATION") || code.includes("authorization-root") || code.includes("guard-verifier")),
      "Provision an owner-controlled external public root and independently signed authorization/authority claims; keep private keys outside the repository.",
    ),
    control(
      "H03",
      input.implementation.ready ? "READY_FOR_EVIDENCE" : "BLOCKED",
      [
        "deterministic transition reducer",
        "TaskSpec compiler and lock",
        "SQLite CAS/outbox/lease/budget store",
        "external exact-SHA worktree manager",
        "manifest-bound gateway service",
        "bounded Copilot create/resume runner",
        "memory-only GitHub token broker",
        "watchdog/provider receipt reconciler",
        "reserve-dispatch-execute-settle coordinator",
        "measured Copilot session usage capture",
      ],
      codes(input.implementation),
      "Independently attest the composed execution path, real implementation-agent evaluation and approved worker image; replace same-host SQLite before release authority.",
    ),
    control(
      "H04",
      input.evaluation.ready ? "READY_FOR_EVIDENCE" : "BLOCKED",
      [
        "candidate evidence admission",
        "fixed evaluator and impact inventories",
        "three complete zero-skip browser runs",
        "zero-skip API unit and isolated integration inventories",
        "hashed local supervisor reports",
        "frozen repeated live-model evaluation contracts",
      ],
      codes(input.evaluation),
      "Run the receipt-backed live-model contracts and move all evaluation into independently signed isolated infrastructure and immutable evidence storage.",
    ),
    control(
      "H05",
      input.release.ready ? "IMPLEMENTED_LOCAL" : "BLOCKED",
      ["release permit transition model only"],
      codes(input.release),
      "Implement immutable staging, versioned queues, release broker, admissible rollback tuple and exact-artifact routing.",
    ),
    control(
      "H06",
      "BLOCKED",
      ["R0 dependency and two-phase permit contracts only"],
      ["H05_NOT_SHIPPED", "S01_NOT_SHIPPED", "S02_NOT_SHIPPED", "S04_NOT_SHIPPED", "S06_NOT_SHIPPED"],
      "After H01-H05 and S01/S02/S04/S06 evidence, establish restricted R0 through independent canary, rollback and observation.",
    ),
  ];

  const gates: DoDControl[] = [
    control("G00", implementationReady ? "READY_FOR_EVIDENCE" : "BLOCKED", ["preflight/readiness logic"], [...preflightCodes, ...codes(input.implementation)], "Pass every machine capability and noninteractive authority probe."),
    control("G01", input.evaluation.ready ? "READY_FOR_EVIDENCE" : "BLOCKED", ["root/signature/binding/DAG verification"], codes(input.evaluation), "Activate independent immutable evidence and protected-path verification."),
    control("G02", input.evaluation.ready ? "READY_FOR_EVIDENCE" : "BLOCKED", ["exact denominator admission"], codes(input.evaluation), "Freeze trusted test inventory and execute full deterministic/browser matrix."),
    control("G03", "NOT_STARTED", [], ["PRODUCT_ISOLATION_EVALUATOR_MISSING"], "Implement owner-collision and same-owner control suites per product slice."),
    control("G04", "NOT_STARTED", [], ["PRIVACY_LIFECYCLE_EVALUATOR_MISSING"], "Implement consent, correction, forgetting, deletion and restore evaluators."),
    control("G05", input.implementation.ready ? "IMPLEMENTED_LOCAL" : "BLOCKED", ["SQLite CAS/outbox/budget", "replay/fencing/watchdog reconciliation"], codes(input.implementation), "Run 100 fault schedules and 1,000 seeded schedules under independent durable-adapter supervision."),
    control("G06", "NOT_STARTED", [], ["MEMORY_EVALUATOR_NOT_FROZEN"], "Complete E01 and shipped-pipeline paired memory evaluation."),
    control("G07", input.evaluation.ready ? "IMPLEMENTED_LOCAL" : "BLOCKED", ["fixed 44-check desktop/mobile/WebKit inventory", "three zero-skip runs"], codes(input.evaluation), "Expand to the remaining DoD accessibility/device cells and independently attest raw reports."),
    control("G08", input.implementation.ready ? "IMPLEMENTED_LOCAL" : "BLOCKED", ["durable local quota reservations", "zero-network tool contract"], codes(input.implementation), "Attest concurrent reservations and content-safe telemetry under isolated execution."),
    control("G09", input.release.ready ? "IMPLEMENTED_LOCAL" : "BLOCKED", ["permit/recovery transitions only"], codes(input.release), "Exercise immutable stage, queue fencing, migration and rollback on exact bytes."),
    control("G10", "NOT_STARTED", [], ["OBSERVATION_PLANE_MISSING"], "Implement staged/cohort/full probe windows and fail-closed monitoring freshness."),
    control("G11", "NOT_STARTED", [], ["PROGRAM_DEPENDENCIES_OPEN", "28_DAY_WINDOW_NOT_STARTED"], "Release every closure slice and complete the final compatible 28-day window."),
    control("G12", input.implementation.verifiedCapabilities.includes("authorization-root") ? "IMPLEMENTED_LOCAL" : "BLOCKED", ["old-root policy floor checks"], codes(input.implementation, "authorization-root"), "Run independent policy-candidate signatures and negative controls under the previous root."),
  ];

  const blockers = [
    ...(input.authorityError ? [input.authorityError] : []),
    ...input.preflight.blockers,
    ...input.implementation.blockers,
    ...input.evaluation.blockers,
  ].filter((value, index, values) =>
    values.findIndex((candidate) => candidate.code === value.code && candidate.message === value.message) === index);
  if (!schedulable) {
    blockers.push({
      code: "NO_READY_SLICE",
      message: "The canonical backlog has no dependency-ready slice.",
    });
  }
  const releaseBlockers = input.release.blockers.filter((value, index, values) =>
    values.findIndex((candidate) => candidate.code === value.code && candidate.message === value.message) === index);
  const nextActions = [
    hSlices.find((item) => item.status === "BLOCKED")?.next,
    "Commit this candidate before attempting source-bound TaskSpec locking.",
    "Start and independently attest the approved Docker worker runtime; do not substitute host-process permissions for isolation.",
    "Provision the external public trust root and signed runtime grant outside the repository.",
  ].filter((value): value is string => Boolean(value));

  const automatedImplementationReady = evaluationReady && blockers.length === 0 && schedulable;
  return {
    schemaVersion: "1.0",
    status: automatedImplementationReady ? "EXECUTION_READY" : "BLOCKED_SAFE",
    generatedAt: input.generatedAt,
    automatedImplementationReady,
    candidateEvaluationReady: input.evaluation.ready,
    releaseReady,
    nextSlice: input.schedule.selected?.id ?? null,
    nextSliceReason: input.schedule.reason,
    hSlices,
    gates,
    blockers,
    releaseBlockers,
    nextActions: [...new Set(nextActions)],
  };
}