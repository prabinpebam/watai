import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRecording, supportedRecordingMime } from './audio';

class FakeTrack {
  stop = vi.fn();
  private ended: (() => void)[] = [];
  addEventListener = vi.fn((event: string, callback: () => void) => {
    if (event === 'ended') this.ended.push(callback);
  });
  end() {
    this.ended.forEach((callback) => callback());
  }
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => ({ fftSize: 0, frequencyBinCount: 4, getByteFrequencyData: vi.fn() }));
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

class FakeMediaRecorder {
  static supported = new Set<string>();
  static isTypeSupported = (mime: string) => FakeMediaRecorder.supported.has(mime);
  readonly mimeType: string;
  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'audio/mp4';
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) } as BlobEvent);
    this.state = 'inactive';
    this.onstop?.(new Event('stop'));
  }
}

const originalMediaRecorder = globalThis.MediaRecorder;
const originalAudioContext = globalThis.AudioContext;
const originalMediaDevices = navigator.mediaDevices;

function installMedia(track: FakeTrack, getUserMedia?: ReturnType<typeof vi.fn>) {
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const capture = getUserMedia ?? vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: capture } });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return { stream, getUserMedia: capture };
}

afterEach(() => {
  FakeMediaRecorder.supported.clear();
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: originalMediaRecorder });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: originalAudioContext });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
});

describe('audio recording', () => {
  it('selects and preserves Safari MP4 audio when WebM is unavailable', async () => {
    FakeMediaRecorder.supported.add('audio/mp4');
    const track = new FakeTrack();
    const { getUserMedia } = installMedia(track);

    expect(supportedRecordingMime()).toBe('audio/mp4');
    const recorder = await startRecording();
    const blob = await recorder.stop();

    expect(blob.type).toBe('audio/mp4');
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        channelCount: { ideal: 1 },
      }),
    });
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('does not retry a denied preferred microphone as the default device', async () => {
    const denied = new DOMException('denied', 'NotAllowedError');
    const getUserMedia = vi.fn().mockRejectedValue(denied);
    installMedia(new FakeTrack(), getUserMedia);

    await expect(startRecording('preferred')).rejects.toBe(denied);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('stops the acquired track when recorder construction fails', async () => {
    const track = new FakeTrack();
    installMedia(track);
    vi.stubGlobal('MediaRecorder', class {
      static isTypeSupported() { return false; }
      constructor() { throw new Error('unsupported'); }
    });

    await expect(startRecording()).rejects.toThrow('unsupported');
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('notifies the owner when the microphone track ends unexpectedly', async () => {
    const track = new FakeTrack();
    installMedia(track);
    const recorder = await startRecording();
    const interrupted = vi.fn();
    recorder.onInterruption(interrupted);

    track.end();

    expect(interrupted).toHaveBeenCalledOnce();
    recorder.cancel();
  });
});
