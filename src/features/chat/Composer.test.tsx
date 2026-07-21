import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Composer } from './Composer';
import { DEFAULT_SETTINGS } from '../../lib/types';

const mocks = vi.hoisted(() => ({
  startRecording: vi.fn(),
  readLevel: vi.fn(() => 0.2),
  transcribeAudio: vi.fn(),
  getSettings: vi.fn(),
  createVad: vi.fn(),
  listSkills: vi.fn(),
  getCredentialStatus: vi.fn(),
  normalizeImageUpload: vi.fn(),
}));

vi.mock('../../lib/audio', () => ({
  startRecording: mocks.startRecording,
  readLevel: mocks.readLevel,
}));

vi.mock('../../lib/vad', () => ({ createVad: mocks.createVad }));

vi.mock('../../lib/imageUpload', () => ({
  isImageUpload: (file: File) => file.type.startsWith('image/'),
  normalizeImageUpload: mocks.normalizeImageUpload,
}));

vi.mock('../../data', () => ({
  repo: { getSettings: mocks.getSettings },
  cloudApi: { transcribeAudio: mocks.transcribeAudio, getCredentialStatus: mocks.getCredentialStatus },
  skillsApi: { list: mocks.listSkills },
}));

vi.mock('../voice/WaveformVisualizer', () => ({
  WaveformVisualizer: () => <div data-testid="waveform" />,
}));

function recorder(blob = new Blob(['audio'], { type: 'audio/webm' })) {
  return {
    stream: {} as MediaStream,
    analyser: {} as AnalyserNode,
    stop: vi.fn().mockResolvedValue(blob),
    cancel: vi.fn(),
    onInterruption: vi.fn(() => vi.fn()),
  };
}

