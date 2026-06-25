import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../design/ui';
import { Icon } from '../../design/icons';
import { ToolsMenu } from './ToolsMenu';
import { startRecording, type Recorder } from '../../lib/audio';
import { transcribe } from '../../ai/transcribe';
import { mockTranscribe } from '../../ai/mockAi';
import { useUi } from '../../state/store';

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  streaming: boolean;
  onStop: () => void;
  placeholder?: string;
}

export function Composer({ value, onChange, onSend, streaming, onStop, placeholder }: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef<Recorder | null>(null);
  const mockAi = useUi((s) => s.mockAi);
  const pushToast = useUi((s) => s.pushToast);

  // Auto-grow
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  const submit = () => {
    if (streaming) return;
    const text = value.trim();
    if (!text) return;
    onSend(text);
    onChange('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const toggleDictation = async () => {
    if (recording) {
      const rec = recRef.current;
      recRef.current = null;
      setRecording(false);
      if (!rec) return;
      setTranscribing(true);
      try {
        const blob = await rec.stop();
        const { text } = mockAi ? await mockTranscribe() : await transcribe({ file: blob });
        onChange(value ? `${value} ${text}` : text);
        taRef.current?.focus();
      } catch (e) {
        pushToast(e instanceof Error ? e.message : 'Transcription failed', 'error');
      } finally {
        setTranscribing(false);
      }
      return;
    }
    try {
      recRef.current = await startRecording();
      setRecording(true);
    } catch {
      pushToast('Microphone permission is needed for dictation', 'error');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pushToast('Attachments are stored locally in this preview', 'info');
  };

  const canSend = value.trim().length > 0;

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${focused ? 'composer--focus' : ''} ${dragging ? 'composer--drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <IconButton name="plus" label="Add attachment" onClick={() => pushToast('Attachments coming soon', 'info')} />
        <ToolsMenu />
        <textarea
          ref={taRef}
          className="composer__textarea"
          rows={1}
          value={value}
          placeholder={recording ? 'Listening…' : placeholder ?? 'Message Watai'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Message"
        />
        {transcribing ? (
          <span className="spinner" style={{ margin: 8 }} />
        ) : (
          <IconButton
            name={recording ? 'mic-off' : 'mic'}
            label={recording ? 'Stop dictation' : 'Dictate'}
            variant={recording ? 'accent' : 'muted'}
            onClick={toggleDictation}
          />
        )}
        {streaming ? (
          <IconButton key="stop" className="composer__primary" name="stop" label="Stop generating" variant="accent" onClick={onStop} />
        ) : (
          <IconButton
            key="send"
            className="composer__primary"
            name="arrow-up"
            label="Send"
            variant="accent"
            disabled={!canSend}
            onClick={submit}
          />
        )}
      </div>
      <p className="muted" style={{ textAlign: 'center', fontSize: 'var(--text-caption-size)', margin: '8px 0 0' }}>
        {mockAi ? (
          <>
            <Icon name="info" size={12} style={{ verticalAlign: '-2px' }} /> Mock mode — responses are simulated.
          </>
        ) : (
          'Watai uses your own Azure OpenAI endpoint.'
        )}
      </p>
    </div>
  );
}
