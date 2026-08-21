import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderContractBundle } from '@shared/provider-catalog/modelManifestSchema';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { AssistantMessage, Message } from '../agent-runtime/core/types';
import { createContinuationArtifact } from '../agent-runtime/reasoning/ContinuationArtifacts';
import { createProviderStateRef } from '../agent-runtime/reasoning/ProviderStateRefs';
import { createTestRequestPlan } from '../testing/createTestRequestPlan';
import {
  canonicalizeTerminalContextMessages,
  filterSessionContextMessageArtifacts,
  SessionContextJournal,
  type SessionContextTurnEntry,
} from './SessionContextJournal';
import { storageAdapter } from '../sessions/StorageAdapter';
import { buildDerivedContextView } from '../agent-runtime/context/StructuredHandoffBuilder';

afterEach(() => vi.restoreAllMocks());

type PlanOptions = {
  providerId: string;
  adapterId: RequestPlan['adapterId'];
  protocol: RequestPlan['route']['protocol'];
  modelId: string;
  carrier: ProviderContractBundle['reasoning']['carrier'];
  continuation: ProviderContractBundle['reasoning']['continuation'];
  artifactPolicy: ProviderContractBundle['toolLoop']['artifactPolicy'];
  artifactScope: ProviderContractBundle['toolLoop']['artifactScope'];
  compatibilityGroup: string;
};

function createPlan(options: PlanOptions): RequestPlan {
  const fallback = createFailClosedProviderContracts(options.protocol);
  const contracts: ProviderContractBundle = {
    ...fallback,
    protocolDialect: options.protocol,
    protocolVersion: 'test-v1',
    compatibilityGroup: options.compatibilityGroup,
    reasoning: {
      semantic: options.carrier === 'reasoning-content' ? 'raw' : 'opaque',
      source: 'test-contract',
      displayLabel: options.carrier === 'reasoning-content' ? 'Raw reasoning' : 'Provider reasoning',
      carrier: options.carrier,
      artifactFormat: options.compatibilityGroup,
      artifactVersion: 'v1',
      compatibilityGroup: options.compatibilityGroup,
      continuation: options.continuation,
    },
    toolLoop: {
      artifactPolicy: options.artifactPolicy,
      artifactScope: options.artifactScope,
      ordering: 'provider-native',
      modelSwitch: 'pin-until-terminal',
    },
  };
  return createTestRequestPlan({
    providerId: options.providerId,
    adapterId: options.adapterId,
    catalogRevision: 'catalog-v1',
    routeRevision: 'route-v1',
    selectedModelId: options.modelId,
    effectiveModelId: options.modelId,
    appliedBindingIds: [],
    route: {
      protocol: options.protocol,
      baseUrl: 'https://example.test',
      source: 'catalog',
      contracts,
    },
    contracts,
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 128_000,
    contextMode: 'normal',
    contextWindowTokens: 128_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: {
      selection: 'off',
      control: {
        kind: 'none',
        supportsOff: true,
        levels: [],
        defaultSelection: 'off',
        wireProfile: { kind: 'none' },
      },
    },
  });
}

const responsesPlan = createPlan({
  providerId: 'openai',
  adapterId: 'openai-responses',
  protocol: 'OpenAIResponses',
  modelId: 'gpt-5',
  carrier: 'reasoning-item',
  continuation: 'exact-execution',
  artifactPolicy: 'preserve-exact',
  artifactScope: 'all-assistant-turns',
  compatibilityGroup: 'openai-responses-v1',
});

function providerManagedResponsesPlan(): RequestPlan {
  const contracts: ProviderContractBundle = {
    ...responsesPlan.contracts,
    state: {
      supportedModes: ['local-stateless', 'provider-managed'],
      defaultMode: 'provider-managed',
      carrier: 'previous-response-id',
      retention: 'provider',
      crossModel: 'never',
    },
  };
  return {
    ...responsesPlan,
    contracts,
    route: { ...responsesPlan.route, contracts },
    statePlan: {
      mode: 'provider-managed',
      carrier: 'previous-response-id',
      store: true,
      reuseProviderState: true,
    },
    executionIdentity: {
      ...responsesPlan.executionIdentity,
      stateMode: 'provider-managed',
    },
  };
}

