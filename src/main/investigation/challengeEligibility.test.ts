import { describe, expect, it } from 'vitest';
import {
  SESSION_ID,
  baselineWorld,
  createInvestigationHarness,
  hypothesisClaim,
  sampleChallenge,
  writeDraft,
} from '../testing/investigationTestFixtures';
import { openChallengesForCitedRecords } from './challengeEligibility';

describe('openChallengesForCitedRecords', () => {
  it('finds open Challenges against the records a result cites, and none elsewhere', () => {
    const { service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld('ws-baseline'));
    const cited = writeDraft(service, 'claim', hypothesisClaim('ws-baseline', 'claim-cited'));
    const other = writeDraft(service, 'claim', hypothesisClaim('ws-baseline', 'claim-other'));
    writeDraft(
      service,
      'challenge',
      sampleChallenge({ challengeId: 'cited-challenge', targetId: (cited.record as { claimId: string }).claimId }),
    );
    writeDraft(
      service,
      'challenge',
      sampleChallenge({ challengeId: 'other-challenge', targetId: (other.record as { claimId: string }).claimId }),
    );

    expect(
      openChallengesForCitedRecords(service, SESSION_ID, [cited.contentUri, 'session://outputs/receipt.json']),
    ).toEqual([{ challengeId: 'cited-challenge', followUp: expect.any(String) }]);
    expect(openChallengesForCitedRecords(service, SESSION_ID, ['session://outputs/receipt.json'])).toEqual([]);
  });
});
