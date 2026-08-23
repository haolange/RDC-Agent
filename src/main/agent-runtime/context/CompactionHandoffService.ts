import type { ConversationMessage } from '@shared/types/conversation';
import type { DerivedContextView } from '@shared/types/semanticContext';
import type { AgentRole } from '@shared/types/agent';
import type { Message } from '../core/types';
import { planEffectiveModelRequest, resolveEffectiveModel } from '../../settings/EffectiveModelResolver';
import { settingsService } from '../../settings/SettingsService';
import { resolveCompactionPercentForSettings } from '../../settings/compactionPercent';
import { loadProviderSurface } from '../../provider-catalog/ProviderCatalogRegistry';
import { resolveAgentRoutePreflight } from '../../conversation/ConversationRoutePreflight';
import { sessionContextJournal } from '../../conversation/SessionContextJournal';
import { agentOrchestrator } from '../../workflow/debugger/AgentOrchestrator';
import { storageAdapter } from '../../sessions/StorageAdapter';
import {
  assistantMessageText,
  executeCompactionHandoff,
} from './CompactionHandoffRuntime';
import {
  parseModelHandoffSections,
  serializeHandoffSourceTranscript,
  type ModelHandoffSections,
} from './StructuredHandoffBuilder';

export const SESSION_COMPACTION_KEEP_RECENT_TURNS = 3;

export function isWithinSessionCompactionLine(
  occupiedTokens: number,
  compactionThresholdTokens: number,
  visibleTurnCount: number,
  keepRecentTurns = SESSION_COMPACTION_KEEP_RECENT_TURNS,
): boolean {
  return occupiedTokens <= compactionThresholdTokens || visibleTurnCount <= keepRecentTurns;
}

function resolveCompactionAgentId(history: ConversationMessage[]): AgentRole {
  const lastAssistant = [...history].reverse().find((message) => message.role === 'assistant');
  return lastAssistant?.agentId === 'analyzer' || lastAssistant?.agentId === 'optimizer'
    || lastAssistant?.agentId === 'debugger' || lastAssistant?.agentId === 'ask'
    ? lastAssistant.agentId
    : 'ask';
}

export async function generateSessionCompactionSections(input: {
  sessionId: string;
  history: ConversationMessage[];
  sourceMessages: Message[];
}): Promise<ModelHandoffSections> {
  const session = storageAdapter.readSession(input.sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND: cannot compact a missing session.');
  const agentId = resolveCompactionAgentId(input.history);
  const projectRootPath = storageAdapter.getProjectById(session.projectId)?.rootPath ?? null;
  const routePreflight = resolveAgentRoutePreflight(agentId, undefined, session.modelOverride);
  if (!routePreflight.ok) {
    throw new Error(`COMPACTION_ROUTE_UNAVAILABLE: ${routePreflight.diagnostic.userMessage}`);
  }
  const surface = await loadProviderSurface(routePreflight.providerId);
  if (!surface) {
    throw new Error(`PROVIDER_UNAVAILABLE: ${routePreflight.providerId} is not in the compiled Catalog.`);
  }
  const settings = settingsService.getAll();
  const effectiveModel = resolveEffectiveModel(routePreflight.providerId, routePreflight.modelId, settings);
  if (!effectiveModel) {
    throw new Error(`MODEL_UNAVAILABLE: ${routePreflight.providerId}/${routePreflight.modelId}`);
  }
  const planning = planEffectiveModelRequest({
    providerId: routePreflight.providerId,
    modelId: routePreflight.modelId,
    settings,
    controls: session.turnControls ?? {},
    compactionThresholdPercent: resolveCompactionPercentForSettings(settings, projectRootPath),
  });
  if (!planning.ok) throw new Error(`${planning.code}: ${planning.message}`);
  const provider = settings.llm.providers.find((entry) => entry.id === routePreflight.providerId);
  if (!provider) {
    throw new Error(`PROVIDER_UNAVAILABLE: ${routePreflight.providerId} is not configured.`);
  }
  const credentialHandle = await agentOrchestrator.refreshProviderRuntimeCredentials(routePreflight.providerId);
  try {
    const message = await executeCompactionHandoff({
      sessionId: input.sessionId,
      provider,
      model: effectiveModel,
      plan: planning.plan,
      credentialHandle,
      transcript: serializeHandoffSourceTranscript(input.sourceMessages),
    });
    return parseModelHandoffSections(assistantMessageText(message));
  } finally {
    agentOrchestrator.releaseProviderRuntimeCredentials(credentialHandle);
  }
}

export async function persistGeneratedSessionCompaction(input: {
  sessionId: string;
  history: ConversationMessage[];
  visibleTurnIds: string[];
  branchId: string;
  occupiedTokens: number;
  compactionThresholdTokens: number;
  keepRecentTurns?: number;
}): Promise<DerivedContextView | null> {
  const keepRecentTurns = input.keepRecentTurns ?? SESSION_COMPACTION_KEEP_RECENT_TURNS;
  const occupancy = {
    occupiedTokens: input.occupiedTokens,
    compactionThresholdTokens: input.compactionThresholdTokens,
  };
  if (isWithinSessionCompactionLine(
    input.occupiedTokens,
    input.compactionThresholdTokens,
    input.visibleTurnIds.length,
    keepRecentTurns,
  )) {
    return sessionContextJournal.createDerivedView(
      input.sessionId,
      input.visibleTurnIds,
      input.branchId,
      occupancy,
      keepRecentTurns,
    );
  }
  const entries = sessionContextJournal.readEntries(input.sessionId);
  const entryByTurn = new Map(entries.map((entry) => [entry.turnId, entry]));
  const sourceMessages = input.visibleTurnIds
    .slice(0, -keepRecentTurns)
    .flatMap((turnId) => entryByTurn.get(turnId)?.messages ?? []);
  const sections = await generateSessionCompactionSections({
    sessionId: input.sessionId,
    history: input.history,
    sourceMessages,
  });
  return sessionContextJournal.createDerivedView(
    input.sessionId,
    input.visibleTurnIds,
    input.branchId,
    occupancy,
    keepRecentTurns,
    sections,
  );
}
