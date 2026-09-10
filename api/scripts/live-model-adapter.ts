import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgent, type AgentEvent, type Turn } from '../src/ai/orchestrator';
import { streamResponses, type ResponsesEvent, type ResponsesTool } from '../src/ai/responses';
import { routeTurn, semanticRouterSystemPrompt, type SemanticAction } from '../src/ai/semanticRouter';

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

interface Request {
  contract: {
    id: string;
    providerId: string;
    requestedModel: string;
    thresholds: { maximumP95LatencyMs: number };
  };
  definition: {
    id: string;
    input: string;
    oracle: { kind: string };
  };
  repetition: number;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
  requests: number;
  usd: number;
  aiCredits: number;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function readStdin(): Promise<string> {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function usageFrom(events: ResponsesEvent[], inputRate: number, outputRate: number, requests: number): Usage {
  const completed = events.filter((event): event is Extract<ResponsesEvent, { type: 'completed' }> => event.type === 'completed');
  const inputTokens = completed.reduce((sum, event) => sum + (event.usage?.inputTokens ?? 0), 0);
  const outputTokens = completed.reduce((sum, event) => sum + (event.usage?.outputTokens ?? 0), 0);
  return {
    inputTokens,
    outputTokens,
    requests,
    usd: (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000,
    aiCredits: 0,
  };
}

function modelFrom(events: ResponsesEvent[]): string | null {
  return events.findLast((event) => event.type === 'completed' && event.resolvedModelVersion)?.resolvedModelVersion ?? null;
}

async function semanticRouting(request: Request, baseUrl: string, key: string, signal: AbortSignal, rates: number[]) {
  const events: ResponsesEvent[] = [];
  let requests = 0;
  const availableActions: SemanticAction[] = ['respond', 'generate_image', 'code_interpreter', 'file_search', 'web_search'];
  const imageIds = request.definition.id.includes('image') ? ['fixture-image'] : [];
  const imageMetadata = imageIds.length ? '\n\n[Uploaded image id="fixture-image" name="fixture.png" reuse_mode=reference]' : '';
  const turns: Turn[] = [
    { role: 'system', text: semanticRouterSystemPrompt(availableActions) },
    { role: 'user', text: request.definition.input + imageMetadata },
  ];
  const startedAt = Date.now();
  let route: Awaited<ReturnType<typeof routeTurn>> = null;
  let thrown: unknown;
  try {
    route = await routeTurn({
      baseUrl,
      key,
      model: request.contract.requestedModel,
      turns,
      availableActions,
      imageIds,
      signal,
      streamFn: async function* (params) {
        requests += 1;
        yield* streamResponses(params);
      },
      observeEvent: (event) => events.push(event),
    });
  } catch (error) {
    thrown = error;
  }
  const completedAt = new Date().toISOString();
  const usage = usageFrom(events, rates[0], rates[1], requests);
  const status = route ? 'completed' as const : signal.aborted ? 'timed-out' as const : 'failed' as const;
  return {
    status,
    artifact: { kind: 'semantic-action' as const, selectedAction: route?.action ?? '' },
    latencyMs: Date.now() - startedAt,
    usage,
    responseSha256: route ? sha256(route) : null,
    resolvedModelVersion: modelFrom(events),
    errorCode: route ? null : signal.aborted ? 'ROUTE_TIMEOUT' : thrown instanceof Error ? thrown.message.slice(0, 200) : 'ROUTE_FAILED',
    completedAt,
  };
}

function toolsFor(caseId: string): ResponsesTool[] {
  if (caseId === 'streamed-markdown' || caseId === 'context-boundary') return [];
  const names = caseId === 'multiple-tools' ? ['fixture_read', 'fixture_second'] :
    caseId === 'tool-failure-recovery' ? ['fixture_fail'] : ['fixture_read'];
  return names.map((name) => ({
    type: 'function',
    name,
    description: `Required deterministic evaluation tool ${name}`,
    strict: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  }));
}

async function responsesBehavior(request: Request, baseUrl: string, key: string, signal: AbortSignal, rates: number[]) {
  const responseEvents: ResponsesEvent[] = [];
  const agentEvents: AgentEvent[] = [];
  const tools = toolsFor(request.definition.id);
  const startedAt = Date.now();
  let requests = 0;
  const streamFn = async function* (params: Parameters<typeof streamResponses>[0]) {
    requests += 1;
    for await (const event of streamResponses(params)) {
      responseEvents.push(event);
      yield event;
    }
  };
  let thrown: unknown;
  try {
    for await (const event of runAgent({
      baseUrl,
      key,
      model: request.contract.requestedModel,
      turns: [{ role: 'user', text: request.definition.input }],
      tools,
      toolChoice: tools.length ? 'required' : 'none',
      requiredToolName: request.definition.id === 'required-tool' ? 'fixture_read' :
        request.definition.id === 'tool-failure-recovery' ? 'fixture_fail' : undefined,
      execute: async (name) => {
        if (name === 'fixture_fail') throw new Error('intentional fixture failure');
        return { output: JSON.stringify({ ok: true, tool: name }) };
      },
      signal,
      streamFn,
    })) agentEvents.push(event);
  } catch (error) {
    thrown = error;
  }
  const text = agentEvents.filter((event): event is Extract<AgentEvent, { type: 'text' }> => event.type === 'text')
    .map((event) => event.delta).join('');
  const eventTypes = [
    ...responseEvents.map((event) => event.type),
    ...agentEvents.filter((event) => event.type === 'error').map(() => 'error'),
  ];
  const usage = usageFrom(responseEvents, rates[0], rates[1], requests);
  const error = agentEvents.find((event): event is Extract<AgentEvent, { type: 'error' }> => event.type === 'error');
  const expectedToolFailure = request.definition.id === 'tool-failure-recovery' && Boolean(error);
  const status = signal.aborted ? 'timed-out' as const : thrown ? 'failed' as const : expectedToolFailure || !error ? 'completed' as const : 'failed' as const;
  const artifact = {
    kind: 'event-contract' as const,
    eventTypes,
    toolCallCount: responseEvents.filter((event) => event.type === 'functionCall').length,
  };
  return {
    status,
    artifact,
    latencyMs: Date.now() - startedAt,
    usage,
    responseSha256: status === 'completed' ? sha256({ text, artifact }) : null,
    resolvedModelVersion: modelFrom(responseEvents),
    errorCode: status === 'completed' ? null : signal.aborted ? 'RESPONSES_TIMEOUT' : thrown instanceof Error ? thrown.message.slice(0, 200) : error?.message ?? 'RESPONSES_FAILED',
    completedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  loadEnv(resolve(here, '../.env'));
  const request = JSON.parse(await readStdin()) as Request;
  if (request.contract.providerId !== 'azure-openai') throw new Error('This adapter accepts only azure-openai contracts.');
  const baseUrl = process.env.WATAI_PROBE_BASEURL?.trim();
  const key = process.env.WATAI_PROBE_KEY?.trim();
  const inputRate = Number(process.env.WATAI_EVAL_INPUT_USD_PER_MILLION);
  const outputRate = Number(process.env.WATAI_EVAL_OUTPUT_USD_PER_MILLION);
  if (!baseUrl || !key) throw new Error('WATAI_PROBE_BASEURL and WATAI_PROBE_KEY are required.');
  if (!Number.isFinite(inputRate) || inputRate < 0 || !Number.isFinite(outputRate) || outputRate < 0) {
    throw new Error('Explicit WATAI_EVAL_INPUT_USD_PER_MILLION and WATAI_EVAL_OUTPUT_USD_PER_MILLION rates are required.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(request.contract.thresholds.maximumP95LatencyMs * 2, 30_000));
  try {
    const result = request.contract.id === 'semantic-routing-live'
      ? await semanticRouting(request, baseUrl, key, controller.signal, [inputRate, outputRate])
      : request.contract.id === 'responses-streaming-tools-live'
        ? await responsesBehavior(request, baseUrl, key, controller.signal, [inputRate, outputRate])
        : (() => { throw new Error(`Unsupported Azure evaluation ${request.contract.id}.`); })();
    process.stdout.write(JSON.stringify(result));
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
