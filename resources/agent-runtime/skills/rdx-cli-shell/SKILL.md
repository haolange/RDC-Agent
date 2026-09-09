---
name: rdx-cli-shell
description: Invoke RenderDoc or RDX only through the Settings-configured CLI shell action. General-only; conflicts with Mission plan-only.
---

# RDX CLI Shell

General 执行原生 rdx 协议；Mission 只用 rdx_context / rdx_probe。先确认 session 拥有非 default daemon context。Settings 中配置的 executable / argsPrefix / cwd / env / timeout 在 prepareTurn 冻结；未配置即失败，不猜路径。

使用互斥于 command 的 shell 参数：
```json
{"rdx":{"operation":"rd.perf.get_frame_timing","args":{},"experimentId":"exp-1"}}
```
operation 采用原生 rd.shader / perf / event / pipeline / resource / export 名称；按需通过配置 CLI 的 tools list/search 或 --help 发现参数，不向模型展开整个目录。不得传 session_id / context_id：主进程注入 owning replay identity。调用串行，经 General policy/approval；普通 command 回显不能充当可信执行回执。

实验 baseline → intervention → variant → rollback → restored 都使用同一 experimentId；将返回 receipt 原样放入 Experiment.executionEvidence 对应阶段。当前关闭门禁支持 shader edit_and_replace / revert_replacement 和相同参数的帧/事件计时、counter 或 screenshot 测量。rollback 必须匹配 intervention 的 replacement_id，恢复测量仍需证明科学结果；ok 只证明调用成功。取消、失败、缺回执时保持实验未完成并检查状态，不伪造回滚。

编辑前读取原生 get_source / get_disassembly 返回的 edit_plan，确认 can_edit_text / can_build / can_replace、allowed_edit_inputs 与工具链。source representation 不等于 compile encoding；SPIR-V 文本可能需要 spirv-as；DXIL / DXBC disassembly 只读，不能冒充可编译源码。细节见 $shader-ir-analysis。

Remote handle 一旦 consumed 不能复用；重新连接按 Capture 的生命周期操作。preview.display 是预览状态而不是图像内容。VFS 先列窄路径再读叶子，禁止整树展开与 raw .rdc bytes。lease_open/close 是应用生命周期，不是 CLI 命令。
