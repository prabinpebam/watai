// MediaRecorder wrapper for push-to-talk dictation + an analyser for level metering.

export interface Recorder {
  stop: () => Promise<Blob>;
  cancel: () => void;
  onInterruption: (callback: () => void) => () => void;
  stream: MediaStream;
  analyser: AnalyserNode;
}

const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
] as const;

export function supportedRecordingMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return RECORDING_MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime));
}

function audioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    channelCount: { ideal: 1 },
  };
}

/** Open a mic stream, preferring a specific input device and falling back to the system default if
 *  that device is gone (unplugged headset etc.) so capture never hard-fails on a stale saved id. */
async function getInputStream(deviceId?: string): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId) });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name !== 'NotFoundError' && name !== 'OverconstrainedError') throw error;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
}

export async function startRecording(deviceId?: string): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new DOMException('Audio recording is not supported by this browser.', 'NotSupportedError');
  }
  const stream = await getInputStream(deviceId);
  let rec: MediaRecorder | undefined;
  let audioCtx: AudioContext | undefined;
  let cleaned = false;
  try {
    const requestedMime = supportedRecordingMime();
    rec = new MediaRecorder(stream, requestedMime ? { mimeType: requestedMime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => undefined);
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      stream.getTracks().forEach((track) => track.stop());
      void audioCtx?.close().catch(() => undefined);
    };
    let canceled = false;
    let stopPromise: Promise<Blob> | null = null;
    const interruptionListeners = new Set<() => void>();
    const interrupted = () => {
      if (!cleaned && !canceled) interruptionListeners.forEach((callback) => callback());
    };
    stream.getTracks().forEach((track) => track.addEventListener('ended', interrupted));
    rec.onerror = interrupted;
    rec.start(1_000);

    return {
      stream,
      analyser,
      onInterruption: (callback) => {
        interruptionListeners.add(callback);
        return () => interruptionListeners.delete(callback);
      },
      stop: () => {
        if (stopPromise) return stopPromise;
        stopPromise = new Promise<Blob>((resolve, reject) => {
          const fail = (message: string) => {
            cleanup();
            reject(new Error(message));
          };
          rec!.onerror = () => fail('Audio recording failed.');
          rec!.onstop = () => {
            cleanup();
            if (canceled) return reject(new Error('Audio recording was canceled.'));
            const mime = rec!.mimeType || chunks.find((chunk) => chunk.type)?.type || requestedMime || 'application/octet-stream';
            resolve(new Blob(chunks, { type: mime }));
          };
          if (rec!.state === 'inactive') fail('Audio recording ended unexpectedly.');
          else rec!.stop();
        });
        return stopPromise;
      },
      cancel: () => {
        canceled = true;
        rec!.ondataavailable = null;
        rec!.onerror = null;
        rec!.onstop = null;
        interruptionListeners.clear();
        if (rec!.state !== 'inactive') {
          try {
            rec!.stop();
          } catch {
            /* recorder already stopped */
          }
        }
        cleanup();
      },
    };
  } catch (error) {
    if (rec?.state !== 'inactive') {
      try {
        rec?.stop();
      } catch {
        /* setup already failed */
      }
    }
    stream.getTracks().forEach((track) => track.stop());
    void audioCtx?.close().catch(() => undefined);
    throw error;
  }
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
