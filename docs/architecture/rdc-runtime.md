# RDC Runtime

RDC Runtime 是 RDC-Agent 的资源解析、Prompt 构建与运行期可观测性边界。产品与工程决策以根目录 `DESIGN.md` 为 SSOT；本文描述对应的稳定实现契约。

## Scope 与存储边界

- User Scope 固定为 `~/.rdc-agent`（`RDC_AGENT_HOME` 可覆盖该根）。
- Project Scope 固定为 `<project-root>/.rdc-agent`。
- 应用内部状态位于 `${userData}/state`，Secret、日志和缓存位于 OS `userData` 下。
- Project `inputs/`、`artifacts/`、`memory/` 与 runtime state 默认不进入 Git。
- RDC-Tool CLI 安装位置、参数前缀、工作目录、环境与超时是 User/Device 配置，Project 资源不能覆盖本机执行入口。
- 桌面调用原生 CLI 时，若 Settings `env` 未写 `RDC_TOOL_INTERMEDIATE_ROOT`，主进程注入用户资源根下的 `rdc-intermediate`。Settings 已写则原样使用。CLI 可执行文件仍只来自 Settings，不探测安装包或源码树，不把 Tools 默认 `intermediate` 当作产品 fallback。关闭本会话 lease 必须先 `rd.session.clear_context` / `context clear`，再对该 `rdc-<uuid>` 执行 `daemon stop`；clear 不代替 stop。限额以 Tools 的活占用为准。启动与退出只收割 App 中间根下已确认归属的 `rdc-*`，不扫安装目录 `intermediate`，不碰 `default` 或其他 context。

`ScopedResourceResolver` 对 Agent、Skill、MCP、Hook 使用 `builtin < user < project` 的 whole-resource override，同 ID 的 Project disabled resource 可以隐藏继承项。Policy 只允许收紧；放宽、无效或不可比较的配置 fail-closed。

RDC-Tool 的 canonical JSON 对原生非有限浮点值使用字符串 `"NaN"`、`"Infinity"`、`"-Infinity"`，保留其异常事实而不伪造 0；有限数值仍为 JSON number。主进程严格解析 JSON，缺失、非法输出和截断分别报错并隔离不确定的 replay/context。字符串标记不能当作有效数值参与因果或性能结论。

原生 controller 发生 fatal 错误后可能继续返回默认零值或空对象。Tool 在非生命周期操作实际访问 controller 时及结果发布前检查 `GetFatalErrorStatus`；语义参数校验仍先于原生访问，生命周期清理入口保留。`replay_fatal_error` 与无法核验健康的 `replay_health_unavailable` 都不是有效测量或恢复证明，主进程按原有未知结果规则隔离 owning lease，不发布成功证据。健康控制器的合法零值不受此规则影响；瞬时健康回执也不保证之后的连接或实验恢复。

管线 `sections` 的资格只覆盖实际请求并返回的字段。未采集 section 的模型默认空值不能降级已返回的 bindings，也不能据此声称已核验被省略的 shader 或输出状态；真实请求字段缺失仍保留对应降级原因。

每项 resolved resource 携带 `scope`、`sourcePath`、`sourceHash`、`overriddenSource` 与 `effectiveStatus`。Renderer 通过 `rdcRuntime` preload API 获取这些信息，不直接访问文件系统、Secret 或任意 shell。

## Project Instructions

`ScopedInstructionResolver` 按确定性顺序加载：

1. `~/.rdc-agent/RDC.md`
2. Project 根目录 `RDC.md`
3. 从 Project 根到目标目录逐级出现的 `RDC.md`

目标目录来自 session cwd、附件或当前 capture。带路径的工具调用会重新解析新增目录链。越界、symlink escape、解析错误和预算截断进入诊断，不静默忽略。不自动读取 `AGENTS.md` 或 `CLAUDE.md`。

## Agent、Skill、MCP 与 Hook

`rdc_context` 在确认 owning lease 后，按同一 project/session（合法委托使用父 session）核对主进程已打开的 context、captureFileId 和 replaySessionId，并返回 `captureContentSha256`。其来源是打开前后验证一致的实际 capture 文件字节哈希；不匹配、未打开或缺少验证哈希时返回 `null`，不采用 handle 的派生摘要或模型传入值。它只暴露现有主进程身份事实，不授予 capture 生命周期操作权限，也不证明实验已经回滚。

同一响应的 `hostControls` 提供宿主的可复查控制事实。`artifactCapacity` 来自现有 SessionArtifactResolver quota ledger，包含磁盘用量、在途预留、实际单文件/图像/session/文件数上限及扣除在途预留后的当前余量；`measuredAt` 标明读取时间，`isReservation=false`。它不是整批未来空间预留、物理磁盘剩余量或未来写入成功保证；每次写入仍走既有原子预留、限额和事务。计划据此核算保守材料预算，实际失败时保留已发生效果并按恢复合同处理，不把一个 baseline 导出成功当后续容量证明。

