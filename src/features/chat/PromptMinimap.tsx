import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { formatTime, relativeDay } from '../../lib/format';
import type { Message } from '../../lib/types';

interface PromptMinimapProps {
  messages: Message[];
  scrollRef: RefObject<HTMLDivElement | null>;
}

const ROW_HEIGHT = 16;
const EDGE_SCROLL_ZONE = 56;

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [tipTop, setTipTop] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const clearTimer = useRef<number | null>(null);
  const skipClickRef = useRef(false);
  const scrollVelocity = useRef(0);
  const scrollFrame = useRef<number | null>(null);

  const updateTipPosition = useCallback((id = activeId ?? pinnedId) => {
    const root = rootRef.current;
    const rail = railRef.current;
    if (!root || !rail || !id) {
      setTipTop(null);
      return;
    }
    const mark = rail.querySelector<HTMLElement>(`[data-minimap-id="${CSS.escape(id)}"]`);
    if (!mark) {
      setTipTop(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    setTipTop(markRect.top - rootRect.top + markRect.height / 2);
  }, [activeId, pinnedId]);

  const stopAutoScroll = useCallback(() => {
    scrollVelocity.current = 0;
    if (scrollFrame.current !== null) {
      window.cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    }
  }, []);

  const runAutoScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail || scrollVelocity.current === 0) {
      scrollFrame.current = null;
      return;
    }
    const before = rail.scrollTop;
    rail.scrollTop += scrollVelocity.current;
    if (rail.scrollTop === before && (rail.scrollTop === 0 || rail.scrollTop + rail.clientHeight >= rail.scrollHeight - 1)) {
      stopAutoScroll();
      return;
    }
    updateTipPosition();
    scrollFrame.current = window.requestAnimationFrame(runAutoScroll);
  }, [stopAutoScroll, updateTipPosition]);

  const updateAutoScroll = useCallback((clientY: number) => {
    const rail = railRef.current;
    if (!rail || rail.scrollHeight <= rail.clientHeight) {
      stopAutoScroll();
      return;
    }
    const rect = rail.getBoundingClientRect();
    const topPressure = Math.max(0, EDGE_SCROLL_ZONE - (clientY - rect.top));
    const bottomPressure = Math.max(0, EDGE_SCROLL_ZONE - (rect.bottom - clientY));
    const nextVelocity = topPressure > 0
      ? -Math.min(16, 2 + topPressure / 3)
      : bottomPressure > 0
        ? Math.min(16, 2 + bottomPressure / 3)
        : 0;
    scrollVelocity.current = nextVelocity;
    if (nextVelocity === 0) {
      stopAutoScroll();
      return;
    }
    if (scrollFrame.current === null) {
      scrollFrame.current = window.requestAnimationFrame(runAutoScroll);
    }
  }, [runAutoScroll, stopAutoScroll]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const onScroll = () => updateTipPosition();
    rail.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    updateTipPosition();
    return () => {
      rail.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [prompts, updateTipPosition]);

  useEffect(() => {
    return () => {
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      stopAutoScroll();
    };
  }, [stopAutoScroll]);

  // Track which prompt the chat is currently scrolled to, so its mark can be highlighted.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const computeCurrent = () => {
      const marker = el.getBoundingClientRect().top + el.clientHeight * 0.25;
      let current: string | null = prompts[0]?.id ?? null;
      for (const message of prompts) {
        const node = el.querySelector<HTMLElement>(`[data-prompt-id="${CSS.escape(message.id)}"]`);
        if (!node) continue;
        if (node.getBoundingClientRect().top <= marker) current = message.id;
        else break;
      }
      setCurrentId(current);
    };
    computeCurrent();
    el.addEventListener('scroll', computeCurrent, { passive: true });
    window.addEventListener('resize', computeCurrent);
    return () => {
      el.removeEventListener('scroll', computeCurrent);
      window.removeEventListener('resize', computeCurrent);
    };
  }, [prompts, scrollRef]);

  const activePrompt = prompts.find((message) => message.id === activeId || message.id === pinnedId);

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
    updateTipPosition(message.id);
    scrollToPrompt(message);
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    if (touchLike(pointerType)) {
      clearTimer.current = window.setTimeout(() => {
        setPinnedId((current) => (current === message.id ? null : current));
        setActiveId((current) => (current === message.id ? null : current));
      }, 3600);
    }
  };

  if (prompts.length < 1) return null;

  const activeIndex = prompts.findIndex((message) => message.id === (activeId ?? pinnedId ?? currentId));

  return (
    <nav className="prompt-minimap" aria-label="User prompts in this chat" ref={rootRef}>
      <div
        className="prompt-minimap__rail"
        ref={railRef}
        onPointerMove={(event) => {
          if (!touchLike(event.pointerType)) updateAutoScroll(event.clientY);
        }}
        onPointerLeave={(event) => {
          stopAutoScroll();
          if (!touchLike(event.pointerType)) setActiveId(null);
        }}
      >
        <div className="prompt-minimap__track" style={{ ['--prompt-row-height' as string]: `${ROW_HEIGHT}px` }}>
        {prompts.map((message, index) => {
          const distance = activeIndex === -1 ? 99 : Math.abs(activeIndex - index);
          const wave = distance === 0 ? 1 : distance === 1 ? 0.62 : distance === 2 ? 0.34 : distance === 3 ? 0.16 : 0;
          const active = message.id === activeId || message.id === pinnedId;
          const current = message.id === currentId;
          return (
            <button
              key={message.id}
              type="button"
              className={`prompt-minimap__mark ${active ? 'prompt-minimap__mark--active' : ''} ${current ? 'prompt-minimap__mark--current' : ''}`}
              data-minimap-id={message.id}
              style={{ ['--wave' as string]: wave }}
              aria-label={`Jump to prompt: ${promptLabel(message)}`}
              onPointerEnter={(event) => {
                if (!touchLike(event.pointerType)) {
                  setActiveId(message.id);
                  updateTipPosition(message.id);
                }
              }}
              onFocus={() => {
                setActiveId(message.id);
                updateTipPosition(message.id);
              }}
              onBlur={() => setActiveId(null)}
              onPointerDown={(event) => {
                if (touchLike(event.pointerType)) {
                  skipClickRef.current = true;
                  selectPrompt(message, event.pointerType);
                }
              }}
              onClick={() => {
                if (skipClickRef.current) {
                  skipClickRef.current = false;
                  return;
                }
                selectPrompt(message);
              }}
            >
              <span />
            </button>
          );
        })}
        </div>
      </div>
      {activePrompt && tipTop !== null && (
        <div className="prompt-minimap__tip" style={{ top: `${tipTop}px` }} role="status">
          <div className="prompt-minimap__tip-text">{promptLabel(activePrompt)}</div>
          <div className="prompt-minimap__tip-time">{promptTime(activePrompt.createdAt)}</div>
        </div>
      )}
    </nav>
  );
}