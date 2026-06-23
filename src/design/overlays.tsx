import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, Button } from './ui';
import { Icon } from './icons';
import { useIsExpanded } from '../lib/hooks';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

interface ModalProps {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** On compact screens render as a bottom sheet instead of a centered dialog. */
  adaptive?: boolean;
}

/** Centered dialog on expanded, bottom sheet on compact (when adaptive). */
export function Modal({ title, onClose, children, footer, adaptive = true }: ModalProps) {
  const expanded = useIsExpanded();
  useEscape(onClose);
  const asSheet = adaptive && !expanded;

  const body = asSheet ? (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__grip" />
        {title && (
          <div className="modal__header" style={{ padding: '0 0 12px' }}>
            <div className="modal__title">{title}</div>
            <IconButton name="close" label="Close" onClick={onClose} />
          </div>
        )}
        <div>{children}</div>
        {footer && <div className="modal__footer" style={{ paddingInline: 0 }}>{footer}</div>}
      </div>
    </>
  ) : (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal__card" role="dialog" aria-modal="true" aria-label={title}>
          {title && (
            <div className="modal__header">
              <div className="modal__title">{title}</div>
              <IconButton name="close" label="Close" onClick={onClose} />
            </div>
          )}
          <div className="modal__body">{children}</div>
          {footer && <div className="modal__footer">{footer}</div>}
        </div>
      </div>
    </>
  );

  return createPortal(body, document.body);
}

interface ConfirmProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {message}
      </p>
    </Modal>
  );
}

export interface MenuItemDef {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

interface MenuProps {
  x: number;
  y: number;
  items: MenuItemDef[];
  onClose: () => void;
}

export function Menu({ x, y, items, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Keep within viewport
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - (items.length * 44 + 20));

  return createPortal(
    <div className="menu" ref={ref} style={{ left, top }} role="menu">
      {items.map((it, i) => (
        <button
          key={i}
          role="menuitem"
          className={`menu__item ${it.danger ? 'menu__item--danger' : ''}`}
          onClick={() => {
            it.onClick();
            onClose();
          }}
        >
          {it.icon && <Icon name={it.icon} size={18} />}
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
