import { create } from 'zustand';
import { buildComposerSessionScopeKey } from '../lib/composerSessionScope';
import type { SessionModelOverride } from '@shared/types/session';

/** What the person chose in a project's Composer before its first session exists; the first turn writes it to the session. */
interface ComposerModelDraftState {
  draftByScope: Record<string, SessionModelOverride>;
  agentDraftByScope: Record<string, string>;
  setDraft: (scopeKey: string, model: SessionModelOverride) => void;
  clearDraft: (scopeKey: string) => void;
  setAgentDraft: (scopeKey: string, agentId: string | null) => void;
  reset: () => void;
}

export const useComposerModelDraftStore = create<ComposerModelDraftState>((set) => ({
  draftByScope: {},
  agentDraftByScope: {},
  setDraft: (scopeKey, model) => set((state) => ({
    draftByScope: { ...state.draftByScope, [scopeKey]: model },
  })),
  clearDraft: (scopeKey) => set((state) => {
    const next = { ...state.draftByScope };
    delete next[scopeKey];
    return { draftByScope: next };
  }),
  setAgentDraft: (scopeKey, agentId) => set((state) => {
    const next = { ...state.agentDraftByScope };
    if (agentId) next[scopeKey] = agentId;
    else delete next[scopeKey];
    return { agentDraftByScope: next };
  }),
  reset: () => set({ draftByScope: {}, agentDraftByScope: {} }),
}));

export function composerNoSessionScopeKey(projectId: string | null | undefined): string {
  return buildComposerSessionScopeKey(projectId, null);
}

export function readComposerDraftModel(
  projectId: string | null | undefined,
): SessionModelOverride | null {
  return useComposerModelDraftStore.getState().draftByScope[composerNoSessionScopeKey(projectId)] ?? null;
}

export function writeComposerDraftModel(
  projectId: string | null | undefined,
  model: SessionModelOverride,
): void {
  useComposerModelDraftStore.getState().setDraft(composerNoSessionScopeKey(projectId), model);
}

export function clearComposerDraftModel(projectId: string | null | undefined): void {
  useComposerModelDraftStore.getState().clearDraft(composerNoSessionScopeKey(projectId));
}

export function readComposerDraftAgent(projectId: string | null | undefined): string | null {
  return useComposerModelDraftStore.getState().agentDraftByScope[composerNoSessionScopeKey(projectId)] ?? null;
}

export function writeComposerDraftAgent(projectId: string | null | undefined, agentId: string | null): void {
  useComposerModelDraftStore.getState().setAgentDraft(composerNoSessionScopeKey(projectId), agentId);
}
