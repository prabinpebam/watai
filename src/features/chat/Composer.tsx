import { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton, Spinner } from '../../design/ui';
import { Icon } from '../../design/icons';
import { startRecording, type Recorder } from '../../lib/audio';
import { cloudApi, skillsApi } from '../../data';
import { fileToBase64 } from '../../lib/files';
import { insertAtCaret } from '../../lib/caret';
import { WaveformVisualizer } from '../voice/WaveformVisualizer';
import { newId } from '../../lib/ids';
import { useUi } from '../../state/store';
import type { SkillSummary } from '../../lib/types';

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string, files?: File[], skillNames?: string[]) => void;
  streaming: boolean;
  onStop: () => void;
  placeholder?: string;
  /** Another device is generating a reply in this thread — sending is blocked until it finishes. */
  locked?: boolean;
  /** Focus the input when this becomes true (e.g. a new/empty chat was opened). */
  autoFocus?: boolean;
}

interface Pending {
  id: string;
  file: File;
  url: string;
}

interface SkillQuery {
  start: number;
  end: number;
  query: string;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function skillQueryAt(value: string, caret: number): SkillQuery | null {
  const before = value.slice(0, caret);
  const match = /(?:^|\s)\/([a-z0-9-]*)$/i.exec(before);
  if (!match) return null;
  const start = caret - match[1].length - 1;
  return { start, end: caret, query: match[1].toLowerCase() };
}

function skillNamesInText(value: string, skills: SkillSummary[]): string[] {
  const valid = new Set(skills.map((skill) => skill.name));
  const names = new Set<string>();
  for (const match of value.matchAll(/(?:^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)\b/gi)) {
    const name = match[1].toLowerCase();
    if (valid.has(name)) names.add(name);
  }
  return [...names];
}

function HighlightedValue({ value, skills }: { value: string; skills: SkillSummary[] }) {
  const valid = new Set(skills.map((skill) => skill.name));
  const parts: Array<{ text: string; skill?: boolean }> = [];
  let cursor = 0;
  for (const match of value.matchAll(/(?:^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)\b/gi)) {
    const full = match[0];
    const name = match[1].toLowerCase();
    const index = match.index ?? 0;
    const prefixLength = full.startsWith('/') ? 0 : 1;
    const tokenStart = index + prefixLength;
    if (tokenStart > cursor) parts.push({ text: value.slice(cursor, tokenStart) });
    const token = value.slice(tokenStart, index + full.length);
    parts.push({ text: token, skill: valid.has(name) });
    cursor = index + full.length;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return (
    <>
      {parts.map((part, index) =>
        part.skill ? (
          <span key={index} className="composer-skill-token">
            <span className="composer-skill-token__prefix">/</span>
            {part.text.slice(1)}
          </span>
        ) : <span key={index}>{part.text}</span>,
      )}
    </>
  );
}

export function Composer({ value, onChange, onSend, streaming, onStop, placeholder, locked, autoFocus }: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillQuery, setSkillQuery] = useState<SkillQuery | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const recRef = useRef<Recorder | null>(null);
  const recCaretRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const recStartRef = useRef(0);
  const [recElapsed, setRecElapsed] = useState(0);
  const pushToast = useUi((s) => s.pushToast);

  // Auto-grow
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  // Focus the input when a new/empty chat is opened, so the user can start typing immediately.
  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    let live = true;
    skillsApi
      .list()
      .then((list) => {
        if (!live) return;
        const byName = new Map<string, SkillSummary>();
        for (const skill of list) {
          if (skill.enabled && skill.status === 'ready' && !byName.has(skill.name)) byName.set(skill.name, skill);
        }
        setSkills([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Revoke preview object URLs on unmount.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((p) => p.url && URL.revokeObjectURL(p.url)), []);

  // Dictation recording timer; also stop the recorder if the composer unmounts mid-capture.
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setRecElapsed(Date.now() - recStartRef.current), 250);
    return () => window.clearInterval(id);
  }, [recording]);
  useEffect(() => () => recRef.current?.cancel(), []);

  const addFiles = (list: FileList | File[]) => {
    const all = Array.from(list);
    if (all.length === 0) return;
    setPending((prev) => [
      ...prev,
      ...all.map((file) => ({
        id: newId(),
        file,
        // Images get an object URL for a thumbnail; documents render as a file chip.
        url: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      })),
    ]);
  };

  const removePending = (id: string) => {
    setPending((prev) => {
      const hit = prev.find((p) => p.id === id);
      if (hit?.url) URL.revokeObjectURL(hit.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  const submit = () => {
    if (streaming || locked) return;
    const text = value.trim();
    if (!text && pending.length === 0) return;
    const taggedSkills = skillNamesInText(text, skills);
    onSend(
      text,
      pending.map((p) => p.file),
      taggedSkills,
    );
    onChange('');
    setSkillQuery(null);
    pending.forEach((p) => p.url && URL.revokeObjectURL(p.url));
    setPending([]);
  };

  const suggestions = useMemo(() => {
    if (!skillQuery) return [];
    return skills
      .filter((skill) => skill.name.startsWith(skillQuery.query))
      .slice(0, 8);
  }, [skillQuery, skills]);

  const updateSkillQuery = () => {
    const ta = taRef.current;
    if (!ta) return;
    const next = skillQueryAt(ta.value, ta.selectionStart);
    setSkillQuery(next);
    setSkillIndex((index) => {
      if (!next) return 0;
      if (!skillQuery || skillQuery.start !== next.start || skillQuery.end !== next.end || skillQuery.query !== next.query) {
        return 0;
      }
      return index;
    });
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;
    updateSkillQuery();
  };

  const chooseSkill = (skill: SkillSummary) => {
    const query = skillQuery;
    if (!query) return;
    const next = `${value.slice(0, query.start)}/${skill.name} ${value.slice(query.end)}`;
    onChange(next);
    setSkillQuery(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const pos = query.start + skill.name.length + 2;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (skillQuery && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSkillIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSkillIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        chooseSkill(suggestions[skillIndex] ?? suggestions[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSkillQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const startDictation = async () => {
    const ta = taRef.current;
    recCaretRef.current = {
      start: ta?.selectionStart ?? value.length,
      end: ta?.selectionEnd ?? value.length,
    };
    try {
      recRef.current = await startRecording();
      recStartRef.current = Date.now();
      setRecElapsed(0);
      setRecording(true);
    } catch {
      pushToast('Microphone permission is needed for dictation', 'error');
    }
  };

  const acceptDictation = async () => {
    const rec = recRef.current;
    recRef.current = null;
    setRecording(false);
    if (!rec) return;
    setTranscribing(true);
    try {
      const blob = await rec.stop();
      const { text } = await cloudApi.transcribeAudio({
        audioBase64: await fileToBase64(blob),
        mime: blob.type || 'audio/webm',
      });
      const trimmed = text.trim();
      if (trimmed) {
        const { start, end } = recCaretRef.current;
        const next = insertAtCaret(value, start, end, trimmed);
        onChange(next.value);
        requestAnimationFrame(() => {
          const ta = taRef.current;
          if (ta) {
            ta.focus();
            ta.setSelectionRange(next.caret, next.caret);
          }
        });
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Transcription failed', 'error');
    } finally {
      setTranscribing(false);
    }
  };

  const cancelDictation = () => {
    recRef.current?.cancel();
    recRef.current = null;
    setRecording(false);
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
  const hasHighlight = value.length > 0;

  return (
    <div className="composer-wrap">
      {pending.length > 0 && (
        <div className="composer__attachments">
          {pending.map((p) =>
            p.url ? (
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
            ) : (
              <div key={p.id} className="composer-file" title={p.file.name}>
                <Icon name="file-text" size={16} />
                <span className="composer-file__name">{p.file.name}</span>
                <button
                  type="button"
                  className="composer-file__remove"
                  aria-label={`Remove ${p.file.name}`}
                  onClick={() => removePending(p.id)}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ),
          )}
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
        {(recording || transcribing) && (
          <div className="composer__rec">
            <IconButton name="close" label="Cancel dictation" onClick={cancelDictation} disabled={transcribing} />
            <WaveformVisualizer analyser={recRef.current?.analyser ?? null} className="composer__rec-wave" />
            <span className="composer__rec-timer">{formatElapsed(recElapsed)}</span>
            {transcribing ? (
              <Spinner size="sm" />
            ) : (
              <IconButton name="check" label="Insert transcript" variant="accent" onClick={acceptDictation} />
            )}
          </div>
        )}
        <IconButton name="plus" label="Attach image or file" onClick={() => fileRef.current?.click()} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,text/plain,text/markdown,text/csv,application/json,.md,.markdown,.docx,.pptx,.xlsx"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="composer__input">
          {hasHighlight && (
            <div ref={highlightRef} className="composer__highlights" aria-hidden="true">
              <HighlightedValue value={value} skills={skills} />
            </div>
          )}
          {skillQuery && suggestions.length > 0 && (
            <div className="skill-suggest" role="listbox" aria-label="Skills">
              {suggestions.map((skill, index) => (
                <button
                  key={skill.id}
                  type="button"
                  className={`skill-suggest__item ${index === skillIndex ? 'is-active' : ''}`}
                  role="option"
                  aria-selected={index === skillIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    chooseSkill(skill);
                  }}
                >
                  <span className="skill-suggest__name">/{skill.name}</span>
                  <span className="skill-suggest__desc">{skill.description}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            className={`composer__textarea ${hasHighlight ? 'composer__textarea--highlighted' : ''}`}
            rows={1}
            value={value}
            placeholder={recording ? 'Listening…' : locked ? 'Waiting for the other device to finish…' : placeholder ?? 'Message Watai'}
            onChange={(e) => {
              onChange(e.target.value);
              requestAnimationFrame(updateSkillQuery);
            }}
            onClick={updateSkillQuery}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onPaste={onPaste}
            onScroll={(e) => {
              if (highlightRef.current) highlightRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onFocus={() => {
              setFocused(true);
              updateSkillQuery();
            }}
            onBlur={() => {
              setFocused(false);
              window.setTimeout(() => setSkillQuery(null), 120);
            }}
            aria-label="Message"
          />
        </div>
        {transcribing ? (
          <Spinner size="sm" className="composer__spinner" />
        ) : (
          <IconButton name="mic" label="Dictate" variant="muted" onClick={startDictation} />
        )}
        {streaming ? (
          <IconButton key="stop" className="composer__primary" name="stop" label="Stop generating" variant="accent" onClick={onStop} />
        ) : (
          <IconButton
            key="send"
            className="composer__primary"
            name="arrow-up"
            label={locked ? 'Waiting for the other device' : 'Send'}
            variant="accent"
            disabled={!canSend || locked}
            onClick={submit}
          />
        )}
      </div>
      <p className="muted" style={{ textAlign: 'center', fontSize: 'var(--text-caption-size)', margin: 'var(--space-3) 0 0' }}>
        Watai can make mistakes. Check important info.
      </p>
    </div>
  );
}
