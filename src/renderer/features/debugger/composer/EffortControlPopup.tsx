import React from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import type { TranslationKey } from '../../../i18n';
import {
  EFFORT_LABEL_KEYS,
  EffortFastModeSwitchRow,
  EffortMaxContextSwitchRow,
  getStopPosition,
} from './effortControlParts';
import type { MaxVisualPhase } from './maxVisual';
import { EffortMaxField } from './EffortMaxField';

export const EffortControlPopup: React.FC<{
  popupRef: React.RefObject<HTMLDivElement>;
  popupStyle: React.CSSProperties;
  trackRef: React.RefObject<HTMLDivElement>;
  hasAdjustableReasoning: boolean;
  displayLevel: ReasoningSelection;
  displayLevels: ReasoningSelection[];
  displayIndex: number;
  isDragging: boolean;
  isMaxTier: boolean;
  showMaxTrack: boolean;
  maxPhase: MaxVisualPhase;
  maxProgress: number;
  thumbRatio: number;
  stopsOpacity: number;
  thumbStyle: React.CSSProperties;
  thumbEdgeClass: string;
  tooltipLabel: string;
  maxContextStatus: string;
  fastModelStatus: string;
  maxContextAvailable: boolean;
  fastModelAvailable: boolean;
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
}> = ({
  popupRef,
  popupStyle,
  trackRef,
  hasAdjustableReasoning,
  displayLevel,
  displayLevels,
  displayIndex,
  isDragging,
  isMaxTier,
  showMaxTrack,
  maxPhase,
  maxProgress,
  thumbRatio,
  stopsOpacity,
  thumbStyle,
  thumbEdgeClass,
  tooltipLabel,
  maxContextStatus,
  fastModelStatus,
  maxContextAvailable,
  fastModelAvailable,
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
}) => (
  <div ref={popupRef} className="composer-effort-popup" data-testid="composer-effort-popup" role="dialog" aria-label={t('composer.effort.popupTitle')} style={popupStyle}>
    <div className={`composer-effort-slider-section ${hasAdjustableReasoning ? '' : 'is-disabled'}`}>
      <div
        ref={trackRef}
        className={`composer-effort-slider is-level-${displayLevel}${hasAdjustableReasoning ? '' : ' is-disabled'}${isDragging ? ' is-dragging' : ''}${showMaxTrack ? ' is-max-visual' : ''} is-max-phase-${maxPhase}`}
        data-testid="composer-effort-slider"
        data-max-phase={maxPhase}
        data-max-progress={maxProgress.toFixed(3)}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
        onClick={onTrackClick}
      >
        {hasAdjustableReasoning ? (
          <div
            className="composer-effort-slider-stops"
            aria-hidden="true"
            style={{ opacity: isMaxTier || showMaxTrack ? stopsOpacity : 1 }}
          >
            {displayLevels.map((level, index) => {
              return (
                <div
                  key={level}
                  className={`composer-effort-slider-stop${level === displayLevel ? ' is-current' : ''}`}
                  style={{ left: `${getStopPosition(index, displayLevels.length) * 100}%` }}
                />
              );
            })}
          </div>
        ) : null}

        <div className="composer-effort-slider-track" aria-hidden="true" />

        <EffortMaxField phase={maxPhase} progress={maxProgress} thumbRatio={thumbRatio} />

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

    <div className="composer-effort-popup-divider" aria-hidden="true" />

    <EffortMaxContextSwitchRow
      label={t('composer.effort.maxContext')}
      status={maxContextStatus}
      available={maxContextAvailable}
      active={maxContextMode}
      onToggle={onToggleMaxContext}
    />

    <EffortFastModeSwitchRow
      label={t('composer.effort.fastModel')}
      status={fastModelStatus}
      available={fastModelAvailable}
      active={fastModel}
      onToggle={onToggleFastModel}
    />
  </div>
);
