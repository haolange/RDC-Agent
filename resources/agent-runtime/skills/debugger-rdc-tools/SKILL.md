---
name: debugger-rdc-tools
description: Choose and interpret the bounded RDC operations needed to localize rendering faults, test competing causes, and verify a restored result. General execution only.
---

# Debugger RDC-Tool

本手册由 Debugger Mission 通过 execute handoff 绑定给 General。先读 `$rdc-tool-shell` 的发现、身份、错误、输出和副作用规则，再按 Plan 的区分检查读取 [工具参考](references/tools.md) 中对应条目。成员清单是知识覆盖范围，不是运行时权限白名单。

## 选择路径

1. 用 action tree、pass、search、details、parent chain 和状态变化点缩小 First Bad Event；树结果核对分页、节点预算和截断字段。
2. 像素异常从当前事件输出目标开始，配对 pixel value / region / history / stats / histogram；显式 texture 与当前输出目标互斥。观察到的写入记录不自动证明因果。
3. 在候选事件只取需要的 pipeline sections，再查 bindings、constant buffers、vertex/index、post-transform mesh 与 shader source/reflection。管线读取失败保持失败，不能用空绑定代替。
4. shader debugger 或替换只用于 Plan 中的区分检查。读取 edit plan 和能力后再 compile/replace；每个 counterfactual 都记录真实 replacement，并按 A-B-A 回滚与恢复观察。
5. 只导出能支撑当前 Claim 的最小证据。OBJ 仅接受工具定义声明的 post-VS 位置和 primitive indices；unsupported 不是空模型。

结果中把直接读取、工具投影和推断分开。像素历史、管线差异或 debug step 能排除某个假设时说明适用事件、subresource 和参数；不能定位时返回当前候选区间、预算边界和下一项区分检查。

定位时用 `rd.event.get_api_calls` 检查真实类型化参数，用 `rd.resource.get_details` 的初始化关联追到 chunk；首次使用不是创建证据。顶点输入、完整 viewport/scissor、blend/stencil、push constants 和资源状态从所需 pipeline sections 读取。实际 sampler 与 descriptor store 范围用于区分空槽、错误视图及未访问描述符。初始/当前内容对比先核对来源，读取恢复规则统一遵循共享手册。
