import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { formatTime, relativeDay } from '../../lib/format';
import type { Message } from '../../lib/types';

interface PromptMark {
  message: Message;
  top: number;
}

interface PromptMinimapProps {
  messages: Message[];
  scrollRef: RefObject<HTMLDivElement | null>;
}

function promptLabel(message: Message): string {
  return message.content.trim().replace(/\s+/g, ' ') || 'Untitled prompt';
}

function promptTime(iso: string): string {
  return `${relativeDay(iso)}, ${formatTime(iso)}`;
}

function touchLike(pointerType?: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

export function PromptMinimap({ messages, scrollRef }: PromptMinimapProps) {
  const prompts = useMemo(() => messages.filter((message) => message.role === 'user'), [messages]);
  const [marks, setMarks] = useState<PromptMark[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const clearTimer = useRef<number | null>(null);
  const skipClickRef = useRef(false);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el || prompts.length === 0) {
      setMarks([]);
      return;
    }
    const scrollerRect = el.getBoundingClientRect();
    const next = prompts.map((message) => {
      const node = el.querySelector<HTMLElement>(`[data-prompt-id="${CSS.escape(message.id)}"]`);
      if (!node) return { message, top: 0 };
      const rect = node.getBoundingClientRect();
      const y = rect.top - scrollerRect.top + el.scrollTop;
      const max = Math.max(1, el.scrollHeight - rect.height);
      return { message, top: Math.min(96, Math.max(4, (y / max) * 100)) };
    });
    setMarks(next);
  }, [prompts, scrollRef]);

  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const column = el.querySelector('.chat__column');
    if (column) ro.observe(column);
    window.addEventListener('resize', measure);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      el.removeEventListener('scroll', measure);
    };
  }, [measure, scrollRef]);

  useEffect(() => {
    return () => {
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    };
  }, []);

  const activeMark = marks.find((mark) => mark.message.id === activeId || mark.message.id === pinnedId);

  const scrollToPrompt = useCallback((message: Message) => {
    const el = scrollRef.current;
    const node = el?.querySelector<HTMLElement>(`[data-prompt-id="${CSS.escape(message.id)}"]`);
    if (!el || !node) return;
    const scrollerRect = el.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const top = rect.top - scrollerRect.top + el.scrollTop - Math.max(24, el.clientHeight * 0.18);
    el.scrollTo({ top, behavior: 'smooth' });
  }, [scrollRef]);

  const selectPrompt = (message: Message, pointerType?: string) => {
    setActiveId(message.id);
    setPinnedId(touchLike(pointerType) ? message.id : null);
    scrollToPrompt(message);
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    if (touchLike(pointerType)) {
      clearTimer.current = window.setTimeout(() => {
        setPinnedId((current) => (current === message.id ? null : current));
        setActiveId((current) => (current === message.id ? null : current));
      }, 3600);
    }
  };

  if (marks.length === 0) return null;

  const activeIndex = marks.findIndex((mark) => mark.message.id === (activeId ?? pinnedId));

  return (
    <nav className="prompt-minimap" aria-label="User prompts in this chat">
      <div className="prompt-minimap__rail">
        {marks.map((mark, index) => {
          const distance = activeIndex === -1 ? 99 : Math.abs(activeIndex - index);
          const wave = distance === 0 ? 1 : distance === 1 ? 0.62 : distance === 2 ? 0.34 : distance === 3 ? 0.16 : 0;
          const active = mark.message.id === activeId || mark.message.id === pinnedId;
          return (
            <button
              key={mark.message.id}
              type="button"
              className={`prompt-minimap__mark ${active ? 'prompt-minimap__mark--active' : ''}`}
              style={{ top: `${mark.top}%`, ['--wave' as string]: wave }}
              aria-label={`Jump to prompt: ${promptLabel(mark.message)}`}
              onPointerEnter={(event) => {
                if (!touchLike(event.pointerType)) setActiveId(mark.message.id);
              }}
              onPointerLeave={(event) => {
                if (!touchLike(event.pointerType)) setActiveId(null);
              }}
              onFocus={() => setActiveId(mark.message.id)}
              onBlur={() => setActiveId(null)}
              onPointerDown={(event) => {
                if (touchLike(event.pointerType)) {
                  skipClickRef.current = true;
                  selectPrompt(mark.message, event.pointerType);
                }
              }}
              onClick={() => {
                if (skipClickRef.current) {
                  skipClickRef.current = false;
                  return;
                }
                selectPrompt(mark.message);
              }}
            >
              <span />
            </button>
          );
        })}
      </div>
      {activeMark && (
        <div className="prompt-minimap__tip" style={{ top: `${activeMark.top}%` }} role="status">
          <div className="prompt-minimap__tip-text">{promptLabel(activeMark.message)}</div>
          <div className="prompt-minimap__tip-time">{promptTime(activeMark.message.createdAt)}</div>
        </div>
      )}
    </nav>
  );
}