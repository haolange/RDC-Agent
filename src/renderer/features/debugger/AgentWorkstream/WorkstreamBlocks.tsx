import React, { useState } from 'react';
import type {
  BranchNavigatorViewModel,
  ProcessTraceItemViewModel,
  TaskResultViewModel,
  TaskWorkstreamViewModel,
  ToolRowViewModel,
  UserPromptBubbleViewModel,
  WorkstreamArtifactRecord,
} from '@shared/types/workstream';
import { useElectronApi } from '../../../hooks/useElectronApi';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useSessionStore } from '../../../stores/sessionStore';

export const formatTime = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const statusLabel = (status: string): string => {
  if (status === 'awaiting_approval') return 'awaiting approval';
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  if (status === 'skipped') return 'skipped';
  return status;
};

export const copyText = async (text: string) => {
  const api = getElectronApi();
  if (api?.appShell.copyText) {
    await api.appShell.copyText(text);
    return;
  }
  await navigator.clipboard?.writeText(text);
};

const PromptBranchNavigator: React.FC<{
  navigator: BranchNavigatorViewModel;
  sessionId: string;
}> = ({ navigator, sessionId }) => {
  const handlePrev = () => {
    const prev = navigator.branches[Math.max(navigator.branchIndex - 1, 0)];
    if (prev) void getElectronApi()?.workflow.switchWorkstreamBranch(sessionId, prev.id);
  };
  const handleNext = () => {
    const next = navigator.branches[Math.min(navigator.branchIndex + 1, navigator.branches.length - 1)];
    if (next) void getElectronApi()?.workflow.switchWorkstreamBranch(sessionId, next.id);
  };
  return (
    <nav className="aw-prompt-branch-nav" data-testid="aw-prompt-branch-nav">
      <button type="button" onClick={handlePrev} disabled={navigator.branchIndex <= 0}>‹</button>
      <span>{navigator.branchIndex + 1}/{navigator.branchCount}</span>
      <button type="button" onClick={handleNext} disabled={navigator.branchIndex >= navigator.branchCount - 1}>›</button>
    </nav>
  );
};

export const UserPromptBubble: React.FC<{ prompt: UserPromptBubbleViewModel; sessionId: string }> = ({ prompt, sessionId }) => {
  const electronAPI = useElectronApi();
  const currentRun = useSessionStore((state) => state.currentRun);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prompt.prompt);
  const isLong = prompt.prompt.length > 360 || prompt.prompt.split(/\r?\n/).length > 6;

  const submitEdit = async () => {
    const trimmed = draft.trim();
    if (!electronAPI || !trimmed || trimmed === prompt.prompt) {
      setEditing(false);
      return;
    }
    const activeRunId = currentRun?.runId ?? null;
    if (activeRunId) {
      await electronAPI.workflow.requestPlanRevision(activeRunId, trimmed);
    }
    setEditing(false);
  };

  return (
    <section className="aw-user-prompt" data-testid="aw-user-prompt">
      {prompt.branchNavigator && prompt.branchNavigator.branchCount > 1 ? (
        <PromptBranchNavigator navigator={prompt.branchNavigator} sessionId={sessionId} />
      ) : null}
      <header className="aw-user-prompt-meta">
        <span>Prompt</span>
        <span title={prompt.createdAt}>{formatTime(prompt.createdAt)}</span>
      </header>
      {editing ? (
        <div className="aw-user-prompt-editor">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} />
          <div className="aw-inline-actions">
            <button type="button" onClick={() => { setDraft(prompt.prompt); setEditing(false); }}>取消</button>
            <button type="button" className="primary" onClick={() => void submitEdit()}>提交修改</button>
          </div>
        </div>
      ) : (
        <>
          <div className={`aw-user-prompt-body ${isLong && !expanded ? 'collapsed' : ''}`}>
            {prompt.prompt}
            {isLong && !expanded ? <span className="aw-user-prompt-fade" aria-hidden="true" /> : null}
          </div>
          <footer className="aw-user-prompt-actions">
            <span className="aw-branch-pill">{prompt.branchIndex + 1}/{prompt.branchCount}</span>
            <button type="button" onClick={() => void copyText(prompt.prompt)}>Copy</button>
            <button type="button" onClick={() => setEditing(true)}>Edit</button>
            {isLong ? (
              <button type="button" className="aw-prompt-expand" onClick={() => setExpanded((current) => !current)}>
                {expanded ? '⌃' : '⌄'}
              </button>
            ) : null}
          </footer>
        </>
      )}
    </section>
  );
};

