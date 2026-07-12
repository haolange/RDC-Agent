import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage, Message } from '../agent-runtime/core/types';
import type { ConversationMessage } from '@shared/types/conversation';
import {
  canonicalizeTerminalContextMessages,
  filterSessionContextMessageArtifacts,
  SessionContextJournal,
} from './SessionContextJournal';
import { storageAdapter } from '../sessions/StorageAdapter';

afterEach(() => vi.restoreAllMocks());

const assistant = (protocol = 'OpenAIResponses'): AssistantMessage => ({
  role: 'assistant',
  provider: 'openai',
  model: 'gpt-5',
  content: [{
    type: 'thinking',
    kind: 'opaque',
    source: 'openai-responses-encrypted',
    visibility: 'hidden',
    replayPolicy: 'provider-artifact',
    artifact: {
      providerId: 'openai',
      modelId: 'gpt-5',
      protocol,
      type: 'reasoning',
      encryptedContent: 'protected',
    },
  }],
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  stopReason: 'stop',
  timestamp: 1,
});

describe('SessionContextJournal canonicalization', () => {
  it('replays provider artifacts only for an exact provider, model, and protocol route', () => {
    const same = filterSessionContextMessageArtifacts(assistant(), {
      providerId: 'openai', modelId: 'gpt-5', protocol: 'OpenAIResponses',
    });
    expect(same.filtered).toBe(0);
    expect((same.message as AssistantMessage).content).toHaveLength(1);
    const canonicalSame = filterSessionContextMessageArtifacts(assistant('anthropic-messages'), {
      providerId: 'openai', modelId: 'gpt-5', protocol: 'AnthropicMessages',
    });
    expect(canonicalSame.filtered).toBe(0);

    for (const route of [
      { providerId: 'openrouter', modelId: 'gpt-5', protocol: 'OpenAIResponses' },
      { providerId: 'openai', modelId: 'gpt-5-mini', protocol: 'OpenAIResponses' },
      { providerId: 'openai', modelId: 'gpt-5', protocol: 'OpenAICompatibleChatCompletions' },
    ]) {
      const changed = filterSessionContextMessageArtifacts(assistant(), route);
      expect(changed.filtered).toBe(1);
      expect((changed.message as AssistantMessage).content).toHaveLength(0);
    }
  });

  it('drops readable thinking unless its replay policy and source route are exact', () => {
    const readable: AssistantMessage = {
      ...assistant(),
      content: [{
        type: 'thinking',
        text: 'provider continuation state',
        kind: 'raw',
        source: 'openai-compatible-raw',
        visibility: 'hidden',
        replayPolicy: 'openai-reasoning-content',
      }],
    };
    const route = { providerId: 'openai', modelId: 'gpt-5', protocol: 'OpenAICompatibleChatCompletions' };
    expect((filterSessionContextMessageArtifacts(readable, route, route).message as AssistantMessage).content).toHaveLength(1);
    const changed = filterSessionContextMessageArtifacts(readable, { ...route, modelId: 'gpt-5-mini' }, route);
    expect(changed.filtered).toBe(1);
    expect((changed.message as AssistantMessage).content).toHaveLength(0);

    const displayOnly: AssistantMessage = {
      ...readable,
      content: [{
        type: 'thinking',
        text: 'display only',
        kind: 'raw',
        source: 'openai-compatible-raw',
        visibility: 'hidden',
        replayPolicy: 'none',
      }],
    };
    expect((filterSessionContextMessageArtifacts(displayOnly, route, route).message as AssistantMessage).content).toHaveLength(0);
  });

  it('removes dangling tool calls but retains paired tool facts and safe partial text', () => {
    const messages: Message[] = [{ role: 'user', content: 'inspect', timestamp: 1 }, {
      ...assistant(),
      content: [
        { type: 'text', text: 'I inspected the file.' },
        { type: 'toolCall', id: 'paired', name: 'read_file', arguments: {} },
        { type: 'toolCall', id: 'dangling', name: 'read_file', arguments: {} },
      ],
    }, {
      role: 'toolResult', toolCallId: 'paired', toolName: 'read_file',
      content: [{ type: 'text', text: 'contents' }], isError: false, timestamp: 2,
    }];
    const canonical = canonicalizeTerminalContextMessages(messages);
    const content = (canonical[1] as AssistantMessage).content;
    expect(content.some((block) => block.type === 'text')).toBe(true);
    expect(content.filter((block) => block.type === 'toolCall').map((block) => block.id)).toEqual(['paired']);
    expect(canonical[2].role).toBe('toolResult');
  });

  it('rejects a conflicting duplicate turn instead of silently keeping the wrong branch entry', () => {
    const journal = new SessionContextJournal();
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([{
      schemaVersion: 1,
      turnId: 'turn-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
      branchId: 'branch-a',
      agentId: 'ask',
      route: { providerId: 'openai', modelId: 'gpt-5', protocol: 'OpenAIResponses' },
      controls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      status: 'complete',
      messages: [],
      createdAt: 1,
      completedAt: 2,
    }]);
    expect(() => journal.append('session-1', {
      schemaVersion: 1,
      turnId: 'turn-1',
      userMessageId: 'user-2',
      assistantMessageId: 'assistant-2',
      branchId: 'branch-b',
      agentId: 'ask',
      route: { providerId: 'openai', modelId: 'gpt-5', protocol: 'OpenAIResponses' },
      controls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      status: 'complete',
      messages: [],
      createdAt: 1,
      completedAt: 2,
    })).toThrow('Conflicting session context entry');
  });

  it('rejects a same-identity duplicate when its terminal payload differs', () => {
    const journal = new SessionContextJournal();
    const entry = {
      schemaVersion: 1 as const,
      turnId: 'turn-1', userMessageId: 'user-1', assistantMessageId: 'assistant-1', branchId: 'branch-a',
      agentId: 'ask' as const,
      route: { providerId: 'openai', modelId: 'gpt-5', protocol: 'OpenAIResponses' },
      controls: { reasoningLevel: 'off' as const, maxContextMode: false, fastModel: false },
      status: 'complete' as const, messages: [] as Message[], createdAt: 1, completedAt: 2,
    };
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([entry]);
    expect(() => journal.append('session-1', { ...entry, status: 'error' })).toThrow('Conflicting session context entry');
  });

  it('does not commit the migration marker when a journal append fails', () => {
    const journal = new SessionContextJournal();
    const history = [{
      id: 'user-1', role: 'user', content: 'question', turnId: 'turn-1', branchId: 'branch-root',
      createdAt: 1, updatedAt: 1, status: 'complete',
    }, {
      id: 'assistant-1', role: 'assistant', content: 'answer', turnId: 'turn-1', branchId: 'branch-root',
      createdAt: 2, updatedAt: 2, status: 'complete', agentId: 'ask',
    }] as ConversationMessage[];
    vi.spyOn(storageAdapter, 'readSessionContextMigrationVersion').mockReturnValue(0);
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([]);
    vi.spyOn(storageAdapter, 'readConversationHistory').mockReturnValue(history);
    vi.spyOn(storageAdapter, 'readConversationBranchState').mockReturnValue(null);
    vi.spyOn(storageAdapter, 'appendSessionContextTurn').mockImplementation(() => { throw new Error('disk full'); });
    const marker = vi.spyOn(storageAdapter, 'writeSessionContextMigrationVersion');
    expect(() => journal.ensureMigrated('session-1')).toThrow('disk full');
    expect(marker).not.toHaveBeenCalled();
  });

  it('fails closed when a visible turn is missing from a migrated journal', () => {
    const journal = new SessionContextJournal();
    vi.spyOn(storageAdapter, 'readSessionContextMigrationVersion').mockReturnValue(1);
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([]);
    expect(() => journal.materialize('session-1', ['missing-turn'], {
      providerId: 'openai', modelId: 'gpt-5', protocol: 'OpenAIResponses',
    })).toThrow('Session context journal is incomplete');
  });
});
