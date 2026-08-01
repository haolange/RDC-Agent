# Agent Manifest 与模型选择

RDC-Agent 以 `.agent.md` 作为 agent 行为配置的唯一产品入口。Settings UI 读取和写入同一组文件，因此用户可以通过 GUI 或 Markdown 配置 agent。

## Manifest 位置

Agent manifests 位于当前 workspace：

`profiles/agents/*.agent.md`

当前 baseline seed 六个顶层 profile：

- `ask.agent.md`
- `plan.agent.md`
- `edit.agent.md`
- `debugger.agent.md`
- `analyzer.agent.md`
- `optimizer.agent.md`

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
  - bash
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
- `bash`
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

`ask` is read-only by default (`read` / `search` / `web` / `askUser` / `tool_search` plus `task_list` / `task_get`; policy removes `task_create` / `task_update` / `task_stop`). `plan` and `edit` may mutate Tasks only when those tools survive profile, policy and route filtering in the frozen effective tool set. A text-only route receives no tool schemas and its Prompt must not imitate or repeatedly search for unavailable Tasks tools. `plan` uses research, questions, handoffs, memory or plan artifacts rather than direct implementation. `edit`、`debugger`、`analyzer`、`optimizer` are executable profiles and may use configured tools such as `bash`、`write`、`edit` and `rdxContext` when policy allows.

## Plan 输出

`plan.md` is a normal artifact, attachment, or trace output produced by an agent. It is not a workflow state machine, IPC channel, or renderer overlay. Approval and continuation UX should be modeled through generic handoffs and conversation/tool events.

## RDX Shell Actions

Open `.rdc`（local `openCapture` / remote `openRemoteCapture`）、connect remote、preview、close runtime are Settings-managed shell actions under `settings.tooling.rdxActions`. The main process executes configured shell actions through `ShellInvocationService`, parses JSON output, and stores stable `RdxRuntimeContext` for later agent/tool use.
