import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { useDynStyle } from '../../lib/useDynStyle';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useEffectiveCatalogStore } from '../../stores/effectiveCatalogStore';
import { readCompiledComposerRoute } from '../../lib/composerEffectiveModel';
import { useComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';
import { Button } from '../../ui/Button';
import { InlineError } from '../../ui/InlineError';
import { filterComposerPickerOptions } from './composerModelPicker';
import {
  resolveComposerAgentDefaultState,
  type ComposerAgentDefaultState,
} from './composerAgentDefaultModel';
import { clearComposerModelChoice, commitComposerModelChoice } from './sessionModelOverride';
import { useComposerModelPickerOptions } from './useComposerModelPickerOptions';
import { ComposerModelList } from './ComposerModelPickerList';
import type { SessionRecord } from '@shared/types/session';
import type { ComposerModelSaveState } from './ComposerModelEffortControl';

function formatAgentDefaultMeta(
  state: ComposerAgentDefaultState,
  agentName: string,
  t: (key: 'composer.model.agentDefaultUnset' | 'composer.model.agentDefaultUnavailable') => string,
): string {
  if (state.kind === 'unset') return t('composer.model.agentDefaultUnset');
  if (state.kind === 'unavailable') return t('composer.model.agentDefaultUnavailable');
  if (state.kind === 'available') {
    return `${agentName} · ${state.providerLabel} / ${state.modelLabel}`;
  }
  return `${agentName} · ${state.providerId} / ${state.modelId}`;
}

export const ComposerModelPickerPanel: React.FC<{
  agentId: string;
  currentSession: SessionRecord | null;
  popupRef: React.RefObject<HTMLDivElement>;
  popupShiftPx: number;
  onChosen: () => void;
  onSaveStateChange?: (state: ComposerModelSaveState) => void;
}> = ({ agentId, currentSession, popupRef, popupShiftPx, onChosen, onSaveStateChange }) => {
  const { t } = useI18n();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const providers = useAppSettingsStore((state) => state.settings.llm.providers);
  useEffect(() => {
    for (const provider of providers.filter(entry => entry.enabled && entry.isConfigured)) {
      void useEffectiveCatalogStore.getState().load(provider, false, true);
    }
  }, [providers]);
  const agentRoute = useAppSettingsStore((state) => readCompiledComposerRoute(state.settings, agentId));
  const agentName = useAppSettingsStore((state) => (
    state.settings.agents.definitions.find((entry) => entry.id === agentId)?.name || agentId
  ));
  const { options, providerStates, loading, retry } = useComposerModelPickerOptions(providers);
  const { effective, hasChoice, projectId } = useComposerEffectiveModel(agentId, currentSession);
  const agentDefault = resolveComposerAgentDefaultState(agentRoute, options, !loading);
  const agentDefaultMeta = formatAgentDefaultMeta(agentDefault, agentName, t);
  const agentDefaultTitle = agentDefault.kind === 'unavailable' && agentDefault.providerId && agentDefault.modelId
    ? `${agentDefault.providerId} / ${agentDefault.modelId}`
    : t('composer.model.agentDefaultTitle', { name: agentName });
  // One section per connected provider, in settings order: its matching models plus, when it has one,
  // the provider's own loading / refresh-failed / empty notice, so a failure sits next to what it affects.
  const sections = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return providerStates.flatMap((state) => {
      const models = filterComposerPickerOptions(state.models, query);
      const providerMatches = !normalized || `${state.id} ${state.label}`.toLowerCase().includes(normalized);
      if (models.length === 0 && !(state.notice && providerMatches)) return [];
      return [{ ...state, models }];
    });
  }, [providerStates, query]);
  const popupDynStyle = useDynStyle({
    '--composer-effort-popup-shift-x': `${popupShiftPx}px`,
  });

  useEffect(() => {
    window.requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
  }, []);

  // One save at a time; the menu closes only once main has the choice.
  const save = async (write: () => ReturnType<typeof clearComposerModelChoice>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveError('');
    setSaving(true);
    onSaveStateChange?.({ saving: true });
    const result = await write();
    savingRef.current = false;
    onSaveStateChange?.({ saving: false, error: result.ok ? undefined : t('composer.model.saveFailed') });
    if (!mounted.current) return;
    setSaving(false);
    if (!result.ok) {
      setSaveError(t('composer.model.saveFailed'));
      return;
    }
    onChosen();
  };
  const selectModel = (next: { providerId: string; modelId: string }) => save(() => commitComposerModelChoice(
    next,
    currentSession?.sessionId,
    projectId,
  ));
  const selectAgentDefault = async () => {
    if (!agentDefault.selectable) return;
    await save(() => clearComposerModelChoice(currentSession?.sessionId, projectId));
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'),
    );
    if (items.length === 0) return;
    if (event.key === 'ArrowDown' && event.target === searchRef.current) {
      event.preventDefault();
      items[0]?.focus({ preventScroll: true });
      return;
    }
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let targetIndex: number | null = null;
    if (event.key === 'ArrowDown') {
      targetIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      targetIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      targetIndex = 0;
    } else if (event.key === 'End') {
      targetIndex = items.length - 1;
    }
    if (targetIndex != null) {
      event.preventDefault();
      items[targetIndex]?.focus({ preventScroll: true });
    }
  };

  return (
    <div
      ref={popupRef}
      className="composer-model-effort-popup is-picker"
      data-testid="composer-model-popup"
      data-option-count={options.length}
      aria-busy={saving}
      data-loading={loading ? '1' : '0'}
      role="menu"
      onKeyDown={handleMenuKeyDown}
      {...popupDynStyle}
    >
      <div className="composer-model-head">
        <input
          ref={searchRef}
          type="search"
          className="composer-model-search"
          data-testid="composer-model-search"
          value={query}
          placeholder={t('composer.model.searchPlaceholder')}
          aria-label={t('composer.model.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button variant="ghost" size="sm"
          type="button"
          className={`composer-model-item composer-model-default${hasChoice ? '' : ' is-selected'}`}
          data-testid="composer-model-agent-default"
          role="menuitemradio"
          aria-checked={!hasChoice}
          data-tooltip={agentDefaultTitle}
          disabled={saving || !agentDefault.selectable}
          onClick={() => void selectAgentDefault()}
        >
          <span className="composer-model-item-label">{t('composer.model.agentDefault')}</span>
          <span className="composer-model-item-meta">{agentDefaultMeta}</span>
        </Button>
        {saving ? <p className="composer-model-empty" role="status">{t('settings.saving')}</p> : null}
        {saveError ? <InlineError>{saveError}</InlineError> : null}
      </div>
      <ComposerModelList sections={sections} loading={loading} effective={effective} saving={saving}
        onSelect={(choice) => void selectModel(choice)} onRetry={retry} />
    </div>
  );
};
