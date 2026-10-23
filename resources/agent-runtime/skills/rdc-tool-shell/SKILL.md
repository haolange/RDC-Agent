---
name: rdc-tool-shell
description: Plan and interpret RDC operations using shared CLI, identity, output, error, evidence, and side-effect rules. Execution belongs to owning General through the frozen Settings CLI binding.
---

# RDC-Tool CLI Shell

Mission 可按需只读本文及对应专业手册，提前核对操作参数、输出和调用成本；不得执行本文命令或因读取而取得执行权限。General 经声明交接真实预载后，在已打开 capture 的 owning context 中使用结构化 `shell.rdc`。Skill 只提供操作知识，不能授权工具、路径、会话切换或变更；实际可用操作来自 prepareTurn 冻结的同一 CLI catalog，并继续经过主进程能力、身份、路径、审批、取消与串行 lease 检查。

## 发现与单项说明

离线阅读专业 Skill 链接的 `references/` 方法正文时，用 `skill_read` 的 `reference`（例如 `skill_id="debugger-rdc-tools", reference="references/tools.md"`），路径相对该有效 Skill；可加 `offset`/`limit`，按返回的整文件 hash 和截断状态继续分页，不依赖固定行号。不要把 Skill 链接当成项目相对路径。此方法读取不需要打开 capture，不执行 RDC，也不刷新在途权限或绑定。正文的能力说明不能代替已打开 capture 下冻结的实际 catalog。

General 先从本 turn 冻结的定义做轻量发现；这不会启动 CLI、产生执行回执或展开完整 catalog：

```json
{"rdc":{"discovery":{"kind":"search","query":"texture pixel","limit":8}}}
```

```json
{"rdc":{"discovery":{"kind":"describe","operation":"rd.texture.get_pixel_history"}}}
```

`discovery` 与 `operation` 互斥。搜索在冻结定义的名称、描述、参数名、结果说明及 evidence_kind 上做相关度排序，保留部分搜索词匹配的候选，不要求所有词命中同一操作；候选同时显示证据能力。结合 `total` / `truncated` 判断本次覆盖，截断或空结果不证明全目录没有能力；短的区分词或已知的精确操作名更容易定位目标。候选名称不能代替 `describe`：单项说明才返回冻结定义的完整参数与能力声明；未知操作必须拒绝。成功的 search / describe 保留小型正文并附 owning session 的持久 URI/hash，供后续独立读取；它是冻结目录材料，不是原生执行或实验签名。

人类在终端可使用同一安装的 CLI 发现入口：

- `rdc-tool tools list --namespace pipeline --json` 按真源 namespace 列举。
- `rdc-tool tools search "pixel history" --json` 在 CLI 的名称、namespace、group 与描述摘要中查找原词组，不等同于 namespace 过滤；与 Agent 冻结目录搜索的排序语义不同。
- `rdc-tool tools describe rd.pipeline.get_state --json` 读取完整参数、结果、前置条件、scope、effects 和证据声明。

优先定向发现，不把完整 catalog 塞进上下文。机器调用只读取 canonical JSON 和 catalog fingerprint。实际接口不匹配时停止并报告升级需求，不切回旧命令、旧 catalog 或兼容参数。

## `shell.rdc` 调用

`shell.command` 与 `shell.rdc` 互斥。Agent 只提交 operation、业务 args，以及确有实验绑定时的 experimentId：

```json
{"rdc":{"operation":"rd.pipeline.get_state","args":{"event_id":42,"detail":"summary","sections":["output_targets","depth_stencil"]}}}
```

省略 `capture_file_id`、`session_id`、context、lease 等身份字段；主进程从当前 owning session 注入并拒绝覆盖。capture 打开关闭、context 切换、remote 控制、daemon 生命周期、全局设置、桌面 preview 和 artifact 清理由应用专门入口管理，不通过普通 Agent 操作手册调用。

