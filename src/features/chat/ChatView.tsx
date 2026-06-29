import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from './useChat';
import { Composer } from './Composer';
import { AssistantMessage, UserMessage } from './Message';
import { PromptMinimap } from './PromptMinimap';
import { SourcePane } from './SourcePane';
import { ThreadFilesPane } from './ThreadFilesPane';
import { Icon } from '../../design/icons';
import { Avatar, Spinner } from '../../design/ui';
import { useUi, type MemoryNotice } from '../../state/store';
import { greeting } from '../../lib/format';
import type { ImageRef } from '../../lib/types';

function memoryLogLabel(count: number): string {
  return count > 1 ? `${count} memories updated` : 'Memory updated';
}

const SUGGESTIONS = [
  { title: 'Explain a concept', sub: 'Break down quantum entanglement simply', prompt: 'Explain quantum entanglement in simple terms.' },
  { title: 'Write code', sub: 'A debounce hook in TypeScript', prompt: 'Write a React useDebounced hook in TypeScript.' },
  { title: 'Plan something', sub: '3 days in Kyoto', prompt: 'Plan a 3-day trip to Kyoto for first-timers.' },
  { title: 'Draft a message', sub: 'A friendly out-of-office note', prompt: 'Draft a friendly out-of-office email for next week.' },
];

