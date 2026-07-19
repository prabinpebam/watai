import {
  streamResponses,
  toInputMessages,
  type ResponsesEvent,
  type ResponsesTool,
} from './responses';
import type { Turn } from './orchestrator';

export const SEMANTIC_ACTIONS = [
  'respond',
  'generate_image',
  'code_interpreter',
  'file_search',
  'web_search',
] as const;

export type SemanticAction = (typeof SEMANTIC_ACTIONS)[number];
export type ImageAction = 'none' | 'generate' | 'edit';

export interface SemanticRoute {
  action: SemanticAction;
  imageAction: ImageAction;
  referenceImageIds: string[];
  rationale: string;
}

export interface RouteTurnParams {
  baseUrl: string;
  key: string;
  model: string;
  turns: Turn[];
  availableActions: SemanticAction[];
  imageIds: string[];
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  streamFn?: (params: Parameters<typeof streamResponses>[0]) => AsyncGenerator<ResponsesEvent>;
}

/**
 * Manager instructions follow the same architecture documented by OpenAI and Anthropic: the model
 * chooses among detailed capability contracts from the complete conversation; application code
 * validates the structured decision and constrains the executor. There is intentionally no keyword
 * list or prompt regex here.
 */
export function semanticRouterSystemPrompt(availableActions: SemanticAction[]): string {
  const capabilities = availableActions
    .map((action) => {
      switch (action) {
        case 'respond':
          return '- respond: answer conversationally, ask a necessary clarifying question, or provide knowledge without performing an external action.';
        case 'generate_image':
          return '- generate_image: create a new visual image or edit/iterate on visual images from this thread. Preserve the established image workflow across follow-up turns unless the user explicitly changes the requested output medium.';
        case 'code_interpreter':
          return '- code_interpreter: calculate, analyze data, or create exact downloadable documents/data files with programmatic layout. Do not select it merely because a visual request mentions layout, dimensions, templates, or files.';
        case 'file_search':
          return '- file_search: retrieve facts from the user’s indexed documents before answering.';
        case 'web_search':
          return '- web_search: retrieve current external information from the web before answering.';
      }
    })
    .join('\n');
  return [
    'You are the routing manager for a tool-using assistant. Read the ENTIRE conversation, including stable image IDs embedded in turn metadata, and choose how the assistant must fulfill the latest user turn.',
    'Resolve references such as “this,” “the previous one,” “use both,” and “make another” from conversation chronology and prior outputs. Route by the user’s intended result and established workflow, not by isolated words. If a prior turn promised an artifact but did not actually produce one, route the action that will produce it now.',
    'Choose exactly one capability. For an image edit or variation, return every relevant image ID from the thread; for a new image, return an empty reference list. Never claim an artifact is complete through respond.',
    `Available capabilities:\n${capabilities}`,
  ].join('\n\n');
}

function routerTool(availableActions: SemanticAction[], imageIds: string[]): ResponsesTool {
  const imageItems = imageIds.length
    ? { type: 'string', enum: imageIds }
    : { type: 'string' };
  return {
    type: 'function',
    name: 'select_action',
    description:
      'Select the single capability required to fulfill the latest user turn after considering the entire conversation. This is a routing decision, not the user-facing answer. Preserve established multi-turn workflows and resolve image references using the stable IDs in the transcript metadata.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: availableActions,
          description: 'The one capability that must handle this turn.',
        },
        image_action: {
          type: 'string',
          enum: ['none', 'generate', 'edit'],
          description: 'Use generate/edit only when action is generate_image; otherwise none.',
        },
        reference_image_ids: {
          type: 'array',
          items: imageItems,
          description:
            'Stable IDs of all earlier uploaded or generated images needed for this image edit/variation, in priority order. Empty for a new image or non-image action.',
        },
        rationale: {
          type: 'string',
          description: 'A brief semantic reason for the route, grounded in the full conversation.',
        },
      },
      required: ['action', 'image_action', 'reference_image_ids', 'rationale'],
      additionalProperties: false,
    },
  };
}

/** Run a forced, structured manager step. Returns null on transport/schema failure so the caller can
 *  degrade to ordinary model tool selection instead of failing the user’s run. */
export async function routeTurn(params: RouteTurnParams): Promise<SemanticRoute | null> {
  const stream = params.streamFn ?? streamResponses;
  const allowed = new Set(params.availableActions);
  const knownImageIds = new Set(params.imageIds);
  for await (const event of stream({
    baseUrl: params.baseUrl,
    key: params.key,
    model: params.model,
    input: toInputMessages(params.turns),
    tools: [routerTool(params.availableActions, params.imageIds)],
    toolChoice: 'required',
    reasoning: { effort: 'minimal' },
    maxOutputTokens: 500,
    headers: params.headers,
    signal: params.signal,
    fetchImpl: params.fetchImpl,
  })) {
    if (event.type === 'error') return null;
    if (event.type !== 'functionCall' || event.name !== 'select_action') continue;
    try {
      const raw = JSON.parse(event.arguments) as {
        action?: unknown;
        image_action?: unknown;
        reference_image_ids?: unknown;
        rationale?: unknown;
      };
      if (typeof raw.action !== 'string' || !allowed.has(raw.action as SemanticAction)) return null;
      const action = raw.action as SemanticAction;
      const imageAction: ImageAction =
        action === 'generate_image' && (raw.image_action === 'generate' || raw.image_action === 'edit')
          ? raw.image_action
          : 'none';
      const referenceImageIds =
        action === 'generate_image' && Array.isArray(raw.reference_image_ids)
          ? [...new Set(raw.reference_image_ids.filter((id): id is string => typeof id === 'string' && knownImageIds.has(id)))]
          : [];
      return {
        action,
        imageAction,
        referenceImageIds,
        rationale: typeof raw.rationale === 'string' ? raw.rationale.slice(0, 500) : '',
      };
    } catch {
      return null;
    }
  }
  return null;
}
