---
name: rdc-tool-shell
description: Execute discovered RDC operations through the frozen Settings CLI binding, with correct session identity, output, error, evidence, and side-effect handling. General-only.
---

# RDC-Tool CLI Shell

General 在已打开 capture 的 owning context 中使用结构化 `shell.rdc`。Mission 只规划和评估，不加载本 Skill、不直接执行 RDC。Skill 只提供操作知识，不能授权工具、路径、会话切换或变更；实际可用操作来自 prepareTurn 冻结的同一 CLI catalog，并继续经过主进程能力、身份、路径、审批、取消与串行 lease 检查。

## 发现与单项说明

General 先从本 turn 冻结的定义做轻量发现；这不会启动 CLI、产生执行回执或展开完整 catalog：

```json
{"rdc":{"discovery":{"kind":"search","query":"texture pixel","limit":8}}}
```

```json
{"rdc":{"discovery":{"kind":"describe","operation":"rd.texture.get_pixel_history"}}}
```

`discovery` 与 `operation` 互斥。搜索匹配操作名称和描述，单项说明返回冻结定义的完整参数与能力声明；未知操作必须拒绝。

人类在终端可使用同一安装的 CLI 发现入口：

- `rdc-tool tools list --namespace pipeline --json` 按真源 namespace 列举。
- `rdc-tool tools search "pixel history" --json` 匹配名称、描述和参数，不等同于 namespace 过滤。
- `rdc-tool tools describe rd.pipeline.get_state --json` 读取完整参数、结果、前置条件、scope、effects 和证据声明。

优先定向发现，不把完整 catalog 塞进上下文。机器调用只读取 canonical JSON 和 catalog fingerprint。实际接口不匹配时停止并报告升级需求，不切回旧命令、旧 catalog 或兼容参数。

## `shell.rdc` 调用

`shell.command` 与 `shell.rdc` 互斥。Agent 只提交 operation、业务 args，以及确有实验绑定时的 experimentId：

```json
{"rdc":{"operation":"rd.pipeline.get_state","args":{"event_id":42,"detail":"summary","sections":["output_targets","depth_stencil"]}}}
```

省略 `capture_file_id`、`session_id`、context、lease 等身份字段；主进程从当前 owning session 注入并拒绝覆盖。capture 打开关闭、context 切换、remote 控制、daemon 生命周期、全局设置、桌面 preview 和 artifact 清理由应用专门入口管理，不通过普通 Agent 操作手册调用。

## 结果、错误与输出

先检查 canonical envelope 的 `ok`，再解释 `data`、`error`、`meta`、`artifacts` 和可选 projection。合法空集合必须有成功语义；读取失败、后端 unsupported、预算耗尽和取消保持各自错误或状态，不能改写成空值、零值或成功。事件结果同时核对 requested/applied/image EID；图片与导出核对归属、路径和实际格式。

默认在内存或 stdout 处理统计、直方图、纹理差异和小型读回。只有用户或 Plan 明确要求证据保存时才提供输出路径；大结果先分页、区域化或限制数量。VFS 与 CLI facade 面向人类和受限浏览，不用 raw `.rdc` 或整树展开绕过主进程路径边界。

effects 描述可能的 replay position、artifact write、shader debug/replace 等真实影响。根据回执判断后续刷新与证据资格，不根据工具名猜测。失败、取消或缺少主进程签名回执时，变更与回滚均保持未证；实验遵循 `$renderdoc-execution` 的 baseline → intervention → variant → rollback → restored 契约。

专业成员、参数与示例分别由 `$debugger-rdc-tools`、`$analyzer-rdc-tools`、`$optimizer-rdc-tools` 提供。只读取当前 handoff 绑定的那一本；运行中使用 `shell.rdc` 的 `describe` 发现核实冻结定义。

## 初始化读取与临时回放

缩略图读取所属 capture 的嵌入数据，不用 replay screenshot 替代。`get_api_calls` 根据事件或 chunk 查询捕获记录；按返回的 object/child/value continuation 继续读取，不把截断参数解释为完整调用。

texture/buffer 的 `state=capture_initial` 只读取捕获实际保存且可重建的帧前内容。不能同时传 `event_id`；缺少初始化来源时停止，不用当前内容替代。小型结果选 `as_base64=true` 并遵守字节预算，大结果用范围或明确输出请求。

`replay_position_temporary` 表示内部可能移动回放位置。主进程在同一串行 lease 内核对调用前后 context、事件及结果恢复证明；这种查询不会被当作最终可见状态变更。恢复失败或证明不一致会隔离调用，不能继续签发成功回执。

## 安装绑定与批量边界

Settings 中 command 必须是本安装 binaries/windows/x64/python/python.exe 的绝对路径，argsPrefix 只含同安装 cli/run_cli.py。bat、PowerShell、薄 cmd/exe、跨安装组合和环境重定向会被拒绝；旧值保持可见，由用户修正。安装验证失败不得执行。RDC_BAT_REJECTED 与 RDC_VIA_COMMAND_DENIED 是拒绝，不是建议改写 argv。

人类 PATH 使用薄 bin/rdc-tool.cmd；双击安装使用 install.cmd。Tool CLI 的只读 batch 是人类/外部客户端功能。Agent 没有 batch 工具，每个 shell.rdc 操作独立调用冻结的 Python argv；discovery 仅读冻结 catalog，不启动 CLI。不要用 shell.command 调用 rdc 或 Python 入口绕过宿主。
