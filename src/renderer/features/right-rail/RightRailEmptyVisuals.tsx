import React from 'react';
import type { RightRailEmptyKind } from './RightRailEmptyState';
import './RightRailEmptyVisuals.css';

const ProgressVisual = () => (
  <>
    <path d="M49 19h75M49 36h75M49 53h75" />
    <circle cx="43" cy="19" r="4" />
    <circle cx="43" cy="36" r="4" />
    <circle cx="43" cy="53" r="4" />
    <path className="rr-wireframe-emphasis" d="m40 19 2 2 4-5" />
  </>
);

const ArtifactsVisual = () => (
  <>
    <rect x="54" y="13" width="53" height="46" rx="3" />
    <path d="M64 26h32M64 36h32M64 46h21M107 24h11v35H69" />
    <circle className="rr-wireframe-emphasis" cx="94" cy="46" r="2" />
  </>
);

const OutputsVisual = () => (
  <>
    <path d="M56 13h43l14 14v32H56zM99 13v14h14" />
    <path d="M68 36h31M68 45h23M68 53h16" />
    <path className="rr-wireframe-emphasis" d="M124 37v18m-6-6 6 6 6-6" />
  </>
);

const ContextVisual = () => (
  <>
    <path d="M59 24h48M59 48h48M58 26v20M108 26v20" />
    <rect x="43" y="16" width="17" height="17" rx="3" />
    <rect x="107" y="16" width="17" height="17" rx="3" />
    <rect x="43" y="40" width="17" height="17" rx="3" />
    <rect className="rr-wireframe-emphasis" x="107" y="40" width="17" height="17" rx="3" />
  </>
);

const CaptureVisual = () => (
  <>
    <rect x="43" y="14" width="81" height="43" rx="4" />
    <path d="M84 23v25M71 36h26M68 62h32" />
    <circle className="rr-wireframe-emphasis" cx="84" cy="36" r="8" />
  </>
);

const visuals: Record<RightRailEmptyKind, React.ReactNode> = {
  progress: <ProgressVisual />,
  artifacts: <ArtifactsVisual />,
  outputs: <OutputsVisual />,
  context: <ContextVisual />,
  capture: <CaptureVisual />,
};

export const RightRailEmptyVisual: React.FC<{ kind: RightRailEmptyKind }> = React.memo(({ kind }) => (
  <svg className="right-rail-empty-visual" viewBox="0 0 168 72" aria-hidden="true" focusable="false">
    {visuals[kind]}
  </svg>
));
RightRailEmptyVisual.displayName = 'RightRailEmptyVisual';
