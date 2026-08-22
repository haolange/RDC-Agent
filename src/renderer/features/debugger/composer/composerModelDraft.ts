import { create } from 'zustand';
import type { SessionModelOverride } from '@shared/types/session';
import { buildComposerSessionScopeKey } from './composerSessionScope';

interface ComposerModelDraftState {
  draftByScope: Record<string, SessionModelOverride>;
  setDraft: (scopeKey: string, model: SessionModelOverride) => void;
  clearDraft: (scopeKey: string) => void;
  reset: () => void;
}

export const useComposerModelDraftStore = create<ComposerModelDraftState>((set) => ({
  draftByScope: {},
  setDraft: (scopeKey, model) => set((state) => ({
    draftByScope: { ...state.draftByScope, [scopeKey]: model },
  })),
  clearDraft: (scopeKey) => set((state) => {
    const next = { ...state.draftByScope };
    delete next[scopeKey];
    return { draftByScope: next };
  }),
  reset: () => set({ draftByScope: {} }),
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
