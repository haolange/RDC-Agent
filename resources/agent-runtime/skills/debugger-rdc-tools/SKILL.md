---
name: debugger-rdc-tools
description: Operation knowledge for Debugger planning and owning General execution to localize rendering faults, test competing causes, and verify a restored result.
audience:
  - debugger
  - general
---

# Debugger RDC-Tool

定位渲染错误时挑选 RDC 操作用这本手册。Debugger 规划时只读，用 `rdc_probe` 的 `event_list`（offset/limit 分页，`pagination.truncated=false` 才完整）和 `event_search`（名称、ActionFlags、事件范围）看事件树；执行由 General 经交接预载后进行。通用的调用和结果规则见 `$rdc-tool-shell`，每个操作的参数见 [工具参考](references/tools.md)。

## 选择路径

1. **缩小事件区间**。用 action tree、pass、search、details、parent chain 和状态变化点找 First Bad Event。`rd.event.get_action_tree(event_id=...)` 只读该节点及子树；相邻事件用 `rd.event.search_actions` 的 `event_id_min`／`event_id_max` 限定范围。核对分页、深度、节点预算和截断，没读到的不当作不存在。
2. **从像素出发**。从当前事件的输出目标开始；用户没给坐标时，先受控导出再 `read_image` 找候选区域，坐标映射按 `$pixel-forensics` 核对。区域难以落到单点时，用 `rd.texture.get_region_values` 读原生纹理上的有界矩形，再选目标点和邻近控制点。配对使用 pixel value／region／history／stats／histogram；亮度或区域统计本身不是异常或因果证据。
   - 候选区域属于哪个对象还不确定时，从对象侧核对：`rd.texture.render_overlay` 的 Drawcall 高亮或 `rd.texture.diff` 的事件前后差异给出 draw 的实际覆盖。
   - 批量写记录前，先做能排除解释的最小只读配对：同一原生纹理、subresource 和坐标上，取事件前后的目标点与控制点，再看 history 里各片元的 valid、passed、shader-out、pre/post-mod。回执缺字段或读数矛盾时保留 unknown，不以猜测值设计干预。
3. **读候选事件的输入**。按需读 pipeline sections、bindings、constant buffers、vertex/index、post-transform mesh 和 shader source/reflection；失败不当成空绑定。Pixel History 给出 surviving `primitive_id` 而归属未知时，先试 `rd.shader.debug_start`，再用 `rd.mesh.get_drawcall_mesh_config` 的有界范围核对；索引、顶点属性、纹理／常量和 shader 路径在同一回放里闭合，才提高归属等级。
4. **干预**。shader debugger 和替换只用于计划里的区分检查。`rd.shader.get_source` 返回 `source_available=false` 时，按 `fallback_args` 指定的 target 读反汇编和该次 `edit_plan`；展示用反汇编的只读 edit plan 不代表没有可编辑路径。没有源码时，在可编辑的中间表示上只改一处，其余保持原样。`allowed_edit_inputs` 是可选的输入形式，`allowed_ops` 只限制结构化便利操作。每个反事实实验记录真实 replacement，按 baseline → variant → restored 撤销和恢复。
   - 需要工作文件构建变体时，用 `rd.export.shader_bundle`（`disassembly_target` 与编辑视图一致）导出，核对 manifest 后做最小 diff，再用 `rd.shader.compile.source_path` 验证。
5. **导出最小证据**。只导出支撑当前 Claim 的内容；unsupported 不是空结果。

结果里把直接读取、工具投影和推断分开。某项检查排除了一个解释时，写明适用的事件、subresource 和参数；不能定位就选下一项检查。

- `rd.event.get_api_calls` 看真实的类型化参数；`rd.resource.get_details` 的初始化关联追到 chunk，首次使用不是创建证据。
- `rd.event.get_resource_usage` 回答"这个事件绑定了哪些资源"，`rd.resource.get_usage` 回答"这个资源在哪些事件被用到"；一项失败后按实际失败判断另一项是否可用。
- 顶点输入、viewport/scissor、blend/stencil、push constants 和资源状态从所需的 pipeline sections 读；实际的 sampler 与 descriptor 范围用来区分空槽、错误视图和未访问的描述符。
