// Normalized AI error taxonomy (ported from the browser `ai/errors.ts`, minus the browser-only
// `errorFromException`). Server-side only: no navigator/DOMException. Used by the Responses API
// client + orchestrator to surface actionable, bounded error messages.

export type AiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'deployment_not_found'
  | 'timeout'
  | 'rate_limited'
  | 'bad_request'
  | 'content_filtered'
  | 'server_error'
  | 'file_search_unavailable'
  | 'tool_unauthorized'
  | 'web_search_disabled'
  | 'tool_unsupported'
  | 'aborted'
  | 'unsupported_capability'
  | 'budget_exceeded';

export type AiCapability =
  | 'chat'
  | 'image'
  | 'transcribe'
  | 'tts'
  | 'web_search'
  | 'code_interpreter'
  | 'file_search';

export interface AiError {
  code: AiErrorCode;
  message: string;
  detail?: string;
  retryAfterMs?: number;
  capability?: AiCapability;
}

export function aiError(code: AiErrorCode, message: string, extra?: Partial<AiError>): AiError {
  return { code, message, ...extra };
}

export function isAiError(e: unknown): e is AiError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

/** Map an HTTP response to a normalized AiError (bounded detail; no raw payload leaks). */
export async function normalizeHttpError(res: Response, capability?: AiCapability): Promise<AiError> {
  let detail: string | undefined;
  let retryAfterMs: number | undefined;
  try {
    const text = await res.text();
    detail = text.slice(0, 600);
    try {
      const json = JSON.parse(text);
      detail = json?.error?.message ?? detail;
    } catch {
      /* not json */
    }
  } catch {
    /* ignore */
  }
  const ra = res.headers.get('retry-after');
  if (ra) retryAfterMs = Number(ra) * 1000;

  let code: AiErrorCode = 'server_error';
  let message = 'Something went wrong.';
  switch (res.status) {
    case 401:
      code = 'unauthorized';
      message = 'Your API key was rejected.';
      break;
    case 403:
      code = 'forbidden';
      message = 'Access denied for this resource.';
      break;
    case 404:
      code = 'deployment_not_found';
      message = 'Model or endpoint not found. Check your deployment names.';
      break;
    case 408:
      code = 'timeout';
      message = 'The request timed out.';
      break;
    case 429:
      code = 'rate_limited';
      message = 'Rate limit reached. Try again shortly.';
      break;
    case 400:
      code = 'bad_request';
      message = 'The request was invalid.';
      if (detail && /content.?filter|content.?policy|moderation|safety system|policy violation/i.test(detail)) {
        code = 'content_filtered';
        message = 'The response was filtered by the content policy.';
      }
      break;
    default:
      if (res.status >= 500) {
        code = 'server_error';
        message = 'The service is temporarily unavailable.';
      }
  }

  // Refine tool-specific failures from the error body (bounded; no raw payload leaks).
  if (detail && (code === 'bad_request' || code === 'forbidden' || code === 'deployment_not_found')) {
    const d = detail.toLowerCase();
    const mentionsTool = /\b(tool|code_interpreter|file_search|web_search)\b|vector.?store/.test(d);
    const notSupported = /not supported|unsupported|not enabled|isn't supported|cannot be used/.test(d);
    if ((res.status === 400 || res.status === 404) && /file_search|vector.?store/.test(d)) {
      code = 'file_search_unavailable';
      message = 'File search needs a Foundry project with vector stores.';
    } else if (res.status === 403 && mentionsTool) {
      code = 'tool_unauthorized';
      message = "Your endpoint isn't allowed to use that tool.";
    } else if (/web_search/.test(d) && notSupported) {
      code = 'web_search_disabled';
      message = "Web search isn't available on this resource.";
    } else if (res.status === 400 && mentionsTool && notSupported) {
      code = 'tool_unsupported';
      message = "This endpoint can't run that tool.";
    }
  }

  return { code, message, detail, retryAfterMs, capability };
}
