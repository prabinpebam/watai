import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/types';

const mocks = vi.hoisted(() => ({
  startRecording: vi.fn(),
  send: vi.fn(async () => ({ accepted: true })),
  transcribeAudio: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useParams: () => ({ threadId: 'thread-1' }) }));
vi.mock('../../lib/audio', () => ({ startRecording: mocks.startRecording }));
vi.mock('../../data', () => ({
  repo: { getSettings: vi.fn(async () => DEFAULT_SETTINGS) },
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

beforeEach(() => vi.clearAllMocks());

describe('VoiceMode capture lifecycle', () => {
  it('cancels a recorder whose permission resolves after unmount', async () => {
    const pending = deferred<any>();
    const recorder = { cancel: vi.fn(), stop: vi.fn(), stream: { getTracks: () => [] } };
    mocks.startRecording.mockReturnValueOnce(pending.promise);
    const { unmount } = render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    unmount();
    await act(async () => pending.resolve(recorder));
    await waitFor(() => expect(recorder.cancel).toHaveBeenCalledOnce());
  });

  it('starts only one permission request across rapid taps', async () => {
    const pending = deferred<any>();
    const recorder = { cancel: vi.fn(), stop: vi.fn(), stream: { getTracks: () => [] } };
    mocks.startRecording.mockReturnValue(pending.promise);
    render(<VoiceMode />);
    const orb = screen.getByRole('button', { name: 'Tap to speak' });
    fireEvent.click(orb);
    fireEvent.click(orb);
    expect(mocks.startRecording).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(recorder));
  });

  it('mute cancels active capture immediately', async () => {
    const recorder = { cancel: vi.fn(), stop: vi.fn(), stream: { getTracks: () => [] } };
    mocks.startRecording.mockResolvedValue(recorder);
    render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    await screen.findByText('Listening…');
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    expect(recorder.cancel).toHaveBeenCalledOnce();
    expect(screen.getByText('Muted')).toBeInTheDocument();
  });

  it('mute aborts transcription and prevents sending', async () => {
    let signal: AbortSignal | undefined;
    const recorder = { cancel: vi.fn(), stop: vi.fn(async () => new Blob(['audio'], { type: 'audio/webm' })), stream: { getTracks: () => [] } };
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
    const recorder = { cancel: vi.fn(), stop: vi.fn(), stream: { getTracks: () => [] } };
    mocks.startRecording.mockReturnValueOnce(pending.promise);
    render(<VoiceMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to speak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    await act(async () => pending.resolve(recorder));
    expect(recorder.cancel).toHaveBeenCalledOnce();
  });

  it('exit aborts transcription and never sends afterward', async () => {
    let signal: AbortSignal | undefined;
    const recorder = { cancel: vi.fn(), stop: vi.fn(async () => new Blob(['audio'], { type: 'audio/webm' })), stream: { getTracks: () => [] } };
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
