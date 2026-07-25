import React from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import type { TranslationKey } from '../../../i18n';
import { useDynStyle } from '../../../lib/useDynStyle';
import {
  EFFORT_LABEL_KEYS,
  EffortFastModeSwitchRow,
  EffortOneMillionContextSwitchRow,
  getStopPosition,
} from './effortControlParts';
import { EFFORT_THUMB_WIDTH_PX, thumbInsetPercent } from './effortSliderGeometry';
import type { MaxVisualTimeline } from './maxVisual';
import type { ExitingMaxPhase } from './useMaxVisualController';
import { EffortMaxField } from './EffortMaxField';
import { Button } from '../../../ui/Button';

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

export const EffortControlPopup: React.FC<{
  popupRef: React.RefObject<HTMLDivElement>;
  popupShiftPx: number;
  trackRef: React.RefObject<HTMLDivElement>;
  capabilityStateLabel?: string;
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
  oneMillionContextVisible: boolean;
  oneMillionContextAvailable: boolean;
  oneMillionContextStatusLabel?: string;
  fastModelVisible: boolean;
  fastModelAvailable: boolean;
  fastModelStatusLabel?: string;
  oneMillionContextMode: boolean;
  fastModel: boolean;
  t: (key: TranslationKey) => string;
  onTrackPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onTrackPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onTrackPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onTrackClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onThumbKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onToggleOneMillionContext: () => void;
  onToggleFastModel: () => void;
  onMaxTimelineComplete: (revision: number) => void;
}> = ({
  popupRef,
  popupShiftPx,
  trackRef,
  capabilityStateLabel,
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
  oneMillionContextVisible,
  oneMillionContextAvailable,
  oneMillionContextStatusLabel,
  fastModelVisible,
  fastModelAvailable,
  fastModelStatusLabel,
  oneMillionContextMode,
  fastModel,
  t,
  onTrackPointerDown,
  onTrackPointerMove,
  onTrackPointerUp,
  onTrackClick,
  onThumbKeyDown,
  onToggleOneMillionContext,
  onToggleFastModel,
  onMaxTimelineComplete,
}) => {
  const popupDynStyle = useDynStyle({
    '--composer-effort-popup-shift-x': `${popupShiftPx}px`,
  });
  const trackDynStyle = useDynStyle({
    '--composer-effort-stops-opacity': String(maxTimeline.fromStopsOpacity),
  });
  const thumbDynStyle = useDynStyle({ left: `${thumbPercent}%` });
  const tooltipDynStyle = useDynStyle({ left: `${tooltipLeftPercent}%` });

  return (
  <div
    ref={popupRef}
    className="composer-effort-popup"
    data-testid="composer-effort-popup"
    role="dialog"
    aria-label={t('composer.effort.popupTitle')}
    {...popupDynStyle}
  >
    {capabilityStateLabel ? (
      <div className="composer-effort-capability-state" data-testid="composer-effort-capability-state" role="status">
        <div className="composer-effort-capability-state-copy">
          <span>{t('composer.effort.reasoning')}</span>
          <strong>{capabilityStateLabel}</strong>
          {capabilityStateDetail ? <small>{capabilityStateDetail}</small> : null}
        </div>
        {capabilityStateDetail ? (
          <Button variant="ghost" size="sm" onClick={onRetryCapability}>
            {capabilityRetryLabel}
          </Button>
        ) : null}
      </div>
    ) : (
      <div className={`composer-effort-slider-section ${hasAdjustableReasoning ? '' : 'is-disabled'}`}>
        <div
          ref={trackRef}
          className={`composer-effort-slider is-level-${displayLevel}${hasAdjustableReasoning ? '' : ' is-disabled'}${isDragging ? ' is-dragging' : ''}${showMaxTrack ? ' is-max-visual' : ''}${exitingMaxPhase !== 'off' ? ` is-exiting-max is-exiting-max-${exitingMaxPhase}` : ''} is-max-phase-${maxTimeline.phase}`}
          data-testid="composer-effort-slider"
          data-exiting-max={exitingMaxPhase}
          data-max-phase={maxTimeline.phase}
          data-max-progress="0.000"
          data-max-stops-opacity={maxTimeline.fromStopsOpacity.toFixed(3)}
          data-max-emitter-ratio={thumbRatio.toFixed(3)}
          data-max-field-energy={maxTimeline.fromEnergy.toFixed(3)}
          data-max-clip-ratio={thumbRatio.toFixed(3)}
          {...trackDynStyle}
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
            aria-valuetext={hasAdjustableReasoning
              ? t(EFFORT_LABEL_KEYS[displayLevel])
              : t('composer.effort.levelOff')}
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
    )}

    {capabilityRefreshing ? (
      <div className="composer-effort-refreshing" role="status">
        {t('composer.effort.capabilityRefreshing')}
      </div>
    ) : null}

    {oneMillionContextVisible || fastModelVisible ? (
      <div className="composer-effort-popup-divider" aria-hidden="true" />
    ) : null}

    {oneMillionContextVisible ? (
      <EffortOneMillionContextSwitchRow
        label={t('composer.effort.oneMillionContext')}
        statusLabel={oneMillionContextStatusLabel}
        available={oneMillionContextAvailable}
        active={oneMillionContextMode}
        onToggle={onToggleOneMillionContext}
      />
    ) : null}

    {fastModelVisible ? (
      <EffortFastModeSwitchRow
        label={t('composer.effort.fastModel')}
        statusLabel={fastModelStatusLabel}
        available={fastModelAvailable}
        active={fastModel}
        onToggle={onToggleFastModel}
      />
    ) : null}
  </div>
  );
};
