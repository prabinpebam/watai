import { useState } from 'react';
import { Markdown } from './Markdown';
import { IconButton } from '../../design/ui';
import { Icon } from '../../design/icons';
import { useUi } from '../../state/store';
import { synthesize } from '../../ai/tts';
import type { Message } from '../../lib/types';

export function UserMessage({ message }: { message: Message }) {
  return (
    <div className="msg-group msg-group--user">
      <div className="bubble-user">{message.content}</div>
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
    if (mockAi) {
      pushToast('Read-aloud uses your real endpoint', 'info');
      return;
    }
    setSpeaking(true);
    try {
      const blob = await synthesize({ input: message.content.slice(0, 4000) });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
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
            <Icon name="sparkle" size={16} />
          </span>
          <span className="assistant__name">Watai</span>
        </div>

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
              name={speaking ? 'speaker' : 'speaker'}
              label="Read aloud"
              size={18}
              onClick={readAloud}
              disabled={speaking}
            />
          </div>
        )}
      </div>
    </div>
  );
}
