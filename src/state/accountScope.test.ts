import { beforeEach, describe, expect, it } from 'vitest';
import { activateUiOwner, uiStorageNameForOwner, useUi } from './store';

beforeEach(async () => {
  localStorage.clear();
  await activateUiOwner(null);
});

describe('UI account scope', () => {
  it('keeps drafts isolated across account switches and quarantines legacy state', async () => {
    localStorage.setItem('watai.ui', JSON.stringify({ state: { composerDrafts: { shared: 'legacy' } }, version: 1 }));

    await activateUiOwner('owner-a');
    useUi.getState().setDraft('shared', 'owner A');

    await activateUiOwner('owner-b');
    expect(useUi.getState().composerDrafts).toEqual({});
    useUi.getState().setDraft('shared', 'owner B');

    await activateUiOwner('owner-a');
    expect(useUi.getState().composerDrafts).toEqual({ shared: 'owner A' });
    expect(localStorage.getItem('watai.ui')).toContain('legacy');
    expect(localStorage.getItem(uiStorageNameForOwner('owner-b'))).toContain('owner B');
  });
});
