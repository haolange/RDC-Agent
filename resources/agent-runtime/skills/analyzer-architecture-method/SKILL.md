---
name: analyzer-architecture-method
description: Write Analyzer Architecture Model versions on existing rdc.investigation.v1 kinds without crossing Observed / Reconstructed / Authoring layers.
---

# Analyzer Architecture Method

Use this skill during Analyzer execution. Do not invent a new kind, Profile, or TaskStore. Write only `rdc.investigation.v1` Session Artifacts.

## Three layers

`claimKind` must stay on its explanation layer. Crossing fails at write time (`ANALYZER-LAYER`).

| Layer | Content | Allowed `claimKind` | Epistemic / verification |
| --- | --- | --- | --- |
| Observed | Capture draws / dispatches / copies / barriers / presents | `observed_fact` | `observed` / `observed` |
| Reconstructed | Event / Resource / Pass structure derived from the capture | `derived_structure` | `derived` / `reconstructed` |
| Authoring | Engine / Material / RenderGraph hypothesis | `semantic_inference` or `hypothesis` | `inferred` or `unknown`; never `observed` |

Do not write engine semantics as `observed_fact`. Do not write an inferred label as `derived_structure`. Do not upgrade Authoring to Observed.

## Incremental Architecture Model

Shape: one `ClaimSet` (`kind: claim_set`) titled Architecture Model.

1. Collect Observed facts with `$capture-facts`, versions with `$resource-versioning`, pass topology with `$pass-graph-analysis`, shader fingerprints / blocks with `$shader-ir-analysis`, and traces with `$cross-capture-alignment`.
2. Write the needed model as a `claim_set` whose items stay on their source layers. Include the observations and reconstructions needed by the approved question and an explicit Unknown Frontier where applicable; do not invent an Authoring hypothesis merely to fill a layer.
3. Version by `supersedes` on the previous Architecture Model artifact. Do not silent-overwrite. Preserve a continuing claim's logical `claimId` across artifact versions; use a new ID only for a genuinely new claim. Before retiring an ID, inspect dependent evidence and use sources that remain valid through the replacement. The new version is a comparison Artifact: name what changed, what stayed, and what remains unknown.
4. Mark `ready` only with provenance (`$artifact-provenance`).

Before treating the approved analysis as complete, compare its requested coverage with the actual observations and unresolved relationships. If a major relationship within that goal is still unknown and an available, authorized query can distinguish its plausible connections, perform that check or record the concrete reason it cannot run. When a relevant result is already available but its needed pages or tail have not been read, follow its actual continuation or search the relevant portion; unread material alone is not a blocker. An Unknown Frontier describes what remains uncertain; it does not by itself establish that required coverage is complete. This does not require tracing every minor resource or inventing unavailable engine semantics.

## Bounds

Do not persist Knowledge. Do not call `memory_write`. Do not write these fields into Tasks, Profiles, or Messages. RDC runs only through the Settings-configured CLI.

## 多 capture：由应用管理身份

1. 使用批准计划冻结的 inputId、内容 hash 和设备，由拥有现场的 General 在同一产品 session 内按需通过 `rdc_probe` 的 `capture_select(inputId)` 串行切换。应用负责现场释放、身份重准备和签名回执；遵守 `$renderdoc-execution` 的权限及恢复要求，不传文件路径或 context ID，不直接调用 open_replay。
2. 每次切换准备完成后，在当前身份和实际权限内使用 `rdc_probe` 只读查询或 `shell.rdc`，采集计划所需的事件索引、action details、父链、pipeline shader hash/debug_name 和附件。保存每份原始事实及其 capture hash、产品 session、原生 replay 身份、event、operation 和证据引用。
3. 每份 capture 保持独立的 World State 与原生 replay 绑定。比较已保存材料，不跨身份借用 live lease，也不伪造 session/context/lease。调查结束时通过 `capture_restore` 恢复进入执行时的 capture、事件和目标，核对实际状态与回执；恢复失败须保留缺口。
4. 用 $cross-capture-alignment 对齐已有事实。marker_path 缺失保留 null；重复 marker 不唯一。shader 内容 SHA-256 与非自动 debug_name 也可能缺失，不用跨文件 ResourceId 充当稳定键。无 marker 时只能提出由拓扑、附件、事件邻域支持的启发式，并保留反证和歧义。

usage 的 is_read/is_write 可以为 null；binding-only 无法从 usage 确认。按真实事件和 color/depth attachment 在知识层组织资源版本和依赖假设，不能从空 usage 宣称“未使用”。回归对照先声明预期事实，保留原始结果、身份与 unsupported，再报告观察和推断。证据包仅是这些已有产物的组织方式，不创建宏或新的调查类型。

mesh 先区分 VS input 与 post-transform：输入位置、NORMAL、TEXCOORD0 按真实格式、布局与索引读取，保留坐标来源；归一化整数 NORMAL 不能直接解释成几何法线。输出只按已验证的反射布局解释，不能把 TEXCOORD 猜成法线。需要法线/UV 的 OBJ 使用显式 vs_input 空间及已确认的浮点属性；postvs OBJ 仍是位置预览，不能混入输入法线。没有可靠布局时明确 unsupported，读取失败另报错误；GS 未绑定是合法空结果。shader 的 resource_name、debug_name 与 debug_source_files 分别表达显示名称、自定义调试名和源码文件名，缺失名称为 null。工具字段和限制以本次冻结 catalog 及生成参考为准。
