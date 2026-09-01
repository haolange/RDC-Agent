import type { ConversationMessage } from '@shared/types/conversation';
import type { DerivedContextView } from '@shared/types/semanticContext';
import { DEFAULT_AGENT_ID, type AgentRole } from '@shared/types/agent';
import type { Message } from '../core/types';
import { planEffectiveModelRequest, resolveEffectiveModel } from '../../settings/EffectiveModelResolver';
import { settingsService } from '../../settings/SettingsService';
import { resolveCompactionPercentForSettings } from '../../settings/compactionPercent';
import { lookupProjectById } from '../../settings/projectRegistryLookup';
import { loadProviderSurface } from '../../provider-catalog/ProviderCatalogRegistry';
import {
  findEffectiveAgentProfile,
  resolveAgentRoutePreflight,
} from '../../conversation/ConversationRoutePreflight';
import { sessionContextJournal } from '../../conversation/SessionContextJournal';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
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

export type CompactionAgentFallbackReason = 'missing' | 'unknown' | 'disabled';

export interface CompactionAgentResolution {
  agentId: AgentRole;
  source: 'history' | 'session' | 'default';
  fallbackReason?: CompactionAgentFallbackReason;
}

function readMessageAgentId(message: ConversationMessage | undefined): string | null {
  const candidate = message?.agentId?.trim() || message?.profileId?.trim();
  return candidate || null;
}

function isEnabledInProjectSnapshot(agentId: string, projectRootPath: string): boolean {
  return findEffectiveAgentProfile(agentId, projectRootPath).enabled;
}

export function resolveCompactionAgentId(
  history: ConversationMessage[],
  projectRootPath: string | null,
): CompactionAgentResolution {
  const lastAssistant = [...history].reverse().find((message) => message.role === 'assistant');
  const lastUser = [...history].reverse().find((message) => message.role === 'user');
  const historyAgentId = readMessageAgentId(lastAssistant);
  const sessionAgentId = readMessageAgentId(lastUser);

  // Without a project root, a user/builtin-only snapshot must not rewrite a custom id.
  if (!projectRootPath) {
    if (historyAgentId) {
      return { agentId: historyAgentId, source: 'history' };
    }
    if (sessionAgentId) {
      return { agentId: sessionAgentId, source: 'session', fallbackReason: 'missing' };
    }
    return { agentId: DEFAULT_AGENT_ID, source: 'default', fallbackReason: 'missing' };
  }

  if (historyAgentId) {
    const historyProfile = findEffectiveAgentProfile(historyAgentId, projectRootPath);
    if (historyProfile.enabled) {
      return { agentId: historyAgentId, source: 'history' };
    }
    const fallbackReason: CompactionAgentFallbackReason = historyProfile.found ? 'disabled' : 'unknown';
    if (sessionAgentId && isEnabledInProjectSnapshot(sessionAgentId, projectRootPath)) {
      return { agentId: sessionAgentId, source: 'session', fallbackReason };
    }
    return { agentId: DEFAULT_AGENT_ID, source: 'default', fallbackReason };
  }

  if (sessionAgentId && isEnabledInProjectSnapshot(sessionAgentId, projectRootPath)) {
    return { agentId: sessionAgentId, source: 'session', fallbackReason: 'missing' };
  }
  return { agentId: DEFAULT_AGENT_ID, source: 'default', fallbackReason: 'missing' };
}

function recordCompactionProfileFallback(
  sessionId: string,
  projectId: string,
  requestedAgentId: string | null,
  resolved: CompactionAgentResolution,
): void {
  if (!resolved.fallbackReason) return;
  runtimeLogService.log({
    scope: 'session',
    namespace: 'context',
    severity: 'warning',
    title: 'COMPACTION_PROFILE_FALLBACK',
    summary: `Compaction used ${resolved.agentId} after history profile ${requestedAgentId ?? '(missing)'} was ${resolved.fallbackReason}.`,
    sessionId,
    projectId,
    raw: {
      code: 'COMPACTION_PROFILE_FALLBACK',
      requestedAgentId,
      resolvedAgentId: resolved.agentId,
      source: resolved.source,
      reason: resolved.fallbackReason,
    },
  });
}

export async function generateSessionCompactionSections(input: {
  sessionId: string;
  history: ConversationMessage[];
  sourceMessages: Message[];
}): Promise<ModelHandoffSections> {
  const session = storageAdapter.readSession(input.sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND: cannot compact a missing session.');
  const projectRootPath = lookupProjectById(session.projectId)?.rootPath ?? null;
  const resolved = resolveCompactionAgentId(input.history, projectRootPath);
  const lastAssistant = [...input.history].reverse().find((message) => message.role === 'assistant');
  recordCompactionProfileFallback(
    session.sessionId,
    session.projectId,
    readMessageAgentId(lastAssistant),
    resolved,
  );
  const agentId = resolved.agentId;
  const routePreflight = resolveAgentRoutePreflight(agentId, undefined, session.modelOverride, projectRootPath);
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
