import React, { useCallback, useMemo, useState } from 'react';
import type { ProjectInputRecord } from '@shared/types/session';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useProjectStore } from '../../../stores/projectStore';
import { Button } from '../../../ui/Button';

const formatSize = (size: number): string => {
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
};

const formatImportError = (reason: unknown): string => {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /^unauthorized(?:\s*\(401\))?$/i.test(message.trim())
    ? 'Session expired. Refresh to reconnect.'
    : message;
};

const CaptureFileIcon: React.FC = () => (
  <svg className="project-capture-input-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M5 2.75h6.2L15.5 7v10.25H5z" />
    <path d="M11.2 2.75V7h4.3M7.5 10.5h5M7.5 13h4" />
  </svg>
);

const InputRow: React.FC<{ input: ProjectInputRecord }> = ({ input }) => (
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
    <span className="project-capture-input-size">{formatSize(input.size)}</span>
  </article>
);

export const ProjectCaptureImportPanel: React.FC = () => {
  const currentProject = useProjectStore((state) => state.currentProject);
  const projectInputs = useProjectStore((state) => state.projectInputs);
  const updateProjectInputs = useProjectStore((state) => state.updateProjectInputs);
  const [activeAction, setActiveAction] = useState<'import' | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useMemo(() => projectInputs.filter((input) => input.fileName.toLowerCase().endsWith('.rdc')), [projectInputs]);

  const run = useCallback(async (action: 'import' | 'refresh') => {
    if (!currentProject) return;
    const api = getElectronApi();
    if (!api) return;
    setActiveAction(action);
    setError(null);
    try {
      const result = action === 'import'
        ? await api.project.inputs.import(currentProject.projectId)
        : await api.project.inputs.refresh(currentProject.projectId);
      updateProjectInputs(currentProject.projectId, result.inputs ?? []);
    } catch (reason) {
      setError(formatImportError(reason));
    } finally {
      setActiveAction(null);
    }
  }, [currentProject, updateProjectInputs]);

  if (!currentProject) return null;

  return (
    <aside className="right-rail project-capture-rail" aria-label="Project capture inputs" data-testid="project-capture-import-panel">
      <section className="right-rail-section project-capture-import-section">
        <h2 className="right-rail-section-heading">Capture files</h2>
        <div className="right-rail-section-content">
          <p>Import RenderDoc captures for this project.</p>
          <div className="project-capture-import-actions">
            <Button className="project-capture-import-primary" variant="primary" size="md" onClick={() => void run('import')} disabled={activeAction !== null}>
              {activeAction === 'import' ? 'Importing...' : 'Import .rdc'}
            </Button>
            <Button className="project-capture-import-refresh" variant="secondary" size="md" onClick={() => void run('refresh')} disabled={activeAction !== null}>
              {activeAction === 'refresh' ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
          {error ? <div className="project-capture-import-error" role="alert">{error}</div> : null}
          {inputs.length ? <div className="project-capture-input-list" role="list" aria-label="Imported captures">{inputs.map((input) => <InputRow key={input.inputId} input={input} />)}</div> : <p className="project-capture-inputs-empty">Imported .rdc files appear here.</p>}
        </div>
      </section>
    </aside>
  );
};

export default ProjectCaptureImportPanel;
