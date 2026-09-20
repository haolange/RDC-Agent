# Scoped Runtime Resources（产品规格）

> 产品边界裁决：`DESIGN.md`。Runtime 执行细节：`docs/contracts/runtime-kernel.md`。

## Scope 与存储

用户资源根：`~/.rdc-agent`。项目资源根：`<project-root>/.rdc-agent`。无配置 workspace root、无旧目录 fallback、无静默迁移。

```text
~/.rdc-agent/
  config.json
  RDC.md
  agents/  skills/  mcp/  hooks/  policies/  knowledge/  memory/
  rdc-tool-intermediate/

<project-root>/
  RDC.md
  .rdc-agent/
    project.yaml
    agents/ skills/ mcp/ hooks/ policies/ knowledge/ memory/
    inputs/ artifacts/ plans/
```

应用拥有的 session / task / trace / UI / log / cache / secret 在 Electron OS data 下，不得写入 `~/.rdc-agent` 或项目仓库。Project `.rdc-agent/.gitignore` 排除 `inputs`、`artifacts`、`memory` 与 runtime state；`plans/` 不排除。

优先级：`builtin < user < project`。整资源替换。Project disabled override 可故意遮蔽继承资源。Policy 只收紧。`.policy.yml` `limits.contextCompactionPercent` 默认 100（不设限）；用户级 Settings → Policy 顶部 Agent Runtime 压缩阈值为 50–90、步长 5，生效值为 `min(用户设置, policy)`。RDC-Tool CLI actions 与 secret 属本机边界，不能被 project 覆盖。

Settings scoped 编辑器（Skills / MCP / Hooks / Policy）与 Agents 同级导航：User | Project 作用域行 + Import/New + 详情编辑器。禁止装饰性 “RDC Runtime” kicker；禁止 Settings Diagnostics 导航。

## Profiles

四个 builtin：`general`（Execution Orchestrator）、`debugger` / `analyzer` / `optimizer`（Planning Orchestrator）。官方文件在 `resources/agent-runtime/agents`，再与 `~/.rdc-agent/agents` 和 `<project-root>/.rdc-agent/agents` 合成 effective snapshot。user/project 只能覆盖这四个 id，或新增无关自定义 id。行为应落在指令、工具权限、审批与 handoff，而不是 mode 专用运行时分支。ask/plan/edit 及 S0 specialist id 为历史非法 id：剔出 effective snapshot + 诊断 `AGENT_ID_RESERVED_HISTORICAL`；**无运行通道**（U01 落地 v2 迁移：shadow purge，真正改过正文/工具的 builtin-id 副本 `retained-override`）。迁移 marker 为 v2（U01 已落地）。Mission planner 工具面见裁决 J（plan-only + `rdc_probe`）。

## Project Instructions

解析顺序：`~/.rdc-agent/RDC.md` → 项目根 `RDC.md` → 根到活跃目标目录链上的每个 `RDC.md`。拒绝 traversal/symlink escape；有预算与 provenance；不静默截断；不自动导入 `AGENTS.md`/`CLAUDE.md`。指令是模型上下文，不扩展文件系统或权限权威。

## Skills

目录：`skills/<skill-id>/SKILL.md`（可选 `scripts` / `references` / `assets`）。

Progressive Skill 面：

- 非空短索引由 `SkillCatalogBudget` 注入（约上下文估计 2% 或 8000 字符回退）；
- 强制 preload：`.agent.md` `skills`、composer `$skill`、session `/skills` 武装；
- 缺失 id fail-closed；空 profile `skills` = 无作者 preload，不是无发现；
- `skills` / `skill_read` 保持 `core`；禁止 lean/standard/`harness` 档位。

### 多 Skill 激活与工具面

Skill `allowed-tools` **只能收窄、永不扩展** effective profile tool set。

prepareTurn 冻结多个预载 skill 时：

```text
allowedTools = ∩(skill_i) ∩ runtimeAllowlist
```

- `skill_read` 只读取方法，不重新收窄本轮冻结工具集；
- 某个 skill 未声明或声明空列表：该 skill **不参与**收窄；
- 元工具豁免（如 `skills` / `skill_read` / `ask_user` / `tool_search`）由 `intersectSkillAllowedTools` 保留；
- 实现：`combineActiveSkillAllowlists`（`DebuggerRuntimePolicy.ts`），Orchestrator 执行路径调用。

