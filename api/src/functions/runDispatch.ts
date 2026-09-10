import { app, type InvocationContext, type Timer } from '@azure/functions';
import { container } from '../composition';

app.timer('runDispatch', {
  schedule: '0 */1 * * * *',
  runOnStartup: false,
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const services = container();
    const [runs, images] = await Promise.all([services.runDispatch.reconcile(), services.imageDispatch.reconcile()]);
    if (runs.failed > 0 || images.failed > 0) context.warn('Dispatch reconciliation retained pending work.', { runs, images });
  },
});