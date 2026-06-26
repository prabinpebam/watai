import { describe, it, expect } from 'vitest';
import { createNegotiateController } from './negotiateController';
import type { SignalRSender } from '../adapters/azure/signalr';

const fakeSignalR: SignalRSender = {
  negotiate: (userId) => ({ url: `https://x/client/?hub=watai&u=${userId}`, accessToken: 'tok' }),
  sendToUser: async () => {},
};

describe('negotiateController', () => {
  it('returns the connection info for the authenticated user', async () => {
    const ctrl = createNegotiateController(fakeSignalR);
    const res = await ctrl.negotiate({ claims: { sub: 'userA' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: 'https://x/client/?hub=watai&u=userA', accessToken: 'tok' });
  });

  it('returns an empty url when realtime push is not configured', async () => {
    const ctrl = createNegotiateController(null);
    const res = await ctrl.negotiate({ claims: { sub: 'userA' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: '', accessToken: '' });
  });

  it('rejects an unauthenticated request → 401', async () => {
    const ctrl = createNegotiateController(fakeSignalR);
    const res = await ctrl.negotiate({ claims: {} });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('unauthorized');
  });
});
