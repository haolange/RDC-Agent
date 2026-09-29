---
name: debugger-rdc-tools
description: Choose and interpret the bounded RDC operations needed to localize rendering faults, test competing causes, and verify a restored result. General execution only.
---

# Debugger RDC-Tool

本手册由 Debugger Mission 通过 execute handoff 绑定给 General。先读 `$rdc-tool-shell` 的发现、身份、错误、输出和副作用规则，再按 Plan 的区分检查读取 [工具参考](references/tools.md) 中对应条目。成员清单是知识覆盖范围，不是运行时权限白名单。

## 选择路径

1. 用 action tree、pass、search、details、parent chain 和状态变化点缩小 First Bad Event。`rd.event.get_action_tree(event_id=...)` 只读该节点及其子树，不返回前后相邻事件；相邻事件用 `rd.event.search_actions(query.event_id_min/event_id_max)` 限定范围，再读 details / parent chain。树结果核对根节点分页、深度、节点预算和截断字段；大树被制品化或只读取了首段时，先缩小原生查询，不把未读到当作事件不存在。
2. 像素异常从当前事件输出目标开始；用户未给坐标时，先通过受控导出与 `read_image` 找候选区域，再按 `$pixel-forensics` 核对源纹理尺寸及事件映射。配对 pixel value / region / history / stats / histogram；显式 texture 与当前输出目标互斥。观察到的写入记录不自动证明因果。
   在批量写入调查记录前，优先做能排除候选解释的最小只读配对：从 action search / history 确认可用事件，在同一原生纹理、subresource 和坐标取得事件前后目标点与邻近控制点；再核对 history 中各片元的 valid、passed、shader-out、pre/post-mod。参考图条件不匹配只阻断跨图定量比较，不阻断同 capture 内的这条取证路径。若原生回执缺字段或读数相互矛盾，保留 unknown 并记录具体缺口，不以猜测值设计 shader 干预。
3. 在候选事件只取需要的 pipeline sections，再查 bindings、constant buffers、vertex/index、post-transform mesh 与 shader source/reflection。管线读取失败保持失败，不能用空绑定代替。若 Pixel History 已给出同 Event 的 surviving `primitive_id`，而具体几何或材质归属仍未知，先以该像素、Event、输出目标和 primitive 尝试 `rd.shader.debug_start`；再按实际 topology/index binding，用 `rd.mesh.get_drawcall_mesh_config` 的有界顶点输入或相应 index 范围核对几何和资源绑定。大片元列表只选能区分假设的少量代表，不按全 Draw 批量导出。Pixel History 的 primitive 是片元归属线索，draw 级 shader/binding 也不自动等于材质身份；只有同一 replay 的索引、顶点属性、纹理/常量及 shader 路径能闭合时才提高归属结论。远端 debug 不支持、mesh 截断或语义不明须保留具体 unknown，继续其它可行的只读检查。
4. shader debugger 或替换只用于 Plan 中的区分检查。`rd.shader.get_source` 的 `source_available=false` 只说明原始调试源码缺失；如返回 `fallback_args`，必须先按其指定的 target（例如 raw `SPIR-V ASM`）读取反汇编并检查该次 `edit_plan`，不能拿默认只读 `SPIR-V (RenderDoc)` 的 edit plan 宣告所有替换路径不可用。`allowed_edit_inputs` 是可选输入形式，`allowed_ops` 只限制结构化便利操作；两者不得混淆。读取真实 edit plan 和能力后再 compile/replace；没有区分性因果假设和安全恢复路径仍不得干预。每个 counterfactual 都记录真实 replacement，并按 A-B-A 回滚与恢复观察。
5. 只导出能支撑当前 Claim 的最小证据。OBJ 仅接受工具定义声明的 post-VS 位置和 primitive indices；unsupported 不是空模型。

结果中把直接读取、工具投影和推断分开。像素历史、管线差异或 debug step 能排除某个假设时说明适用事件、subresource 和参数；不能定位时返回当前候选区间、预算边界和下一项区分检查。

定位时用 `rd.event.get_api_calls` 检查真实类型化参数，用 `rd.resource.get_details` 的初始化关联追到 chunk；首次使用不是创建证据。顶点输入、完整 viewport/scissor、blend/stencil、push constants 和资源状态从所需 pipeline sections 读取。实际 sampler 与 descriptor store 范围用于区分空槽、错误视图及未访问描述符。初始/当前内容对比先核对来源，读取恢复规则统一遵循共享手册。
