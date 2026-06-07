import React, { useEffect, useMemo, useState } from 'react';
import type {
  ConversationReasoningStep,
  ConversationReasoningTrace,
  ConversationToolCall,
} from '@shared/types/conversation';

interface ReasoningChainProps {
  trace: ConversationReasoningTrace;
}

const STEP_STATUS_GLYPH: Record<ConversationReasoningStep['status'], string> = {
  pending: 'o',
  running: '*',
  complete: 'ok',
  error: '!',
};

const TOOL_STATUS_GLYPH: Record<ConversationToolCall['status'], string> = {
  pending: 'o',
  running: '*',
  complete: 'ok',
  error: '!',
};

const TOOL_ICONS: Record<string, string> = {
  bash: '$',
  shell: '$',
  exec: '$',
  read: 'R',
  readfile: 'R',
  write: 'W',
  writefile: 'W',
  edit: 'E',
  web: 'W',
  search: 'S',
  grep: 'S',
  glob: 'S',
  list: 'L',
};

const inferToolIcon = (toolName: string): string => {
  const key = toolName.toLowerCase();
  for (const [match, glyph] of Object.entries(TOOL_ICONS)) {
    if (key.includes(match)) {
      return glyph;
    }
  }
  return 'T';
};

const formatDurationMs = (start?: number, end?: number): string => {
  if (!start) return '';
  const finish = end ?? Date.now();
  const ms = Math.max(0, finish - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
};

const aggregateStepCounts = (
  trace: ConversationReasoningTrace,
): { total: number; complete: number; running: number } => {
  let complete = 0;
  let running = 0;
  for (const step of trace.steps) {
    if (step.status === 'complete') complete += 1;
    else if (step.status === 'running') running += 1;
  }
  return { total: trace.steps.length, complete, running };
};

const ToolCallRow: React.FC<{ call: ConversationToolCall }> = ({ call }) => {
  const argsPreview = call.argsPreview?.trim();
  return (
    <div
      className={`reasoning-tool-row status-${call.status}`}
      data-testid="reasoning-tool-call"
    >
      <span className="reasoning-tool-row-icon" aria-hidden="true">
        {inferToolIcon(call.toolName)}
      </span>
      <span className="reasoning-tool-row-name">{call.toolName}</span>
      {argsPreview ? (
        <code className="reasoning-tool-row-args" title={argsPreview}>
          {argsPreview}
        </code>
      ) : null}
      <span
        className={`reasoning-tool-row-status status-${call.status}`}
        aria-label={call.status}
      >
        {TOOL_STATUS_GLYPH[call.status]}
      </span>
      {call.error ? (
        <span className="reasoning-tool-row-error" title={call.error}>
          {call.error}
        </span>
      ) : null}
    </div>
  );
};

const StepRow: React.FC<{ step: ConversationReasoningStep }> = ({ step }) => {
  const duration = formatDurationMs(step.startedAt, step.completedAt);
  return (
    <li
      className={`reasoning-step status-${step.status}`}
      data-testid="reasoning-step"
    >
      <span
        className={`reasoning-step-marker status-${step.status}`}
        aria-hidden="true"
      >
        {STEP_STATUS_GLYPH[step.status]}
      </span>
      <div className="reasoning-step-body">
        <div className="reasoning-step-title-row">
          <span className="reasoning-step-title">{step.title}</span>
          {step.stage ? (
            <span className="reasoning-step-stage">{step.stage}</span>
          ) : null}
          {duration ? (
            <span className="reasoning-step-duration">{duration}</span>
          ) : null}
        </div>
        {step.summary ? (
          <p className="reasoning-step-summary">{step.summary}</p>
        ) : null}
        {step.toolCalls.length > 0 ? (
          <div className="reasoning-step-tools" aria-label="工具轨迹">
            {step.toolCalls.map((call) => (
              <ToolCallRow key={call.id} call={call} />
            ))}
          </div>
        ) : null}
        {step.detail ? (
          <pre className="reasoning-step-detail">{step.detail}</pre>
        ) : null}
      </div>
    </li>
  );
};

export const ReasoningChain: React.FC<ReasoningChainProps> = ({ trace }) => {
  const isRunning = trace.status === 'running';
  const [expanded, setExpanded] = useState<boolean>(isRunning);

  const [autoCollapsedOnce, setAutoCollapsedOnce] = useState(false);
  useEffect(() => {
    if (isRunning) {
      setExpanded(true);
      setAutoCollapsedOnce(false);
    } else if (trace.status === 'complete' && !autoCollapsedOnce) {
      setExpanded(false);
      setAutoCollapsedOnce(true);
    }
  }, [trace.status, isRunning, autoCollapsedOnce]);

  const counts = useMemo(() => aggregateStepCounts(trace), [trace]);

  const headerLabel = useMemo(() => {
    if (isRunning) return '推理中';
    if (trace.status === 'error') return '推理失败';
    if (trace.status === 'stopped') return '推理已停止';
    if (trace.status === 'complete') return '推理轨迹';
    return '推理轨迹';
  }, [trace.status, isRunning]);

  return (
    <div
      className={`reasoning-chain status-${trace.status} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="reasoning-chain"
    >
      <button
        type="button"
        className="reasoning-chain-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span
          className={`reasoning-chain-caret ${expanded ? 'is-open' : ''}`}
          aria-hidden="true"
        >
          &gt;
        </span>
        <span className={`reasoning-chain-pulse status-${trace.status}`} aria-hidden="true" />
        <span className="reasoning-chain-label">{headerLabel}</span>
        <span className="reasoning-chain-meta">
          {counts.total > 0 ? (
            <>
              <span className="reasoning-chain-count">
                {counts.complete}/{counts.total}
              </span>
              {counts.running > 0 ? (
                <span className="reasoning-chain-running-dot" aria-hidden="true" />
              ) : null}
            </>
          ) : null}
        </span>
      </button>

      {expanded ? (
        <div className="reasoning-chain-body">
          {trace.summary ? (
            <p className="reasoning-chain-summary">{trace.summary}</p>
          ) : null}
          {trace.steps.length === 0 ? (
            <p className="reasoning-chain-empty">暂无推理轨迹或工具轨迹。</p>
          ) : (
            <ol className="reasoning-chain-steps">
              {trace.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default ReasoningChain;
