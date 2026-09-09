---
name: rdc-context
description: Summarize the active project, capture, and RenderDoc session context before deeper investigation.
allowed-tools: [rdx_context, read_file, glob, grep]
---

# RDC Context
先调用 session-owned rdx_context，报告当前项目、session、打开的 capture、replay 状态和所有权。无 lease 如实报告，不从文件内容推测 live 状态。
按需读取项目文件补充目标、约束与下一步所缺证据。保持简短，不读取原始 .rdc bytes。
