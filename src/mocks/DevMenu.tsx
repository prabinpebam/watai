import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useUi } from '../state/store';
import { Icon } from '../design/icons';
import { Button } from '../design/ui';
import { seedMockDataIfEmpty, repo } from '../data';

/** Lightweight dev menu: mock AI toggle, reseed demo data, theme jump. Dev builds only. */
export function DevMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
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
            <div className="scrim" style={{ background: 'transparent', zIndex: 'var(--z-modal-scrim)' }} onClick={() => setOpen(false)} />
            <div
              className="menu"
              style={{ right: 'var(--space-5)', bottom: 'var(--space-12)', left: 'auto', top: 'auto', minWidth: 240, zIndex: 'var(--z-modal)' }}
            >
              <div className="nav-group__label" style={{ padding: 'var(--space-2) var(--space-3)' }}>
                Developer
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
              <div style={{ padding: 'var(--space-3)' }}>
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
