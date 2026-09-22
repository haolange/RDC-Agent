import React from 'react';
import type { WorkProcessRowStatus } from './workProcessTypes';

export type WorkProcessRailVariant = 'section' | 'step';

interface WorkProcessRailIconProps {
  variant: WorkProcessRailVariant;
  status: WorkProcessRowStatus;
  className?: string;
}

export const WorkProcessRailIcon: React.FC<WorkProcessRailIconProps> = ({
  variant,
  status,
  className = '',
}) => {
  const rootClass = [
    'work-process-step-rail',
    `is-${variant}`,
    `status-${status}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={rootClass} aria-hidden="true">
      <span className="work-process-rail-marker" />
    </span>
  );
};
