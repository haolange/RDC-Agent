import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReasoningLevel } from '@shared/types/modelCapability';
import { useI18n } from '../../../i18n';
import { useTurnControls } from './useTurnControls';
import type { SessionRecord } from '@shared/types/session';
import {
  ChevronIcon,
  clampSliderRatio,
  EFFORT_LABEL_KEYS,
  findAdjacentSupportedLevel,
  getStopPosition,
  LightningIcon,
  normalizeDisplayLevels,
  resolveNearestSnapLevel,
} from './effortControlParts';

export const EffortControl: React.FC<{
  agentId: string;
  currentSession: SessionRecord | null;
  disabled?: boolean;
}> = ({ agentId, currentSession, disabled = false }) => {
  const { t } = useI18n();
  const { turnControls, capability, updateTurnControls } = useTurnControls(agentId, currentSession);
  const [open, setOpen] = useState(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [popupShift, setPopupShift] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragActiveRef = useRef(false);
  const popupShiftRef = useRef(0);
  const isDragging = dragRatio !== null;

  const displayLevels = useMemo(
    () => normalizeDisplayLevels(capability?.supportedReasoningLevels),
    [capability?.supportedReasoningLevels],
  );
  const hasAdjustableReasoning = displayLevels.length > 1;
  const selectedIndex = Math.max(0, displayLevels.indexOf(turnControls.reasoningLevel));
  const selectedLevel = displayLevels[selectedIndex] ?? 'off';
  const visualLevel = isDragging
    ? resolveNearestSnapLevel(dragRatio, displayLevels)
    : selectedLevel;
  const visualIndex = Math.max(0, displayLevels.indexOf(visualLevel));
  const thumbRatio = isDragging
    ? clampSliderRatio(dragRatio)
    : getStopPosition(visualIndex, displayLevels.length);
  const thumbPercent = thumbRatio * 100;

  const effortLabel = t(EFFORT_LABEL_KEYS[selectedLevel]);
  const tooltipLabel = t(EFFORT_LABEL_KEYS[visualLevel]);
  const pillLabel = turnControls.maxContextMode ? `${effortLabel} / Max` : effortLabel;

  const closeMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [closeMenu, open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const syncPopupPosition = () => {
      const popup = popupRef.current;
      if (!popup) return;
      const gutter = 8;
      const currentShift = popupShiftRef.current;
      const rect = popup.getBoundingClientRect();
      const boundary = menuRef.current?.closest('.composer-shell')?.getBoundingClientRect();
      const minLeft = Math.max(gutter, boundary ? boundary.left + gutter : gutter);
      const maxRight = Math.min(window.innerWidth - gutter, boundary ? boundary.right - gutter : window.innerWidth - gutter);
      const baseLeft = rect.left - currentShift;
      const baseRight = rect.right - currentShift;
      let nextShift = 0;
      if (baseRight > maxRight) nextShift -= baseRight - maxRight;
      if (baseLeft + nextShift < minLeft) nextShift += minLeft - (baseLeft + nextShift);
      popupShiftRef.current = Math.round(nextShift);
      setPopupShift(popupShiftRef.current);
    };
    syncPopupPosition();
    window.addEventListener('resize', syncPopupPosition);
    return () => window.removeEventListener('resize', syncPopupPosition);
  }, [open]);

  const selectEffort = useCallback((level: ReasoningLevel) => {
    if (displayLevels.includes(level)) updateTurnControls({ reasoningLevel: level });
  }, [displayLevels, updateTurnControls]);

  const getRatioFromClientX = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return clampSliderRatio((clientX - rect.left) / rect.width);
  };

  const resolveLevelFromClientX = (clientX: number): ReasoningLevel => {
    const track = trackRef.current;
    if (!track) return displayLevels[0] ?? 'off';
    const rect = track.getBoundingClientRect();
    return resolveNearestSnapLevel((clientX - rect.left) / rect.width, displayLevels);
  };

  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!hasAdjustableReasoning) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ratio = getRatioFromClientX(event.clientX);
    dragActiveRef.current = true;
    setDragRatio(ratio);
  };

  const handleTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragActiveRef.current || !hasAdjustableReasoning) return;
    const ratio = getRatioFromClientX(event.clientX);
    setDragRatio(ratio);
  };

  const handleTrackPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragActiveRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    selectEffort(resolveLevelFromClientX(event.clientX));
    dragActiveRef.current = false;
    setDragRatio(null);
  };

  const handleTrackClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!hasAdjustableReasoning) return;
    selectEffort(resolveLevelFromClientX(event.clientX));
  };

  const handleThumbKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasAdjustableReasoning) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = findAdjacentSupportedLevel(selectedLevel, -1, displayLevels);
      if (next) selectEffort(next);
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = findAdjacentSupportedLevel(selectedLevel, 1, displayLevels);
      if (next) selectEffort(next);
    }
  };

  const popupStyle = { '--composer-effort-popup-shift-x': `${popupShift}px` } as React.CSSProperties;
  const thumbStyle = { left: `${thumbPercent}%` } as React.CSSProperties;
  const thumbEdgeClass = thumbPercent <= 0.01
    ? ' is-start'
    : thumbPercent >= 99.99
      ? ' is-end'
      : '';

  return (
    <div ref={menuRef} className="composer-effort-menu">
      <button
        type="button"
        className={`composer-effort-pill ${open ? 'open' : ''}`}
        data-testid="composer-effort-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        title={pillLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="composer-effort-pill-icon" aria-hidden="true">
          <LightningIcon />
          {turnControls.fastModel ? <span className="composer-effort-fast-badge" aria-hidden="true">2x</span> : null}
        </span>
        <span className="composer-effort-pill-label">{pillLabel}</span>
        <span className="composer-effort-pill-caret" aria-hidden="true"><ChevronIcon /></span>
      </button>

      {open ? (
        <div ref={popupRef} className="composer-effort-popup" data-testid="composer-effort-popup" role="dialog" aria-label={t('composer.effort.popupTitle')} style={popupStyle}>
          <div className={`composer-effort-slider-section ${hasAdjustableReasoning ? '' : 'is-disabled'}`}>
            <div
              ref={trackRef}
              className={`composer-effort-slider is-level-${visualLevel}${hasAdjustableReasoning ? '' : ' is-disabled'}${isDragging ? ' is-dragging' : ''}`}
              data-testid="composer-effort-slider"
              onPointerDown={handleTrackPointerDown}
              onPointerMove={handleTrackPointerMove}
              onPointerUp={handleTrackPointerUp}
              onPointerCancel={handleTrackPointerUp}
              onClick={handleTrackClick}
            >
              {hasAdjustableReasoning ? (
                <div className="composer-effort-slider-stops" aria-hidden="true">
                  {displayLevels.map((level, index) => {
                    const classes = [
                      'composer-effort-slider-stop',
                      level === visualLevel ? 'is-current' : '',
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

              <div className="composer-effort-slider-track" aria-hidden="true" />

              <div
                className={`composer-effort-slider-thumb${isDragging ? ' is-dragging' : ''}${thumbEdgeClass}`}
                style={thumbStyle}
                role="slider"
                tabIndex={hasAdjustableReasoning ? 0 : -1}
                aria-valuemin={0}
                aria-valuemax={displayLevels.length - 1}
                aria-valuenow={selectedIndex}
                aria-valuetext={effortLabel}
                aria-disabled={!hasAdjustableReasoning}
                onKeyDown={handleThumbKeyDown}
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

          <div
            className={`composer-effort-toggle-row ${capability?.maxContextAvailable ? '' : 'is-disabled'}`}
            data-testid="composer-effort-max-row"
          >
            <div className="composer-effort-toggle-copy">
              <span className="composer-effort-toggle-label">{t('composer.effort.maxMode')}</span>
            </div>
            <button
              type="button"
              role="switch"
              className={`composer-effort-toggle ${turnControls.maxContextMode ? 'active' : ''}`}
              aria-checked={turnControls.maxContextMode}
              disabled={!capability?.maxContextAvailable}
              onClick={() => updateTurnControls({ maxContextMode: !turnControls.maxContextMode })}
            />
          </div>

          <div
            className={`composer-effort-toggle-row ${capability?.fastModelAvailable ? '' : 'is-disabled'}`}
            data-testid="composer-effort-fast-row"
          >
            <div className="composer-effort-toggle-copy">
              <span className="composer-effort-toggle-label">{t('composer.effort.fastModel')}</span>
            </div>
            <button
              type="button"
              role="switch"
              className={`composer-effort-toggle ${turnControls.fastModel ? 'active' : ''}`}
              aria-checked={turnControls.fastModel}
              disabled={!capability?.fastModelAvailable}
              onClick={() => updateTurnControls({ fastModel: !turnControls.fastModel })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};
