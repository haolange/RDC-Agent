import { useCallback, useMemo, useState } from 'react';
import type { AppSettings } from '@shared/types/settings';
import type { useSettingsModal } from './useSettingsModal';
import type { ManualSaveForm } from './settingsDirtyState';

type NavigationDrafts = Pick<ReturnType<typeof useSettingsModal>,
  'activeSection' | 'dirty' | 'setAccountDraft' | 'setGlobalInstructionsDraft' |
  'setRdcCliDraft' | 'setCodeInterpreterDraft' | 'setShellDraft'>;

/** Owns manual-draft navigation; auto-save controllers retain their own lifecycle. */
export function useSettingsNavigation(modal: NavigationDrafts, settings: AppSettings, onClose: () => void) {
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [resourceDraftDirty, setResourceDraftDirty] = useState(false);
  const { activeSection, dirty, setAccountDraft, setGlobalInstructionsDraft,
    setRdcCliDraft: resetRdcCliDraft,
    setCodeInterpreterDraft: resetCodeInterpreterDraft, setShellDraft: resetShellDraft } = modal;
  /** Manual-save forms that live on the current section; auto-saved pages never block navigation. */
  const sectionForms = useMemo<ManualSaveForm[]>(() => (activeSection === 'general'
    ? ['profile', 'personalization']
    : activeSection === 'tools' ? ['tools'] : []), [activeSection]);
  const sectionDirty = resourceDraftDirty || sectionForms.some((form) => dirty[form]);

  const discardSectionDrafts = useCallback(() => {
    if (sectionForms.includes('profile')) setAccountDraft(settings.profile);
    if (sectionForms.includes('personalization')) setGlobalInstructionsDraft(settings.agents.globalInstructions);
    if (sectionForms.includes('tools')) {
      resetRdcCliDraft(settings.tooling.rdcCli);
      resetCodeInterpreterDraft(settings.tooling.codeInterpreter);
      resetShellDraft(settings.tooling.shell);
    }
  }, [resetCodeInterpreterDraft, resetRdcCliDraft, resetShellDraft, sectionForms, setAccountDraft, setGlobalInstructionsDraft, settings]);

  /** Routes navigation / close through the unsaved-changes dialog when the current section has a live manual draft. */
  const guardLeave = useCallback((action: () => void) => {
    if (!sectionDirty) {
      action();
      return;
    }
    setPendingLeave(() => action);
  }, [sectionDirty]);

  const requestClose = useCallback(() => guardLeave(onClose), [guardLeave, onClose]);

  const keepEditing = useCallback(() => setPendingLeave(null), []);
  const discardAndLeave = useCallback(() => {
    const action = pendingLeave;
    setPendingLeave(null);
    discardSectionDrafts();
    setResourceDraftDirty(false);
    action?.();
  }, [discardSectionDrafts, pendingLeave]);
  return { pendingLeave, keepEditing, discardAndLeave, guardLeave, requestClose, setResourceDraftDirty };
}