单测：`DebuggerRuntimePolicy.test.ts`（含多 skill 交集）。

## Hooks

官方 builtin 目录：`resources/agent-runtime/hooks`。解析顺序与 ScopedResourceResolver 相同：`builtin < user < project`。`.hook.yml` 生命周期命令；结构化 `command`+`args`；禁止 `shell: true`。Hook trust fingerprint = parsed definition + 所有 resolved 脚本/参数文件 bytes + canonical realpath + scope/provenance + PATH 解析后的 executable identity；任一变化 → `needsRetrust`。builtin 默认信任且内容变化必须随仓库发布；user/project 必须显式 trust。旧仅-YAML-hash trust 在首次加载时失效并要求 retrust（不静默沿用）。运行时事件（12 canonical，单一 `HookEngine`）：`session.before-start` / `session.after-end`、`turn.before-start` / `turn.after-end`、`tool.before-call` / `tool.after-call` / `tool.on-error`、`context.before-compact` / `context.after-compact`、`agent.before-handoff` / `agent.after-handoff`、`permission.denied`。

## Memory 与 Knowledge

Memory：显式 search/read/write/delete；写入需用户意图或交互审批；删除需确认；禁止轮次自动抽取/consolidation/全索引注入。

Knowledge Center 是三列 UI（Spaces / List / Detail），只消费 Query / Index / Compile / Candidate / Write；独立 `knowledge` IPC。目标拓扑 **六 lane** markdown-first；canonical 读根对 `read_file` / `read_image` / `glob` / `grep` 免审批（U02 落地）。持久写入须显式人类确认；知识导入 摄入为 staging / Draft，不自动 Candidate。不生成、不自动注入 prompt。**当前态**：Candidate/Draft/review 已落到 session durable store；知识导入 记录并复核源 hash/mtime/size；写路径 realpath + 原子替换。Embedding capability / Semantic lane **已由 U02 删除**，禁止恢复。**T18 知识导入 已证**。产品级 Browser QA 全矩阵见 U05。目标态见 `DESIGN.md` 裁决 C / G。

## Provider Account（产品）

Account providers 是登录产品。Super Grok Account：xAI 公共 native-client + PKCE；默认浏览器一次性码粘贴；Device Code 为显式 headless 替代。不得导入 `~/.grok/auth.json` 或共享 refresh token。xAI (Grok) API-key 为独立 provider。


## 任务匹配与交接预载

General 默认只预载 execution-orchestrator；renderdoc-investigation 按真实调查目标匹配，简单问答不路由。显式 Skill、profile 默认 Skill 和 execute 合同的 requiredSkillIds 合并去重；prepareTurn 校验可用性与工具权限交集，冻结来源，来源变化要求重新准备。skill_read 仍只读方法，不重算在途权限。

Mission 必须先经 `plan_artifact` 计划门：用户点声明的 continue handoff 才冻结 Plan 并放行同 hash / 同 target 的 execute。RenderDoc Mission 的 execute 合同固定绑定共享执行方法、对应领域方法、`rdc-tool-shell` 和一本专业工具手册：Debugger 使用 `debugger-rdc-tools`，Analyzer 使用 `analyzer-rdc-tools`，Optimizer 使用 `optimizer-rdc-tools`。这四个 RDC 使用手册只对 General 可见；Mission 可以在合同中声明其 id，但不能读取或执行其工具。手册成员表是知识覆盖，不是权限表；未知操作、身份覆盖、路径越界或未满足前置条件仍在主进程执行前拒绝。

专业参数参考由 `scripts/generate-rdc-tool-guides.mjs` 从相邻 RDC-Tool 1.0.0 代码生成 catalog 读取，记录 catalog fingerprint。开发校验使用 `pnpm run check:rdc-tool-guides -- --catalog <RDC-Tool>/spec/tool_catalog.json`；生成内容不作为运行时 catalog，产品执行仍读取 prepareTurn 冻结的同一配置 CLI。

Plan / handoff v2 / 两轮预算 / 领域完成校验的权威约定见 [runtime-kernel.md](../contracts/runtime-kernel.md#通用-harness-与结构化交接2026-09-09)。