const ThinkingBubble: React.FC<{ item: Extract<ProcessTraceItemViewModel, { kind: 'agent_thinking' }> }> = ({ item }) => (
  <article className="aw-thinking-bubble" data-testid="aw-thinking-bubble" title={item.createdAt}>
    <p>{item.text}</p>
  </article>
);

const ToolRow: React.FC<{ item: ToolRowViewModel }> = ({ item }) => {
  const [expanded, setExpanded] = useState(item.status === 'failed');
  const [tab, setTab] = useState<'summary' | 'input' | 'output' | 'artifacts' | 'raw'>('summary');
  return (
    <article className={`aw-tool-row status-${item.status}`} data-testid="aw-tool-row">
      <button type="button" className="aw-row-head" onClick={() => setExpanded((current) => !current)}>
        <span className={`aw-status-dot ${item.status}`} />
        <span className="aw-row-title">{statusLabel(item.status)} · {item.title}</span>
        {item.target ? <span className="aw-row-target">{item.target}</span> : null}
        {item.durationMs ? <span className="aw-row-duration">{Math.round(item.durationMs)}ms</span> : null}
        <span className="aw-row-caret">{expanded ? '⌃' : '⌄'}</span>
      </button>
      {expanded ? (
        <div className="aw-row-detail">
          <div className="aw-tabs">
            {(['summary', 'input', 'output', 'artifacts', 'raw'] as const).map((entry) => (
              <button key={entry} type="button" className={tab === entry ? 'active' : ''} onClick={() => setTab(entry)}>
                {entry}
              </button>
            ))}
          </div>
          <pre className="aw-row-pre">
            {tab === 'summary' ? item.errorSummary || item.summary : null}
            {tab === 'input' ? item.inputRef || 'No input ref' : null}
            {tab === 'output' ? item.outputRef || item.summary : null}
            {tab === 'artifacts' ? (item.artifactIds.length ? item.artifactIds.join('\n') : 'No linked artifacts') : null}
            {tab === 'raw' ? item.rawTraceRef || 'No raw trace ref' : null}
          </pre>
        </div>
      ) : null}
    </article>
  );
};

