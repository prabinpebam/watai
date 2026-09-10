import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ConfirmDialog, Menu, Modal } from './overlays';

vi.mock('../lib/hooks', async () => {
  const actual = await vi.importActual<typeof import('../lib/hooks')>('../lib/hooks');
  return { ...actual, useIsExpanded: () => true };
});

afterEach(cleanup);

describe('Modal accessibility contract', () => {
  it('names the dialog from its visible heading, inerts the app, and restores trigger focus', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <div id="root"><button onClick={() => setOpen(true)}>Open delete</button>{open && (
        <ConfirmDialog title="Delete thread?" message="This cannot be undone." onConfirm={vi.fn()} onClose={() => setOpen(false)} />
      )}</div>;
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open delete' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Delete thread?' })).toBeInTheDocument();
    expect(document.getElementById('root')).toHaveAttribute('inert');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.getElementById('root')).not.toHaveAttribute('inert');
  });

  it('closes only the top nested dialog and returns focus through each layer', async () => {
    function Harness() {
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(false);
      return <div id="root"><button onClick={() => setOuter(true)}>Open outer</button>{outer && (
        <Modal title="Outer" onClose={() => setOuter(false)}>
          <button onClick={() => setInner(true)}>Open inner</button>
          {inner && <Modal title="Inner" onClose={() => setInner(false)}><button>Inner action</button></Modal>}
        </Modal>
      )}</div>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open outer' }));
    const innerTrigger = await screen.findByRole('button', { name: 'Open inner' });
    innerTrigger.focus();
    fireEvent.click(innerTrigger);
    expect(screen.getByRole('dialog', { name: 'Outer' })).toHaveAttribute('inert');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Inner' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
    expect(innerTrigger).toHaveFocus();
  });
});

describe('Menu keyboard contract', () => {
  it('focuses the first command and supports arrows, Home, and End', async () => {
    render(<Menu x={10} y={10} onClose={vi.fn()} items={[
      { label: 'Rename', onClick: vi.fn() },
      { label: 'Archive', onClick: vi.fn() },
      { label: 'Delete', onClick: vi.fn() },
    ]} />);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
  });
});