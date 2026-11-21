import { Icon, type IconName } from '../../ui/Icon';
import type { InvestigationArtifactKind } from '@shared/types/renderdocInvestigation';

const ARTIFACT_ICONS: Record<InvestigationArtifactKind, IconName> = {
  world_state: 'artifact-world-state',
  evidence: 'artifact-evidence',
  evidence_pack: 'artifact-evidence',
  claim: 'artifact-claim',
  claim_set: 'artifact-claim',
  experiment: 'artifact-experiment',
  challenge: 'artifact-challenge',
  checkpoint: 'artifact-checkpoint',
  report: 'artifact-report',
};

export function RightRailArtifactGlyph({ kind }: { kind: InvestigationArtifactKind }) {
  return <Icon name={ARTIFACT_ICONS[kind]} />;
}
