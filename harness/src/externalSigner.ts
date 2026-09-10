import { spawnSync } from "node:child_process";

import type { ProviderUsageReceiptIssuer } from "./copilotExecution.js";
import type { ProviderUsageReceipt } from "./executionCoordinator.js";
import type { LiveModelObservationSigner } from "./liveModelExecutor.js";
import type { LiveModelRunObservation } from "./modelEvaluation.js";
import { canonical } from "./trust.js";
import type { WorkerIsolationAttestation } from "./worker.js";
import type { UnsignedWorkerIsolationAttestation } from "./workerIsolationProbe.js";

export interface ExternalSignerCommand {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  environment?: Record<string, string>;
}

export class ExternalSignerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ExternalSignerError";
  }
}

export class CommandArtifactSigner implements ProviderUsageReceiptIssuer, LiveModelObservationSigner {
  constructor(private readonly command: ExternalSignerCommand) {}

  private execute<T>(kind: "provider-usage-receipt" | "model-evaluation-observation" | "worker-isolation-attestation", payload: unknown): T {
    const result = spawnSync(this.command.executable, this.command.args, {
      cwd: this.command.cwd,
      input: `${JSON.stringify({ kind, payload })}\n`,
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
      throw new ExternalSignerError(
        "EXTERNAL_SIGNER_FAILED",
        (result.stderr || result.error?.message || "External signer failed.").slice(0, 4000),
      );
    }
    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      throw new ExternalSignerError("EXTERNAL_SIGNER_OUTPUT_INVALID", "External signer did not return one JSON artifact.");
    }
  }

  async issue(input: Parameters<ProviderUsageReceiptIssuer["issue"]>[0]): Promise<ProviderUsageReceipt> {
    const receipt = this.execute<ProviderUsageReceipt>("provider-usage-receipt", input);
    if (
      receipt.runId !== input.runId ||
      receipt.effectId !== input.effectId ||
      receipt.reservationId !== input.reservationId ||
      receipt.providerId !== input.providerId ||
      receipt.model !== input.requestedModel
    ) {
      throw new ExternalSignerError("EXTERNAL_SIGNER_BINDING_INVALID", "Signed usage receipt changed its requested identity.");
    }
    return receipt;
  }

  async sign(
    observation: Omit<LiveModelRunObservation, "producerIdentity" | "issuedAt" | "expiresAt" | "signature">,
  ): Promise<LiveModelRunObservation> {
    const signed = this.execute<LiveModelRunObservation>("model-evaluation-observation", observation);
    const { producerIdentity: _producer, issuedAt: _issued, expiresAt: _expires, signature: _signature, ...payload } = signed;
    if (canonical(payload) !== canonical(observation)) {
      throw new ExternalSignerError("EXTERNAL_SIGNER_BINDING_INVALID", "Signed model observation changed its measured payload.");
    }
    return signed;
  }

  async signWorkerIsolation(payload: UnsignedWorkerIsolationAttestation): Promise<WorkerIsolationAttestation> {
    const signed = this.execute<WorkerIsolationAttestation>("worker-isolation-attestation", payload);
    const { issuer: _issuer, issuedAt: _issued, expiresAt: _expires, signature: _signature, ...signedPayload } = signed;
    if (canonical(signedPayload) !== canonical(payload)) {
      throw new ExternalSignerError("EXTERNAL_SIGNER_BINDING_INVALID", "Signed worker isolation changed its measured payload.");
    }
    return signed;
  }
}
