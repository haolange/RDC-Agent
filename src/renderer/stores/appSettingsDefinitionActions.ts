import { agentDefinitionLaneKey } from '@shared/types/agentManifest';
import { providerConnectionIdentity } from '@shared/utils/providerConnectionIdentity';
import { RevisionLanes } from '../lib/revisionLanes';
import { agentDefinitionCommit, agentDefinitionOverlay } from './agentDefinitionSettings';
import {
  failedProviderSave,
  providerChoicesOverlay,
  providerCommit,
  providerDefinitionRequest,
  providerSaveOutcome,
} from './providerDefinitionSettings';
import type { AgentDefinitionSaveResult } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { AppSettingsState } from './appSettingsStoreState';
import type { SettingsIntents } from './settingsIntents';
import type { SettingsViewSync } from './settingsViewSync';

interface DefinitionActionsHost {
  intents: SettingsIntents;
  viewSync: SettingsViewSync;
  settings: () => AppSettings;
  /** Shows the settings; `confirmed` once main has answered. */
  show: (settings: AppSettings, confirmed?: boolean) => void;
}

const agentSaveOutcome = (save: Promise<AgentDefinitionSaveResult>): Promise<AgentDefinitionSaveResult> =>
  save.then((result) =>
    result.status === 'failed' ? Promise.reject(new Error(result.error ?? 'Agent definition save failed.')) : result,
  );

/**
 * Agent definitions and provider model choices. Each Agent file (scope, project, id) and each provider's model
 * choices is a revision lane: the request goes to main at once with the lane's next revision, main orders the lane
 * by it, the intent shows as a settings overlay until main answers, and main's commit folds into the confirmed
 * settings only when it is newer than the last one folded for that lane.
 */
export function createSettingsDefinitionActions({
  intents,
  viewSync,
  settings,
  show,
}: DefinitionActionsHost): Pick<
  AppSettingsState,
  'saveAgentDefinition' | 'flushAgentDefinitionSaves' | 'saveProvider' | 'flushProviderSaves'
> {
  const agentLanes = new RevisionLanes();
  const providerLanes = new RevisionLanes();
  return {
    saveAgentDefinition: async (input) => {
      const agentId = input.draft.id;
      const lane = agentDefinitionLaneKey(input.scope, input.projectId, agentId);
      const request = { ...input, clientRevision: agentLanes.begin(lane) };
      const intent = intents.begin(agentDefinitionOverlay(request));
      show(intent.settings);
      const write = window.electronAPI.settings.saveAgentDefinition(request);
      void agentLanes.track(lane, request.clientRevision, agentSaveOutcome(write));
      let result: AgentDefinitionSaveResult;
      try {
        result = await write;
      } catch (error) {
        show(intents.fail(intent.id));
        throw error;
      }
      const commit = result.status === 'committed' ? result : result.lastSuccessful;
      const fold =
        commit && agentLanes.applyIfNewer(lane, commit.clientRevision) ? agentDefinitionCommit(agentId, commit) : null;
      show(intents.settle(intent.id, fold), true);
      if (result.status === 'failed' && agentLanes.isLatest(lane, request.clientRevision)) {
        throw new Error(result.error ?? 'Agent definition save failed.');
      }
      return result;
    },
    flushAgentDefinitionSaves: async (query) => {
      await agentLanes.settled(agentDefinitionLaneKey(query.scope, query.projectId, query.agentId));
      return window.electronAPI.settings.getAgentDefinitionCommit(query);
    },
    saveProvider: async (provider) => {
      const lane = provider.id;
      const request = providerDefinitionRequest(provider, providerLanes.begin(lane));
      const intent = intents.begin(providerChoicesOverlay(provider));
      show(intent.settings);
      const write = viewSync.ownWrite(
        () => window.electronAPI.settings.saveProviderDefinition(request),
        (saved) => saved.revision,
      );
      void providerLanes.track(lane, request.clientRevision, providerSaveOutcome(write));
      const result = await write.catch((error: unknown) => failedProviderSave(request, error));
      const commit = result.status === 'committed' ? result : result.lastSuccessful;
      const fold =
        commit?.provider && providerLanes.applyIfNewer(lane, commit.clientRevision)
          ? providerCommit(commit.provider)
          : null;
      show(intents.settle(intent.id, fold, result.revision), true);
      const current = settings().llm.providers.find((entry) => entry.id === provider.id);
      if (
        !providerLanes.isLatest(lane, request.clientRevision) ||
        !current ||
        providerConnectionIdentity(current) !== request.connectionIdentity
      ) {
        return { ...result, status: 'superseded' };
      }
      return result;
    },
    flushProviderSaves: async (providerId) => {
      await providerLanes.settled(providerId);
      return window.electronAPI.settings.getProviderDefinitionCommit(providerId);
    },
  };
}
