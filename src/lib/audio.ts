// MediaRecorder wrapper for push-to-talk dictation + an analyser for level metering.

export interface Recorder {
  stop: () => Promise<Blob>;
  cancel: () => void;
  stream: MediaStream;
  analyser: AnalyserNode;
}

/** Open a mic stream, preferring a specific input device and falling back to the system default if
 *  that device is gone (unplugged headset etc.) so capture never hard-fails on a stale saved id. */
async function getInputStream(deviceId?: string): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
    } catch {
      /* selected device unavailable — fall back to the default below */
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

export async function startRecording(deviceId?: string): Promise<Recorder> {
  const stream = await getInputStream(deviceId);
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.start();

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const cleanup = () => {
    stream.getTracks().forEach((t) => t.stop());
    audioCtx.close().catch(() => undefined);
  };

  return {
    stream,
    analyser,
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          cleanup();
          resolve(new Blob(chunks, { type: mime || 'audio/webm' }));
        };
        rec.stop();
      }),
    cancel: () => {
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      cleanup();
    },
  };
}

export function readLevel(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum / data.length / 255; // 0..1
}

/** A lightweight, recorder-free input monitor for the mic-test level meter: just a live analyser
 *  over the selected device. Call `stop()` to release the mic (turns off the browser indicator). */
export interface InputMonitor {
  analyser: AnalyserNode;
  stop: () => void;
}

export async function monitorInput(deviceId?: string): Promise<InputMonitor> {
  const stream = await getInputStream(deviceId);
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  return {
    analyser,
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
      audioCtx.close().catch(() => undefined);
    },
  };
}

/** Enumerate available audio input devices. Labels are only populated once mic permission is
 *  granted; before that the ids are present but labels are empty strings. */
export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}
