import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconButton, Spinner } from '../../design/ui';
import { Icon } from '../../design/icons';
import { readLevel, startRecording, type Recorder } from '../../lib/audio';
import { repo, cloudApi, skillsApi } from '../../data';
import { isImageUpload, normalizeImageUpload } from '../../lib/imageUpload';
import { insertAtCaret } from '../../lib/caret';
import { WaveformVisualizer } from '../voice/WaveformVisualizer';
import { createVad } from '../../lib/vad';
import { newId } from '../../lib/ids';
import { useUi } from '../../state/store';
import type { SkillSummary } from '../../lib/types';
import type { StagedLibraryItem } from '../../state/store';
import { LibraryPicker } from '../library/LibraryPicker';

interface ComposerProps {
  threadId: string;
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string, files?: File[], skillNames?: string[], librarySelections?: StagedLibraryItem[]) => void;
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

type DictationState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';

const MAX_DICTATION_MS = 2 * 60_000;
const MAX_DICTATION_BYTES = 20 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 125_000;

function dictationStartError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Allow it in browser settings and try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No available microphone was found.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The microphone is busy or unavailable.';
  if (name === 'NotSupportedError') return 'Audio recording is not supported by this browser.';
  return error instanceof Error ? error.message : 'Could not start dictation.';
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function DictationTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <>{formatElapsed(elapsed)}</>;
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

