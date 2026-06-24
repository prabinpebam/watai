import { useEffect, type ReactNode } from 'react';
import { useUi } from '../state/store';

/** Applies theme, density, text scale, reduced-motion, and live viewport vars. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUi((s) => s.theme);
  const density = useUi((s) => s.density);
  const textScale = useUi((s) => s.textScale);
  const reduceMotion = useUi((s) => s.reduceMotion);

  // Theme (with live system updates)
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    apply();
    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * textScale}px`;
  }, [textScale]);

  useEffect(() => {
    const reduce =
      reduceMotion === true ||
      (reduceMotion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.documentElement.style.setProperty('--motion-scale', reduce ? '0' : '1');
  }, [reduceMotion]);

  return <>{children}</>;
}
