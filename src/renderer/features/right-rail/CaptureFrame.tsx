import { useEffect, useMemo, useState } from 'react';
import type { CaptureReplayApplyRequest, CaptureReplayState } from '@shared/types/captureReplay';
import { applyReplayEvent, type CaptureScope } from './capturePanelActions';
import { createReplayApplyQueue } from './replayApplyQueue';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { DropdownSelect } from '../../ui/DropdownSelect';

export function CaptureFrame({ scope, state, disabled, receive }: {
  scope: CaptureScope; state: CaptureReplayState | null; disabled: boolean; receive: (state: CaptureReplayState) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const queue = useMemo(() => createReplayApplyQueue<CaptureReplayApplyRequest>(async (request) => {
    if (disabled || request.projectId !== scope.projectId || request.sessionId !== scope.sessionId) return;
    const next = await applyReplayEvent(request);
    if (next.generation !== state?.generation) return;
    receive(next);
    setRequested((value) => value === request.eventId ? null : value);
  }, (reason) => { setError(String(reason)); setRequested(null); }), [scope, state?.generation, receive, disabled]);
  useEffect(() => () => queue.dispose(), [queue]);
  useEffect(() => { if (disabled) queue.dispose(); }, [disabled, queue]);
  const events = state?.events ?? [];
  const eventId = requested ?? state?.requestedEventId ?? state?.appliedEventId;
  const position = Math.max(0, events.findIndex((event) => event.eventId === eventId));
  useEffect(() => setDraft(eventId === null || eventId === undefined ? '' : String(eventId)), [eventId]);
  const select = (id: number, flush = false, target?: CaptureReplayApplyRequest['target']) => {
    if (disabled || !state || !events.some((event) => event.eventId === id)) return;
    setRequested(id); setError(null); queue.enqueue({ ...scope, bindingGeneration: state.generation, eventId: id, ...(target ? { target } : {}) }, flush);
  };
  const image = state?.image;
  const busyImage = state && ['validating', 'connecting', 'opening', 'loading_image', 'closing'].includes(state.phase);
  const feedback = requested !== null || state?.phase === 'applying' || (state?.requestedEventId !== null && state?.requestedEventId !== state?.appliedEventId)
    ? t('control.replay.requested', { requested: requested ?? state?.requestedEventId ?? '—', shown: state?.imageEventId ?? '—' })
    : state?.appliedEventId !== null && state?.appliedEventId !== undefined ? t('control.replay.applied', { eid: state.appliedEventId }) : '';
  return <div className="capture-replay-content" role="tabpanel" id="capture-frame-panel" aria-labelledby="capture-frame-tab">
    <div className="capture-image-toolbar">
      <span>{t(state?.isFinalOutput ? 'control.replay.final' : 'control.replay.event')}</span>
      {(state?.targets.length ?? 0) > 0 && <DropdownSelect dataTestId="capture-color-target" ariaLabel={t('control.replay.color')}
        value={state?.target?.textureId ?? ''} disabled={disabled || !state?.appliedEventId}
        options={(state?.targets ?? []).map((target) => ({ value: target.textureId, label: target.outputSlot === null ? t('control.replay.final') : `Color ${target.outputSlot}` }))}
        onChange={(textureId) => state?.appliedEventId && select(state.appliedEventId, true, { textureId })} />}
    </div>
    <div className="capture-replay-image" aria-busy={Boolean(busyImage)}>
      {image?.imageUrl ? <img src={image.imageUrl} alt={`EID ${state?.imageEventId ?? '—'}`} /> : <span>{busyImage ? t(`control.replay.${state.phase}`) : t(state?.contextId ? 'control.replay.noOutput' : 'control.replay.noImage')}</span>}
      {image && busyImage && <span className="capture-image-state">{t(`control.replay.${state.phase}`)}</span>}
    </div>
    <div className="capture-event-controls">
      <Button variant="ghost" size="sm" aria-label={t('control.replay.previous')} disabled={disabled || position === 0} onClick={() => select(events[position - 1].eventId, true)}>‹</Button>
      <label className="capture-event-input">EID <Input inputSize="sm" aria-label={t('control.replay.eventId')} value={draft} disabled={disabled || !events.length}
        inputMode="numeric" onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { const value = Number(draft); if (events.some((event) => event.eventId === value)) select(value, true); else setDraft(String(eventId ?? '')); }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
      <Button variant="ghost" size="sm" aria-label={t('control.replay.next')} disabled={disabled || !events.length || position >= events.length - 1} onClick={() => select(events[position + 1].eventId, true)}>›</Button>
    </div>
    <input className="capture-event-slider" type="range" min={0} max={Math.max(0, events.length - 1)} value={position} disabled={disabled || events.length < 2}
      aria-label={t('control.replay.eventSlider')} aria-valuetext={`EID ${eventId ?? '—'}`}
      onChange={(event) => select(events[Number(event.target.value)].eventId)}
      onPointerUp={(event) => events[Number(event.currentTarget.value)] && select(events[Number(event.currentTarget.value)].eventId, true)}
      onKeyUp={(event) => events[Number(event.currentTarget.value)] && select(events[Number(event.currentTarget.value)].eventId, true)} />
    <div className="capture-replay-feedback" role="status">{error ?? feedback}</div>
    {state?.devicePresentation.status === 'displayed' && <small>{t('control.replay.synced')}</small>}
    {state?.devicePresentation.status === 'unsupported' && <small title={state.devicePresentation.reason}>{t('control.replay.remoteUnsupported')}</small>}
  </div>;
}
