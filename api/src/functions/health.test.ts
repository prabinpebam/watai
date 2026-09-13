import { expect, it, vi } from 'vitest';
vi.mock('@azure/functions', () => ({ app: { http: vi.fn() } }));
import { health } from './health';

it('identifies the active alpha release without exposing configuration', async () => {
  const result = await health({} as never, {} as never);
  expect(result.status).toBe(200);
  expect(result.jsonBody).toEqual({
    ok: true, service: 'watai-api', release: 'image-alpha-2026-09-13-r1', time: expect.any(String),
  });
});