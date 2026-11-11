import { describe, expect, it } from 'vitest';
import { reviewEvidenceClosure } from './reviewEvidenceClosure';
import type { InvestigationArtifactService } from './InvestigationArtifactService';

const uri = (name: string) => `session://investigation/${name}.json`;
function service(records: Array<{ name: string; kind: string; status?: string; record: unknown }>): InvestigationArtifactService {
  return { readAllRecords: () => records.map(item => ({ contentUri: uri(item.name), contentHash: 'h',
    manifest: { kind: item.kind, status: item.status ?? 'ready' }, record: item.record })) } as never;
}
const claim = (claimId: string, extra: Record<string, unknown> = {}) => ({ claimId, worldStateId: 'ws-obs', experimentId: null, compactProvenance: null, ...extra });

describe('review evidence closure', () => {
  const records = [
    { name: 'claim-cause', kind: 'claim', record: claim('cause', { experimentId: 'exp-1' }) },
    { name: 'claim-anchor', kind: 'claim', record: claim('anchor') },
    { name: 'ev-anchor', kind: 'evidence', record: { evidenceId: 'ev-anchor', worldStateId: 'ws-obs', claimIds: ['anchor'],
      artifactRefs: [{ uri: 'session://tool-outputs/history.json', expectedHash: 'a' }] } },
    { name: 'ev-verify', kind: 'evidence', record: { evidenceId: 'ev-verify', worldStateId: 'ws-restored', claimIds: [],
      artifactRefs: [{ uri: 'session://tool-outputs/restored.png', expectedHash: 'b' }] } },
    { name: 'ev-stale', kind: 'evidence', status: 'superseded', record: { evidenceId: 'ev-stale', worldStateId: 'ws-obs', claimIds: ['cause'],
      artifactRefs: [{ uri: 'session://tool-outputs/old.json', expectedHash: 'c' }] } },
    { name: 'ws-obs', kind: 'world_state', record: { worldStateId: 'ws-obs' } },
    { name: 'ws-restored', kind: 'world_state', record: { worldStateId: 'ws-restored' } },
    { name: 'exp-1', kind: 'experiment', record: { experimentId: 'exp-1', hypothesisClaimId: 'anchor',
      baselineWorldStateId: 'ws-obs', variantWorldStateId: 'ws-missing', restoredWorldStateId: 'ws-restored',
      executionEvidence: { baseline: { uri: 'session://tool-outputs/r-baseline.json', expectedHash: 'd' },
        variant: { uri: 'session://tool-outputs/r-variant.json', expectedHash: 'e' } },
      rollback: { verifyEvidenceIds: ['ev-verify'] } } },
    { name: 'ch-1', kind: 'challenge', record: { challengeId: 'ch-1', targetRef: { type: 'experiment', id: 'exp-1' } } },
  ];

  it('follows granted records to the active records and raw artifacts they depend on', () => {
    const closure = reviewEvidenceClosure(service(records), 'owner', [uri('ch-1')]);
    expect(new Set(closure.refs)).toEqual(new Set([uri('ch-1'), uri('exp-1'), uri('claim-anchor'), uri('ev-anchor'),
      uri('ws-obs'), uri('ws-restored'), 'session://tool-outputs/r-baseline.json', 'session://tool-outputs/r-variant.json',
      uri('ev-verify'), 'session://tool-outputs/history.json', 'session://tool-outputs/restored.png']));
    expect(closure.refs[0]).toBe(uri('ch-1'));
    expect(closure.omitted).toEqual([]);
    expect(closure.refs).not.toContain('session://tool-outputs/old.json');
  });

  it('reports dependencies a nested parent cannot grant instead of granting them', () => {
    const closure = reviewEvidenceClosure(service(records), 'owner', [uri('claim-anchor')], ref => !ref.endsWith('history.json'));
    expect(closure.refs).toEqual([uri('claim-anchor'), uri('ws-obs'), uri('ev-anchor')]);
    expect(closure.omitted).toEqual([{ uri: 'session://tool-outputs/history.json', reason: 'outside-parent-grant' }]);
  });
});
