function isEditable(element: Element | null): boolean {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || (element instanceof HTMLElement && element.isContentEditable);
}

export function syncViewport(): void {
  const viewport = window.visualViewport;
  const height = Math.max(1, window.innerHeight);
  const overlap = viewport
    ? Math.max(0, height - viewport.height - viewport.offsetTop)
    : 0;
  const keyboardInset = isEditable(document.activeElement) && overlap > 80 ? overlap : 0;

  document.documentElement.style.setProperty('--app-height', `${height}px`);
  document.documentElement.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
}

export function installViewportSync(): () => void {
  let frame = 0;
  const schedule = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(syncViewport);
  };

  syncViewport();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.addEventListener('pageshow', schedule, { passive: true });
  document.addEventListener('focusin', schedule, { passive: true });
  document.addEventListener('focusout', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true });

  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.removeEventListener('pageshow', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
  };
}