判读持久工具输出时，区分身份命名空间：制品包装层 `owner`（`ownerScope=product-session`）是产品对话会话，不是原生 replay。用结果的 `rdcExecutionIdentity.productSessionId` 核对产品会话，用 `contextId`、`replaySessionId`、`captureFileId` 分别核对当前 `rdc_context` 的同名字段；CLI 原生 `session_id` 对应 replay。产品 owner 与 replay ID 不相等是正常关系，不能据此拒绝证据；产品 owner 相等也不能证明 replay 相同。分页或压缩摘要未包含执行身份时，先按 URI/hash 继续读取原输出及其 identity，不把尚未读到字段解释为跨会话。只有同名身份的实际不匹配才构成归属反证；身份未知时保持未知，并在计划权限内补核验，不把仍可读取或执行的检查当成外部阻塞。Checkpoint 中保留各字段名称和已验证关系，不能合并成一个含混的 session ID。

恢复 checkpoint 时先核对当前 context/replay 身份；历史记录中的 shader-debug、replacement、remote 等运行时 handle 只属于创建它们的 owning replay。重启或重新打开同一 capture 后，capture/shader hash 相同也不能使旧 handle 重新有效。需要该能力时由当前 replay 建立新的 handle；旧失败保留为历史，不把无效 handle 当成当前调试能力不支持。

实验准入还须核对真实进程连续性。当前 `rd.session.get_context` 的 `data.process_identity` 及每次 canonical 结果的 `meta.process_identity` 提供实际 daemon/worker 的 `pid + start_generation`，来源是 OS 进程出生标识；两者均完整且 status=available 才能确认当前批身份。五阶段须逐项比较完整两进程身份，PID复用、任一世代变化或 unavailable 都不能合格；同context/replay/hash不替代此证明。主进程将实际结果中的 process identity 写入签名回执，新实验关闭门要求五份一致。缺少此字段的历史记录仍可读，不追认当前连续性、不补签；保存具体回执，由工程修复受控投影，不用普通shell、读取daemon私有状态或生命周期旁路取代。

正式 shader 状态合同：`rd.shader.edit_and_replace` 将活动变更登记到所属 replay 的 PatchEngine；`rd.shader.list_replacements` 枚举同一活动集合并附带对应元数据，`rd.shader.revert_replacement` 撤销该集合中的指定项。这里的 shader replacement 和 patch 应用顺序不是两套独立可变状态；WorldState 的 `shaderReplacement` / `patchStack` 可引用同一状态的实际枚举回执，仍须分别在基线、变体、恢复态取得，不能拿本段知识代替观察。该合同是工具实现语义说明，不要求普通 capture 调查额外获得软件源码目录读取权。若当前安装的目录、能力或实际回执与合同冲突，保存冲突并保持 unknown，不自行推断为空。

数据变更的适用性按完整冻结目录与本次有效权限判断：确认该执行面没有可达的数据写入/替换操作时，只能将该范围的 `dataState` 控制记为不适用，不能声称全局数据为空或没有外部修改。查询/导出制品不是 replay 数据写入；单次关键词空搜索不足以证明完整目录无此能力。不可枚举、未知 effects、存在可达变更但状态不明或查询失败，均保留 unknown 并按计划安全门处理。实施新的软件能力是工程任务，不能作为使用现有操作时每轮必做的源码审计。

原生 shader debugger 的 `pc` 是 trace 中单调递增的 `stepIndex`，不是反汇编指令编号、SPIR-V SSA ID 或源码行号。不能把这些编号互相代入；`run_to` 和断点按当前目录声明的 trace PC 使用。`ContinueDebug` 的批次须逐项消费，变量读回是截至该步的 `before/after` 累积快照，不能只解释批次最后一条变化。初始未步进时变量可为空；实际类型、数值视图和成员以返回值为准，截断需继续限定范围，不把缺失或不支持的源码步进当成成功。