const anthropicPlan = createPlan({
  providerId: 'anthropic',
  adapterId: 'anthropic-messages',
  protocol: 'AnthropicMessages',
  modelId: 'claude',
  carrier: 'signed-content-block',
  continuation: 'exact-execution',
  artifactPolicy: 'preserve-exact',
  artifactScope: 'tool-call-turn',
  compatibilityGroup: 'anthropic-messages-v1',
});

const reasoningContentPlan = createPlan({
  providerId: 'deepseek',
  adapterId: 'openai-compatible',
  protocol: 'OpenAICompatibleChatCompletions',
  modelId: 'deepseek-v4-pro',
  carrier: 'reasoning-content',
  continuation: 'same-provider-model',
  artifactPolicy: 'preserve-reasoning-content',
  artifactScope: 'all-assistant-turns',
  compatibilityGroup: 'deepseek-reasoning-v1',
});

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

function assistant(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    provider: 'openai',
    model: 'gpt-5',
    content,
    usage,
    stopReason: 'stop',
    timestamp: 1,
  };
}

function encryptedAssistant(plan = responsesPlan): AssistantMessage {
  return assistant([{
    type: 'thinking',
    kind: 'opaque',
    source: 'openai-responses-encrypted',
    visibility: 'hidden',
    continuation: createContinuationArtifact(plan, {
      type: 'reasoning',
      encryptedContent: 'protected',
    }),
  }]);
}

function entry(overrides: Partial<SessionContextTurnEntry> = {}): SessionContextTurnEntry {
  return {
    schemaVersion: 2,
    turnId: 'turn-1',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    branchId: 'branch-root',
    agentId: 'ask',
    executionIdentity: responsesPlan.executionIdentity,
    controls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
    status: 'complete',
    messages: [],
    createdAt: 1,
    completedAt: 2,
    ...overrides,
  };
}

