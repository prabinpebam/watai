import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../state/store';
import { Icon } from '../design/icons';

export function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 3200));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  return createPortal(
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.kind === 'success' && <Icon name="check" size={16} />}
          {t.kind === 'error' && <Icon name="alert" size={16} />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