function Harness({ initial = 'Hello world', onSend = vi.fn() }: { initial?: string; onSend?: ReturnType<typeof vi.fn> }) {
  const [value, setValue] = useState(initial);
  return (
    <Composer
      threadId="t1"
      value={value}
      onChange={setValue}
      onSend={onSend}
      streaming={false}
      onStop={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
  mocks.transcribeAudio.mockResolvedValue({ text: 'there' });
  mocks.createVad.mockReturnValue({ push: vi.fn(() => null), reset: vi.fn() });
  mocks.listSkills.mockResolvedValue([]);
  mocks.getCredentialStatus.mockResolvedValue({ capabilities: { transcribe: true } });
  mocks.normalizeImageUpload.mockImplementation(async (file: File) => file);
  vi.stubGlobal('MediaRecorder', class {});
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:${crypto.randomUUID()}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Composer dictation', () => {
  it('starts only one recorder when the mic is tapped rapidly during permission startup', async () => {
    let resolveRecorder!: (value: ReturnType<typeof recorder>) => void;
    mocks.startRecording.mockReturnValue(new Promise((resolve) => { resolveRecorder = resolve; }));
    render(<Harness />);
    const mic = screen.getByRole('button', { name: 'Dictate' });

    fireEvent.click(mic);
    fireEvent.click(mic);

    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledOnce());
    expect(screen.getByText('Requesting microphone access', { selector: '[role="status"]' })).toBeInTheDocument();
    await act(async () => resolveRecorder(recorder()));
    await screen.findByText('Listening', { selector: '[role="status"]' });
  });

  it('inserts the transcript at the captured caret and never sends', async () => {
    const onSend = vi.fn();
    const rec = recorder();
    mocks.startRecording.mockResolvedValue(rec);
    let resolveTranscript!: (value: { text: string }) => void;
    mocks.transcribeAudio.mockReturnValue(new Promise((resolve) => { resolveTranscript = resolve; }));
    render(<Harness onSend={onSend} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(5, 5);

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    await screen.findByText('Listening', { selector: '[role="status"]' });
    fireEvent.click(screen.getByRole('button', { name: 'Insert transcript' }));
    await screen.findByText('Transcribing dictation', { selector: '[role="status"]' });
    await act(async () => {
      resolveTranscript({ text: 'there' });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(input.value).toBe('Hello there world'));
    expect(mocks.transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ audio: expect.any(Blob), mime: 'audio/webm' }),
      expect.any(AbortSignal),
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(rec.stop).toHaveBeenCalledOnce();
  });

  it('allows cancellation while transcribing and aborts the request', async () => {
    const rec = recorder();
    mocks.startRecording.mockResolvedValue(rec);
    let requestSignal: AbortSignal | undefined;
    mocks.transcribeAudio.mockImplementation((_body, signal: AbortSignal) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    await screen.findByText('Listening', { selector: '[role="status"]' });
    fireEvent.click(screen.getByRole('button', { name: 'Insert transcript' }));
    await screen.findByText('Transcribing dictation', { selector: '[role="status"]' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel dictation' }));

    expect(requestSignal?.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByText('Transcribing dictation', { selector: '[role="status"]' })).not.toBeInTheDocument());
  });

  it('cancels microphone capture when the page is hidden', async () => {
    const rec = recorder();
    mocks.startRecording.mockResolvedValue(rec);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    await screen.findByText('Listening', { selector: '[role="status"]' });

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));

    expect(rec.cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText('Listening', { selector: '[role="status"]' })).not.toBeInTheDocument());
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('uses VAD auto-stop as Accept without auto-sending', async () => {
    const onSend = vi.fn();
    const rec = recorder();
    mocks.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      voice: { ...DEFAULT_SETTINGS.voice, autoStopDictation: true },
    });
    mocks.startRecording.mockResolvedValue(rec);
    mocks.createVad.mockReturnValue({ push: vi.fn(() => 'speechend'), reset: vi.fn() });
    render(<Harness onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));

    await waitFor(() => expect(rec.stop).toHaveBeenCalledOnce());
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toContain('there'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('finalizes only once when two endpoint triggers arrive together', async () => {
    const rec = recorder();
    mocks.startRecording.mockResolvedValue(rec);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    await screen.findByText('Listening', { selector: '[role="status"]' });
    const accept = screen.getByRole('button', { name: 'Insert transcript' });

    fireEvent.click(accept);
    fireEvent.click(accept);

    await waitFor(() => expect(rec.stop).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.transcribeAudio).toHaveBeenCalledOnce());
  });

  it('retries a failed transcription with the same captured audio', async () => {
    const audio = new Blob(['retry-audio'], { type: 'audio/mp4' });
    mocks.startRecording.mockResolvedValue(recorder(audio));
    mocks.transcribeAudio
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ text: 'recovered' });
    render(<Harness initial="Draft" />);

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    await screen.findByText('Listening', { selector: '[role="status"]' });
    fireEvent.click(screen.getByRole('button', { name: 'Insert transcript' }));
    await screen.findByText('Transcription failed', { selector: '[role="status"]' });

    fireEvent.click(screen.getByRole('button', { name: 'Retry transcription' }));

    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toContain('recovered'));
    expect(mocks.transcribeAudio).toHaveBeenCalledTimes(2);
    expect(mocks.transcribeAudio.mock.calls[0][0].audio).toBe(audio);
    expect(mocks.transcribeAudio.mock.calls[1][0].audio).toBe(audio);
  });

  it('disables dictation when no transcription model is configured', async () => {
    mocks.getCredentialStatus.mockResolvedValue({ capabilities: { transcribe: false } });

    render(<Harness />);

    const mic = await screen.findByRole('button', { name: 'Configure a transcription model to use dictation' });
    expect(mic).toBeDisabled();
    fireEvent.click(mic);
    expect(mocks.startRecording).not.toHaveBeenCalled();
  });

  it('shows an image immediately while preparing it and sends only the normalized file', async () => {
    const onSend = vi.fn();
    let resolveImage!: (file: File) => void;
    mocks.normalizeImageUpload.mockReturnValue(new Promise((resolve) => { resolveImage = resolve; }));
    const { container } = render(<Harness initial="" onSend={onSend} />);
    const source = new File(['source'], 'photo.jpg', { type: 'image/jpeg' });
    const normalized = new File(['normalized'], 'photo.jpg', { type: 'image/jpeg' });

    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [source] } });

    expect(screen.getByRole('status', { name: 'Preparing photo.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove photo.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await act(async () => resolveImage(normalized));

    await waitFor(() => expect(screen.queryByRole('status', { name: 'Preparing photo.jpg' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('', [normalized], [], []);
  });

  it('does not restore an image removed while preparation is pending', async () => {
    let resolveImage!: (file: File) => void;
    mocks.normalizeImageUpload.mockReturnValue(new Promise((resolve) => { resolveImage = resolve; }));
    const { container } = render(<Harness initial="" />);
    const source = new File(['source'], 'remove-me.jpg', { type: 'image/jpeg' });

    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [source] } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove remove-me.jpg' }));
    await act(async () => resolveImage(new File(['ready'], 'remove-me.jpg', { type: 'image/jpeg' })));

    expect(screen.queryByRole('button', { name: 'Remove remove-me.jpg' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('removes the optimistic placeholder when image preparation fails immediately', async () => {
    mocks.normalizeImageUpload.mockRejectedValue(new Error('decode failed'));
    const { container } = render(<Harness initial="" />);
    const source = new File(['bad'], 'broken.jpg', { type: 'image/jpeg' });

    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [source] } });

    expect(screen.getByRole('status', { name: 'Preparing broken.jpg' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove broken.jpg' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
