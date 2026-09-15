import { useEffect, useRef, useState } from 'react';
import type { CaptureReplayHistoryEntry, CaptureReplayState } from '@shared/types/captureReplay';
import { listReplayHistory, type CaptureScope } from './capturePanelActions';
import { useCapturePreviewUrl } from './useCapturePreviewUrl';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { latestSuccessfulHistoryIndex, readCaptureHistory } from './readCaptureHistory';

type CaptureHistoryProps = { scope: CaptureScope; captureHash: string | null; state: CaptureReplayState | null; active: boolean };

export function CaptureHistory(props: CaptureHistoryProps) {
  return <ScopedCaptureHistory key={JSON.stringify([props.scope.projectId, props.scope.sessionId, props.captureHash])} {...props} />;
}

function ScopedCaptureHistory({ scope, captureHash, state, active: visible }: CaptureHistoryProps) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<CaptureReplayHistoryEntry[]>([]);
  const entriesRef = useRef<CaptureReplayHistoryEntry[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!captureHash) { entriesRef.current = []; setEntries([]); return; }
    const read = async () => {
      const all = await readCaptureHistory(entriesRef.current,
        (afterSequence) => listReplayHistory({ ...scope, captureHash, afterSequence, limit: 200 }), () => active);
      if (active && all) { entriesRef.current = all; setEntries(all); setError(null); }
    };
    void read().catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [scope, captureHash, state?.revision]);
  const index = selected === null ? latestSuccessfulHistoryIndex(entries) : Math.min(selected, entries.length - 1);
  const entry = entries[index];
  const following = selected === null;
  const live = Boolean(state?.contextId && state.phase !== 'closed');
  const liveObservation = following && live ? state?.agentObservation : null;
  const liveImagePath = liveObservation?.image.imagePath ?? null;
  const historyHash = !liveObservation && entry?.imageSha256 && captureHash ? entry.imageSha256 : null;
  const shownImage = useCapturePreviewUrl(scope, {
    imagePath: liveImagePath,
    captureHash: historyHash ? captureHash : null,
    imageHash: historyHash,
  });
  const loading = Boolean((liveImagePath || historyHash) && !shownImage);
  useEffect(() => {
    if (!playing || !visible) return;
    const timer = setInterval(() => {
      setSelected((position) => {
        const next = (position ?? -1) + 1;
        if (next >= entries.length) { setPlaying(false); return Math.max(0, entries.length - 1); }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [playing, entries.length, visible]);
  const select = (value: number) => { setSelected(value); setPlaying(false); };
  const shownEvent = liveObservation?.eventId ?? entry?.eventId;
  const shownSummary = liveObservation?.summary ?? entry?.summary;
  const shownToolCall = liveObservation?.toolCallId ?? entry?.toolCallId;
  const modification = liveObservation?.observation?.modificationState ?? entry?.modificationState;
  return <div className="capture-replay-content" role="tabpanel" id="capture-history-panel" aria-labelledby="capture-history-tab">
    <div className="capture-history-toolbar">
      <span>{t(following && live ? 'control.replay.follow' : 'control.replay.review')} · {Math.max(0, index + 1)} / {entries.length}</span>
      <Button variant="ghost" size="sm" disabled={!live || following} title={!live ? t('control.replay.openForLive') : undefined} onClick={() => { setSelected(null); setPlaying(false); }}>{t('control.replay.returnLive')}</Button>
    </div>
    <div className="capture-replay-image" aria-busy={loading}>
      {shownImage ? <img src={shownImage} alt={`EID ${shownEvent ?? '—'}`} />
        : <span>{t(loading ? 'control.replay.imageLoading' : entry ? 'control.replay.historyMissing' : 'control.replay.historyEmpty')}</span>}
    </div>
    <div className="capture-history-controls">
      <Button variant="ghost" size="sm" aria-label={t('control.replay.previousStep')} disabled={index <= 0} onClick={() => select(index - 1)}>‹</Button>
      <Button variant="ghost" size="sm" aria-label={t(playing ? 'control.replay.pause' : 'control.replay.play')} disabled={!entries.length} onClick={() => {
        if (!playing && (selected === null || index === entries.length - 1)) setSelected(0);
        setPlaying(!playing);
      }}>{playing ? 'Ⅱ' : '▷'}</Button>
      <Button variant="ghost" size="sm" aria-label={t('control.replay.nextStep')} disabled={index >= entries.length - 1} onClick={() => select(index + 1)}>›</Button>
      <input type="range" className="capture-event-slider" min={0} max={Math.max(0, entries.length - 1)} value={Math.max(0, index)} disabled={entries.length < 2}
        aria-label={t('control.replay.historySlider')} aria-valuetext={`${index + 1} / ${entries.length}`} onChange={(event) => select(Number(event.target.value))} />
    </div>
    {(entry || liveObservation) && <div className="capture-history-detail"><span title={shownSummary}>{shownSummary}</span><small>EID {shownEvent ?? '—'} · {modification ? t(`control.replay.${modification}` as Parameters<typeof t>[0]) : t('control.replay.saved')}</small>
      {shownToolCall && <Button size="sm" variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent('rdx:locate-tool-call', { detail: { ...scope, toolCallId: shownToolCall } }))}>{t('control.replay.message')}</Button>}
    </div>}
    {(liveObservation?.saveError || error || entry?.failure) && <div className="capture-replay-feedback is-error" role="status">{liveObservation?.saveError || error || entry?.failure}</div>}
  </div>;
}
