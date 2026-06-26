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
      {loading ? <Spinner size="sm" /> : icon ? <Icon name={icon} size={18} /> : null}
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
  filled?: boolean;
}

export function IconButton({ name, label, size = 22, variant = 'default', big, filled, className = '', ...rest }: IconButtonProps) {
  const cls = ['icon-btn', variant === 'accent' && 'icon-btn--accent', variant === 'muted' && 'icon-btn--muted', big && 'icon-btn--lg', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} aria-label={label} title={label} {...rest}>
      <Icon name={name} size={size} filled={filled} />
    </button>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, id, disabled }: SwitchProps) {
  return (
    <span className={`switch${disabled ? ' switch--disabled' : ''}`}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
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

type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl';

export function Spinner({ size = 'md', className = '' }: { size?: SpinnerSize; className?: string }) {
  return (
    <span
      className={`spinner spinner--${size}${className ? ` ${className}` : ''}`}
      aria-label="Loading"
      role="status"
    />
  );
}

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  /** Box + initials size from the token scale (28 / 36 / 64 / 72). */
  size?: AvatarSize;
  /** `accent` (user, accent fill), `assistant` (primary fill), or `danger` (tinted). */
  variant?: 'accent' | 'assistant' | 'danger';
  className?: string;
  /** An `<Icon>` or initials text. */
  children?: ReactNode;
}

/** Circular avatar. Size + color come entirely from variant classes — never inline styles. */
export function Avatar({ size = 'md', variant = 'accent', className = '', children }: AvatarProps) {
  const cls = ['avatar', `avatar--${size}`, variant !== 'accent' && `avatar--${variant}`, className]
    .filter(Boolean)
    .join(' ');
  return <span className={cls}>{children}</span>;
}

type AlertTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const ALERT_ICON: Record<AlertTone, string> = {
  neutral: 'info',
  info: 'info',
  success: 'check',
  warning: 'alert',
  danger: 'alert',
};

interface InlineAlertProps {
  tone?: AlertTone;
  /** Override the default per-tone status icon. */
  icon?: string;
  className?: string;
  children: ReactNode;
}

/** Inline status / banner message with a leading tone icon. Tone sets color + ARIA role. */
export function InlineAlert({ tone = 'neutral', icon, className = '', children }: InlineAlertProps) {
  const cls = ['alert', tone !== 'neutral' && `alert--${tone}`, className].filter(Boolean).join(' ');
  const role = tone === 'warning' || tone === 'danger' ? 'alert' : 'status';
  return (
    <div className={cls} role={role}>
      <span className="alert__icon">
        <Icon name={icon ?? ALERT_ICON[tone]} size={18} />
      </span>
      <span>{children}</span>
    </div>
  );
}
