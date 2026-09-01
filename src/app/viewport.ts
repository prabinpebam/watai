function isEditable(element: Element | null): boolean {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || (element instanceof HTMLElement && element.isContentEditable);
}

export function syncViewport(): void {
  const viewport = window.visualViewport;
  const layoutHeight = Math.max(1, window.innerHeight);
  const visualHeight = Math.max(1, viewport?.height ?? layoutHeight);
  const keyboardOpen = Boolean(
    viewport
    && isEditable(document.activeElement)
    && (viewport.scale ?? 1) <= 1.01
    && layoutHeight - visualHeight > 80,
  );
  const appHeight = keyboardOpen ? visualHeight : layoutHeight;

  // Use exactly one keyboard compensation model. The shell maps to the visible
  // viewport height; adding the keyboard height as composer padding as well
  // would move the editor twice. Deliberately ignore offsetTop: Safari changes it
  // while keeping a focused editor visible, and moving the editor in response
  // creates a scroll/layout feedback loop that interrupts typing.
  document.documentElement.style.setProperty('--app-height', `${appHeight}px`);
  document.documentElement.style.removeProperty('--keyboard-inset');
  document.documentElement.toggleAttribute('data-keyboard-open', keyboardOpen);
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

  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.removeEventListener('pageshow', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    document.documentElement.style.removeProperty('--app-height');
    document.documentElement.style.removeProperty('--keyboard-inset');
    document.documentElement.removeAttribute('data-keyboard-open');
  };
}