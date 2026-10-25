import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionRecord } from '@shared/types/session';
import { useI18n } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { Pill } from '../../ui/Pill';
import { OverflowFade } from '../../ui/OverflowFade';
import { useComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { readCompiledComposerRoute } from '../../lib/composerEffectiveModel';
import { useComposerMenu } from './useComposerMenuRegistry';
import { useComposerModelPickerOptions } from './useComposerModelPickerOptions';
import { buildModelEffortCapsulePresentation, ChevronIcon } from './effortControlParts';
import { useComposerEffortControl } from './useComposerEffortControl';
import { ComposerModelEffortPanel } from './ComposerModelEffortPanel';
import { ComposerModelPickerPanel } from './ComposerModelPickerPanel';
import {
  nextComposerModelEffortView,
  type ComposerModelEffortView,
} from './composerModelEffortView';

export interface ComposerModelSaveState { saving: boolean; error?: string }

export const ComposerModelEffortControl: React.FC<{
  agentId: string;
  currentSession: SessionRecord | null;
  disabled?: boolean;
  showAgentDefault?: boolean;
  onSaveStateChange?: (state: ComposerModelSaveState) => void;
}> = ({ agentId, currentSession, disabled = false, showAgentDefault = false, onSaveStateChange }) => {
  const { t } = useI18n();
  const menu = useComposerMenu('modelEffort');
  const open = menu.open;
  const [view, setView] = useState<ComposerModelEffortView>('effort');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const previousViewRef = useRef(view);
  const [saveState, setSaveState] = useState<ComposerModelSaveState>({ saving: false });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const handleSaveState = useCallback((state: ComposerModelSaveState) => {
    if (!mounted.current) return;
    setSaveState(state);
    onSaveStateChange?.(state);
  }, [onSaveStateChange]);
  const effort = useComposerEffortControl({
    open,
    disabled,
    menuRef,
    popupRef,
  });
  const agentRoute = useAppSettingsStore((state) => readCompiledComposerRoute(state.settings, agentId));
  const { options, loading } = useComposerModelPickerOptions(
    useAppSettingsStore((state) => state.settings.llm.providers),
    agentRoute?.providerId,
  );
  const { effective, hasChoice } = useComposerEffectiveModel(agentId, currentSession);
  const agentDefault = showAgentDefault && !hasChoice;
  const capsuleLabel = agentDefault ? t('composer.model.agentDefault') : undefined;
  const currentOption = options.find((option) => (
    option.providerId === effective?.providerId && option.modelId === effective?.modelId
  ));
  const modelLabel = currentOption?.label || effective?.modelId || t('settings.selectModelPlaceholder');
  const capsule = buildModelEffortCapsulePresentation({
    modelLabel,
    reasoningLabel: effort.effortLabel,
    maxContextMode: effort.turnControls.maxContextMode,
    maxContextLabel: t('composer.effort.maxContext'),
    fastModel: effort.turnControls.fastModel,
    fastModelLabel: t('composer.effort.fastModel'),
  });
  const title = capsuleLabel ?? capsule.title;
  const activeView = agentDefault ? 'models' : view;

  const assignMenuRoot = useCallback((node: HTMLDivElement | null) => {
    menuRef.current = node;
    menu.setRoot(node);
  }, [menu]);
  const assignMenuTrigger = useCallback((node: HTMLButtonElement | null) => {
    menu.setTrigger(node);
  }, [menu]);

  useEffect(() => {
    if (!open) setView((current) => nextComposerModelEffortView(current, 'menu-closed'));
  }, [open]);

  useEffect(() => {
    const previous = previousViewRef.current;
    previousViewRef.current = view;
    if (open && previous === 'models' && view === 'effort') {
      popupRef.current?.querySelector<HTMLButtonElement>('[data-testid="composer-model-effort-open-picker"]')?.focus({ preventScroll: true });
    }
  }, [open, view]);

  useEffect(() => {
    if (!open || view !== 'models') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setView((current) => nextComposerModelEffortView(current, 'escape'));
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, view]);

  return (
    <div ref={assignMenuRoot} className="composer-model-effort-menu">
      <Pill
        ref={assignMenuTrigger}
        className={`composer-model-effort-pill ${open ? 'is-open' : ''}${hasChoice ? ' is-override' : ''}${!agentDefault && effort.selectedLevel === 'max' ? ' is-level-max' : ''}`}
        selected={open}
        data-testid="composer-model-effort-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        aria-label={title}
        disabled={disabled || saveState.saving}
        onClick={() => menu.toggle()}
      >
        {!agentDefault && capsule.showFast ? (
          <span className="composer-model-effort-pill-mode" data-mode="fast" aria-hidden="true">
            <Icon name="lightning" size={14} />
          </span>
        ) : null}
        {!agentDefault && capsule.showMax ? (
          <span className="composer-model-effort-pill-mode" data-mode="max-context" aria-hidden="true">
            <Icon name="max-mode" size={14} />
          </span>
        ) : null}
        <OverflowFade className="composer-model-effort-pill-model" text={capsuleLabel ?? capsule.modelLabel} />
        {!agentDefault ? <span className="composer-model-effort-pill-level">{capsule.reasoningLabel}</span> : null}
        <span className="composer-model-effort-pill-caret" aria-hidden="true"><ChevronIcon /></span>
      </Pill>

      {open && activeView === 'effort' ? (
        <ComposerModelEffortPanel
          popupRef={popupRef}
          popupShiftPx={effort.popupShift}
          trackRef={effort.trackRef}
          modelLabel={loading && !currentOption && !effective ? t('composer.model.loading') : modelLabel}
          onOpenModels={() => setView(nextComposerModelEffortView(view, 'open-models'))}
          capabilityStateDetail={effort.capabilityStateDetail}
          capabilityRefreshing={effort.capabilityRefreshing}
          capabilityRetryLabel={effort.capabilityRetryLabel}
          onRetryCapability={effort.retryCapability}
          hasAdjustableReasoning={effort.hasAdjustableReasoning}
          displayLevel={effort.displayLevel}
          displayLevels={effort.displayLevels}
          displayIndex={effort.displayIndex}
          isDragging={effort.isDragging}
          showMaxTrack={effort.showMaxTrack}
          exitingMaxPhase={effort.exitingMaxPhase}
          maxTimeline={effort.maxTimeline}
          thumbRatio={effort.thumbRatio}
          thumbPercent={effort.thumbPercent}
          tooltipLeftPercent={effort.tooltipLeftPercent}
          tooltipLabel={effort.tooltipLabel}
          trackWidthPx={effort.trackWidthPx}
          positionTransitionsReady={effort.positionTransitionsReady}
          maxContextAvailable={effort.maxContextAvailable}
          maxContextStatusLabel={effort.maxContextStatusLabel}
          fastModelAvailable={effort.fastAvailable}
          fastModelStatusLabel={effort.fastModelStatusLabel}
          maxContextMode={effort.turnControls.maxContextMode}
          fastModel={effort.turnControls.fastModel}
          t={t}
          onTrackPointerDown={effort.sliderHandlers.handleTrackPointerDown}
          onTrackPointerMove={effort.sliderHandlers.handleTrackPointerMove}
          onTrackPointerUp={effort.sliderHandlers.handleTrackPointerUp}
          onTrackClick={effort.sliderHandlers.handleTrackClick}
          onThumbKeyDown={effort.sliderHandlers.handleThumbKeyDown}
          onToggleMaxContext={effort.toggleMaxContext}
          onToggleFastModel={effort.toggleFastModel}
          onMaxTimelineComplete={effort.completeMaxTimeline}
        />
      ) : null}

      {open && activeView === 'models' ? (
        <ComposerModelPickerPanel
          agentId={agentId}
          currentSession={currentSession}
          popupRef={popupRef}
          popupShiftPx={effort.popupShift}
          onChosen={(chosenDefault) => {
            if (chosenDefault && showAgentDefault) menu.close();
            else setView(nextComposerModelEffortView(view, 'chosen'));
          }}
          onSaveStateChange={handleSaveState}
          agentDefaultLabelOnly={showAgentDefault}
        />
      ) : null}
    </div>
  );
};
