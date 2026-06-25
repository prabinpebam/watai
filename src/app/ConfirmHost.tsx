import { useUi } from '../state/store';
import { ConfirmDialog } from '../design/overlays';

/** Renders the app's single pending confirmation as a design-system dialog. Lets any layer
 *  (including the agent orchestrator) request a confirmation without a native window.confirm. */
export function ConfirmHost() {
  const req = useUi((s) => s.confirmRequest);
  const resolve = useUi((s) => s.resolveConfirm);
  if (!req) return null;
  return (
    <ConfirmDialog
      title={req.title}
      message={req.message}
      confirmLabel={req.confirmLabel}
      danger={req.danger}
      onConfirm={() => resolve(true)}
      onClose={() => resolve(false)}
    />
  );
}