## 结果、错误与输出

原生失败的主进程资格化交付标记 `ok:false`、`source:main-qualified-native-failure`，仍为错误。检查 `nativeFailure`、`mainValidation`、实际 `invocation` 和 `rdcExecutionIdentity`，用返回的 Evidence ref/hash 读取持久记录。仅 `mainValidation.preservationVerified=true` 且 `leaseState=retained`、当前身份未变，并有对应 `nativeFailure.proof`，才能按计划继续本来需要的合法查询；例如 `effects_attempted=false/context_preserved=true` 表示该次前置拒绝已通过主进程复核。只有错误文字、合同承诺、空 proof 或 `leaseState=quarantined` 时不可自行追认保持或试探继续。该记录是限定的主进程失败投影，不是完整原始 stdout、成功回执或五阶段签名；不自动重试被拒绝操作，也不必为每个领域批次额外制造拒绝探针。

先检查 canonical envelope 的 `ok`，再解释 `data`、`error`、`meta`、`artifacts` 和可选 projection。合法空集合必须有成功语义；读取失败、后端 unsupported、预算耗尽和取消保持各自错误或状态，不能改写成空值、零值或成功。事件结果同时核对 requested/applied/image EID；图片与导出核对归属、路径和实际格式。

`rd.core.get_capabilities` 的 remote capability matrix 中，事件绑定检查只针对查询时的 active event。当前事件没有绑定 shader 时，`not_currently_probed` 不说明其它目标 draw 被阻断；要在目标事件读取 shader/disassembly 的实际回执与 `edit_plan` 后判断。`rd.shader.get_source` 的原始调试源码不可用也不等于可替换输入都不可用；若回执提供格式明确的 fallback，先验证 fallback 的实际结果。任何总览能力或 fallback 建议都不能代替安全干预与恢复回执。

默认在内存或 stdout 处理统计、直方图、纹理差异和小型读回。只有用户或 Plan 明确要求证据保存时才提供输出路径；大结果先分页、区域化或限制数量。VFS 与 CLI facade 面向人类和受限浏览，不用 raw `.rdc` 或整树展开绕过主进程路径边界。

`rd.export.screenshot` 和 `rd.texture.render_overlay` 是展示画面：输出尺寸可由渲染窗口决定，不能将 PNG 像素坐标直接当成源纹理坐标。需要在原生纹理坐标上选 ROI 或读取像素时，先核对事件、目标 texture、subresource 与尺寸；可按冻结 catalog 使用不带 channels/remap/flip_y 显示控制的 `rd.export.texture` 导出原生纹理，再在该图定位区域并用原生读取操作复核。导出图像及坐标仍只证明所属事件与纹理，不自动证明 Present 或物理设备屏幕呈现。

effects 描述可能的 replay position、artifact write、shader debug/replace 等真实影响。根据回执判断后续刷新与证据资格，不根据工具名猜测。失败、取消或缺少主进程签名回执时，变更与回滚均保持未证；实验遵循 `$renderdoc-execution` 的 baseline → intervention → variant → rollback → restored 契约。

实验开始前先 describe 所选操作的 `evidence_kind`：baseline/variant/restored 必须使用受支持的 measurement，干预与回滚分别是 intervention/rollback；普通像素查询等无证据能力的输出只能作补充观察。先取得绑定 experimentId 的 baseline 成功回执，再执行干预；同一实验的三次 measurement 使用相同操作、参数和采样条件。在每次真实调用时传同一 experimentId，逐项保存结果返回的 `receipt.uri` 与 `receipt.expectedHash`，用这对引用填写 `Experiment.executionEvidence` 对应阶段。外层 `session://tool-outputs/call_*.json` 是工具输出，里面包含 receipt 字段也不等于签名回执本身；不能用它、普通图片、手写 JSON 或后来一次测量替代缺失的阶段签名。若报 unsigned content，先核对提交的是否为该次结果返回的 receipt 引用；确实没有签名时保留不合格尝试，不补签或追认历史阶段。安全恢复后只有新的、完整且获准的实验才能重新验证。