`cliProcess` 只在执行上下文与当前 session/project/context/lease version 的冻结绑定一致、CLI 已启用且 timeout 为有效正整数时提供冻结的 `timeoutMs`，不序列化 executable、argv、cwd 或环境。其 scope 是一次 CLI invocation，`wholeOperationDeadline=false`、`nativeTerminationGuaranteed=false`；主进程的前置核验和调用后 replay observation 可能另调用 CLI，排队、模型、存储和后续恢复须另计，不将这个数冒充整个实验或整个操作的绝对墙钟上界。缺失、漂移和读取失败显式 unavailable，不补默认零值。超时或结果不确定依旧隔离 owning context；没有 close/error 回执不能认定子进程退出。Windows 树终止命令自身设置 5 秒 timeout；重复取消、timeout 与 shutdown 合并为一次初始终止和一次升级，保留首个中止原因。`termination.maxTreeKillAttempts=2`，`joinTerminationAdditionalWaitMs=2×5000+2000+1000=13000`，均由同一 ProcessSupervisor 政策导出，供单 CLI join 等待规划；这不覆盖排队、spawn、模型、存储或事件循环停顿，也不承诺目标真实退出。终止命令返回仍不能替代 close/error。

真实进程连续性使用同一受控 CLI 的 `rd.session.get_context.data.process_identity` 和每次 canonical 结果的 `meta.process_identity`。Tool 仅在实际 daemon child 中读取自身与父 daemon 的 OS 进程出生标识，分别返回 `pid + start_generation`；Windows 为进程创建 FILETIME，Linux 为 boot ID 与进程启动 tick。父身份不符、读取失败或平台不支持时明确 unavailable，不用持久逻辑 ID、缓存或零值替代。每个实验阶段须比较完整 daemon/worker 身份，PID 复用或任一世代变化使连续性失效；该字段进入既有主进程签名结果，不自动证明因果、恢复或设备呈现，不增加生命周期权限。

状态控制的实现语义随共享 CLI 方法分发，不能要求每次 capture 调查访问上游源码仓库。RDC-Tool 的 shader 编辑、活动 patch 枚举和撤销共用 PatchEngine 的 session 活动集合；元数据是同一集合的投影，`shaderReplacement` / `patchStack` 不代表两个独立变更接口。对照权威实现为上游 `rdc_tool/server_runtime.py` 的 `_list_replacement_payloads` / `_store_replacement_payload` 及 shader dispatch、`rdc_tool/core/patch_engine.py` 的 `list_patches`；这些位置用于工程核对，不是用户运行前提。实际三状态枚举、冻结身份和五阶段签名仍必需。数据写入控制只在完整冻结目录和有效权限确实没有该可达路径时限定为不适用；关键词空搜索、未知效果或查询失败不能证明无状态，也不能声明外部修改不存在。`shell.rdc.discovery.list` 从同一冻结定义有界分页，游标绑定目录指纹，提供完整静态准入汇总及同源 scope/effects/prerequisites 策略；参数、路径、身份、审批和运行期检查仍由既有执行路径完成。目录汇总不授予权限，也不是 live 原生状态观察。工具安装语义与方法合同冲突时保存实际反证，回到所属计划或工程修复，不放宽安全门。

- `.agent.md` 是 Agent Profile 的唯一来源，使用 YAML frontmatter + Markdown。
- Skill 使用 `<skill-id>/SKILL.md` 与可选的 `scripts/`、`references/`、`assets/`。
- Progressive Skill：非空 metadata catalog 一律注入短索引（`SkillCatalogBudget`）；`.agent.md` `skills`、composer `$skill-id`、以及 session-scoped `/skills` 武装在首次 LLM 调用前全文 preload（缺失 fail-closed）；其余 Skill 经 core `skills` / `skill_read` 渐进加载。禁止 lean/standard harness 档位。
- MCP 由 scoped `.mcp.json` 与 exact effective Agent profile 决定；pool 按 `projectRoot + descriptorHash` 隔离，以 ref-counted lease 保证 Project 切换不关闭在用连接。 The leased pool key is passed through tool assembly and execution.
- Hook 使用 `.hook.yml`、结构化 command/args、`shell: false`、timeout 与 `block | warn` failure policy。分发根为 `resources/agent-runtime/hooks`（builtin）+ `~/.rdc-agent/hooks` + `<project>/.rdc-agent/hooks`，顺序 `builtin < user < project`。
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

每次 `llm_turn` 保存脱敏 `RequestEnvelopeSnapshot`，包含 effective instructions、messages、tools、resource provenance、provider/model/protocol、usage 与 redaction metadata。Credential、capture binary 和 provider protected payload 不落盘；protected payload 只保留 hash 与脱敏原因。快照经 `RequestSnapshotStore` 落盘，并由 `rdc-runtime:listSnapshots` / `getSnapshot` 提供给日后专用 Debug View（Copilot Chat Debug View 级）消费；当前无 Settings Diagnostics 产品入口，也不得挂到默认 Session/Trace 右侧面板或嵌入 Work Process 消息流。快照是 provider-neutral 脱敏信封，不是 Work Process loop meta，也不是 Terminal runtime log。

## Context Usage 计量

