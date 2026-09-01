import React from 'react';
import type { InvestigationArtifactKind, InvestigationArtifactStatus, InvestigationMission } from '@shared/types/renderdocInvestigation';
import type { InvestigationArtifactRow, InvestigationArtifactsPanelViewModel } from '@shared/types/trace';
import { useI18n, type TranslationKey } from '../../../i18n';
import { getElectronApi } from '../../../platform/getElectronApi';
import { Button } from '../../../ui/Button';
import { RightRailArtifactGlyph } from './RightRailArtifactGlyphs';

const kindKey = (kind: InvestigationArtifactKind): TranslationKey => `control.rightRail.artifacts.kind.${kind}` as TranslationKey;
const statusKey = (status: InvestigationArtifactStatus): TranslationKey => `control.rightRail.artifacts.status.${status}` as TranslationKey;
const missionKey = (mission: InvestigationMission): TranslationKey => `control.rightRail.artifacts.mission.${mission}` as TranslationKey;

const formatRelativeTime = (iso: string, language: string): string => {
  const deltaMs = Date.parse(iso) - Date.now();
  if (!Number.isFinite(deltaMs)) return iso;
  const absSec = Math.round(Math.abs(deltaMs) / 1000);
  const formatter = new Intl.RelativeTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en', { numeric: 'auto' });
  if (absSec < 60) return formatter.format(Math.round(deltaMs / 1000), 'second');
  if (absSec < 3600) return formatter.format(Math.round(deltaMs / 60000), 'minute');
  if (absSec < 86400) return formatter.format(Math.round(deltaMs / 3600000), 'hour');
  if (absSec < 86400 * 30) return formatter.format(Math.round(deltaMs / 86400000), 'day');
  return formatter.format(Math.round(deltaMs / (86400000 * 30)), 'month');
};

const rowTitle = (
  row: InvestigationArtifactRow,
  kindLabel: string,
): { text: string; title: string } => {
  const fallback = `${kindLabel} · ${row.artifactId.slice(0, 8)}`;
  if (!row.title || row.degraded) {
    return { text: fallback, title: row.degraded && row.contentHashShort ? row.contentHashShort : fallback };
  }
  return { text: row.title, title: row.title };
};

const rowClass = (row: InvestigationArtifactRow): string => {
  const status = row.degraded ? 'failed' : row.status;
  return `right-rail-investigation-row status-${status}${row.degraded ? ' is-degraded' : ''}`;
};

export const RightRailArtifactList: React.FC<{ artifacts: InvestigationArtifactsPanelViewModel }> = ({ artifacts }) => {
  const { t, language } = useI18n();
  return (
    <div className="right-rail-investigation-list">
      {artifacts.rows.map((row) => {
        const kindLabel = t(kindKey(row.kind));
        const heading = rowTitle(row, kindLabel);
        const meta = [
          kindLabel,
          t(row.degraded ? 'control.rightRail.artifacts.status.degraded' : statusKey(row.status)),
          formatRelativeTime(row.createdAt, language),
          t(missionKey(row.mission)),
          row.worldStateId ? t('control.rightRail.artifacts.worldState', { id: row.worldStateId }) : '',
          row.sourceRefCount > 0 ? t('control.rightRail.artifacts.sourceCount', { count: row.sourceRefCount }) : '',
        ].filter(Boolean).join(' · ');
        return (
          <article key={row.artifactId} className={rowClass(row)}>
            <span className="right-rail-investigation-icon" aria-hidden="true">
              <RightRailArtifactGlyph kind={row.kind} />
            </span>
            <span className="right-rail-investigation-copy">
              <strong title={heading.title}>{heading.text}</strong>
              <small>{meta}</small>
            </span>
            <span className="right-rail-investigation-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void getElectronApi()?.appShell.copyText(row.artifactId)}
              >
                {t('control.rightRail.artifacts.copyId')}
              </Button>
            </span>
          </article>
        );
      })}
      {artifacts.supersededCount > 0 || artifacts.truncatedCount > 0 ? (
        <footer className="right-rail-investigation-footer">
          {artifacts.supersededCount > 0 ? (
            <p>{t('control.rightRail.artifacts.supersededCount', { count: artifacts.supersededCount })}</p>
          ) : null}
          {artifacts.truncatedCount > 0 ? (
            <p>{t('control.rightRail.artifacts.truncated', { count: artifacts.truncatedCount })}</p>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
};

export default RightRailArtifactList;
