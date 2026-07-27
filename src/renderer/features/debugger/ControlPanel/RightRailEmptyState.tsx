import React from 'react';

export type RightRailEmptyKind = 'progress' | 'outputs' | 'context' | 'capture';

const EmptyVisual: React.FC<{ kind: RightRailEmptyKind }> = ({ kind }) => {
  if (kind === 'progress') {
    return (
      <svg className="right-rail-empty-visual progress-visual" viewBox="0 0 168 58" aria-hidden="true">
        <circle cx="25" cy="29" r="18" />
        <path d="m17 29 6 6 11-13" />
        <path d="M45 29h17" />
        <circle cx="83" cy="29" r="18" />
        <path d="m75 29 6 6 11-13" />
        <path d="M103 29h17" />
        <circle cx="141" cy="29" r="18" />
      </svg>
    );
  }
  if (kind === 'outputs') {
    return (
      <svg className="right-rail-empty-visual output-visual" viewBox="0 0 92 58" aria-hidden="true">
        <rect x="4" y="5" width="84" height="48" rx="8" />
        <path d="M27 40V28M43 40V21M59 40V14M20 43h47" />
      </svg>
    );
  }
  if (kind === 'context') {
    return (
      <svg className="right-rail-empty-visual context-visual" viewBox="0 0 196 56" aria-hidden="true">
        <rect x="4" y="26" width="58" height="25" rx="7" />
        <rect x="78" y="17" width="58" height="25" rx="7" />
        <rect x="152" y="8" width="40" height="25" rx="7" />
        <path d="M163 17h18M163 24h13" />
      </svg>
    );
  }
  return (
    <svg className="right-rail-empty-visual capture-visual" viewBox="0 0 112 58" aria-hidden="true">
      <rect x="5" y="8" width="72" height="42" rx="10" />
      <rect x="17" y="19" width="26" height="18" rx="4" />
      <path d="M53 20h13M53 27h13M17 43h49" />
      <circle cx="91" cy="29" r="10" />
      <path d="m88 24 8 5-8 5z" />
    </svg>
  );
};

export const RightRailEmptyState: React.FC<{ kind: RightRailEmptyKind; copy: string }> = ({ kind, copy }) => (
  <div className={`right-rail-empty-state kind-${kind}`}>
    <EmptyVisual kind={kind} />
    <p>{copy}</p>
  </div>
);

export default RightRailEmptyState;
