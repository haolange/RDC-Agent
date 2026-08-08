import React from 'react';
import { RightRailEmptyVisual } from './RightRailEmptyVisuals';

export type RightRailEmptyKind = 'progress' | 'outputs' | 'context' | 'capture';

export const RightRailEmptyState: React.FC<{ kind: RightRailEmptyKind; copy: string }> = ({ kind, copy }) => (
  <div className={`right-rail-empty-state kind-${kind}`}>
    <RightRailEmptyVisual kind={kind} />
    <p>{copy}</p>
  </div>
);

export default RightRailEmptyState;
