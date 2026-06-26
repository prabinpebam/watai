import { useRef, useState } from 'react';
import { Markdown } from './Markdown';
import { AttachmentList, GeneratedImages } from './Attachments';
import { Avatar, IconButton, InlineAlert, Spinner } from '../../design/ui';
import { Icon } from '../../design/icons';
import { useUi } from '../../state/store';
import { synthesize } from '../../ai/tts';
import type { Citation, Message, PendingImage, ToolCall } from '../../lib/types';

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function kindIcon(kind: ToolCall['kind']): string {
  switch (kind) {
    case 'web_search':
      return 'globe';
    case 'code_interpreter':
      return 'code';
    case 'file_search':
      return 'database';
    case 'image':
      return 'image';
    default:
      return 'sparkle';
  }
}

function ToolStatusIcon({ status }: { status: ToolCall['status'] }) {
  if (status === 'running' || status === 'awaiting-confirm')
    return <Spinner size="sm" />;
  if (status === 'error') return <Icon name="alert" size={14} />;
  return <Icon name="check" size={14} />;
}

/** One tool-activity card. Expands to reveal the detail (e.g. code + output) when present. */
function ToolCardView({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!tc.resultPreview;
  const header = (
    <>
      <span className="tool-card__kind" aria-hidden>
        <Icon name={kindIcon(tc.kind)} size={15} />
      </span>
      <span className="tool-card__label">{tc.summary ?? tc.name}</span>
      {hasDetail && (
        <span className="tool-card__chevron" aria-hidden>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </span>
      )}
      <span className="tool-card__status" aria-hidden>
        <ToolStatusIcon status={tc.status} />
      </span>
    </>
  );
  return (
    <div className={`tool-card tool-card--${tc.status}`}>
      {hasDetail ? (
        <button
          type="button"
          className="tool-card__head"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {header}
        </button>
      ) : (
        <div className="tool-card__head">{header}</div>
      )}
      {hasDetail && open && <pre className="tool-card__detail">{tc.resultPreview}</pre>}
    </div>
  );
}

/** Collapsed-by-default strip of grounding sources. Clicking a chip opens the source pane. */
function SourcesStrip({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  const openSourcePane = useUi((s) => s.openSourcePane);
  const sources = citations.filter((c) => c.url || c.filename || c.content);
  const bing = citations.find((c) => c.bingQueryUrl)?.bingQueryUrl;
  if (sources.length === 0 && !bing) return null;
  return (
    <div className={`sources ${open ? 'sources--open' : ''}`}>
      <button
        type="button"
        className="sources__toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="globe" size={14} />
        <span className="sources__toggle-label">
          {sources.length} source{sources.length === 1 ? '' : 's'}
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} className="sources__caret" />
      </button>
      {open && (
        <div className="sources__list">
          {sources.map((c, i) => (
            <button
              key={i}
              type="button"
              className="source-chip"
              onClick={() => openSourcePane(sources, i)}
              title={c.title || c.filename || domainOf(c.url || '')}
            >
              <span className="source-chip__num">{i + 1}</span>
              {c.favicon ? (
                <img className="source-chip__favicon" src={c.favicon} alt="" width={14} height={14} />
              ) : !c.url ? (
                <Icon name="paperclip" size={13} />
              ) : null}
              <span className="source-chip__text">{c.title || c.filename || domainOf(c.url || '')}</span>
              <Icon name="chevron-right" size={12} className="source-chip__ext" />
            </button>
          ))}
          {bing && (
            <a className="source-chip source-chip--bing" href={bing} target="_blank" rel="noreferrer noopener">
              <Icon name="globe" size={13} />
              <span className="source-chip__text">Searched the web</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function UserMessage({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="msg-group msg-group--user">
      {message.attachments && message.attachments.length > 0 && (
        <div className="msg-group__attachments">
          <AttachmentList attachments={message.attachments} />
        </div>
      )}
      {message.content && <div className="bubble-user">{message.content}</div>}
      <div className="user__actions">
        <IconButton name={copied ? 'check' : 'copy'} label="Copy" size={16} onClick={copy} />
      </div>
    </div>
  );
}

interface AssistantProps {
  message: Message;
  streaming: boolean;
  onRegenerate: () => void;
}

export function AssistantMessage({ message, streaming, onRegenerate }: AssistantProps) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pushToast = useUi((s) => s.pushToast);
  const mockAi = useUi((s) => s.mockAi);
  const isStreamingThis = streaming && message.status === 'streaming';

  // An image tool call that is still running renders as an aspect-correct placeholder (optimistic
  // preview) rather than a tool card; once the image lands the placeholder yields to the real one.
  const imageGenerating = (message.toolCalls ?? []).filter(
    (tc) => tc.kind === 'image' && (tc.status === 'running' || tc.status === 'awaiting-confirm'),
  );
  const derivedPending: PendingImage[] = imageGenerating.map((tc) => ({
    id: tc.id,
    size: tc.imageSize || '1024x1024',
  }));
  const pendingImages = derivedPending.length ? derivedPending : message.pendingImages;
  // Image tool calls are conveyed by the placeholder / final image, so keep them out of the card
  // strip — except a failure, which the user should see.
  const toolCards = (message.toolCalls ?? []).filter(
    (tc) => tc.kind !== 'image' || tc.status === 'error',
  );

  const copy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const readAloud = async () => {
    if (speaking && audioRef.current) {
      audioRef.current.pause();
      setSpeaking(false);
      return;
    }
    if (mockAi) {
      pushToast('Read-aloud uses your real endpoint', 'info');
      return;
    }
    setSpeaking(true);
    try {
      const blob = await synthesize({ input: message.content.slice(0, 4000) });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (e) {
      setSpeaking(false);
      pushToast(e instanceof Error ? e.message : 'Could not read aloud', 'error');
    }
  };

  return (
    <div className="msg-group msg-group--assistant">
      <div className="assistant">
        <div className="assistant__role">
          <Avatar size="sm" variant="assistant">
            <Icon name="sparkle" size={15} />
          </Avatar>
          <span className="assistant__name">Watai</span>
        </div>

        {toolCards.length > 0 && (
          <div className="tool-cards" aria-live="polite">
            {toolCards.map((tc) => (
              <ToolCardView key={tc.id} tc={tc} />
            ))}
          </div>
        )}

        <GeneratedImages images={message.images} pending={pendingImages} />

        {message.content ? (
          <div className={isStreamingThis ? 'typing-caret' : ''}>
            <Markdown content={message.content} />
          </div>
        ) : isStreamingThis ? (
          <div className="typing-dots" aria-label="Assistant is typing">
            <span />
            <span />
            <span />
          </div>
        ) : null}

        {!isStreamingThis && message.citations && <SourcesStrip citations={message.citations} />}

        <AttachmentList attachments={message.attachments} />

        {message.status === 'error' && message.error && (
          <InlineAlert tone="danger">{message.error.message}</InlineAlert>
        )}

        {message.status === 'interrupted' && (
          <p className="muted" style={{ fontSize: 'var(--text-caption-size)', marginTop: 4 }}>
            Stopped.
          </p>
        )}

        {!isStreamingThis && message.content && (
          <div className="assistant__actions">
            <IconButton name={copied ? 'check' : 'copy'} label="Copy" size={18} onClick={copy} />
            <IconButton name="refresh" label="Regenerate" size={18} onClick={onRegenerate} />
            <IconButton
              name="speaker"
              label={speaking ? 'Stop reading' : 'Read aloud'}
              size={18}
              filled={speaking}
              className={speaking ? 'icon-btn--active' : ''}
              onClick={readAloud}
            />
          </div>
        )}
      </div>
    </div>
  );
}
