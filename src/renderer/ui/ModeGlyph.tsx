import React from 'react';
import type { AgentMode, ModeIconKey } from '@shared/types/layout';
import { getAgentModeConfig } from '@shared/constants/agents';

interface ModeGlyphProps {
  mode: AgentMode;
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
    default:
      return null;
  }
};

export const ModeGlyph: React.FC<ModeGlyphProps> = ({
  mode,
  className,
  size = 16,
  strokeWidth = 1.85,
}) => {
  const modeConfig = getAgentModeConfig(mode);

  return (
    <span
      className={className}
      style={{ color: modeConfig.accentColor }}
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
        {glyphByIcon(modeConfig.icon)}
      </svg>
    </span>
  );
};

export default ModeGlyph;
