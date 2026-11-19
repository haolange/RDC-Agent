# Scoped Runtime Resources（产品规格）

> 产品边界裁决：`ARCHITECTURE.md`。Runtime 执行细节：`docs/contracts/runtime-kernel.md`。

## Scope 与存储

用户资源根：`~/.rdc-agent`。项目资源根：`<project-root>/.rdc-agent`。无配置 workspace root、无旧目录 fallback、无静默迁移。`RDC_AGENT_HOME` 只供测试与 disposable Browser QA 隔离使用，不是用户配置入口。

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

优先级：`builtin < user < project`。整资源替换。Project disabled override 可故意遮蔽继承资源。Policy 只收紧；放宽、无效或不可比较的配置 fail-closed。每项 resolved resource 携带 `scope`、`sourcePath`、`sourceHash`、`overriddenSource` 与 `effectiveStatus`，Renderer 经 `rdcRuntime` preload API 读取，不直接访问文件系统、Secret 或任意 shell。`.policy.yml` `limits.contextCompactionPercent` 默认 100（不设限）；Settings → Policy 在自定义策略资源下方提供独立的全局运行设置，压缩阈值为 50–90、步长 5，作用于全部会话，不随 User / Project 资源切换改变归属；生效值为 `min(用户设置, policy)`。RDC-Tool CLI actions 与 secret 属本机边界，不能被 project 覆盖。

Settings scoped 编辑器（Skills / MCP / Hooks / Policy）与 Agents 同级导航：User | Project 作用域行 + Import/New + 详情编辑器。禁止装饰性 “RDC Runtime” kicker；禁止 Settings Diagnostics 导航。

## Profiles

首次上手说明不会复制官方资源或创建指令文件。已阅读标记属于 Electron 应用状态；用户/项目资源仅承载各自自定义内容。官方 Agent 文件直接位于 `resources/agent-runtime/agents/*.agent.md`。

四个默认入口是 `general`、`debugger`、`analyzer`、`optimizer`；另有八个默认内部 Agent（详见 ARCHITECTURE 裁决 A）。官方文件与 user/project 资源经同一优先级合成 effective snapshot；内部 Agent 默认不作为顶层入口。每个 Agent 的模型、推理档位与默认 Skill 随其配置解析，子执行不继承父回合模型覆盖。历史非法 ID 继续诊断 `AGENT_ID_RESERVED_HISTORICAL`；资源读取不改写用户文件。

Agent 配置诊断使用单一结构化契约 `AgentManifestDiagnostic`：`code / severity / scope / agentId / sourcePath / message`。无效候选由资源解析器报告，主进程汇总时按规范化绝对来源路径、代码和原因去重；同一文件的不同原因保持独立。运行前检查按 Agent ID 与作用域定位，不解析英文文案或文件名子串。Settings 列表仅显示唯一问题数量，现有 TaskDialog 承载 User / Project 来源、完整路径与“这份配置未生效”的说明，原始原因按需展开；不推测替代定义。详情正文可滚动、框选和复制单条/全部，刷新为零条时不自动关闭已打开的详情。

User 覆盖保持整资源替换。人工整理旧覆盖时，以当前内置定义为基准保留有效的模型绑定和显式执行上限，严格校验候选并防止并发覆盖；不引入字段继承、旧字段别名、启动写入或自动迁移器。

自定义 Profile 新建时工具权限为空；运行时按 `AGENT_TOOLS_EMPTY` 拒绝零工具配置。Settings 的配置状态必须同时检查模型路由与至少一项工具授权，零工具时提示用户到「工具权限」选择能力，不显示「可用」。

Settings 的 Agents「新建智能体」沿当前 User/Project 作用域创建；Project 草稿冻结创建时的项目 ID，自动保存到该项目的 `.rdc-agent/agents`，切换项目不会把待保存草稿改写到新项目。User 草稿写入用户资源根；作用域切换只过滤所显示的定义，不暗中改变已有草稿的写入归属。

## Project Instructions

解析顺序：`~/.rdc-agent/RDC.md` → 项目根 `RDC.md` → 根到活跃目标目录链上的每个 `RDC.md`。拒绝 traversal/symlink escape；有预算与 provenance；不静默截断；不自动导入 `AGENTS.md`/`CLAUDE.md`。指令是模型上下文，不扩展文件系统或权限权威。

## Skills

目录：`skills/<skill-id>/SKILL.md`（可选 `scripts` / `references` / `assets`）。

Settings 的交接预载与 Agent 技能能力选择共享 runtime overview 的只读 `skillSelection` 投影，候选复用主进程实际解析结果及目标可见性，包含 builtin/user/project 的生效覆盖关系。它不是执行权限或冻结目录；读取失败与空目录分别呈现。UI 保留已选但缺失或目标不可用的 ID 并提示，不静默丢弃；新增选择去重且保留顺序，持久化仍为原有 ID 数组。技能资源编辑列表只显示名称/ID及必要状态，完整 description 保留在原文件正文中。

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

