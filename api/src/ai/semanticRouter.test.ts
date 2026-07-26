import { describe, expect, it, vi } from 'vitest';
import { routeTurn, semanticRouterSystemPrompt } from './semanticRouter';
import type { ResponsesEvent, ResponsesParams } from './responses';

function events(...items: ResponsesEvent[]): AsyncGenerator<ResponsesEvent> {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

const base = {
  baseUrl: 'https://x.openai.azure.com/openai/v1',
  key: 'k',
  model: 'gpt-5.4',
};

describe('semantic router', () => {
  it('forces a structured manager action using the complete supplied conversation', async () => {
    const streamFn = vi.fn((_params: ResponsesParams) =>
      events(
        { type: 'created', responseId: 'route-1' },
        {
          type: 'functionCall',
          callId: 'route-call',
          name: 'select_action',
          arguments: JSON.stringify({
            action: 'generate_image',
            image_action: 'edit',
            reference_image_ids: ['upload-template', 'generated-character'],
            rationale: 'The latest request continues the established sprite-image workflow.',
          }),
        },
        { type: 'completed' },
      ),
    );
    const turns = [
      { role: 'system' as const, text: semanticRouterSystemPrompt(['respond', 'generate_image', 'code_interpreter']) },
      { role: 'user' as const, text: 'Create a sprite.\n[Uploaded image id=upload-template]' },
      { role: 'assistant' as const, text: 'Done.\n[Generated image id=generated-character]' },
      { role: 'user' as const, text: 'Use this and the previous image to make another.' },
    ];

    const route = await routeTurn({
      ...base,
      turns,
      availableActions: ['respond', 'generate_image', 'code_interpreter'],
      imageIds: ['upload-template', 'generated-character'],
      streamFn,
    });

    expect(route).toEqual({
      action: 'generate_image',
      imageAction: 'edit',
      referenceImageIds: ['upload-template', 'generated-character'],
      rationale: 'The latest request continues the established sprite-image workflow.',
    });
    const request = streamFn.mock.calls[0][0];
    expect(request.toolChoice).toBe('required');
    expect(request.reasoning).toEqual({ effort: 'none' });
    expect(request.maxOutputTokens).toBe(500);
    expect(request.tools).toHaveLength(1);
    expect(request.tools?.[0]).toMatchObject({ type: 'function', name: 'select_action', strict: true });
    expect(request.input).toHaveLength(turns.length);
  });

  it('rejects unknown actions and image ids instead of trusting model output', async () => {
    const invalidAction = await routeTurn({
      ...base,
      turns: [{ role: 'user', text: 'hello' }],
      availableActions: ['respond'],
      imageIds: [],
      streamFn: () => events({
        type: 'functionCall',
        callId: 'c1',
        name: 'select_action',
        arguments: '{"action":"delete_everything","image_action":"none","reference_image_ids":[],"rationale":"x"}',
      }),
    });
    expect(invalidAction).toBeNull();

    const filteredReference = await routeTurn({
      ...base,
      turns: [{ role: 'user', text: 'edit the prior image' }],
      availableActions: ['respond', 'generate_image'],
      imageIds: ['known'],
      streamFn: () => events({
        type: 'functionCall',
        callId: 'c2',
        name: 'select_action',
        arguments: '{"action":"generate_image","image_action":"edit","reference_image_ids":["known","invented"],"rationale":"x"}',
      }),
    });
    expect(filteredReference?.referenceImageIds).toEqual(['known']);
  });

  it('retries with another reasoning effort when the model rejects the requested one', async () => {
    // gpt-5.4 rejects `minimal`; older models reject `none`. A refused effort must not take routing
    // down — otherwise every run silently degrades to automatic tool selection.
    const streamFn = vi.fn((params: ResponsesParams) =>
      params.reasoning?.effort === 'none'
        ? events({ type: 'error', message: "Unsupported value: 'none' is not supported with this model." })
        : events({
            type: 'functionCall',
            callId: 'c3',
            name: 'select_action',
            arguments: '{"action":"generate_image","image_action":"generate","reference_image_ids":[],"rationale":"new image"}',
          }),
    );

    const route = await routeTurn({
      ...base,
      turns: [{ role: 'user', text: 'draw a fox' }],
      availableActions: ['respond', 'generate_image'],
      imageIds: [],
      streamFn,
    });

    expect(route?.action).toBe('generate_image');
    expect(streamFn.mock.calls.map((call) => call[0].reasoning?.effort)).toEqual(['none', 'minimal']);
  });

  it('falls back to omitting reasoning entirely when every effort is refused', async () => {
    const streamFn = vi.fn((params: ResponsesParams) =>
      params.reasoning
        ? events({ type: 'error', message: 'Unsupported value.' })
        : events({
            type: 'functionCall',
            callId: 'c4',
            name: 'select_action',
            arguments: '{"action":"respond","image_action":"none","reference_image_ids":[],"rationale":"chat"}',
          }),
    );

    const route = await routeTurn({
      ...base,
      turns: [{ role: 'user', text: 'hello' }],
      availableActions: ['respond'],
      imageIds: [],
      streamFn,
    });

    expect(route?.action).toBe('respond');
    expect(streamFn.mock.calls).toHaveLength(3);
    expect(streamFn.mock.calls[2][0].reasoning).toBeUndefined();
  });
});
