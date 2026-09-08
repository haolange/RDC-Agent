import React from 'react';
import { EmptyState } from '../../ui/EmptyState';
import { RightRailEmptyVisual } from './RightRailEmptyVisuals';

export type RightRailEmptyKind = 'progress' | 'artifacts' | 'outputs' | 'context' | 'capture';

export const RightRailEmptyState: React.FC<{ kind: RightRailEmptyKind; copy: string }> = ({ kind, copy }) => (
  <EmptyState
    className={`right-rail-empty-state kind-${kind}`}
    visual={<RightRailEmptyVisual kind={kind} />}
    title={copy}
  />
);

export default RightRailEmptyState;
