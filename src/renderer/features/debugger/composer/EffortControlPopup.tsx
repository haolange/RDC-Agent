import React from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import type { TranslationKey } from '../../../i18n';
import {
  EFFORT_LABEL_KEYS,
  EffortFastModeSwitchRow,
  EffortOneMillionContextSwitchRow,
  getStopPosition,
} from './effortControlParts';
import type { MaxVisualTimeline } from './maxVisual';
import { EffortMaxField } from './EffortMaxField';
import { Button } from '../../../ui/Button';

export const EffortControlPopup: React.FC<{
  popupRef: React.RefObject<HTMLDivElement>;
  popupStyle: React.CSSProperties;
  trackRef: React.RefObject<HTMLDivElement>;
  capabilityStateLabel?: string;
  capabilityStateDetail?: string;
  capabilityRefreshing: boolean;
  capabilityRetryLabel: string;
  onRetryCapability: () => void;
  reasoningUnverified: boolean;
  reasoningStateLabel: string;
  hasAdjustableReasoning: boolean;
  displayLevel: ReasoningSelection;
  displayLevels: ReasoningSelection[];
  displayIndex: number;
  isDragging: boolean;
  showMaxTrack: boolean;
  maxTimeline: MaxVisualTimeline;
  thumbRatio: number;
  thumbStyle: React.CSSProperties;
  thumbEdgeClass: string;
  tooltipLabel: string;
  oneMillionContextAvailable: boolean;
  oneMillionContextStatusLabel?: string;
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
  popupStyle,
  trackRef,
  capabilityStateLabel,
  capabilityStateDetail,
  capabilityRefreshing,
  capabilityRetryLabel,
  onRetryCapability,
  reasoningUnverified,
  reasoningStateLabel,
  hasAdjustableReasoning,
  displayLevel,
  displayLevels,
  displayIndex,
  isDragging,
  showMaxTrack,
  maxTimeline,
  thumbRatio,
  thumbStyle,
  thumbEdgeClass,
  tooltipLabel,
  oneMillionContextAvailable,
  oneMillionContextStatusLabel,
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
}) => (
  <div ref={popupRef} className="composer-effort-popup" data-testid="composer-effort-popup" role="dialog" aria-label={t('composer.effort.popupTitle')} style={popupStyle}>
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
    ) : reasoningUnverified ? (
      <div className="composer-effort-reasoning-state" data-testid="composer-effort-reasoning-unverified" role="status">
        <span>{t('composer.effort.reasoning')}</span>
        <strong>{reasoningStateLabel}</strong>
      </div>
    ) : (
      <div className={`composer-effort-slider-section ${hasAdjustableReasoning ? '' : 'is-disabled'}`}>
        <div
          ref={trackRef}
          className={`composer-effort-slider is-level-${displayLevel}${hasAdjustableReasoning ? '' : ' is-disabled'}${isDragging ? ' is-dragging' : ''}${showMaxTrack ? ' is-max-visual' : ''} is-max-phase-${maxTimeline.phase}`}
          data-testid="composer-effort-slider"
          data-max-phase={maxTimeline.phase}
          data-max-progress="0.000"
          data-max-stops-opacity={maxTimeline.fromStopsOpacity.toFixed(3)}
          data-max-emitter-ratio={thumbRatio.toFixed(3)}
          data-max-field-energy={maxTimeline.fromEnergy.toFixed(3)}
          data-max-clip-ratio={thumbRatio.toFixed(3)}
          style={{ '--composer-effort-stops-opacity': maxTimeline.fromStopsOpacity } as React.CSSProperties}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={onTrackPointerUp}
          onClick={onTrackClick}
        >
          {hasAdjustableReasoning ? (
            <div className="composer-effort-slider-stops" aria-hidden="true">
              {displayLevels.map((level, index) => (
                <div
                  key={level}
                  className={`composer-effort-slider-stop${level === displayLevel ? ' is-current' : ''}`}
                  style={{ left: `${getStopPosition(index, displayLevels.length) * 100}%` }}
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
            className={`composer-effort-slider-thumb${isDragging ? ' is-dragging' : ''}${thumbEdgeClass}`}
            style={thumbStyle}
            role="slider"
            tabIndex={hasAdjustableReasoning ? 0 : -1}
            aria-valuemin={0}
            aria-valuemax={displayLevels.length - 1}
            aria-valuenow={displayIndex}
            aria-valuetext={t(EFFORT_LABEL_KEYS[displayLevel])}
            aria-disabled={!hasAdjustableReasoning}
            onKeyDown={onThumbKeyDown}
          >
            {isDragging ? <span className="composer-effort-slider-tooltip">{tooltipLabel}</span> : null}
          </div>
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

    <div className="composer-effort-popup-divider" aria-hidden="true" />

    <EffortOneMillionContextSwitchRow
      label={t('composer.effort.oneMillionContext')}
      statusLabel={oneMillionContextStatusLabel}
      available={oneMillionContextAvailable}
      active={oneMillionContextMode}
      onToggle={onToggleOneMillionContext}
    />

    <EffortFastModeSwitchRow
      label={t('composer.effort.fastModel')}
      statusLabel={fastModelStatusLabel}
      available={fastModelAvailable}
      active={fastModel}
      onToggle={onToggleFastModel}
    />
  </div>
);
