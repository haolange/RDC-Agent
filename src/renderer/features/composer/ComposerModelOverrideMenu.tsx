import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionRecord } from '@shared/types/session';
import { useI18n } from '../../i18n';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useComposerMenu } from './useComposerMenuRegistry';
import {
  filterComposerPickerOptions,
  groupComposerPickerOptions,
} from './composerModelPicker';
import {
  resolveComposerAgentDefaultState,
  type ComposerAgentDefaultState,
} from './composerAgentDefaultModel';
import { clearComposerModelChoice, commitComposerModelChoice } from './sessionModelOverride';
import { readCompiledComposerRoute } from '../../lib/composerEffectiveModel';
import { useComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';
import { useComposerModelPickerOptions } from './useComposerModelPickerOptions';

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

export const ComposerModelOverrideMenu: React.FC<{
  agentId: string;
  currentSession: SessionRecord | null;
}> = ({ agentId, currentSession }) => {
  const { t } = useI18n();
  const menu = useComposerMenu('model');
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [saveError, setSaveError] = useState('');
  const providers = useAppSettingsStore((state) => state.settings.llm.providers);
  const agentRoute = useAppSettingsStore((state) => readCompiledComposerRoute(state.settings, agentId));
  const agentName = useAppSettingsStore((state) => (
    state.settings.agents.definitions.find((entry) => entry.id === agentId)?.name || agentId
  ));
  const { options, loading } = useComposerModelPickerOptions(providers, agentRoute?.providerId);
  const { effective, hasChoice, projectId } = useComposerEffectiveModel(agentId, currentSession);
  const agentDefault = resolveComposerAgentDefaultState(agentRoute, options, !loading);
  const agentDefaultMeta = formatAgentDefaultMeta(agentDefault, agentName, t);
  const agentDefaultTitle = agentDefault.kind === 'unavailable' && agentDefault.providerId && agentDefault.modelId
    ? `${agentDefault.providerId} / ${agentDefault.modelId}`
    : t('composer.model.agentDefaultTitle', { name: agentName });
  const currentOption = options.find((option) => (
    option.providerId === effective?.providerId && option.modelId === effective?.modelId
  ));
  const pillLabel = currentOption?.label || effective?.modelId || t('settings.selectModelPlaceholder');
  const filtered = useMemo(
    () => filterComposerPickerOptions(options, query),
    [options, query],
  );
  const groups = useMemo(() => groupComposerPickerOptions(filtered), [filtered]);
  const assignRoot = useCallback((node: HTMLDivElement | null) => {
    menu.setRoot(node);
  }, [menu]);
  const assignTrigger = useCallback((node: HTMLButtonElement | null) => {
    menu.setTrigger(node);
  }, [menu]);

  useEffect(() => {
    if (!menu.open) {
      setQuery('');
      setSaveError('');
      return;
    }
    window.requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
  }, [menu.open]);

  const selectModel = async (next: { providerId: string; modelId: string }) => {
    setSaveError('');
    const result = await commitComposerModelChoice(
      next,
      currentSession?.sessionId,
      projectId,
    );
    if (!result.ok) {
      setSaveError(t('composer.model.saveFailed'));
      return;
    }
    menu.close();
  };

  const selectAgentDefault = async () => {
    if (!agentDefault.selectable) return;
    setSaveError('');
    const result = await clearComposerModelChoice(currentSession?.sessionId, projectId);
    if (!result.ok) {
      setSaveError(t('composer.model.saveFailed'));
      return;
    }
    menu.close();
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
    <div ref={assignRoot} className="composer-model-menu">
      <button
        ref={assignTrigger}
        type="button"
        className={`composer-model-pill ${menu.open ? 'open' : ''}${hasChoice ? ' is-override' : ''}`}
        data-testid="composer-model-pill"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        title={pillLabel}
        onClick={() => menu.toggle()}
      >
        <span className="composer-model-pill-label">{pillLabel}</span>
        <span className="composer-model-pill-caret" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {menu.open ? (
        <div
          className="composer-model-popup"
          role="menu"
          data-testid="composer-model-popup"
          data-option-count={options.length}
          data-loading={loading ? '1' : '0'}
          onKeyDown={handleMenuKeyDown}
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
            <button
              type="button"
              className={`composer-model-item composer-model-default${hasChoice ? '' : ' is-selected'}`}
              data-testid="composer-model-agent-default"
              role="menuitemradio"
              aria-checked={!hasChoice}
              title={agentDefaultTitle}
              disabled={!agentDefault.selectable}
              onClick={() => void selectAgentDefault()}
            >
              <span className="composer-model-item-label">{t('composer.model.agentDefault')}</span>
              <span className="composer-model-item-meta">{agentDefaultMeta}</span>
            </button>
            {saveError ? <p className="composer-model-empty">{saveError}</p> : null}
            {loading && groups.length === 0 ? (
              <p className="composer-model-empty">{t('composer.model.loading')}</p>
            ) : groups.length === 0 ? (
              <p className="composer-model-empty">{t('composer.model.empty')}</p>
            ) : null}
          </div>
          {groups.length > 0 ? (
            <div className="composer-model-list">
              {groups.map((group) => (
                <div key={group.providerId} className="composer-model-group">
                  <p className="composer-model-group-label">{group.providerLabel}</p>
                  {group.models.map((option) => {
                    const selected = Boolean(
                      effective
                      && option.providerId === effective.providerId
                      && option.modelId === effective.modelId,
                    );
                    return (
                      <button
                        key={`${option.providerId}:${option.modelId}`}
                        type="button"
                        className={`composer-model-item ${selected ? 'is-selected' : ''}`}
                        data-testid={`composer-model-item-${option.providerId}-${option.modelId}`}
                        role="menuitemradio"
                        aria-checked={selected}
                        onClick={() => void selectModel({
                          providerId: option.providerId,
                          modelId: option.modelId,
                        })}
                      >
                        <span className="composer-model-item-label">{option.label}</span>
                        <span className="composer-model-item-meta">
                          {option.contextWindowLabel
                            ? t('composer.model.contextWindow', {
                              tokens: option.contextWindowLabel,
                            })
                            : null}
                          {option.hasReasoning ? (
                            <span className="composer-model-badge">{t('composer.model.reasoningBadge')}</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
