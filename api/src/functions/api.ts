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
  methods: ['GET', 'POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'threads/{id}/lock',
  handler: methodDispatch(
    { GET: (c) => c.threadLock.get, POST: (c) => c.threadLock.acquire, DELETE: (c) => c.threadLock.release },
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

// AI proxies (dictation / voice) — forward to Azure OpenAI with the user's vault key.
app.http('ai-transcribe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ai/transcribe',
  handler: methodDispatch({ POST: (c) => c.aiProxy.transcribe }, invited),
});

app.http('ai-speech', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ai/speech',
  handler: methodDispatch({ POST: (c) => c.aiProxy.speak }, invited),
});

app.http('ai-chat', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ai/chat',
  handler: methodDispatch({ POST: (c) => c.aiProxy.chat }, invited),
});

app.http('ai-image', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ai/image',
  handler: methodDispatch({ POST: (c) => c.aiProxy.image }, invited),
});

// Image studio: server-authoritative image generation (queue worker) + CRUD + search.
app.http('images', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'images',
  handler: methodDispatch({ GET: (c) => c.images.list, POST: (c) => c.images.create }, invited),
});

app.http('memory', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'memory',
  handler: methodDispatch({ GET: (c) => c.memory.list, POST: (c) => c.memory.create }, invited),
});

app.http('memory-item', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'memory/{memoryId}',
  handler: methodDispatch({ PATCH: (c) => c.memory.patch, DELETE: (c) => c.memory.remove }, invited),
});

app.http('memory-summary', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'memory/summary',
  handler: methodDispatch({ GET: (c) => c.memory.getSummary, PUT: (c) => c.memory.putSummary }, invited),
});

app.http('memory-profile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'memory/profile',
  handler: methodDispatch({ GET: (c) => c.memory.profile }, invited),
});

app.http('memory-export', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'memory/export',
  handler: methodDispatch({ POST: (c) => c.memory.export }, invited),
});

app.http('memory-import', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'memory/import',
  handler: methodDispatch({ POST: (c) => c.memory.import }, invited),
});

app.http('memory-rebuild', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'memory/rebuild',
  handler: methodDispatch({ POST: (c) => c.memory.rebuild }, invited),
});

app.http('image-item', {
  methods: ['GET', 'DELETE'],
  authLevel: 'anonymous',
  route: 'images/{id}',
  handler: methodDispatch({ GET: (c) => c.images.get, DELETE: (c) => c.images.remove }, invited),
});

app.http('messages', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'threads/{threadId}/messages',
  handler: methodDispatch({ GET: (c) => c.messages.list, POST: (c) => c.messages.append }, invited),
});

// Thread knowledge base: upload/list documents (POST/GET) and remove one (DELETE) for file search.
app.http('thread-files', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'threads/{id}/files',
  handler: methodDispatch({ GET: (c) => c.threadFiles.list, POST: (c) => c.threadFiles.upload }, invited),
});

app.http('thread-file-item', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'threads/{id}/files/{fileId}',
  handler: methodDispatch({ DELETE: (c) => c.threadFiles.remove }, invited),
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

// Agent Skills — user-scoped catalog (default toggles + uploaded skills, full CRUD).
app.http('skills', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'skills',
  handler: methodDispatch({ GET: (c) => c.skills.list, POST: (c) => c.skills.create }, invited),
});

app.http('skill-item', {
  methods: ['GET', 'PUT', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'skills/{id}',
  handler: methodDispatch(
    {
      GET: (c) => c.skills.get,
      PUT: (c) => c.skills.replace,
      PATCH: (c) => c.skills.setEnabled,
      DELETE: (c) => c.skills.remove,
    },
    invited,
  ),
});

app.http('skill-download', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'skills/{id}/download',
  handler: methodDispatch({ GET: (c) => c.skills.download }, invited),
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

// Admin-only server config: the model used for background memory extraction.
app.http('admin-memory-model', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'admin/memory-model',
  handler: methodDispatch({ GET: (c) => c.adminConfig.getMemoryModel, PUT: (c) => c.adminConfig.setMemoryModel }, admin),
});
