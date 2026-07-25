# Runtime Kernel 契约

> 产品边界与不变量以根目录 `DESIGN.md` 为 SSOT。本文是从 DESIGN 分拆出的 **Runtime / Prompt / Provider / Tool / Session** 稳定契约；实现细节见 `docs/architecture/agent-runtime-kernel.md` 与源码，二者冲突时以 `DESIGN.md` + 本文为准并修正架构文。

## Agent Loop

唯一运行时路径：

1. 解析 profile、model route、policy、可用工具；
2. 调用 LLM；
3. 执行已批准工具；
4. 将工具结果回灌 loop；
5. 产出 final answer。

`ConversationWorkTrace` 是可见进度契约。块类型包括：`llm_turn`、`reasoning`、`approval`、`user_input`、`compaction`、`subagent`、`handoff`、`diagnostic`、`output`。历史不匹配 canonical schema 的 `workTrace` 在存储读边界丢弃（`workTrace: null`），无 legacy 归一化。

## 关键编排模块（Phase 1–4）

| 模块 | 职责 |
| --- | --- |
| `EffectiveRuntimePlan` | `prepareTurn` 冻结 planId/fingerprint；Prompt 与 Executor 共用 |
| `TurnCoordinator` / `TurnHandle` | 每 session 活跃 turn；eventSink、deferred、producers、generation |
| `ProcessSupervisor` | spawn/joinAll；POSIX pgid；Windows `taskkill /T`；ring buffer |
| `ShutdownCoordinator` | `running → … → exited`；before-quit 限时 `shutdownAll` |
| `AgentSlotRegistry` / `McpConnectionCoordinator` / `DeferredToolActivationTracker` / `HandoffMailbox` | 自 Orchestrator 拆出的协作单元 |
| `LoopRuntimeState` | Agent 工具面 COW；每轮读 `runtime.current` |

Conversation 单一真相：turn 开始 `rehydrate(fromDisk)`；结束 flush 并清空 slot messages；分支切换 / rewrite 显式 `syncSessionSlots`。

## Prompt 与 Request

```text
Scoped Runtime Resolution
  -> EffectiveCatalogService
  -> PromptPlanBuilder
  -> Context / Message Transformation
  -> RequestEnvelopeBuilder
  -> RequestPlanner (closed RequestPlan)
  -> Provider Adapter
  -> Provider Wire Request
```

`PromptPlan` 每段含 id、kind、scope、source path/hash、precedence、content、token estimate、`stable|volatile`。稳定前缀指纹锚定 prompt-cache。Session 重建路径：`conversation.jsonl` + `conversation-branches.json` + `session-context.jsonl`。

发送是 next-turn 事务：`preparing → committing → running → terminal`。Preflight 冻结 catalog/route/controls/`PromptPlan`/tools/attachments，并创建主进程 opaque credential lease。失败/取消的 preflight 不留 Session/journal/lease 残渣。

## Provider Reasoning 与输出通道

语义值：`raw` | `summary` | `opaque` | `none` | `unknown`。声明缺失保持 `unknown`，禁止静默升级。

每个 wire block 先获得稳定 `ProviderOutputRef`；首次语义声明永久归属 `thinking` | `text` | `tool_call` 之一。kind collision、start 前 delta、close 后 delta、terminal 后语义事件 → fail-closed。禁止按文本相同做跨通道去重。

仅显式 thinking block 可创建 `ThinkingArtifact`；普通 assistant text 永不合成 thinking。仅 `outputPhase='commentary'` 写 Work Process commentary；仅 `final_answer` 写正文与 final trace。正常结束但无 canonical final → fail-closed。

## Tools 与 Permission（执行侧）

Builtin 目录以 `BUILTIN_AGENT_TOOL_IDS` 为准（36 ids）。Manifest token 经 `CANONICAL_TOOL_TOKEN_EXPANSIONS` 展开；`REJECTED_TOOL_TOKENS` 拒绝无静默 fallback。

`native-structured` 路由：core schema 常驻；extended / `mcp__*` deferred，经 `tool_search` 等契约路径激活。未激活调用 → `TOOL_NOT_ACTIVATED`。

执行前：`toolValidator.validate`；失败 → `TOOL_SCHEMA_VIOLATION`。`CompiledPolicy.deniedTools` 进入 Permission + Executor。非法 policy → fail-closed。

Temporary 外部路径只经当前 `ToolExecutionContext.temporaryAllowedPathRoots`，不得全局泄漏。

Slash 命令是 runtime 输入，不绕过 profile 权限。基线：`/help` `/compact` `/context` `/memory` `/agents` `/skills` `/mcp` `/status` `/model`。

权限模式：`Default` / `Auto-review` / `Full access` / `Custom(config.toml)`；主进程权威。即使 Full access：二进制/`.rdc` 拒绝进对话、realpath 约束、灾难性 shell 硬拒绝、`web_*` SSRF fail-closed、`bash run_in_background` 未闭环前禁用。

## Skills 工具收窄

见产品文 [`../product/scoped-runtime-resources.md`](../product/scoped-runtime-resources.md) 与 `DESIGN.md` Invariant：

```text
allowedTools = ∩(skill_i) ∩ runtimeAllowlist
```

空 `allowed-tools` 不收窄。实现：`intersectSkillAllowedTools` + `combineActiveSkillAllowlists`（`DebuggerRuntimePolicy`）。

## RDX / Capture

无内置 RDX toolchain。Open capture / remote / preview / close 只走 Settings shell action → `ShellInvocationService`。已打开 `.rdc` 由 `ownerSessionId` 拥有；不匹配 fail-closed。Local + Android-origin capture 不得静默 fallback remote。

## Model Capability（摘要）

`EffectiveCatalogService` 是唯一能力权威。Composer 跟已提交 Agent route revision，不跟乐观 Settings 投影。Context 计量相位：`Preparing` → `Current request ~` → `Actual` / idle `Last actual`。缩窗只在 send preflight 派生压缩视图。完整 UI 计量与控件语义见 `docs/ui/workbench-and-transcript.md`。

## 相关源码

- `src/main/workflow/debugger/` — Orchestrator、TurnCoordinator、DeferredTools
- `src/main/runtime/ProcessSupervisor.ts`、`src/main/lifecycle/ShutdownCoordinator.ts`
- `src/main/agent-runtime/` — prompt、providers、permissions、tools
- `src/main/conversation/` — Conversation、journal、Work Process 策略
