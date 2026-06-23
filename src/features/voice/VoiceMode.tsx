import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IconButton } from '../../design/ui';
import { startRecording, type Recorder } from '../../lib/audio';
import { transcribe } from '../../ai/transcribe';
import { streamChat, type ChatMessage } from '../../ai/chat';
import { synthesize } from '../../ai/tts';
import { mockStreamChat, mockTranscribe } from '../../ai/mockAi';
import { getApiConfig } from '../../data/secureStore';
import { repo } from '../../data';
import { newId } from '../../lib/ids';
import { useUi } from '../../state/store';
import { DEFAULT_CHAT_MODEL } from '../chat/useChat';

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
  const { threadId } = useParams();
  const mockAi = useUi((s) => s.mockAi);
  const [phase, setPhase] = useState<Phase>('idle');
  const [caption, setCaption] = useState('');
  const recRef = useRef<Recorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);

  const exit = useCallback(() => {
    recRef.current?.cancel();
    audioRef.current?.pause();
    navigate(threadId ? `/c/${threadId}` : '/new');
  }, [navigate, threadId]);

  const speak = useCallback(
    async (text: string) => {
      setPhase('speaking');
      setCaption(text);
      if (mockAi) {
        await new Promise((r) => setTimeout(r, Math.min(4000, 800 + text.length * 12)));
        setPhase('idle');
        return;
      }
      try {
        const blob = await synthesize({ input: text.slice(0, 4000) });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setPhase('idle');
        };
        await audio.play();
      } catch {
        setPhase('idle');
      }
    },
    [mockAi],
  );

  const think = useCallback(
    async (userText: string) => {
      setPhase('thinking');
      const config = await getApiConfig();
      const model = config?.models.chat ?? DEFAULT_CHAT_MODEL;
      historyRef.current.push({ role: 'user', content: userText });

      let acc = '';
      const stream = mockAi
        ? mockStreamChat({ messages: historyRef.current, model })
        : streamChat({ messages: historyRef.current, model });
      for await (const ev of stream) {
        if (ev.type === 'delta' && ev.textDelta) {
          acc += ev.textDelta;
          setCaption(acc);
        } else if (ev.type === 'error') {
          setPhase('error');
          setCaption(ev.error?.message ?? 'Error');
          return;
        }
      }
      historyRef.current.push({ role: 'assistant', content: acc });

      // Persist to the thread if we have one
      if (threadId) {
        await repo.appendMessage({
          id: newId(),
          threadId,
          role: 'user',
          content: userText,
          status: 'complete',
          createdAt: new Date().toISOString(),
        });
        await repo.appendMessage({
          id: newId(),
          threadId,
          role: 'assistant',
          content: acc,
          model,
          status: 'complete',
          createdAt: new Date().toISOString(),
        });
      }
      await speak(acc);
    },
    [mockAi, speak, threadId],
  );

  const stopListening = useCallback(async () => {
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    setPhase('thinking');
    try {
      const blob = await rec.stop();
      const { text } = mockAi ? await mockTranscribe() : await transcribe({ file: blob });
      if (!text.trim()) {
        setPhase('idle');
        return;
      }
      setCaption(text);
      await think(text);
    } catch (e) {
      setPhase('error');
      setCaption(e instanceof Error ? e.message : 'Could not transcribe');
    }
  }, [mockAi, think]);

  const startListening = useCallback(async () => {
    try {
      recRef.current = await startRecording();
      setCaption('');
      setPhase('listening');
    } catch {
      setPhase('error');
      setCaption('Microphone permission is needed for voice mode.');
    }
  }, []);

  const onOrbTap = () => {
    if (phase === 'listening') stopListening();
    else if (phase === 'idle' || phase === 'error') startListening();
  };

  useEffect(() => {
    return () => {
      recRef.current?.cancel();
      audioRef.current?.pause();
    };
  }, []);

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
        <span className="muted">Voice mode{mockAi ? ' · demo' : ''}</span>
        <IconButton name="close" label="Exit voice mode" onClick={exit} />
      </div>

      <div className="col" style={{ alignItems: 'center', gap: 'var(--space-7)' }}>
        <div className="voice__status">{PHASE_LABEL[phase]}</div>
        <button className={orbClass} onClick={onOrbTap} aria-label="Tap to speak">
          {phase === 'thinking' && <span className="spinner spinner--lg" />}
        </button>
        <div className="voice__caption">{caption}</div>
      </div>

      <div className="voice__controls">
        <IconButton
          name={phase === 'muted' ? 'mic-off' : 'mic'}
          label="Toggle microphone"
          big
          variant="muted"
          onClick={() => setPhase((p) => (p === 'muted' ? 'idle' : 'muted'))}
        />
        <IconButton name="close" label="End" big variant="accent" onClick={exit} />
      </div>
    </div>
  );
}
