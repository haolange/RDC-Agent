import { describe, expect, it } from 'vitest';
import type { AgentMessage, AssistantMessage } from '../core/types';
import {
  assembleDerivedContextView,
  computeContextSourceHash,
  createStructuredHandoffMessage,
  parseModelHandoffSections,
  serializeHandoffSourceTranscript,
  type ModelHandoffSections,
} from './StructuredHandoffBuilder';

const testHandoffSections = (objective: string, extras: Partial<ModelHandoffSections> = {}): ModelHandoffSections => ({
  objective,
  constraints: extras.constraints ?? [],
  progress: extras.progress ?? { done: [], inProgress: [], blocked: [] },
  decisions: extras.decisions ?? [],
  failedAttempts: extras.failedAttempts ?? [],
  nextSteps: extras.nextSteps ?? [],
  criticalContext: extras.criticalContext ?? [objective],
});

const assistant = (): AssistantMessage => ({
  role: 'assistant',
  content: [
    {
      type: 'thinking',
      text: 'private chain detail',
      kind: 'opaque',
      source: 'openai-responses-encrypted',
      visibility: 'hidden',
    },
    { type: 'text', text: 'Decision: inspect D:\\Captures\\scene.rdc next.' },
    { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { apiKey: 'tool-secret' } },
  ],
  model: 'model',
  provider: 'provider',
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  stopReason: 'toolUse',
  timestamp: 2,
});

describe('StructuredHandoffBuilder', () => {
  it('serializes a redacted transcript without reasoning artifacts', () => {
    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: 'Goal: inspect the capture. Must not leak api_key="secret-value" or Authorization: Bearer bearer-secret. TODO: verify output.',
        timestamp: 1,
      },
      assistant(),
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read_file',
        content: [{ type: 'text', text: 'See https://example.test/result?access_token=url-secret and D:\\Captures\\scene.rdc' }],
        isError: false,
        timestamp: 3,
      },
    ];
    const transcript = serializeHandoffSourceTranscript(messages);
    expect(transcript).not.toContain('secret-value');
    expect(transcript).not.toContain('bearer-secret');
    expect(transcript).not.toContain('url-secret');
    expect(transcript).not.toContain('private chain detail');
    expect(transcript).toContain('REDACTED');
    expect(transcript).toContain('read_file');
    expect(transcript).not.toContain('tool-secret');
    expect(transcript).toContain('message:0 timestamp:1');
    expect(transcript).toContain('call-1');
  });

  it('preserves tool-only invocation parameters and separately identifies later user revisions', () => {
    const invocation = { ...assistant(), content: [{ type: 'toolCall' as const, id: 'measure-call', name: 'measure', arguments: { samples: 7, units: 'ms', variant: 'baseline' } }] };
    const serialized = serializeHandoffSourceTranscript([invocation, { role: 'user', content: 'Later correction: do not rename the blue label.', timestamp: 9 }]);
    expect(serialized).toContain('"samples":7'); expect(serialized).toContain('"variant":"baseline"');
    expect(serialized).toContain('message:1 timestamp:9'); expect(serialized).toContain('Later correction');
  });

  it('parses model-generated sections and assembles a typed view', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'Inspect the capture.', timestamp: 1 },
      assistant(),
    ];
    const sections = parseModelHandoffSections([
      '## Goal',
      'Inspect the capture.',
      '## Constraints',
      '- Must not leak secrets',
      '## Progress',
      '### Done',
      '- Opened the file',
      '### In Progress',
      '- Reading events',
      '### Blocked',
      '- Need replay device',
      '## Key Decisions',
      '- Use the latest capture',
      '## Errors and Failed Attempts',
      '- First read failed',
      '## Next Steps',
      '- Verify output',
      '## Critical Context',
      '- See D:\\Captures\\scene.rdc',
    ].join('\n'));
    const view = assembleDerivedContextView(messages, {
      scope: 'session',
      sessionId: 'session-1',
      branchId: 'branch-1',
      sourceTurnIds: ['turn-1'],
      retainedTurnIds: ['turn-2'],
      createdAt: 10,


      sections,
    });
    expect(view.handoff.derivation).toBe('model-generated');
    expect(view.handoff.objective).toContain('Inspect the capture');
    expect(view.handoff.progress?.blocked[0]?.text).toContain('replay device');
    expect(view.handoff.failedAttempts?.[0]?.text).toContain('First read failed');
    expect(view.sourceHash).toBe(computeContextSourceHash(messages, ['turn-1']));
    expect(JSON.stringify(view.handoff)).not.toContain('tool-secret');
    expect(JSON.stringify(view.handoff)).not.toContain('private chain detail');
    expect(view.handoff.resourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool-call', value: 'read_file' }),
      expect.objectContaining({ kind: 'path', value: expect.stringContaining('scene.rdc') }),
    ]));
    const message = createStructuredHandoffMessage(view);
    expect(message.content).toContain('[Derived context; not a user request]');
    expect(message.derivedContext).toEqual({
      viewId: view.viewId,
      handoffId: view.handoff.handoffId,
      sourceHash: view.sourceHash,
    });
  });

  it('preserves generated facts without dropping them to fit a projection', () => {
    const view = assembleDerivedContextView(
      [{ role: 'user', content: 'Objective only', timestamp: 1 }],
      {
        scope: 'ephemeral',
        createdAt: 1,


        sections: testHandoffSections('Objective only'),
      },
    );
    expect(view.handoff.decisions).toEqual([]);
    expect(view.handoff.constraints).toEqual([]);
    expect(view.handoff.facts).toEqual([{ text: 'Objective only', source: 'assistant' }]);
    expect(view.handoff.openWork).toEqual([]);
    expect(view.handoff.resourceRefs).toEqual([]);
  });
});
