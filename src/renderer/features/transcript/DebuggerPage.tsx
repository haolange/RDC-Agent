import type { AgentMode } from '@shared/types/layout';
import { AgentChat } from './index';
import './Debugger.css';

export function DebuggerPage({ mode }: { mode: AgentMode }) {
  return (
    <div className="debugger-page" data-testid={`${mode}-workbench-page`}>
      <AgentChat mode={mode} />
    </div>
  );
}
