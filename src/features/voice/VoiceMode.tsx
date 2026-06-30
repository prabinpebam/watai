import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IconButton, Spinner } from '../../design/ui';
import { startRecording, type Recorder } from '../../lib/audio';
import { cloudApi, repo } from '../../data';
import { fileToBase64, base64ToBlob } from '../../lib/files';
import { newId } from '../../lib/ids';
import { useRuns } from '../chat/runStore';
import { useChat } from '../chat/useChat';
import { createReplySpeaker, type ReplySpeaker } from '../../lib/replySpeaker';
import { createTtsQueue, type TtsClip, type TtsQueue } from '../../lib/ttsQueue';
import type { Settings } from '../../lib/types';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'muted' | 'error';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Tap to speak',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  muted: 'Muted',
  error: 'Something went wrong',
};

export function VoiceMode() {
  const navigate = useNavigate();
  const { threadId: routeThreadId } = useParams();
  // Voice mode always operates on a real thread so the conversation persists in history and gets
  // memory + tools + skills. Mint one when entered fresh (the run lazily creates it on first send).
  const tidRef = useRef(routeThreadId ?? newId());
  const tid = tidRef.current;
  const { send } = useChat(tid);
  const run = useRuns((s) => s.runs[tid]);

  const [listening, setListening] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [errored, setErrored] = useState(false);
  const [caption, setCaption] = useState('');

  const recRef = useRef<Recorder | null>(null);
  const settingsRef = useRef<Settings['voice'] | null>(null);
  const speakerRef = useRef<ReplySpeaker | null>(null);
  const lastContentRef = useRef('');
  const runningRef = useRef(false);
  const turnedRef = useRef(false);

  // Load the voice settings once so each TTS clip doesn't await the repo on the playback path.
  useEffect(() => {
    repo
      .getSettings()
      .then((s) => {
        settingsRef.current = s.voice;
      })
      .catch(() => {});
  }, []);

  // Serial TTS player (created once). Speaks sentence-by-sentence as the reply streams; `stop()`
  // halts the current clip + clears the queue synchronously for snappy barge-in.
  const ttsRef = useRef<TtsQueue | null>(null);
  if (!ttsRef.current) {
    const synthesize = async (text: string): Promise<TtsClip> => {
      // Belt-and-suspenders: never synthesize with the voice unresolved (a null ref would fall back to
      // the backend default and shift the voice mid-reply). stopListening resolves this before the reply.
      if (!settingsRef.current) {
        settingsRef.current = (await repo.getSettings().catch(() => null))?.voice ?? settingsRef.current;
      }
      const v = settingsRef.current;
      const { audioBase64, mime } = await cloudApi.synthesizeSpeech({
        input: text,
        voice: v?.voiceId,
        speed: v?.rate,
      });
      const url = URL.createObjectURL(base64ToBlob(audioBase64, mime));
      const audio = new Audio(url);
      return {
        play: () =>
          new Promise<void>((resolve) => {
            audio.onended = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            audio.onerror = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            void audio.play().catch(() => {
              URL.revokeObjectURL(url);
              resolve();
            });
          }),
        stop: () => {
          audio.pause();
          URL.revokeObjectURL(url);
        },
      };
    };
    ttsRef.current = createTtsQueue({ synthesize, onPlayingChange: setPlaying });
  }
  if (!speakerRef.current) {
    speakerRef.current = createReplySpeaker((t) => ttsRef.current!.enqueue(t));
  }

  // Stream the assistant reply into the TTS queue as it grows. The sentence splitter is prefix-stable,
  // so each push yields only newly completed sentences; speakableText runs per complete sentence (never
  // partial markdown) so code blocks / tables are dropped cleanly before synthesis.
  const content = run?.message.content ?? '';
  useEffect(() => {
    if (!content || content === lastContentRef.current) return;
    lastContentRef.current = content;
    speakerRef.current!.push(content);
    if (settingsRef.current?.captions !== false) setCaption(content);
  }, [content]);

  // When a run finishes, flush the trailing (unterminated) sentence and reset for the next turn.
  useEffect(() => {
    const running = !!run;
    if (runningRef.current && !running) {
      speakerRef.current!.flush();
      speakerRef.current = createReplySpeaker((t) => ttsRef.current!.enqueue(t));
      lastContentRef.current = '';
    }
    runningRef.current = running;
  }, [run]);

  const startListening = useCallback(async () => {
    setErrored(false);
    try {
      recRef.current = await startRecording(settingsRef.current?.inputDeviceId);
      setCaption('');
      setListening(true);
    } catch {
      setErrored(true);
      setCaption('Microphone permission is needed for voice mode.');
    }
  }, []);

  const stopListening = useCallback(async () => {
    const rec = recRef.current;
    recRef.current = null;
    setListening(false);
    if (!rec) return;
    let text = '';
    try {
      const blob = await rec.stop();
      const res = await cloudApi.transcribeAudio({
        audioBase64: await fileToBase64(blob),
        mime: blob.type || 'audio/webm',
      });
      text = res.text.trim();
    } catch (e) {
      setErrored(true);
      setCaption(e instanceof Error ? e.message : 'Could not transcribe');
      return;
    }
    if (!text) return;
    setCaption(text);
    // Resolve the current voice/rate up front so the ENTIRE reply is spoken in one voice. Without this,
    // the first sentence can synthesize before the mount-time settings load resolves (→ backend default
    // voice), then later sentences use the selected voice — an audible shift mid-reply.
    settingsRef.current = (await repo.getSettings().catch(() => null))?.voice ?? settingsRef.current;
    // Start the reply stream clean, then hand off to the run store (memory + tools + skills + SignalR).
    speakerRef.current = createReplySpeaker((t) => ttsRef.current!.enqueue(t));
    lastContentRef.current = '';
    turnedRef.current = true;
    await send(text);
  }, [send]);

  const onOrbTap = () => {
    if (listening) {
      void stopListening();
      return;
    }
    if (muted) return;
    // Barge-in: interrupt any in-flight reply + speech, then start listening.
    if (run) useRuns.getState().stop(tid);
    ttsRef.current?.stop();
    void startListening();
  };

  const exit = useCallback(() => {
    recRef.current?.cancel();
    ttsRef.current?.stop();
    // The server run keeps generating after we leave, so land back in the thread to see the reply.
    navigate(turnedRef.current || routeThreadId ? `/c/${tid}` : '/new');
  }, [navigate, routeThreadId, tid]);

  // Stop local mic + audio on unmount; the server run is untouched (it persists into the thread).
  useEffect(
    () => () => {
      recRef.current?.cancel();
      ttsRef.current?.stop();
    },
    [],
  );

  const phase: Phase = errored
    ? 'error'
    : listening
      ? 'listening'
      : playing
        ? 'speaking'
        : run
          ? 'thinking'
          : muted
            ? 'muted'
            : 'idle';

  const showCaption = settingsRef.current?.captions !== false && !!caption;

  const orbClass =
    phase === 'listening'
      ? 'orb orb--listening'
      : phase === 'thinking'
        ? 'orb orb--thinking'
        : phase === 'speaking'
          ? 'orb orb--speaking'
          : 'orb';

  return (
    <div className="voice" role="dialog" aria-label="Voice mode">
      <div className="row" style={{ width: '100%', justifyContent: 'space-between' }}>
        <span className="muted">Voice mode</span>
        <IconButton name="close" label="Exit voice mode" onClick={exit} />
      </div>

      <div className="col" style={{ alignItems: 'center', gap: 'var(--space-7)' }}>
        <div className="voice__status">{PHASE_LABEL[phase]}</div>
        <button className={orbClass} onClick={onOrbTap} aria-label={listening ? 'Stop and send' : 'Tap to speak'}>
          {phase === 'thinking' && <Spinner size="lg" />}
        </button>
        {showCaption && <div className="voice__caption">{caption}</div>}
      </div>

      <div className="voice__controls">
        <IconButton
          name={muted ? 'mic-off' : 'mic'}
          label={muted ? 'Unmute microphone' : 'Mute microphone'}
          big
          variant="muted"
          onClick={() => setMuted((m) => !m)}
        />
        <IconButton name="close" label="End" big variant="accent" onClick={exit} />
      </div>
    </div>
  );
}
