import React from 'react';
import type { InvestigationArtifactKind } from '@shared/types/renderdocInvestigation';

const Svg: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
);

const WorldStateGlyph: React.FC = () => (
  <Svg>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M4.5 12h15M12 4.5c2.4 2.2 3.6 4.7 3.6 7.5S14.4 17.3 12 19.5C9.6 17.3 8.4 14.8 8.4 12S9.6 6.7 12 4.5Z" />
  </Svg>
);

const EvidenceGlyph: React.FC = () => (
  <Svg>
    <rect x="5" y="4.5" width="14" height="15" rx="2" />
    <path d="M8 9h8M8 12.5h8M8 16h5" />
  </Svg>
);

const ClaimGlyph: React.FC = () => (
  <Svg>
    <path d="M6 6.5h12v8.5H10L6 19z" />
    <path d="M9 10h6M9 13h4" />
  </Svg>
);

const ExperimentGlyph: React.FC = () => (
  <Svg>
    <path d="M9 4.5h6M10.5 4.5v5.2L6.8 18.2A2 2 0 0 0 8.6 21h6.8a2 2 0 0 0 1.8-2.8L13.5 9.7V4.5" />
    <path d="M8.2 15.5h7.6" />
  </Svg>
);

const ChallengeGlyph: React.FC = () => (
  <Svg>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 8.2v4.1M12 16.2h.01" />
  </Svg>
);

const CheckpointGlyph: React.FC = () => (
  <Svg>
    <path d="M12 4.5 18.5 8v8L12 19.5 5.5 16V8Z" />
    <path d="m9.2 12 1.9 1.9 3.7-3.8" />
  </Svg>
);

const ReportGlyph: React.FC = () => (
  <Svg>
    <path d="M7 4.5h7l4 4V19.5H7z" />
    <path d="M14 4.5v4h4M9.5 12h5M9.5 15h3.5" />
  </Svg>
);

const GLYPHS: Record<InvestigationArtifactKind, React.FC> = {
  world_state: WorldStateGlyph,
  evidence: EvidenceGlyph,
  evidence_pack: EvidenceGlyph,
  claim: ClaimGlyph,
  claim_set: ClaimGlyph,
  experiment: ExperimentGlyph,
  challenge: ChallengeGlyph,
  checkpoint: CheckpointGlyph,
  report: ReportGlyph,
};

export const RightRailArtifactGlyph: React.FC<{ kind: InvestigationArtifactKind }> = ({ kind }) => {
  const Glyph = GLYPHS[kind] ?? ReportGlyph;
  return <Glyph />;
};
