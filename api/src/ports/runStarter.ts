import type { RunRecord } from './runStore';

/**
 * Kicks off (and cancels) server-side generation for a run. The production adapter starts a
 * **Durable Functions** orchestration that owns the agent loop and survives client disconnects;
 * unit tests inject a fake. Returns the orchestration instance id so the run can be queried or
 * terminated later.
 */
export interface RunStarter {
  start(run: RunRecord): Promise<{ instanceId: string }>;
  cancel(run: RunRecord): Promise<void>;
}