describe('SessionContextJournal v2', () => {
  it('replays an exact artifact only for the matching execution identity', () => {
    const exact = filterSessionContextMessageArtifacts(encryptedAssistant(), responsesPlan);
    expect(exact.replayed).toBe(1);
    expect(exact.filtered).toBe(0);
    expect(exact.decisions).toMatchObject([{ action: 'replay', reason: 'exact-execution' }]);

    const changedModel = createPlan({
      ...{
        providerId: 'openai',
        adapterId: 'openai-responses' as const,
        protocol: 'OpenAIResponses' as const,
        carrier: 'reasoning-item' as const,
        continuation: 'exact-execution' as const,
        artifactPolicy: 'preserve-exact' as const,
        artifactScope: 'all-assistant-turns' as const,
        compatibilityGroup: 'openai-responses-v1',
      },
      modelId: 'gpt-5-mini',
    });
    const changed = filterSessionContextMessageArtifacts(encryptedAssistant(), changedModel);
    expect(changed.filtered).toBe(1);
    expect(changed.decisions).toMatchObject([{ action: 'drop', reason: 'execution-mismatch' }]);
  });

  it('drops a tampered artifact even when route identity still matches', () => {
    const message = encryptedAssistant();
    const block = message.content[0];
    if (block.type !== 'thinking' || !block.continuation) throw new Error('fixture failed');
    block.continuation.encryptedContent = 'tampered';
    const result = filterSessionContextMessageArtifacts(message, responsesPlan);
    expect(result.filtered).toBe(1);
    expect(result.decisions).toMatchObject([{ action: 'drop', reason: 'invalid-integrity' }]);
  });

  it('preserves compatible provider state without leaking it across provider boundaries', () => {
    const sourcePlan = providerManagedResponsesPlan();
    const providerState = createProviderStateRef(sourcePlan, 'response_1');
    const message: AssistantMessage = {
      ...assistant([{ type: 'text', text: 'portable semantic answer' }]),
      providerState,
    };

    const compatible = filterSessionContextMessageArtifacts(message, sourcePlan);
    expect((compatible.message as AssistantMessage).providerState).toEqual(providerState);

    const incompatibleTarget: RequestPlan = {
      ...sourcePlan,
      executionIdentity: {
        ...sourcePlan.executionIdentity,
        endpointHash: 'different-endpoint',
        fingerprint: 'different-execution',
      },
    };
    const incompatible = filterSessionContextMessageArtifacts(message, incompatibleTarget);
    expect(incompatible.message).not.toHaveProperty('providerState');
    expect(message.providerState).toEqual(providerState);
  });

  it('persists cross-turn continuation artifacts verbatim and drops turn-scoped ones', () => {
    const readable = createContinuationArtifact(reasoningContentPlan, {
      type: 'reasoning_content',
      reasoningContent: 'required continuation',
    });
    const toolTurnScoped = createContinuationArtifact(anthropicPlan, {
      type: 'thinking',
      signature: 'anthropic-signature',
    });
    const canonical = canonicalizeTerminalContextMessages([
      assistant([
        {
          type: 'thinking',
          text: 'display copy must not be persisted',
          kind: 'raw',
          source: 'deepseek-raw',
          visibility: 'raw-collapsed',
          continuation: readable,
        },
        ...encryptedAssistant().content,
        {
          type: 'thinking',
          kind: 'opaque',
          source: 'anthropic-thinking',
          visibility: 'hidden',
          continuation: toolTurnScoped,
        },
        { type: 'text', text: 'final' },
      ]),
    ]);
    const content = (canonical[0] as AssistantMessage).content;
    const thinkingBlocks = content.filter((block) => block.type === 'thinking');
    // 可读 reasoning-content 与 opaque encrypted 都是 all-assistant-turns，整体落盘。
    expect(thinkingBlocks).toHaveLength(2);
    expect(thinkingBlocks[0]).toMatchObject({
      text: undefined,
      continuation: { carrier: 'reasoning-content', reasoningContent: 'required continuation' },
    });
    expect(thinkingBlocks[1]).toMatchObject({
      continuation: { encryptedContent: 'protected' },
    });
    // 落盘的 opaque 制品必须能通过完整性回放校验（verbatim，未被裁剪）。
    const persisted = filterSessionContextMessageArtifacts(canonical[0], responsesPlan);
    expect(persisted.decisions.some((decision) => decision.action === 'replay' && decision.reason === 'exact-execution')).toBe(true);
    // tool-call-turn scope 的制品不落盘；thinking 展示文案不落盘。
    expect(JSON.stringify(canonical)).not.toContain('anthropic-signature');
    expect(JSON.stringify(canonical)).not.toContain('display copy');
  });

  it('replays artifacts only within the retention window of recent turns', () => {
    const journal = new SessionContextJournal();
    const totalTurns = 10;
    const entries = Array.from({ length: totalTurns }, (_, index) => entry({
      turnId: `turn-${index + 1}`,
      userMessageId: `user-${index + 1}`,
      assistantMessageId: `assistant-${index + 1}`,
      messages: [
        { role: 'user', content: `question ${index + 1}`, timestamp: index + 1 },
        encryptedAssistant(),
      ],
    }));
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue(entries);
    vi.spyOn(storageAdapter, 'readSessionDerivedContextView').mockReturnValue(null);

    const result = journal.materialize(
      'session-1',
      entries.map((item) => item.turnId),
      responsesPlan,
    );

    // 10 个 turn，retention=8：最旧 2 个 turn 的制品按 retention-expired 丢弃。
    expect(result.replayedArtifactCount).toBe(8);
    expect(result.filteredArtifactCount).toBe(2);
    const retentionDrops = result.artifactDecisions.filter((decision) => decision.reason === 'retention-expired');
    expect(retentionDrops).toHaveLength(2);
    expect(retentionDrops.every((decision) => decision.action === 'drop')).toBe(true);
  });

  it('removes dangling tool calls but retains paired tool facts and safe text', () => {
    const messages: Message[] = [
      { role: 'user', content: 'inspect', timestamp: 1 },
      assistant([
        { type: 'text', text: 'I inspected the file.' },
        { type: 'toolCall', id: 'paired', name: 'read_file', arguments: {} },
        { type: 'toolCall', id: 'dangling', name: 'read_file', arguments: {} },
      ]),
      {
        role: 'toolResult',
        toolCallId: 'paired',
        toolName: 'read_file',
        content: [{ type: 'text', text: 'contents' }],
        isError: false,
        timestamp: 2,
      },
    ];
    const canonical = canonicalizeTerminalContextMessages(messages);
    const content = (canonical[1] as AssistantMessage).content;
    expect(content.some((block) => block.type === 'text')).toBe(true);
    expect(content.filter((block) => block.type === 'toolCall').map((block) => block.id)).toEqual(['paired']);
    expect(canonical[2].role).toBe('toolResult');
  });

  it('rejects conflicting duplicate turns and accepts byte-identical retries', () => {
    const journal = new SessionContextJournal();
    const existing = entry();
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([existing]);
    const append = vi.spyOn(storageAdapter, 'appendSessionContextTurn');

    expect(() => journal.append('session-1', existing)).not.toThrow();
    expect(append).not.toHaveBeenCalled();
    expect(() => journal.append('session-1', entry({ status: 'error' })))
      .toThrow('Conflicting session context entry');
  });

  it('fails closed on legacy v1 entries instead of performing a hot migration', () => {
    const journal = new SessionContextJournal();
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([{
      schemaVersion: 1,
      turnId: 'turn-1',
    } as unknown as SessionContextTurnEntry]);

    expect(() => journal.readEntries('session-1'))
      .toThrow('invalid v2 entry');
  });

  it('fails closed when a visible turn is missing from the journal', () => {
    const journal = new SessionContextJournal();
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([]);
    expect(() => journal.materialize('session-1', ['missing-turn'], responsesPlan))
      .toThrow('Session context journal is incomplete');
  });

  it('keeps semantic messages and paired tool facts while dropping incompatible native state', () => {
    const journal = new SessionContextJournal();
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([entry({
      messages: [
        { role: 'user', content: 'inspect the capture', timestamp: 1 },
        assistant([
          ...encryptedAssistant().content,
          { type: 'text', text: 'Found one suspicious event.' },
          { type: 'toolCall', id: 'tool-1', name: 'read_file', arguments: { path: 'capture.rdc' } },
        ]),
        {
          role: 'toolResult',
          toolCallId: 'tool-1',
          toolName: 'read_file',
          content: [{ type: 'text', text: 'event facts' }],
          isError: false,
          timestamp: 2,
        },
      ],
    })]);

    vi.spyOn(storageAdapter, 'readSessionDerivedContextView').mockReturnValue(null);
    const result = journal.materialize('session-1', ['turn-1'], anthropicPlan);
    expect(result.filteredArtifactCount).toBe(1);
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult']);
    expect((result.messages[1] as AssistantMessage).content).toEqual([
      { type: 'text', text: 'Found one suspicious event.' },
      { type: 'toolCall', id: 'tool-1', name: 'read_file', arguments: { path: 'capture.rdc' } },
    ]);
  });

  it('applies a valid structured derived view and then replays retained and new turns', () => {
    const journal = new SessionContextJournal();
    const first = entry({
      turnId: 'turn-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
      messages: [
        { role: 'user', content: 'Inspect the capture.', timestamp: 1 },
        assistant([{ type: 'text', text: 'Found event 42.' }]),
      ],
    });
    const second = entry({
      turnId: 'turn-2',
      userMessageId: 'user-2',
      assistantMessageId: 'assistant-2',
      messages: [{ role: 'user', content: 'Keep the finding.', timestamp: 2 }],
    });
    const third = entry({
      turnId: 'turn-3',
      userMessageId: 'user-3',
      assistantMessageId: 'assistant-3',
      messages: [{ role: 'user', content: 'Continue.', timestamp: 3 }],
    });
    const view = buildDerivedContextView(first.messages, {
      scope: 'session',
      sessionId: 'session-1',
      branchId: 'branch-root',
      sourceTurnIds: ['turn-1'],
      retainedTurnIds: ['turn-2'],
      messageSourceRefs: ['turn:turn-1:message:0', 'turn:turn-1:message:1'],
      createdAt: 10,
    });
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([first, second, third]);
    vi.spyOn(storageAdapter, 'readSessionDerivedContextView').mockReturnValue(view);

    const result = journal.materialize(
      'session-1',
      ['turn-1', 'turn-2', 'turn-3'],
      responsesPlan,
      'branch-root',
    );

    expect(result).toMatchObject({
      derivedContextStatus: 'applied',
      compactedTurnCount: 1,
      selectedTurnCount: 3,
      derivedContextView: { viewId: view.viewId },
    });
    expect(result.messages[0]).toMatchObject({
      role: 'user',
      derivedContext: { viewId: view.viewId, sourceHash: view.sourceHash },
    });
    expect(result.messages.slice(1).map((message) => message.role)).toEqual(['user', 'user']);
  });

  it('fails closed to the canonical transcript when a derived view is stale', () => {
    const journal = new SessionContextJournal();
    const first = entry({
      turnId: 'turn-1',
      messages: [{ role: 'user', content: 'Current source.', timestamp: 1 }],
    });
    const second = entry({
      turnId: 'turn-2',
      userMessageId: 'user-2',
      assistantMessageId: 'assistant-2',
      messages: [{ role: 'user', content: 'Latest turn.', timestamp: 2 }],
    });
    const staleView = buildDerivedContextView(
      [{ role: 'user', content: 'Old source.', timestamp: 1 }],
      {
        scope: 'session',
        sessionId: 'session-1',
        branchId: 'branch-root',
        sourceTurnIds: ['turn-1'],
        retainedTurnIds: ['turn-2'],
        createdAt: 10,
      },
    );
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([first, second]);
    vi.spyOn(storageAdapter, 'readSessionDerivedContextView').mockReturnValue(staleView);

    const result = journal.materialize(
      'session-1',
      ['turn-1', 'turn-2'],
      responsesPlan,
      'branch-root',
    );

    expect(result).toMatchObject({ derivedContextStatus: 'stale', compactedTurnCount: 0 });
    expect(result.derivedContextView).toBeUndefined();
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'user']);
    expect(result.messages[0]).not.toHaveProperty('derivedContext');
  });

  it('skips derived compaction while occupancy is within the compaction line', () => {
    const journal = new SessionContextJournal();
    const clear = vi.spyOn(storageAdapter, 'clearSessionDerivedContextView').mockImplementation(() => undefined);
    const write = vi.spyOn(storageAdapter, 'writeSessionDerivedContextView').mockImplementation(() => undefined);
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([
      entry({ turnId: 'turn-1' }),
      entry({ turnId: 'turn-2' }),
      entry({ turnId: 'turn-3' }),
      entry({ turnId: 'turn-4' }),
    ]);

    expect(journal.createDerivedView(
      'session-1',
      ['turn-1', 'turn-2', 'turn-3', 'turn-4'],
      'branch-root',
      { occupiedTokens: 100_000, compactionThresholdTokens: 160_000 },
    )).toBeNull();
    expect(clear).toHaveBeenCalledWith('session-1');
    expect(write).not.toHaveBeenCalled();
  });

  it('compacts older turns when occupancy exceeds the compaction line', () => {
    const journal = new SessionContextJournal();
    vi.spyOn(storageAdapter, 'clearSessionDerivedContextView').mockImplementation(() => undefined);
    const write = vi.spyOn(storageAdapter, 'writeSessionDerivedContextView').mockImplementation(() => undefined);
    vi.spyOn(storageAdapter, 'readSessionContextJournal').mockReturnValue([
      entry({
        turnId: 'turn-1',
        messages: [{ role: 'user', content: 'Oldest.', timestamp: 1 }],
      }),
      entry({
        turnId: 'turn-2',
        userMessageId: 'user-2',
        assistantMessageId: 'assistant-2',
        messages: [{ role: 'user', content: 'Older.', timestamp: 2 }],
      }),
      entry({
        turnId: 'turn-3',
        userMessageId: 'user-3',
        assistantMessageId: 'assistant-3',
        messages: [{ role: 'user', content: 'Recent.', timestamp: 3 }],
      }),
      entry({
        turnId: 'turn-4',
        userMessageId: 'user-4',
        assistantMessageId: 'assistant-4',
        messages: [{ role: 'user', content: 'Latest.', timestamp: 4 }],
      }),
    ]);

    const view = journal.createDerivedView(
      'session-1',
      ['turn-1', 'turn-2', 'turn-3', 'turn-4'],
      'branch-root',
      { occupiedTokens: 180_000, compactionThresholdTokens: 160_000 },
    );
    expect(view?.sourceTurnIds).toEqual(['turn-1']);
    expect(view?.retainedTurnIds).toEqual(['turn-2', 'turn-3', 'turn-4']);
    expect(write).toHaveBeenCalled();
  });
});
