import React, { useCallback, useMemo, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { SectionHeader } from '../../ui/SectionHeader';
import { EmptyState } from '../../ui/EmptyState';
import { IconButton } from '../../ui/IconButton';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
import { InlineError } from '../../ui/InlineError';
import { useI18n } from '../../i18n';
import { formatBytes } from '../../lib/formatBytes';
import { errorDetail } from '../../lib/errorDetail';
import { importProjectInputs, refreshProjectInputs, removeProjectInput } from './projectCaptureActions';
import { ProjectCaptureReferenceDialog } from './ProjectCaptureReferenceDialog';
import type { ProjectInputRecord } from '@shared/types/session';
import './CaptureReplay.css';

const formatImportError = (reason: unknown, sessionExpired: string): string => {
  const message = errorDetail(reason);
  return /^unauthorized(?:\s*\(401\))?$/i.test(message.trim())
    ? sessionExpired
    : message;
};

const CaptureFileIcon: React.FC = () => (
  <Icon name="file" className="project-capture-input-icon" />
);

const InputRow: React.FC<{ input: ProjectInputRecord; remove: () => void; disabled: boolean; removeLabel: string; referenceLabel: string }> = ({ input, remove, disabled, removeLabel, referenceLabel }) => {
  const { language } = useI18n();
  const size = formatBytes(input.size, language);
  return <article
    className="project-capture-input-row"
    aria-label={`${input.fileName}, ${size}. ${input.filePath}`}
    data-tooltip={input.filePath}
    role="listitem"
    tabIndex={0}
  >
    <CaptureFileIcon />
    <span className="project-capture-input-copy">
      <strong>{input.fileName}</strong>
      {input.source === 'external_reference' ? <span>{referenceLabel}</span> : null}
    </span>
    <span className="project-capture-input-actions"><span className="project-capture-input-size">{size}</span><Button variant="ghost" size="sm" aria-label={`${removeLabel} ${input.fileName}`} disabled={disabled} onClick={remove}><Icon name="close" size={14} /></Button></span>
  </article>;
};

export const ProjectCaptureImportPanel: React.FC = () => {
  const { t } = useI18n();
  const currentProject = useProjectStore((state) => state.currentProject);
  const projectInputs = useProjectStore((state) => state.projectInputs);
  const updateProjectInputs = useProjectStore((state) => state.updateProjectInputs);
  const [activeAction, setActiveAction] = useState<'import' | 'refresh' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [referenceProjectId, setReferenceProjectId] = useState<string | null>(null);
  const inputs = useMemo(() => projectInputs.filter((input) => input.fileName.toLowerCase().endsWith('.rdc')), [projectInputs]);

  const run = useCallback(async (action: 'import' | 'refresh') => {
    if (!currentProject) return;
    setActiveAction(action);
    setError(null);
    try {
      const result = action === 'import'
        ? await importProjectInputs(currentProject.projectId)
        : await refreshProjectInputs(currentProject.projectId);
      if (!result) return;
      updateProjectInputs(currentProject.projectId, result.inputs);
    } catch (reason) {
      setError(formatImportError(reason, t('projectCapture.sessionExpired')));
    } finally {
      setActiveAction(null);
    }
  }, [currentProject, updateProjectInputs, t]);

  const remove = async (inputId: string) => {
    if (!currentProject || activeAction) return;
    setActiveAction('remove'); setError(null);
    try {
      const result = await removeProjectInput(currentProject.projectId, inputId);
      if (result) {
        updateProjectInputs(currentProject.projectId, result.inputs);
        if (!result.success) setError(result.error ?? t('projectCapture.removeFailed'));
      }
    } catch (reason) { setError(formatImportError(reason, t('projectCapture.sessionExpired'))); }
    finally { setActiveAction(null); }
  };
  if (!currentProject) return null;

  return (
    <aside className="right-rail project-capture-rail" aria-label={t('projectCapture.title')} data-testid="project-capture-import-panel">
      <section className="right-rail-section project-capture-import-section">
        <SectionHeader
          className="project-capture-header"
          title={t('projectCapture.title')}
          actions={<>
            <IconButton label={t('projectCapture.reference')} data-tooltip={t('projectCapture.reference')}
              size="sm" disabled={activeAction !== null} onClick={() => setReferenceProjectId(currentProject.projectId)}>
              <Icon name="link" size={16} />
            </IconButton>
            <IconButton
              label={t(activeAction === 'import' ? 'projectCapture.importing' : 'projectCapture.import')}
              data-tooltip={t('projectCapture.import')}
              size="sm"
              onClick={() => void run('import')}
              disabled={activeAction !== null}
              aria-busy={activeAction === 'import'}
            >
              <Icon name="plus" size={16} />
            </IconButton>
            <IconButton
              label={t(activeAction === 'refresh' ? 'projectCapture.refreshing' : 'sidebar.refresh')}
              data-tooltip={t('sidebar.refresh')}
              size="sm"
              onClick={() => void run('refresh')}
              disabled={activeAction !== null}
              aria-busy={activeAction === 'refresh'}
            >
              <Icon name="refresh" size={16} />
            </IconButton>
          </>}
        />
        <div className="right-rail-section-content">
          {error ? <InlineError detail={error}>{t('app.error.actionFailed')}</InlineError> : null}
          {inputs.length ? <div className="project-capture-input-list" role="list" aria-label={t('projectCapture.title')}>{inputs.map((input) => <InputRow key={input.inputId} input={input} remove={() => void remove(input.inputId)} disabled={activeAction !== null} referenceLabel={t('projectCapture.external')} removeLabel={t(input.source === 'external_reference' ? 'projectCapture.detach' : 'projectCapture.remove')} />)}</div> : <EmptyState className="right-rail-empty-state" title={t('projectCapture.empty')} />}
        </div>
      </section>
      {referenceProjectId ? <ProjectCaptureReferenceDialog projectId={referenceProjectId} onClose={() => setReferenceProjectId(null)}
        onRegistered={(projectId, registered) => updateProjectInputs(projectId, registered)} /> : null}
    </aside>
  );
};

export default ProjectCaptureImportPanel;
