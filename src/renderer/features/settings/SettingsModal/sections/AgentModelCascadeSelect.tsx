import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentModelOption } from '@shared/types/agentManifest';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentModelCascadeSelectProps {
  value: string;
  options: AgentModelOption[];
  onChange: (value: string) => void;
  t: Translate;
}

export const isAgentModelSelectionInvalid = (
  value: string,
  options: AgentModelOption[],
): boolean => Boolean(value && !options.some((option) => option.canonicalId === value));

export const agentModelOptionAccessibleLabel = (
  option: AgentModelOption,
  unavailableLabel: string,
): string => [
  option.modelLabel,
  option.canonicalId,
  ...(!option.configured ? [option.disabledReason ?? unavailableLabel] : []),
].join(' · ');

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
      .filter((group) => group.options.some((option) => option.configured || option.canonicalId === value));
  }, [options, value]);
  const selected = options.find((option) => option.canonicalId === value);
  const invalidSelection = isAgentModelSelectionInvalid(value, options);
  const displayGroups = groups;
  const resolvedActiveProviderId = displayGroups.some((group) => group.providerId === activeProviderId)
    ? activeProviderId
    : selected?.providerId && displayGroups.some((group) => group.providerId === selected.providerId)
      ? selected.providerId
      : displayGroups[0]?.providerId ?? '';
  const activeGroup = displayGroups.find((group) => group.providerId === resolvedActiveProviderId) ?? displayGroups[0];

  const updateMenuPlacement = useCallback(() => {
    const root = rootRef.current;
    const rect = root?.getBoundingClientRect();
    if (!root || !rect) {
      return;
    }
    const modalRect = root.closest('.settings-modal')?.getBoundingClientRect();
    const viewportPadding = 16;
    const menuGap = 8;
    // Prefer a taller popover so provider/model lists need less scrolling; still clamp to the modal.
    const preferredMaxHeight = Math.min(560, Math.floor(window.innerHeight * 0.62));
    const boundaryLeft = Math.max(viewportPadding, modalRect?.left ?? viewportPadding);
    const boundaryRight = Math.min(window.innerWidth - viewportPadding, modalRect?.right ?? window.innerWidth - viewportPadding);
    const boundaryTop = Math.max(viewportPadding, modalRect?.top ?? viewportPadding);
    // Use the modal/viewport floor for height — do not shrink to the autosave strip.
    const boundaryBottom = Math.min(
      window.innerHeight - viewportPadding,
      modalRect?.bottom ?? window.innerHeight - viewportPadding,
    );
    const availableLeft = boundaryLeft + menuGap;
    const availableRight = boundaryRight - menuGap;
    const menuWidth = Math.max(0, Math.min(544, availableRight - availableLeft));
    const preferredHeight = Math.max(48, Math.min(preferredMaxHeight, boundaryBottom - boundaryTop));
    const spaceBelow = Math.max(0, boundaryBottom - rect.bottom - menuGap);
    const spaceAbove = Math.max(0, rect.top - boundaryTop - menuGap);
    const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(48, Math.min(preferredHeight, placeAbove ? spaceAbove : spaceBelow));
    const left = Math.min(
      Math.max(availableLeft, rect.left),
      Math.max(availableLeft, availableRight - menuWidth),
    );
    const top = placeAbove
      ? Math.max(boundaryTop, rect.top - menuGap - availableHeight)
      : Math.min(rect.bottom + menuGap, Math.max(boundaryTop, boundaryBottom - availableHeight));

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
          return selected?.providerId && displayGroups.some((group) => group.providerId === selected.providerId)
            ? selected.providerId
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
        aria-invalid={invalidSelection}
        onClick={toggleOpen}
      >
        <span>{selected ? selected.providerLabel : t('settings.selectProviderPlaceholder')}</span>
        <strong>{selected ? selected.modelLabel : t('settings.selectModelPlaceholder')}</strong>
      </button>
      {invalidSelection ? (
        <small className="settings-model-cascade-invalid" data-testid="settings-agent-model-invalid">
          {t('settings.routeReasonModelInvalid')}: {value}
        </small>
      ) : null}
      <div className="settings-model-cascade-menu" role="listbox">
        <div className="settings-model-provider-list scrollbar-thin">
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
        <div className="settings-model-submenu scrollbar-thin">
          {activeGroup?.options.map((option) => {
            const accessibleLabel = agentModelOptionAccessibleLabel(option, t('settings.modelUnavailable'));
            return (
              <button
                key={option.canonicalId}
                type="button"
                className={`settings-model-option ${option.canonicalId === value ? 'active' : ''}`}
                data-provider-id={option.providerId}
                data-model-id={option.modelId}
                data-canonical-id={option.canonicalId}
                disabled={!option.configured}
                role="option"
                aria-label={accessibleLabel}
                aria-selected={option.canonicalId === value}
                title={accessibleLabel}
                onClick={() => {
                  onChange(option.canonicalId);
                  setOpen(false);
                }}
              >
                <span>{option.modelLabel}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
