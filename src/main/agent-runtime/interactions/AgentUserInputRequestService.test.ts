import { describe, expect, it } from 'vitest';
import type { AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import type { ConversationAskUserQuestion } from '@shared/types/conversation';
import { agentUserInputRequestService } from './AgentUserInputRequestService';

const eventContext = {
  runId: 'run-ask-user-test',
  turnId: 'turn-ask-user-test',
  sessionId: 'session-ask-user-test',
  agentId: 'debugger' as const,
};

const questions: ConversationAskUserQuestion[] = [
  {
    questionId: 'direction',
    prompt: 'Where should I start?',
    description: 'Choose the first path.',
    options: [
      { optionId: 'repo', label: 'Repo structure', description: 'Inspect files first.' },
      { optionId: 'logs', label: 'Session logs' },
    ],
    allowFreeform: true,
  },
  {
    questionId: 'keyword',
    prompt: 'What keyword should summarize the repo?',
    options: [],
    allowFreeform: true,
  },
];

describe('AgentUserInputRequestService', () => {
  it('resolves a batch request with structured answers and numbered Q/A text', async () => {
    const events: SharedAgentEvent[] = [];
    const turnId = 'turn-ask-user-batch';
    const requestPromise = agentUserInputRequestService.request({
      agentId: 'debugger',
      sessionId: 'session-ask-user',
      turnId,
      toolCallId: 'tool-ask-user-batch',
      questions,
      context: eventContext,
      onEvent: (event) => events.push(event),
    });

    expect(events[0]?.payload).toMatchObject({
      status: 'pending',
      kind: 'ask_user',
      questions: [{ questionId: 'direction' }, { questionId: 'keyword' }],
    });

    const result = agentUserInputRequestService.answer({
      sessionId: 'session-ask-user',
      turnId,
      toolCallId: 'tool-ask-user-batch',
      answers: [
        { questionId: 'direction', answer: 'Repo structure', selectedOptionId: 'repo' },
        { questionId: 'keyword', answer: '  graphics\npipeline  ' },
      ],
    });

    expect(result).toEqual({ success: true });
    await expect(requestPromise).resolves.toBe(
      'Q1: Where should I start?\nA1: Repo structure\n\nQ2: What keyword should summarize the repo?\nA2: graphics\npipeline',
    );
    expect(events[1]?.payload).toMatchObject({
      status: 'approved',
      kind: 'ask_user',
      answers: [
        { questionId: 'direction', answer: 'Repo structure', selectedOptionId: 'repo' },
        { questionId: 'keyword', answer: 'graphics\npipeline' },
      ],
    });
  });

  it('rejects incomplete answers and keeps the pending request live', async () => {
    const turnId = 'turn-ask-user-incomplete';
    const requestPromise = agentUserInputRequestService.request({
      agentId: 'debugger',
      sessionId: 'session-ask-user',
      turnId,
      toolCallId: 'tool-ask-user-incomplete',
      questions,
      context: eventContext,
    });

    expect(agentUserInputRequestService.answer({
      sessionId: 'session-ask-user',
      turnId,
      toolCallId: 'tool-ask-user-incomplete',
      answers: [{ questionId: 'direction', answer: 'Repo structure', selectedOptionId: 'repo' }],
    })).toMatchObject({ success: false });

    expect(agentUserInputRequestService.answer({
      sessionId: 'other-session',
      turnId,
      toolCallId: 'tool-ask-user-incomplete',
      answers: [
        { questionId: 'direction', answer: 'Repo structure', selectedOptionId: 'repo' },
        { questionId: 'keyword', answer: 'graphics' },
      ],
    })).toMatchObject({ success: false });

    expect(agentUserInputRequestService.answer({
      sessionId: 'session-ask-user',
      turnId,
      toolCallId: 'tool-ask-user-incomplete',
      answers: [
        { questionId: 'direction', answer: 'Repo structure', selectedOptionId: 'repo' },
        { questionId: 'keyword', answer: 'graphics' },
      ],
    })).toEqual({ success: true });
    await expect(requestPromise).resolves.toContain('Q2: What keyword should summarize the repo?');
  });
});
