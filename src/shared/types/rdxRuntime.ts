import type { AgentManifestDefinition } from './agentManifest';
import type { CompiledPromptCache, PromptStablePrefix } from './semanticContext';

export type ResourceScope = 'builtin' | 'user' | 'project';

export type ScopedResourceKind =
  | 'agent'
  | 'skill'
  | 'mcp'
  | 'hook'
  | 'policy'
  | 'knowledge'
  | 'memory';

export type EffectiveResourceStatus = 'effective' | 'inherited' | 'overridden' | 'disabled' | 'invalid';

export interface ResourceProvenance {
  scope: ResourceScope;
  sourcePath: string;
  sourceHash: string;
  overriddenSource?: Omit<ResourceProvenance, 'overriddenSource'>;
}

export interface ScopedResourceCandidate<T> {
  id: string;
  kind: ScopedResourceKind;
  scope: ResourceScope;
  sourcePath: string;
  value: T;
  enabled?: boolean;
  invalid?: boolean;
  invalidReason?: string;
}

export interface ResolvedResource<T> {
  id: string;
  kind: ScopedResourceKind;
  value: T;
  enabled: boolean;
  effectiveStatus: EffectiveResourceStatus;
  provenance: ResourceProvenance;
}

export interface ScopedResourceCatalog<T = unknown> {
  resources: Array<ResolvedResource<T>>;
  diagnostics: Array<{
    code: string;
    severity: 'warning' | 'error';
    message: string;
    sourcePath?: string;
  }>;
}

export interface EffectiveAgentProfile extends AgentManifestDefinition {
  effectiveStatus: EffectiveResourceStatus;
  provenance: ResourceProvenance;
  compiledRoute: {
    agentId: string;
    providerId: string;
    modelId: string;
  };
}

export interface ScopedInstructionSource {
  id: string;
  scope: 'user' | 'project';
  sourcePath: string;
  sourceHash: string;
  content: string;
  byteLength: number;
  precedence: number;
}

export interface ScopedInstructionResolution {
  sources: ScopedInstructionSource[];
  totalBytes: number;
  diagnostics: Array<{
    code: string;
    severity: 'warning' | 'error';
    message: string;
    sourcePath?: string;
  }>;
}

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  scope: ResourceScope;
  sourcePath: string;
  sourceHash: string;
  effectiveStatus: EffectiveResourceStatus;
}

export interface SkillLoadResult extends SkillMetadata {
  instructions: string;
  referencesPath?: string;
  scriptsPath?: string;
  assetsPath?: string;
}

export type HookEvent =
  | 'session.before-start'
  | 'session.after-end'
  | 'turn.before-start'
  | 'turn.after-end'
  | 'tool.before-call'
  | 'tool.after-call'
  | 'tool.on-error'
  | 'context.before-compact'
  | 'context.after-compact'
  | 'agent.before-handoff'
  | 'agent.after-handoff'
  | 'permission.denied';

export interface HookDefinition {
  id: string;
  enabled: boolean;
  event: HookEvent;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  failurePolicy: 'block' | 'warn';
  matcher?: { agents?: string[]; tools?: string[] };
}

export interface HookTrustState {
  trusted: boolean;
  projectRoot?: string;
  sourceHash: string;
  trustedAt?: string;
}

export type PromptSegmentKind =
  | 'core-contract'
  | 'agent-profile'
  | 'scoped-instruction'
  | 'preloaded-skill'
  | 'skill-catalog'
  | 'tool-capability'
  | 'runtime-fact';

export interface PromptSegment {
  id: string;
  kind: PromptSegmentKind;
  scope: ResourceScope | 'runtime';
  sourcePath: string;
  sourceHash: string;
  precedence: number;
  content: string;
  stability: 'stable' | 'volatile';
  tokenEstimate: number;
}

export interface PromptPlanMetrics {
  systemPrompt: number;
  scopedInstructions: number;
  skills: number;
}

