import { identityFromClaims } from '../auth/identity';
import type { RunService } from '../application/runService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * HTTP boundary for runs. `submit` returns `202` immediately (the client may disconnect);
 * generation continues server-side. `get`/`cancel`/`listActive` track and stop a run. Identity
 * always comes from the validated token claims.
 */
export function createRunsController(runs: RunService) {
  return {
    submit: (req: ApiRequest): Promise<HttpResult> =>
      respond(202, async () => {
        const { userId } = identityFromClaims(req.claims);
        const run = await runs.submit(userId, req.params!.id, req.body);
        return { runId: run.id, assistantMessageId: run.assistantMessageId, status: run.status };
      }),

    get: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return runs.get(userId, req.params!.id, req.params!.runId);
      }),

    cancel: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return runs.cancel(userId, req.params!.id, req.params!.runId);
      }),

    listActive: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return { runs: await runs.listActive(userId, req.params!.id) };
      }),
  };
}
