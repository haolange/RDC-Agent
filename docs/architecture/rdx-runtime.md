# RDX Runtime

RDX Runtime 是 RDC-Agent 的资源解析、Prompt 构建与运行期可观测性边界。产品与工程决策以根目录 `DESIGN.md` 为 SSOT；本文描述对应的稳定实现契约。

## Scope 与存储边界

- User Scope 固定为 `~/.rdx`（`RDC_AGENT_HOME` 可覆盖该根）。
- Project Scope 固定为 `<project-root>/.rdx`。
- 应用内部状态位于 `${userData}/state`，Secret、日志和缓存位于 OS `userData` 下。
- Project `inputs/`、`artifacts/`、`memory/` 与 runtime state 默认不进入 Git。
- RDX CLI 安装位置、参数前缀、工作目录、环境与超时是 User/Device 配置，Project 资源不能覆盖本机执行入口。
- 桌面调用原生 CLI 时，若 Settings `env` 未写 `RDX_INTERMEDIATE_ROOT`，主进程注入用户资源根下的 `rdx-intermediate`。Settings 已写则原样使用。CLI 可执行文件仍只来自 Settings，不探测安装包或源码树，不把 Tools 默认 `intermediate` 当作产品 fallback。关闭本会话 lease 必须先 `rd.session.clear_context` / `context clear`，再对该 `rdc-<uuid>` 执行 `daemon stop`；clear 不代替 stop。限额以 Tools 的活占用为准。启动与退出只收割 App 中间根下已确认归属的 `rdc-*`，不扫安装目录 `intermediate`，不碰 `default` 或其他 context。

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

Knowledge Center 是三列 UI，只消费 Query / Index / Compile / Candidate / Write。知识库只有 user `~/.rdx/knowledge` 与 project `<项目>/.rdx/knowledge`，会话不是知识库。IPC 为 `knowledge:overview` / `query` / `card` / `compile` / `index:rebuild` / `candidates` / `candidateCreate` / `import` / `image` / `write` / `promote`。持久写入必须显式人类确认；`knowledge:import` 在同一次点击里签发并消费 `knowledge.write` token，写入所选空间 draft，不自动创建 Candidate。生成引擎另立设计。

Reasoning 使用 `raw | summary | opaque | none | unknown`。语义来自 Provider/Model contract，不从 OpenAI/Anthropic compatibility protocol 推断。App-managed 且有文档证据的 DeepSeek / Kimi / GLM / MiniMax / MiMo 等解析为 `raw`；真正未核实的第三方路由才是 `unknown`。Work Process 顶层用「工作中 / 工作过程」，loop thinking 用「正在思考 / 已思考 · {duration}」（前置 quiet icon，不用「深度思考」），不展示「语义未验证」。commentary 渲染为 markdown 散文（`proseText`），永不顶 thinking 槽；最终答案仅在 assistant message body 中以 full-bleed prose 呈现，不用 raised bubble。

## 受控 API

`rdxRuntime` preload domain 提供：

- scoped resource overview / validate / upsert / delete / reveal
- Hook trust / revoke / test
- Request snapshot list / detail

Memory 与 Knowledge 使用独立 scoped preload domain（`memory` / `knowledge`）。Renderer 不获得任意 tool execute、任意 shell、Secret 或 provider protected payload 接口。


## 原生 CLI、能力与执行回执

`RdxCliInvokerService` 和 session service 是软件固定对接边界。安装验证读取同一 CLI 的版本与完整 catalog，校验 canonical envelope、catalog schema、内容指纹和软件必需操作的参数契约。生命周期代码生成确定 argv，覆盖本地/远端打开、连接、context 查询、清理关闭、daemon 状态、完整事件索引与原子观察。目录不从独立文件配置读取，机器调用统一 canonical JSON；不匹配时明确升级，不回退旧命令。

Settings 保留 executable、argsPrefix、cwd、env 和 timeout，并呈现连接验证、实际版本/能力状态与有效 runtime 根。四个生命周期命令模板、模板变量、catalogPath 和 JSON 模式配置已移除。版本兼容根据软件所需接口判定，不把当前工具总数作为运行条件。

`prepareTurn` 冻结 CLI 配置、完整操作定义及其指纹、owning session/context/replay lease 身份。在途 Settings 变化不影响该轮。General 使用已有 shell 的结构化 RDX 模式，普通 command 与 rdx 互斥；轻量发现只返回匹配操作或单个操作说明，不把完整 catalog 展开进每次模型请求。

普通执行先校验当前身份、定义的 scope、effects、参数 schema、前置条件和路径。未知操作、未知影响、模型覆盖 session/context 身份、非 owning General、Mission 直接执行、越界路径均在执行前拒绝。replay 操作才注入 replay session_id；daemon context 始终由主进程指定。context 更新只允许用户字段，VFS 只允许当前会话的受限结构化路径。生命周期、remote 控制、全局配置、桌面窗口、清理销毁由应用专门入口管理，目录和 Skill 不能自行授予权限。既有 shell 审批、realpath 路径边界、取消、串行 lease 和未知结果隔离继续生效。

需要实验执行证据时，主进程在真实执行、身份及结果验证之后签发回执，绑定 session/project/turn/toolCall/experiment/context/lease/replay 身份、操作定义指纹、参数指纹、结果 hash 和执行时间。签名 key 由 OS safeStorage 保管，不进 prompt/IPC/trace；先确认可签名再执行，落盘遵守 SessionArtifactResolver 配额和原子写入边界。普通发现不签执行回执；手写 JSON、普通 shell 回显或目录自称安全/已回滚都不构成可信证据。

