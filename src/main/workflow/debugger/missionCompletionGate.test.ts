import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertMissionTurnCompletion,
  enforceMissionTurnCompletion,
  MissionCompletionError,
} from '../../investigation/missionCompletionContract';
import {
  SESSION_ID,
  baselineWorld,
  createInvestigationHarness,
  sampleCheckpoint,
  writeDraft,
} from '../../investigation/investigationTestFixtures';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('Mission turn completion gate', () => {
  it('is wired on AgentTurnRunner and ConversationTurnRunner', () => {
    const runner = readFileSync(path.join(repoRoot, 'src/main/workflow/debugger/AgentTurnRunner.ts'), 'utf8');
    const conversation = readFileSync(path.join(repoRoot, 'src/main/conversation/ConversationTurnRunner.ts'), 'utf8');
    expect(runner).toMatch(/enforceMissionTurnCompletion/);
    expect(conversation).toMatch(/enforceMissionTurnCompletion/);
  });

  it('does not affect General', () => {
    expect(enforceMissionTurnCompletion({
      profileId: 'general',
      sessionId: SESSION_ID,
      finalAnswerText: 'ordinary work is done',
    })).toBeUndefined();
  });

  it.each(['debugger', 'analyzer', 'optimizer'] as const)(
    '%s cannot complete without a report or checkpoint',
    (mission) => {
      const missingReport = createInvestigationHarness();
      writeDraft(missingReport.service, 'world_state', baselineWorld(), { mission });
      writeDraft(missingReport.service, 'checkpoint', sampleCheckpoint({
        checkpointId: `cp-${mission}-gate`,
        currentWorldStateId: 'ws-baseline',
      }), { mission });
      expect(() => assertMissionTurnCompletion({
        profileId: mission,
        sessionId: SESSION_ID,
        finalAnswerText: 'hook text and output_register are not enough',
        service: missingReport.service,
      })).toThrow(MissionCompletionError);

      const missingCheckpoint = createInvestigationHarness();
      writeDraft(missingCheckpoint.service, 'world_state', baselineWorld(), { mission });
      expect(() => assertMissionTurnCompletion({
        profileId: mission,
        sessionId: SESSION_ID,
        finalAnswerText: 'final without checkpoint',
        service: missingCheckpoint.service,
      })).toThrow(/missing_checkpoint|missing_report|MISSION_COMPLETION_DENIED/);
    },
  );
});
