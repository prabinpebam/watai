import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useChat } from './useChat';
import { Composer } from './Composer';
import { AssistantMessage, UserMessage } from './Message';
import { PromptMinimap } from './PromptMinimap';
import { SourcePane } from './SourcePane';
import { ThreadFilesPane } from './ThreadFilesPane';
import { Icon } from '../../design/icons';
import { Logo } from '../../design/Logo';
import { Avatar, Spinner } from '../../design/ui';
import { useUi } from '../../state/store';
import { greeting } from '../../lib/format';
import type { ImageRef } from '../../lib/types';

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
  const composerSlotRef = useRef<HTMLDivElement>(null);
  const prevComposerTopRef = useRef<number | null>(null);
  const wasEmptyRef = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const [viewerImageId, setViewerImageId] = useState<string | null>(null);

  // Close any open source pane when this thread view unmounts (e.g. switching threads).
  useEffect(() => () => closeSourcePane(), [closeSourcePane]);
  // Close the files pane when leaving the thread too.
  useEffect(() => () => closeFilesPane(), [closeFilesPane]);

  const isEmpty = !loading && messages.length === 0;
  const threadImages = messages.flatMap((message) => message.images ?? []);

  // On the empty state the composer sits centered with the greeting above and tips below.
  // The first prompt turns the view into a thread, which docks the composer at the bottom —
  // FLIP the slide so that jump reads as a smooth downward glide rather than a hard cut.
  useLayoutEffect(() => {
    const el = composerSlotRef.current;
    if (!el) return;
    const prevTop = prevComposerTopRef.current;
    if (wasEmptyRef.current && !isEmpty && prevTop != null) {
      const nowTop = el.getBoundingClientRect().top;
      const dy = prevTop - nowTop;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (Math.abs(dy) > 1 && !reduce) {
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
      }
    }
    prevComposerTopRef.current = el.getBoundingClientRect().top;
    wasEmptyRef.current = isEmpty;
  });

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

  // Map each assistant message to the number of memories saved from that turn, so the
  // "Memory updated" note renders inside the message instead of as a separate log line below it.
  const memoryByMessage = useMemo(() => {
    const noticeList = Array.isArray(memoryNotices) ? memoryNotices : [];
    const byMessage = new Map<string, number>();
    const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
    for (const notice of noticeList) {
      const target = notice.messageId ?? lastAssistantId;
      if (!target) continue;
      byMessage.set(target, Math.max(byMessage.get(target) ?? 0, notice.acceptedCount));
    }
    return byMessage;
  }, [messages, memoryNotices]);

  return (
    <div className="chat-area">
      <div className={`chat ${isEmpty ? 'chat--empty' : ''}`}>
        <div className="chat__scroll" ref={scrollRef} onScroll={onScroll}>
        {loading ? (
          <div className="center-screen">
            <Spinner size="xl" />
          </div>
        ) : isEmpty ? null : (
          <div className="chat__column" ref={setColumnRef}>
            {messages.map((message) =>
              message.role === 'user' ? (
                <UserMessage key={message.id} message={message} />
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  streaming={streaming}
                  onRegenerate={regenerate}
                  memoryUpdateCount={memoryByMessage.get(message.id)}
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

      </div>

      {isEmpty && (
        <div className="chat__intro">
          <Avatar size="lg" variant="assistant">
            <Logo size={30} />
          </Avatar>
          <div className="empty__greeting">
            <span className="empty__greeting-line-1">{greeting()}!</span>
            <span className="empty__greeting-line-2">What’s on the agenda today?</span>
          </div>
        </div>
      )}

      {showJump && (
        <div className="jump-dock">
          <button className="jump-pill" onClick={() => jumpToBottom('smooth')}>
            <Icon name="chevron-down" size={16} /> Jump to latest
          </button>
        </div>
      )}

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
      <div className="composer-slot" ref={composerSlotRef}>
        <Composer
          value={draft}
          onChange={(v) => setDraft(threadId, v)}
          onSend={send}
          streaming={streaming}
          onStop={stop}
          locked={!!lockedBy && !streaming}
          autoFocus={isEmpty}
        />
      </div>
      {!loading && !isEmpty && <PromptMinimap messages={messages} scrollRef={scrollRef} />}
      </div>
      <SourcePane />
      <ThreadFilesPane />
    </div>
  );
}