const SubAgentRow: React.FC<{ item: Extract<ProcessTraceItemViewModel, { kind: 'subagent_row' }> }> = ({ item }) => {
  const [expanded, setExpanded] = useState(false);
  const [nestedVisible, setNestedVisible] = useState(false);
  return (
    <article className={`aw-subagent-row status-${item.status}`} data-testid="aw-subagent-row">
      <button type="button" className="aw-row-head" onClick={() => setExpanded((current) => !current)}>
        <span className={`aw-status-dot ${item.status}`} />
        <span className="aw-row-title">{statusLabel(item.status)} · Sub Agent · {item.label}</span>
        <span className="aw-row-target">{item.summary}</span>
        <span className="aw-row-caret">{expanded ? '⌃' : '⌄'}</span>
      </button>
      {expanded ? (
        <div className="aw-row-detail">
          <p>{item.resultSummary || item.summary}</p>
          {item.rawTraceRef ? <pre className="aw-row-pre">{item.rawTraceRef}</pre> : null}
          {item.nestedWorkstream ? (
            <>
              <button type="button" className="aw-detail-link" onClick={() => setNestedVisible((current) => !current)}>
                查看完整轨迹
              </button>
              {nestedVisible ? (
                <div className="aw-nested-workstream">
                  <strong>{item.nestedWorkstream.title}</strong>
                  {item.nestedWorkstream.process.map((event) => (
                    <pre key={event.id} className="aw-row-pre">{JSON.stringify(event, null, 2)}</pre>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
};

const ProcessTrace: React.FC<{ task: TaskWorkstreamViewModel }> = ({ task }) => {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  if (task.process.items.length === 0) {
    return null;
  }
  const isExpanded = userExpanded ?? !task.process.collapsed;
  const durationSec = task.process.thinkingDurationMs
    ? Math.round(task.process.thinkingDurationMs / 1000)
    : null;
  const toggleLabel = durationSec
    ? `Thought for ${durationSec}s`
    : task.status === 'running' ? 'Thinking...' : 'Thought process';

  return (
    <div className="aw-process-trace-wrapper" data-testid="aw-process-trace">
      <button
        type="button"
        className={`aw-thought-toggle ${isExpanded ? 'expanded' : ''}`}
        onClick={() => setUserExpanded((current) => (current === null ? isExpanded : !current))}
      >
        <span>{toggleLabel}</span>
        <span>{isExpanded ? '⌃' : '⌄'}</span>
      </button>
      {isExpanded && (
        <div className="aw-process-trace-items">
          {task.process.items.map((item) => {
            if (item.kind === 'agent_thinking') return <ThinkingBubble key={item.id} item={item} />;
            if (item.kind === 'tool_row') return <ToolRow key={item.id} item={item} />;
            return <SubAgentRow key={item.id} item={item} />;
          })}
        </div>
      )}
    </div>
  );
};

const TaskResultBlock: React.FC<{ result: TaskResultViewModel }> = ({ result }) => {
  const [expanded, setExpanded] = useState(result.kind !== 'report');
  return (
    <article className={`aw-result-block result-${result.kind}`} data-testid="aw-result-block">
      <header className="aw-result-header">
        <div>
          <span className="aw-kicker">{result.kind}</span>
          <h3>{result.title}</h3>
        </div>
        <span className={`aw-result-status status-${result.status}`}>{String(result.status)}</span>
      </header>
      <div className={`aw-result-sections ${expanded ? 'expanded' : 'collapsed'}`}>
        {result.sections.map((section) => (
          <section key={section.id} className={`aw-result-section severity-${section.severity ?? 'normal'}`}>
            <h4>{section.title}</h4>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
      <footer className="aw-result-footer">
        <button type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? '折叠' : '展开'}
        </button>
        {result.artifacts.map((artifact) => <ArtifactPill key={artifact.id} artifact={artifact} />)}
      </footer>
    </article>
  );
};

const ArtifactPill: React.FC<{ artifact: WorkstreamArtifactRecord }> = ({ artifact }) => (
  <button
    type="button"
    className="aw-artifact-pill"
    title={artifact.path || artifact.uri || artifact.displayName}
    onClick={() => {
      if (artifact.path) {
        void getElectronApi()?.appShell.openPath(artifact.path);
      }
    }}
  >
    {artifact.displayName}
  </button>
);

export const UserEvent: React.FC<{ kind: 'confirmed' | 'revision'; label: string; createdAt: string }> = ({ kind, label, createdAt }) => (
  <article className={`aw-user-event ${kind}`} data-testid={`aw-user-${kind}`}>
    <span>{kind === 'confirmed' ? 'User Confirmation' : 'User Revision'}</span>
    <p>{label}</p>
    <time title={createdAt}>{formatTime(createdAt)}</time>
  </article>
);

export const TaskWorkstream: React.FC<{ task: TaskWorkstreamViewModel; sessionId: string }> = ({ task, sessionId }) => (
  <div className="aw-task-workstream" data-testid="aw-task-workstream">
    {task.prompt ? <UserPromptBubble prompt={task.prompt} sessionId={sessionId} /> : null}
    <div className="aw-agent-reply" data-testid="aw-agent-reply">
      <ProcessTrace task={task} />
      {task.result ? <TaskResultBlock result={task.result} /> : null}
    </div>
  </div>
);
