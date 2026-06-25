import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../design/ui';
import { Icon } from '../../design/icons';
import { ToolsMenu } from './ToolsMenu';
import { startRecording, type Recorder } from '../../lib/audio';
import { transcribe } from '../../ai/transcribe';
import { mockTranscribe } from '../../ai/mockAi';
import { newId } from '../../lib/ids';
import { useUi } from '../../state/store';

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string, files?: File[]) => void;
  streaming: boolean;
  onStop: () => void;
  placeholder?: string;
}

interface Pending {
  id: string;
  file: File;
  url: string;
}

export function Composer({ value, onChange, onSend, streaming, onStop, placeholder }: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
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

  // Revoke preview object URLs on unmount.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const addFiles = (list: FileList | File[]) => {
    const all = Array.from(list);
    const imgs = all.filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) {
      if (all.length) pushToast('Only image files are supported right now', 'info');
      return;
    }
    setPending((prev) => [
      ...prev,
      ...imgs.map((file) => ({ id: newId(), file, url: URL.createObjectURL(file) })),
    ]);
  };

  const removePending = (id: string) => {
    setPending((prev) => {
      const hit = prev.find((p) => p.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  const submit = () => {
    if (streaming) return;
    const text = value.trim();
    if (!text && pending.length === 0) return;
    onSend(
      text,
      pending.map((p) => p.file),
    );
    onChange('');
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    setPending([]);
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
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  };

  const canSend = value.trim().length > 0 || pending.length > 0;

  return (
    <div className="composer-wrap">
      {pending.length > 0 && (
        <div className="composer__attachments">
          {pending.map((p) => (
            <div key={p.id} className="composer-thumb">
              <img src={p.url} alt={p.file.name} />
              <button
                type="button"
                className="composer-thumb__remove"
                aria-label={`Remove ${p.file.name}`}
                onClick={() => removePending(p.id)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className={`composer ${focused ? 'composer--focus' : ''} ${dragging ? 'composer--drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <IconButton name="plus" label="Add image" onClick={() => fileRef.current?.click()} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <ToolsMenu />
        <textarea
          ref={taRef}
          className="composer__textarea"
          rows={1}
          value={value}
          placeholder={recording ? 'Listening…' : placeholder ?? 'Message Watai'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
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