专业成员、参数与示例分别由 `$debugger-rdc-tools`、`$analyzer-rdc-tools`、`$optimizer-rdc-tools` 提供。只读取当前 handoff 绑定的那一本；运行中使用 `shell.rdc` 的 `describe` 发现核实冻结定义。

`rdc_context.hostControls` 是主进程提供的宿主控制事实，不来自原生 catalog。`artifactCapacity` 包含当前用量、在途预留、实际 limits 和 remaining；按 `measuredAt` 核对，`isReservation=false` 表示没有为整批未来写入预留空间。以保守材料预算和实际每次原子写入检查作计划依据，不把点时余量、某次 PNG 成功或 quota 数字当成未来采证必然成功；失败仍需优先恢复。`cliProcess.timeoutMs` 来自当前匹配 lease 的冻结 CLI 设置，scope 仅一次 invocation；`wholeOperationDeadline=false`，前置核验、调用后 observation、排队、模型及存储另计。终止政策有有限等待，但 `nativeTerminationGuaranteed=false`，必须依据真实 close/error 和原生恢复回执判断，超时不明则隔离。任一字段 unavailable 时保持未知，不能据此宣称原生不支持，也不能擅自放宽已冻结计划的硬门；将具体冲突交回规划审阅。

单 CLI join 的中止等待规划读取 `termination.joinTerminationAdditionalWaitMs`，不自行漏算升级终止；同一政策给出 `maxTreeKillAttempts=2`，取消/timeout/shutdown 合并为一次初始终止加一次升级，首个原因保留。这个附加预算与 `timeoutMs` 合计仍不是整个业务操作的 deadline，也不覆盖事件循环停顿或物理退出。业务恢复账本须包含实际所需的登记、原 binary、独立 context 等核验，不能只计四个主要动作。容量只读取实际提供的维度：`remaining.bytes/toolOutputFiles`、对应 `usage` 和 `limits`；不要把计划自己的总文件数量预算变成不存在的宿主 session 文件数额度。

## 初始化读取与临时回放

缩略图读取所属 capture 的嵌入数据，不用 replay screenshot 替代。`get_api_calls` 根据事件或 chunk 查询捕获记录；按返回的 object/child/value continuation 继续读取，不把截断参数解释为完整调用。

texture/buffer 的 `state=capture_initial` 只读取捕获实际保存且可重建的帧前内容。不能同时传 `event_id`；缺少初始化来源时停止，不用当前内容替代。小型结果选 `as_base64=true` 并遵守字节预算，大结果用范围或明确输出请求。

`replay_position_temporary` 表示内部可能移动回放位置。主进程在同一串行 lease 内核对调用前后 context、事件及结果恢复证明；这种查询不会被当作最终可见状态变更。恢复失败或证明不一致会隔离调用，不能继续签发成功回执。

## 安装绑定与批量边界

Settings 中 command 必须是本安装 binaries/windows/x64/python/python.exe 的绝对路径，argsPrefix 只含同安装 cli/run_cli.py。bat、PowerShell、薄 cmd/exe、跨安装组合和环境重定向会被拒绝；旧值保持可见，由用户修正。安装验证失败不得执行。RDC_BAT_REJECTED 与 RDC_VIA_COMMAND_DENIED 是拒绝，不是建议改写 argv。

人类 PATH 使用薄 bin/rdc-tool.cmd；双击安装使用 install.cmd。Tool CLI 的只读 batch 是人类/外部客户端功能。Agent 没有 batch 工具，每个 shell.rdc 操作独立调用冻结的 Python argv；discovery 仅读冻结 catalog，不启动 CLI。不要用 shell.command 调用 rdc 或 Python 入口绕过宿主。
