import { describe, expect, it } from 'vitest';
import type { ConversationMessage, ConversationWorkBlock } from '@shared/types/conversation';
import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import { agentProfileRegistry } from './manifests/AgentProfileRegistry';
import { findCanonicalFinalAnswer, resolveHistoryTurnProfileId } from './TraceService';

function block(id: string, text: string, outputPhase: 'commentary' | 'final_answer'): ConversationWorkBlock {
  return {
    id,
    kind: 'llm_turn',
    title: 'LLM turn',
    status: 'complete',
    result: {
      text,
      status: 'complete',
      stopReason: 'end_turn',
      outputPhase,
      toolCallIds: [],
    },
    toolCalls: [],
    startedAt: 1,
    completedAt: 2,
  };
}

function assistant(content: string, blocks: ConversationWorkBlock[]): ConversationMessage {
  return {
    id: 'assistant-1',
    turnId: 'turn-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    runId: 'run-1',
    role: 'assistant',
    content,
    workTrace: { status: 'complete', blocks, updatedAt: 2 },
    createdAt: 1,
  };
}

describe('TraceService canonical channel reload', () => {
  it('does not rebuild final_response from untyped assistant text', () => {
    expect(findCanonicalFinalAnswer([assistant('legacy copied text', [])], 'run-1')).toBeNull();
  });

  it('reads only the explicit final_answer block after commentary and tools', () => {
    const commentary = block('loop-1', 'Working update', 'commentary');
    commentary.toolCalls.push({ id: 'tool-1', toolName: 'read_file', status: 'complete', startedAt: 1 });
    const final = block('loop-2', 'Canonical final', 'final_answer');
    expect(findCanonicalFinalAnswer([
      assistant('Canonical final', [commentary, final]),
    ], 'run-1')).toBe('Canonical final');
  });

  it('does not use text comparison when explicit commentary and final bytes match', () => {
    expect(findCanonicalFinalAnswer([
      assistant('Same bytes', [
        block('loop-1', 'Same bytes', 'commentary'),
        block('loop-2', 'Same bytes', 'final_answer'),
      ]),
    ], 'run-1')).toBe('Same bytes');
  });
});

describe('TraceService history-turn profile projection', () => {
  it('projects a no-runId general turn with its own profileId, not ask or debugger', () => {
    const profileId = resolveHistoryTurnProfileId({
      assistantMessages: [{ profileId: 'general', agentId: 'general' }],
    });
    const profile = agentProfileRegistry.get(profileId);
    expect(profileId).toBe('general');
    expect(profile.agentType).toBe('general');
    expect(profile.displayName).toBe('General');
    expect(profile.agentType).not.toBe('ask');
  });

  it('projects a no-runId custom-readonly turn with its own profileId, not debugger', () => {
    const profileId = resolveHistoryTurnProfileId({
      userMessage: { profileId: 'custom-readonly' },
      assistantMessages: [{ agentId: 'custom-readonly' }],
    });
    const profile = agentProfileRegistry.get(profileId);
    expect(profileId).toBe('custom-readonly');
    expect(profile.agentType).toBe('custom-readonly');
    expect(profile.displayName).toBe('custom-readonly');
    expect(profile.agentType).not.toBe('debugger');
    expect(profile.displayName).not.toBe('Debugger');
  });

  it('uses DEFAULT_AGENT_ID=general when a history turn has no profileId', () => {
    const profileId = resolveHistoryTurnProfileId({ assistantMessages: [{}] });
    const profile = agentProfileRegistry.get(profileId);
    expect(profileId).toBe(DEFAULT_AGENT_ID);
    expect(profile.agentType).toBe('general');
    expect(profile.agentType).not.toBe('ask');
    expect(profile.agentType).not.toBe('debugger');
  });
});