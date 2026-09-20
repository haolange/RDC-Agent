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
2. Write the model as a `claim_set` whose items stay on their layers. Include at least one Observed fact, one Reconstructed structure, and an explicit Unknown Frontier (`limitation` or Authoring hypothesis marked unknown).
3. Version by `supersedes` on the previous Architecture Model artifact. Do not silent-overwrite. The new version is a comparison Artifact: name what changed, what stayed, and what remains unknown.
4. Mark `ready` only with provenance (`$artifact-provenance`).

## Bounds

Do not persist Knowledge. Do not call `memory_write`. Do not write these fields into Tasks, Profiles, or Messages. RDC runs only through the Settings-configured CLI.

## 双 capture：由应用管理身份

1. 用户通过应用 Capture 入口顺序打开 A、B；每份 capture 使用各自 owning Agent session。应用管理 open/close 和 lease。General 不调用 open_replay，不覆盖 session/context/lease 身份。
2. 在 A 的 owning session，General 经已预载的共享 Skill 和 Analyzer 手册，用 shell.rdc 读取完整事件索引、action details、父链、pipeline shader hash/debug_name 和附件。把原始事实保存为带 capture hash、session、event、operation、证据引用的产物。
3. 在 B 的 owning session 重复读取并保存独立身份事实。比较时读取两份已保存产物，不跨 session 借用 live lease；不在一个 shell.rdc 中伪造另一份 session_id。
4. 再用 $cross-capture-alignment 对齐已有事实。marker_path 缺失保留 null；重复 marker 不唯一。shader 内容 SHA-256 与非自动 debug_name 也可能缺失，不用跨文件 ResourceId 充当稳定键。无 marker 时只能提出由拓扑、附件、事件邻域支持的启发式，并保留反证和歧义。

usage 的 is_read/is_write 可以为 null；binding-only 无法从 usage 确认。按真实事件和 color/depth attachment 在知识层组织资源版本和依赖假设，不能从空 usage 宣称“未使用”。回归对照先声明预期事实，保留原始结果、身份与 unsupported，再报告观察和推断。证据包仅是这些已有产物的组织方式，不创建宏或新的调查类型。

mesh 先区分 VS input 与 post-transform：输入位置、NORMAL、TEXCOORD0 按真实格式、布局与索引读取，保留坐标来源；归一化整数 NORMAL 不能直接解释成几何法线。输出只按已验证的反射布局解释，不能把 TEXCOORD 猜成法线。需要法线/UV 的 OBJ 使用显式 vs_input 空间及已确认的浮点属性；postvs OBJ 仍是位置预览，不能混入输入法线。没有可靠布局时明确 unsupported，读取失败另报错误；GS 未绑定是合法空结果。shader 的 resource_name、debug_name 与 debug_source_files 分别表达显示名称、自定义调试名和源码文件名，缺失名称为 null。工具字段和限制以本次冻结 catalog 及生成参考为准。
