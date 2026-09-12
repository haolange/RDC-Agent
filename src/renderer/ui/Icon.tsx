import { cn } from '../lib/cn';
import './Icon.css';

export type IconSize = 12 | 14 | 16 | 18 | 20 | 24;

export type IconName =
  | 'close'
  | 'search'
  | 'check'
  | 'plus'
  | 'minus'
  | 'warning'
  | 'error'
  | 'info'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'chevron-right'
  | 'more'
  | 'nav-general'
  | 'nav-appearance'
  | 'nav-workspace'
  | 'nav-models'
  | 'nav-skills'
  | 'nav-agents'
  | 'nav-tools'
  | 'nav-hooks'
  | 'nav-policy'
  | 'book'
  | 'inbox'
  | 'conflict'
  | 'folder'
  | 'refresh'
  | 'upload'
  | 'filter'
  | 'shield'
  | 'lock'
  | 'copy'
  | 'external'
  | 'play'
  | 'edit'
  | 'trash'
  | 'terminal'
  | 'cube'
  | 'code'
  | 'arrow-up'
  | 'arrow-down'
  | 'link'
  | 'user'
  | 'lightning';

type IconPart =
  | { d: string }
  | { c: readonly [number, number, number] }
  | { r: readonly [number, number, number, number, number?] };

