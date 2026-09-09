# RDX Runtime

RDX Runtime 是 RDC-Agent 的资源解析、Prompt 构建与运行期可观测性边界。产品与工程决策以根目录 `DESIGN.md` 为 SSOT；本文描述对应的稳定实现契约。

## Scope 与存储边界

- User Scope 固定为 `~/.rdx`。
- Project Scope 固定为 `<project-root>/.rdx`。
- 应用内部状态位于 `${userData}/state`，Secret、日志和缓存位于 OS `userData` 下。
- Project `inputs/`、`artifacts/`、`memory/` 与 runtime state 默认不进入 Git。
- RDX CLI 与 shell actions 是 User/Device 配置，Project 资源不能覆盖本机执行入口。

`ScopedResourceResolver` 对 Agent、Skill、MCP、Hook 使用 `builtin < user < project` 的 whole-resource override，同 ID 的 Project disabled resource 可以隐藏继承项。Policy 只允许收紧；放宽、无效或不可比较的配置 fail-closed。

每项 resolved resource 携带 `scope`、`sourcePath`、`sourceHash`、`overriddenSource` 与 `effectiveStatus`。Renderer 通过 `rdxRuntime` preload API 获取这些信息，不直接访问文件系统、Secret 或任意 shell。

## Project Instructions

`ScopedInstructionResolver` 按确定性顺序加载：

1. `~/.rdx/RDX.md`
2. Project 根目录 `RDX.md`
3. 从 Project 根到目标目录逐级出现的 `RDX.md`

目标目录来自 session cwd、附件或当前 capture。带路径的工具调用会重新解析新增目录链。越界、symlink escape、解析错误和预算截断进入诊断，不静默忽略。不自动读取 `AGENTS.md` 或 `CLAUDE.md`。

## Agent、Skill、MCP 与 Hook

- `.agent.md` 是 Agent Profile 的唯一来源，使用 YAML frontmatter + Markdown。
- Skill 使用 `<skill-id>/SKILL.md` 与可选的 `scripts/`、`references/`、`assets/`。
- Progressive Skill：非空 metadata catalog 一律注入短索引（`SkillCatalogBudget`）；`.agent.md` `skills`、composer `$skill-id`、以及 session-scoped `/skills` 武装在首次 LLM 调用前全文 preload（缺失 fail-closed）；其余 Skill 经 core `skills` / `skill_read` 渐进加载。禁止 lean/standard harness 档位。
- MCP 由 scoped `.mcp.json` 与 exact effective Agent profile 决定；pool 按 `projectRoot + descriptorHash` 隔离，以 ref-counted lease 保证 Project 切换不关闭在用连接。 The leased pool key is passed through tool assembly and execution.
- Hook 使用 `.hook.yml`、结构化 command/args、`shell: false`、timeout 与 `block | warn` failure policy。分发根为 `resources/agent-runtime/hooks`（builtin）+ `~/.rdx/hooks` + `<project>/.rdx/hooks`，顺序 `builtin < user < project`。
- 运行时接线：`session.*`、`turn.*`、`tool.*`、`context.*`、`agent.*`、`permission.denied`。唯一引擎是 `HookEngine`。
- Project Hook 按 `project + content hash` 授信，内容变化或资源删除自动撤销授信。

## Prompt 与请求管线

```text
Scoped Runtime Resolution
  -> PromptPlanBuilder
  -> Context / Message Transformation
  -> RequestEnvelopeBuilder
  -> Provider Adapter
  -> Provider Wire Request
```

`PromptPlan` 的每个 segment 都保存 kind、scope、path、hash、precedence、content 与 token estimate。`RequestEnvelopeBuilder` 负责 provider-neutral 的完整合并；Provider Adapter 只映射 wire protocol。

每次 `llm_turn` 保存脱敏 `RequestEnvelopeSnapshot`，包含 effective instructions、messages、tools、resource provenance、provider/model/protocol、usage 与 redaction metadata。Credential、capture binary 和 provider protected payload 不落盘；protected payload 只保留 hash 与脱敏原因。快照经 `RequestSnapshotStore` 落盘，并由 `rdx-runtime:listSnapshots` / `getSnapshot` 提供给日后专用 Debug View（Copilot Chat Debug View 级）消费；当前无 Settings Diagnostics 产品入口，也不得挂到默认 Session/Trace 右侧面板或嵌入 Work Process 消息流。快照是 provider-neutral 脱敏信封，不是 Work Process loop meta，也不是 Terminal runtime log。

## Context Usage 计量

