import { useRef, useState } from 'react';
import { Markdown } from './Markdown';
import { AttachmentList, GeneratedImages } from './Attachments';
import { IconButton } from '../../design/ui';
import { Icon } from '../../design/icons';
import { useUi } from '../../state/store';
import { synthesize } from '../../ai/tts';
import type { Message, ToolCall } from '../../lib/types';

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
    return <span className="spinner" style={{ width: 12, height: 12 }} />;
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
          <span className="avatar avatar--assistant" style={{ width: 28, height: 28, fontSize: 13 }}>
            <Icon name="sparkle" size={15} />
          </span>
          <span className="assistant__name">Watai</span>
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="tool-cards" aria-live="polite">
            {message.toolCalls.map((tc) => (
              <ToolCardView key={tc.id} tc={tc} />
            ))}
          </div>
        )}

        <GeneratedImages images={message.images} pending={message.pendingImages} />

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

        {message.citations && message.citations.length > 0 && (
          <div className="sources">
            <span className="sources__label">Sources</span>
            <div className="sources__list">
              {message.citations
                .filter((c) => c.url || c.filename)
                .map((c, i) =>
                  c.url ? (
                    <a
                      key={i}
                      className="source-chip"
                      href={c.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <span className="source-chip__num">{i + 1}</span>
                      {c.favicon ? (
                        <img className="source-chip__favicon" src={c.favicon} alt="" width={14} height={14} />
                      ) : null}
                      <span className="source-chip__text">{c.title || domainOf(c.url)}</span>
                      <Icon name="external" size={12} className="source-chip__ext" />
                    </a>
                  ) : (
                    <span key={i} className="source-chip">
                      <span className="source-chip__num">{i + 1}</span>
                      <Icon name="paperclip" size={13} />
                      <span className="source-chip__text">{c.filename}</span>
                    </span>
                  ),
                )}
              {message.citations.find((c) => c.bingQueryUrl)?.bingQueryUrl && (
                <a
                  className="source-chip source-chip--bing"
                  href={message.citations.find((c) => c.bingQueryUrl)?.bingQueryUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Icon name="globe" size={13} />
                  <span className="source-chip__text">Searched the web</span>
                </a>
              )}
            </div>
          </div>
        )}

        <AttachmentList attachments={message.attachments} />

        {message.status === 'error' && message.error && (
          <div className="alert alert--danger" style={{ marginTop: 8 }}>
            <span className="alert__icon">
              <Icon name="alert" size={18} />
            </span>
            <span>{message.error.message}</span>
          </div>
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
