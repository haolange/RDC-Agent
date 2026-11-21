import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { formatBytes } from '../../lib/formatBytes';
import { copyAppText, openAppPath } from '../../hooks/appShellBridge';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { Menu } from '../../ui/Menu';
import type { TraceArtifactRecord } from '@shared/types/trace';

interface RightRailOutputListProps { current: TraceArtifactRecord[]; previous: TraceArtifactRecord[]; }

/** One output: its name and one action. The size rides on the hover text; copying the path lives in「更多」. */
const OutputRow: React.FC<{ artifact: TraceArtifactRecord }> = ({ artifact }) => {
  const { t, language } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const failed = artifact.status === 'failed';
  const size = typeof artifact.sizeBytes === 'number' ? formatBytes(artifact.sizeBytes, language) : '';
  return (
    <article className={`right-rail-artifact-row status-${artifact.status}`}>
      <span className="right-rail-artifact-icon" aria-hidden="true"><Icon name="file" /></span>
      <span className="right-rail-artifact-copy">
        <strong data-tooltip={[artifact.displayName, size].filter(Boolean).join(' · ')}>{artifact.displayName}</strong>
      </span>
      <span className="right-rail-output-actions">
        {failed ? <span className="right-rail-output-missing">{t('control.rightRail.outputs.missing')}</span> : (
          <Button variant="ghost" size="sm" onClick={() => artifact.path && void openAppPath(artifact.path)} disabled={!artifact.path}>
            {t('control.rightRail.outputs.open')}
          </Button>
        )}
        <Menu open={menuOpen} onOpenChange={setMenuOpen} align="end" label={t('control.rightRail.outputs.more')}
          items={[{ id: 'copy-path', label: t('control.rightRail.outputs.copyPath'), disabled: !artifact.path,
            onSelect: () => artifact.path && void copyAppText(artifact.path) }]}
          trigger={<IconButton size="sm" label={t('control.rightRail.outputs.more')} data-tooltip={t('control.rightRail.outputs.more')}>
            <Icon name="more" size={16} />
          </IconButton>} />
      </span>
    </article>
  );
};

export const RightRailOutputList: React.FC<RightRailOutputListProps> = React.memo(({ current, previous }) => (
  <div className="right-rail-artifact-list">
    {[...current, ...previous].map((artifact) => <OutputRow key={artifact.id} artifact={artifact} />)}
  </div>
));

export default RightRailOutputList;
