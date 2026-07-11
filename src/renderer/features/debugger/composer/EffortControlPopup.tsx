import React from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import type { TranslationKey } from '../../../i18n';
import {
  EFFORT_LABEL_KEYS,
  EffortFastModeSwitchRow,
  EffortMaxContextSwitchRow,
  getStopPosition,
} from './effortControlParts';
import { EffortMaxSparks } from './EffortMaxSparks';

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
        className={`composer-effort-slider is-level-${displayLevel}${hasAdjustableReasoning ? '' : ' is-disabled'}${isDragging ? ' is-dragging' : ''}`}
        data-testid="composer-effort-slider"
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
        onClick={onTrackClick}
      >
        {hasAdjustableReasoning ? (
          <div className="composer-effort-slider-stops" aria-hidden="true">
            {displayLevels.map((level, index) => {
              const classes = [
                'composer-effort-slider-stop',
                level === displayLevel ? 'is-current' : '',
              ].filter(Boolean).join(' ');
              return (
                <div
                  key={level}
                  className={classes}
                  style={{ left: `${getStopPosition(index, displayLevels.length) * 100}%` }}
                />
              );
            })}
          </div>
        ) : null}

        <div className="composer-effort-slider-track" aria-hidden="true">
          {isMaxTier ? <EffortMaxSparks /> : null}
        </div>

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
