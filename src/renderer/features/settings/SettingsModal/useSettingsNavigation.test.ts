// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../stores/defaultAppSettings';
import { useSettingsNavigation } from './useSettingsNavigation';

describe('settings manual draft leave protection', () => {
  it('keeps edits when cancelled and restores owned drafts before accepting close', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div'); const root = createRoot(host);
    const close = vi.fn();
    const modal = {
      activeSection: 'general' as const,
      dirty: { profile: true, personalization: false, tools: false },
      setAccountDraft: vi.fn(), setGlobalInstructionsDraft: vi.fn(),
      setRdcCliDraft: vi.fn(), setCodeInterpreterDraft: vi.fn(), setShellDraft: vi.fn(),
    };
    let navigation!: ReturnType<typeof useSettingsNavigation>;
    function Probe() { navigation = useSettingsNavigation(modal, DEFAULT_SETTINGS, close); return null; }
    try {
      act(() => root.render(createElement(Probe)));
      act(() => navigation.requestClose());
      expect(navigation.pendingLeave).not.toBeNull(); expect(close).not.toHaveBeenCalled();
      act(() => navigation.keepEditing());
      expect(navigation.pendingLeave).toBeNull(); expect(modal.setAccountDraft).not.toHaveBeenCalled();
      act(() => navigation.requestClose());
      act(() => navigation.discardAndLeave());
      expect(modal.setAccountDraft).toHaveBeenCalledWith(DEFAULT_SETTINGS.profile);
      expect(modal.setGlobalInstructionsDraft).toHaveBeenCalledWith(DEFAULT_SETTINGS.agents.globalInstructions);
      expect(modal.setRdcCliDraft).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
    } finally { act(() => root.unmount()); }
  });
});
