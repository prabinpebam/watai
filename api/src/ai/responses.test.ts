import { describe, it, expect } from 'vitest';
import { normalizeResponsesEvent } from './responses';

describe('normalizeResponsesEvent — code interpreter container id', () => {
  it('captures container_id when the code_interpreter_call is added', () => {
    const ev = normalizeResponsesEvent({
      type: 'response.output_item.added',
      item: { type: 'code_interpreter_call', id: 'ci_1', status: 'in_progress', container_id: 'cntr_abc' },
    });
    expect(ev).toEqual({ type: 'serverTool', kind: 'code_interpreter', callId: 'ci_1', status: 'running', containerId: 'cntr_abc' });
  });

  it('captures container_id (and code detail) when the call is done', () => {
    const ev = normalizeResponsesEvent({
      type: 'response.output_item.done',
      item: {
        type: 'code_interpreter_call',
        id: 'ci_1',
        status: 'completed',
        container_id: 'cntr_abc',
        code: "open('/mnt/data/x.pdf','wb')",
        outputs: [{ type: 'logs', logs: 'done' }],
      },
    });
    expect(ev).toMatchObject({ type: 'serverTool', kind: 'code_interpreter', status: 'done', containerId: 'cntr_abc' });
    expect((ev as { detail?: string }).detail).toContain('/mnt/data/x.pdf');
  });

  it('omits containerId for non-code-interpreter server tools', () => {
    const ev = normalizeResponsesEvent({
      type: 'response.output_item.added',
      item: { type: 'web_search_call', id: 'ws_1' },
    });
    expect(ev).toEqual({ type: 'serverTool', kind: 'web_search', callId: 'ws_1', status: 'running' });
  });

  it('still maps text deltas and ignores unknown events', () => {
    expect(normalizeResponsesEvent({ type: 'response.output_text.delta', delta: 'hi' })).toEqual({ type: 'text', delta: 'hi' });
    expect(normalizeResponsesEvent({ type: 'response.something.else' })).toBeNull();
  });

  it('preserves completed response model and token usage', () => {
    expect(normalizeResponsesEvent({
      type: 'response.completed',
      response: {
        id: 'resp-1',
        model: 'gpt-5.4-2026-03-05',
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      },
    })).toEqual({
      type: 'completed',
      responseId: 'resp-1',
      resolvedModelVersion: 'gpt-5.4-2026-03-05',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });
  });

  it('normalizes failed and incomplete response terminals', () => {
    expect(normalizeResponsesEvent({
      type: 'response.failed',
      response: { error: { message: 'provider failed' } },
    })).toEqual({ type: 'error', message: 'provider failed' });
    expect(normalizeResponsesEvent({
      type: 'response.incomplete',
      response: { incomplete_details: { reason: 'max_output_tokens' } },
    })).toEqual({ type: 'error', message: 'The response was incomplete: max_output_tokens' });
    expect(normalizeResponsesEvent({ type: 'error', message: 'generic failure' }))
      .toEqual({ type: 'error', message: 'generic failure' });
  });

  it('rejects a tool item that reaches done event with a failed status', () => {
    expect(normalizeResponsesEvent({
      type: 'response.output_item.done',
      item: { type: 'code_interpreter_call', id: 'ci-failed', status: 'failed' },
    })).toEqual({ type: 'error', message: 'The code_interpreter_call item ended with status failed.' });
  });
});
