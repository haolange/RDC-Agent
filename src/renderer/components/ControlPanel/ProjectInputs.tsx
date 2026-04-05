import React, { useMemo, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useDeviceStore } from '../../stores/deviceStore';
import type { CaptureDescriptor, ProjectInputRecord } from '@shared/types/session';

const formatSize = (size: number): string => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
};

const createImportedCapture = (input: ProjectInputRecord, existingCount: number): CaptureDescriptor => ({
  id: input.inputId,
  filePath: input.filePath,
  role: existingCount === 0 ? 'primary' : 'reference',
  backendHint: 'local',
  status: 'pending',
});

export const ProjectInputs: React.FC = () => {
  const currentProject = useSessionStore((state) => state.currentProject);
  const projectInputs = useSessionStore((state) => state.projectInputs);
  const captures = useSessionStore((state) => state.captures);
  const openedCapture = useSessionStore((state) => state.openedCapture);
  const addCapture = useSessionStore((state) => state.addCapture);
  const setProjectInputs = useSessionStore((state) => state.setProjectInputs);
  const setOpenedCapture = useSessionStore((state) => state.setOpenedCapture);

  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const devices = useDeviceStore((state) => state.devices);

  const [openingId, setOpeningId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedDeviceEntry = useMemo(
    () => devices.find((device) => device.id === selectedDevice) ?? devices[0] ?? null,
    [devices, selectedDevice],
  );

  const handleRefresh = async () => {
    if (!currentProject) return;
    setIsRefreshing(true);
    try {
      const result = await window.electronAPI.project.inputs.refresh(currentProject.projectId);
      setProjectInputs(result.inputs ?? []);
      setErrorMessage(null);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleImport = async () => {
    if (!currentProject) return;
    setIsImporting(true);
    try {
      const result = await window.electronAPI.project.inputs.import(currentProject.projectId);
      setProjectInputs(result.inputs ?? []);
      setErrorMessage(result.error ?? null);
    } finally {
      setIsImporting(false);
    }
  };

  const handleAddToSession = (input: ProjectInputRecord) => {
    addCapture(createImportedCapture(input, captures.length));
    setErrorMessage(null);
  };

  const handleOpen = async (input: ProjectInputRecord) => {
    if (!currentProject || !selectedDeviceEntry) return;
    setOpeningId(input.inputId);
    try {
      if (
        selectedDeviceEntry.type === 'android'
        && !['connected', 'online'].includes(selectedDeviceEntry.status)
      ) {
        setErrorMessage('正在连接 Android RenderDoc…');
      }

      const result = await window.electronAPI.capture.openProjectInput({
        projectId: currentProject.projectId,
        inputId: input.inputId,
        filePath: input.filePath,
        replayDeviceId: selectedDeviceEntry.id,
      });
      if (result.success) {
        setOpenedCapture(result.openedCapture ?? null);
        setErrorMessage(null);
      } else {
        setErrorMessage(result.error ?? '打开失败。');
      }
    } finally {
      setOpeningId(null);
    }
  };

  if (!currentProject) {
    return <div className="project-inputs-empty">请选择一个项目以查看 `.resource/inputs`。</div>;
  }

  return (
    <div className="project-inputs">
      <div className="project-inputs-toolbar">
        <button
          type="button"
          className="context-action-btn"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
        >
          <span>{isRefreshing ? '刷新中…' : '刷新'}</span>
        </button>
        <button
          type="button"
          className="context-action-btn"
          onClick={() => void handleImport()}
          disabled={isImporting}
        >
          <span>{isImporting ? '导入中…' : '导入 .rdc'}</span>
        </button>
      </div>

      {errorMessage && <div className="project-inputs-error">{errorMessage}</div>}

      {projectInputs.length === 0 ? (
        <div className="project-inputs-empty">
          &lt;project-root&gt;/.resource/inputs 下还没有 `.rdc` 文件。
        </div>
      ) : (
        <div className="project-inputs-list">
          {projectInputs.map((input) => {
            const imported = captures.some((capture) => capture.id === input.inputId);
            const isOpened = openedCapture?.inputId === input.inputId && openedCapture.status === 'open';
            return (
              <div key={input.inputId} className={`project-input-item ${isOpened ? 'opened' : ''}`}>
                <div className="project-input-item-main">
                  <div className="project-input-item-copy">
                    <div className="project-input-item-name">{input.fileName}</div>
                    <div className="project-input-item-path" title={input.filePath}>{input.filePath}</div>
                  </div>
                  <div className="project-input-item-meta">
                    <span>{formatSize(input.size)}</span>
                    <span className="capture-item-separator">·</span>
                    <span>{new Date(input.lastModifiedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="project-input-item-actions">
                  <button
                    type="button"
                    className={`button button-sm ${imported ? 'button-secondary' : 'button-ghost'}`}
                    onClick={() => handleAddToSession(input)}
                  >
                    {imported ? '已导入' : '导入'}
                  </button>
                  <button
                    type="button"
                    className="button button-primary button-sm"
                    onClick={() => void handleOpen(input)}
                    disabled={openingId === input.inputId}
                  >
                    {openingId === input.inputId ? '打开中…' : '打开'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProjectInputs;
