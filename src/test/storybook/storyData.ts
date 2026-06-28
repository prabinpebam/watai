import { cloudApi, repo, realtime, skillsApi } from '../../data';
import { clearMe } from '../../auth/access';
import { DEFAULT_SETTINGS, type Artifact, type Attachment, type ImageRef, type Message, type Settings, type SkillDetail, type SkillSummary, type Thread, type ThreadFile, type ThreadLock } from '../../lib/types';
import type { AppendMessageBody, CreateImagesBody, CreateMemoryBody, CreateThreadBody, CredentialStatus, ImageRecord, InviteRecord, ListImagesQuery, ListImagesResult, ListMemoryQuery, ListMemoryResponse, MemoryProfileView, MemoryRecord, MessageRecord, PatchMemoryBody, RunRecord, SasRequestBody, SasResult, StudioImage, SubmitRunBody, SubmitRunResult, ThreadRecord, UpdateThreadBody } from '../../data/cloud/types';

const now = new Date('2026-06-28T08:00:00.000Z').getTime();
const iso = (offsetMs = 0) => new Date(now + offsetMs).toISOString();

const svgUrl = (label: string, fill = 'black') =>
  `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220"><rect width="320" height="220" fill="${encodeURIComponent(fill)}"/><text x="160" y="118" text-anchor="middle" font-size="26" fill="white">${encodeURIComponent(label)}</text></svg>`;

const threadFiles: ThreadFile[] = [
  { fileId: 'doc1', name: 'source-notes.pdf', bytes: 184000, status: 'ready', createdAt: iso(-300000), kind: 'document', blobPath: 'story/source-notes.pdf', mime: 'application/pdf' },
  { fileId: 'artifact1', name: 'worksheet.pdf', bytes: 32000, status: 'ready', createdAt: iso(-240000), kind: 'artifact', blobPath: 'story/worksheet.pdf', mime: 'application/pdf' },
];

const generatedImages: ImageRef[] = [
  { id: 'img-a', blobPath: svgUrl('A'), prompt: 'A compact generated preview with a carefully bounded prompt that can expand when the user wants to inspect the full generation request.', size: '1024x1024', outputFormat: 'png', createdAt: iso(-120000) },
  { id: 'img-b', blobPath: svgUrl('B', '#2f6feb'), prompt: 'Second generated image in the thread.', size: '1024x1024', outputFormat: 'png', createdAt: iso(-90000) },
];

const pdfAttachment: Attachment = {
  id: 'p1',
  kind: 'file',
  mime: 'application/pdf',
  bytes: 32000,
  name: 'worksheet.pdf',
  blobPath: 'data:application/pdf;base64,JVBERi0xLjQKJQ==',
};

const pdfArtifact: Artifact = {
  id: 'art1',
  name: 'worksheet.pdf',
  mime: 'application/pdf',
  kind: 'pdf',
  bytes: 32000,
  blobPath: 'data:application/pdf;base64,JVBERi0xLjQKJQ==',
  createdAt: iso(-60000),
};

let threads: Thread[] = [];
let messages: Message[] = [];
let settings: Settings = DEFAULT_SETTINGS;
let memory: MemoryRecord[] = [];
let invites: InviteRecord[] = [];
let studioImages: StudioImage[] = [];
let blobs = new Map<string, Blob>();

