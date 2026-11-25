import type { RdcTurnBinding } from '../../rdc/RdcTurnBindings';
import type {
  ImageContent,
  JsonSchema,
  TextContent,
  ToolDefinition,
} from '../core/types';

export type AgentToolPermissionHint = 'readonly' | 'session_mutation' | 'mutation' | 'destructive';

/**
 * 工具执行上下文：把当前会话的 project root 透传到工具执行层，
 * 使文件/搜索/shell 工具相对「当前激活项目」解析路径，而不是应用 process.cwd()。
 *
 * - `workspaceRoot`：工具 base 解析根（优先取 projectRootPath）。
 * - `projectRootPath`：当前激活项目的根目录，可能为 null（无项目上下文）。
 * - `projectId` / `sessionId`：用于事件/审计关联。
 */
export interface ToolExecutionContext {
  /** Session-owned volatile state; never persisted or shared with child sessions. */
  successfulFileReads?: Set<string>;
  /** Main-owned, private execution binding; never serialized to the model. */
  rdcBinding?: RdcTurnBinding;
  /** Main-owned approved capture lifecycle; never serialized as a tool argument. */
  captureControl?: import('../orchestration/ApprovedCaptureController').ApprovedCaptureController;
  agentId?: string;
  /** Frozen profile ceiling. Native RDC execution requires `full`. */
  accessCeiling?: import('@shared/types/agentManifest').AgentAccessCeiling;
  turnId?: string;
  excludeRdcLeaseTools?: boolean;
  workspaceRoot: string;
  projectRootPath: string | null;
  projectId: string | null;
  sessionId: string | null;
  /** Frozen route vision capability; image tools fail closed when not native. */
  visionInputMode?: 'native' | 'disabled';
  /** Per-call temporary path roots; never module-global. */
  temporaryAllowedPathRoots?: readonly string[];
  /** Frozen Knowledge roots for reference formatting; not a filesystem access grant. */
  knowledgeReadRoots?: readonly string[];
}

/**
 * How a call is scheduled within one model round and which project resource claim its effect takes.
 *
 * - `shared`: may run beside other parallel calls in a consecutive group; its effect takes a shared claim.
 * - `exclusive`: runs alone and its effect takes the exclusive claim.
 * - `orchestration-parallel`: dispatch or wait only; may run in a parallel group and takes no claim, because the
 *   delegated work it starts or joins acquires its own claims (taking one here would deadlock on that work).
 * - `orchestration-serial`: dispatch or task bookkeeping that runs alone and takes no claim.
 */
export type AgentToolConcurrency = 'shared' | 'exclusive' | 'orchestration-parallel' | 'orchestration-serial';

/**
 * A human prompt the host runs in place of `execute`: `user-input` asks the user questions; `plan-review`
 * submits the plan for review, and a result approved by the user ends the planning turn.
 */
export type AgentToolInteraction = 'user-input' | 'plan-review';

/** How a call's result is kept as session evidence and presented to the model. */
export interface AgentToolResultPresentation {
  /** Keep a session evidence URI/hash for this result even when it is below the offload threshold. */
  readonly pinEvidence?: (args: Record<string, unknown>, result: AgentToolResult) => boolean;
  /** Error results are kept as evidence like successes: the run they report did execute. */
  readonly keepErrorResults?: boolean;
  /** A native RDC failure that carries a delivery result reaches the model as pinned evidence, not as bare text. */
  readonly deliversNativeFailure?: boolean;
}

/** A call that changes the owning replay itself: select a frozen input, restore the entry position, or recover. */
export type ReplayLifecycleStep = 'capture_select' | 'capture_restore' | 'capture_recover';

/** The live capture a call reaches, read from its validated arguments. */
export interface AgentToolCaptureAccess {
  /** The call reads or drives the live replay, so the approved capture controller must allow live access. */
  readonly live: (args: Record<string, unknown>) => boolean;
  /** The call operates on the capture and needs a plan-frozen capture scope in an approved execution. */
  readonly requiresApprovedScope: (args: Record<string, unknown>) => boolean;
  /** The call recovers a faulted capture: affected children are joined after authorization, before the resource claim. */
  readonly recovers?: (args: Record<string, unknown>) => boolean;
  /** The call runs a native RDC operation through the turn binding; the registered RDC operation policy authorizes it. */
  readonly nativeOperation?: (args: Record<string, unknown>) => boolean;
  /** The replay lifecycle step the call performs, if any; permission review gates it as a change to the owning replay. */
  readonly replayLifecycle?: (args: Record<string, unknown>) => ReplayLifecycleStep | null;
}

/**
 * Behaviour the runtime reads from the tool rather than from its name. `concurrency` is required for every
 * tool; MCP tools share `MCP_TOOL_SPEC`. `category` and `requiresApproval` are discovery facts listed by
 * `tool_search`; a tool that omits them is listed without a category and as not requiring approval.
 */
export interface AgentToolSpec {
  readonly concurrency: AgentToolConcurrency;
  readonly isReadOnly: boolean;
  readonly isDestructive: boolean;
  readonly sideEffect?: 'none' | 'process' | 'filesystem' | 'network' | 'session';
  readonly category?: 'file' | 'search' | 'system' | 'comm' | 'web' | 'task';
  readonly requiresApproval?: boolean;
  readonly interaction?: AgentToolInteraction;
  readonly presentation?: AgentToolResultPresentation;
  readonly capture?: AgentToolCaptureAccess;
  /**
   * How the turn's frozen Knowledge roots reach the call: `read-access` adds them to the call's temporary
   * readable roots; `reference` passes them in the execution context for reference formatting only.
   */
  readonly knowledgeRoots?: 'read-access' | 'reference';
  /** Each call reserves one subagent from the delegation budget before its group is dispatched. */
  readonly dispatchesSubagent?: boolean;
  /** A successful result names deferred tools that become active for the rest of the turn. */
  readonly activatesDeferredTools?: boolean;
  /**
   * The argument that holds host shell command text. Permission review applies the catastrophic-pattern hard deny,
   * the file-tool bypass check, command prefix rules, the risk analyzer and the routine command set to it.
   */
  readonly shellCommand?: string;
}

/**
 * What a call can touch, declared once by the tool. Permission review reads these
 * facts and never infers them from a tool name. Paths are dotted argument keys.
 */
export interface AgentToolEffects {
  /** Arguments naming filesystem locations the call reads. */
  readonly reads?: readonly string[];
  /** Arguments naming filesystem locations the call creates, changes, moves or deletes. */
  readonly writes?: readonly string[];
  /** Argument holding a glob whose fixed prefix is a read location. */
  readonly readPattern?: string;
  /** The call reaches the network. */
  readonly network?: boolean;
}

export interface AgentToolResult<TDetails = unknown> {
  content: (TextContent | ImageContent)[];
  isError?: boolean;
  details?: TDetails;
}

export interface AgentTool<
  TParams extends object = Record<string, unknown>,
  TDetails = unknown,
> {
  readonly name: string;
  readonly label?: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly pollable?: boolean;
  readonly permissionHint?: AgentToolPermissionHint;
  readonly spec: AgentToolSpec;
  readonly effects?: AgentToolEffects;

  /** Reject semantically invalid arguments before permission review or execution. */
  validateArgs?(args: TParams): void;

  execute(
    toolCallId: string,
    args: TParams,
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void,
    context?: ToolExecutionContext,
  ): Promise<AgentToolResult<TDetails>>;
}

export function toolToDefinition(tool: Pick<AgentTool, 'name' | 'description' | 'parameters' | 'pollable'>): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.pollable ? { pollable: true } : {}),
  };
}
