import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Onboarding } from './Onboarding';

const mocks = vi.hoisted(() => ({
  putCredentials: vi.fn(),
  chatComplete: vi.fn(),
  saveSettings: vi.fn(),
  signInRedirect: vi.fn(),
}));

vi.mock('../../data', () => ({
  cloudApi: {
    putCredentials: mocks.putCredentials,
    chatComplete: mocks.chatComplete,
  },
  repo: { saveSettings: mocks.saveSettings },
}));

vi.mock('../../auth/cloudAuth', () => ({ signInRedirect: mocks.signInRedirect }));

function renderWizard() {
  const view = render(
    <MemoryRouter initialEntries={['/key']}>
      <Onboarding />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByPlaceholderText('ai-project-deployments-resource'), { target: { value: 'resource' } });
  fireEvent.change(screen.getByPlaceholderText('Your API key'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.putCredentials.mockResolvedValue({ configured: true });
  mocks.chatComplete.mockResolvedValue({ text: 'OK' });
  mocks.saveSettings.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('Onboarding capability setup', () => {
  it('does not start a delayed chat probe after leaving endpoint setup', async () => {
    let complete!: () => void;
    mocks.putCredentials.mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve; }));
    const view = renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test chat' }));
    expect(mocks.putCredentials).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => complete());
    expect(mocks.chatComplete).not.toHaveBeenCalled();
  });

  it('clears chat test evidence before editing the tested configuration', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test chat' }));
    await screen.findByText('Chat tested');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'different-chat-model' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByText('Chat tested')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not tested')).toHaveLength(4);
    expect(mocks.chatComplete).toHaveBeenCalledOnce();
  });

  it('prevents finishing or editing configuration while a chat probe is still running', async () => {
    mocks.chatComplete.mockReturnValueOnce(new Promise(() => undefined));
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test chat' }));
    await waitFor(() => expect(mocks.chatComplete).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled();
  });

  it('finishes endpoint setup without resetting existing account settings', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(mocks.putCredentials).toHaveBeenCalledOnce());
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    expect(mocks.chatComplete).not.toHaveBeenCalled();
  });

  it('labels and performs only the chat probe while optional models remain untested or unconfigured', async () => {
    renderWizard();
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getAllByText('Not tested')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Test chat' }));

    await waitFor(() => expect(mocks.chatComplete).toHaveBeenCalledOnce());
    expect(screen.getByText('Chat tested')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getAllByText('Not tested')).toHaveLength(2);
  });

  it('persists the selected supported reasoning effort without testing optional paid capabilities', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('tab', { name: 'High' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test chat' }));

    await waitFor(() => expect(mocks.putCredentials).toHaveBeenCalledWith(expect.objectContaining({
      chatDefaults: { reasoningEffort: 'high' },
    })));
    expect(mocks.chatComplete).toHaveBeenCalledOnce();
  });
});