function resetState(): void {
  threads = [
    { id: 'story-thread', title: 'PDF worksheet draft', pinned: true, archived: false, temporary: false, createdAt: iso(-7200000), updatedAt: iso(-60000), messageCount: 10, lastMessagePreview: 'The final worksheet PDF is attached.', files: threadFiles },
    { id: 'story-research', title: 'Research sources for lesson plan', pinned: false, archived: false, temporary: false, createdAt: iso(-172800000), updatedAt: iso(-3600000), messageCount: 8, lastMessagePreview: 'Finding high-quality references.' },
    { id: 'story-images', title: 'Image prompts for story cards', pinned: false, archived: false, temporary: false, createdAt: iso(-604800000), updatedAt: iso(-86400000), messageCount: 5, lastMessagePreview: 'Use a bright editorial style.' },
  ];
  messages = [
    { id: 'u1', threadId: 'story-thread', role: 'user', content: '/pdf Create a worksheet from this file', status: 'complete', attachments: [pdfAttachment], createdAt: iso(-600000) },
    { id: 'a1', threadId: 'story-thread', role: 'assistant', content: 'Done — the PDF is ready as an attachment below.\n\n'.repeat(8), status: 'complete', artifacts: [pdfArtifact], toolCalls: [{ id: 'w1', kind: 'web_search', name: 'web_search', status: 'done', summary: 'Search sources' }, { id: 'c1', kind: 'code_interpreter', name: 'code_interpreter', status: 'done', summary: 'Create PDF', resultPreview: 'wrote /mnt/data/worksheet.pdf', artifactIds: ['art1'] }], createdAt: iso(-540000) },
    { id: 'u2', threadId: 'story-thread', role: 'user', content: 'Now create two image concepts for the worksheet cover with a friendly classroom style.', status: 'complete', createdAt: iso(-480000) },
    { id: 'a2', threadId: 'story-thread', role: 'assistant', content: '', status: 'complete', images: generatedImages, createdAt: iso(-420000) },
    { id: 'u3', threadId: 'story-thread', role: 'user', content: 'Revise the design direction so the images feel less busy and more suitable for printing.', status: 'complete', createdAt: iso(-360000) },
    { id: 'a3', threadId: 'story-thread', role: 'assistant', content: 'I would simplify the background, keep the type large, and reserve color for headings and icon accents.\n\n'.repeat(10), status: 'complete', createdAt: iso(-300000) },
    { id: 'u4', threadId: 'story-thread', role: 'user', content: 'Make a short checklist of what still needs review before I send this to parents.', status: 'complete', createdAt: iso(-240000) },
    { id: 'a4', threadId: 'story-thread', role: 'assistant', content: 'Review print margins, reading level, answer key alignment, and whether every image has enough contrast.\n\n'.repeat(9), status: 'complete', createdAt: iso(-180000) },
    { id: 'u5', threadId: 'story-thread', role: 'user', content: 'Summarize the final plan in one paragraph and mention the files attached in this chat.', status: 'complete', createdAt: iso(-120000) },
    { id: 'a5', threadId: 'story-thread', role: 'assistant', content: 'The final plan is to ship a print-ready worksheet with a calm cover, clear activities, and the generated PDF attached in this chat.', status: 'complete', createdAt: iso(-60000) },
  ];
  for (let i = 6; i <= 54; i++) {
    messages.push(
      {
        id: `u${i}`,
        threadId: 'story-thread',
        role: 'user',
        content: `Follow-up prompt ${i}: refine one small part of the worksheet plan and keep the explanation concise.`,
        status: 'complete',
        createdAt: iso(i * 60000),
      },
      {
        id: `a${i}`,
        threadId: 'story-thread',
        role: 'assistant',
        content: `Refinement ${i}: keep the layout calm, scannable, and print friendly.\n\n`,
        status: 'complete',
        createdAt: iso(i * 60000 + 30000),
      },
    );
  }
  threads[0] = { ...threads[0], messageCount: messages.filter((message) => message.threadId === 'story-thread').length };
  settings = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' } };
  memory = [];
  invites = [{ email: 'friend@example.com', invitedBy: 'admin@example.com', createdAt: iso(-3600000) }];
  studioImages = generatedImages.map((image, index) => ({ id: image.id, userId: 'story-user', batchId: 'story-batch', status: 'ready', prompt: image.prompt, size: image.size, outputFormat: image.outputFormat, model: 'gpt-image-2', blobPath: image.blobPath, url: image.blobPath, createdAt: image.createdAt, updatedAt: image.createdAt, quality: index === 0 ? 'medium' : 'high' }));
  blobs = new Map();
}

