import React, { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../../ui/Button';
import { InlineError } from '../../ui/InlineError';
import { TaskDialog } from '../../ui/TaskDialog';
import { Chevron } from '../../ui/Chevron';
import { Skeleton } from '../../ui/Skeleton';
import { RevisionLanes } from '../../lib/revisionLanes';
import { RightRailArtifactGlyph } from './RightRailArtifactGlyphs';
import { RightRailInvestigationPreview } from './RightRailInvestigationPreview';
import { listInvestigationArtifacts } from './investigationPreviewActions';
import type {
  InvestigationArtifactRow,
  InvestigationArtifactsPanelViewModel,
  InvestigationListPage,
} from '@shared/types/trace';

function ArtifactRows({
  rows,
  select,
}: {
  rows: InvestigationArtifactRow[];
  select: (row: InvestigationArtifactRow) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="right-rail-investigation-list">
      {rows.map((row) => {
        const title = row.title || t(`control.rightRail.artifacts.kind.${row.kind}`);
        return (
          <Button
            key={row.artifactId}
            variant="ghost"
            className="right-rail-compact-row"
            data-tooltip={title}
            onClick={() => select(row)}
          >
            <span className="right-rail-compact-icon" aria-hidden="true">
              <RightRailArtifactGlyph kind={row.kind} />
            </span>
            <span className="right-rail-compact-title">{title}</span>
            <Chevron />
          </Button>
        );
      })}
    </div>
  );
}

function ScopedArtifactList({
  artifacts,
  projectId,
  sessionId,
}: {
  artifacts: InvestigationArtifactsPanelViewModel;
  projectId: string;
  sessionId: string;
}) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const [preview, setPreview] = useState<InvestigationArtifactRow | null>(null);
  const [page, setPage] = useState<InvestigationListPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState<InvestigationListPage['nextCursor']>();
  // Each page read is a revision of the list; one superseded by another page, scope or retry changes nothing.
  const [lanes] = useState(() => new RevisionLanes());
  useEffect(() => {
    if (!all) return;
    const revision = lanes.begin('page');
    const current = () => lanes.isLatest('page', revision);
    setLoading(true);
    setError(false);
    void listInvestigationArtifacts({ projectId, sessionId, cursor })
      .then((next) => {
        if (!current()) return;
        if (next.storeDegraded) {
          setError(true);
          return;
        }
        setPage((previous) => ({
          ...next,
          rows:
            cursor && previous
              ? [
                  ...previous.rows,
                  ...next.rows.filter((row) => !previous.rows.some((old) => old.artifactId === row.artifactId)),
                ]
              : next.rows,
        }));
      })
      .catch(() => {
        if (current()) setError(true);
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => {
      lanes.forget('page');
    };
  }, [lanes, all, projectId, sessionId, cursor, attempt]);
  return (
    <>
      <ArtifactRows rows={artifacts.rows} select={setPreview} />
      {artifacts.totalCount > 5 && (
        <Button
          variant="ghost"
          size="sm"
          className="right-rail-browse-all"
          onClick={() => {
            setPage(null);
            setCursor(undefined);
            setAll(true);
          }}
        >
          {t('control.rightRail.browse.all', { count: artifacts.totalCount })}
        </Button>
      )}
      <TaskDialog
        open={all}
        title={t('control.rightRail.artifacts.title')}
        closeLabel={t('control.rightRail.browse.close')}
        onClose={() => setAll(false)}
        dataTestId="investigation-list"
      >
        {page && <ArtifactRows rows={page.rows} select={setPreview} />}
        {loading && (
          <div role="status" aria-label={t('control.rightRail.browse.loading')}>
            <Skeleton shape="row" count={4} />
          </div>
        )}
        {error && (
          <InlineError
            onRetry={() => setAttempt((value) => value + 1)}
            retryLabel={t('control.rightRail.browse.retry')}
          >
            {t('control.rightRail.browse.error')}
          </InlineError>
        )}
        {!loading && !error && page?.rows.length === 0 && <p>{t('control.rightRail.artifacts.empty')}</p>}
        {!loading && !error && page?.nextCursor && (
          <Button variant="ghost" size="sm" onClick={() => setCursor(page.nextCursor)}>
            {t('control.rightRail.browse.more')}
          </Button>
        )}
      </TaskDialog>
      {preview && (
        <RightRailInvestigationPreview
          key={preview.artifactId}
          sessionId={sessionId}
          row={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

export const RightRailArtifactList: React.FC<{ artifacts: InvestigationArtifactsPanelViewModel }> = ({ artifacts }) => {
  const projectId = useProjectStore((state) => state.currentProject?.projectId);
  const sessionId = useProjectStore((state) => state.currentSessionId);
  return projectId && sessionId ? (
    <ScopedArtifactList
      key={`${projectId}:${sessionId}`}
      artifacts={artifacts}
      projectId={projectId}
      sessionId={sessionId}
    />
  ) : null;
};
export default RightRailArtifactList;
