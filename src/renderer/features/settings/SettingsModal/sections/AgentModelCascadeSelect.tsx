import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentModelOption } from '@shared/types/agentManifest';
import { splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentModelCascadeSelectProps {
  value: string;
  options: AgentModelOption[];
  onChange: (value: string) => void;
  t: Translate;
}

export const AgentModelCascadeSelect: React.FC<AgentModelCascadeSelectProps> = ({
  value,
  options,
  onChange,
  t,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const placementFrameRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState('');
  const groups = useMemo(() => {
    const map = new Map<string, AgentModelOption[]>();
    for (const option of options) {
      const current = map.get(option.providerId) ?? [];
      current.push(option);
      map.set(option.providerId, current);
    }
    return Array.from(map.entries())
      .map(([providerId, providerOptions]) => ({
        providerId,
        label: providerOptions[0]?.providerLabel || providerId,
        options: providerOptions,
      }))
      .filter((group) => group.options.some((option) => option.configured));
  }, [options]);
  const selected = options.find((option) => option.canonicalId === value);
  const missingSelection = useMemo<AgentModelOption | null>(() => {
    if (!value || selected) {
      return null;
    }
    const parsed = splitCanonicalAgentModelId(value);
    if (!parsed) {
      return null;
    }
    return {
      canonicalId: value,
      providerId: parsed.providerId,
      providerLabel: parsed.providerId,
      modelId: parsed.modelId,
      modelLabel: parsed.modelId,
      configured: false,
      status: 'missing',
    };
  }, [selected, value]);
  const visibleSelected = selected ?? missingSelection;
  const displayGroups = useMemo(() => [
    ...(missingSelection
      ? [{
        providerId: missingSelection.providerId,
        label: missingSelection.providerLabel,
        options: [missingSelection],
      }]
      : []),
    ...groups,
  ], [groups, missingSelection]);
  const resolvedActiveProviderId = displayGroups.some((group) => group.providerId === activeProviderId)
    ? activeProviderId
    : visibleSelected?.providerId && displayGroups.some((group) => group.providerId === visibleSelected.providerId)
      ? visibleSelected.providerId
      : displayGroups[0]?.providerId ?? '';
  const activeGroup = displayGroups.find((group) => group.providerId === resolvedActiveProviderId) ?? displayGroups[0];

  const updateMenuPlacement = useCallback(() => {
    const root = rootRef.current;
    const rect = root?.getBoundingClientRect();
    if (!root || !rect) {
      return;
    }
    const modalRect = root.closest('.settings-modal')?.getBoundingClientRect();
    const editorRect = root.closest('.settings-manifest-editor')?.getBoundingClientRect();
    const savebarRect = root.closest('.settings-manifest-editor')?.querySelector('.settings-manifest-editor-savebar')?.getBoundingClientRect();
    const viewportPadding = 16;
    const menuGap = 8;
    const boundaryLeft = Math.max(viewportPadding, modalRect?.left ?? viewportPadding);
    const boundaryRight = Math.min(window.innerWidth - viewportPadding, modalRect?.right ?? window.innerWidth - viewportPadding);
    const boundaryTop = Math.max(viewportPadding, modalRect?.top ?? viewportPadding);
    const boundaryBottom = Math.min(
      window.innerHeight - viewportPadding,
      modalRect?.bottom ?? window.innerHeight - viewportPadding,
      editorRect?.bottom ?? window.innerHeight - viewportPadding,
      savebarRect?.top ?? window.innerHeight - viewportPadding,
    );
    const boundaryWidth = Math.max(280, boundaryRight - boundaryLeft - viewportPadding * 2);
    const menuWidth = Math.min(544, boundaryWidth);
    const preferredHeight = Math.min(368, boundaryBottom - boundaryTop - viewportPadding * 2);
    const spaceBelow = boundaryBottom - rect.bottom - menuGap;
    const availableHeight = Math.max(48, Math.min(preferredHeight, Math.max(0, spaceBelow)));
    const left = Math.min(
      Math.max(boundaryLeft + viewportPadding, rect.left),
      Math.max(boundaryLeft + viewportPadding, boundaryRight - menuWidth - viewportPadding),
    );
    const top = rect.bottom + menuGap;

    root.style.setProperty('--settings-model-menu-left', `${left}px`);
    root.style.setProperty('--settings-model-menu-top', `${top}px`);
    root.style.setProperty('--settings-model-menu-width', `${menuWidth}px`);
    root.style.setProperty('--settings-model-menu-height', `${availableHeight}px`);
  }, []);

  const scheduleMenuPlacement = useCallback(() => {
    if (placementFrameRef.current !== null) {
      return;
    }
    placementFrameRef.current = window.requestAnimationFrame(() => {
      placementFrameRef.current = null;
      updateMenuPlacement();
    });
  }, [updateMenuPlacement]);

  const toggleOpen = () => {
    setOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        updateMenuPlacement();
        setActiveProviderId((currentProviderId) => {
          if (displayGroups.some((group) => group.providerId === currentProviderId)) {
            return currentProviderId;
          }
          return visibleSelected?.providerId && displayGroups.some((group) => group.providerId === visibleSelected.providerId)
            ? visibleSelected.providerId
            : displayGroups[0]?.providerId ?? '';
        });
      }
      return nextOpen;
    });
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    updateMenuPlacement();
    window.addEventListener('resize', scheduleMenuPlacement);
    document.addEventListener('scroll', scheduleMenuPlacement, true);
    return () => {
      window.removeEventListener('resize', scheduleMenuPlacement);
      document.removeEventListener('scroll', scheduleMenuPlacement, true);
      if (placementFrameRef.current !== null) {
        window.cancelAnimationFrame(placementFrameRef.current);
        placementFrameRef.current = null;
      }
    };
  }, [open, scheduleMenuPlacement, updateMenuPlacement]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`settings-model-cascade ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="settings-model-cascade-trigger"
        data-testid="settings-model-cascade-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span>{visibleSelected ? visibleSelected.providerLabel : t('settings.selectProviderPlaceholder')}</span>
        <strong>{visibleSelected ? visibleSelected.modelLabel : t('settings.selectModelPlaceholder')}</strong>
      </button>
      <div className="settings-model-cascade-menu" role="listbox">
        <div className="settings-model-provider-list">
          {displayGroups.map((group) => (
            <button
              key={group.providerId}
              type="button"
              className={`settings-model-provider-trigger ${group.providerId === resolvedActiveProviderId ? 'active' : ''}`}
              data-provider-id={group.providerId}
              onClick={() => setActiveProviderId(group.providerId)}
            >
              <span>{group.label}</span>
              <span>{group.options.filter((option) => option.configured).length}</span>
            </button>
          ))}
        </div>
        <div className="settings-model-submenu">
          {activeGroup?.options.map((option) => (
            <button
              key={option.canonicalId}
              type="button"
              className={`settings-model-option ${option.canonicalId === value ? 'active' : ''}`}
              data-provider-id={option.providerId}
              data-model-id={option.modelId}
              data-canonical-id={option.canonicalId}
              disabled={!option.configured}
              role="option"
              aria-selected={option.canonicalId === value}
              onClick={() => {
                onChange(option.canonicalId);
                setOpen(false);
              }}
            >
              <span>{option.modelLabel}</span>
              <small>
                {option.configured ? option.canonicalId : `${option.canonicalId} / ${t('settings.modelUnavailable')}`}
              </small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
