import { useCallback, useEffect, useRef, useState } from 'react';
import { currentAccountKvStore, loadAccountSettings, repo } from '../../data';
import { DEFAULT_SETTINGS, type Settings } from '../../lib/types';
import { useUi } from '../../state/store';

/** Loads settings once and keeps the UI store (appearance) in sync on save. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const ui = useUi();
  const lifetime = useRef({ active: true, scope: currentAccountKvStore() });
  const saveGeneration = useRef(0);
  const isCurrentLifetime = (token = lifetime.current) => token.active && token.scope === currentAccountKvStore();

  useEffect(() => {
    const token = { active: true, scope: currentAccountKvStore() };
    lifetime.current = token;
    return () => { token.active = false; };
  }, []);

  useEffect(() => {
    const token = lifetime.current;
    if (!isCurrentLifetime(token)) return;
    let active = true;
    const generation = saveGeneration.current;
    loadAccountSettings()
      .then((s) => {
        if (!active || !isCurrentLifetime(token)) return;
        if (generation === saveGeneration.current) setSettings(s);
        setLoaded(true);
        setDegraded(false);
      })
      .catch(() => {
        if (!active || !isCurrentLifetime(token)) return;
        setLoaded(false);
        setDegraded(true);
      });
    return () => { active = false; };
  }, [loadAttempt]);

  const retry = useCallback(() => {
    if (!isCurrentLifetime()) return;
    setDegraded(false);
    setLoadAttempt((value) => value + 1);
  }, []);

  const save = async (next: Settings) => {
    const token = lifetime.current;
    if (!isCurrentLifetime(token)) return;
    const generation = ++saveGeneration.current;
    setSettings(next);
    await repo.saveSettings(next);
    if (!isCurrentLifetime(token) || generation !== saveGeneration.current) return;
    // mirror appearance into the live UI store
    ui.setTheme(next.appearance.theme);
    ui.setTextScale(next.appearance.textScale);
    ui.setDensity(next.appearance.density);
    ui.setReduceMotion(next.appearance.reduceMotion);
  };

  return { settings, setSettings: save, loaded, degraded, retry };
}
