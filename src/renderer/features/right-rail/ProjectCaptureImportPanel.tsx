import React, { useCallback, useMemo, useState } from 'react';
import type { ProjectInputRecord } from '@shared/types/session';
import { importProjectInputs, refreshProjectInputs, removeProjectInput } from './projectCaptureActions';
import { useProjectStore } from '../../stores/projectStore';
import { SectionHeader } from '../../ui/SectionHeader';
import { EmptyState } from '../../ui/EmptyState';
import { IconButton } from '../../ui/IconButton';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
import './CaptureReplay.css';
import { useI18n } from '../../i18n';

const formatSize = (size: number): string => {
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
};

const formatImportError = (reason: unknown, sessionExpired: string): string => {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /^unauthorized(?:\s*\(401\))?$/i.test(message.trim())
    ? sessionExpired
    : message;
};

const CaptureFileIcon: React.FC = () => (
  <svg className="project-capture-input-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M5 2.75h6.2L15.5 7v10.25H5z" />
    <path d="M11.2 2.75V7h4.3M7.5 10.5h5M7.5 13h4" />
  </svg>
);

const InputRow: React.FC<{ input: ProjectInputRecord; remove: () => void; disabled: boolean; removeLabel: string }> = ({ input, remove, disabled, removeLabel }) => (
  <article
    className="project-capture-input-row"
    aria-label={`${input.fileName}, ${formatSize(input.size)}. ${input.filePath}`}
    title={input.filePath}
    role="listitem"
  >
    <CaptureFileIcon />
    <span className="project-capture-input-copy">
      <strong title={`${input.fileName}\n${input.filePath}`}>{input.fileName}</strong>
    </span>
    <span className="project-capture-input-actions"><span className="project-capture-input-size">{formatSize(input.size)}</span><Button variant="ghost" size="sm" aria-label={`${removeLabel} ${input.fileName}`} disabled={disabled} onClick={remove}>×</Button></span>
  </article>
);

export const ProjectCaptureImportPanel: React.FC = () => {
  const { t } = useI18n();
  const currentProject = useProjectStore((state) => state.currentProject);
  const projectInputs = useProjectStore((state) => state.projectInputs);
  const updateProjectInputs = useProjectStore((state) => state.updateProjectInputs);
  const [activeAction, setActiveAction] = useState<'import' | 'refresh' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      updateProjectInputs(currentProject.projectId, result.inputs ?? []);
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
            <IconButton
              label={t(activeAction === 'import' ? 'projectCapture.importing' : 'projectCapture.import')}
              title={t('projectCapture.import')}
              size="sm"
              onClick={() => void run('import')}
              disabled={activeAction !== null}
              aria-busy={activeAction === 'import'}
            >
              <Icon name="plus" size={16} />
            </IconButton>
            <IconButton
              label={t(activeAction === 'refresh' ? 'projectCapture.refreshing' : 'sidebar.refresh')}
              title={t('sidebar.refresh')}
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
          {error ? <div className="project-capture-import-error" role="alert">{error}</div> : null}
          {inputs.length ? <div className="project-capture-input-list" role="list" aria-label={t('projectCapture.title')}>{inputs.map((input) => <InputRow key={input.inputId} input={input} remove={() => void remove(input.inputId)} disabled={activeAction !== null} removeLabel={t('projectCapture.remove')} />)}</div> : <EmptyState className="right-rail-empty-state" title={t('projectCapture.empty')} />}
        </div>
      </section>
    </aside>
  );
};

export default ProjectCaptureImportPanel;
