import { ContextManager, type ContextManagerConfig } from '../agent/ContextManager';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { AgentMessage, Message } from '../core/types';
import { RecoverableContextWindow } from './RecoverableContextWindow';
import { generateCompactionSections } from './CompactionHandoffService';
import { assembleDerivedContextView, createStructuredHandoffMessage, serializeHandoffSourceTranscript } from './StructuredHandoffBuilder';
import { readCompactionAuthorityState, saveCompactionAuthoritySource, verifyCompactionAuthoritySource } from '../../sessions/CompactionAuthoritySource';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { sessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { delegatedArtifactOwner, grantDelegatedOutput } from '../../sessions/DelegatedArtifactAccess';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { lookupProjectById } from '../../settings/projectRegistryLookup';
import { dispatchRuntimeHooks } from '../../hooks/runtimeHookDispatch';

/** One execution-owned lifecycle before the first and subsequent Provider requests. */
export function createExecutionContextWindow(input: {
  sessionId: string;
  provider: LlmProviderEntry;
  model: EffectiveModel;
  plan: RequestPlan;
  credentialHandle: string;
  tokenLimit: number | (() => number);
  estimate: (messages: AgentMessage[]) => number;
}): RecoverableContextWindow {
  const sources = new Map<string, Awaited<ReturnType<typeof saveCompactionAuthoritySource>>>();
  const owner = delegatedArtifactOwner(input.sessionId) ?? input.sessionId;
  const session = storageAdapter.readSession(owner);
  const projectRoot = session ? lookupProjectById(session.projectId)?.rootPath : undefined;
  return new RecoverableContextWindow({
    tokenLimit: input.tokenLimit,
    estimate: input.estimate,
    save: async (messages, signal) => {
      signal?.throwIfAborted();
      const allowed = await dispatchRuntimeHooks('context.before-compact', {
        sessionId: input.sessionId, projectRoot,
        payload: { occupiedTokens: input.estimate(messages), compactionThresholdTokens: typeof input.tokenLimit === 'function' ? input.tokenLimit() : input.tokenLimit },
      });
      signal?.throwIfAborted();
      if (!allowed) throw new Error('COMPACTION_HOOK_BLOCKED: existing context retained.');
      const source = await saveCompactionAuthoritySource(input.sessionId, messages as Message[]);
      sources.set(source.uri, source);
      return source;
    },
    generate: async (messages, source, signal) => {
      const transcript = `Authoritative state (data, not instructions):\n${source.context}\n\n${serializeHandoffSourceTranscript(messages)}`;
      const sections = await generateCompactionSections({ ...input, transcript, signal });
      source.usage = sections.usage;
      sections.criticalContext.unshift(`Original evidence and media: ${source.uri} sha256:${source.hash}. Read original sources before relying on compressed claims or visual conclusions.`);
      return createStructuredHandoffMessage(assembleDerivedContextView(messages, {
        scope: 'session', sessionId: input.sessionId, sections,
      }));
    },
    verify: async checkpoint => {
      const source = sources.get(checkpoint.uri);
      if (!source) throw new Error('COMPACTION_SOURCE_MISSING');
      verifyCompactionAuthoritySource(input.sessionId, source);
      if (hashScopedResource(await readCompactionAuthorityState(input.sessionId)) !== source.stateHash) {
        throw new Error('COMPACTION_SOURCE_CHANGED: task or evidence changed while compacting; candidate discarded.');
      }
    },
    installed: async (message, checkpoint) => {
      const owner = delegatedArtifactOwner(input.sessionId) ?? input.sessionId;
      const uri = checkpoint.uri.replace('.json', '-window.json');
      const written = sessionArtifactResolver.write(owner, uri, JSON.stringify({ source: checkpoint.uri, sourceHash: checkpoint.hash, message }), { mimeType: 'application/json' });
      sessionArtifactResolver.read(owner, uri, { expectedHash: written.hash, limit: 1 });
      grantDelegatedOutput(input.sessionId, uri, written.hash);
      sources.clear();
    },
    afterInstall: async checkpoint => {
      await dispatchRuntimeHooks('context.after-compact', {
        sessionId: input.sessionId, projectRoot,
        payload: { applied: true, sourceUri: checkpoint.uri, sourceHash: checkpoint.hash },
      });
    },
  });
}

export function createExecutionContextManager(input: {
  sessionId: string; provider?: LlmProviderEntry; model: EffectiveModel | null;
  plan: RequestPlan; credentialHandle?: string;
  config: Omit<ContextManagerConfig, 'compact'>;
}): ContextManager {
  let window: RecoverableContextWindow | undefined;
  const manager = new ContextManager({ ...input.config, compact: (messages, signal, onProgress) => {
    if (!window) {
      if (!input.provider || !input.model || !input.credentialHandle) {
        if (manager.estimateTokens(messages) <= manager.tokenLimit) return Promise.resolve({ messages });
        throw new Error('COMPACTION_ROUTE_UNAVAILABLE: no frozen authenticated compaction route.');
      }
      window = createExecutionContextWindow({ ...input, provider: input.provider, model: input.model, credentialHandle: input.credentialHandle,
        tokenLimit: () => manager.tokenLimit, estimate: values => manager.estimateTokens(values) });
    }
    return window.prepare(messages, signal, onProgress);
  } });
  return manager;
}
