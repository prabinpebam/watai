import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareFile, saveFile } from './saveFile';
import { activateUiOwner, clearUiOwnerData } from '../state/store';

afterEach(() => {
  clearUiOwnerData();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('prepared download ownership', () => {
  it.each([false, true])('preserves prepared iOS sharing only for the current owner (cleared=%s)', async cleared => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 1, canShare: () => true, share });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('prepared bytes'));
    const source = `https://blob.test/ios-${cleared}.png`;
    await prepareFile(source);
    const saving = saveFile(source, 'image.png');
    if (cleared) clearUiOwnerData();
    await saving;
    expect(fetch).toHaveBeenCalledOnce();
    expect(share).toHaveBeenCalledTimes(cleared ? 0 : 1);
    if (!cleared) expect(share).toHaveBeenCalledWith({ files: [expect.any(File)] });
  });

  it.each(['success', 'failure'])('prevents late ordinary download %s from acting after an owner change', async outcome => {
    let resolve!: (response: Response) => void;
    let reject!: (error: Error) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>((done, fail) => { resolve = done; reject = fail; }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const create = vi.fn(() => 'blob:test-download');
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
    const saving = saveFile('https://blob.test/ordinary.png', 'ordinary.png');
    await activateUiOwner('new-download-owner');
    if (outcome === 'success') resolve(new Response('late bytes'));
    else reject(new Error('Late failure'));
    await saving;
    expect(click).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['device-clear', 'timer'])('releases a normal download URL exactly once through %s', async action => {
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:owned-download'); static revokeObjectURL = revoke; });
    await saveFile(new Blob(['file']), 'file.txt');
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    if (action === 'device-clear') clearUiOwnerData();
    else vi.advanceTimersByTime(10_000);
    expect(revoke.mock.calls).toEqual([['blob:owned-download']]);
    clearUiOwnerData();
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledOnce();
  });

  it('does not open a fallback URL for a download cancelled by device clearing', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const source = 'https://blob.test/cancelled.png';
    const prepared = prepareFile(source)!.catch(() => undefined);
    const saving = saveFile(source, 'cancelled.png');
    clearUiOwnerData();
    resolve(new Response('late bytes'));
    await Promise.all([prepared, saving]);
    expect(open).not.toHaveBeenCalled();
  });

  it('aborts cleared prefetches and preserves a newer request for the same URL', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    let reject!: (error: Error) => void;
    const pending = new Promise<Response>((_resolve, fail) => { reject = fail; });
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending).mockResolvedValue(new Response('fresh bytes'));
    const source = 'https://blob.test/pending.png';
    const abandoned = prepareFile(source)!.catch(() => undefined);
    const signal = (fetch.mock.calls[0][1] as RequestInit | undefined)?.signal;
    clearUiOwnerData();
    expect(signal?.aborted).toBe(true);
    const fresh = prepareFile(source);
    await fresh;
    reject(new Error('Old request failed'));
    await abandoned;
    expect(prepareFile(source)).toBe(fresh);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['device-clear', 'owner-change'])('does not retain prepared file bytes after %s', async action => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('synthetic file bytes'));
    const source = `https://blob.test/${action}.png`;
    await prepareFile(source);
    await prepareFile(source);
    expect(fetch).toHaveBeenCalledTimes(1);
    if (action === 'device-clear') clearUiOwnerData();
    else await activateUiOwner('different-owner');
    await prepareFile(source);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});