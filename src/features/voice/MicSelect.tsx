import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton, SelectMenu } from '../../design/ui';
import { listInputDevices, monitorInput, type InputMonitor } from '../../lib/audio';
import { toMicOptions, micLabelsHidden, type MicDeviceInfo } from '../../lib/audioDevices';
import { WaveformVisualizer } from './WaveformVisualizer';

interface MicSelectProps {
  value?: string;
  onChange: (deviceId: string | undefined) => void;
}

/**
 * Microphone picker for Settings → Voice. Lists input devices (device names appear only after mic
 * permission is granted, so we expose a one-tap "allow" affordance), and a Test toggle that opens a
 * live input-level meter over the selected device so the user can confirm it actually hears them.
 */
export function MicSelect({ value, onChange }: MicSelectProps) {
  const [devices, setDevices] = useState<MicDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const monitorRef = useRef<InputMonitor | null>(null);

  const refresh = useCallback(async () => {
    setDevices(await listInputDevices());
  }, []);

  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => md?.removeEventListener?.('devicechange', refresh);
  }, [refresh]);

  // Run a live monitor while testing; restart it whenever the chosen device changes. Releasing the
  // monitor on cleanup turns off the browser's mic indicator.
  useEffect(() => {
    if (!testing) {
      setAnalyser(null);
      return;
    }
    let cancelled = false;
    let monitor: InputMonitor | null = null;
    monitorInput(value)
      .then((m) => {
        if (cancelled) {
          m.stop();
          return;
        }
        monitor = m;
        monitorRef.current = m;
        setAnalyser(m.analyser);
        void refresh(); // permission is now granted → device labels are available
      })
      .catch(() => {
        if (!cancelled) setTesting(false);
      });
    return () => {
      cancelled = true;
      monitor?.stop();
      if (monitorRef.current === monitor) monitorRef.current = null;
    };
  }, [testing, value, refresh]);

  const grantPermission = async () => {
    try {
      const m = await monitorInput(value);
      m.stop();
      await refresh();
    } catch {
      /* permission denied — the hint stays */
    }
  };

  const options = toMicOptions(devices);
  const needsPermission = micLabelsHidden(devices) && !testing;

  return (
    <div className="mic-select">
      <div className="mic-select__row">
        <SelectMenu
          value={value ?? ''}
          label="Microphone"
          options={options}
          onChange={(v) => onChange(v || undefined)}
          className="mic-select__menu"
        />
        <IconButton
          name={testing ? 'stop' : 'mic'}
          label={testing ? 'Stop microphone test' : 'Test microphone'}
          variant={testing ? 'accent' : 'muted'}
          onClick={() => setTesting((t) => !t)}
        />
      </div>
      {testing && (
        <div className="mic-select__meter" aria-label="Live microphone level">
          <WaveformVisualizer analyser={analyser} />
        </div>
      )}
      {needsPermission && (
        <button type="button" className="mic-select__hint" onClick={grantPermission}>
          Allow microphone access to see device names
        </button>
      )}
    </div>
  );
}