function threadRecord(thread: Thread): ThreadRecord {
  return { id: thread.id, userId: 'story-user', title: thread.title, pinned: thread.pinned, archived: thread.archived, temporary: thread.temporary, messageCount: thread.messageCount, createdAt: thread.createdAt, updatedAt: thread.updatedAt, deletedAt: thread.deletedAt ?? null, ...(thread.lastMessagePreview ? { lastMessagePreview: thread.lastMessagePreview } : {}), ...(thread.files ? { files: thread.files } : {}) };
}

function messageRecord(message: Message): MessageRecord {
  return { id: message.id, threadId: message.threadId, userId: 'story-user', role: message.role, content: message.content, status: message.status === 'sending' ? 'complete' : message.status, createdAt: message.createdAt, orderAt: message.createdAt, deletedAt: null, ...(message.images ? { images: message.images.map((image): ImageRecord => ({ id: image.id, blobPath: image.blobPath ?? image.localBlobKey ?? '', prompt: image.prompt, size: image.size, outputFormat: image.outputFormat, createdAt: image.createdAt })) } : {}), ...(message.attachments ? { attachments: message.attachments.filter((attachment) => attachment.blobPath).map((attachment) => ({ id: attachment.id, kind: attachment.kind, blobPath: attachment.blobPath!, mime: attachment.mime, bytes: attachment.bytes, ...(attachment.name ? { name: attachment.name } : {}) })) } : {}), ...(message.toolCalls ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall, status: toolCall.status === 'awaiting-confirm' ? 'running' : toolCall.status })) } : {}), ...(message.citations ? { citations: message.citations.map((citation) => ({ ...citation })) } : {}), ...(message.memoryRefs ? { memoryRefs: message.memoryRefs.map((memoryRef) => ({ ...memoryRef })) } : {}) };
}

function assetUrl(asset: { id: string; localBlobKey?: string; blobPath?: string }): string {
  if (asset.blobPath && /^(data:|blob:|https?:)/.test(asset.blobPath)) return asset.blobPath;
  if (asset.localBlobKey && blobs.has(asset.localBlobKey)) return URL.createObjectURL(blobs.get(asset.localBlobKey)!);
  return svgUrl(asset.id, '#34343b');
}

function storyMemoryProfile(): MemoryProfileView {
  return {
    schemaVersion: 1,
    userId: 'story-user',
    updatedAt: iso(),
    evidenceCount: Math.max(1, memory.length),
    profile: {
      user: {
        details: {},
        family: { spouse: [], children: [], pets: [{ name: 'Chopper', species: 'dog', inspiredBy: ['One Piece'], sourceMemoryIds: ['story-memory-pet'], confidence: 0.9 }] },
        preferences: { communication: [], engineering: [], design: [], tools: [], other: [] },
        interests: { media: [{ name: 'One Piece', sourceMemoryIds: ['story-memory-pet'] }], hobbies: [], other: [] },
      },
      work: { projects: [], repositories: [], deployments: [], currentFocus: [] },
      avoidances: [],
    },
    temporal: { today: { items: [] }, week: { items: [] }, month: { items: [] } },
  };
}

const credentialStatus: CredentialStatus = {
  configured: true,
  baseUrl: 'https://story-resource.openai.azure.com/openai/v1',
  models: { chat: 'gpt-5.4', chatOptions: ['model-router', 'gpt-5.4', 'gpt-4.1'], image: 'gpt-image-2', transcribe: 'gpt-4o-transcribe', tts: 'gpt-4o-mini-tts' },
  keyHint: '1234',
  tavilyConfigured: true,
  tavilyHint: 'abcd',
  capabilities: { chat: true, image: true, transcribe: true, tts: true, agentic: true, codeInterpreter: true, fileSearch: true, webSearch: true },
};

