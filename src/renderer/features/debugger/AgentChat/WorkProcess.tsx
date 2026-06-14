import React, { useEffect, useMemo, useState } from 'react';
import type {
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';

interface WorkProcessProps {
  trace: ConversationWorkTrace;
}

const BLOCK_STATUS_LABEL: Record<ConversationWorkBlock['status'], string> = {
  pending: '等待',
  running: '进行中',
  complete: '完成',
  error: '失败',
};

const TOOL_STATUS_LABEL: Record<ConversationToolCall['status'], string> = {
  pending: '等待',
  running: '进行中',
  complete: '完成',
  error: '失败',
};

const BLOCK_KIND_LABEL: Record<ConversationWorkBlock['kind'], string> = {
  reasoning: '摘要',
  tool: '工具',
  approval: '决策',
  compaction: '压缩',
  subagent: '子智能体',
  handoff: '交接',
  diagnostic: '诊断',
  output: '回答',
};

const BLOCK_STAGE_LABEL: Record<string, string> = {
  preflight: '准备',
  respond: '回答',
  tool: '工具',
  decision: '决策',
  handoff: '交接',
  investigate: '执行',
  report: '报告',
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
  agent: 'A',
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

const getStageLabel = (stage?: string): string => {
  if (!stage) return '';
  return BLOCK_STAGE_LABEL[stage] ?? '';
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

const aggregateBlockCounts = (
  trace: ConversationWorkTrace,
): { total: number; complete: number; running: number; important: boolean } => {
  const longRunningThresholdMs = 8_000;
  let complete = 0;
  let running = 0;
  let important = trace.status === 'error';
  for (const block of trace.blocks) {
    if (block.status === 'complete') complete += 1;
    else if (block.status === 'running') running += 1;
    if (block.status === 'error' || block.kind === 'approval') {
      important = true;
    }
    if (block.startedAt && (block.completedAt ?? Date.now()) - block.startedAt >= longRunningThresholdMs) {
      important = true;
    }
    if (block.toolCalls.some((call) => (call.completedAt ?? Date.now()) - call.startedAt >= longRunningThresholdMs)) {
      important = true;
    }
  }
  return { total: trace.blocks.length, complete, running, important };
};

const ToolCallRow: React.FC<{ call: ConversationToolCall }> = ({ call }) => {
  const argsPreview = call.argsPreview?.trim();
  const resultPreview = call.resultPreview?.trim();
  return (
    <div
      className={`work-process-tool-row status-${call.status}`}
      data-testid="work-process-tool-call"
    >
      <span className="work-process-tool-row-icon" aria-hidden="true">
        {inferToolIcon(call.toolName)}
      </span>
      <span className="work-process-tool-row-name">{call.toolName}</span>
      <span
        className="work-process-tool-row-status"
        aria-label={call.status}
      >
        {TOOL_STATUS_LABEL[call.status]}
      </span>
      <span className="work-process-tool-row-preview">
        {call.error || resultPreview || argsPreview || ''}
      </span>
      {argsPreview || resultPreview || call.error ? (
        <details className="work-process-tool-row-details">
          <summary>详情</summary>
          {argsPreview ? (
            <pre>
              <strong>参数</strong>
              {'\n'}
              {argsPreview}
            </pre>
          ) : null}
          {resultPreview || call.error ? (
            <pre>
              <strong>{call.error ? '错误' : '结果'}</strong>
              {'\n'}
              {call.error || resultPreview}
            </pre>
          ) : null}
        </details>
      ) : null}
    </div>
  );
};

const WorkBlockRow: React.FC<{ block: ConversationWorkBlock }> = ({ block }) => {
  const duration = formatDurationMs(block.startedAt, block.completedAt);
  const stageLabel = getStageLabel(block.stage);
  return (
    <li
      className={`work-process-block status-${block.status} kind-${block.kind}`}
      data-testid="work-process-block"
    >
      <span
        className={`work-process-block-marker status-${block.status}`}
        aria-hidden="true"
      >
        {BLOCK_STATUS_LABEL[block.status]}
      </span>
      <div className="work-process-block-body">
        <div className="work-process-block-title-row">
          <span className="work-process-block-title">{block.title}</span>
          <span className="work-process-block-kind">{BLOCK_KIND_LABEL[block.kind]}</span>
          {stageLabel ? (
            <span className="work-process-block-stage">{stageLabel}</span>
          ) : null}
          {duration ? (
            <span className="work-process-block-duration">{duration}</span>
          ) : null}
        </div>
        {block.summary ? (
          <p className="work-process-block-summary">{block.summary}</p>
        ) : null}
        {block.toolCalls.length > 0 ? (
          <div className="work-process-block-tools" aria-label="Tool calls">
            {block.toolCalls.map((call) => (
              <ToolCallRow key={call.id} call={call} />
            ))}
          </div>
        ) : null}
        {block.detail ? (
          <pre className="work-process-block-detail">{block.detail}</pre>
        ) : null}
      </div>
    </li>
  );
};

export const WorkProcess: React.FC<WorkProcessProps> = ({ trace }) => {
  const isRunning = trace.status === 'running';
  const counts = useMemo(() => aggregateBlockCounts(trace), [trace]);
  const [expanded, setExpanded] = useState<boolean>(isRunning || counts.important);
  const [autoCollapsedOnce, setAutoCollapsedOnce] = useState(false);

  useEffect(() => {
    if (isRunning || counts.important) {
      setExpanded(true);
      setAutoCollapsedOnce(false);
    } else if (trace.status === 'complete' && !autoCollapsedOnce) {
      setExpanded(false);
      setAutoCollapsedOnce(true);
    }
  }, [trace.status, isRunning, counts.important, autoCollapsedOnce]);

  const headerLabel = useMemo(() => {
    if (isRunning) return '工作中';
    if (trace.status === 'error') return '工作失败';
    if (trace.status === 'stopped') return '已停止';
    return '工作过程';
  }, [trace.status, isRunning]);

  return (
    <div
      className={`work-process status-${trace.status} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="work-process"
    >
      <button
        type="button"
        className="work-process-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span
          className={`work-process-caret ${expanded ? 'is-open' : ''}`}
          aria-hidden="true"
        >
          &gt;
        </span>
        <span className={`work-process-pulse status-${trace.status}`} aria-hidden="true" />
        <span className="work-process-label">{headerLabel}</span>
        <span className="work-process-meta">
          {counts.total > 0 ? (
            <>
              <span className="work-process-count">
                {counts.complete}/{counts.total}
              </span>
              {counts.running > 0 ? (
                <span className="work-process-running-dot" aria-hidden="true" />
              ) : null}
            </>
          ) : null}
        </span>
      </button>

      {expanded ? (
        <div className="work-process-body">
          {trace.summary ? (
            <p className="work-process-summary">{trace.summary}</p>
          ) : null}
          {trace.blocks.length === 0 ? (
            <p className="work-process-empty">暂无工作过程或工具调用。</p>
          ) : (
            <ol className="work-process-blocks">
              {trace.blocks.map((block) => (
                <WorkBlockRow key={block.id} block={block} />
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default WorkProcess;
