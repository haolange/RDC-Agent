import React from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import type { TranslationKey } from '../../i18n';
import { useDynStyle } from '../../lib/useDynStyle';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { EFFORT_LABEL_KEYS, EffortModeIconButton, getStopPosition } from './effortControlParts';
import { EFFORT_THUMB_WIDTH_PX, thumbInsetPercent } from './effortSliderGeometry';
import type { MaxVisualTimeline } from './maxVisual';
import type { ExitingMaxPhase } from './useMaxVisualController';
import { EffortMaxField } from './EffortMaxField';

const EffortSliderStop: React.FC<{
  level: ReasoningSelection;
  isCurrent: boolean;
  leftPercent: number;
}> = ({ level, isCurrent, leftPercent }) => {
  const dynStyle = useDynStyle({ left: `${leftPercent}%` });
  return (
    <div
      className={`composer-effort-slider-stop${isCurrent ? ' is-current' : ''}`}
      data-effort-level={level}
      {...dynStyle}
    />
  );
};

export const ComposerModelEffortPanel: React.FC<{
  popupRef: React.RefObject<HTMLDivElement>;
  popupShiftPx: number;
  trackRef: React.RefObject<HTMLDivElement>;
  modelLabel: string;
  onOpenModels: () => void;
  capabilityStateDetail?: string;
  capabilityRefreshing: boolean;
  capabilityRetryLabel: string;
  onRetryCapability: () => void;
  hasAdjustableReasoning: boolean;
  displayLevel: ReasoningSelection;
  displayLevels: ReasoningSelection[];
  displayIndex: number;
  isDragging: boolean;
  showMaxTrack: boolean;
  exitingMaxPhase: ExitingMaxPhase;
  maxTimeline: MaxVisualTimeline;
  thumbRatio: number;
  thumbPercent: number;
  tooltipLeftPercent: number;
  tooltipLabel: string;
  trackWidthPx: number;
  positionTransitionsReady: boolean;
  maxContextAvailable: boolean;
  maxContextStatusLabel?: string;
  fastModelAvailable: boolean;
  fastModelStatusLabel?: string;
  maxContextMode: boolean;
  fastModel: boolean;
  t: (key: TranslationKey) => string;
  onTrackPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onTrackPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onTrackPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onTrackClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onThumbKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onToggleMaxContext: () => void;
  onToggleFastModel: () => void;
  onMaxTimelineComplete: (revision: number) => void;
}> = ({
  popupRef,
  popupShiftPx,
  trackRef,
  modelLabel,
  onOpenModels,
  capabilityStateDetail,
  capabilityRefreshing,
  capabilityRetryLabel,
  onRetryCapability,
  hasAdjustableReasoning,
  displayLevel,
  displayLevels,
  displayIndex,
  isDragging,
  showMaxTrack,
  exitingMaxPhase,
  maxTimeline,
  thumbRatio,
  thumbPercent,
  tooltipLeftPercent,
  tooltipLabel,
  trackWidthPx,
  positionTransitionsReady,
  maxContextAvailable,
  maxContextStatusLabel,
  fastModelAvailable,
  fastModelStatusLabel,
  maxContextMode,
  fastModel,
  t,
  onTrackPointerDown,
  onTrackPointerMove,
  onTrackPointerUp,
  onTrackClick,
  onThumbKeyDown,
  onToggleMaxContext,
  onToggleFastModel,
  onMaxTimelineComplete,
}) => {
  const popupDynStyle = useDynStyle({
    '--composer-effort-popup-shift-x': `${popupShiftPx}px`,
  });
  const thumbDynStyle = useDynStyle({ left: `${thumbPercent}%` });
  const tooltipDynStyle = useDynStyle({ left: `${tooltipLeftPercent}%` });
  const reasoningLabel = hasAdjustableReasoning
    ? t(EFFORT_LABEL_KEYS[displayLevel])
    : t('composer.effort.levelOff');

  return (
    <div
      ref={popupRef}
      className="composer-model-effort-popup"
      data-testid="composer-model-effort-popup"
      role="dialog"
      aria-label={t('composer.effort.popupTitle')}
      {...popupDynStyle}
    >
      <div className="composer-model-effort-panel-head">
        <EffortModeIconButton
          mode="fast"
          data-testid="composer-model-effort-fast-mode"
          label={t('composer.effort.fastModel')}
          statusLabel={fastModelStatusLabel}
          available={fastModelAvailable}
          active={fastModel}
          onToggle={onToggleFastModel}
        >
          <Icon name="lightning" size={16} />
        </EffortModeIconButton>
        <div className="composer-model-effort-identity">
          <span className="composer-model-effort-level">{reasoningLabel}</span>
          <button
            type="button"
            className="composer-model-effort-model"
            data-testid="composer-model-effort-open-picker"
            aria-label={t('composer.model.openPicker')}
            title={modelLabel}
            onClick={onOpenModels}
          >
            <span>{modelLabel}</span>
            <Icon name="chevron-right" size={12} />
          </button>
          {capabilityStateDetail ? (
            <Button variant="ghost" size="sm" onClick={onRetryCapability}>
              {capabilityRetryLabel}
            </Button>
          ) : null}
          {capabilityRefreshing ? (
            <span className="composer-model-effort-refreshing" role="status">
              {t('composer.effort.capabilityRefreshing')}
            </span>
          ) : null}
        </div>
        <EffortModeIconButton
          mode="max-context"
          data-testid="composer-model-effort-max-mode"
          label={t('composer.effort.maxContext')}
          statusLabel={maxContextStatusLabel}
          available={maxContextAvailable}
          active={maxContextMode}
          onToggle={onToggleMaxContext}
        >
          <Icon name="max-mode" size={16} />
        </EffortModeIconButton>
      </div>

      <div className={`composer-effort-slider-section ${hasAdjustableReasoning ? '' : 'is-disabled'}`}>
        <div
          ref={trackRef}
          className={`composer-effort-slider is-level-${displayLevel}${hasAdjustableReasoning ? '' : ' is-disabled'}${isDragging ? ' is-dragging' : ''}${showMaxTrack ? ' is-max-visual' : ''}${exitingMaxPhase !== 'off' ? ` is-exiting-max is-exiting-max-${exitingMaxPhase}` : ''}${positionTransitionsReady ? '' : ' is-layout-stabilizing'} is-max-phase-${maxTimeline.phase}`}
          data-testid="composer-effort-slider"
          data-exiting-max={exitingMaxPhase}
          data-max-phase={maxTimeline.phase}
          data-max-progress="0.000"
          data-max-stops-opacity={maxTimeline.fromStopsOpacity.toFixed(3)}
          data-max-emitter-ratio={thumbRatio.toFixed(3)}
          data-max-field-energy={maxTimeline.fromEnergy.toFixed(3)}
          data-max-clip-ratio={thumbRatio.toFixed(3)}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={onTrackPointerUp}
          onClick={onTrackClick}
        >
          {hasAdjustableReasoning ? (
            <div className="composer-effort-slider-stops" aria-hidden="true">
              {displayLevels.map((level, index) => (
                <EffortSliderStop
                  key={level}
                  level={level}
                  isCurrent={level === displayLevel}
                  leftPercent={thumbInsetPercent(
                    getStopPosition(index, displayLevels.length),
                    trackWidthPx,
                    EFFORT_THUMB_WIDTH_PX,
                  )}
                />
              ))}
            </div>
          ) : null}

          <div className="composer-effort-slider-track" aria-hidden="true" />

          <EffortMaxField
            timeline={maxTimeline}
            thumbRatio={thumbRatio}
            onTimelineComplete={onMaxTimelineComplete}
          />

          <div
            className={`composer-effort-slider-thumb${isDragging ? ' is-dragging' : ''}`}
            {...thumbDynStyle}
            role="slider"
            tabIndex={hasAdjustableReasoning ? 0 : -1}
            aria-valuemin={0}
            aria-valuemax={displayLevels.length - 1}
            aria-valuenow={displayIndex}
            aria-valuetext={reasoningLabel}
            aria-disabled={!hasAdjustableReasoning}
            onKeyDown={onThumbKeyDown}
          />

          {isDragging ? (
            <span className="composer-effort-slider-tooltip" {...tooltipDynStyle}>
              {tooltipLabel}
            </span>
          ) : null}
        </div>

        <div className="composer-effort-slider-labels" aria-hidden="true">
          <span>{t('composer.effort.faster')}</span>
          <span>{t('composer.effort.smarter')}</span>
        </div>
      </div>
    </div>
  );
};
