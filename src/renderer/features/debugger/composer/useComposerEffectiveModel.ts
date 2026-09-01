import type { SessionRecord } from '@shared/types/session';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useProjectStore } from '../../../stores/projectStore';
import {
  hasComposerModelChoice,
  readCompiledComposerRoute,
  resolveComposerEffectiveModel,
} from './composerEffectiveModel';
import {
  composerNoSessionScopeKey,
  readComposerDraftModel,
  useComposerModelDraftStore,
} from './composerModelDraft';

export function readComposerEffectiveModel(
  agentId: string,
  currentSession: SessionRecord | null,
  projectId?: string | null,
): ReturnType<typeof resolveComposerEffectiveModel> {
  const route = readCompiledComposerRoute(useAppSettingsStore.getState().settings, agentId);
  return resolveComposerEffectiveModel(
    currentSession?.modelOverride,
    currentSession ? null : readComposerDraftModel(projectId ?? useProjectStore.getState().currentProject?.projectId),
    route,
  );
}

export function useComposerEffectiveModel(agentId: string, currentSession: SessionRecord | null) {
  const projectId = useProjectStore((state) => state.currentProject?.projectId ?? null);
  const agentRoute = useAppSettingsStore((state) => readCompiledComposerRoute(state.settings, agentId));
  const draftScope = composerNoSessionScopeKey(projectId);
  const draftModel = useComposerModelDraftStore((state) => (
    currentSession ? null : (state.draftByScope[draftScope] ?? null)
  ));
  const effective = resolveComposerEffectiveModel(
    currentSession?.modelOverride,
    draftModel,
    agentRoute,
  );
  return {
    effective,
    hasChoice: hasComposerModelChoice(currentSession?.modelOverride, draftModel),
    projectId,
  };
}
