import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/types';

const mocks = vi.hoisted(() => ({
  startRecording: vi.fn(),
  send: vi.fn(async () => ({ accepted: true })),
  transcribeAudio: vi.fn(),
  getSettings: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useParams: () => ({ threadId: 'thread-1' }) }));
vi.mock('../../lib/audio', () => ({ startRecording: mocks.startRecording }));
vi.mock('../../data', () => ({
  repo: { getSettings: mocks.getSettings },
  cloudApi: { transcribeAudio: mocks.transcribeAudio, synthesizeSpeech: vi.fn() },
}));
vi.mock('../chat/useChat', () => ({ useChat: () => ({ send: mocks.send }) }));
vi.mock('../chat/runStore', () => {
  const store = { getState: () => ({ stop: vi.fn() }) };
  return { useRuns: Object.assign(() => undefined, store) };
});
vi.mock('../../lib/audioPlayback', () => ({
  createAudioElement: () => ({ pause: vi.fn() }), playAudioSource: vi.fn(), primeAudioElement: vi.fn(),
}));
vi.mock('../../lib/ttsQueue', () => ({ createTtsQueue: () => ({ enqueue: vi.fn(), stop: vi.fn() }) }));
vi.mock('../../lib/replySpeaker', () => ({ createReplySpeaker: () => ({ push: vi.fn(), flush: vi.fn() }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeRecorder(stop = vi.fn()) {
  return { cancel: vi.fn(), stop, onInterruption: vi.fn((_callback: () => void) => vi.fn()), stream: { getTracks: () => [] } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
});

describe('VoiceMode capture lifecycle', () => {
  it('cancels interrupted capture and ignores interruptions from a previous recorder', async () => {
    const first = makeRecorder();
    const second = makeRecorder();
    mocks.startRecording.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    await screen.findByText('Listening…');
    expect(first.onInterruption).toHaveBeenCalledOnce();
    act(() => first.onInterruption.mock.calls[0][0]());
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(screen.getByText('Microphone capture was interrupted.')).toBeInTheDocument();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    await screen.findByText('Listening…');
    act(() => first.onInterruption.mock.calls[0][0]());
    expect(second.cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Listening…');
  });

  it('accepts capture after the StrictMode effect cleanup/setup cycle', async () => {
    const recorder = makeRecorder();
    mocks.startRecording.mockResolvedValue(recorder);
    render(<StrictMode><VoiceMode /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    await screen.findByText('Listening…');
    expect(recorder.cancel).not.toHaveBeenCalled();
  });

  it.each(['recorder', 'settings'].flatMap(stage => ['mute', 'exit', 'unmount', 'restart'].map(cancel => ({ stage, cancel }))))('discards delayed work after cancellation: %j', async ({ stage, cancel }) => {
    const pendingRecorder = deferred<Blob>();
    const pendingSettings = deferred<typeof DEFAULT_SETTINGS>();
    const audio = new Blob(['audio'], { type: 'audio/webm' });
    const recorder = makeRecorder(vi.fn(() => stage === 'recorder' ? pendingRecorder.promise : Promise.resolve(audio)));
    mocks.startRecording.mockResolvedValue(recorder);
    mocks.transcribeAudio.mockResolvedValue({ text: 'Transcribed text' });
    const { unmount } = render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    await screen.findByText('Listening…');
    if (stage === 'settings') mocks.getSettings.mockReturnValueOnce(pendingSettings.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Stop and send' }));
    if (stage === 'settings') await waitFor(() => expect(mocks.getSettings).toHaveBeenCalledTimes(2));
    else expect(recorder.stop).toHaveBeenCalledOnce();
    if (cancel === 'unmount') unmount();
    else if (cancel === 'restart') fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    else fireEvent.click(screen.getByRole('button', { name: cancel === 'mute' ? 'Mute microphone' : 'Exit voice mode' }));
    if (stage === 'recorder') expect(recorder.cancel).toHaveBeenCalledOnce();
    await act(async () => {
      pendingRecorder.resolve(audio);
      pendingSettings.resolve(DEFAULT_SETTINGS);
    });
    if (stage === 'recorder') expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('cancels a recorder whose permission resolves after unmount', async () => {
    const pending = deferred<any>();
    const recorder = makeRecorder();
    mocks.startRecording.mockReturnValueOnce(pending.promise);
    const { unmount } = render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    unmount();
    await act(async () => pending.resolve(recorder));
    await waitFor(() => expect(recorder.cancel).toHaveBeenCalledOnce());
  });

  it('starts only one permission request across rapid taps', async () => {
    const pending = deferred<any>();
    const recorder = makeRecorder();
    mocks.startRecording.mockReturnValue(pending.promise);
    render(<VoiceMode />);
    const orb = screen.getByRole('button', { name: 'Tap to speak' });
    fireEvent.click(orb);
    fireEvent.click(orb);
    expect(mocks.startRecording).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(recorder));
  });

  it('mute cancels active capture immediately', async () => {
    const recorder = makeRecorder();
    mocks.startRecording.mockResolvedValue(recorder);
    render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    await screen.findByText('Listening…');
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    expect(recorder.cancel).toHaveBeenCalledOnce();
    expect(screen.getByText('Muted')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Muted');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('mute aborts transcription and prevents sending', async () => {
    let signal: AbortSignal | undefined;
    const recorder = makeRecorder(vi.fn(async () => new Blob(['audio'], { type: 'audio/webm' })));
    mocks.startRecording.mockResolvedValue(recorder);
    mocks.transcribeAudio.mockImplementation((_body, requestSignal: AbortSignal) => {
      signal = requestSignal;
      return new Promise((_resolve, reject) => requestSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    await screen.findByText('Listening…');
    fireEvent.click(screen.getByRole('button', { name: 'Stop and send' }));
    await screen.findByText('Transcribing…');
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(mocks.send).not.toHaveBeenCalled());
  });

  it('cancels a recorder whose permission resolves after mute', async () => {
    const pending = deferred<any>();
    const recorder = makeRecorder();
    mocks.startRecording.mockReturnValueOnce(pending.promise);
    render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    await act(async () => pending.resolve(recorder));
    expect(recorder.cancel).toHaveBeenCalledOnce();
  });

  it('exit aborts transcription and never sends afterward', async () => {
    let signal: AbortSignal | undefined;
    const recorder = makeRecorder(vi.fn(async () => new Blob(['audio'], { type: 'audio/webm' })));
    mocks.startRecording.mockResolvedValue(recorder);
    mocks.transcribeAudio.mockImplementation((_body, requestSignal: AbortSignal) => {
      signal = requestSignal;
      return new Promise((_resolve, reject) => requestSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    await screen.findByText('Listening…');
    fireEvent.click(screen.getByRole('button', { name: 'Stop and send' }));
    await screen.findByText('Transcribing…');
    fireEvent.click(screen.getByRole('button', { name: 'Exit voice mode' }));
    expect(signal?.aborted).toBe(true);
    expect(mocks.navigate).toHaveBeenCalledWith('/c/thread-1');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('reports an unavailable microphone distinctly from denied permission', async () => {
    mocks.startRecording.mockRejectedValueOnce(new DOMException('missing', 'NotFoundError'));
    render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    expect(await screen.findByText('The selected microphone is unavailable.')).toBeInTheDocument();
  });
});

import { VoiceMode } from './VoiceMode';