export function Composer({ threadId, value, onChange, onSend, streaming, onStop, placeholder, locked, autoFocus }: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const recOverlayRef = useRef<HTMLDivElement>(null);
  const pendingFlipRef = useRef<{ rects: Map<string, DOMRect>; height: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const [dictationState, setDictationState] = useState<DictationState>('idle');
  const [pending, setPending] = useState<Pending[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [transcriptionConfigured, setTranscriptionConfigured] = useState<boolean | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillQuery, setSkillQuery] = useState<SkillQuery | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const recRef = useRef<Recorder | null>(null);
  const dictationBusyRef = useRef(false);
  const dictationFinishingRef = useRef(false);
  const dictationOpRef = useRef(0);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const retainedAudioRef = useRef<Blob | null>(null);
  const finishDictationRef = useRef<() => void>(() => undefined);
  const cancelDictationRef = useRef<() => void>(() => undefined);
  const autoStopRef = useRef({ enabled: false, sensitivity: 0.5 });
  const recCaretRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const recStartRef = useRef(0);
  const pushToast = useUi((s) => s.pushToast);
  const stagedFiles = useUi((s) => s.stagedFiles);
  const clearStagedFiles = useUi((s) => s.clearStagedFiles);
  const stagedLibrary = useUi((s) => s.stagedLibraryByThread[threadId] ?? []);
  const stageLibraryItems = useUi((s) => s.stageLibraryItems);
  const removeStagedLibraryItem = useUi((s) => s.removeStagedLibraryItem);
  const clearStagedLibraryItems = useUi((s) => s.clearStagedLibraryItems);

  // Auto-grow the textarea and decide between the compact single-line layout and the
  // two-row multiline layout. The moment the text wraps past a single line the composer
  // switches to multiline (input on its own row, controls beneath) and stays there for the
  // rest of this prompt — it only relaxes back to single-line once the field is cleared
  // (i.e. after the prompt is sent), so the layout never flickers mid-typing. Runs as a
  // layout effect so the height is settled before the FLIP effect below measures.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    // Snapshot geometry BEFORE mutating height/layout, so if this commit flips the mode the
    // FLIP animates from the last on-screen single-line (or multiline) frame, not a half-grown one.
    const snapshot = () => {
      const root = composerRef.current;
      if (!root) return null;
      const rects = new Map<string, DOMRect>();
      for (const key of ['plus', 'input', 'mic', 'primary']) {
        const el = root.querySelector<HTMLElement>(`.composer__${key}`);
        if (el) rects.set(key, el.getBoundingClientRect());
      }
      return { rects, height: root.getBoundingClientRect().height };
    };
    const before = snapshot();
    ta.style.height = 'auto';
    const sh = ta.scrollHeight;
    ta.style.height = `${Math.min(sh, 200)}px`;
    if (!value.trim()) {
      if (multiline && before) pendingFlipRef.current = before;
      setMultiline(false);
      return;
    }
    if (!multiline) {
      const cs = getComputedStyle(ta);
      let lineHeight = parseFloat(cs.lineHeight);
      if (!Number.isFinite(lineHeight)) lineHeight = parseFloat(cs.fontSize) * 1.4;
      const oneLine = lineHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      if (sh > oneLine + lineHeight * 0.5) {
        if (before) pendingFlipRef.current = before;
        setMultiline(true);
      }
    }
  }, [value, multiline]);

  // Smoothly animate the switch between the single-line and two-row layouts. Grid reflows
  // are instant, so we FLIP: translate the controls + input from where they sat before the
  // change back to their new cells (to zero) while easing the container height. The "before"
  // geometry was captured in the layout effect above just prior to the mode flip.
  useLayoutEffect(() => {
    const root = composerRef.current;
    const before = pendingFlipRef.current;
    pendingFlipRef.current = null;
    if (!root || !before) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const DURATION = 220;
    const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
    const afterHeight = root.getBoundingClientRect().height;
    const anims = [
      root.animate(
        [{ height: `${before.height}px` }, { height: `${afterHeight}px` }],
        { duration: DURATION, easing: EASE },
      ),
    ];
    for (const key of ['plus', 'input', 'mic', 'primary']) {
      const el = root.querySelector<HTMLElement>(`.composer__${key}`);
      const from = before.rects.get(key);
      if (!el || !from) continue;
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      anims.push(
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
          { duration: DURATION, easing: EASE },
        ),
      );
    }
    const restore = root.style.overflow;
    root.style.overflow = 'clip';
    void Promise.allSettled(anims.map((a) => a.finished)).then(() => {
      root.style.overflow = restore;
    });
  }, [multiline]);

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

  useEffect(() => {
    let live = true;
    cloudApi
      .getCredentialStatus()
      .then((status) => {
        if (live) setTranscriptionConfigured(!!status.capabilities?.transcribe);
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

  const addFiles = async (list: FileList | File[]) => {
    const all = Array.from(list);
    if (all.length === 0) return;
    const normalized = await Promise.all(
      all.map(async (file) => {
        if (!isImageUpload(file)) return file;
        try {
          return await normalizeImageUpload(file);
        } catch {
          pushToast(
            `${file.name} could not be prepared. Export it as a JPEG or PNG and try again.`,
            'error',
          );
          return null;
        }
      }),
    );
    const ready = normalized.filter((file): file is File => file !== null);
    if (!ready.length) return;
    setPending((prev) => [
      ...prev,
      ...ready.map((file) => ({
        id: newId(),
        file,
        // Images get an object URL for a thumbnail; documents render as a file chip.
        url: isImageUpload(file) ? URL.createObjectURL(file) : '',
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

  // Consume files staged from elsewhere (e.g. a web image's "Use" action) into the pending list.
  useEffect(() => {
    if (!stagedFiles.length) return;
    void addFiles(stagedFiles);
    clearStagedFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedFiles]);

  const submit = () => {
    if (streaming || locked) return;
    const text = value.trim();
    if (!text && pending.length === 0 && stagedLibrary.length === 0) return;
    const taggedSkills = skillNamesInText(text, skills);
    onSend(
      text,
      pending.map((p) => p.file),
      taggedSkills,
      stagedLibrary,
    );
    onChange('');
    setSkillQuery(null);
    pending.forEach((p) => p.url && URL.revokeObjectURL(p.url));
    setPending([]);
    clearStagedLibraryItems(threadId);
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
    if (dictationBusyRef.current) return;
    dictationBusyRef.current = true;
    const operation = ++dictationOpRef.current;
    setDictationState('requesting');
    const ta = taRef.current;
    recCaretRef.current = {
      start: ta?.selectionStart ?? value.length,
      end: ta?.selectionEnd ?? value.length,
    };
    try {
      const settings = await repo.getSettings().catch(() => null);
      const recorder = await startRecording(settings?.voice.inputDeviceId);
      if (operation !== dictationOpRef.current) {
        recorder.cancel();
        return;
      }
      recRef.current = recorder;
      recorder.onInterruption(() => {
        if (operation !== dictationOpRef.current) return;
        cancelDictationRef.current();
        pushToast('Microphone capture was interrupted.', 'error');
      });
      autoStopRef.current = {
        enabled: settings?.voice.autoStopDictation ?? false,
        sensitivity: settings?.voice.vad ?? 0.5,
      };
      recStartRef.current = Date.now();
      setDictationState('recording');
    } catch (error) {
      if (operation !== dictationOpRef.current) return;
      dictationBusyRef.current = false;
      setDictationState('idle');
      pushToast(dictationStartError(error), 'error');
    }
  };

  const transcribeDictation = async (blob: Blob, operation: number) => {
    setDictationState('transcribing');
    let failed = false;
    try {
      const controller = new AbortController();
      transcriptionAbortRef.current = controller;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, TRANSCRIPTION_TIMEOUT_MS);
      let text: string;
      try {
        ({ text } = await cloudApi.transcribeAudio({
          audio: blob,
          mime: blob.type,
        }, controller.signal));
      } catch (error) {
        if (timedOut) throw new Error('Transcription timed out. Check your connection and try again.');
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }
      if (operation !== dictationOpRef.current) return;
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
      if (operation !== dictationOpRef.current || (e instanceof DOMException && e.name === 'AbortError')) return;
      failed = true;
      retainedAudioRef.current = blob;
      setDictationState('error');
      pushToast(e instanceof Error ? e.message : 'Transcription failed', 'error');
    } finally {
      if (operation === dictationOpRef.current) {
        transcriptionAbortRef.current = null;
        dictationFinishingRef.current = false;
        if (!failed) {
          retainedAudioRef.current = null;
          dictationBusyRef.current = false;
          setDictationState('idle');
        }
      }
    }
  };

  const acceptDictation = async () => {
    if (!dictationBusyRef.current || dictationFinishingRef.current) return;
    dictationFinishingRef.current = true;
    const operation = dictationOpRef.current;
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) {
      dictationFinishingRef.current = false;
      dictationBusyRef.current = false;
      setDictationState('idle');
      return;
    }
    setDictationState('transcribing');
    try {
      const blob = await rec.stop();
      if (operation !== dictationOpRef.current) return;
      if (!blob.size) throw new Error('No audio was captured.');
      if (blob.size > MAX_DICTATION_BYTES) throw new Error('Dictation is too large. Record two minutes or less.');
      await transcribeDictation(blob, operation);
    } catch (error) {
      if (operation !== dictationOpRef.current) return;
      dictationFinishingRef.current = false;
      dictationBusyRef.current = false;
      setDictationState('idle');
      pushToast(error instanceof Error ? error.message : 'Could not finish dictation.', 'error');
    }
  };

  const retryDictation = () => {
    const blob = retainedAudioRef.current;
    if (!blob || dictationFinishingRef.current || transcriptionAbortRef.current) return;
    dictationFinishingRef.current = true;
    void transcribeDictation(blob, dictationOpRef.current);
  };

  const cancelDictation = () => {
    dictationOpRef.current += 1;
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    retainedAudioRef.current = null;
    dictationFinishingRef.current = false;
    recRef.current?.cancel();
    recRef.current = null;
    dictationBusyRef.current = false;
    setDictationState('idle');
  };

  finishDictationRef.current = () => void acceptDictation();
  cancelDictationRef.current = cancelDictation;

  useEffect(() => {
    if (dictationState !== 'recording') return;
    const remaining = Math.max(0, MAX_DICTATION_MS - (Date.now() - recStartRef.current));
    const timer = window.setTimeout(() => finishDictationRef.current(), remaining);
    return () => window.clearTimeout(timer);
  }, [dictationState]);

  useEffect(() => {
    if (dictationState !== 'requesting') return;
    const frame = requestAnimationFrame(() => recOverlayRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [dictationState]);

  useEffect(() => {
    if (dictationState !== 'recording' || !autoStopRef.current.enabled) return;
    const vad = createVad({ sensitivity: autoStopRef.current.sensitivity, silenceMs: 900 });
    let frame = 0;
    const sample = (now: number) => {
      const analyser = recRef.current?.analyser;
      if (analyser && vad.push(readLevel(analyser), now) === 'speechend') {
        finishDictationRef.current();
        return;
      }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [dictationState]);

  useEffect(() => {
    const stopForInterruption = () => {
      if (document.hidden) cancelDictationRef.current();
    };
    document.addEventListener('visibilitychange', stopForInterruption);
    window.addEventListener('pagehide', cancelDictationRef.current);
    return () => {
      document.removeEventListener('visibilitychange', stopForInterruption);
      window.removeEventListener('pagehide', cancelDictationRef.current);
      cancelDictationRef.current();
    };
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter(isImageUpload);
    if (imgs.length) {
      e.preventDefault();
      void addFiles(imgs);
    }
  };

  const canSend = value.trim().length > 0 || pending.length > 0 || stagedLibrary.length > 0;
  const hasHighlight = value.length > 0;
  const recording = dictationState === 'recording';
  const transcribing = dictationState === 'transcribing';
  const dictationActive = dictationState !== 'idle';
  const dictationStatus = dictationState === 'requesting' ? 'Requesting microphone access' : recording ? 'Listening' : transcribing ? 'Transcribing dictation' : dictationState === 'error' ? 'Transcription failed' : '';
  const dictationSupported = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const dictationUnavailable = !dictationSupported || transcriptionConfigured === false;

  return (
    <div className="composer-wrap">
      {(pending.length > 0 || stagedLibrary.length > 0) && (
        <div className="composer__attachments">
          {stagedLibrary.map((selection) => (
            <div key={selection.item.id} className="composer-file composer-library-item" title={selection.item.userMetadata?.title ?? selection.item.name}>
              {selection.item.kind === 'image' && (selection.item.thumbnailUrl ?? selection.item.url) ? (
                <img className="composer-library-item__thumb" src={selection.item.thumbnailUrl ?? selection.item.url} alt="" />
              ) : (
                <Icon name={selection.item.kind === 'image' ? 'file-image' : 'file-text'} size={16} />
              )}
              <span className="composer-file__name">{selection.item.userMetadata?.title ?? selection.item.name}</span>
              {selection.item.kind === 'image' && (
                <button
                  type="button"
                  className="composer-library-item__mode"
                  onClick={() => stageLibraryItems(threadId, [{ ...selection, mode: selection.mode === 'attach' ? 'reference' : 'attach' }])}
                  aria-label={`${selection.mode === 'attach' ? 'Attach for analysis' : 'Use as generation reference'}: ${selection.item.name}`}
                >
                  {selection.mode === 'attach' ? 'Analyze' : 'Reference'}
                </button>
              )}
              <button
                type="button"
                className="composer-file__remove"
                aria-label={`Remove ${selection.item.name}`}
                onClick={() => removeStagedLibraryItem(threadId, selection.item.id)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
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
        ref={composerRef}
        className={`composer ${multiline ? 'composer--multiline' : ''} ${focused ? 'composer--focus' : ''} ${dragging ? 'composer--drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {dictationActive && (
          <div ref={recOverlayRef} className="composer__rec" aria-label={dictationStatus}>
            <span className="sr-only" role="status" aria-live="polite">{dictationStatus}</span>
            <IconButton name="close" label="Cancel dictation" onClick={cancelDictation} big />
            <WaveformVisualizer analyser={recRef.current?.analyser ?? null} className="composer__rec-wave" />
            <span className="composer__rec-timer">{recording ? <DictationTimer startedAt={recStartRef.current} /> : dictationState === 'requesting' ? 'Ready' : dictationState === 'error' ? 'Try again' : 'Working'}</span>
            {transcribing ? (
              <Spinner size="sm" />
            ) : recording ? (
              <IconButton name="check" label="Insert transcript" variant="accent" onClick={acceptDictation} big />
            ) : dictationState === 'error' ? (
              <IconButton name="refresh" label="Retry transcription" variant="accent" onClick={retryDictation} big />
            ) : (
              <Spinner size="sm" />
            )}
          </div>
        )}
        <div className="composer__plus-wrap">
          <IconButton name="plus" className="composer__plus" label="Add attachment" aria-expanded={addMenuOpen} disabled={dictationActive} onClick={() => setAddMenuOpen((open) => !open)} />
          {addMenuOpen && (
            <div className="composer-add-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); fileRef.current?.click(); }}><Icon name="upload" size={18} /> Upload from device</button>
              <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); setPickerOpen(true); }}><Icon name="library" size={18} /> Add from Library</button>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,text/plain,text/markdown,text/csv,application/json,.md,.markdown,.docx,.pptx,.xlsx"
          multiple
          hidden
          disabled={dictationActive}
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
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
            disabled={dictationActive}
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
        {dictationActive ? (
          <Spinner size="sm" className="composer__mic composer__spinner" />
        ) : (
          <IconButton
            name="mic"
            className="composer__mic"
            label={!dictationSupported ? 'Dictation is not supported by this browser' : transcriptionConfigured === false ? 'Configure a transcription model to use dictation' : 'Dictate'}
            variant="muted"
            disabled={dictationUnavailable}
            onClick={startDictation}
          />
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
            disabled={!canSend || locked || dictationActive}
            onClick={submit}
          />
        )}
      </div>
      {pickerOpen && <LibraryPicker threadId={threadId} onClose={() => setPickerOpen(false)} returnFocus={() => taRef.current?.focus()} />}
      <p className="muted composer__footnote" style={{ textAlign: 'center', fontSize: 'var(--text-caption-size)', margin: 'var(--space-3) 0 0' }}>
        Watai can make mistakes. Check important info.
      </p>
    </div>
  );
}
