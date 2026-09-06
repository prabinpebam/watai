export function installViewportFrame(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let frame = 0;

  const render = () => {
    frame = 0;
    if (viewport && viewport.scale !== 1) return;
    root.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`);
    root.style.setProperty('--viewport-top', `${viewport?.offsetTop ?? 0}px`);
  };

  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(render);
  };

  render();
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule);
  window.addEventListener('pageshow', schedule);

  return () => {
    window.cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('pageshow', schedule);
    root.style.removeProperty('--app-height');
    root.style.removeProperty('--viewport-top');
  };
}