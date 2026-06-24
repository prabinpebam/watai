import { useRef, useState } from 'react';
import { Markdown } from './Markdown';
import { AttachmentList, GeneratedImages } from './Attachments';
import { IconButton } from '../../design/ui';
import { Icon } from '../../design/icons';
import { Menu, type MenuItemDef } from '../../design/overlays';
import { useUi } from '../../state/store';
import { synthesize } from '../../ai/tts';
import type { Message } from '../../lib/types';

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
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
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

  const vote = (dir: 'up' | 'down') => {
    setFeedback((cur) => (cur === dir ? null : dir));
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

  const moreItems: MenuItemDef[] = [
    { label: 'Copy text', icon: 'copy', onClick: copy },
    { label: speaking ? 'Stop reading' : 'Read aloud', icon: 'speaker', onClick: readAloud },
    { label: 'Regenerate', icon: 'refresh', onClick: onRegenerate },
  ];

  return (
    <div className="msg-group msg-group--assistant">
      <div className="assistant">
        <div className="assistant__role">
          <span className="avatar avatar--assistant" style={{ width: 28, height: 28, fontSize: 13 }}>
            <Icon name="sparkle" size={15} />
          </span>
          <span className="assistant__name">Watai</span>
        </div>

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
              name="thumbs-up"
              label="Good response"
              size={18}
              filled={feedback === 'up'}
              className={feedback === 'up' ? 'icon-btn--active' : ''}
              onClick={() => vote('up')}
            />
            <IconButton
              name="thumbs-down"
              label="Bad response"
              size={18}
              filled={feedback === 'down'}
              className={feedback === 'down' ? 'icon-btn--active' : ''}
              onClick={() => vote('down')}
            />
            <IconButton
              name="speaker"
              label={speaking ? 'Stop reading' : 'Read aloud'}
              size={18}
              filled={speaking}
              className={speaking ? 'icon-btn--active' : ''}
              onClick={readAloud}
            />
            <IconButton
              name="more"
              label="More"
              size={18}
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenu({ x: r.left, y: r.bottom + 4 });
              }}
            />
          </div>
        )}
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={moreItems} onClose={() => setMenu(null)} />}
    </div>
  );
}
