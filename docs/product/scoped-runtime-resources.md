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

四个 builtin：`general`（Execution Orchestrator）、`debugger` / `analyzer` / `optimizer`（Planning Orchestrator）。官方文件在 `resources/agent-runtime/agents`，再与 `~/.rdx/agents` 和 `<project-root>/.rdx/agents` 合成 effective snapshot。user/project 只能覆盖这四个 id，或新增无关自定义 id。行为应落在指令、工具权限、审批与 handoff，而不是 mode 专用运行时分支。ask/plan/edit 及 S0 specialist id 为历史非法 id：剔出 effective snapshot + 诊断 `AGENT_ID_RESERVED_HISTORICAL`；**无运行通道**（U01 落地 v2 迁移：shadow purge，真正改过正文/工具的 builtin-id 副本 `retained-override`）。代码仍是 v1 marker（U01 修）。Mission planner 工具面见裁决 J（plan-only + `rdx_probe`）。

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

官方 builtin 目录：`resources/agent-runtime/hooks`。解析顺序与 ScopedResourceResolver 相同：`builtin < user < project`。`.hook.yml` 生命周期命令；结构化 `command`+`args`；禁止 `shell: true`。Hook trust fingerprint = parsed definition + 所有 resolved 脚本/参数文件 bytes + canonical realpath + scope/provenance + PATH 解析后的 executable identity；任一变化 → `needsRetrust`。builtin 默认信任且内容变化必须随仓库发布；user/project 必须显式 trust。旧仅-YAML-hash trust 在首次加载时失效并要求 retrust（不静默沿用）。运行时事件（12 canonical，单一 `HookEngine`）：`session.before-start` / `session.after-end`、`turn.before-start` / `turn.after-end`、`tool.before-call` / `tool.after-call` / `tool.on-error`、`context.before-compact` / `context.after-compact`、`agent.before-handoff` / `agent.after-handoff`、`permission.denied`。

## Memory 与 Knowledge

Memory：显式 search/read/write/delete；写入需用户意图或交互审批；删除需确认；禁止轮次自动抽取/consolidation/全索引注入。

Knowledge Center 是三列 UI（Spaces / List / Detail），只消费 Query / Index / Compile / Candidate / Write；独立 `knowledge` IPC。目标拓扑 **六 lane** markdown-first；canonical 读根对 `read_file` / `read_image` / `glob` / `grep` 免审批（U02 落地）。持久写入须显式人类确认；ColdData 摄入为 staging / Draft，不自动 Candidate。不生成、不自动注入 prompt。**当前态**：Candidate/Draft/review 已落到 session durable store；ColdData 记录并复核源 hash/mtime/size；写路径 realpath + 原子替换。源码仍含 Semantic / Embedding，由 U02 删除。**T18 ColdData 已证**。产品级 Browser QA 全矩阵见 U05。目标态见 `DESIGN.md` 裁决 C / G。

## Provider Account（产品）

Account providers 是登录产品。Super Grok Account：xAI 公共 native-client + PKCE；默认浏览器一次性码粘贴；Device Code 为显式 headless 替代。不得导入 `~/.grok/auth.json` 或共享 refresh token。xAI (Grok) API-key 为独立 provider。
