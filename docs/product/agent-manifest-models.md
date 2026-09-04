# Agent Manifest 与模型选择

RDC-Agent 以 `.agent.md` 作为 agent 行为配置的唯一产品入口。Settings UI 读取和写入同一组文件，因此用户可以通过 GUI 或 Markdown 配置 agent。

## Manifest 位置

Agent manifests 按 scope 解析，优先级 `builtin < user < project`，整资源替换：

- builtin：`resources/agent-runtime/agents/{general,debugger,analyzer,optimizer}.agent.md`
- user：`~/.rdx/agents/*.agent.md`
- project：`<project-root>/.rdx/agents/*.agent.md`

四个 builtin profile：`general` / `debugger` / `analyzer` / `optimizer`。user/project 只能覆盖这四个 id，或新增无关自定义 id。ask/plan/edit 及 S0 specialist id 为历史非法 id：剔出 effective snapshot + 诊断 `AGENT_ID_RESERVED_HISTORICAL`；**不再有 custom manifest 运行通道**（U01 落地）。运行时不再写 user seed。代码仍是 v1 marker，且会把 concrete model 判成 user-modified（U01 修）。

Agent ID 来自文件名 stem，不再从 frontmatter 读取 `id`。

## Manifest 字段

每个 manifest 使用 YAML frontmatter 加 Markdown instructions：

```markdown
---
name: Debugger
description: General executable RDC/RDX debugging agent.
argument-hint: Describe the goal, symptom, capture, or artifact to inspect.
target: rdc-agent
model: github-copilot:gpt-4.1
icon: crosshair-bug
accent: "#33d1ff"
enabled: true
user-invocable: true
disable-model-invocation: false
tools:
  - read
  - search
  - web
  - shell
  - askUser
  - agent
  - task
  - memory
  - rdxContext
  - subagent
  - tool_search
agents:
  - analyzer
  - optimizer
skills: []
mcp-servers: []
handoffs:
  - label: Analyze Evidence
    agent: analyzer
    prompt: Analyze the current evidence and summarize findings.
    send: true
    showContinueOn: false
---

You are the Debugger agent.
```

Supported frontmatter fields are:

- `name`
- `description`
- `argument-hint`
- `target`
- `model`
- `icon`（图标预设）
- `accent`（`#RRGGBB`；驱动 Composer 边框流光、边缘泛光与 Effort 滑条色；Settings → Agents 可编辑）
- `enabled`
- `user-invocable`
- `disable-model-invocation`
- `tools`
- `agents`
- `skills`（强制全文 preload；空列表表示不预载，不等于不可发现）
- `mcp-servers`
- `handoffs`

Removed fields (do not restore): `harness` / lean|standard thickness modes. Skill discovery thickness is Progressive Skill Index only.

`handoffs` support:

- `label`
- `agent`
- `prompt`
- `send`
- `showContinueOn`
- `model`

Composer and orchestrator switch lists are derived from `.agent.md` definitions where `enabled && userInvocable` is true.

## Tool Tokens

Manifest-facing tool names are canonical tokens (see `CANONICAL_TOOL_TOKEN_EXPANSIONS` in `src/shared/constants/agentToolTokens.ts`):

- `read`
- `search`
- `web`
- `shell`
- `write`
- `edit`
- `git`
- `askUser`
- `agent`
- `handoff`
- `task` (expands to `task_create`, `task_update`, `task_get`, `task_list`, `task_stop`)
- `memory`
- `planArtifact`
- `skills` / `skill`
- `mcp`
- `subagent`
- `tool_search`
- `rdxContext`

Removed tokens `todo` and `search_codebase` are rejected (`REJECTED_TOOL_TOKENS`); use `task` and `glob`/`grep` instead.

Tasks 能力由 route 与冻结工具集决定，不是独立 profile：只读 route 仅注入 `task_list` / `task_get`；可写 route 仅在冻结工具集确实包含 mutation 工具时才宣称可写（`task_create` / `task_update` / `task_stop`）。text-only route 不接收 tool schemas，Prompt 不得模仿或反复搜索不可用的 Tasks 工具。`askUser` token 仍是用户询问工具。`debugger` / `analyzer` / `optimizer` 是 Mission Planning Orchestrator；`general` 是 Execution Orchestrator。Mission 为 plan-only（见裁决 J）；General 在 policy 允许时可使用 `shell` / `write` / `edit` / `rdxContext`。ask/plan/edit **不是**现行 agent 身份。

## Plan 输出

`plan.md` is a normal artifact, attachment, or trace output produced by an agent. It is not a workflow state machine, IPC channel, or renderer overlay. Approval and continuation UX should be modeled through generic handoffs and conversation/tool events.

## RDX Shell Actions

Open `.rdc`（local `openCapture` / remote `openRemoteCapture`）、connect remote、preview、close runtime are Settings-managed shell actions under `settings.tooling.rdxActions`. The main process executes configured shell actions through `ShellInvocationService`, parses JSON output, and stores stable `RdxRuntimeContext` for later agent/tool use.
