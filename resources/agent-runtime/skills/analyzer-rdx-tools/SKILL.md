---
name: analyzer-rdx-tools
description: Choose and interpret the bounded RDX operations needed to reconstruct passes, resources, bindings, shaders, and data flow without overstating author intent. General execution only.
---

# Analyzer RDX Tools

本手册由 Analyzer Mission 通过 execute handoff 绑定给 General。先读 `$rdx-cli-shell`，再按 Plan 读取 [工具参考](references/tools.md) 的相关条目。成员清单用于知识覆盖和参考新鲜度检查，不授予执行权限。

## 选择路径

1. 用 action tree、pass、details、parent chain 和 search 建立轻量事件骨架；分页或节点预算截断时明确未覆盖区间。
2. 用 resource list/details/usage 和 event resource usage 建立资源版本与读写关系；usage 是观察到的使用记录，因果依赖和“创建现场”仍需跨事件证据。
3. 在代表事件按 section 读取 pipeline state，再查 bindings、constant buffers、vertex/index 和 post-transform mesh。不要为每个小问题构建整帧完整快照。
4. 用 shader source、disassembly、reflection、bindpoint、constant block 和 entry points 建立 Shader Fingerprint / Block；源码表现、反汇编与作者意图分层记录。
5. counter 与 event duration 用于结构说明和相对成本；热点之和不能称为整帧时间。导出只保存复查需要的最小纹理、buffer、mesh、shader 或 cbuffer 证据。

报告保持 Observed / Reconstructed / Authoring 分层。空绑定、空采样、后端 unsupported 与读取失败分别记录；当前接口没有直接给出的依赖图、原因或高层架构属于带证据的重建，不得伪装成工具原始事实。

资源枚举的 descriptor_store 可继续由 `rd.resource.get_descriptors` 按范围读取；当前 draw 的实际访问与存储中尚未访问的槽位是两种不同事实。初始化关联通过 `rd.resource.get_details` 追到 `rd.event.get_api_calls` 的 chunk；不得虚构创建调用栈。采样器参数、布局/状态快照及管线完整数组保留原始索引；高层依赖图仍由分析流程构建。
