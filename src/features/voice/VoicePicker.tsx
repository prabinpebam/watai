import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../design/overlays';
import { Button, Spinner } from '../../design/ui';
import { Icon } from '../../design/icons';
import { cloudApi } from '../../data';
import { base64ToBlob } from '../../lib/files';

export interface VoiceOption {
  value: string;
  label: string;
  description?: string;
}

interface VoicePickerProps {
  value: string;
  /** Speaking rate, so previews sound like the real read-aloud / voice mode. */
  rate: number;
  options: VoiceOption[];
  onChange: (voiceId: string) => void;
  onClose: () => void;
}

const SAMPLE = "Hi, I'm your Watai assistant. This is how I sound — ready when you are.";

/**
 * Modal voice chooser with per-voice audio preview. Selection is live (tapping a voice applies it);
 * the Play button on each row synthesizes a short sample in that voice at the current speaking rate
 * so you can compare before committing. Synthesized clips are cached per voice+rate for the lifetime
 * of the modal, and only one preview plays at a time.
 */
export function VoicePicker({ value, rate, options, onChange, onClose }: VoicePickerProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());

  const stopPlayback = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  };

  // Release any object URLs + stop audio when the modal unmounts.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  const preview = async (voiceId: string) => {
    if (playingId === voiceId) {
      stopPlayback();
      return;
    }
    stopPlayback();
    setFailed(false);
    setLoadingId(voiceId);
    try {
      const key = `${voiceId}|${rate}`;
      let url = cacheRef.current.get(key);
      if (!url) {
        const { audioBase64, mime } = await cloudApi.synthesizeSpeech({ input: SAMPLE, voice: voiceId, speed: rate });
        if (!audioBase64) throw new Error('No audio returned');
        url = URL.createObjectURL(base64ToBlob(audioBase64, mime));
        cacheRef.current.set(key, url);
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          setPlayingId(null);
        }
      };
      setLoadingId(null);
      setPlayingId(voiceId);
      await audio.play();
    } catch {
      setLoadingId(null);
      setPlayingId(null);
      setFailed(true);
    }
  };

  const close = () => {
    stopPlayback();
    onClose();
  };

  return (
    <Modal
      title="Choose a voice"
      onClose={close}
      footer={
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      }
    >
      <p className="voice-picker__hint">Tap a voice to select it, or play a sample to compare.</p>
      <div className="voice-picker" role="radiogroup" aria-label="Voice">
        {options.map((o) => {
          const selected = o.value === value;
          const loading = loadingId === o.value;
          const playing = playingId === o.value;
          return (
            <div
              key={o.value}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              className={`voice-option ${selected ? 'is-selected' : ''}`}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(o.value);
                }
              }}
            >
              <span className="voice-option__radio" aria-hidden="true">
                {selected && <Icon name="check" size={14} />}
              </span>
              <span className="voice-option__text">
                <span className="voice-option__name">{o.label}</span>
                {o.description && <span className="voice-option__desc">{o.description}</span>}
              </span>
              <button
                type="button"
                className={`voice-option__play ${playing ? 'is-playing' : ''}`}
                aria-label={playing ? `Stop ${o.label} preview` : `Play ${o.label} preview`}
                onClick={(e) => {
                  e.stopPropagation();
                  void preview(o.value);
                }}
              >
                {loading ? <Spinner size="sm" /> : <Icon name={playing ? 'stop' : 'play'} size={18} />}
              </button>
            </div>
          );
        })}
      </div>
      {failed && <p className="voice-picker__error">Could not play a preview. Check your connection and try again.</p>}
    </Modal>
  );
}
