import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  render(
    <MemoryRouter initialEntries={['/key']}>
      <Onboarding />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByPlaceholderText('ai-project-deployments-resource'), { target: { value: 'resource' } });
  fireEvent.change(screen.getByPlaceholderText('Your API key'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.putCredentials.mockResolvedValue({ configured: true });
  mocks.chatComplete.mockResolvedValue({ text: 'OK' });
  mocks.saveSettings.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('Onboarding capability setup', () => {
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