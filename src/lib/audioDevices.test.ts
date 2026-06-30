import { describe, it, expect } from 'vitest';
import { toMicOptions, micLabelsHidden, type MicDeviceInfo } from './audioDevices';

const dev = (deviceId: string, label: string, kind = 'audioinput'): MicDeviceInfo => ({ deviceId, label, kind });

describe('toMicOptions', () => {
  it('always leads with a System default option', () => {
    expect(toMicOptions([])).toEqual([{ value: '', label: 'System default' }]);
  });

  it('maps labeled input devices after the default entry', () => {
    const out = toMicOptions([dev('id-a', 'Built-in Mic'), dev('id-b', 'USB Headset')]);
    expect(out).toEqual([
      { value: '', label: 'System default' },
      { value: 'id-a', label: 'Built-in Mic' },
      { value: 'id-b', label: 'USB Headset' },
    ]);
  });

  it('drops the platform pseudo-devices (default / communications)', () => {
    const out = toMicOptions([dev('default', 'Default'), dev('communications', 'Comms'), dev('real', 'Real Mic')]);
    expect(out.map((o) => o.value)).toEqual(['', 'real']);
  });

  it('ignores non-audioinput devices', () => {
    const out = toMicOptions([dev('spk', 'Speakers', 'audiooutput'), dev('cam', 'Webcam', 'videoinput'), dev('mic', 'Mic')]);
    expect(out.map((o) => o.value)).toEqual(['', 'mic']);
  });

  it('gives a stable fallback label when the device label is hidden (no permission)', () => {
    const out = toMicOptions([dev('id-a', ''), dev('id-b', '   ')]);
    expect(out).toEqual([
      { value: '', label: 'System default' },
      { value: 'id-a', label: 'Microphone 1' },
      { value: 'id-b', label: 'Microphone 2' },
    ]);
  });

  it('de-dupes repeated device ids', () => {
    const out = toMicOptions([dev('id-a', 'Mic'), dev('id-a', 'Mic')]);
    expect(out.map((o) => o.value)).toEqual(['', 'id-a']);
  });
});

describe('micLabelsHidden', () => {
  it('is true when inputs exist but all labels are blank', () => {
    expect(micLabelsHidden([dev('a', ''), dev('b', '')])).toBe(true);
  });
  it('is false once any input is labeled', () => {
    expect(micLabelsHidden([dev('a', ''), dev('b', 'USB Mic')])).toBe(false);
  });
  it('is false when there are no input devices', () => {
    expect(micLabelsHidden([])).toBe(false);
    expect(micLabelsHidden([dev('spk', '', 'audiooutput')])).toBe(false);
  });
});