Composer 的 context usage 环与弹窗由 `RunContextUsageSummary` 驱动：占用率分母是 `promptBudgetTokens`（可执行 prompt 上限，例如 DeepSeek V4 1M 窗口为 1M，不再扣模型输出上限），完整窗口写入 `contextWindowTokens`，模型输出上限写入 `maxOutputTokens`，压缩线写入 `compactionThresholdTokens`。窗口占用率与本 run In/Out 来自 provider 上报的真实 usage。Settings 切换 agent model 或 Composer 切换 1M/Max tier 后、下一次发送前，renderer 用当前 `EffectiveModel` 的 `contextBudgetTokens` 对 `lastKnownUsage.occupiedTokens` 做纯派生预览（圆环与弹窗百分比带 `~`，明细 token 绝对值保留、`free` 按新分母重算或补齐，并同步投影完整窗口、输出上限与压缩线），不写 store、不发 IPC、不改 `usage.json`。idle 无用量时环回退 `profile.contextBudgetTokens`，不得显示完整窗口。`current`（prepared）高于该预览；`preparing` 圆环保持 `…`，弹窗与环进度仍沿用切换后估算，避免弹回旧窗口。发送后 prepared 与 `workflow:runUsageChanged` 的真实 usage 无缝接管。hero 下显示压缩线、条件完整窗口（仅 window > budget）与本轮可生成；分段条带压缩线刻度，圆环不标压缩位置。弹窗 Actual / Last actual 为同行三张独立圆角卡片：`Tokens`（In / Out / Total）、`Cache`、`Reasoning`；Cost 为同语言全宽卡。Cache 统计范围是当前 Agent Run（不是跨 session 累计，也不是 Token Economy 压缩节省）：`cacheSavedTokens` = 累计 hit；`lastTurnCacheHitRate` / `cumulativeCacheHitRate` = `hit / (hit + miss)`（百分数，分母为 0 时缺省）；命中/未命中为 token 计数。归一化在 provider usage 出口完成：优先原生 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`，否则 `hit = cacheRead`、`miss = max(input − hit, 0)`；无原生且无 cacheRead 时不产出 hit/miss。UI 固定三栏，Cache / Reasoning 缺遥测时显示 `—`（不造假 0 / 0%）。wire 层仍可保留 `cacheReadTokens` / `cacheWriteTokens` 供诊断，主展示不再用 Cache read 双轨。分类 breakdown（system_prompt、memory_files、skills、system_tools、mcp_tools、mcp_tools_deferred、builtin_tools_deferred、subagent_definitions、summarized_conversation、conversation、free）为 chars/4 估算，按 provider `inputTokens` 缩放对齐。`memory_files` 段覆盖 RDX.md scoped instruction 链；`mcp_tools_deferred` / `builtin_tools_deferred` 段仅计未激活 deferred schema 的估算量，不参与缩放、不占用堆叠条与 free 计算。Debug 与 Composer/Ask 路径均经 `PromptPlanBuilder` 产出可拆分的 metrics。`workflow:getRunUsage` 使用唯一对象参数 `{ sessionId, runId? }`，并校验 run/session ownership；`workflow:runUsageChanged` 是 `SessionScopedPayload<RunContextUsageSummary>`。Debug 按 `runId` 聚合，普通对话按顶层 `turnId` 聚合；每次 provider call 更新 effective provider/model，同时累计本轮 Tokens、Cache 与 Reasoning。最新快照随 session 落盘至 `<sessionDir>/usage.json`（subagent 隔离 session 不落盘），格式为 `{ schemaVersion: '2', usage }`；v0 裸对象先迁到 v1（补 promptBudget / 窗口 / 输出预留），v1 `outputReserveTokens` 再迁到 v2 `maxOutputTokens` 并补 `compactionThresholdTokens`；未知更高版本 `STORAGE_SCHEMA_UNSUPPORTED` fail-closed。应用重启或内存 miss 回读时才标记 stale。active 与 background session 都经同一 projection reducer，迟到事件按 session + turn/run identity 丢弃。terminal 不清空 `lastKnownUsage`，也不改变回读查询身份；仅从未取得真实快照的新 session 显示「暂无用量」。

## Memory、Knowledge 与 Reasoning

Memory 只有 `memory_search`、`memory_read`、`memory_write`、`memory_delete` 四个 scoped tool。Write 需要明确用户意图或批准，Delete 需要确认；没有自动抽取、turn counter、consolidation 或全索引 Prompt 注入。

Knowledge Center 是三列 UI，只消费 Query / Index / Compile / Candidate / Write。IPC 为 `knowledge:overview` / `query` / `card` / `compile` / `index:rebuild` / `candidates` / `candidateCreate` / `coldDataImport` / `write` / `promote`。持久写入必须显式人类确认；ColdData 导入不自动创建 Candidate。生成引擎另立设计。

Reasoning 使用 `raw | summary | opaque | none | unknown`。语义来自 Provider/Model contract，不从 OpenAI/Anthropic compatibility protocol 推断。App-managed 且有文档证据的 DeepSeek / Kimi / GLM / MiniMax / MiMo 等解析为 `raw`；真正未核实的第三方路由才是 `unknown`。Work Process 顶层用「工作中 / 工作过程」，loop thinking 用「正在思考 / 已思考 · {duration}」（前置 quiet icon，不用「深度思考」），不展示「语义未验证」。commentary 渲染为 markdown 散文（`proseText`），永不顶 thinking 槽；最终答案仅在 assistant message body 中以 full-bleed prose 呈现，不用 raised bubble。

## 受控 API

`rdxRuntime` preload domain 提供：

- scoped resource overview / validate / upsert / delete / reveal
- Hook trust / revoke / test
- Request snapshot list / detail

Memory 与 Knowledge 使用独立 scoped preload domain（`memory` / `knowledge`）。Renderer 不获得任意 tool execute、任意 shell、Secret 或 provider protected payload 接口。


## 原生 CLI 与执行回执（2026-09-09）

只支持原生 rdx 协议；Settings 保留 executable、argsPrefix、工作目录、环境、超时和桌面 actions。prepareTurn 把 CLI/actions 深拷贝冻结在主进程私有 binding；EffectiveRuntimePlan 只序列化指纹，不暴露 env。执行中修改 Settings 不改变当前调用。

rdx_probe 保留七个应用 action，映射如下：

| 应用 action | 原生命令 |
| --- | --- |
| version | version --json（原生 parser 的子命令会覆盖前置 JSON 标志） |
| doctor | --json doctor |
| enumerate | --json tools list |
| preview_status | --json --daemon-context <owned> session preview status |
| probe | 封闭 context status / event list,show / pipeline show / resource list / vfs ls,cat |
| lease_open / lease_close | 应用的 owning session/capture 生命周期；先核对真实 context 状态，不生成虚构 CLI 动词 |

event/path 参数逐操作校验，不接收任意 argv 或 regex 猜测的“只读” operation。VFS 只允许 canonical 窄路径，cat 不读根/大目录。contextId 不允许切到别的 session；应用 session ID 不作为 replay --session-id 传递。非零退出、空/非法 JSON、ok:false、取消、超时或 context 不匹配均失败；失败关闭不清 lease，也不终止无关 shell 子进程。Desktop actions 同样要求原生 canonical JSON。

General 使用已有 shell 工具的结构化模式：
```json
{"rdx":{"operation":"rd.perf.get_frame_timing","args":{},"experimentId":"exp-1"}}
```
command 与 rdx 互斥，schema 和执行入口均检查。operation 当前限定 session-scoped rd.shader/perf/event/pipeline/resource/export；原生目录仍由外部 CLI 维护，不向 prompt 展开完整 schema。主进程注入 replay session_id 与 owning daemon context，拒绝模型指定身份。Mission/offline child/delegated mutation/default context fail-closed；串行调用沿用 ShellInvocationService/ProcessSupervisor 与 shell 审批。

有 experimentId 的成功调用写入 session tool-outputs：主进程签名回执绑定 session/project/turn/toolCall/experiment/context/leaseVersion/replaySession、operation、参数指纹、退出码、结果 hash 和开始/结束时间。签名 key 由 OS safeStorage 保管，不进 prompt/IPC/trace；先确认可签名再执行，落盘遵守 SessionArtifactResolver 配额/原子写/取消边界。普通查询不强制永久落盘；手写文件或 shell 回显不能成为可信回执。

Experiment.executionEvidence 为可选五阶段引用组。历史无该字段可读；新关闭、ready report 与 Mission 完成必须验证成功签名、同 experiment/context/lease、顺序及同参数测量。当前介入/恢复支持 edit_and_replace → 同 replacement_id 的 revert_replacement；测量为 frame timing、event durations、counters、screenshot 或 texture export。拒绝/未执行/缺恢复测量不算回滚。回执证明执行及结果，不自动证明因果、质量、噪声或优化收益。

验证：RdxNativeParser.test.ts 接受显式 RDX_NATIVE_TOOLS_ROOT / RDX_NATIVE_PYTHON，用外部实际 parser 校验生产 argv 与 JSON 标志。RdxNativeExecution.test.ts 仅在显式 RDX_NATIVE_PYTHON / RDX_NATIVE_CAPTURE / RDX_NATIVE_ALLOW_MUTATION=1 下，对临时副本进行真实像素介入、签名证据与回滚，finally 停 daemon；默认单测不碰真实 capture。

Human preview 关闭由 main 使用当前配置 CLI 的冻结快照编译原生 `session preview off`；不新增 closePreview 配置项。只有所属 context 的 canonical 成功结果且 `preview.enabled === false` 才投影 closed，失败保留错误并保持 capture lease。openPreview 缺少 enabled=true 不能投影 open。远程 prepared handle 在 open 前单次消费，失败后必须重新 connectRemote。
