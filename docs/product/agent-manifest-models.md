# Agent Manifest 与模型选择

RDC-Agent 以 `.agent.md` 作为 agent 行为配置的唯一产品入口。Settings UI 读取和写入同一组文件，因此用户可以通过 GUI 或 Markdown 配置 agent。

## Manifest 位置

Agent manifests 位于当前 workspace：

`profiles/agents/*.agent.md`

当前只 seed 四个顶层 agent：

- `ask.agent.md`
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
  - todo
  - memory
  - rdxContext
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
- `enabled`
- `user-invocable`
- `disable-model-invocation`
- `tools`
- `agents`
- `skills`
- `mcp-servers`
- `handoffs`

`handoffs` support:

- `label`
- `agent`
- `prompt`
- `send`
- `showContinueOn`
- `model`

Composer and orchestrator switch lists are derived from `.agent.md` definitions where `enabled && userInvocable` is true.

## Tool Tokens

Manifest-facing tool names are canonical tokens:

- `read`
- `search`
- `web`
- `bash`
- `askUser`
- `agent`
- `todo`
- `memory`
- `rdxContext`

`ask` is read-only by default. `debugger`、`analyzer`、`optimizer` are general executable agents and may use configured tools such as `bash` and `rdxContext` when policy allows.

## Plan 输出

`plan.md` is a normal artifact, attachment, or trace output produced by an agent. It is not a workflow state machine, IPC channel, or renderer overlay. Approval and continuation UX should be modeled through generic handoffs and conversation/tool events.

## RDX Shell Actions

Open `.rdc`、connect remote、preview、close runtime are Settings-managed shell actions under `settings.tooling.rdxActions`. The main process executes configured shell actions through `ShellInvocationService`, parses JSON output, and stores stable `RdxRuntimeContext` for later agent/tool use.
