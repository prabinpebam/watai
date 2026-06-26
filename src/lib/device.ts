import { newId } from './ids';

const DEVICE_ID_KEY = 'watai.deviceId';

/**
 * A stable, per-device id used to coordinate the per-thread run lock (so a device can recognise
 * its own lock and so the server can tell devices apart). Generated once and persisted in
 * localStorage — it is device-local and intentionally NOT synced.
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = newId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // Private mode / storage disabled: fall back to a per-session id (still unique enough).
    return newId();
  }
}

/** A short, human-friendly label for this device, e.g. "Chrome on Windows", for the locked UX. */
export function getDeviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'a browser';
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}