const storySkills: SkillSummary[] = [
  { id: 'pdf', name: 'PDF Agent', description: 'Create, fill, inspect, and repair PDF documents from user instructions.', source: 'default', version: 2, enabled: true, status: 'ready', fileCount: 11 },
  { id: 'invoice-writer', name: 'Invoice Writer', description: 'Draft polished invoices from notes, line items, and uploaded evidence.', source: 'user', version: 1, enabled: true, status: 'ready', bytes: 284672, fileCount: 5 },
  { id: 'legacy-tax', name: 'Legacy Tax Helper', description: 'Missing required SKILL.md frontmatter.', source: 'user', version: 1, enabled: false, status: 'invalid', error: 'Missing required description field.', bytes: 92160, fileCount: 3 },
];

const storySkillDetail: SkillDetail = { ...storySkills[0], license: 'MIT', files: [{ path: 'SKILL.md', bytes: 6048 }, { path: 'scripts/create_pdf.py', bytes: 12840 }, { path: 'references/pdf_forms.md', bytes: 8044 }], body: '# PDF Agent\n\nUse this skill when the user asks to create, fill, inspect, or repair PDF files.' };

export function installStoryData(): void {
  resetState();
  clearMe();
  Object.assign(repo, {
    listThreads: async () => threads,
    getThread: async (id: string) => threads.find((thread) => thread.id === id) ?? null,
    createThread: async (init?: Partial<Thread>) => {
      const thread: Thread = { id: init?.id ?? `story-${threads.length + 1}`, title: init?.title ?? 'New chat', pinned: false, archived: false, temporary: init?.temporary ?? false, createdAt: iso(), updatedAt: iso(), messageCount: 0, ...init };
      threads = [thread, ...threads];
      return thread;
    },
    updateThread: async (id: string, patch: Partial<Thread>) => {
      const current = threads.find((thread) => thread.id === id) ?? threads[0];
      const next = { ...current, ...patch, updatedAt: patch.updatedAt ?? iso() };
      threads = threads.map((thread) => (thread.id === id ? next : thread));
      return next;
    },
    deleteThread: async (id: string) => {
      threads = threads.filter((thread) => thread.id !== id);
      messages = messages.filter((message) => message.threadId !== id);
    },
    listMessages: async (threadId: string) => messages.filter((message) => message.threadId === threadId),
    appendMessage: async (message: Message) => {
      messages = [...messages, message];
      return message;
    },
    updateMessage: async (id: string, patch: Partial<Message>) => {
      const current = messages.find((message) => message.id === id)!;
      const next = { ...current, ...patch };
      messages = messages.map((message) => (message.id === id ? next : message));
      return next;
    },
    deleteMessage: async (id: string) => {
      messages = messages.filter((message) => message.id !== id);
    },
    acquireRunLock: async () => ({ acquired: true }),
    releaseRunLock: async () => undefined,
    getThreadLock: async (): Promise<ThreadLock | null> => null,
    putBlob: async (key: string, blob: Blob) => {
      blobs.set(key, blob);
    },
    getBlob: async (key: string) => blobs.get(key) ?? null,
    getBlobUrl: async (key: string) => (blobs.has(key) ? URL.createObjectURL(blobs.get(key)!) : ''),
    resolveAssetUrl: async (asset: { id: string; localBlobKey?: string; blobPath?: string }) => assetUrl(asset),
    resolveImageUrl: async (image: ImageRef) => assetUrl(image),
    getSettings: async () => settings,
    saveSettings: async (next: Settings) => {
      settings = next;
    },
    listMemory: async (query?: ListMemoryQuery) => memory.filter((item) => (query?.status ? item.status === query.status : item.status === 'active')),
    getMemoryProfile: async () => storyMemoryProfile(),
    addMemory: async (input: CreateMemoryBody) => {
      const item: MemoryRecord = {
        id: `story-memory-${memory.length + 1}`,
        userId: 'story-user',
        kind: input.kind ?? 'fact',
        status: 'active',
        text: input.text,
        sourceRefs: [input.sourceRef ?? { type: 'manual', createdAt: iso() }],
        confidence: 1,
        salience: 0.7,
        pinned: input.pinned ?? false,
        sensitive: false,
        visibility: input.visibility ?? 'normal',
        createdAt: iso(),
        updatedAt: iso(),
        useCount: 0,
      };
      memory = [item, ...memory];
      return item;
    },
    updateMemory: async (id: string, patch: PatchMemoryBody) => {
      const current = memory.find((item) => item.id === id) ?? memory[0];
      const next = { ...current, ...patch, updatedAt: iso() } as MemoryRecord;
      memory = memory.map((item) => (item.id === id ? next : item));
      return next;
    },
    removeMemory: async (id: string) => {
      memory = memory.map((item) => (item.id === id ? { ...item, status: 'deleted', deletedAt: iso(), updatedAt: iso() } : item));
    },
    search: async (query: string) => (query.trim() ? messages.slice(0, 2).map((message) => ({ thread: threads.find((thread) => thread.id === message.threadId) ?? threads[0], messageId: message.id, snippet: message.content || 'Generated image result.' })) : []),
    exportAll: async () => new Blob([JSON.stringify({ threads, messages, settings }, null, 2)], { type: 'application/json' }),
    deleteAll: async () => {
      threads = [];
      messages = [];
    },
  });

  Object.assign(cloudApi, {
    listThreads: async () => threads.map(threadRecord),
    getThread: async (id: string) => threadRecord(threads.find((thread) => thread.id === id) ?? threads[0]),
    createThread: async (body: CreateThreadBody) => threadRecord(await repo.createThread({ id: body.id, title: body.title, temporary: body.temporary })),
    updateThread: async (id: string, body: UpdateThreadBody) => threadRecord(await repo.updateThread(id, body)),
    deleteThread: async (id: string) => repo.deleteThread(id),
    listMessages: async (threadId: string) => messages.filter((message) => message.threadId === threadId).map(messageRecord),
    appendMessage: async (threadId: string, body: AppendMessageBody) => messageRecord({ id: body.id ?? `m-${messages.length + 1}`, threadId, role: body.role, content: body.content, status: 'complete', createdAt: iso(), images: body.images, attachments: body.attachments, toolCalls: body.toolCalls }),
    acquireThreadLock: async (threadId: string) => ({ thread: threadRecord(threads.find((thread) => thread.id === threadId) ?? threads[0]), lock: { deviceId: 'storybook', deviceLabel: 'Storybook', acquiredAt: iso(), heartbeatAt: iso() } }),
    getThreadLock: async () => null,
    releaseThreadLock: async () => undefined,
    getSettings: async () => settings,
    patchSettings: async (patch: Partial<Settings>) => (settings = { ...settings, ...patch }),
    listMemory: async (query?: ListMemoryQuery): Promise<ListMemoryResponse> => ({ memories: await repo.listMemory(query) }),
    getMemoryProfile: async () => repo.getMemoryProfile(),
    createMemory: async (body: CreateMemoryBody) => repo.addMemory(body),
    patchMemory: async (id: string, body: PatchMemoryBody) => repo.updateMemory(id, body),
    deleteMemory: async (id: string) => repo.removeMemory(id),
    requestSas: async (body: SasRequestBody): Promise<SasResult> => ({ blobPath: `story/${body.assetId}`, url: assetUrl({ id: body.assetId }), expiresAt: iso(3600000) }),
    getCredentialStatus: async () => credentialStatus,
    putCredentials: async () => credentialStatus,
    deleteCredentials: async () => undefined,
    submitRun: async (_threadId: string, _body: SubmitRunBody): Promise<SubmitRunResult> => ({ runId: 'story-run', assistantMessageId: 'story-assistant', status: 'queued' }),
    getRun: async (threadId: string, runId: string): Promise<RunRecord> => ({ id: runId, threadId, userId: 'story-user', assistantMessageId: 'story-assistant', status: 'complete', tools: [], allowDestructive: [], createdAt: iso(), heartbeatAt: iso() }),
    listActiveRuns: async () => [],
    cancelRun: async (threadId: string, runId: string): Promise<RunRecord> => ({ id: runId, threadId, userId: 'story-user', assistantMessageId: 'story-assistant', status: 'canceled', tools: [], allowDestructive: [], createdAt: iso(), heartbeatAt: iso() }),
    negotiate: async () => ({ url: '', accessToken: '' }),
    listThreadFiles: async () => threadFiles,
    uploadThreadFile: async (_threadId: string, body: { name: string; mime: string; dataBase64: string }) => ({ fileId: `file-${threadFiles.length + 1}`, name: body.name, bytes: body.dataBase64.length, status: 'ready', createdAt: iso(), kind: 'document', mime: body.mime }),
    deleteThreadFile: async () => undefined,
    transcribeAudio: async () => ({ text: 'Transcribed story audio.' }),
    synthesizeSpeech: async () => ({ audioBase64: '', mime: 'audio/mpeg' }),
    chatComplete: async () => ({ text: 'OK' }),
    generateImage: async () => ({ images: [{ b64: '' }] }),
    createImages: async (body: CreateImagesBody) => studioImages.slice(0, body.count ?? 1).map((image, index) => ({ ...image, id: `${image.id}-${Date.now()}-${index}`, prompt: body.prompt, size: body.size ?? image.size, status: 'queued' })),
    listImages: async (_query?: ListImagesQuery): Promise<ListImagesResult> => ({ images: studioImages }),
    getImage: async (id: string) => studioImages.find((image) => image.id === id) ?? studioImages[0],
    deleteImage: async (id: string) => {
      studioImages = studioImages.filter((image) => image.id !== id);
    },
    getMe: async () => ({ email: 'story@example.com', isAdmin: true, isInvited: true }),
    listInvites: async () => invites,
    createInvite: async (email: string) => {
      const invite = { email, invitedBy: 'story@example.com', createdAt: iso() };
      invites = [invite, ...invites];
      return invite;
    },
    deleteInvite: async (email: string) => {
      invites = invites.filter((invite) => invite.email !== email);
    },
    getMemoryModelConfig: async () => ({
      base: { model: 'gpt-5.4-mini', source: 'env' as const, envDefault: 'gpt-5.4-mini', override: null },
      deep: { model: 'gpt-5.4', source: 'env' as const, envDefault: 'gpt-5.4', override: null },
    }),
    setMemoryModels: async (body: { memoryModel?: string; memoryDeepModel?: string }) => ({
      base: { model: body.memoryModel || 'gpt-5.4-mini', source: (body.memoryModel ? 'override' : 'env') as 'override' | 'env', envDefault: 'gpt-5.4-mini', override: body.memoryModel || null },
      deep: { model: body.memoryDeepModel || 'gpt-5.4', source: (body.memoryDeepModel ? 'override' : 'env') as 'override' | 'env', envDefault: 'gpt-5.4', override: body.memoryDeepModel || null },
    }),
  });

  Object.assign(skillsApi, {
    list: async () => storySkills,
    get: async (id: string) => ({ ...storySkillDetail, ...(storySkills.find((skill) => skill.id === id) ?? {}) }),
    upload: async () => storySkills[1],
    replace: async (id: string) => storySkills.find((skill) => skill.id === id) ?? storySkills[1],
    setEnabled: async (id: string, enabled: boolean) => ({ ...(storySkills.find((skill) => skill.id === id) ?? storySkills[0]), enabled }),
    remove: async () => undefined,
    download: async () => ({ url: 'data:application/zip;base64,UEs=' }),
  });

  Object.assign(realtime, {
    ensure: async () => true,
    on: () => () => {},
    negotiate: async () => ({ url: '', accessToken: '' }),
    liveSince: () => 0,
  });
}