const ICONS: Record<IconName, readonly IconPart[]> = {
  close: [{ d: 'M6 6l12 12M18 6 6 18' }],
  search: [{ d: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm6.5-1 4 4' }],
  check: [{ d: 'M5 12.5 9.5 17 19 7' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  minus: [{ d: 'M5 12h14' }],
  warning: [{ d: 'M12 4 3 20h18L12 4Zm0 6v5M12 17.5h.01' }],
  error: [{ c: [12, 12, 8] }, { d: 'M12 8v5M12 16.5h.01' }],
  info: [{ c: [12, 12, 8] }, { d: 'M12 11v5M12 8h.01' }],
  'chevron-down': [{ d: 'M6 9l6 6 6-6' }],
  'chevron-up': [{ d: 'M6 15l6-6 6 6' }],
  'chevron-left': [{ d: 'M15 6l-6 6 6 6' }],
  'chevron-right': [{ d: 'M9 6l6 6-6 6' }],
  more: [{ c: [6, 12, 1.2] }, { c: [12, 12, 1.2] }, { c: [18, 12, 1.2] }],
  'nav-general': [
    { d: 'M5 7h14' },
    { d: 'M5 12h14' },
    { d: 'M5 17h14' },
    { c: [9, 7, 1.5] },
    { c: [15, 12, 1.5] },
    { c: [11, 17, 1.5] },
  ],
  'nav-appearance': [
    { c: [12, 12, 4] },
    { d: 'M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8' },
  ],
  'nav-workspace': [{ d: 'M4 7h6l1.7 2H20v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z' }, { d: 'M4 9.5h16' }],
  'nav-models': [{ r: [5, 5, 14, 14, 2.5] }, { d: 'M8.5 9h7M8.5 12h7M8.5 15h4' }],
  'nav-skills': [
    { d: 'M5 5.5h10.5a2.5 2.5 0 0 1 2.5 2.5v10.5H7.5A2.5 2.5 0 0 1 5 16z' },
    { d: 'M8.5 9h6M8.5 12h5' },
    { d: 'M18 8h1.5M18.75 7.25v1.5' },
  ],
  'nav-agents': [
    { c: [12, 8, 3] },
    { d: 'M6.5 19a5.5 5.5 0 0 1 11 0' },
    { d: 'M18 5.5h2.5M19.25 4.25v2.5' },
    { d: 'M4.5 5.5h3' },
  ],
  'nav-tools': [
    { d: 'M14.5 5.5 18 2.5l3.5 3.5-3 3.5' },
    { d: 'M13.5 7 5 15.5 4 20l4.5-1 8.5-8.5' },
    { d: 'M14.5 5.5l4 4' },
  ],
  'nav-hooks': [{ d: 'M8 4v6a4 4 0 0 0 8 0V4' }, { d: 'M6 4h4M14 4h4M12 14v6' }, { d: 'M9 20h6' }],
  'nav-policy': [
    { d: 'M12 3 5.5 6v5.5c0 4.2 2.7 7.9 6.5 9.5 3.8-1.6 6.5-5.3 6.5-9.5V6z' },
    { d: 'M9.5 12.2 11.2 14l3.5-3.8' },
  ],
  book: [{ d: 'M4 5h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4V5Zm9 3a3 3 0 0 1 3-3h5v13h-5a3 3 0 0 0-3 3' }],
  inbox: [{ d: 'M4 4h16v16H4V4Zm0 10h5l2 3h2l2-3h5' }],
  conflict: [{ d: 'M7 3v14m-3-3 3 3 3-3M17 21V7m-3 3 3-3 3 3' }],
  folder: [{ d: 'M3 7V5h6l2 2h10v13H3V7Z' }],
  refresh: [{ d: 'M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 19.5 10M4.5 14a8 8 0 0 0 13.4 3.9' }],
  upload: [{ d: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6' }],
  filter: [{ d: 'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6' }],
  shield: [
    { d: 'M12 3 5.5 6v5.5c0 4.2 2.7 7.9 6.5 9.5 3.8-1.6 6.5-5.3 6.5-9.5V6z' },
  ],
  lock: [{ r: [5, 11, 14, 9, 2] }, { d: 'M8 11V8a4 4 0 0 1 8 0v3' }],
  copy: [{ r: [9, 9, 11, 11, 2] }, { d: 'M5 15V6a2 2 0 0 1 2-2h9' }],
  external: [{ d: 'M14 4h6v6M20 4l-9 9' }, { d: 'M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6' }],
  play: [{ d: 'M7 4.5v15l12-7.5-12-7.5Z' }],
  edit: [{ d: 'M4 20h4l11-11-4-4L4 16v4Z' }, { d: 'M13.5 6.5l4 4' }],
  trash: [{ d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13' }, { d: 'M10 11v6M14 11v6' }],
  terminal: [{ r: [3, 5, 18, 14, 2] }, { d: 'M7 9l3 3-3 3M12 15h5' }],
  cube: [{ d: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z' }, { d: 'M4 7.5 12 12l8-4.5M12 12v9' }],
  code: [{ d: 'M8 8 4 12l4 4M16 8l4 4-4 4M14 5l-4 14' }],
  'arrow-up': [{ d: 'M12 19V5M6 11l6-6 6 6' }],
  'arrow-down': [{ d: 'M12 5v14M6 13l6 6 6-6' }],
  link: [{ d: 'M10 14 14 10' }, { d: 'M8.5 15.5 7 17a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0' }, { d: 'M15.5 8.5 17 7a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0' }],
  user: [{ c: [12, 8, 3.5] }, { d: 'M5 20a7 7 0 0 1 14 0' }],
  lightning: [{ d: 'M13 2 5 14h6l-1 8 8-12h-6l1-8Z' }],
};

export interface IconProps {
  name: IconName;
  size?: IconSize;
  className?: string;
  title?: string;
}

export function Icon({ name, size = 16, className, title }: IconProps) {
  return (
    <svg
      className={cn('ui-icon', `is-size-${size}`, className)}
      viewBox="0 0 24 24"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {ICONS[name].map((part, index) => {
        if ('d' in part) {
          return <path key={index} d={part.d} />;
        }
        if ('c' in part) {
          const [cx, cy, r] = part.c;
          return <circle key={index} cx={cx} cy={cy} r={r} />;
        }
        const [x, y, width, height, rx] = part.r;
        return <rect key={index} x={x} y={y} width={width} height={height} rx={rx} />;
      })}
    </svg>
  );
}
