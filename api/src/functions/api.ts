import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { container, type ApiContainer } from '../composition';
import { runRoute, type Authorizer, type ControllerHandler } from '../http/azureFunctions';

type Pick = (c: ApiContainer) => ControllerHandler;
type AuthPick = (c: ApiContainer) => Authorizer;

/** Access gates: data routes require an invite; invite-management routes require the admin. */
const invited: AuthPick = (c) => (claims) => c.access.requireInvited(claims);
const admin: AuthPick = (c) => (claims) => c.access.requireAdmin(claims);

/**
 * One Functions registration per route template (Functions v4 disallows duplicate
 * routes), dispatching by HTTP method. authLevel is `anonymous` because authentication
 * and authorization are enforced by our own middleware (`runRoute`), not Functions keys.
 */
function methodDispatch(map: Record<string, Pick>, authorize?: AuthPick) {
  return async (request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> => {
    const pick = map[request.method.toUpperCase()];
    if (!pick) {
      return { status: 405, jsonBody: { error: { code: 'not_found', message: 'Method not allowed.' } } };
    }
    const c = container();
    return runRoute(c.verifier, pick(c), request, authorize ? authorize(c) : undefined);
  };
}

app.http('threads', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'threads',
  handler: methodDispatch({ GET: (c) => c.threads.list, POST: (c) => c.threads.create }, invited),
});

app.http('thread-item', {
  methods: ['GET', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'threads/{id}',
  handler: methodDispatch(
    {
      GET: (c) => c.threads.get,
      PATCH: (c) => c.threads.patch,
      DELETE: (c) => c.threads.remove,
    },
    invited,
  ),
});

app.http('thread-lock', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'threads/{id}/lock',
  handler: methodDispatch(
    { POST: (c) => c.threadLock.acquire, DELETE: (c) => c.threadLock.release },
    invited,
  ),
});

// Server-side runs: submit a prompt (202 + runId), track, cancel. Generation happens in the
// queue-triggered worker, independently of the client.
app.http('thread-runs', {
  methods: ['POST', 'GET'],
  authLevel: 'anonymous',
  route: 'threads/{id}/runs',
  handler: methodDispatch({ POST: (c) => c.runs.submit, GET: (c) => c.runs.listActive }, invited),
});

app.http('thread-run-item', {
  methods: ['GET', 'DELETE'],
  authLevel: 'anonymous',
  route: 'threads/{id}/runs/{runId}',
  handler: methodDispatch({ GET: (c) => c.runs.get, DELETE: (c) => c.runs.cancel }, invited),
});

// SignalR negotiate — returns the realtime connection info scoped to the caller's user id.
app.http('negotiate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'negotiate',
  handler: methodDispatch({ POST: (c) => c.negotiate.negotiate }, invited),
});

app.http('messages', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'threads/{threadId}/messages',
  handler: methodDispatch({ GET: (c) => c.messages.list, POST: (c) => c.messages.append }, invited),
});

app.http('settings', {
  methods: ['GET', 'PATCH'],
  authLevel: 'anonymous',
  route: 'settings',
  handler: methodDispatch({ GET: (c) => c.settings.get, PATCH: (c) => c.settings.patch }, invited),
});

// Encrypted credential vault — write-only key, non-secret status read-back.
app.http('credentials', {
  methods: ['GET', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'credentials',
  handler: methodDispatch(
    { GET: (c) => c.credentials.get, PUT: (c) => c.credentials.put, DELETE: (c) => c.credentials.remove },
    invited,
  ),
});

app.http('assets-sas', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'assets/sas',
  handler: methodDispatch({ POST: (c) => c.assets.requestSas }, invited),
});

// Caller's access status — requires auth but not an invite (so a non-invited user learns it).
app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: methodDispatch({ GET: (c) => c.me.get }),
});

// Invite management — admin only.
app.http('invites', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'invites',
  handler: methodDispatch({ GET: (c) => c.invites.list, POST: (c) => c.invites.create }, admin),
});

app.http('invite-item', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'invites/{email}',
  handler: methodDispatch({ DELETE: (c) => c.invites.remove }, admin),
});
