import type { CSSProperties } from 'react';

// Logical name → Google Material Symbol ligature. The name-based API is kept so
// existing call sites (`<Icon name="copy" />`) keep working. Any name NOT in this
// map is passed through directly as a Material Symbol ligature, so the full
// Material catalog is available — just add the ligature to the `icon_names`
// subset in index.html and use it.
const ICONS: Record<string, string> = {
  menu: 'menu',
  'pen-square': 'edit_square',
  edit: 'edit_square',
  search: 'search',
  settings: 'settings',
  'arrow-up': 'arrow_upward',
  send: 'send',
  mic: 'mic',
  'mic-off': 'mic_off',
  stop: 'stop',
  'stop-circle': 'stop_circle',
  copy: 'content_copy',
  refresh: 'refresh',
  regenerate: 'refresh',
  image: 'image',
  close: 'close',
  x: 'close',
  'chevron-left': 'chevron_left',
  'chevron-down': 'expand_more',
  'chevron-right': 'chevron_right',
  'chevron-up': 'expand_less',
  more: 'more_horiz',
  pin: 'push_pin',
  archive: 'archive',
  trash: 'delete',
  'trash-can': 'delete',
  plus: 'add',
  check: 'check',
  'check-circle': 'check_circle',
  alert: 'warning',
  error: 'error',
  info: 'info',
  sun: 'light_mode',
  moon: 'dark_mode',
  paperclip: 'attach_file',
  download: 'download',
  share: 'share',
  external: 'open_in_new',
  user: 'person',
  sparkle: 'auto_awesome',
  sidebar: 'view_sidebar',
  speaker: 'volume_up',
  'speaker-off': 'volume_off',
  key: 'key',
  link: 'link',
  globe: 'public',
  shield: 'shield',
  database: 'database',
  palette: 'palette',
  type: 'text_fields',
  bug: 'bug_report',
  logout: 'logout',
  // Files & previews
  file: 'description',
  'file-pdf': 'picture_as_pdf',
  'file-image': 'image',
  'file-code': 'code',
  'file-csv': 'csv',
  'file-text': 'description',
  'file-zip': 'folder_zip',
  'file-audio': 'audio_file',
  'file-video': 'video_file',
  expand: 'open_in_full',
  code: 'code',
  play: 'play_arrow',
  pause: 'pause',
  wrap: 'wrap_text',
  // Feedback
  'thumbs-up': 'thumb_up',
  'thumbs-down': 'thumb_down',
};

interface IconProps {
  name: keyof typeof ICONS | string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Use the filled (FILL 1) glyph variant — handy for selected/active states. */
  filled?: boolean;
  title?: string;
}

export function Icon({ name, size = 20, className, style, filled, title }: IconProps) {
  const ligature = ICONS[name] ?? name;
  return (
    <span
      className={`micon material-symbols-rounded ${className ?? ''}`}
      style={{
        fontSize: `${size}px`,
        ...(filled ? { fontVariationSettings: "'FILL' 1" } : null),
        ...style,
      }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      title={title}
      translate="no"
    >
      {ligature}
    </span>
  );
}
