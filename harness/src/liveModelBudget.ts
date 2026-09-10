import type { BudgetReservation } from "./execution.js";
import type { LiveModelBudgetPort } from "./liveModelExecutor.js";
import type { LiveModelBudgetAmount } from "./modelEvaluation.js";
import type { SqliteHarnessStore } from "./sqliteStore.js";

export class SqliteLiveModelBudget implements LiveModelBudgetPort {
  private readonly reservations = new Map<string, { revision: number; evaluationId: string }>();

  constructor(
    private readonly store: SqliteHarnessStore,
    private readonly ledgerRunId: string,
    private readonly executionRunId: string,
    limits: LiveModelBudgetAmount,
  ) {
    this.store.createBudget(ledgerRunId, limits);
  }

  async reserve(input: {
    evaluationId: string;
    worstCase: LiveModelBudgetAmount;
    expectedRuns: number;
  }): Promise<{ reservationId: string }> {
    if (!Number.isSafeInteger(input.expectedRuns) || input.expectedRuns < 1) {
      throw new Error("Live-model expected run denominator must be positive.");
    }
    const current = this.store.readBudget(this.ledgerRunId);
    const reservationId = `${this.executionRunId}:${input.evaluationId}`;
    const reservation: BudgetReservation = {
      reservationId,
      runId: this.ledgerRunId,
      effectId: `model-evaluation:${this.executionRunId}:${input.evaluationId}`,
      fencingEpoch: 1,
      worstCase: input.worstCase,
      status: "reserved",
    };
    const reserved = this.store.reserve(this.ledgerRunId, current.revision, reservation);
    const dispatched = this.store.transitionReservation(
      this.ledgerRunId,
      reserved.revision,
      reservationId,
      "dispatched",
    );
    this.reservations.set(reservationId, { revision: dispatched.revision, evaluationId: input.evaluationId });
    return { reservationId };
  }

  async settle(reservationId: string, actual: LiveModelBudgetAmount): Promise<void> {
    const tracked = this.reservations.get(reservationId);
    if (!tracked) throw new Error(`Unknown live-model reservation ${reservationId}.`);
    const state = this.store.transitionReservation(this.ledgerRunId, tracked.revision, reservationId, "settled", actual);
    tracked.revision = state.revision;
  }

  async markOutcomeUnknown(reservationId: string, _reason: string): Promise<void> {
    const tracked = this.reservations.get(reservationId);
    if (!tracked) throw new Error(`Unknown live-model reservation ${reservationId}.`);
    const state = this.store.transitionReservation(this.ledgerRunId, tracked.revision, reservationId, "outcome-unknown");
    tracked.revision = state.revision;
  }
}
