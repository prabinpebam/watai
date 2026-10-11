import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';

/** Anonymous liveness probe — confirms the host is deployed and reachable. */
export async function health(_req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  return {
    status: 200,
    jsonBody: {
      ok: true,
      service: 'watai-api',
      release: 'run-admission-2026-09-29-r1',
      time: new Date().toISOString(),
    },
  };
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: health,
});
