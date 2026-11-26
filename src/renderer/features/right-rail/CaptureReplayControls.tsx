import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Chevron } from '../../ui/Chevron';
import { InlineError } from '../../ui/InlineError';
import { errorDetail } from '../../lib/errorDetail';
import { isImeComposing } from '../../lib/ime';
import { createReplayApplyQueue } from './replayApplyQueue';
import { applyReplayEvent, type CaptureScope } from './capturePanelActions';
import type { CaptureReplayApplyRequest, CaptureReplayState } from '@shared/types/captureReplay';

export function CaptureReplayControls({
  scope,
  state,
  disabled,
  receive,
}: {
  scope: CaptureScope;
  state: CaptureReplayState | null;
  disabled: boolean;
  receive: (state: CaptureReplayState) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const queue = useMemo(
    () =>
      createReplayApplyQueue<CaptureReplayApplyRequest>(
        async (request) => {
          if (disabled || request.projectId !== scope.projectId || request.sessionId !== scope.sessionId) return;
          const next = await applyReplayEvent(request);
          if (next.generation !== state?.generation) return;
          receive(next);
          setRequested((value) => (value === request.eventId ? null : value));
        },
        (reason) => {
          setError(errorDetail(reason));
          setRequested(null);
        },
      ),
    [scope, state?.generation, receive, disabled],
  );
  useEffect(() => () => queue.dispose(), [queue]);
  useEffect(() => {
    if (disabled) {
      queue.dispose();
      setRequested(null);
      setError(null);
    }
  }, [disabled, queue]);
  const events = state?.events ?? [];
  const eventId = requested ?? state?.requestedEventId ?? state?.appliedEventId;
  const position = Math.max(
    0,
    events.findIndex((event) => event.eventId === eventId),
  );
  useEffect(() => setDraft(eventId === null || eventId === undefined ? '' : String(eventId)), [eventId]);
  const select = (id: number, flush = false, target?: CaptureReplayApplyRequest['target']) => {
    if (disabled || !state || !events.some((event) => event.eventId === id)) return;
    setRequested(id);
    setError(null);
    queue.enqueue({ ...scope, bindingGeneration: state.generation, eventId: id, ...(target ? { target } : {}) }, flush);
  };
  const applying =
    requested !== null ||
    state?.phase === 'applying' ||
    (state?.requestedEventId != null && state.requestedEventId !== state.appliedEventId);
  const imagePending = Boolean(state?.image && state.imageEventId !== state.appliedEventId);
  const targets = state?.targets ?? [];
  const targetLabel = (target: (typeof targets)[number]) =>
    target.outputSlot === null
      ? t('control.replay.final')
      : t('control.replay.colorTarget', { slot: target.outputSlot });

  return (
    <div
      className="capture-replay-content"
      role="group"
      aria-label={t('control.replay.controls')}
      aria-disabled={disabled}
    >
      <div className="capture-image-toolbar">
        {targets.length > 1 ? (
          <Select
            dataTestId="capture-color-target"
            ariaLabel={t('control.replay.color')}
            value={state?.target?.textureId ?? ''}
            disabled={disabled || state?.appliedEventId == null || applying}
            options={targets.map((target) => ({ value: target.textureId, label: targetLabel(target) }))}
            onChange={(textureId) => state?.appliedEventId != null && select(state.appliedEventId, true, { textureId })}
          />
        ) : (
          <span>
            {targets[0]
              ? targetLabel(targets[0])
              : t(state?.isFinalOutput ? 'control.replay.final' : 'control.replay.event')}
          </span>
        )}
        {(applying || imagePending) && state?.appliedEventId != null && (
          <span>{t('control.replay.appliedEvent', { id: state.appliedEventId })}</span>
        )}
      </div>
      <div className="capture-event-controls">
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('control.replay.previous')}
          disabled={disabled || position === 0}
          onClick={() => select(events[position - 1].eventId, true)}
        >
          <Chevron direction="left" />
        </Button>
        <label className="capture-event-input">
          {t('control.replay.eventLabel')}{' '}
          <Input
            inputSize="sm"
            aria-label={t('control.replay.eventId')}
            value={draft}
            disabled={disabled || !events.length}
            inputMode="numeric"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              const value = Number(draft);
              if (events.some((event) => event.eventId === value)) {
                if (value !== eventId) select(value, true);
              } else setDraft(String(eventId ?? ''));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !isImeComposing(event)) event.currentTarget.blur();
            }}
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('control.replay.next')}
          disabled={disabled || !events.length || position >= events.length - 1}
          onClick={() => select(events[position + 1].eventId, true)}
        >
          <Chevron />
        </Button>
      </div>
      <input
        className="capture-event-slider"
        type="range"
        min={0}
        max={Math.max(0, events.length - 1)}
        value={position}
        disabled={disabled || events.length < 2}
        aria-label={t('control.replay.eventSlider')}
        aria-valuetext={eventId != null ? t('control.replay.eventNumber', { id: eventId }) : t('control.replay.event')}
        onChange={(event) => select(events[Number(event.target.value)].eventId)}
        onPointerUp={() => queue.flush()}
        onKeyUp={(event) => {
          if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)
          )
            queue.flush();
        }}
      />
      {error ? (
        <InlineError detail={error}>{t('control.replay.applyFailed')}</InlineError>
      ) : applying ? (
        <div className="capture-replay-feedback" role="status">
          {t('control.replay.switching')}
        </div>
      ) : null}
      {state?.contextId && state.devicePresentation.status === 'unsupported' ? (
        <small>{t('control.replay.remoteUnsupported')}</small>
      ) : state?.contextId && state.devicePresentation.status === 'unavailable' ? (
        <small>{t('control.replay.remoteUnavailable')}</small>
      ) : null}
    </div>
  );
}
