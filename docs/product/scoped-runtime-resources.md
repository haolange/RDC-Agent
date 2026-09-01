# Scoped Runtime Resources（产品规格）

> 产品边界裁决：`DESIGN.md`。Runtime 执行细节：`docs/contracts/runtime-kernel.md`。

## Scope 与存储

用户资源根：`~/.rdx`。项目资源根：`<project-root>/.rdx`。无配置 workspace root、无旧目录 fallback、无静默迁移。

```text
~/.rdx/
  config.json
  RDX.md
  agents/  skills/  mcp/  hooks/  policies/  knowledge/  memory/

<project-root>/
  RDX.md
  .rdx/
    project.yaml
    agents/ skills/ mcp/ hooks/ policies/ knowledge/ memory/
    inputs/ artifacts/
```

应用拥有的 session / task / trace / UI / log / cache / secret 在 Electron OS data 下，不得写入 `~/.rdx` 或项目仓库。Project `.rdx/.gitignore` 排除 `inputs`、`artifacts`、`memory` 与 runtime state。

优先级：`builtin < user < project`。整资源替换。Project disabled override 可故意遮蔽继承资源。Policy 只收紧。`.policy.yml` `limits.contextCompactionPercent` 默认 100（不设限）；用户级 Settings → Policy 顶部 Agent Runtime 压缩阈值为 50–90、步长 5，生效值为 `min(用户设置, policy)`。RDX CLI actions 与 secret 属本机边界，不能被 project 覆盖。

Settings scoped 编辑器（Skills / MCP / Hooks / Policy）与 Agents 同级导航：User | Project 作用域行 + Import/New + 详情编辑器。禁止装饰性 “RDX Runtime” kicker；禁止 Settings Diagnostics 导航。

## Profiles

Wave 1 四个 builtin：`general`（Execution Orchestrator）、`debugger` / `analyzer` / `optimizer`（Planning Orchestrator）。官方文件在 `resources/agent-runtime/agents`，再与 `~/.rdx/agents` 和 `<project-root>/.rdx/agents` 合成 effective snapshot。行为应落在指令、工具权限、审批与 handoff，而不是 mode 专用运行时分支。用户保留的 ask/plan/edit 仍可按 custom manifest 运行。

## Project Instructions

解析顺序：`~/.rdx/RDX.md` → 项目根 `RDX.md` → 根到活跃目标目录链上的每个 `RDX.md`。拒绝 traversal/symlink escape；有预算与 provenance；不静默截断；不自动导入 `AGENTS.md`/`CLAUDE.md`。指令是模型上下文，不扩展文件系统或权限权威。

## Skills

目录：`skills/<skill-id>/SKILL.md`（可选 `scripts` / `references` / `assets`）。

Progressive Skill 面：

- 非空短索引由 `SkillCatalogBudget` 注入（约上下文估计 2% 或 8000 字符回退）；
- 强制 preload：`.agent.md` `skills`、composer `$skill`、session `/skills` 武装；
- 缺失 id fail-closed；空 profile `skills` = 无作者 preload，不是无发现；
- `skills` / `skill_read` 保持 `core`；禁止 lean/standard/`harness` 档位。

### 多 Skill 激活与工具面

Skill `allowed-tools` **只能收窄、永不扩展** effective profile tool set。

多 skill 同时激活（preload + `skill_read`）时：

```text
allowedTools = ∩(skill_i) ∩ runtimeAllowlist
```

- 某个 skill 未声明或声明空列表：该 skill **不参与**收窄；
- 元工具豁免（如 `skills` / `skill_read` / `ask_user` / `tool_search`）由 `intersectSkillAllowedTools` 保留；
- 实现：`combineActiveSkillAllowlists`（`DebuggerRuntimePolicy.ts`），Orchestrator 执行路径调用。

单测：`DebuggerRuntimePolicy.test.ts`（含多 skill 交集）。

## Hooks

官方 builtin 目录：`resources/agent-runtime/hooks`。解析顺序与 ScopedResourceResolver 相同：`builtin < user < project`。`.hook.yml` 生命周期命令；结构化 `command`+`args`；禁止 `shell: true`。Project hooks 需按项目身份与内容 hash trust；变更撤销 trust。运行时事件：`session.before-start` / `session.after-end`、`turn.before-start` / `turn.after-end`、`tool.before-call` / `tool.after-call` / `tool.on-error`、`context.before-compact` / `context.after-compact`、`agent.before-handoff` / `agent.after-handoff`、`permission.denied`。

## Memory 与 Knowledge

Memory：显式 search/read/write/delete；写入需用户意图或交互审批；删除需确认；禁止轮次自动抽取/consolidation/全索引注入。

Knowledge Center 是三列 UI（Spaces / List / Detail），只消费 Query / Index / Compile / Candidate / Write；独立 `knowledge` IPC。持久写入须显式人类确认；ColdData 摄入为 staging / Draft，不自动 Candidate。不生成、不自动注入 prompt。

## Provider Account（产品）

Account providers 是登录产品。Super Grok Account：xAI 公共 native-client + PKCE；默认浏览器一次性码粘贴；Device Code 为显式 headless 替代。不得导入 `~/.grok/auth.json` 或共享 refresh token。xAI (Grok) API-key 为独立 provider。
