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
});
