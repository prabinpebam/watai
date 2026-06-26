import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChat } from './useChat';
import { Composer } from './Composer';
import { AssistantMessage, UserMessage } from './Message';
import { SourcePane } from './SourcePane';
import { Icon } from '../../design/icons';
import { Avatar, Spinner } from '../../design/ui';
import { useUi } from '../../state/store';
import { greeting } from '../../lib/format';

const SUGGESTIONS = [
  { title: 'Explain a concept', sub: 'Break down quantum entanglement simply', prompt: 'Explain quantum entanglement in simple terms.' },
  { title: 'Write code', sub: 'A debounce hook in TypeScript', prompt: 'Write a React useDebounced hook in TypeScript.' },
  { title: 'Plan something', sub: '3 days in Kyoto', prompt: 'Plan a 3-day trip to Kyoto for first-timers.' },
  { title: 'Draft a message', sub: 'A friendly out-of-office note', prompt: 'Draft a friendly out-of-office email for next week.' },
];

export function ChatView({ threadId, onScrolledChange }: { threadId: string; onScrolledChange?: (v: boolean) => void }) {
  const { messages, loading, send, regenerate, stop, streaming, indexing, lockedBy } = useChat(threadId);
  const draft = useUi((s) => s.composerDrafts[threadId] ?? '');
  const setDraft = useUi((s) => s.setDraft);
  const closeSourcePane = useUi((s) => s.closeSourcePane);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  // Close any open source pane when this thread view unmounts (e.g. switching threads).
  useEffect(() => () => closeSourcePane(), [closeSourcePane]);

  const isEmpty = !loading && messages.length === 0;

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  useLayoutEffect(() => {
    if (atBottom) scrollToBottom('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useEffect(() => {
    if (atBottom && streaming) scrollToBottom('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance < 80);
    onScrolledChange?.(el.scrollTop > 4);
  };

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
          <div className="chat__column">
            {messages.map((m) =>
              m.role === 'user' ? (
                <UserMessage key={m.id} message={m} />
              ) : (
                <AssistantMessage key={m.id} message={m} streaming={streaming} onRegenerate={regenerate} />
              ),
            )}
            <div style={{ height: 'var(--space-4)' }} />
          </div>
        )}

        {!atBottom && (
          <button className="jump-pill" onClick={() => scrollToBottom()}>
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
      />
      </div>
      <SourcePane />
    </div>
  );
}
