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

export const ComposerModelEffortControl: React.FC<{
  agentId: string;
  currentSession: SessionRecord | null;
  disabled?: boolean;
}> = ({ agentId, currentSession, disabled = false }) => {
  const { t } = useI18n();
  const menu = useComposerMenu('modelEffort');
  const open = menu.open;
  const [view, setView] = useState<ComposerModelEffortView>('effort');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const effort = useComposerEffortControl({
    agentId,
    currentSession,
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
        className={`composer-model-effort-pill ${open ? 'open' : ''}${hasChoice ? ' is-override' : ''}${effort.selectedLevel === 'max' ? ' is-level-max' : ''}`}
        selected={open}
        data-testid="composer-model-effort-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={capsule.title}
        aria-label={capsule.title}
        onClick={() => menu.toggle()}
      >
        {capsule.showFast ? (
          <span className="composer-model-effort-pill-mode" data-mode="fast" aria-hidden="true">
            <Icon name="lightning" size={14} />
          </span>
        ) : null}
        {capsule.showMax ? (
          <span className="composer-model-effort-pill-mode" data-mode="max-context" aria-hidden="true">
            <Icon name="max-mode" size={14} />
          </span>
        ) : null}
        <OverflowFade className="composer-model-effort-pill-model" text={capsule.modelLabel} />
        <span className="composer-model-effort-pill-level">{capsule.reasoningLabel}</span>
        <span className="composer-model-effort-pill-caret" aria-hidden="true"><ChevronIcon /></span>
      </Pill>

      {open && view === 'effort' ? (
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

      {open && view === 'models' ? (
        <ComposerModelPickerPanel
          agentId={agentId}
          currentSession={currentSession}
          popupRef={popupRef}
          popupShiftPx={effort.popupShift}
          onChosen={() => setView(nextComposerModelEffortView(view, 'chosen'))}
        />
      ) : null}
    </div>
  );
};
