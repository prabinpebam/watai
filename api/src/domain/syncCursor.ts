import { AppError } from './errors';

export function validateReplayCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  if (!Number.isFinite(Date.parse(cursor))) {
    throw new AppError('validation', 'Invalid sync cursor. Retry without the cursor for a full resync.', {
      resyncRequired: true,
    });
  }
  return cursor;
}