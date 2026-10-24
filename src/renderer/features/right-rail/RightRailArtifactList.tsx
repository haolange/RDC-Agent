import React, { useEffect, useState } from 'react';
import type { InvestigationArtifactRow, InvestigationArtifactsPanelViewModel, InvestigationListPage } from '@shared/types/trace';
import { useI18n } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../../ui/Button';
import { TaskDialog } from '../../ui/TaskDialog';
import { RightRailArtifactGlyph } from './RightRailArtifactGlyphs';
import { RightRailInvestigationPreview } from './RightRailInvestigationPreview';
import { listInvestigationArtifacts } from './investigationPreviewActions';

function ArtifactRows({ rows, select }: { rows: InvestigationArtifactRow[]; select: (row: InvestigationArtifactRow) => void }) {
  const { t } = useI18n();
  return <div className="right-rail-investigation-list">{rows.map(row => <Button key={row.artifactId} variant="ghost"
    className="right-rail-compact-row" title={row.title || row.artifactId} onClick={() => select(row)}>
    <span className="right-rail-compact-icon" aria-hidden="true"><RightRailArtifactGlyph kind={row.kind} /></span>
    <span className="right-rail-compact-title">{row.title || `${t(`control.rightRail.artifacts.kind.${row.kind}`)} · ${row.artifactId}`}</span>
    <span aria-hidden="true">›</span>
  </Button>)}</div>;
}

function ScopedArtifactList({ artifacts, projectId, sessionId }: {
  artifacts: InvestigationArtifactsPanelViewModel; projectId: string; sessionId: string;
}) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const [preview, setPreview] = useState<InvestigationArtifactRow | null>(null);
  const [page, setPage] = useState<InvestigationListPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState<InvestigationListPage['nextCursor']>();
  useEffect(() => {
    if (!all) return;
    let active = true;
    setLoading(true); setError(false);
    void listInvestigationArtifacts({ projectId, sessionId, cursor }).then(next => {
      if (!active) return;
      if (next.storeDegraded) { setError(true); return; }
      setPage(previous => ({ ...next, rows: cursor && previous
        ? [...previous.rows, ...next.rows.filter(row => !previous.rows.some(old => old.artifactId === row.artifactId))] : next.rows }));
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [all, projectId, sessionId, cursor, attempt]);
  return <>
    <ArtifactRows rows={artifacts.rows} select={setPreview} />
    {artifacts.totalCount > 5 && <Button variant="ghost" size="sm" className="right-rail-browse-all"
      onClick={() => { setPage(null); setCursor(undefined); setAll(true); }}>{t('control.rightRail.browse.all', { count: artifacts.totalCount })}</Button>}
    <TaskDialog open={all} title={t('control.rightRail.artifacts.title')} closeLabel={t('control.rightRail.browse.close')}
      onClose={() => setAll(false)} dataTestId="investigation-list">
      {page && <ArtifactRows rows={page.rows} select={setPreview} />}
      {loading && <p role="status">{t('control.rightRail.browse.loading')}</p>}
      {error && <div role="alert"><p>{t('control.rightRail.browse.error')}</p><Button variant="ghost" size="sm"
        onClick={() => setAttempt(value => value + 1)}>{t('control.rightRail.browse.retry')}</Button></div>}
      {!loading && !error && page?.rows.length === 0 && <p>{t('control.rightRail.artifacts.empty')}</p>}
      {!loading && !error && page?.nextCursor && <Button variant="ghost" size="sm"
        onClick={() => setCursor(page.nextCursor)}>{t('control.rightRail.browse.more')}</Button>}
    </TaskDialog>
    {preview && <RightRailInvestigationPreview key={preview.artifactId} sessionId={sessionId} row={preview} onClose={() => setPreview(null)} />}
  </>;
}

export const RightRailArtifactList: React.FC<{ artifacts: InvestigationArtifactsPanelViewModel }> = ({ artifacts }) => {
  const session = useProjectStore(state => state.currentSession);
  return session ? <ScopedArtifactList key={`${session.projectId}:${session.sessionId}`} artifacts={artifacts}
    projectId={session.projectId} sessionId={session.sessionId} /> : null;
};
export default RightRailArtifactList;
