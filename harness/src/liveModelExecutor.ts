import type { BudgetAmount } from "./execution.js";
import { spawnSync } from "node:child_process";
import {
  admitLiveModelEvaluation,
  modelUsageEvidenceSha256,
  type LiveModelEvaluationAdmission,
  type LiveModelEvaluationAuthorities,
  type LiveModelEvaluationContract,
  type LiveModelRunObservation,
} from "./modelEvaluation.js";
import {
  gradeModelCase,
  modelCaseDefinitionSha256,
  type ModelCaseArtifact,
  type ModelCaseDefinition,
} from "./modelCases.js";
import { canonical, sha256 } from "./trust.js";

export interface LiveModelAdapterResult {
  status: "completed" | "failed" | "timed-out";
  artifact: ModelCaseArtifact;
  latencyMs: number;
  usage: BudgetAmount;
  responseSha256: string | null;
  resolvedModelVersion: string | null;
  errorCode: string | null;
  qualityDenominator?: LiveModelRunObservation["qualityDenominator"];
  completedAt: string;
}

export interface LiveModelProviderAdapter {
  readonly providerId: string;
  run(input: {
    contract: LiveModelEvaluationContract;
    definition: ModelCaseDefinition;
    repetition: number;
  }): Promise<LiveModelAdapterResult>;
}

export interface LiveModelAdapterCommand {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  environment: Record<string, string>;
}

export class CommandLiveModelProviderAdapter implements LiveModelProviderAdapter {
  constructor(
    readonly providerId: string,
    private readonly command: LiveModelAdapterCommand,
  ) {}

  async run(input: {
    contract: LiveModelEvaluationContract;
    definition: ModelCaseDefinition;
    repetition: number;
  }): Promise<LiveModelAdapterResult> {
    const result = spawnSync(this.command.executable, this.command.args, {
      cwd: this.command.cwd,
      input: `${JSON.stringify(input)}\n`,
      encoding: "utf8",
      timeout: this.command.timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      shell: false,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        ...this.command.environment,
      },
    });
    if (result.error || result.status !== 0) {
      throw new Error((result.stderr || result.error?.message || "Live-model adapter failed.").slice(0, 4000));
    }
    let parsed: LiveModelAdapterResult;
    try {
      parsed = JSON.parse(result.stdout) as LiveModelAdapterResult;
    } catch {
      throw new Error("Live-model adapter did not return one JSON result.");
    }
    const valid =
      ["completed", "failed", "timed-out"].includes(parsed.status) &&
      parsed.artifact?.kind === input.definition.oracle.kind &&
      Number.isFinite(parsed.latencyMs) && parsed.latencyMs >= 0 &&
      Number.isFinite(parsed.usage?.usd) && parsed.usage.usd >= 0 &&
      Number.isSafeInteger(parsed.usage?.inputTokens) && parsed.usage.inputTokens >= 0 &&
      Number.isSafeInteger(parsed.usage?.outputTokens) && parsed.usage.outputTokens >= 0 &&
      Number.isSafeInteger(parsed.usage?.requests) && parsed.usage.requests >= 0 &&
      (parsed.responseSha256 === null || /^[a-f0-9]{64}$/.test(parsed.responseSha256)) &&
      Number.isFinite(Date.parse(parsed.completedAt));
    if (!valid) throw new Error("Live-model adapter result is malformed or misbound.");
    return parsed;
  }
}

export interface LiveModelObservationSigner {
  sign(observation: Omit<LiveModelRunObservation, "producerIdentity" | "issuedAt" | "expiresAt" | "signature">): Promise<LiveModelRunObservation>;
}

export interface LiveModelBudgetPort {
  reserve(input: {
    evaluationId: string;
    worstCase: BudgetAmount;
    expectedRuns: number;
  }): Promise<{ reservationId: string }>;
  settle(reservationId: string, actual: BudgetAmount): Promise<void>;
  markOutcomeUnknown(reservationId: string, reason: string): Promise<void>;
}