Composer 的 context usage 环与弹窗由 `RunContextUsageSummary` 驱动：占用率分母是 `promptBudgetTokens`（可执行 prompt 上限，例如 DeepSeek V4 1M 窗口为 1M，不再扣模型输出上限），完整窗口写入 `contextWindowTokens`，模型输出上限写入 `maxOutputTokens`，压缩线写入 `compactionThresholdTokens`。窗口占用率与本 run In/Out 来自 provider 上报的真实 usage。Settings 切换 agent model 或 Composer 切换 1M/Max tier 后、下一次发送前，renderer 用当前 `EffectiveModel` 的 `contextBudgetTokens` 对 `lastKnownUsage.occupiedTokens` 做纯派生预览（圆环与弹窗百分比带 `~`，明细 token 绝对值保留、`free` 按新分母重算或补齐，并同步投影完整窗口、输出上限与压缩线），不写 store、不发 IPC、不改 `usage.json`。idle 无用量时环回退 `profile.contextBudgetTokens`，不得显示完整窗口。`current`（prepared）高于该预览；`preparing` 圆环保持 `…`，弹窗与环进度仍沿用切换后估算，避免弹回旧窗口。发送后 prepared 与 `workflow:runUsageChanged` 的真实 usage 无缝接管。hero 下显示压缩线、条件完整窗口（仅 window > budget）与本轮可生成；分段条带压缩线刻度，圆环不标压缩位置。弹窗 Actual / Last actual 为同行三张独立圆角卡片：`Tokens`（In / Out / Total）、`Cache`、`Reasoning`；Cost 为同语言全宽卡。Cache 统计范围是当前 Agent Run（不是跨 session 累计，也不是 Token Economy 压缩节省）：`cacheSavedTokens` = 累计 hit；`lastTurnCacheHitRate` / `cumulativeCacheHitRate` = `hit / (hit + miss)`（百分数，分母为 0 时缺省）；命中/未命中为 token 计数。归一化在 provider usage 出口完成：优先原生 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`，否则 `hit = cacheRead`、`miss = max(input − hit, 0)`；无原生且无 cacheRead 时不产出 hit/miss。UI 固定三栏，Cache / Reasoning 缺遥测时显示 `—`（不造假 0 / 0%）。wire 层仍可保留 `cacheReadTokens` / `cacheWriteTokens` 供诊断，主展示不再用 Cache read 双轨。分类 breakdown（system_prompt、memory_files、skills、system_tools、mcp_tools、mcp_tools_deferred、builtin_tools_deferred、subagent_definitions、summarized_conversation、conversation、free）为 chars/4 估算，按 provider `inputTokens` 缩放对齐。`memory_files` 段覆盖 RDC.md scoped instruction 链；`mcp_tools_deferred` / `builtin_tools_deferred` 段仅计未激活 deferred schema 的估算量，不参与缩放、不占用堆叠条与 free 计算。Debug 与 Composer/Ask 路径均经 `PromptPlanBuilder` 产出可拆分的 metrics。`workflow:getRunUsage` 使用唯一对象参数 `{ sessionId, runId? }`，并校验 run/session ownership；`workflow:runUsageChanged` 是 `SessionScopedPayload<RunContextUsageSummary>`。Debug 按 `runId` 聚合，普通对话按顶层 `turnId` 聚合；每次 provider call 更新 effective provider/model，同时累计本轮 Tokens、Cache 与 Reasoning。最新快照随 session 落盘至 `<sessionDir>/usage.json`（subagent 隔离 session 不落盘），格式为 `{ schemaVersion: '2', usage }`；v0 裸对象先迁到 v1（补 promptBudget / 窗口 / 输出预留），v1 `outputReserveTokens` 再迁到 v2 `maxOutputTokens` 并补 `compactionThresholdTokens`；未知更高版本 `STORAGE_SCHEMA_UNSUPPORTED` fail-closed。应用重启或内存 miss 回读时才标记 stale。active 与 background session 都经同一 projection reducer，迟到事件按 session + turn/run identity 丢弃。terminal 不清空 `lastKnownUsage`，也不改变回读查询身份；仅从未取得真实快照的新 session 显示「暂无用量」。

## Memory、Knowledge 与 Reasoning

Memory 只有 `memory_search`、`memory_read`、`memory_write`、`memory_delete` 四个 scoped tool。Write 需要明确用户意图或批准，Delete 需要确认；没有自动抽取、turn counter、consolidation 或全索引 Prompt 注入。

Knowledge Center 是三列 UI，只消费 Query / Index / Compile / Candidate / Write。知识库只有 user `~/.rdc-agent/knowledge` 与 project `<项目>/.rdc-agent/knowledge`，会话不是知识库。IPC 为 `knowledge:overview` / `query` / `card` / `compile` / `index:rebuild` / `candidates` / `candidateCreate` / `import` / `image` / `write` / `promote`。持久写入必须显式人类确认；`knowledge:import` 在同一次点击里签发并消费 `knowledge.write` token，写入所选空间 draft，不自动创建 Candidate。生成引擎另立设计。

Reasoning 使用 `raw | summary | opaque | none | unknown`。语义来自 Provider/Model contract，不从 OpenAI/Anthropic compatibility protocol 推断。App-managed 且有文档证据的 DeepSeek / Kimi / GLM / MiniMax / MiMo 等解析为 `raw`；真正未核实的第三方路由才是 `unknown`。Work Process 顶层用「工作中 / 工作过程」，loop thinking 用「正在思考 / 已思考 · {duration}」（前置 quiet icon，不用「深度思考」），不展示「语义未验证」。commentary 渲染为 markdown 散文（`proseText`），永不顶 thinking 槽；最终答案仅在 assistant message body 中以 full-bleed prose 呈现，不用 raised bubble。

## 受控 API

`rdcRuntime` preload domain 提供：

- scoped resource overview / validate / upsert / delete / reveal
- Hook trust / revoke / test
- Request snapshot list / detail

Memory 与 Knowledge 使用独立 scoped preload domain（`memory` / `knowledge`）。Renderer 不获得任意 tool execute、任意 shell、Secret 或 provider protected payload 接口。


## 原生 CLI、能力与执行回执

`RdcCliInvokerService` 和 session service 是软件固定对接边界。安装验证读取同一 CLI 的版本与完整 catalog，校验 canonical envelope、catalog schema、内容指纹和软件必需操作的参数契约。生命周期代码生成确定 argv，覆盖本地/远端打开、连接、context 查询、清理关闭、daemon 状态、完整事件索引与原子观察。目录不从独立文件配置读取，机器调用统一 canonical JSON；不匹配时明确升级，不回退旧命令。

Settings 持久化保留 executable、argsPrefix、cwd、env 和 timeout，用户通过安装根目录选择配置前三项。main 解析真实路径，检测只访问已配置目录和 Tools 默认安装目录；验证草稿时读取同安装版本/catalog，成功后走既有 Settings 保存。选择取消、验证失败不覆盖原值。高级面保留 env/timeout。四个生命周期命令模板、模板变量、catalogPath 和 JSON 模式配置已移除。接口匹配根据软件所需契约判定，不把工具总数或包版本作为权限条件。

RDC-Tool 的 session worker 对 `rd.session.*` 统一提供 60 秒操作预算，CLI transport 在此基础上增加 5 秒响应缓冲，实际传输门限为 65 秒；RDC-Agent 的默认外层 CLI 进程等待为 120 秒。Settings schema 8 会把旧默认 60000ms 迁移到 120000ms，非默认用户值保留。三层门限均由各自边界负责，调用方不传第二套 session timeout。

`prepareTurn` 冻结 CLI 配置、完整操作定义及其指纹、owning session/context/replay lease 身份。在途 Settings 变化不影响该轮。General 使用已有 shell 的结构化 RDC 模式，普通 command 与 rdc 互斥；轻量发现只返回匹配操作或单个操作说明，不把完整 catalog 展开进每次模型请求。

普通执行先校验当前身份、定义的 scope、effects、参数 schema、前置条件和路径。未知操作、未知影响、模型覆盖 session/context 身份、非 owning General、Mission 直接执行、越界路径均在执行前拒绝。replay 操作才注入 replay session_id；daemon context 始终由主进程指定。context 更新只允许用户字段，VFS 只允许当前会话的受限结构化路径。生命周期、remote 控制、全局配置、桌面窗口、清理销毁由应用专门入口管理，目录和 Skill 不能自行授予权限。既有 shell 审批、realpath 路径边界、取消、串行 lease 和未知结果隔离继续生效。

`rd.core.get_capabilities` 的 summary 与普通 Context 读取不恢复或探测 replay controller；full 通过既有恢复路径只核验当前选中 session，并在原生 replay 线程读取能力。`current_session_probe` 区分已核验、未探测与获取失败；持久 endpoint 登记、延迟加载或探测异常不能当作连接有效或后端不支持的证明。full 的数量是当前进程已加载对象数量。remote matrix 按当前 active event 观察事件绑定能力；Present 等无 shader 的事件返回 `not_currently_probed`，不能替代目标 draw 的 shader/disassembly 与 `edit_plan` 回执，也不能凭原始调试源码缺失断言所有可编辑输入不可用。真正的后端不支持、目标事件操作失败与主进程执行拒绝继续分别按各自回执处理。

长反汇编由会话制品保存完整原文并给出 URI/hash；模型可见的有界主进程摘要同时保留已核对身份、目标事件、shader、格式及该次 `edit_plan` 的编辑/构建/替换能力与输入形式。成功结果的 `available_targets` 来自原生目标枚举，`available_targets_status` 区分 complete（含合法空列表）、unavailable（查询失败）和 unsupported（原生接口缺失），异常原因单列；不能据空值猜测 GPU ISA 支持。原生列表与 Tool 的 raw ASM fallback 分别解释，不把派生输入冒充原生 ISA。字段缺失或超过摘要边界须标为未核验，摘要不能授予权限，也不能替代读取完整 ASM 或实验恢复回执。

raw SPIR-V 格式必须同时有匹配的构建编码与实际 opcode 行；注释头、诊断文字、目标名称或编码提示不能单独建立 raw ASM 或可替换性。原生外部视图返回的原文保留供核验，不据其非空就当作 GPU 指令；显式 raw target 与外部 raw fallback 同样校验指令内容。格式识别不替代编译器验证、原生执行或设备数值证据。

区域原生读值按已应用事件、subresource、rect、stride 与 as_type 解释。`get_region_values` 在采样转换后不超过 256 标量时直接返回完整嵌套 `values`；超限为 null／`omitted_limit`，不能据省略判断没有数据。完整 NPZ 与内联视图、总体及逐通道统计来自同一数组，shape／dtype／stride 明确。非有限值保持 canonical 字符串标记，解码分量不单独证明物理 alpha。读取区域数值或统计是取证能力，不自动成立 clipping、细节、首次错误或修复画质结论。

工具制品的 `owner` / `ownerScope=product-session` 表示产品对话归属；原生执行归属由 `rdcExecutionIdentity` 中的 `productSessionId`、`contextId`、`replaySessionId`、`captureFileId` 分别表达。共享 CLI 方法按同名字段核对当前上下文，不能把包装层产品 owner 与原生 replay ID 作相等比较；产品 owner 一致也不替代 replay 检查。分页或压缩摘要未带完整身份时须按 URI/hash 读取来源，保留未知与实际不匹配的区别；Checkpoint 保留字段名和已验证关系，不把不同身份压成单一 session ID。

原生 shader 调试的 `pc` 沿用 RenderDoc trace 的 `stepIndex`，不与 IR ID、`nextInstruction` 或源码行号混同。Tool 逐项消费 `ContinueDebug` 返回的批次，按 `ShaderVariableChange.before/after` 累积当前变量快照，包括变量离开作用域；不能把读取不存在的字段所得空列表当成实际无变量。变量保留原生类型/数值视图与明确截断标识，调用栈只有原生函数名时，未知文件/行保持 null。未实现的源码步进/断点由当前目录明确拒绝；释放失败不得清掉 handle 后报成功。Agent 仍按冻结目录、同身份和实际原生回执判断，未加载该候选的旧安装结果不证明新行为。

需要实验执行证据时，主进程在真实执行、身份及结果验证之后签发回执，绑定 session/project/turn/toolCall/experiment/context/lease/replay 身份、操作定义指纹、参数指纹、结果 hash 和执行时间。签名 key 由 OS safeStorage 保管，不进 prompt/IPC/trace；先确认可签名再执行，落盘遵守 SessionArtifactResolver 配额和原子写入边界。普通发现不签执行回执；手写 JSON、普通 shell 回显或目录自称安全/已回滚都不构成可信证据。

shader replacement 返回一致的 `status=noop`（顶层与 replacement 的身份、事件一致，原始与应用源码 hash 相同，构建输入明确 unavailable）时，主进程交付原结果并明确标记未执行构建或替换，不签干预回执、不登记回滚资格。通过 owning lease 和现场观察核验后保留可用现场；no-op 不是未修改源码的编译对照，也不是实验干预或恢复证明。状态矛盾、身份变化、取消或观察失败仍按未知结果隔离。

实验验收解释受支持的测量、干预和回滚结果，测量必须包含真实有限数值或可验证图像；不接受空值、伪造零值或成功文案。baseline → intervention → variant → rollback → restored 必须属于同一实验、context 和 lease，顺序有效；测量方法、参数与采样条件一致；回滚对应真实 replacement 并确认已恢复。历史记录不自动取得当前执行证明。签名证明执行和结果，不自动证明因果、质量、噪声或优化收益。

冻结目录搜索包含并返回 `evidence_kind`，支持按 measurement/intervention/rollback 发现候选，完整参数仍由 describe 核对；不建立第二份操作白名单。无证据能力的操作携带 experimentId 时在原生执行前明确拒绝，并提示核对冻结目录与实际 receipt 引用。Experiment 使用每次结果返回的 `receipt.uri/expectedHash`，普通工具输出及其外层制品不能代替签名文件。方法资源要求干预前取得 baseline 签名，缺失阶段保持未证，不事后补签或自动追认旧实验。

专业手册与共享执行 Skill 经 Mission 声明续跑上的 requiredSkillIds 写入 session execution offer，并在 General prepareTurn 真正加载。Mission 在规划期可按需只读共享手册及对应专业手册和引用，核对操作参数与采证成本；读取不启动 CLI、不取得 lease、不改变冻结执行工具面。手册是操作知识，主进程执行规则是权限权威。生成参考及示例校验见 `pnpm run check:rdc-tool-guides`。

## 内嵌回放、观察与 Session ownership

项目输入支持 `project_resource` 与显式登记的 `external_reference`。后者由 Capture 面板「引用外部抓帧（只读）」经 `project:inputs:reference` 登记单个绝对路径，不复制 RDC、不扫描父目录、不扩展 Project Scope。登记保留 canonical 路径、文件身份与完整内容 hash；刷新、重启、打开前后与重绑定均复验，替换或内容变化须显式重新登记。移除引用沿同一审批与绑定释放路径解除登记及项目内足迹，永不删除或修改外部原件；原件缺失也能移除引用。原项目内输入的导入、删除与存储格式保持原语义，不批量迁移已有项目。

应用生命周期的唯一入口为 session-scoped `RdcSessionService`，每个 binding 持有 `RdcSessionRuntime`。Open 对原文件计算完整 SHA-256，main 分配 UUID daemon context，先 `daemon start --owner-pid <App pid>` 再通过固定原生 argv 传递。只接受匹配的 native identity，关闭失败保留原 owning context。Android 设备预留先于连接，另一 session 不能抢占。`ShutdownCoordinator` 在 `release_owned_runtimes` 完成 clear+stop 与归属收割后，才进入 `terminate_processes` 的 `ProcessSupervisor.joinAll`。归属记录落在 `userData/state/owned-rdc-daemons.json`，不是全局 lease 镜像。

`rd.session.get_replay_events` 返回完整事件列表；`rd.session.observe` 在原生串行区内应用事件、解析目标并导出画面。默认 final_output 只使用 Present 资源证据，无法识别时不冒充最终输出。Remote 屏幕呈现使用同一远程连接的原生确认，按事件、纹理和新鲜序号报告 presented；缺少能力为 unsupported，窗口或呈现失败为 unavailable。Local 图片路径不能证明设备屏幕显示。

`executeRdcShell` 与人工操作共享 context 队列；native 返回及签名回执完成后，只有 catalog 声明改变回放位置或 shader replacement 的操作才观察并记录足迹，使用该 turn 的冻结 CLI。只读查询不触发额外 replay/export；测量操作是自包含的 awaited 调用，观察不会插入 sampling 内部。是否刷新由操作影响决定，不按工具名称特判。多条命令构成的 experiment 是证据生命周期，不是持续采样事务：有状态操作之间的观察会执行 replay/export，不承诺整个 experiment 零扰动。

`rdc_context.hostControls.replayIsolation` 是 Main 对当前受控 context 的点时排他证明，读取实际 owning lease、冻结身份和该 turn 持有的交互锁；非 owning General、漂移、隔离、委派、同 context 重复 lease 或未持锁均返回 unavailable。成功来源固定为 main-owned-lease-and-turn-lock，绑定 session/project/turn/context/leaseVersion/capture/replay，范围仅 rdc-agent-context。`WorldState.replay.exclusiveLock` 在此受控范围内有该来源支撑，仍须三态分别保存并与阶段回执核对；不是整批 native mutex 或外部进程排除证明，不免除实际变更状态及恢复校验。context 小结果沿既有制品路径保留 inline 正文和持久 URI/hash；不能据新的证明回填旧实验资格。

远程打开期间通过冻结 CLI 查询所属 daemon 的 `active_operation`；只有原生 transfer stage 才显示传输阶段，查询失败不推测进度。足迹记录原生 `revision`、实际替换/恢复状态和显示参数。观察无法确认 EID 时保存无图片的失败事实；人工与 Agent 操作统一更新同一当前回放状态和图片，不再保留 Agent 专属图片镜像；实际 image EID 与 observation 元数据来自同一次原生观察。后台操作证据继续保存，不作为第二套回放 UI。

live PNG 由 main 持有、projection 只含 token/尺寸/EID，renderer 经授权 IPC 取字节；关闭或替换时删除 live 文件。每个 session 历史通过 ReplayHistoryStore 原子提交，图片 hash 去重；回看不执行 native call。输入删除关闭所有关联绑定，正常 close 保留历史。

完整项目输入扫描先提交已确认的 `ProjectRecord.inputs`，并经 `project:inputsChanged` 广播，再执行原生回放释放和足迹 reconciliation。清理状态独立保存在 `ProjectRecord.replayCleanupPending`（请求时间、相关 capture 内容 hash、最近失败原因）；清理成功后移除此记录。清理失败不会回填旧输入，也不会把已不存在的最后一个 RDC 重新投影为可操作文件。重启或手动刷新基于新的完整扫描重试待清理工作；未完成扫描、目录离线或访问失败不更新输入列表、不启动缺失清理。后台错误通过 `project:inputsError` 进入现有全局通知，不能挤入原 Capture 空态。

RDC 接口只维护当前操作契约；包发布号仅用于安装诊断，不设 major-version 权限门槛。接入必须校验真实 catalog 指纹、参数、能力和 JSON 格式，手册引用当前生成定义，不绑定 V1/V2。

## Android 连接与归属

设备选择只更新选择目标；Capture 打开时才由 RdcSessionRuntime 分配 owning context、冻结 CLI 并预留设备，然后调用同一原生连接。无 context 的 device:activate IPC 已删除。Tools 根据实际状态复用已有 helper 或启动自有 helper，应用不另行启停。设备连接状态只在 connect 与 Ping 都成功后建立；startedActivity 才表示本次启动，包名存在不表示 APK 已验证。失败保留真实错误，可重新打开 Capture 重试。关闭、取消与退出均遵循自有资源清理，借用 helper 必须保留。

helper 进程退出不转移已有安装或配置的所有权。Tool 以成功且可解析的包查询区分已安装与缺失；现有安装即使未运行也不替换、卸载或创建配置，包查询失败或未知时拒绝安装。只有确认缺失才非替换安装一次，并且只有本次新安装允许创建缺失的默认配置；安装冲突或签名、版本错误直接报告，不卸载重试。本次启动的 PID 与 forward 仍按实际归属清理，历史 bootstrap 元数据不能授权新的安装或配置修改。协议不兼容须准确报错，不能靠重新安装掩盖。

远端 replay 必须复用 owning runtime 已持有的 native connection，避免第二条连接触发真实 busy。关闭先经 clear_context 确认所属会话和转发释放，再 `daemon stop` 并确认该 context 的 daemon/worker 退出；清理失败保留恢复信息，不得把 clear 成功或缺失 state 文件当成进程已死。CLI canonical 错误中的原始代码与消息应保留到应用恢复提示。

`clear_context` 失败时，Capture 错误态保留 owning lease，并显示 Tool 返回的有界清理原因代码；应用运行记录保留同一错误，禁止用关闭界面或重启进程代替 native 清理回执。Android helper 的进程归属和 ADB forward 由 Tool 核验，应用不自行清理设备进程。


### Capture queries and temporary replay evidence

Frozen turn identity includes the owning capture and replay identities. Capture-scoped queries receive the application's capture ID; model overrides are rejected. Temporary replay queries hold the serial lease while the main process reads context before and after, verifies the restored event and result proof, and rejects identity drift. They do not trigger final-state refresh. Restoration failure quarantines execution.

原生 shader 替换失败只有在同安装 CLI 返回 canonical `validation` 错误、结果种类匹配本次冻结操作、明确 `replacement_attempted:false` 且 `context_preserved:true`，并且主进程再次确认原 lease/capture/replay 身份未变时，才保留可查询的 context。此类拒绝没有 intervention 回执，不代表修复或 rollback。退出超时、取消、协议损坏、未知错误、已尝试替换或身份变化仍隔离，必须经 Capture 生命周期恢复。

其中 `shader_patch_diff_failed` 只在文本 diff 应用失败、尚未编译或替换时附带上述证明。调用可能已导航到目标事件，因此不声明 `effects_attempted:false`，也不声明恢复原事件；模型须修正与当前源码不匹配的 diff，不能把拒绝当实验干预。

RDC 的不可变内容地址制品可能没有文件扩展名。`read_image` 对无扩展名文件通过既有图像字节识别和尺寸校验确认 PNG/JPEG/GIF/WebP，直接读取原制品；不要求重导出或复制改名。已有扩展名仍须匹配声明格式，SVG、可执行扩展名、非图像内容、越权路径与非视觉路由仍拒绝。制品 MIME 或文件名本身不替代真实 raster 校验。

常量缓冲 `slot` 对应 shader reflection `constantBlocks` 的零基索引，与原生 `GetConstantBlock` / `GetCBufferVariableContents` 一致，不读取已移除的 `bindPoint` 或把固定 API 绑定号当索引。原生解码传递该stage实际绑定的ResourceId对象，序列化ID只用于协议；raw fallback必须保留decode_status/decode_error，不能当作结构化解码已成功。`rd.shader.get_constant_buffer_contents` 的已知 `constant_buffer_data_unavailable` 失败须由 Tool 恢复原事件，并返回精确 `decode_constant_buffer` 阶段、失败原因及 context/session/restored-event 证明。main 仅对 schema、操作、错误、阶段、原因和冻结身份全匹配的证明，在串行 lease 内再次读取原事件后保留 context；错误仍返回模型，不签发成功或实验回滚回执。缺证明、未知错误、取消、恢复失败或身份漂移继续隔离。

shader-debug handle 属于创建它的 replay session，重启/reopen 不延续其有效性。Tool 对 `rd.shader.get_debug_state` 及 `rd.debug.*` 的无效/越属 handle，在获取 controller 或应用 event 前返回 canonical `shader_debug_handle_invalid` validation 错误及 `effects_attempted:false/context_preserved:true`。main 复用既有无效果拒绝的冻结 lease 身份复核；此错误不是当前 shader 调试不支持，也不是实验回滚。通过校验后发生的原生失败不取得该证明。

原生操作在任何 replay 效果之前拒绝时，Tool 可在 canonical `validation` 错误中提供 `effects_attempted:false` 与 `context_preserved:true`。main 仅在结果种类与冻结操作相符、CLI 非零退出、未取消且 lease/capture/replay 身份复核不变时保留 context；错误仍返回调用者，不生成成功或实验回执。该证明由 Tool 的实际前置检查路径给出，普通运行时错误、部分执行与缺少任一证明字段仍隔离。未知 shader disassembly target 属于此类前置拒绝；Tool 在应用 event 之前检验 target，并返回当前可用 target 名称。

`rd.export.screenshot` 查找目标时可能暂时改变 active event。目标查找失败后，Tool 须实际恢复原 event；只有非零退出的同操作 canonical runtime 错误携带 `failure_stage:resolve_visual_target`、`replay_state_restored:true`、`restored_event_id` 和 `artifact_write_attempted:false`，且 main 在串行 lease 下复核原 event、context/replay/capture 身份均未变，才保留可查询的 context。失败仍如实返回，不能签发截图或实验回执；无原 event、恢复失败、身份漂移、取消及其它阶段失败继续隔离。

`rd.shader.get_source` 在指定事件没有绑定 shader 时仍返回 `shader_binding_lookup_failed`，不会把“无 shader”伪装成可用源码。Tool 在返回前恢复原 event；main 仅接受同操作、同身份、明确 `resolve_binding` 失败与 `replay_state_restored/restored_event_id` 证明，并再次读取原 event 核对后保留 lease。恢复失败返回 `shader_inspection_recovery_failed`；缺证明、取消或身份变化继续隔离。

Frame-timing evidence validates the complete single-queue GPU replay method, seconds, range, samples/warmup, capture and actual replacement set. These checks supplement main-process signed receipts and the existing five-phase experiment validation; catalog claims cannot replace execution proof. Specialist references are generated from the same frozen CLI definitions.

Android 回放使用匹配的 Tools/native 服务。服务端在等待用户下一条操作时保持连接，只有开始接收包后才应用接收超时；应用不通过后台抢占或重启用户 helper 来维持会话。Android 文件传输由同一 CLI 以 ADB 和 SHA256 校验完成，已验证设备副本可复用；连接只拥有本次新建的副本。Capture 的图像导出成功与设备实际呈现分别投影，无设备确认时仍显示同步不可用。

### 原生失败的受控交付

`RdcNativeFailure` 必须在 owning 执行路径完成既有身份、取消与恢复检查后，将限定失败投影交付给模型和 UI，不能只留下错误字符串。投影标记 `ok:false` / `source:main-qualified-native-failure`，包含实际 CLI exitCode、错误种类、main-owned 调用参数/身份及 `mainValidation.preservationVerified` / `leaseState`。仅主进程已复核安全时，`nativeFailure.proof` 才表达 canonical `effects_attempted:false/context_preserved:true`、未替换或已复核恢复的对应事实；缺证明、身份漂移或取消时不对外宣称上下文保持，lease 仍按原规则隔离。

这是主进程资格化的失败记录，不是完整原始 CLI stdout，也不是成功、实验或 rollback 签名。`operation` 是产品请求；`invocation` 记录实际失败的原生命令，内置状态前置查询失败时不得声称产品请求已经执行，后续恢复复核也不得覆盖原失败调用。任意私有 native details、二进制 stdout 与 stderr 不透传。执行器只接收 owning shell 路径绑定到该异常的投影，保留 `isError:true` 并经现有 ToolResultArtifactizer 固定保存，即使小于卸货阈值也提供 session owner/ref/hash；普通异常或其它工具不能通过同名属性冒充原生证明。持久化失败保留已返回的错误和可验证交付子集，不以落盘失败重试原生操作。后续真正需要的合法查询仍须通过正常冻结权限/lease 门禁，其连续性另行核验。

## 同安装 Python 绑定与 Tool batch

共用 assertRdcCliBinding 校验 Settings 保存、安装验证与实际调用；command 固定为同安装捆绑 Python 绝对路径，唯一 argsPrefix 为 cli/run_cli.py。prepareTurn 经 catalog 验证冻结该配对。RDC_TOOL_ROOT 不得重定向，PYTHONHOME/PYTHONPATH 不接受外部导入路径。文件 realpath 不得逃出安装。bat/旧 PowerShell 转发器返回 RDC_BAT_REJECTED，不再改写启动命令。

旧非法设置读取后仍展示，通用工作台可启动；保存和 RDC 执行 fail-closed。失效验证清除缓存；除版本与完整 catalog 安装诊断外，调用前必须有验证成功的同安装 catalog。shell.rdc 一次一操作，发现仅读冻结定义。

Tools 的 batch 仅增加 CLI 子命令，复用同 Python 客户端的 catalog 校验与 daemon 请求，顺序、首错停止，无新 catalog 操作、服务或 IPC。Agent 不接入 batch，继续使用单 owning lease 与独立签名回执。

## 回放隔离与恢复投影

普通结构化 RDC 调用成功后，主进程在结果正文和 details 同时附带 `invocation`：`main-validated-cli-arguments`、operation、实际送入冻结 CLI 的参数和 canonical SHA-256 指纹，含主进程解析注入的 replay 身份；不包含 transport 环境或凭据。敏感参数键存在时显式省略参数正文并标记原因。它说明本次调用参数，不替代原生结果、签名实验回执或恢复证明。历史结果不回填；原模型请求只能通过 owning root General 的 hash-bound `artifact_read.includeRecordedRequest` 从 SessionContextJournal 生成独立限定来源凭据，再显式授予审查者。

原生调用失败导致 owning lease 被隔离后，Capture 在执行锁释放时立即投影错误状态、清除旧设备呈现成功状态，并提供关闭后重新打开的恢复入口。`rdc_context` 对同一 session/project 的隔离身份返回明确的受控恢复状态，不将仍打开的 capture 误报为未打开，也不向其他 scope 泄露保留的 lease。新 turn 不解除隔离，也不将隔离误报为需要重新准备的 CLI 绑定变化。失败没有取得可信恢复证明时仍 fail-closed；恢复通过应用生命周期重新建立 owning capture/replay/context 身份。

Android 的 remote_display 由同一远程连接的原生呈现确认驱动，核对当前事件、目标纹理及新鲜序号；后台窗口、原生失败或缺失能力不得显示 presented。无颜色输出清除手机旧画面并表达无输出，应用 PNG 与手机屏幕状态分别判断。

## 审批前原生事实

权限策略与执行入口共享 owning binding 校验和 authorizeRdcOperation：只有冻结 catalog 的已知 scope/effects、主进程身份注入、参数及文件边界全部成立才分类。无副作用读取、测量和受控 artifact/replay 操作可按 low 自动批准；shader replacement 和敏感配置路径分别进入 medium/high 审核。模型审核只评估当前动作与实际用户授权，不提供 lease、能力或签名资格；执行前及队列后继续校验身份，恢复失败仍隔离。目录查询保持冻结目录语义，不调用原生 CLI。