- `skill_read` 只读取方法，不重新收窄本回合冻结工具集；
- Skill 的 `references/` 文本通过同一个 `skill_read(skill_id, reference, offset?, limit?)` 渐进读取，`reference` 相对当前有效 Skill 的 `SKILL.md`，不得相对工作区猜路径。沿用 profile 可见性和 builtin/user/project 覆盖解析，限制精确引用路径、禁止绝对路径/穿越/符号链接，复用文本大小、二进制及分页门禁，返回原文件完整字节 SHA-256、来源与截断状态。读取不执行脚本、不增加普通文件根、不授予 edit_file/read-before-edit 资格，也不刷新在途权限或 RDC 绑定；本次读取的引用 hash 是方法来源观察，不冒称已预载引用正文。
- 某个 skill 未声明或声明空列表：该 skill **不参与**收窄；
- 元工具豁免（如 `skills` / `skill_read` / `ask_user` / `tool_search`）由 `intersectSkillAllowedTools` 保留；
- 实现：`combineActiveSkillAllowlists`（`RuntimeToolPolicy.ts`），Orchestrator 执行路径调用。

单测：`RuntimeToolPolicy.test.ts`（含多 skill 交集）。

## Hooks

官方 builtin 目录：`resources/agent-runtime/hooks`。解析顺序与 ScopedResourceResolver 相同：`builtin < user < project`。`.hook.yml` 生命周期命令；结构化 `command`+`args`；禁止 `shell: true`。Hook trust fingerprint = parsed definition + 所有 resolved 脚本/参数文件 bytes + canonical realpath + scope/provenance + PATH 解析后的 executable identity；任一变化 → `needsRetrust`。builtin 默认信任且内容变化必须随仓库发布；user/project 必须显式 trust。旧仅-YAML-hash trust 在首次加载时失效并要求 retrust（不静默沿用）。运行时事件（12 canonical，单一 `HookEngine`）：`session.before-start` / `session.after-end`、`turn.before-start` / `turn.after-end`、`tool.before-call` / `tool.after-call` / `tool.on-error`、`context.before-compact` / `context.after-compact`、`agent.before-handoff` / `agent.after-handoff`、`permission.denied`。

## Memory 与 Knowledge

Memory：显式 search/read/write/delete；写入需用户意图或交互审批；删除需确认；禁止轮次自动抽取/consolidation/全索引注入。

Knowledge Center 是三列 UI（Spaces / List / Detail），消费 Query / Index / Compile / Candidate / Read / Topics / Write；独立 `knowledge` IPC，主要通道为 `knowledge:overview` / `query` / `card` / `read` / `compile` / `index:rebuild` / `candidates` / `candidateCreate` / `import` / `image` / `write` / `promote` / `topics:*`。知识库只有 user `~/.rdc-agent/knowledge` 与 project `<项目>/.rdc-agent/knowledge`，会话不是知识库。拓扑为 **六 lane** markdown-first，正文以 Markdown 为唯一来源；canonical 读根对 `read_file` / `read_image` / `glob` / `grep` 免审批。查询可按 scope、时间和索引版本分页，指定不存在的空间 ID 时明确报错并返回可用 ID；主题及同义词可批量提议、预览和确认，提议本身不改写分类。持久写入须显式人类确认：`knowledge:import` 在同一次点击里签发并消费 `knowledge.write` token，把源 hash/mtime/size 复核后的内容写入所选空间 staging / Draft，不自动 Candidate。Candidate / Draft / review 落在 session durable store；写路径 realpath + 原子替换。不生成、不自动注入 prompt。Embedding capability / Semantic lane 已删除，**禁止恢复**。目标态见 `ARCHITECTURE.md` 裁决 C / G。

Agent 与 Knowledge Center 共用版本读取规则：`summary` 可不带 hash 首次读取；`section`、`range` 和 `full` 必须携带当前搜索或摘要返回的 `contentHash`，缺失或变化时明确要求刷新。`knowledge_read` 省略 mode 时仍是 `full`，所以同样需要 hash；返回的章节标题、层级、行号和总行数与该次读取的正文版本一致，供后续精确选择。

`knowledge_read` 在 Agent 主动读取卡片后，为声明图片保留知识根相对路径和角色，并仅在当前空间 realpath 与冻结 Knowledge 读根匹配、图片 realpath 未越界时返回可直接交给 `read_image` 的 `readImageArgs`。知识相对路径不按工程路径解释；缺失读范围、文件消失或链接越界分别显式返回 `readError`，不猜根、不回退。该参数不新增授权，也不代表像素已读；实际图像、类型及 hash 仍以正常 `read_image` 成功结果为准。卡片和图片不会因此自动注入初始 Prompt，持久内容/schema 不变。

## Provider Account

Provider 账号登录、Catalog 与凭据模型见 [`docs/architecture/provider-architecture.md`](../architecture/provider-architecture.md)。

## MCP

MCP 由 scoped `.mcp.json` 与 exact effective Agent profile 决定；pool 按 `projectRoot + descriptorHash` 隔离，以 ref-counted lease 保证 Project 切换不关闭在用连接，leased pool key 贯穿工具装配与执行。

## Context Usage

