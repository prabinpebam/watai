import { useEffect, useState } from 'react';
import { repo } from '../../data';
import { DEFAULT_SETTINGS, type Settings } from '../../lib/types';
import { useUi } from '../../state/store';

/** Loads settings once and keeps the UI store (appearance) in sync on save. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const ui = useUi();

  useEffect(() => {
    repo.getSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
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

  return { settings, setSettings: save, loaded };
}
