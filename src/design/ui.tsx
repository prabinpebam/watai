import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { Icon } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  loading?: boolean;
  icon?: string;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  full,
  loading,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const cls = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, full && 'btn--full', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  name: string;
  label: string;
  size?: number;
  variant?: 'default' | 'accent' | 'muted';
  big?: boolean;
}

export function IconButton({ name, label, size = 22, variant = 'default', big, className = '', ...rest }: IconButtonProps) {
  const cls = ['icon-btn', variant === 'accent' && 'icon-btn--accent', variant === 'muted' && 'icon-btn--muted', big && 'icon-btn--lg', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} aria-label={label} title={label} {...rest}>
      <Icon name={name} size={size} />
    </button>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id?: string;
}

export function Switch({ checked, onChange, label, id }: SwitchProps) {
  return (
    <span className="switch">
      <input id={id} type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" />
      <span className="switch__thumb" />
    </span>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Field({ label, hint, error, className = '', id, ...rest }: FieldProps) {
  return (
    <label className="field" htmlFor={id}>
      {label && <span className="field__label">{label}</span>}
      <input id={id} className={`input ${className}`} {...rest} />
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

export function TextAreaField({ label, hint, className = '', id, ...rest }: TextAreaFieldProps) {
  return (
    <label className="field" htmlFor={id}>
      {label && <span className="field__label">{label}</span>}
      <textarea id={id} className={`textarea ${className}`} {...rest} />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={`segmented__item ${o.value === value ? 'segmented__item--active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ large }: { large?: boolean }) {
  return <span className={`spinner ${large ? 'spinner--lg' : ''}`} aria-label="Loading" role="status" />;
}