export function ChatView({ threadId, onScrolledChange }: { threadId: string; onScrolledChange?: (v: boolean) => void }) {
  const { messages, loading, send, regenerate, stop, streaming, indexing, lockedBy } = useChat(threadId);
  const draft = useUi((s) => s.composerDrafts[threadId] ?? '');
  const memoryNotices = useUi((s) => s.memoryNotices[threadId]);
  const setDraft = useUi((s) => s.setDraft);
  const closeSourcePane = useUi((s) => s.closeSourcePane);
  const closeFilesPane = useUi((s) => s.closeFilesPane);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // is the view pinned to the bottom?
  const lastTopRef = useRef(0); // previous scrollTop, to detect user-driven upward scrolls
  const roRef = useRef<ResizeObserver | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [viewerImageId, setViewerImageId] = useState<string | null>(null);

  // Close any open source pane when this thread view unmounts (e.g. switching threads).
  useEffect(() => () => closeSourcePane(), [closeSourcePane]);
  // Close the files pane when leaving the thread too.
  useEffect(() => () => closeFilesPane(), [closeFilesPane]);

  const isEmpty = !loading && messages.length === 0;
  const threadImages = messages.flatMap((message) => message.images ?? []);

  const STICK_THRESHOLD = 80; // px from the bottom that still counts as "at the bottom"

  const jumpToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setShowJump(false);
  }, []);

  // Pin to the bottom whenever the message column's height changes — streamed tokens, tool cards
  // expanding, images finishing layout, artifact cards rendering — but only while the user is
  // stuck to the bottom. A ResizeObserver tracks the real rendered height, so we never scroll
  // before async content has laid out (the old per-token effect did, landing at the wrong spot).
  // A callback ref (re)attaches it exactly when the column mounts (it isn't rendered while empty).
  const setColumnRef = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el && stickRef.current) {
        el.scrollTop = el.scrollHeight; // instant: smooth lags behind fast streaming
        lastTopRef.current = el.scrollTop;
      }
    });
    ro.observe(node);
    roRef.current = ro;
  }, []);

  useEffect(() => () => roRef.current?.disconnect(), []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const distance = el.scrollHeight - top - el.clientHeight;
    const atBottom = distance < STICK_THRESHOLD;
    // A genuine upward move (scrollTop shrank) means the user is reading history → unpin. Returning
    // to the bottom re-pins. Appending content keeps scrollTop put, so growth never unpins.
    if (top < lastTopRef.current - 2) stickRef.current = false;
    else if (atBottom) stickRef.current = true;
    lastTopRef.current = top;
    setShowJump(!atBottom);
    onScrolledChange?.(top > 4);
  };

  const focusImageInThread = useCallback((image: ImageRef) => {
    const el = scrollRef.current;
    const target = document.querySelector<HTMLElement>(`[data-image-id="${CSS.escape(image.id)}"]`);
    if (!el || !target) return;
    const elRect = el.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = targetRect.top - elRect.top + el.scrollTop - Math.max(24, (el.clientHeight - targetRect.height) / 2);
    el.scrollTo({ top, behavior: 'smooth' });
  }, []);

  const openImageViewer = useCallback((image: ImageRef) => {
    setViewerImageId(image.id);
    focusImageInThread(image);
  }, [focusImageInThread]);

  const setViewerImage = useCallback((image: ImageRef) => {
    setViewerImageId(image.id);
    focusImageInThread(image);
  }, [focusImageInThread]);

  useEffect(() => {
    if (viewerImageId && !threadImages.some((image) => image.id === viewerImageId)) {
      setViewerImageId(null);
    }
  }, [threadImages, viewerImageId]);

  // Interleave assistant/user messages with memory-update logs in chronological order, so a
  // memory update appears as a quiet system-log line at the point in time it actually happened.
  const timeline = useMemo(() => {
    const items: Array<
      | { kind: 'message'; key: string; ts: string; message: (typeof messages)[number] }
      | { kind: 'memory'; key: string; ts: string; notice: MemoryNotice }
    > = [];
    for (const message of messages) items.push({ kind: 'message', key: message.id, ts: message.createdAt, message });
    for (const notice of Array.isArray(memoryNotices) ? memoryNotices : []) items.push({ kind: 'memory', key: `mem:${notice.id}`, ts: notice.updatedAt, notice });
    items.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    // The command + turn extraction lanes both fire per exchange, so collapse consecutive memory
    // notices (no message between them) into one to avoid duplicate "Memory updated" lines.
    const collapsed: typeof items = [];
    for (const item of items) {
      const prev = collapsed[collapsed.length - 1];
      if (item.kind === 'memory' && prev?.kind === 'memory') {
        collapsed[collapsed.length - 1] = {
          ...prev,
          ts: item.ts,
          notice: { ...prev.notice, acceptedCount: Math.max(prev.notice.acceptedCount, item.notice.acceptedCount), updatedAt: item.ts },
        };
        continue;
      }
      collapsed.push(item);
    }
    return collapsed;
  }, [messages, memoryNotices]);

  return (
    <div className="chat-area">
      <div className="chat">
        <div className="chat__scroll" ref={scrollRef} onScroll={onScroll}>
        {loading ? (
          <div className="center-screen">
            <Spinner size="xl" />
          </div>
        ) : isEmpty ? (
          <div className="empty">
            <Avatar size="lg" variant="assistant">
              <Icon name="sparkle" size={28} />
            </Avatar>
            <div>
              <div className="empty__greeting">{greeting()}</div>
              <div className="empty__sub">Ask anything, dictate with your voice, or generate an image.</div>
            </div>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s.title} className="suggestion" onClick={() => send(s.prompt)}>
                  <div className="suggestion__title">{s.title}</div>
                  <div className="suggestion__sub">{s.sub}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat__column" ref={setColumnRef}>
            {timeline.map((item) =>
              item.kind === 'memory' ? (
                <div key={item.key} className="memory-log" role="note">
                  {memoryLogLabel(item.notice.acceptedCount)}
                </div>
              ) : item.message.role === 'user' ? (
                <UserMessage key={item.key} message={item.message} />
              ) : (
                <AssistantMessage
                  key={item.key}
                  message={item.message}
                  streaming={streaming}
                  onRegenerate={regenerate}
                  threadImages={threadImages}
                  viewerImageId={viewerImageId}
                  onOpenImage={openImageViewer}
                  onSelectImage={setViewerImage}
                  onCloseImage={() => setViewerImageId(null)}
                />
              ),
            )}
            <div style={{ height: 'var(--space-4)' }} />
          </div>
        )}

        {showJump && (
          <button className="jump-pill" onClick={() => jumpToBottom('smooth')}>
            <Icon name="chevron-down" size={16} /> Jump to latest
          </button>
        )}
      </div>

      {indexing && (
        <div className="composer-status" role="status">
          <Spinner size="sm" />
          <span>Indexing your file… you can ask about it once it’s ready.</span>
        </div>
      )}
      {lockedBy && !streaming && (
        <div className="composer-status composer-status--lock" role="status">
          <Spinner size="sm" />
          <span>
            Generating a response on {lockedBy.deviceLabel}… you can reply once it’s finished.
          </span>
        </div>
      )}
      <Composer
        value={draft}
        onChange={(v) => setDraft(threadId, v)}
        onSend={send}
        streaming={streaming}
        onStop={stop}
        locked={!!lockedBy && !streaming}
        autoFocus={isEmpty}
      />
      {!loading && !isEmpty && <PromptMinimap messages={messages} scrollRef={scrollRef} />}
      </div>
      <SourcePane />
      <ThreadFilesPane />
    </div>
  );
}
