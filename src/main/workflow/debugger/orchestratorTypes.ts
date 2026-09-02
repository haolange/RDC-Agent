/**
 * Shared types for AgentOrchestrator façade and sibling turn services.
 */

import type { AgentRole } from '@shared/types/agent';
import type { AgentRouteCapability, AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import type {
  ConversationTurnControls,
  ResolvedReasoningSelection,
} from '@shared/types/modelCapability';
import type { EffectiveModel, ExecutionIdentity, RequestPlan } from '@shared/types/providerCapability';
import type { PreparedTurnContextSummary } from '@shared/types/session';
import type { EffectiveAgentProfile, PromptPlan } from '@shared/types/rdxRuntime';
import type { CompiledPromptCache } from '@shared/types/semanticContext';
import type { EffectiveRuntimePlan } from '../../agent-runtime/EffectiveRuntimePlan';
import type { PendingHandoff, PolicyBudgetState, SubagentBudgetState } from './TurnCoordinator';
import type { McpConnectionLease } from './McpConnectionCoordinator';
import type { AgentEventBridgeContext } from '../../agent-runtime/AgentEventBridge';
import type { AttachmentLayer } from '@shared/types/conversation';
import type { SessionAttachmentKind } from '@shared/types/session';
import type {
  Message,
  ToolDefinition,
  UserMessage,
} from '../../agent-runtime/core/types';
import type { AgentTool } from '../../agent-runtime/agent/AgentTool';

export interface FrozenAttachmentManifestEntry {
  attachmentId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  size: number;
  layer: AttachmentLayer;
  kind: SessionAttachmentKind;
}

export interface AgentTurnContext {
  runId?: string;
  sessionId?: string;
  turnId?: string;
  projectRootPath?: string | null;
  projectId?: string | null;
}

export interface AgentTurnOptions {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  onEvent?: (event: SharedAgentEvent) => void;
  reasoning?: ResolvedReasoningSelection;
  turnControls?: ConversationTurnControls;
  requestPlan?: RequestPlan;
  requestId?: string;
  userContent?: UserMessage['content'];
  preloadSkillIds?: string[];
  policyBudget?: PolicyBudgetState;
  subagentBudget?: SubagentBudgetState;
}

export interface AgentProfileTurnOptions extends AgentTurnOptions {
  sessionId?: string;
  /** Child-turn model only. Parent session override is never inherited. */
  modelOverride?: { providerId: string; modelId: string } | null;
  /** Durable run that owns user-visible outputs from this turn. */
  runId?: string;
  systemPrompt?: string;
  temperature?: number;
  turnId?: string;
  requestId?: string;
  routeAgentId?: AgentRole;
  /** 当前激活项目根目录，透传到工具执行上下文。 */
  projectRootPath?: string | null;
  /** 当前激活项目 id。 */
  projectId?: string | null;
  promptPlan?: PromptPlan;
  /** Volatile Delegation Capsule segments appended to the child PromptPlan. */
  extraPromptSegments?: import('@shared/types/rdxRuntime').PromptSegment[];
  /** Exact profile snapshot used to build this child turn. */
  effectiveProfile?: EffectiveAgentProfile | null;
  /** Enabled profile ids from the same resolution snapshot. */
  effectiveProfileIds?: string[];
  visibleTurnIds?: string[];
  activeBranchId?: string;
  /** Shared parent-child policy lineage; child turns must not reset counters. */
  policyBudget?: PolicyBudgetState;
  subagentBudget?: SubagentBudgetState;
  preparedTurn?: PreparedAgentTurnContext;
  onTerminalContext?: (result: {
    messages: Message[];
    executionIdentity: ExecutionIdentity;
    status: 'complete' | 'stopped' | 'error';
    selectedTurnCount: number;
    filteredArtifactCount: number;
    pendingHandoff?: PendingHandoff;
  }) => void;
}

export interface ResolvedRuntimeTools {
  definitions: ToolDefinition[];
  toolMap: Map<string, AgentTool>;
}

export interface PreparedAgentRuntime {
  runtimeTools: ResolvedRuntimeTools;
  activeToolDefinitions: ToolDefinition[];
  routeCapability: AgentRouteCapability;
  mcpConnectionErrors: string[];
  mcpLease: McpConnectionLease | null;
  credentialHandle: string;
  promptCache: CompiledPromptCache;
  effectivePlan: EffectiveRuntimePlan;
}

export interface PreparedAgentTurnContext {
  summary: PreparedTurnContextSummary;
  selectedModelId: string;
  effectiveModel: EffectiveModel;
  toolAllowlist: string[];
  frozenUserContent: UserMessage['content'];
  attachmentManifest: FrozenAttachmentManifestEntry[];
  inlineTokenBudget: number;
  initialMessages: Message[];
  contextDiagnostic: {
    selectedTurnCount: number;
    activeBranchId: string | null;
    filteredArtifactCount: number;
    replayedArtifactCount: number;
    continuationDecisionCounts: Array<{ reason: string; count: number }>;
    derivedContextStatus: 'none' | 'applied' | 'stale';
    compactedTurnCount: number;
    compactionState: 'prepared' | 'not-required';
  };
  runtime: PreparedAgentRuntime;
}

export interface ToolExecutorRuntimeContext {
  sessionId?: string | null;
  runId?: string;
  turnId?: string;
  eventContext?: AgentEventBridgeContext;
  onEvent?: (event: SharedAgentEvent) => void;
  /** 当前激活项目根目录，用于把工具执行 base 对齐到 project root 而非 process.cwd()。 */
  projectRootPath?: string | null;
  /** Exact MCP pool leased by this turn; never resolve tools from a mutable active-project pointer. */
  mcpPoolKey?: string | null;
  /** 当前激活项目 id（审计/事件关联）。 */
  projectId?: string | null;
  /** Turn 冻结的 EffectiveRuntimePlan；Prompt/Executor 共用 planId/fingerprint。 */
  effectivePlan?: EffectiveRuntimePlan;
  policyBudget?: PolicyBudgetState;
}

export function countContinuationDecisions(
  decisions: Array<{ reason: string }>,
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const decision of decisions) counts.set(decision.reason, (counts.get(decision.reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => ({ reason, count }));
}
