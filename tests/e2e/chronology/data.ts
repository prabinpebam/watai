import { DEFAULT_SETTINGS, type Message } from '../../../src/lib/types';
import type { MessageRecord, SubmitRunBody } from '../../../src/data/cloud/types';
import { useUi } from '../../../src/state/store';
import { useRuns } from '../../../src/features/chat/runStore';

const handlers = new Map<string, Set<(payload: unknown) => void>>();
const rows: Message[] = Array.from({ length: 12 }, (_, index) => ({
  id: `history-${index}`, threadId: 'chronology', role: index % 2 ? 'assistant' : 'user',
  content: `Historical turn ${index}. ${'Existing conversation content. '.repeat(10)}`,
  status: 'complete', createdAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * 1000).toISOString(),
}));
let prompt: Message | undefined;
let body: SubmitRunBody | undefined;
let reply: MessageRecord | undefined;
let releaseAppend: (() => void) | undefined;
let releaseStale: (() => void) | undefined;
let releaseAck: (() => void) | undefined;
let holdReads = false;
const readWaiters: Array<(rows: Message[]) => void> = [];
let nextStale = false;
let lastPush = 0;
let skew = -5000;
let ignorePair = false;
let releaseOldPreparation: (() => void) | undefined;
let cancelledRun: Promise<void> | undefined;
const copyRows = () => structuredClone(rows);

export const repo = {
  getSettings: async () => ({ ...DEFAULT_SETTINGS, tools: { ...DEFAULT_SETTINGS.tools, agenticMode: false } }),
  getThread: async () => ({ id: 'chronology', title: 'Chronology check', temporary: false }),
  getThreadLock: async () => null,
  listMessages: async () => {
    if (nextStale) {
      nextStale = false;
      const snapshot = copyRows().filter(row => row.id !== prompt?.id);
      return new Promise<Message[]>(resolve => { releaseStale = () => resolve(snapshot); });
    }
    if (holdReads) return new Promise<Message[]>(resolve => readWaiters.push(resolve));
    return copyRows();
  },
  appendMessage: async (message: Message) => {
    prompt = message;
    return new Promise<void>(resolve => { releaseAppend = () => { rows.push(structuredClone(message)); resolve(); }; });
  },
  getBlobUrl: async () => '',
  listThreads: async () => [],
  createThread: async () => ({ id: 'chronology' }),
};
export const cloudApi = {
  createThread: async () => ({ id: 'chronology' }),
  getCredentialStatus: async () => ({ configured: true, capabilities: {}, models: { chat: 'test' } }),
  submitRun: async (_thread: string, submitted: SubmitRunBody) => {
    body = submitted;
    await new Promise<void>(resolve => { releaseAck = resolve; });
    return { runId: 'chronology-run', assistantMessageId: 'chronology-reply', status: 'queued' };
  },
  listMessages: async () => reply ? [structuredClone(reply)] : [],
  getRun: async () => ({ id: 'chronology-run', status: reply?.status === 'complete' ? 'complete' : 'running' }),
  cancelRun: async () => undefined,
  listThreadFiles: async () => [],
};
export const skillsApi = { list: async () => [] };
export const realtime = {
  ensure: async () => true,
  on: (target: string, callback: (payload: unknown) => void) => {
    const group = handlers.get(target) ?? new Set(); group.add(callback); handlers.set(target, group);
    return () => group.delete(callback);
  },
  liveSince: () => lastPush,
};
export const syncNow = async () => new Set(['chronology']);
export const saveServerMessage = async (message: Message) => {
  const index = rows.findIndex(row => row.id === message.id);
  if (index < 0) rows.push(structuredClone(message)); else rows[index] = structuredClone(message);
};
const kv = { set: async () => undefined, get: async () => undefined, delete: async () => undefined, keys: async () => [] };
export const currentAccountKvStore = () => kv;
export const accountLocalStorageKey = (key: string) => key;

const control = {
  get promptId() { return prompt?.id; },
  get submitted() { return body; },
  get running() { return !!useRuns.getState().runs.chronology; },
  get acknowledged() { return !!useRuns.getState().runs.chronology?.runId; },
  configure(clockSkew: number, negative = false) {
    skew = clockSkew; ignorePair = negative;
    cancelledRun = useRuns.getState().startServerRun('chronology', { text: rows[10].content, clientMessageId: rows[10].id },
      () => new Promise(resolve => { releaseOldPreparation = () => resolve({}); }), rows[10]);
    useRuns.getState().runs.chronology.controller.abort();
    useRuns.setState({ runs: {}, handoffs: {} });
    useUi.getState().setStream({ status: 'idle' });
  },
  async releaseCancelledPreparation() { releaseOldPreparation?.(); await cancelledRun; },
  staleRead() { nextStale = true; useUi.getState().bumpThread('chronology'); },
  releaseAppend() { releaseAppend?.(); },
  releaseStale() { releaseStale?.(); },
  releaseAck() { releaseAck?.(); },
  pushOld() {
    const message = { ...rows[11], userId: 'synthetic' };
    for (const callback of handlers.get('message') ?? []) callback({ threadId: 'chronology', message });
  },
  addPeer() {
    rows.push({ id: 'peer-prompt', threadId: 'chronology', role: 'user', content: 'Later prompt from another device', status: 'complete', createdAt: new Date(Date.parse(body!.messageOrder!.assistant) + 1000).toISOString() });
    useUi.getState().bumpThread('chronology');
  },
  push(content: string, complete = false) {
    const serverTime = new Date(Date.now() + skew).toISOString();
    reply = { id: 'chronology-reply', threadId: 'chronology', userId: 'synthetic', role: 'assistant', content,
      status: complete ? 'complete' : 'streaming', createdAt: serverTime, orderAt: ignorePair ? serverTime : body!.messageOrder!.assistant };
    lastPush = Date.now();
    if (complete) holdReads = true;
    for (const callback of handlers.get('message') ?? []) callback({ threadId: 'chronology', message: structuredClone(reply) });
  },
  releaseReads() { holdReads = false; for (const resolve of readWaiters.splice(0)) resolve(copyRows()); },
};
Object.assign(window, { __chronology: control });