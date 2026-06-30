// Pure helpers for presenting microphone input devices in a picker. Kept separate from `audio.ts`
// (which touches the live MediaDevices API) so the labeling / default-option UX is unit-testable.

export interface MicDeviceInfo {
  deviceId: string;
  label: string;
  kind?: string;
}

/**
 * Map enumerated input devices to picker options. Always leads with a "System default" entry
 * (empty value = let the browser pick), drops the platform pseudo-devices (`default`,
 * `communications`) since the System-default entry already covers them, de-dupes by id, and
 * supplies a stable fallback label ("Microphone N") for devices whose label is hidden until mic
 * permission is granted.
 */
export function toMicOptions(devices: MicDeviceInfo[]): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [{ value: '', label: 'System default' }];
  const seen = new Set<string>();
  let n = 0;
  for (const d of devices) {
    if (d.kind && d.kind !== 'audioinput') continue;
    if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
    if (seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    n += 1;
    options.push({ value: d.deviceId, label: d.label.trim() || `Microphone ${n}` });
  }
  return options;
}

/** True when the device list exists but every label is blank — i.e. mic permission not yet granted. */
export function micLabelsHidden(devices: MicDeviceInfo[]): boolean {
  const inputs = devices.filter((d) => !d.kind || d.kind === 'audioinput');
  return inputs.length > 0 && inputs.every((d) => !d.label.trim());
}
