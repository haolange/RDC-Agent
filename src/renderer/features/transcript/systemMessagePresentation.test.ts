import { describe, expect, it } from 'vitest';
import type { ConversationMessage, ConversationWorkTrace } from '@shared/types/conversation';
import { resolveCommandLabel, resolveSystemNoticeTone } from './systemMessagePresentation';

const baseMessage = (): ConversationMessage => ({
  id: 'msg-1',
  turnId: 'turn-1',
  sessionId: 'sess-1',
  projectId: 'proj-1',
  role: 'system',
  content: 'hello',
  createdAt: 1,
});

const commandTrace = (title: string): ConversationWorkTrace => ({
  status: 'complete',
  blocks: [
    {
      id: 'cmd-1',
      kind: 'command',
      title,
      status: 'complete',
      toolCalls: [],
      startedAt: 1,
      completedAt: 1,
    },
  ],
  updatedAt: 1,
});

describe('resolveSystemNoticeTone', () => {
  it('uses diagnostic.severity when present', () => {
    expect(resolveSystemNoticeTone({
      ...baseMessage(),
      status: 'complete',
      diagnostic: {
        code: 'MODEL_CONTINUATION_DROPPED',
        severity: 'warning',
        userMessage: 'switched',
      },
    })).toBe('warning');
    expect(resolveSystemNoticeTone({
      ...baseMessage(),
      status: 'complete',
      diagnostic: {
        code: 'CONVERSATION_LLM_REQUEST_FAILED',
        severity: 'error',
        userMessage: 'failed',
      },
    })).toBe('error');
  });

  it('maps status error without a diagnostic to error', () => {
    expect(resolveSystemNoticeTone({ ...baseMessage(), status: 'error' })).toBe('error');
  });

  it('treats complete and missing status as neutral', () => {
    expect(resolveSystemNoticeTone({ ...baseMessage(), status: 'complete' })).toBe('neutral');
    expect(resolveSystemNoticeTone(baseMessage())).toBe('neutral');
  });
});

describe('resolveCommandLabel', () => {
  it('reads the command work-trace title', () => {
    expect(resolveCommandLabel({
      ...baseMessage(),
      workTrace: commandTrace('/help'),
    })).toBe('/help');
  });

  it('returns null when there is no command block or the title is blank', () => {
    expect(resolveCommandLabel(baseMessage())).toBeNull();
    expect(resolveCommandLabel({
      ...baseMessage(),
      workTrace: commandTrace('   '),
    })).toBeNull();
  });
});
