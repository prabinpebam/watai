import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, Button } from './ui';
import { Icon } from './icons';
import { useIsExpanded, useDismiss } from '../lib/hooks';

interface ModalStackEntry {
  dialog: HTMLElement;
  onClose: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
}

export function useDialogLayer(
  dialogRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
  onKeyDown?: (event: KeyboardEvent) => void,
): void {
  const triggerRef = useRef<HTMLElement | null>(null);
  const stackEntryRef = useRef<ModalStackEntry | null>(null);
  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry = { dialog, onClose, onKeyDown };
    stackEntryRef.current = entry;
    modalStack.push(entry);
    updateModalLayers();
    dialog.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')?.focus();
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== entry) return;
      if (event.key === 'Escape') entry.onClose();
      else entry.onKeyDown?.(event);
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown);
      const index = modalStack.indexOf(entry);
      if (index >= 0) modalStack.splice(index, 1);
      updateModalLayers();
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
      stackEntryRef.current = null;
    };
  }, [active]);
  useEffect(() => {
    if (stackEntryRef.current) {
      stackEntryRef.current.onClose = onClose;
      stackEntryRef.current.onKeyDown = onKeyDown;
    }
  }, [onClose, onKeyDown]);
}

const modalStack: ModalStackEntry[] = [];

function updateModalLayers(): void {
  const appRoot = document.getElementById('root');
  if (modalStack.length) appRoot?.setAttribute('inert', '');
  else appRoot?.removeAttribute('inert');
  modalStack.forEach((entry, index) => {
    if (index === modalStack.length - 1) entry.dialog.removeAttribute('inert');
    else entry.dialog.setAttribute('inert', '');
  });
}

interface ModalProps {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** On compact screens render as a bottom sheet instead of a centered dialog. */
  adaptive?: boolean;
  labelledBy?: string;
}

/** Centered dialog on expanded, bottom sheet on compact (when adaptive). */
export function Modal({ title, onClose, children, footer, adaptive = true, labelledBy }: ModalProps) {
  const expanded = useIsExpanded();
  const asSheet = adaptive && !expanded;
  const dialogRef = useRef<HTMLDivElement>(null);
  const generatedTitleId = useId();
  useDialogLayer(dialogRef, true, onClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const selector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.closest('[hidden], [inert]'));
    if (!dialog.contains(document.activeElement)) focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [asSheet]);

  const body = asSheet ? (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div ref={dialogRef} className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? (title ? generatedTitleId : undefined)}>
        <div className="sheet__grip" />
        {title && (
          <div className="modal__header">
            <div className="modal__title" id={generatedTitleId}>{title}</div>
            <IconButton name="close" label="Close" onClick={onClose} />
          </div>
        )}
        <div>{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </>
  ) : (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div ref={dialogRef} className="modal__card" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? (title ? generatedTitleId : undefined)}>
          {title && (
            <div className="modal__header">
              <div className="modal__title" id={generatedTitleId}>{title}</div>
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
  cancelLabel?: string;
  danger?: boolean;
  /** Icon for the badge; defaults to a trash icon when danger, else info. */
  icon?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  icon,
  onConfirm,
  onClose,
}: ConfirmProps) {
  const titleId = useId();
  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
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
      <div className="dialog">
        <div className={`dialog__icon ${danger ? 'dialog__icon--danger' : ''}`}>
          <Icon name={icon ?? (danger ? 'trash' : 'info')} size={22} />
        </div>
        <div className="dialog__text">
          <h3 className="dialog__title" id={titleId}>{title}</h3>
          <p className="dialog__message">{message}</p>
        </div>
      </div>
    </Modal>
  );
}

interface PromptProps {
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  icon?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

/** A single-line text-input dialog (e.g. rename) sharing the ConfirmDialog visual language. */
export function PromptDialog({
  title,
  message,
  initialValue = '',
  placeholder,
  confirmLabel = 'Save',
  icon = 'pen-square',
  onSubmit,
  onClose,
}: PromptProps) {
  const titleId = useId();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => clearTimeout(t);
  }, []);
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    onClose();
  };
  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="dialog">
        <div className="dialog__icon">
          <Icon name={icon} size={22} />
        </div>
        <div className="dialog__text">
          <h3 className="dialog__title" id={titleId}>{title}</h3>
          {message && <p className="dialog__message">{message}</p>}
          <input
            ref={inputRef}
            className="input dialog__input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            aria-label={title}
          />
        </div>
      </div>
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
  const triggerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useDismiss(true, onClose, [ref]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => { if (triggerRef.current?.isConnected) triggerRef.current.focus(); };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menuItems = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const current = Math.max(0, menuItems.indexOf(document.activeElement as HTMLButtonElement));
    let next = current;
    if (event.key === 'ArrowDown') next = (current + 1) % menuItems.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + menuItems.length) % menuItems.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = menuItems.length - 1;
    else return;
    event.preventDefault();
    menuItems[next]?.focus();
  };

  // Keep within viewport
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - (items.length * 44 + 20));

  return createPortal(
    <div className="menu" ref={ref} style={{ left, top }} role="menu" onKeyDown={onKeyDown}>
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
