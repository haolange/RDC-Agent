# Agent Runtime Kernel Architecture

## 目标

`AgentRuntimeKernel` 是 RDC-Agent 的底层 agent runtime substrate。它吸收 provider schema、account/OAuth、本地模型、MCP、skills、primitive tools 和 provider backend 的差异，并把上层暴露面收敛为统一的 agent turn、tool loop、标准事件、确定性 tool policy 和 provider capability。

本库的强流程 multi-agent workflow 不由 skill 文本或external provider runner 控制。`Debugger` workflow 负责 stage/task graph/final status；runtime kernel 负责模型 turn、工具循环、策略、approval/ask-user、事件和 provider routing。

## Runtime Ownership

- `src/main/agent-runtime/AgentRuntime.ts` 拥有多轮 agent loop：model turn -> tool request -> policy/schema guard -> tool mediation -> observation -> next model turn -> final。
- `AgentEvent` 是跨层事实事件。正式事件包括 `tool.requested`、`tool.started`、`tool.completed`、`tool.denied`、`approval.requested`、`approval.answered`、`task.created`、`task.updated`、`run.completed`、`run.failed`、`run.cancelled`。
- trace observation 文本必须 redaction；token/API key/OAuth secret 不进入 renderer-facing payload 或 tool observation prompt。
- `maxToolIterations` / `maxTurns` 是 fail-safe guard。达到上限时 runtime 发送 diagnostic 并停止继续执行工具。
- malformed tool arguments fail-closed，不执行危险或 mutation tool。

## Provider And Auth

- `src/main/agent-runtime/ModelProviderRegistry.ts` 是 provider capability registry 和 `streamTurn` 入口，底层复用现有 `LLMAdapter`。
- capability matrix 记录 streaming、native tool calling、structured output、vision、reasoning、parallel tool calls、OAuth/local、tool-call format、structured reliability。
- `ProviderAccountAuthService` 统一 ChatGPT Account、Claude Account、GitHub Copilot、Grok Account、Gemini Account、Qwen Account 的 account auth 状态机。
- Grok/Gemini/Qwen account adapters 是 mockable adapters：测试环境可完成 start/finish/discover model；非测试环境明确返回 live OAuth contract blocker，不伪装真实 OAuth 已完成。
- Ollama / OpenAI-compatible / local provider 继续走 local/API key/environment 路径，并通过 capability matrix 暴露为 runtime provider。

## Tool Substrate

- `ToolRegistry` 是统一 tool mediation 入口，工具来源包括 primitive、RDC ToolBridge、MCP、skill。
- RDC tool 只能通过 `ToolBridge` 执行；renderer、preload、provider adapter、MCP、skill 均不得绕过 `ToolBridge` 直接调用 RenderDoc 运行链。
- primitive tools 包括 `primitive.read`、`primitive.glob`、`primitive.grep`、`primitive.webFetch`、`primitive.webSearch`、`primitive.askUser`、`primitive.task.list`、`primitive.bash`、`primitive.write`、`primitive.edit`、`primitive.remove`。
- `primitive.bash` 默认 fail-closed，除非未来显式接入 approval/sandbox executor。
- `primitive.write/edit/remove` 只允许 workspace-scoped 文件操作；Ask profile 默认禁止这些工具。
- `primitive.askUser` 通过 `approval.requested` / `approval.answered` 表达 request/resume。没有 runtime resume handler 时返回 fail-closed observation。

## MCP And Skills

- MCP tools 以 `mcp.<serverId>.<toolName>` 进入 ToolRegistry，并通过统一 policy/schema/result path 执行。
- Skill descriptor 从 `resources/agent-runtime/skills` scaffold 到 workspace `skillsPath`，再由 `SkillRegistry.loadDescriptors()` 注册为只读 skill metadata tool。
- skill 可提供 instructions/resources/tool metadata，但 workflow stage transition、specialist dispatch 和 final status 只能由 workflow engine 控制。

## Profiles And Ask

- agent profile 的文字 prompt 可指导模型，但 runtime policy 必须解析为 deterministic policy。
- `ask_agent` 是 read-only agentic profile，默认允许 `primitive.read/glob/grep/webFetch/webSearch/askUser/task.list`，并禁止 `bash/write/edit/remove` 和 RDC mutation。
- Ask 不创建 formal Debugger run；formal debug request 仍需要 open capture 和 Debugger plan/approval flow。

## Debugger Multi-Agent Workflow

- RDC device/runtime 不支持并行工具执行；multi-agent 是上下文工程和职责分解策略，不是并行 device execution。
- `MultiAgentWorkflowEngine` 把 `TaskBoard` 投影为 serial task graph，并在 task mutation 后断言同一时刻最多一个 running task。
- `DeterministicSpecialistExecutor` 是 specialist 执行 facade；它保留 `SpecialistRecipeRunner` 的确定性工具序列，但向 workflow 暴露为 deterministic specialist executor，而不是 skill-driven 自由流程。
- Debugger 主链保持 strict serial flow：plan -> approval -> prepare surface -> triage/specialist dispatch -> synthesis -> skeptic -> curator -> report -> finalize。
- Analyzer / Optimizer 只有在有明确 workflow pattern 时才启用专属执行链；否则只能作为 profile/pattern 占位。

## Provider Backend Boundary

- Provider clients and HTTP adapters do not own runtime control.
- All agent turns run through `AgentRuntime`.
- Every tool request is mediated by `ToolRegistry` before any `ToolBridge` call.

## Verification

最小验证门：

- `npm run typecheck`
- `npm run check:shared-exports`
- `npm run check:architecture`
- `npm run build`，因为 main/workflow/provider contract 已改动
- focused smoke：`npm run test:browser-session`；涉及窗口/preload/IPC/ToolBridge 边界时补 `npm run test:shell-smoke`
