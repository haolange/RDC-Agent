import React from 'react';
import { AgentChat } from '../../components/AgentChat';
import { PlanIntakePanel } from '../../components/PlanIntakePanel';
import { useSessionStore } from '../../stores/sessionStore';
import './Debugger.css';

export const DebuggerPage: React.FC = () => {
  const currentRun = useSessionStore((s) => s.currentRun);

  if (currentRun) {
    return (
      <div className="debugger-page">
        <PlanIntakePanel />
        <AgentChat />
      </div>
    );
  }

  return (
    <div className="debugger-page debugger-workspace">
      <div className="workspace-shell">
        <section className="debugger-idle-simple">
          <div className="debugger-idle-emoji" aria-hidden="true">🙂</div>
          <h1 className="debugger-idle-simple-title">有什么能帮你？</h1>
          <p className="debugger-idle-description">选择一个项目和 Capture，开始智能调试之旅</p>
        </section>
      </div>
    </div>
  );
};

export default DebuggerPage;
