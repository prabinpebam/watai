import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsBody } from './Settings';
import { cloudApi } from '../../data';
import { DEFAULT_SETTINGS } from '../../lib/types';
import type { CredentialStatus } from '../../data/cloud/types';

vi.mock('../../data', () => ({
  cloudApi: { getCredentialStatus: vi.fn(), putCredentials: vi.fn() },
  repo: {}, realtime: {}, accountLocalStorageKey: vi.fn(),
}));

const saved: CredentialStatus = {
  configured: true, baseUrl: 'https://resource.services.ai.azure.com/openai/v1',
  models: { chat: 'chat-model' }, keyHint: '1234', tavilyConfigured: true,
  tavilyHint: '5678', knowledgeBaseVectorStoreId: 'vs-saved',
};
const context = (): ComponentProps<typeof ModelsBody>['ctx'] => ({
  settings: DEFAULT_SETTINGS, setSettings: vi.fn(), loaded: true,
  account: { name: null, email: null }, me: null,
  stats: { bytes: null, chats: null, images: null }, chatModel: 'chat-model',
  onModelSaved: vi.fn(), tavilyConfigured: true,
});

beforeEach(() => {
  vi.mocked(cloudApi.getCredentialStatus).mockReset().mockResolvedValue(saved);
  vi.mocked(cloudApi.putCredentials).mockReset().mockResolvedValue(saved);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ModelsBody credential changes', () => {
  it('omits untouched write-only keys and provider bindings', async () => {
    const ctx = context();
    render(<ModelsBody ctx={ctx} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(ctx.onModelSaved).toHaveBeenCalled());
    const payload = vi.mocked(cloudApi.putCredentials).mock.calls[0][0];
    expect(payload).not.toHaveProperty('key');
    expect(payload).not.toHaveProperty('tavilyKey');
    expect(payload).not.toHaveProperty('knowledgeBaseVectorStoreId');
  });

  it('sends explicit null removals and resets dirty fields from saved status', async () => {
    vi.mocked(cloudApi.putCredentials).mockResolvedValue({ ...saved, tavilyConfigured: false, tavilyHint: null, knowledgeBaseVectorStoreId: null });
    const ctx = context();
    render(<ModelsBody ctx={ctx} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove saved web search key' }));
    fireEvent.change(screen.getByLabelText(/Account knowledge base/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(ctx.onModelSaved).toHaveBeenCalledOnce());
    expect(vi.mocked(cloudApi.putCredentials).mock.calls[0][0]).toMatchObject({ tavilyKey: null, knowledgeBaseVectorStoreId: null });
    expect(screen.queryByRole('button', { name: 'Remove saved web search key' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(ctx.onModelSaved).toHaveBeenCalledTimes(2));
    const subsequent = vi.mocked(cloudApi.putCredentials).mock.calls[1][0];
    expect(subsequent).not.toHaveProperty('tavilyKey');
    expect(subsequent).not.toHaveProperty('knowledgeBaseVectorStoreId');
  });

  it('retains explicit removal intent after a failed save for retry', async () => {
    vi.mocked(cloudApi.putCredentials).mockRejectedValueOnce(new Error('Temporary save failure'));
    const ctx = context();
    render(<ModelsBody ctx={ctx} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove saved web search key' }));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled());
    expect(ctx.onModelSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(ctx.onModelSaved).toHaveBeenCalledOnce());
    expect(vi.mocked(cloudApi.putCredentials).mock.calls[1][0]).toHaveProperty('tavilyKey', null);
  });

  it('treats edited blank secret input as a clear without touching the knowledge base', async () => {
    const ctx = context();
    render(<ModelsBody ctx={ctx} />);
    fireEvent.change(await screen.findByLabelText(/Web search key/), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(ctx.onModelSaved).toHaveBeenCalled());
    const payload = vi.mocked(cloudApi.putCredentials).mock.calls[0][0];
    expect(payload).toHaveProperty('tavilyKey', null);
    expect(payload).not.toHaveProperty('knowledgeBaseVectorStoreId');
  });
});