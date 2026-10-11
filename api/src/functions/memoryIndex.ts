import { app, type InvocationContext, type Timer } from '@azure/functions';
import { container } from '../composition';

app.timer('memoryIndex', {
  schedule: '0 */1 * * * *',
  runOnStartup: false,
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    if (process.env.MEMORY_INDEX_ENABLED !== '1' && process.env.MEMORY_INDEX_ENABLED !== 'true') return;
    try {
      const result = await container().memoryIndex?.reconcile();
      if (result?.deferred) context.warn('Memory indexing retained retryable work.', { deferred: result.deferred });
    } catch {
      context.warn('Memory indexing could not complete its bounded pass.');
    }
  },
});