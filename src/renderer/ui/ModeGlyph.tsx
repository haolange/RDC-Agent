import React from 'react';
import type { AgentMode, ModeIconKey } from '@shared/types/layout';
import { getAgentModeConfig } from '@shared/constants/agents';

interface ModeGlyphProps {
  mode: AgentMode;
  icon?: ModeIconKey;
  accentColor?: string;
  className?: string;
  size?: number;
  strokeWidth?: number;
}

const glyphByIcon = (
  icon: ModeIconKey,
): React.ReactNode => {
  switch (icon) {
    case 'message-orbit':
      return (
        <>
          <path d="M5 7.5c0-2 1.6-3.5 3.6-3.5h6.8C17.4 4 19 5.5 19 7.5v4.3c0 2-1.6 3.5-3.6 3.5h-3.2L8.4 19v-3.7h-.1C6.4 15.3 5 13.8 5 11.8z" />
          <path d="M9 9.5h6" />
          <path d="M9 12h3.8" />
          <path d="M18.2 3.2 19.4 2l1.2 1.2 1.2 1.2-1.2 1.2-1.2 1.2-1.2-1.2L17 4.4z" />
        </>
      );
    case 'route-plan':
      return (
        <>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M8 6h3.5a3.5 3.5 0 0 1 0 7H10a3.5 3.5 0 0 0 0 7h6" />
          <path d="M14 10l2 3-2 3" />
        </>
      );
    case 'pencil-edit':
      return (
        <>
          <path d="M4 20h4.5L19 9.5 14.5 5 4 15.5z" />
          <path d="M13.5 6 18 10.5" />
          <path d="M3.5 20.5h17" />
        </>
      );
    case 'crosshair-bug':
      return (
        <>
          <circle cx="12" cy="12" r="6.5" />
          <path d="M12 2v3" />
          <path d="M12 19v3" />
          <path d="M2 12h3" />
          <path d="M19 12h3" />
          <path d="M9.5 9.5h5v5h-5z" />
          <path d="M10 7.5h4" />
          <path d="M8.5 9.5 7 8" />
          <path d="M15.5 9.5 17 8" />
          <path d="M9.5 14.5 8 16" />
          <path d="M14.5 14.5 16 16" />
        </>
      );
    case 'waveform-gauge':
      return (
        <>
          <path d="M4 15.5h2.5l1.5-4 2.5 7 2.5-11 2.5 8 1.5-3H20" />
          <path d="M5.5 19a8.5 8.5 0 1 1 13 0" />
          <path d="M12 10.5l4-3" />
          <circle cx="12" cy="10.5" r="1.25" fill="currentColor" stroke="none" />
        </>
      );
    case 'spark-tuning':
      return (
        <>
          <path d="M8 5h11" />
          <path d="M5 12h14" />
          <path d="M8 19h11" />
          <circle cx="6" cy="5" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="6" cy="19" r="2" />
          <path d="M18.8 3.2 20 2l1.2 1.2L22.4 4.4l-1.2 1.2L20 6.8l-1.2-1.2-1.2-1.2z" />
        </>
      );
    case 'compass':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m15 9-2 5-5 2 2-5z" />
        </>
      );
    case 'terminal':
      return (
        <>
          <path d="m5 7 5 5-5 5" />
          <path d="M12 17h7" />
        </>
      );
    case 'shield':
      return (
        <>
          <path d="M12 3 5 6v5c0 4.5 2.8 7.7 7 10 4.2-2.3 7-5.5 7-10V6z" />
          <path d="m9 12 2 2 4-5" />
        </>
      );
    case 'wrench':
      return (
        <>
          <path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-3 3-3-3z" />
        </>
      );
    case 'search-lens':
      return (
        <>
          <circle cx="10.5" cy="10.5" r="5.5" />
          <path d="m15 15 5 5" />
          <path d="M8.5 10.5h4" />
        </>
      );
    case 'nodes':
      return (
        <>
          <circle cx="6" cy="7" r="2" />
          <circle cx="18" cy="7" r="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="M8 8.5 11 16" />
          <path d="m16 8.5-3 7.5" />
          <path d="M8 7h8" />
        </>
      );
    case 'memory':
      return (
        <>
          <rect x="5" y="6" width="14" height="12" rx="2" />
          <path d="M9 3v3M15 3v3M9 18v3M15 18v3M2 10h3M2 14h3M19 10h3M19 14h3" />
          <path d="M9 10h6v4H9z" />
        </>
      );
    case 'spark':
      return (
        <>
          <path d="M12 3 14 9l6 3-6 3-2 6-2-6-6-3 6-3z" />
          <path d="M19 4v4M17 6h4" />
        </>
      );
    default:
      return null;
  }
};

const FALLBACK_MODE_CONFIG = {
  icon: 'message-orbit' as const,
  accentColor: '#33d1ff',
};

export const ModeGlyph: React.FC<ModeGlyphProps> = ({
  mode,
  icon,
  accentColor,
  className,
  size = 16,
  strokeWidth = 2,
}) => {
  const modeConfig = getAgentModeConfig(mode) ?? FALLBACK_MODE_CONFIG;
  const resolvedIcon = icon ?? modeConfig.icon;
  const resolvedAccent = accentColor ?? modeConfig.accentColor;

  return (
    <span
      className={className}
      style={{
        color: resolvedAccent,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 0,
      }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {glyphByIcon(resolvedIcon)}
      </svg>
    </span>
  );
};

export default ModeGlyph;
