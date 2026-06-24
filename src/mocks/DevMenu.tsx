import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useUi } from '../state/store';
import { Icon } from '../design/icons';
import { Switch, Button } from '../design/ui';
import { seedMockDataIfEmpty, repo } from '../data';

/** Lightweight dev menu: mock AI toggle, reseed demo data, theme jump. Dev builds only. */
export function DevMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const mockAi = useUi((s) => s.mockAi);
  const setMockAi = useUi((s) => s.setMockAi);
  const setTheme = useUi((s) => s.setTheme);
  const theme = useUi((s) => s.theme);
  const bump = useUi((s) => s.bumpThreads);
  const pushToast = useUi((s) => s.pushToast);

  return (
    <>
      <button className="dev-fab" title="Developer menu" onClick={() => setOpen((o) => !o)} aria-label="Developer menu">
        <Icon name="bug" size={20} />
      </button>
      {open &&
        createPortal(
          <>
            <div className="scrim" style={{ background: 'transparent', zIndex: 590 }} onClick={() => setOpen(false)} />
            <div
              className="menu"
              style={{ right: 16, bottom: 64, left: 'auto', top: 'auto', minWidth: 240, zIndex: 600 }}
            >
              <div className="nav-group__label" style={{ padding: '4px 8px' }}>
                Developer
              </div>
              <div className="setting-row" style={{ padding: '8px', borderBottom: 'none' }}>
                <div className="setting-row__body">
                  <div className="setting-row__title" style={{ fontSize: 'var(--text-callout-size)' }}>
                    Mock AI
                  </div>
                </div>
                <Switch checked={mockAi} onChange={setMockAi} label="Mock AI" />
              </div>
              <button
                className="menu__item"
                onClick={async () => {
                  await repo.deleteAll();
                  localStorage.removeItem('watai.seeded');
                  await seedMockDataIfEmpty();
                  bump();
                  pushToast('Demo data reseeded');
                  setOpen(false);
                }}
              >
                <Icon name="database" size={18} /> Reseed demo data
              </button>
              <button
                className="menu__item menu__item--danger"
                onClick={async () => {
                  await repo.deleteAll();
                  localStorage.removeItem('watai.seeded');
                  bump();
                  pushToast('Local data cleared');
                  setOpen(false);
                }}
              >
                <Icon name="trash" size={18} /> Clear local data
              </button>
              <div className="menu__sep" />
              <button
                className="menu__item"
                onClick={() => {
                  setOpen(false);
                  navigate('/dev/gallery');
                }}
              >
                <Icon name="image" size={18} /> Chat component gallery
              </button>
              <div className="menu__sep" />
              <div style={{ padding: 8 }}>
                <Button
                  size="sm"
                  full
                  variant="secondary"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  Toggle theme ({theme})
                </Button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
