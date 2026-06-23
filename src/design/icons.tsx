import type { CSSProperties } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faBars,
  faPenToSquare,
  faMagnifyingGlass,
  faGear,
  faArrowUp,
  faPaperPlane,
  faMicrophone,
  faMicrophoneSlash,
  faStop,
  faCircleStop,
  faCopy,
  faArrowsRotate,
  faImage,
  faXmark,
  faChevronLeft,
  faChevronDown,
  faChevronRight,
  faChevronUp,
  faEllipsis,
  faThumbtack,
  faBoxArchive,
  faTrash,
  faTrashCan,
  faPlus,
  faCheck,
  faTriangleExclamation,
  faCircleExclamation,
  faCircleInfo,
  faSun,
  faMoon,
  faPaperclip,
  faDownload,
  faArrowUpFromBracket,
  faArrowUpRightFromSquare,
  faUser,
  faWandMagicSparkles,
  faTableColumns,
  faVolumeHigh,
  faVolumeXmark,
  faKey,
  faLink,
  faGlobe,
  faShieldHalved,
  faDatabase,
  faPalette,
  faFont,
  faBug,
  faRightFromBracket,
  faFile,
  faFilePdf,
  faFileImage,
  faFileCode,
  faFileCsv,
  faFileLines,
  faFileZipper,
  faFileAudio,
  faFileVideo,
  faExpand,
  faCode,
  faPlay,
  faPause,
  faTextWidth,
  faThumbsUp as faThumbsUpSolid,
  faThumbsDown as faThumbsDownSolid,
  faCircleCheck,
} from '@fortawesome/free-solid-svg-icons';
import { faThumbsUp, faThumbsDown } from '@fortawesome/free-regular-svg-icons';
import {
  faJs,
  faPython,
  faHtml5,
  faCss3Alt,
  faReact,
  faRust,
  faJava,
  faPhp,
  faNodeJs,
  faMarkdown,
  faGolang,
  faSwift,
} from '@fortawesome/free-brands-svg-icons';

// Name → FontAwesome definition. The name-based API is preserved so existing
// call sites (`<Icon name="copy" />`) keep working after the FA migration.
const ICONS: Record<string, IconDefinition> = {
  menu: faBars,
  'pen-square': faPenToSquare,
  edit: faPenToSquare,
  search: faMagnifyingGlass,
  settings: faGear,
  'arrow-up': faArrowUp,
  send: faPaperPlane,
  mic: faMicrophone,
  'mic-off': faMicrophoneSlash,
  stop: faStop,
  'stop-circle': faCircleStop,
  copy: faCopy,
  refresh: faArrowsRotate,
  regenerate: faArrowsRotate,
  image: faImage,
  close: faXmark,
  x: faXmark,
  'chevron-left': faChevronLeft,
  'chevron-down': faChevronDown,
  'chevron-right': faChevronRight,
  'chevron-up': faChevronUp,
  more: faEllipsis,
  pin: faThumbtack,
  archive: faBoxArchive,
  trash: faTrash,
  'trash-can': faTrashCan,
  plus: faPlus,
  check: faCheck,
  'check-circle': faCircleCheck,
  alert: faTriangleExclamation,
  error: faCircleExclamation,
  info: faCircleInfo,
  sun: faSun,
  moon: faMoon,
  paperclip: faPaperclip,
  download: faDownload,
  share: faArrowUpFromBracket,
  external: faArrowUpRightFromSquare,
  user: faUser,
  sparkle: faWandMagicSparkles,
  sidebar: faTableColumns,
  speaker: faVolumeHigh,
  'speaker-off': faVolumeXmark,
  key: faKey,
  link: faLink,
  globe: faGlobe,
  shield: faShieldHalved,
  database: faDatabase,
  palette: faPalette,
  type: faFont,
  bug: faBug,
  logout: faRightFromBracket,
  // Files & previews
  file: faFile,
  'file-pdf': faFilePdf,
  'file-image': faFileImage,
  'file-code': faFileCode,
  'file-csv': faFileCsv,
  'file-text': faFileLines,
  'file-zip': faFileZipper,
  'file-audio': faFileAudio,
  'file-video': faFileVideo,
  expand: faExpand,
  code: faCode,
  play: faPlay,
  pause: faPause,
  wrap: faTextWidth,
  // Feedback
  'thumbs-up': faThumbsUp,
  'thumbs-up-solid': faThumbsUpSolid,
  'thumbs-down': faThumbsDown,
  'thumbs-down-solid': faThumbsDownSolid,
};

// Brand glyphs for code-block language labels (optional, falls back to text).
const LANG_ICONS: Record<string, IconDefinition> = {
  js: faJs,
  javascript: faJs,
  jsx: faJs,
  mjs: faJs,
  ts: faJs,
  typescript: faJs,
  tsx: faReact,
  react: faReact,
  py: faPython,
  python: faPython,
  html: faHtml5,
  xml: faHtml5,
  css: faCss3Alt,
  scss: faCss3Alt,
  rust: faRust,
  rs: faRust,
  java: faJava,
  php: faPhp,
  node: faNodeJs,
  md: faMarkdown,
  markdown: faMarkdown,
  go: faGolang,
  golang: faGolang,
  swift: faSwift,
};

export function langGlyph(lang?: string): IconDefinition | null {
  if (!lang) return null;
  return LANG_ICONS[lang.toLowerCase()] ?? null;
}

interface IconProps {
  name: keyof typeof ICONS | string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Kept for API compatibility; FontAwesome glyphs are already solid. */
  filled?: boolean;
  title?: string;
}

export function Icon({ name, size = 20, className, style, title }: IconProps) {
  const def = ICONS[name] ?? faFile;
  return (
    <FontAwesomeIcon
      icon={def}
      className={className}
      title={title}
      style={{ fontSize: `${size}px`, width: '1em', height: '1em', ...style }}
    />
  );
}
