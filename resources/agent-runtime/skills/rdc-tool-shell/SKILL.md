---
name: rdc-tool-shell
description: Plan and interpret RDC operations using shared CLI, identity, output, error, evidence, and side-effect rules. Execution belongs to owning General through the frozen Settings CLI binding.
audience:
  - general
  - debugger
  - analyzer
  - optimizer
---

# RDC-Tool CLI Shell

调用 RenderDoc 能力前后读这份说明：怎样找到操作、怎样调用、怎样读结果、实验回执怎样取。Mission 读它来规划参数和成本；General 在已打开 capture 的 owning context 里用结构化 `shell.rdc` 执行。可用的操作以本回合冻结的 catalog 为准，专业成员、参数与示例见当前 handoff 绑定的那一本手册（`$debugger-rdc-tools`／`$analyzer-rdc-tools`／`$optimizer-rdc-tools`）。

## 找到操作

- 读专业手册的 `references/` 正文用 `skill_read` 的 `reference`（例如 `skill_id="debugger-rdc-tools", reference="references/tools.md"`），按返回的整文件 hash 和截断状态用 `offset`／`limit` 分页。这一步不打开 capture，也不执行 RDC。
- 在冻结目录里定向发现，不启动 CLI：

```json
{"rdc":{"discovery":{"kind":"search","query":"texture pixel","limit":8}}}
{"rdc":{"discovery":{"kind":"describe","operation":"rd.texture.get_pixel_history"}}}
{"rdc":{"discovery":{"kind":"list","limit":20}}}
```

- 搜索按相关度排序，保留部分匹配的候选；结合 `total`／`truncated` 判断覆盖，空结果或截断不证明目录里没有这种能力，换短的区分词或精确操作名再试。`list` 的 `next` 原样作为下一页 `cursor`。
- 调用前用 `describe` 读完整参数、前置条件、`effects` 和 `evidence_kind`；候选名称不能代替它。`available` 只是静态准入，不是操作授权。

## 调用

```json
{"rdc":{"operation":"rd.pipeline.get_state","args":{"event_id":42,"detail":"summary","sections":["output_targets","depth_stencil"]}}}
```

- 只提交 operation、业务 args，以及实验需要时的 `experimentId`。`capture_file_id`、`session_id`、context 等身份由主进程注入。capture 打开关闭、context 切换、remote、daemon 生命周期和全局设置走应用的专门入口。
- 每个操作独立调用；互不依赖的 discovery、describe 和制品读取可以放进同一个模型响应。依赖前一结果的查询、分页游标，以及干预、采证、恢复的先后要等结果回来。不要用 `shell.command` 调用 rdc 或 Python 入口。
- 统计和小型读回默认在内存里处理；需要文件时写到有权限的位置，用完清理。大结果先分页或限定区域。

## 读结果

- 先看 canonical envelope 的 `ok`，再读 `data`、`error`、`meta`、`artifacts`。合法的空集合有成功语义；读取失败、unsupported、预算耗尽和取消各自保留，不当成空值或零。事件结果核对 requested／applied／image EID。
- 制品包装的 `owner` 是产品会话；`rdcExecutionIdentity` 的 `contextId`、`replaySessionId`、`captureFileId` 对应 `runtime_context` 的同名字段，CLI 原生 `session_id` 是 replay。只有同名字段不一致才是归属反证，没读到就保持未知。
- 主进程资格化的原生失败标 `ok:false`、`source:main-qualified-native-failure`。只有 `mainValidation.preservationVerified=true`、`leaseState=retained` 且有 `nativeFailure.proof` 时，才能在原计划内继续；`quarantined` 或只有错误文字时不试探继续，也不自动重试被拒绝的操作。
- 现场重开后，旧的 shader-debug、replacement、remote handle 都失效，需要时由当前 replay 重新建立；capture hash 相同不能让旧 handle 复活。
- `rd.core.get_capabilities` 的事件绑定检查只针对查询时的 active event；`not_currently_probed` 不说明其他 draw 被阻断，要在目标事件读 shader 和 `edit_plan` 再判断。`rd.shader.get_source` 拿不到调试源码时，先验证回执里格式明确的 fallback。
- `rd.export.screenshot` 和 `rd.texture.render_overlay` 是展示画面，像素坐标不是源纹理坐标。在原生纹理上选区域或读像素前，核对事件、目标 texture、subresource 与尺寸；需要时用不带显示控制的 `rd.export.texture` 导出原生纹理再定位。导出图只证明所属事件与纹理，不证明设备屏幕的呈现。
- `state=capture_initial` 只读捕获保存的帧前内容，不能同时传 `event_id`，缺来源就停下。
- 原生 shader debugger 的 `pc` 是 trace 中单调递增的 `stepIndex`，不是反汇编指令号、SPIR-V ID 或源码行号；`ContinueDebug` 的批次逐项消费，变量读回是截至该步的累积快照。

## 实验回执

- 实验前先 `describe` 所选操作的 `evidence_kind`：baseline、variant、restored 用受支持的 measurement，干预和撤销分别是 intervention 和 rollback；普通像素查询只作补充观察。三次 measurement 用相同的操作、参数和采样条件。
- 每次真实调用传同一个 `experimentId`，保存结果返回的 `receipt.uri` 和 `receipt.expectedHash`，填进 `Experiment.executionEvidence` 对应阶段。外层 `session://tool-outputs/call_*.json` 是工具输出，不是签名回执；缺签名的阶段保留为不合格尝试，不补签。
- `rd.shader.edit_and_replace` 把变更登记到所属 replay；`rd.shader.list_replacements` 枚举同一活动集合，`rd.shader.revert_replacement` 撤销指定项。WorldState 的 `shaderReplacement`／`patchStack` 引用的是同一状态在基线、变体、恢复态各自的枚举回执。
- 确认冻结目录在本次权限下没有可达的数据写入或替换操作时，只能把该范围的 `dataState` 记为不适用；不可枚举、effects 未知或查询失败都保持 unknown。
- `runtime_context.hostControls` 的 `artifactCapacity` 是点时余量，不是预留；`operationBudget.noProgressTimeoutMs` 是每个 RDC 操作的无进展耐心，持续有进展的操作没有总时长，静默超过它的操作被判定卡住。字段 unavailable 时保持未知。
