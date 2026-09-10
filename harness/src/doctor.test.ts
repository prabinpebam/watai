// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildDoctorReport } from "./doctor";
import type { LocalPreflightReport } from "./preflight";
import type { ReadinessResult } from "./readiness";

const readiness = (mode: ReadinessResult["mode"], ready: boolean): ReadinessResult => ({
  mode,
  ready,
  blockers: ready ? [] : [{ code: "CAPABILITY_MISSING:durable-ledger", message: "Missing" }],
  warnings: [],
  verifiedCapabilities: ready ? ["authorization-root", "guard-verifier"] : [],
});

const preflight = (ready: boolean) => ({
  status: ready ? "OBSERVED_LOCAL_COMPLETE" : "OBSERVED_PARTIAL",
  blockers: ready ? [] : [{ code: "DEPLOYED_IDENTITY_INCOMPLETE", message: "Unknown" }],
  observations: [],
} as unknown as LocalPreflightReport);

describe("DoD doctor report", () => {
  it("reports H01 as the next blocked slice on the current bootstrap state", () => {
    const report = buildDoctorReport({
      generatedAt: "2026-09-10T11:00:00.000Z",
      preflight: preflight(false),
      implementation: readiness("implementation", false),
      evaluation: readiness("evaluation", false),
      release: readiness("release", false),
      schedule: { selected: { id: "H01" } as never, ready: ["H01"], blocked: [], reason: "NEXT_DEPENDENCY_READY_SLICE", priorityMode: "canonical" },
    });
    expect(report.status).toBe("BLOCKED_SAFE");
    expect(report.nextSlice).toBe("H01");
    expect(report.hSlices.find((item) => item.id === "H01")?.status).toBe("BLOCKED");
  });

  it("requires both implementation and evaluation readiness for automated implementation", () => {
    const report = buildDoctorReport({
      generatedAt: "2026-09-10T11:00:00.000Z",
      preflight: preflight(true),
      implementation: readiness("implementation", true),
      evaluation: readiness("evaluation", false),
      release: readiness("release", false),
      schedule: { selected: null, ready: [], blocked: [], reason: "NO_READY_SLICE", priorityMode: "canonical" },
    });
    expect(report.automatedImplementationReady).toBe(false);
    expect(report.candidateEvaluationReady).toBe(false);
  });

  it("blocks otherwise-ready inputs when authority claims were rejected", () => {
    const report = buildDoctorReport({
      generatedAt: "2026-09-10T11:00:00.000Z",
      preflight: preflight(true),
      implementation: readiness("implementation", true),
      evaluation: readiness("evaluation", true),
      release: readiness("release", false),
      schedule: { selected: { id: "H01" } as never, ready: ["H01"], blocked: [], reason: "NEXT_DEPENDENCY_READY_SLICE", priorityMode: "canonical" },
      authorityError: { code: "AUTHORITY_CLAIMS_REJECTED", message: "Rejected" },
    });
    expect(report.status).toBe("BLOCKED_SAFE");
    expect(report.automatedImplementationReady).toBe(false);
  });

  it("blocks otherwise-ready inputs when no dependency-ready slice exists", () => {
    const report = buildDoctorReport({
      generatedAt: "2026-09-10T11:00:00.000Z",
      preflight: preflight(true),
      implementation: readiness("implementation", true),
      evaluation: readiness("evaluation", true),
      release: readiness("release", false),
      schedule: { selected: null, ready: [], blocked: [], reason: "NO_READY_SLICE", priorityMode: "canonical" },
    });
    expect(report.status).toBe("BLOCKED_SAFE");
    expect(report.automatedImplementationReady).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toContain("NO_READY_SLICE");
  });
});