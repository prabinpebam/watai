import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { container, type ApiContainer } from '../composition';
import { runRoute, type ControllerHandler } from '../http/azureFunctions';

type Pick = (c: ApiContainer) => ControllerHandler;

/**
 * One Functions registration per route template (Functions v4 disallows duplicate
 * routes), dispatching by HTTP method. authLevel is `anonymous` because authentication
 * is enforced by our own JWT middleware (`runRoute`), not by Functions host keys.
 */
function methodDispatch(map: Record<string, Pick>) {
  return async (request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> => {
    const pick = map[request.method.toUpperCase()];
    if (!pick) {
      return { status: 405, jsonBody: { error: { code: 'not_found', message: 'Method not allowed.' } } };
    }
    const c = container();
    return runRoute(c.verifier, pick(c), request);
  };
}

app.http('threads', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'threads',
  handler: methodDispatch({ GET: (c) => c.threads.list, POST: (c) => c.threads.create }),
});

app.http('thread-item', {
  methods: ['GET', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'threads/{id}',
  handler: methodDispatch({
    GET: (c) => c.threads.get,
    PATCH: (c) => c.threads.patch,
    DELETE: (c) => c.threads.remove,
  }),
});

app.http('messages', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'threads/{threadId}/messages',
  handler: methodDispatch({ GET: (c) => c.messages.list, POST: (c) => c.messages.append }),
});

app.http('settings', {
  methods: ['GET', 'PATCH'],
  authLevel: 'anonymous',
  route: 'settings',
  handler: methodDispatch({ GET: (c) => c.settings.get, PATCH: (c) => c.settings.patch }),
});

app.http('assets-sas', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'assets/sas',
  handler: methodDispatch({ POST: (c) => c.assets.requestSas }),
});
