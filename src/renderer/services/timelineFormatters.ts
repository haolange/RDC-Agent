import type {
  AgentNode,
  AgentNodeStatus,
  TimelineProjection,
} from '@shared/types/agentTimeline';

export const statusLabel: Record<AgentNodeStatus, string> = {
  pending: '待处理',
  running: '进行中',
  streaming: '输出中',
  waiting_tool: '等待工具',
  waiting_user: '等待用户',
  merging: '合并中',
  succeeded: '已完成',
  partial_succeeded: '部分完成',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
  blocked: '阻塞',
};

export type { DocumentBlock } from './timelineDocumentBlocks';
export { parseDocumentBlocks } from './timelineDocumentBlocks';

export interface AskTraceOption {
  optionId?: string;
  id?: string;
  label?: string;
  description?: string;
}

export interface AskTraceQuestion {
  questionId?: string;
  id?: string;
  prompt?: string;
  recommendedOptionId?: string;
  options?: AskTraceOption[];
}

export interface AskTraceAnswer {
  questionId?: string;
  selectedOptionId?: string;
  freeformText?: string;
}

export type ExpandedState = Record<string, boolean>;

export const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

export const formatDuration = (durationMs?: number): string | null => {
  if (!durationMs || durationMs <= 0) {
    return null;
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}分${seconds}秒`;
};

export const formatSize = (size?: number): string => {
  if (!size || size <= 0) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

export const hasFailure = (status: AgentNodeStatus): boolean =>
  status === 'failed' || status === 'blocked' || status === 'partial_succeeded';

export const shouldDefaultExpand = (node: AgentNode, collapseSuccessfulTools: boolean): boolean => {
  if (node.type === 'tool_call' && collapseSuccessfulTools && node.status === 'succeeded') {
    return false;
  }
  if (node.defaultExpanded !== undefined) {
    return node.defaultExpanded;
  }
  return node.status === 'running'
    || node.status === 'streaming'
    || node.status === 'failed'
    || node.status === 'blocked'
    || node.status === 'partial_succeeded'
    || node.type === 'phase';
};

export const getPayload = <TPayload,>(node: AgentNode): TPayload | undefined =>
  node.payload as TPayload | undefined;

export const getChildren = (projection: TimelineProjection, node: AgentNode): AgentNode[] =>
  (node.children ?? [])
    .map((id) => projection.nodes[id])
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);

export const nodeHasFailedDescendant = (projection: TimelineProjection, node: AgentNode): boolean => {
  if (hasFailure(node.status)) {
    return true;
  }
  return getChildren(projection, node).some((child) => nodeHasFailedDescendant(projection, child));
};

export const shouldShowNode = (
  projection: TimelineProjection,
  node: AgentNode,
  showOnlyFailed: boolean,
): boolean => {
  if (!showOnlyFailed) {
    return true;
  }
  return nodeHasFailedDescendant(projection, node);
};

export const normalizeAskQuestions = (value: unknown): AskTraceQuestion[] => {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const questions = (value as { questions?: unknown }).questions;
  return Array.isArray(questions) ? questions as AskTraceQuestion[] : [];
};

export const normalizeAskAnswers = (value: unknown): AskTraceAnswer[] => {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const answers = (value as { answers?: unknown }).answers;
  return Array.isArray(answers) ? answers as AskTraceAnswer[] : [];
};

export const formatStatusEntryTime = (createdAt: number): string => formatTime(createdAt);
