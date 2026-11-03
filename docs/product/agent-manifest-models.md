# Agent Manifest 与模型选择

RDC-Agent 以 `.agent.md` 作为 agent 行为配置的唯一产品入口。Settings UI 读取和写入同一组文件，因此用户可以通过 GUI 或 Markdown 配置 agent。

## Manifest 位置

Agent manifests 按 scope 解析，优先级 `builtin < user < project`，整资源替换：

- builtin：`resources/agent-runtime/agents/{general,debugger,analyzer,optimizer}.agent.md`
- user：`~/.rdc-agent/agents/*.agent.md`
- project：`<project-root>/.rdc-agent/agents/*.agent.md`

四个 builtin profile：`general` / `debugger` / `analyzer` / `optimizer`。user/project 只能覆盖这四个 id，或新增无关自定义 id。ask/plan/edit 及 S0 specialist id 为历史非法 id：剔出 effective snapshot + 诊断 `AGENT_ID_RESERVED_HISTORICAL`；**不再有 custom manifest 运行通道**（U01 落地）。运行时不写 user seed，也没有 seed 迁移器或 marker。设置中编辑内置 Agent 时采用 copy-on-write，向 User scope 保存整份声明；编辑 Project 覆写写回 Project scope。删除覆写后恢复下层声明。

Agent ID 来自文件名 stem，不再从 frontmatter 读取 `id`。

## Manifest 字段

每个 manifest 使用 YAML frontmatter 加 Markdown instructions：

```markdown
---
name: Debugger
description: Plans RenderDoc investigations and evaluates signed evidence.
argument-hint: Describe the goal, symptom, capture, or artifact to inspect.
target: rdc-agent
model: []
icon: crosshair-bug
accent: "#33d1ff"
enabled: true
user-invocable: true
disable-model-invocation: false
tools:
  - read
  - search
  - web
  - askUser
  - task
  - planArtifact
  - memory
  - rdcContext
  - subagent
  - tool_search
agents:
  - general
skills:
  - debugger-coordinator
mcp-servers: []
handoffs:
  - label: Implement Plan
    labelTranslations:
      zh-CN: 执行计划
    agent: general
    prompt: Execute the frozen approved plan.
    send: true
    surface: plan-gate
    requiredToolIds:
      - investigation_write
    requiredSkillIds:
      - renderdoc-execution
      - debugger-causal-method
      - rdc-tool-shell
      - debugger-rdc-tools
---

You are Debugger. Stay plan-only; submit the plan with plan_artifact and wait for review.
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

- `label`（基础名称；与 agent 共同构成声明交接身份）
- `labelTranslations`（可选；仅支持 `zh-CN` / `en`，每项为非空、至多 200 字符的名称；声明时至少含一项，未知语言键拒绝）
- `agent`
- `prompt`
- `send`
- `surface`（`turn-end` | `plan-gate` | `hidden`；省略等于 `turn-end`。`turn-end` 在回合结束后和计划门出现，`plan-gate` 只在计划门出现，`hidden` 不出现。Settings 省略默认值）
- `model`
- `requiredSkillIds`（批准后由接收回合 prepareTurn 实际预载；不能授权工具）
- `requiredToolIds`（接收回合在自己的天花板和冻结工具集内预先激活这些 id）

Profile 还可声明通用字段 `access-ceiling`（`read-only` | `workspace-write` | `full`，省略为 `full`）和 `completion-contract`（`final-answer` | `investigation-report`，省略为 `final-answer`）。领域 mission 不写在 profile 上。需要调查报告合同时，预载的 Coordinator Skill frontmatter 声明 `investigation-mission: debugger | analyzer | optimizer`；没有任何预载 Skill 声明时 prepareTurn fail-closed。

自定义规划者不必占用保留 id。例如项目内 `gpu-planner.agent.md` 可以声明 `access-ceiling: read-only`、`completion-contract: investigation-report`，预载一份自有 Skill，并在该 Skill 写 `investigation-mission: debugger`。交接用 `surface: plan-gate` 指向执行 profile。保留 id 仍是 `ask` / `plan` / `edit`，不新增内置 `plan` profile。

译文与声明一同冻结进计划选项及建议行。UI 按当前语言显示译文，缺少该语言时使用基础 label；不按目标 Agent 改写名称。批准/交接仅提交 agent+label，译文不写入批准身份或 execution offer。改名后不迁移历史批准，不接受旧 label 别名；旧计划不再匹配时须修订或重规划并重新批准。

Composer and orchestrator switch lists are derived from `.agent.md` definitions where `enabled && userInvocable` is true.

Agent 的 `model` 是会话未显式选择时的初始模型配置，空列表合法；没有可执行路由时 Composer 提示选择模型，不静默选择目录中的其它模型。Composer / 计划卡的模型和 Effort、Fast、Max 保存在会话 `modelOverride + turnControls`，首次建会话前使用 Composer 草稿，不写回 Agent 文件。进入计划审批不切换到交接目标的默认模型；批准前将继承的当前模型与参数落地到同一会话。

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
- `task` (expands to `task_create`, `task_update`, `task_get`, `task_list`, `task_stop`)
- `memory`
- `planArtifact`
- `skills` / `skill`
- `mcp`
- `subagent`
- `tool_search`
- `rdcContext`

Removed tokens `todo`、`search_codebase`、`handoff`、`agent`、`agent_handoff` are rejected (`REJECTED_TOOL_TOKENS`); use `task`、`glob`/`grep`、建议行 / `subagent` instead。禁止把 `agent` 静默映射到 `subagent`。

Tasks 能力由 route 与冻结工具集决定，不是独立 profile：只读 route 仅注入 `task_list` / `task_get`；可写 route 仅在冻结工具集确实包含 mutation 工具时才宣称可写（`task_create` / `task_update` / `task_stop`）。text-only route 不接收 tool schemas，Prompt 不得模仿或反复搜索不可用的 Tasks 工具。`askUser` token 仍是用户询问工具。`debugger` / `analyzer` / `optimizer` 是 Mission Planning Orchestrator；`general` 是 Execution Orchestrator。Mission 为 plan-only（见裁决 J）；General 在 policy 允许时可使用 `shell` / `write` / `edit` / `rdcContext`。ask/plan/edit **不是**现行 agent 身份。

## Plan 输出

`planArtifact` token 只给三 Mission。`plan_artifact` 是人机门：提交 `title` + `summary[]` + Markdown `content`，主进程覆盖 `session://plans/plan.md` 并按 `##` 切 `sections[]`。无 `surface` 不是 `hidden` 的声明则 fail-closed。批准冻结 `plan-<ISO>-<hash8>.md` 并写入 session execution offer（source / target / plan.uri+hash / 声明 requiredSkillIds）；拒绝意见回同一 tool result。用户点声明按钮切到 General。项目副本仅用户点击写入 `<project>/.rdc-agent/plans/<sessionId>/plan.md`。

## RDC Shell Actions

Open `.rdc`, connect remote, preview, and close runtime are fixed native operations executed by the main session boundary through `ShellInvocationService`, using the owning context and frozen CLI installation settings. The main process parses canonical JSON output and stores stable `RdcRuntimeContext` for later agent/tool use.
