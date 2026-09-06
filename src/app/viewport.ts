import { installScrollContainment } from './scrollContainment';

export function syncViewport(): void {
  const viewport = window.visualViewport;
  if (viewport && viewport.scale !== 1) return;
  const appHeight = Math.max(1, viewport?.height ?? window.innerHeight);
  document.documentElement.style.setProperty('--app-height', `${appHeight}px`);
}

export function installViewportSync(): () => void {
  const removeScrollContainment = installScrollContainment();
  let frame = 0;
  const schedule = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(syncViewport);
  };

  syncViewport();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('pageshow', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });

  return () => {
    removeScrollContainment();
    window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('pageshow', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    document.documentElement.style.removeProperty('--app-height');
  };
}