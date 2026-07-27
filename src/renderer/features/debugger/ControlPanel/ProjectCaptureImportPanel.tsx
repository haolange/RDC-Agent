import React, { useCallback, useMemo, useState } from 'react';
import type { ProjectInputRecord } from '@shared/types/session';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useProjectStore } from '../../../stores/projectStore';
import { Button } from '../../../ui/Button';

const formatSize = (size: number): string => (
  size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`
);

const CaptureFileIcon: React.FC = () => (
  <svg className="project-capture-input-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M5 2.75h6.2L15.5 7v10.25H5z" />
    <path d="M11.2 2.75V7h4.3M7.5 10.5h5M7.5 13h4" />
  </svg>
);

const InputRow: React.FC<{ input: ProjectInputRecord }> = ({ input }) => (
  <article className="project-capture-input-row">
    <CaptureFileIcon />
    <span className="project-capture-input-copy">
      <strong title={input.fileName}>{input.fileName}</strong>
      <small title={input.filePath}>{input.filePath}</small>
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
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActiveAction(null);
    }
  }, [currentProject, updateProjectInputs]);

  if (!currentProject) return null;

  return (
    <aside className="right-rail project-capture-rail" aria-label="Project capture inputs" data-testid="project-capture-import-panel">
      <section className="project-capture-import-section">
        <h2>Capture files</h2>
        <p>Import RenderDoc captures for this project.</p>
        <div className="project-capture-import-actions">
          <Button variant="primary" size="sm" onClick={() => void run('import')} disabled={activeAction !== null}>
            {activeAction === 'import' ? 'Importing...' : 'Import .rdc'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void run('refresh')} disabled={activeAction !== null}>
            {activeAction === 'refresh' ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      {error ? <p className="project-capture-import-error" role="alert">{error}</p> : null}
      <section className="project-capture-inputs-section" aria-label="Imported captures">
        <h3>Captures</h3>
        {inputs.length ? <div className="project-capture-input-list">{inputs.map((input) => <InputRow key={input.inputId} input={input} />)}</div> : <p className="project-capture-inputs-empty">Imported .rdc files appear here.</p>}
      </section>
      </section>
    </aside>
  );
};

export default ProjectCaptureImportPanel;
