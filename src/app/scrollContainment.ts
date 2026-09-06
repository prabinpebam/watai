export function installScrollContainment(): () => void {
  let previousTouch: { clientX: number; clientY: number } | undefined;
  let axis: 'x' | 'y' | undefined;
  let allowNativeGesture = false;

  const onStart = (event: TouchEvent) => {
    previousTouch = event.touches.length === 1 ? event.touches[0] : undefined;
    axis = undefined;
    const target = event.composedPath()[0];
    const selection = document.getSelection();
    allowNativeGesture = target instanceof Node && !!selection
      && !selection.isCollapsed && selection.containsNode(target, true);
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      allowNativeGesture ||= (target instanceof HTMLInputElement && target.type === 'range')
        || (target === document.activeElement && target.selectionStart !== null
          && target.selectionEnd !== null && target.selectionStart < target.selectionEnd);
    }
  };

  const onMove = (event: TouchEvent) => {
    if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) !== 1) {
      previousTouch = undefined;
      return;
    }
    const currentTouch = event.touches[0];
    const previous = previousTouch;
    previousTouch = currentTouch;
    if (!previous || event.defaultPrevented || allowNativeGesture) return;
    const deltaX = previous.clientX - currentTouch.clientX;
    const deltaY = previous.clientY - currentTouch.clientY;
    if (!deltaX && !deltaY) return;
    axis ??= Math.abs(deltaY) >= Math.abs(deltaX) ? 'y' : 'x';
    const delta = axis === 'y' ? deltaY : deltaX;
    if (!delta) return;

    for (const target of event.composedPath()) {
      if (target === document.body || target === document.documentElement) break;
      if (!(target instanceof HTMLElement)) continue;
      const style = getComputedStyle(target);
      const overflow = axis === 'y' ? style.overflowY : style.overflowX;
      const extent = axis === 'y'
        ? target.scrollHeight - target.clientHeight
        : target.scrollWidth - target.clientWidth;
      if (!/^(auto|scroll)$/.test(overflow) || extent <= 0) continue;
      let position = axis === 'y' ? target.scrollTop : target.scrollLeft;
      if (axis === 'x' && style.direction === 'rtl') position += extent;
      if (delta < 0 ? position > 0 : position < extent - 1) return;
      break;
    }
    if (event.cancelable) event.preventDefault();
  };

  document.addEventListener('touchstart', onStart, { passive: true, capture: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  return () => {
    document.removeEventListener('touchstart', onStart, true);
    document.removeEventListener('touchmove', onMove);
  };
}