实验验收解释受支持的测量、干预和回滚结果，测量必须包含真实有限数值或可验证图像；不接受空值、伪造零值或成功文案。baseline → intervention → variant → rollback → restored 必须属于同一实验、context 和 lease，顺序有效；测量方法、参数与采样条件一致；回滚对应真实 replacement 并确认已恢复。历史记录不自动取得当前执行证明。签名证明执行和结果，不自动证明因果、质量、噪声或优化收益。

专业手册与共享执行 Skill 经 Mission 声明续跑上的 requiredSkillIds 写入 session execution offer，并在 General prepareTurn 真正加载。手册是操作知识，主进程执行规则是权限权威。生成参考及示例校验见 `pnpm run check:rdx-tool-guides`。

## 内嵌回放、观察与 Session ownership

应用生命周期的唯一入口为 session-scoped `RdxSessionService`，每个 binding 持有 `RdxSessionRuntime`。Open 对原文件计算完整 SHA-256，main 分配 UUID daemon context，先 `daemon start --owner-pid <App pid>` 再通过固定原生 argv 传递。只接受匹配的 native identity，关闭失败保留原 owning context。Android 设备预留先于连接，另一 session 不能抢占。`ShutdownCoordinator` 在 `release_owned_runtimes` 完成 clear+stop 与归属收割后，才进入 `terminate_processes` 的 `ProcessSupervisor.joinAll`。归属记录落在 `userData/state/owned-rdx-daemons.json`，不是全局 lease 镜像。

`rd.session.get_replay_events` 返回完整事件列表；`rd.session.observe` 在原生串行区内应用事件、解析目标并导出画面。默认 final_output 只使用 Present 资源证据，无法识别时不冒充最终输出。Remote 当前能力为 unsupported，Local 图片路径并不能证明设备屏幕显示。

`executeRdxShell` 与人工操作共享 context 队列；native 返回及签名回执完成后才观察并记录足迹，使用该 turn 的冻结 CLI。测量操作是自包含的 awaited 调用，观察不会插入 sampling 内部；是否刷新由操作影响决定，不按工具名称特判。多条命令构成的 experiment 是证据生命周期，不是持续采样事务：命令之间的观察会执行 replay/export，不承诺整个 experiment 零扰动。

远程打开期间通过冻结 CLI 查询所属 daemon 的 `active_operation`；只有原生 transfer stage 才显示传输阶段，查询失败不推测进度。足迹记录原生 `revision`、实际替换/恢复状态和显示参数。观察无法确认 EID 时保存无图片的失败事实；实时 Agent 画面与操作元数据成对投影，不读取手动回放图片。

live PNG 由 main 持有、projection 只含 token/尺寸/EID，renderer 经授权 IPC 取字节；关闭或替换时删除 live 文件。每个 session 历史通过 ReplayHistoryStore 原子提交，图片 hash 去重；回看不执行 native call。输入删除关闭所有关联绑定，正常 close 保留历史。

完整项目输入扫描先提交已确认的 `ProjectRecord.inputs`，并经 `project:inputsChanged` 广播，再执行原生回放释放和足迹 reconciliation。清理状态独立保存在 `ProjectRecord.replayCleanupPending`（请求时间、相关 capture 内容 hash、最近失败原因）；清理成功后移除此记录。清理失败不会回填旧输入，也不会把已不存在的最后一个 RDC 重新投影为可操作文件。重启或手动刷新基于新的完整扫描重试待清理工作；未完成扫描、目录离线或访问失败不更新输入列表、不启动缺失清理。后台错误通过 `project:inputsError` 进入现有全局通知，不能挤入原 Capture 空态。

RDX 接口只维护当前操作契约；包发布号仅用于安装诊断，不设 major-version 权限门槛。接入必须校验真实 catalog 指纹、参数、能力和 JSON 格式，手册引用当前生成定义，不绑定 V1/V2。

## Android 连接与归属

设备选择只更新选择目标；Capture 打开时才由 RdxSessionRuntime 分配 owning context、冻结 CLI 并预留设备，然后调用同一原生连接。无 context 的 device:activate IPC 已删除。Tools 根据实际状态复用已有 helper 或启动自有 helper，应用不另行启停。设备连接状态只在 connect 与 Ping 都成功后建立；startedActivity 才表示本次启动，包名存在不表示 APK 已验证。失败保留真实错误，可重新打开 Capture 重试。关闭、取消与退出均遵循自有资源清理，借用 helper 必须保留。

远端 replay 必须复用 owning runtime 已持有的 native connection，避免第二条连接触发真实 busy。关闭先经 clear_context 确认所属会话和转发释放，再 `daemon stop` 并确认该 context 的 daemon/worker 退出；清理失败保留恢复信息，不得把 clear 成功或缺失 state 文件当成进程已死。CLI canonical 错误中的原始代码与消息应保留到应用恢复提示。


### Capture queries and temporary replay evidence

Frozen turn identity includes the owning capture and replay identities. Capture-scoped queries receive the application's capture ID; model overrides are rejected. Temporary replay queries hold the serial lease while the main process reads context before and after, verifies the restored event and result proof, and rejects identity drift. They do not trigger final-state refresh. Restoration failure quarantines execution.

Frame-timing evidence validates the complete single-queue GPU replay method, seconds, range, samples/warmup, capture and actual replacement set. These checks supplement main-process signed receipts and the existing five-phase experiment validation; catalog claims cannot replace execution proof. Specialist references are generated from the same frozen CLI definitions.

Android 回放使用匹配的 Tools/native 服务。服务端在等待用户下一条操作时保持连接，只有开始接收包后才应用接收超时；应用不通过后台抢占或重启用户 helper 来维持会话。Android 文件传输由同一 CLI 以 ADB 和 SHA256 校验完成，已验证设备副本可复用；连接只拥有本次新建的副本。Capture 的图像导出成功与设备实际呈现分别投影，无设备确认时仍显示同步不可用。
