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
  it('validates only at the Agent boundary and passes a receipt to Conversation', () => {
    const runner = readFileSync(path.join(repoRoot, 'src/main/agent-runtime/orchestration/AgentTurnRunner.ts'), 'utf8');
    const conversation = readFileSync(path.join(repoRoot, 'src/main/conversation/ConversationTurnRunner.ts'), 'utf8');
    expect(runner).toMatch(/validateCompletion/);
    expect(conversation).not.toMatch(/validateCompletion/);
    expect(conversation).toMatch(/completionReceipt/);
    expect(runner + conversation).not.toMatch(/import.*missionCompletionContract/);
    expect(readFileSync(path.join(repoRoot, 'src/main/agent-runtime/orchestration/AgentOrchestrator.ts'), 'utf8'))
      .toMatch(/validateCompletion: enforceMissionTurnCompletion/);
    for (const file of ['src/main/agent-runtime/orchestration/RuntimeToolAssembly.ts', 'src/main/conversation/ConversationService.ts']) {
      expect(readFileSync(path.join(repoRoot, file), 'utf8')).not.toMatch(/enforceMissionTurnCompletion/);
    }
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
        completionContract: 'investigation-report',
        investigationMission: mission,
        sessionId: SESSION_ID,
        finalAnswerText: 'hook text and output_register are not enough',
        service: missingReport.service,
      })).toThrow(MissionCompletionError);

      const missingCheckpoint = createInvestigationHarness();
      writeDraft(missingCheckpoint.service, 'world_state', baselineWorld(), { mission });
      expect(() => assertMissionTurnCompletion({
        profileId: mission,
        completionContract: 'investigation-report',
        investigationMission: mission,
        sessionId: SESSION_ID,
        finalAnswerText: 'final without checkpoint',
        service: missingCheckpoint.service,
      })).toThrow(/missing_checkpoint|missing_report|MISSION_COMPLETION_DENIED/);
    },
  );
});
