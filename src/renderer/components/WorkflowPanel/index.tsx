import React, { useState, useEffect } from 'react';
import { SIMPLIFIED_STAGES, STAGE_DISPLAY_NAMES } from '@shared/constants/stages';
import type { WorkflowStage } from '@shared/types/workflow';

/**
 * WorkflowPanel - 工作流状态面板
 * 显示当前工作流进度和阶段状态
 */
export const WorkflowPanel: React.FC = () => {
  const [currentStage, setCurrentStage] = useState<WorkflowStage>('preflight_pending');
  const [eventCount, setEventCount] = useState(0);
  const [blockerCount, setBlockerCount] = useState(0);

  useEffect(() => {
    // 监听工作流状态变化
    if (window.electronAPI) {
      window.electronAPI.on('workflow:stateChanged', (state: unknown) => {
        const workflowState = state as { currentStage: WorkflowStage; blockers: unknown[] };
        setCurrentStage(workflowState.currentStage);
        setBlockerCount(workflowState.blockers?.length || 0);
      });

      window.electronAPI.on('evidence:eventAdded', () => {
        setEventCount(prev => prev + 1);
      });
    }

    return () => {
      // 清理监听器
    };
  }, []);

  // 获取阶段索引
  const getStageIndex = (stage: WorkflowStage): number => {
    for (let i = 0; i < SIMPLIFIED_STAGES.length; i++) {
      if (SIMPLIFIED_STAGES[i].stages.includes(stage)) {
        return i;
      }
    }
    return 0;
  };

  const currentStageIndex = getStageIndex(currentStage);

  return (
    <div className="workflow-panel">
      <div className="workflow-stages">
        {SIMPLIFIED_STAGES.map((stage, index) => {
          const isActive = index === currentStageIndex;
          const isCompleted = index < currentStageIndex;
          const isBlocked = currentStage === 'validation_blocked' && isActive;

          return (
            <div
              key={stage.id}
              className={`workflow-stage ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''} ${isBlocked ? 'blocked' : ''}`}
            >
              <div className="stage-indicator">
                {isCompleted ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : isBlocked ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                ) : (
                  <span className="stage-number">{index + 1}</span>
                )}
              </div>
              <span className="stage-name">{stage.name}</span>
              {index < SIMPLIFIED_STAGES.length - 1 && (
                <div className={`stage-connector ${isCompleted ? 'completed' : ''}`} />
              )}
            </div>
          );
        })}
      </div>

      <div className="workflow-info">
        <span className="info-item">
          Stage: <strong>{STAGE_DISPLAY_NAMES[currentStage]}</strong>
        </span>
        <span className="info-item">
          Events: <strong>{eventCount}</strong>
        </span>
        {blockerCount > 0 && (
          <span className="info-item blocker">
            Blockers: <strong>{blockerCount}</strong>
          </span>
        )}
      </div>
    </div>
  );
};

export default WorkflowPanel;