export interface ExecuteLiveModelEvaluationInput {
  contract: LiveModelEvaluationContract;
  cases: ModelCaseDefinition[];
  adapter: LiveModelProviderAdapter;
  signer: LiveModelObservationSigner;
  budget: LiveModelBudgetPort;
  authorities: LiveModelEvaluationAuthorities;
  graderSha256: string;
  createRunId(caseId: string, repetition: number): string;
}

function add(left: BudgetAmount, right: BudgetAmount): BudgetAmount {
  return {
    usd: left.usd + right.usd,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    requests: left.requests + right.requests,
  };
}

export async function executeLiveModelEvaluation(
  input: ExecuteLiveModelEvaluationInput,
): Promise<{ observations: LiveModelRunObservation[]; admission: LiveModelEvaluationAdmission }> {
  if (input.adapter.providerId !== input.contract.providerId) {
    throw new Error("Live-model adapter provider does not match the frozen contract.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.graderSha256)) {
    throw new Error("Live-model grader must be bound by SHA-256.");
  }
  const byId = new Map(input.cases.map((definition) => [definition.id, definition]));
  if (
    byId.size !== input.cases.length ||
    input.contract.caseIds.some((caseId) => !byId.has(caseId)) ||
    input.cases.some((definition) => !input.contract.caseIds.includes(definition.id))
  ) {
    throw new Error("Live-model cases do not exactly match the frozen contract.");
  }

  const expectedRuns = input.contract.caseIds.length * input.contract.repetitions;
  const reservation = await input.budget.reserve({
    evaluationId: input.contract.id,
    worstCase: input.contract.budget,
    expectedRuns,
  });
  const observations: LiveModelRunObservation[] = [];
  let actual: BudgetAmount = { usd: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
  try {
    for (const caseId of input.contract.caseIds) {
      const definition = byId.get(caseId)!;
      for (let repetition = 1; repetition <= input.contract.repetitions; repetition += 1) {
        const result = await input.adapter.run({ contract: input.contract, definition, repetition });
        actual = add(actual, result.usage);
        const semanticPass = result.status === "completed" && gradeModelCase(definition, result.artifact);
        const runId = input.createRunId(caseId, repetition);
        const observation = await input.signer.sign({
          evaluationId: input.contract.id,
          runId,
          caseId,
          repetition,
          providerId: input.contract.providerId,
          requestedModel: input.contract.requestedModel,
          resolvedModelVersion: result.resolvedModelVersion,
          status: result.status,
          semanticPass,
          latencyMs: result.latencyMs,
          usage: result.usage,
          usageReceiptSha256: modelUsageEvidenceSha256({
            evaluationId: input.contract.id,
            caseId,
            repetition,
            providerId: input.contract.providerId,
            requestedModel: input.contract.requestedModel,
            resolvedModelVersion: result.resolvedModelVersion,
            usage: result.usage,
            responseSha256: result.responseSha256,
            completedAt: result.completedAt,
          }),
          responseSha256: result.responseSha256,
          caseDefinitionSha256: modelCaseDefinitionSha256(definition),
          graderSha256: input.graderSha256,
          gradedArtifactSha256: sha256(canonical(result.artifact)),
          gradeOutputSha256: sha256(canonical({ semanticPass })),
          errorCode: result.errorCode,
          qualityDenominator: result.qualityDenominator,
          completedAt: result.completedAt,
        });
        observations.push(observation);
      }
    }
    const admission = admitLiveModelEvaluation(input.contract, observations, input.authorities);
    if (admission.outcome !== "PASSED") {
      await input.budget.markOutcomeUnknown(reservation.reservationId, "Live-model admission failed.");
      return { observations, admission };
    }
    await input.budget.settle(reservation.reservationId, actual);
    return { observations, admission };
  } catch (error) {
    await input.budget.markOutcomeUnknown(
      reservation.reservationId,
      error instanceof Error ? error.message : "Live-model execution outcome is unknown.",
    );
    throw error;
  }
}
