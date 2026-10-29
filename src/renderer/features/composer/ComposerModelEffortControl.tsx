import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionRecord } from '@shared/types/session';
import { useI18n } from '../../i18n';
import { useComposerTurnControls } from './ComposerTurnControlsContext';
import { EFFORT_LABEL_KEYS } from './effortControlParts';
import type { PreparedTurnContextSummary } from '@shared/types/session';
import { Icon } from '../../ui/Icon';
import { Pill } from '../../ui/Pill';
import { OverflowFade } from '../../ui/OverflowFade';
import { useComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
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

export interface ComposerModelSaveState { saving: boolean; error?: string; retry?: () => void }

export const ComposerModelEffortControl: React.FC<{
  agentId: string;
  currentSession: SessionRecord | null;
  disabled?: boolean;
  showAgentDefault?: boolean;
  prepared?: PreparedTurnContextSummary | null;
  preparing?: boolean;
  onSaveStateChange?: (state: ComposerModelSaveState) => void;
}> = ({ agentId, currentSession, disabled = false, showAgentDefault = false, onSaveStateChange, prepared, preparing = false }) => {
  const { t } = useI18n();
  const controlsState = useComposerTurnControls();
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
  }, []);
  const effort = useComposerEffortControl({
    open,
    disabled,
    menuRef,
    popupRef,
  });
  const controlSaveError = controlsState.saveState.error ? t('composer.model.saveFailed') : undefined;
  useEffect(() => {
    onSaveStateChange?.({ saving: saveState.saving || controlsState.saveState.saving,
      error: saveState.error || controlSaveError,
      retry: controlsState.saveState.error ? controlsState.retrySave : undefined });
  }, [saveState, controlsState.saveState, controlsState.retrySave, controlSaveError, onSaveStateChange]);
  const { options, loading } = useComposerModelPickerOptions(
    useAppSettingsStore((state) => state.settings.llm.providers),
  );
  const { effective, hasChoice } = useComposerEffectiveModel(agentId, currentSession);
  const frozen = disabled ? prepared : null;
  const selected = frozen ? { providerId: frozen.route.providerId, modelId: frozen.route.effectiveModelId } : effective;
  const unavailable = !frozen && controlsState.capabilityState.status === 'unavailable';
  const waiting = disabled && preparing && !frozen;
  const agentDefault = showAgentDefault && !hasChoice && !unavailable && !waiting;
  const capsuleLabel = agentDefault ? t('composer.model.agentDefault') : undefined;
  const currentOption = options.find((option) => (
    option.providerId === selected?.providerId && option.modelId === selected?.modelId
  ));
  const modelLabel = waiting ? t('composer.model.preparing') : unavailable ? t('composer.model.unavailable')
    : currentOption?.label || (frozen ? selected?.modelId : undefined) || t('settings.selectModelPlaceholder');
  const displayedControls = frozen?.controls ?? effort.turnControls;
  const displayedEffort = frozen ? t(EFFORT_LABEL_KEYS[displayedControls.reasoningLevel]) : effort.effortLabel;
  const capsule = buildModelEffortCapsulePresentation({
    modelLabel,
    reasoningLabel: t('composer.effort.reasoningValue', { level: displayedEffort }),
    maxContextMode: !waiting && !unavailable && displayedControls.maxContextMode,
    maxContextLabel: t('composer.effort.maxContext'),
    fastModel: !waiting && !unavailable && displayedControls.fastModel,
    fastModelLabel: t('composer.effort.fastModel'),
  });
  const title = capsuleLabel ?? (waiting || unavailable ? modelLabel : capsule.title);
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
        disabled={disabled || saveState.saving || controlsState.saveState.saving}
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
        {!agentDefault && !waiting && !unavailable ? <span className="composer-model-effort-pill-level" title={capsule.reasoningLabel}>{displayedEffort}</span> : null}
        <span className="composer-model-effort-pill-caret" aria-hidden="true"><ChevronIcon /></span>
      </Pill>

      {open && activeView === 'effort' ? (
        <ComposerModelEffortPanel
          popupRef={popupRef}
          popupShiftPx={effort.popupShift}
          trackRef={effort.trackRef}
          modelLabel={loading && !currentOption && !effective ? t('composer.model.loading') : modelLabel}
          onOpenModels={() => setView(nextComposerModelEffortView(view, 'open-models'))}
          capabilityStateDetail={controlsState.saveState.error ? t('composer.model.saveFailed') : effort.capabilityStateDetail}
          capabilityRefreshing={effort.capabilityRefreshing}
          capabilityRetryLabel={controlsState.saveState.error ? t('composer.model.retrySave') : effort.capabilityRetryLabel}
          onRetryCapability={controlsState.saveState.error ? controlsState.retrySave : effort.retryCapability}
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
