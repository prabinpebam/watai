import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../state/store';
import { onAuthState, signInRedirect } from '../auth/cloudAuth';
import { Icon } from '../design/icons';

/**
 * A persistent top banner that makes cloud-connection failures visible instead of letting them
 * fail silently. It reflects two states:
 *   - `offline`: the browser reports no network — reads still work from the local cache, but AI
 *     actions and sync are paused until the connection returns.
 *   - `reauth`: the account is still cached (so the app renders) but the session can't be renewed
 *     silently, so every request 401s as "Not signed in." The user re-authenticates with one tap.
 *
 * The precedence (offline first, then reauth) lives here so the store stays a plain flag holder.
 */
export function ConnectionBanner() {
  const connection = useUi((s) => s.connection);
  const setConnection = useUi((s) => s.setConnection);
  const [reauth, setReauth] = useState(false);

  // Session-health signal from the auth layer (silent-renew failed and can't auto-recover).
  useEffect(() => onAuthState((state) => setReauth(state === 'reauth-required')), []);

  // Network signal from the browser. Offline takes precedence — a re-auth can't succeed with no
  // network anyway — and coming back online clears the network state without masking a re-auth need.
  useEffect(() => {
    const recompute = () =>
      setConnection(!navigator.onLine ? 'offline' : reauth ? 'reauth' : 'ok');
    recompute();
    window.addEventListener('online', recompute);
    window.addEventListener('offline', recompute);
    return () => {
      window.removeEventListener('online', recompute);
      window.removeEventListener('offline', recompute);
    };
  }, [reauth, setConnection]);

  if (connection === 'ok') return null;

  const offline = connection === 'offline';
  return createPortal(
    <div className={`conn-banner conn-banner--${connection}`} role="alert" aria-live="assertive">
      <Icon name="alert" size={16} />
      <span className="conn-banner__text">
        {offline
          ? "You're offline. Your chats are saved on this device and will sync when you reconnect."
          : 'Your session expired. Sign in again to keep chatting.'}
      </span>
      {!offline && (
        <button className="conn-banner__action" onClick={() => void signInRedirect()}>
          Sign in
        </button>
      )}
    </div>,
    document.body,
  );
}
