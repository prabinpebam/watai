import { createHash } from 'node:crypto';

export function ownerScopedDocumentId(kind: 'message' | 'run' | 'run-admission' | 'run-slot' | 'run-dispatch', userId: string, publicId: string): string {
  const digest = createHash('sha256').update(userId).update('\0').update(publicId).digest('hex');
  return `${kind}_${digest}`;
}