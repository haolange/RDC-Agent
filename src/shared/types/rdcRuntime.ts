import type { CompiledPromptCache, PromptStablePrefix } from './semanticContext';

export type ResourceScope = 'builtin' | 'user' | 'project';

export type ScopedResourceKind = 'agent' | 'skill' | 'mcp' | 'hook' | 'policy' | 'knowledge' | 'memory';

export type EffectiveResourceStatus = 'effective' | 'inherited' | 'overridden' | 'disabled' | 'invalid';

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  /** Profiles that may discover this skill. Empty or omitted means every profile. */
  audience?: string[];
  /** Set by a Mission coordinator skill; the kernel does not infer this from a profile id. */
  investigationMission?: 'debugger' | 'analyzer' | 'optimizer';
  scope: ResourceScope;
  sourcePath: string;
  sourceHash: string;
  effectiveStatus: EffectiveResourceStatus;
}

/** Read-only authoring metadata, never an execution permission or frozen catalog. */
export interface SkillSelectionOption extends SkillMetadata {
  /** Canonical profile IDs for which this skill cannot be discovered or preloaded. */
  unavailableToAgentIds: string[];
}

export type SkillSelectionProjection =
  | { status: 'ready'; options: SkillSelectionOption[] }
  | { status: 'error'; options: []; error: { code: 'SKILL_CATALOG_READ_FAILED'; message: string } };

export const CANONICAL_HOOK_EVENTS = [
  'session.before-start',
  'session.after-end',
  'turn.before-start',
  'turn.after-end',
  'tool.before-call',
  'tool.after-call',
  'tool.on-error',
  'context.before-compact',
  'context.after-compact',
  'agent.before-handoff',
  'agent.after-handoff',
  'permission.denied',
] as const;

export type HookEvent = (typeof CANONICAL_HOOK_EVENTS)[number];

type PromptSegmentKind =
  | 'core-contract'
  | 'agent-profile'
  | 'scoped-instruction'
  | 'preloaded-skill'
  | 'skill-catalog'
  | 'tool-capability'
  | 'runtime-fact'
  | 'plan-revision'
  | 'delegation-capsule';

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

interface PromptPlanMetrics {
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
  /** Responses-family streams: reasoning event counts and summary part lengths, never text. */
  reasoningEvents?: import('./reasoning').ReasoningEventSummary;
  completedAt?: string;
  sessionId?: string;
  turnId?: string;
  callIndex: number;
  route: { providerId: string; modelId: string; protocol: string };
  requestPlan: import('./providerCapability').RequestPlan;
  promptPlan: PromptPlan;
  messages: unknown[];
  mailboxDeliveries?: Array<{
    executionId: string;
    generation: number;
    direction: 'to_parent' | 'to_child';
    throughSequence: number;
    messageIds: string[];
  }>;
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

export interface RdcRuntimeOverview {
  skillSelection: SkillSelectionProjection;
  userRoot: string;
  projectRoot?: string;
  userPaths: Record<string, string>;
  projectPaths?: Record<string, string>;
  resources: ScopedResourceDocument[];
  hooks: Array<{
    id: string;
    scope: 'builtin' | 'user' | 'project';
    sourcePath: string;
    sourceHash: string;
    enabled: boolean;
    event: HookEvent;
    trusted: boolean;
    needsRetrust: boolean;
    trustFingerprint: string;
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

/** Main shows the file picker; the request only names what is imported and where it lands. */
export interface ScopedResourceImportRequest {
  kind: ScopedResourceKind;
  scope: 'user' | 'project';
  projectRoot?: string;
}