Composer 的 context usage 环与弹窗由 `RunContextUsageSummary` 驱动：占用率分母是 `promptBudgetTokens`（可执行 prompt 上限，不再扣模型输出上限），完整窗口写入 `contextWindowTokens`，输出上限写入 `maxOutputTokens`，压缩线写入 `compactionThresholdTokens`。窗口占用率与本 run In/Out 来自 provider 上报的真实 usage。切换 agent model 或 1M/Max tier 后、下一次发送前，renderer 用当前 `EffectiveModel` 的 `contextBudgetTokens` 对 `lastKnownUsage.occupiedTokens` 做纯派生预览（百分比带 `~`），不写 store、不发 IPC、不改 `usage.json`；发送后由 prepared 与 `workflow:runUsageChanged` 的真实 usage 接管。

Cache 统计范围是当前 Agent Run：`cacheSavedTokens` 为累计 hit，命中率为 `hit / (hit + miss)`（分母为 0 时缺省）。归一化在 provider usage 出口完成：优先原生 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`，否则 `hit = cacheRead`、`miss = max(input − hit, 0)`；无原生且无 cacheRead 时不产出 hit/miss，缺遥测时 UI 不伪造 0。分类 breakdown（system_prompt、memory_files、skills、system_tools、mcp_tools、mcp_tools_deferred、builtin_tools_deferred、subagent_definitions、summarized_conversation、conversation、free）为 chars/4 估算并按 provider `inputTokens` 缩放；`memory_files` 覆盖 RDC.md 指令链，两个 deferred 段只计未激活 schema 的估算量，不缩放、不占 free。

`workflow:getRunUsage` 使用唯一对象参数 `{ sessionId, runId? }` 并校验 run/session ownership；`workflow:runUsageChanged` 是 `SessionScopedPayload<RunContextUsageSummary>`。最新快照落盘至 `<sessionDir>/usage.json`（subagent 隔离 session 不落盘），格式 `{ schemaVersion: '2', usage }`；缺版本、旧版本与未知版本一律 `STORAGE_SCHEMA_UNSUPPORTED` fail-closed 并保留原件，不迁移。active 与 background session 经同一 projection reducer，迟到事件按 session + turn/run identity 丢弃；terminal 不清空 `lastKnownUsage`。

## Reasoning

Reasoning 使用 `raw | summary | opaque | none | unknown`。语义来自 Provider/Model contract，不从 OpenAI/Anthropic compatibility protocol 推断；有文档证据的 App-managed 路由解析为 `raw`，真正未核实的第三方路由才是 `unknown`。Work Process 展示规则见 [`docs/ui/workbench-and-transcript.md`](../ui/workbench-and-transcript.md)。

## 任务匹配与交接预载

General 默认只预载 execution-orchestrator；renderdoc-investigation 按真实调查目标匹配，简单问答不路由。显式 Skill、profile 默认 Skill 和 execute 合同的 requiredSkillIds 合并去重；prepareTurn 校验可用性与工具权限交集，冻结来源，来源变化要求重新准备。skill_read 仍只读方法，不重算在途权限。

Agent `max-turns` 属于 profile 资源，按 builtin < user < project 整资源替换解析，再与 policy 取较小者冻结进 prepareTurn；未声明 `max-turns` 时不设固定上限。Skill 方法只引用这些冻结额度与用户明确限制，不在计划中另设阶段配额硬门。

Mission 必须先经 `plan_artifact` 计划门：用户点声明的 continue handoff 才冻结 Plan 并放行同 hash / 同 target 的 execute。RenderDoc Mission 的 execute 合同固定绑定共享执行方法、对应领域方法、`rdc-tool-shell` 和一本专业工具手册：Debugger 使用 `debugger-rdc-tools`，Analyzer 使用 `analyzer-rdc-tools`，Optimizer 使用 `optimizer-rdc-tools`。General 可发现四本手册；每条 Mission 可按需只读共享手册和对应的专业手册及引用，提前核对参数、输出及调用成本，其它专业手册保持不可见。知识可见性沿用 builtin/user/project 覆盖与来源解析，不自动预载、不授予执行或工作区编辑权限。Mission 的 plan-only、General 的 requiredSkillIds 真正预载与冻结工具交集不变；手册成员表是知识覆盖，不是权限表。未知操作、身份覆盖、路径越界或未满足前置条件仍在主进程执行前拒绝。

专业参数参考由 `scripts/generate-rdc-tool-guides.mjs` 生成并记录 catalog fingerprint。默认生成与 `pnpm run check:rdc-tool-guides` 使用本库 `scripts/fidelity/rdc-tool-guide-catalog.json` 源快照，独立检出不依赖相邻仓库。更新时显式执行 `node scripts/generate-rdc-tool-guides.mjs --catalog <RDC-Tool>/spec/tool_catalog.json`，同次刷新参考与源快照；`--check --catalog <path>` 只读核对指定来源。快照仅供开发生成校验，不随应用分发，不作为运行时 catalog；产品执行仍读取 prepareTurn 冻结的同一配置 CLI。

Plan、声明交接、显式预算与领域完成校验见 [runtime-kernel.md](../contracts/runtime-kernel.md#通用-harness-与声明续跑)。
