import React, { useState, useCallback } from 'react';
import { WorkflowPanel } from '../../components/WorkflowPanel';
import { AgentChat } from '../../components/AgentChat';
import { EvidencePanel } from '../../components/EvidencePanel';
import { ArtifactViewer } from '../../components/ArtifactViewer';

/**
 * Debugger Page - 主调试页面
 */
export const DebuggerPage: React.FC = () => {
  const [hasStarted, setHasStarted] = useState(false);
  const [capturePaths, setCapturePaths] = useState<string[]>([]);

  // 处理文件上传
  const handleFileSelect = useCallback(async () => {
    if (window.electronAPI) {
      const paths = await window.electronAPI.selectRdcFiles();
      if (paths && paths.length > 0) {
        setCapturePaths(paths);
      }
    }
  }, []);

  // 开始调试
  const handleStart = useCallback(async () => {
    if (capturePaths.length === 0) {
      alert('Please select at least one .rdc file');
      return;
    }
    if (window.electronAPI) {
      await window.electronAPI.workflow.start(capturePaths, 'Debug rendering issue');
      setHasStarted(true);
    }
  }, [capturePaths]);

  // 拖放处理
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files)
      .filter(f => f.name.endsWith('.rdc'))
      .map(f => f.path);
    if (files.length > 0) {
      setCapturePaths(prev => [...prev, ...files]);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div className="debugger-page">
      {/* 工作流状态面板 */}
      <WorkflowPanel />

      {/* 主内容区 */}
      <div className="debugger-main">
        {!hasStarted ? (
          // 欢迎/初始化界面
          <div
            className="welcome-container"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <div className="welcome-content">
              <h1>Welcome to RdcAgent</h1>
              <p>Upload a RenderDoc capture file to start debugging</p>

              <div className="upload-area">
                <div className="upload-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <p>Drag & drop .rdc files here</p>
                <button className="button button-primary" onClick={handleFileSelect}>
                  Select Files
                </button>
              </div>

              {capturePaths.length > 0 && (
                <div className="selected-files">
                  <h3>Selected Files:</h3>
                  <ul>
                    {capturePaths.map((path, index) => (
                      <li key={index}>{path.split(/[/\\]/).pop()}</li>
                    ))}
                  </ul>
                  <button className="button button-primary" onClick={handleStart}>
                    Start Debug Session
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          // 调试界面
          <div className="debugger-workspace">
            {/* 左侧：对话区 */}
            <div className="workspace-left">
              <AgentChat />
            </div>

            {/* 右侧：证据链和Artifact */}
            <div className="workspace-right">
              <EvidencePanel />
              <ArtifactViewer />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DebuggerPage;