export interface PromptPlan {
  id: string;
  segments: PromptSegment[];
  systemPrompt: string;
  totalTokenEstimate: number;
  stablePrefix: PromptStablePrefix;
  metrics: PromptPlanMetrics;
  diagnostics: Array<{ code: string; severity: 'warning' | 'error'; message: string; sourcePath?: string }>;
}

export interface RequestEnvelopeSnapshot {
  id: string;
  createdAt: string;
  completedAt?: string;
  sessionId?: string;
  turnId?: string;
  callIndex: number;
  route: { providerId: string; modelId: string; protocol: string };
  requestPlan: import('./providerCapability').RequestPlan;
  promptPlan: PromptPlan;
  messages: unknown[];
  tools: unknown[];
  controls: Record<string, unknown>;
  reasoning: ProviderReasoningContract;
  cache: CompiledPromptCache;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    cacheHitTokens?: number;
    cacheMissTokens?: number;
    estimated?: boolean;
  };
  redactions: Array<{ path: string; reason: string; hash?: string }>;
}

export type ProviderReasoningContract = import('../provider-catalog/modelManifestSchema').ProviderReasoningContract;
export type ReasoningSemantic = ProviderReasoningContract['semantic'];

export interface ScopedResourceDocument {
  id: string;
  kind: ScopedResourceKind;
  scope: Exclude<ResourceScope, 'builtin'>;
  sourcePath: string;
  sourceHash: string;
  effectiveStatus: 'effective' | 'overridden' | 'disabled' | 'invalid';
  content: string;
  diagnostics: string[];
}

export interface RdxRuntimeOverview {
  userRoot: string;
  projectRoot?: string;
  userPaths: Record<string, string>;
  projectPaths?: Record<string, string>;
  resources: ScopedResourceDocument[];
  hooks: Array<{
    id: string;
    scope: 'user' | 'project';
    sourcePath: string;
    sourceHash: string;
    enabled: boolean;
    event: HookEvent;
    trusted: boolean;
    failurePolicy: 'block' | 'warn';
  }>;
  mcpServers: Array<{
    id: string;
    name: string;
    scope: 'user' | 'project';
    sourcePath?: string;
    descriptorHash?: string;
    trusted: boolean;
    needsRetrust: boolean;
    executableOverrideRejected?: boolean;
    blockedReason?: string;
    command?: string;
    transport: string;
  }>;
  knowledge: { userPath: string; projectPath?: string };
  memory: { userPath: string; projectPath?: string };
  diagnostics: string[];
}

export interface ScopedResourceWriteRequest {
  kind: ScopedResourceKind;
  scope: 'user' | 'project';
  id: string;
  content: string;
  projectRoot?: string;
}

export interface ScopedResourceImportRequest {
  kind: ScopedResourceKind;
  scope: 'user' | 'project';
  filePath: string;
  projectRoot?: string;
}

export interface RestrictivePolicy {
  deniedTools?: string[];
  approval?: 'none' | 'destructive' | 'mutation' | 'all';
  /** Optional per-tool approval floor; keys are normalized tool names. */
  approvalFloorByTool?: Record<string, PolicyApprovalFloor>;
  limits?: Record<string, number>;
}

export type PolicyApprovalFloor = 'none' | 'auto_review' | 'user';

/**
 * 编译后的执行期 Policy（不可变快照）。
 * `.policy.yml` 解析失败必须 fail-closed，不得静默忽略。
 */
export interface CompiledPolicy {
  deniedTools: readonly string[];
  approvalFloorByTool: Readonly<Record<string, PolicyApprovalFloor>>;
  approval: 'none' | 'destructive' | 'mutation' | 'all';
  maxTurns: number;
  maxToolCalls: number;
  maxSubagents: number;
  maxChildDepth: number;
  maxWallTimeMs: number;
  /** 100 = unlimited (does not constrain the user compaction percent). */
  contextCompactionPercent: number;
  sourceFingerprint: string;
}
