import { cn } from '../lib/cn';
import { COMMON_ICONS } from './icons/commonIcons';
import { INVESTIGATION_ICONS } from './icons/investigationIcons';
import { KNOWLEDGE_ICONS } from './icons/knowledgeIcons';
import { SHELL_ICONS } from './icons/shellIcons';
import { TRANSCRIPT_ICONS } from './icons/transcriptIcons';
import type { IconPart } from './icons/iconParts';
import './Icon.css';

export type IconSize = 12 | 14 | 16 | 18 | 20 | 24;

/** The single icon registry: every glyph in the app is a 24 × 24 stroke drawing from one of these domain tables. */
export const ICON_REGISTRY = {
  ...COMMON_ICONS,
  ...SHELL_ICONS,
  ...TRANSCRIPT_ICONS,
  ...KNOWLEDGE_ICONS,
  ...INVESTIGATION_ICONS,
} satisfies Record<string, readonly IconPart[]>;

export type IconName = keyof typeof ICON_REGISTRY;

export interface IconProps {
  name: IconName;
  size?: IconSize;
  className?: string;
  title?: string;
  /** Solid glyphs (the stop square, status dots) fill their shapes instead of stroking them. */
  filled?: boolean;
}

export function Icon({ name, size = 16, className, title, filled }: IconProps) {
  const parts: readonly IconPart[] = ICON_REGISTRY[name];
  return (
    <svg
      className={cn('ui-icon', `is-size-${size}`, filled && 'is-filled', className)}
      viewBox="0 0 24 24"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {parts.map((part, index) => {
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
