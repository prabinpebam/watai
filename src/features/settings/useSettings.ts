import { useCallback, useEffect, useState } from 'react';
import { loadAccountSettings, repo } from '../../data';
import { DEFAULT_SETTINGS, type Settings } from '../../lib/types';
import { useUi } from '../../state/store';

/** Loads settings once and keeps the UI store (appearance) in sync on save. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const ui = useUi();

  useEffect(() => {
    loadAccountSettings()
      .then((s) => {
        setSettings(s);
        setLoaded(true);
        setDegraded(false);
      })
      .catch(() => {
        setLoaded(false);
        setDegraded(true);
      });
  }, [loadAttempt]);

  const retry = useCallback(() => {
    setDegraded(false);
    setLoadAttempt((value) => value + 1);
  }, []);

  const save = async (next: Settings) => {
    setSettings(next);
    await repo.saveSettings(next);
    // mirror appearance into the live UI store
    ui.setTheme(next.appearance.theme);
    ui.setTextScale(next.appearance.textScale);
    ui.setDensity(next.appearance.density);
    ui.setReduceMotion(next.appearance.reduceMotion);
  };

  return { settings, setSettings: save, loaded, degraded, retry };
}
