import { useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import { AttachmentList, ArtifactList, GeneratedImages } from './Attachments';
import { Avatar, IconButton, InlineAlert, Spinner } from '../../design/ui';
import { Icon } from '../../design/icons';
import { useUi } from '../../state/store';
import { repo, cloudApi } from '../../data';
import { base64ToBlob } from '../../lib/files';
import { speakableText } from '../../lib/speakable';
import type { Citation, ImageRef, Message, MessageMemoryRef, PendingImage, ToolCall } from '../../lib/types';

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

function isContentPolicyImageError(text = ''): boolean {
  return /content policy|content.?filter|moderation|safety system|policy violation/i.test(text);
}

function toolLabel(tc: ToolCall): string | undefined {
  if (tc.kind === 'image' && tc.status === 'error') {
    return isContentPolicyImageError(tc.summary) ? 'Image blocked by content policy' : 'Image generation failed';
  }
  return tc.summary ?? tc.name;
}

function toolErrorMessage(tc: ToolCall): string | null {
  if (tc.status !== 'error') return null;
  if (tc.kind === 'image') {
    return tc.summary ?? 'Image generation failed. Try again or change the prompt.';
  }
  return tc.summary ?? tc.resultPreview ?? null;
}

/** One tool-activity card. Expands to reveal the detail (e.g. code + output) when present. */
function ToolCardView({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!tc.resultPreview;
  const errorMessage = toolErrorMessage(tc);
  const header = (
    <>
      <span className="tool-card__kind" aria-hidden>
        <Icon name={kindIcon(tc.kind)} size={15} />
      </span>
      <span className="tool-card__label">{toolLabel(tc)}</span>
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
      {errorMessage && <div className="tool-card__message">{errorMessage}</div>}
    </div>
  );
}

type ToolCardEntry =
  | { type: 'tool'; tc: ToolCall }
  | { type: 'tool-group'; id: string; calls: ToolCall[] };

function groupedToolCards(cards: ToolCall[]): ToolCardEntry[] {
  if (cards.length <= 1) return cards.map((tc) => ({ type: 'tool', tc }));
  return [{ type: 'tool-group', id: `${cards[0].id}-${cards[cards.length - 1].id}`, calls: cards }];
}

function aggregateStatus(calls: ToolCall[]): ToolCall['status'] {
  if (calls.some((tc) => tc.status === 'error')) return 'error';
  if (calls.some((tc) => tc.status === 'running')) return 'running';
  if (calls.some((tc) => tc.status === 'awaiting-confirm')) return 'awaiting-confirm';
  return 'done';
}

function ToolStepView({ tc, index }: { tc: ToolCall; index: number }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!tc.resultPreview;
  const errorMessage = toolErrorMessage(tc);
  const body = (
    <>
      <span className="tool-step__index">{index + 1}</span>
      <span className="tool-step__label">{toolLabel(tc)}</span>
      {hasDetail && (
        <span className="tool-step__chevron" aria-hidden>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </span>
      )}
      <span className="tool-step__status" aria-hidden>
        <ToolStatusIcon status={tc.status} />
      </span>
    </>
  );
  return (
    <div className={`tool-step tool-step--${tc.status}`}>
      {hasDetail ? (
        <button
          type="button"
          className="tool-step__head"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {body}
        </button>
      ) : (
        <div className="tool-step__head">{body}</div>
      )}
      {hasDetail && open && <pre className="tool-step__detail">{tc.resultPreview}</pre>}
      {errorMessage && <div className="tool-step__message">{errorMessage}</div>}
    </div>
  );
}

function groupLabel(calls: ToolCall[]): string {
  const first = calls[0]?.kind;
  if (first && calls.every((tc) => tc.kind === first)) {
    switch (first) {
      case 'web_search':
        return 'Web search';
      case 'code_interpreter':
        return 'Code interpreter';
      case 'file_search':
        return 'File search';
      case 'image':
        return 'Image generation';
      default:
        return 'Tools';
    }
  }
  return 'Tools';
}

function ToolGroup({ calls }: { calls: ToolCall[] }) {
  const status = aggregateStatus(calls);
  const [open, setOpen] = useState(status === 'error');
  useEffect(() => {
    if (status === 'error') setOpen(true);
  }, [status]);
  const icon = calls.every((tc) => tc.kind === calls[0].kind) ? kindIcon(calls[0].kind) : 'sparkle';
  return (
    <div className={`tool-group tool-group--${status}`}>
      <button
        type="button"
        className="tool-group__head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tool-card__kind" aria-hidden>
          <Icon name={icon} size={15} />
        </span>
        <span className="tool-card__label">{groupLabel(calls)}</span>
        <span className="tool-group__meta">
          {calls.length} call{calls.length === 1 ? '' : 's'}
        </span>
        <span className="tool-card__chevron" aria-hidden>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </span>
        <span className="tool-card__status" aria-hidden>
          <ToolStatusIcon status={status} />
        </span>
      </button>
      {open && (
        <div className="tool-group__steps">
          {calls.map((tc, index) => (
            <ToolStepView key={tc.id} tc={tc} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

function SkillTaggedText({ text }: { text: string }) {
  const parts: Array<string | { skill: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(/(?:^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)\b/gi)) {
    const full = match[0];
    const index = match.index ?? 0;
    const prefixLength = full.startsWith('/') ? 0 : 1;
    const tokenStart = index + prefixLength;
    if (tokenStart > cursor) parts.push(text.slice(cursor, tokenStart));
    parts.push({ skill: match[1] });
    cursor = index + full.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return (
    <>
      {parts.map((part, index) =>
        typeof part === 'string' ? part : <span key={index} className="bubble-skill-token">{part.skill}</span>,
      )}
    </>
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

function memoryUpdateLabel(count: number): string {
  return count > 1 ? `${count} memories updated` : 'Memory updated';
}

/** The memories pulled into this response — an expand/collapse card (read-only; manage memories in Settings). */
function MemoryUsedStrip({ memories }: { memories: MessageMemoryRef[] }) {
  const [open, setOpen] = useState(false);
  if (!memories.length) return null;

  return (
    <div className={`sources ${open ? 'sources--open' : ''}`}>
      <button type="button" className="sources__toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon name="database" size={14} />
        <span className="sources__toggle-label">
          {memories.length} {memories.length === 1 ? 'memory' : 'memories'} used
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} className="sources__caret" />
      </button>
      {open && (
        <div className="sources__list">
          {memories.map((memory, index) => (
            <div key={memory.memoryId} className="source-chip source-chip--memory" style={{ alignItems: 'flex-start' }}>
              <span className="source-chip__num">{index + 1}</span>
              <span className="source-chip__text" style={{ whiteSpace: 'normal' }}>
                <strong>{memory.kind.replace(/_/g, ' ')}</strong>: {memory.text}
              </span>
            </div>
          ))}
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
    <div className="msg-group msg-group--user" data-prompt-id={message.id}>
      {message.attachments && message.attachments.length > 0 && (
        <div className="msg-group__attachments">
          <AttachmentList attachments={message.attachments} />
        </div>
      )}
      {message.content && <div className="bubble-user"><SkillTaggedText text={message.content} /></div>}
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
  memoryUpdateCount?: number;
  threadImages?: ImageRef[];
  viewerImageId?: string | null;
  onOpenImage?: (image: ImageRef) => void;
  onSelectImage?: (image: ImageRef) => void;
  onCloseImage?: () => void;
}

export function AssistantMessage({
  message,
  streaming,
  onRegenerate,
  memoryUpdateCount,
  threadImages,
  viewerImageId,
  onOpenImage,
  onSelectImage,
  onCloseImage,
}: AssistantProps) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pushToast = useUi((s) => s.pushToast);
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
  const pendingImages = message.images?.length ? undefined : derivedPending.length ? derivedPending : message.pendingImages;
  // Image tool calls are conveyed by the placeholder / final image, so keep them out of the card
  // strip. A failed image call is only useful if no later image succeeded.
  const hasGeneratedImages = (message.images?.length ?? 0) > 0;
  const toolCards = (message.toolCalls ?? []).filter((tc) => {
    if (tc.kind !== 'image') return true;
    return tc.status === 'error' && !hasGeneratedImages;
  });
  const toolEntries = groupedToolCards(toolCards);

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
    setSpeaking(true);
    try {
      const settings = await repo.getSettings().catch(() => null);
      const spoken = speakableText(message.content).slice(0, 4000);
      const { audioBase64, mime } = await cloudApi.synthesizeSpeech({
        input: spoken || message.content.slice(0, 4000),
        voice: settings?.voice.voiceId,
        speed: settings?.voice.rate,
      });
      if (!audioBase64) {
        setSpeaking(false);
        return;
      }
      const url = URL.createObjectURL(base64ToBlob(audioBase64, mime));
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

        {toolEntries.length > 0 && (
          <div className="tool-cards" aria-live="polite">
            {toolEntries.map((entry) => (
              entry.type === 'tool-group' ? (
                <ToolGroup key={entry.id} calls={entry.calls} />
              ) : (
                <ToolCardView key={entry.tc.id} tc={entry.tc} />
              )
            ))}
          </div>
        )}

        <GeneratedImages
          images={message.images}
          pending={pendingImages}
          threadImages={threadImages}
          viewerImageId={viewerImageId}
          onOpenImage={onOpenImage}
          onSelectImage={onSelectImage}
          onCloseImage={onCloseImage}
        />

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

        {!isStreamingThis && message.memoryRefs?.length ? <MemoryUsedStrip memories={message.memoryRefs} /> : null}

        {!isStreamingThis && memoryUpdateCount ? (
          <div className="assistant__memory-note" role="note">
            <Icon name="database" size={13} />
            {memoryUpdateLabel(memoryUpdateCount)}
          </div>
        ) : null}

        <ArtifactList artifacts={message.artifacts} />

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
