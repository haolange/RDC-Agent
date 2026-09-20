---
name: rdc-context
description: Summarize the active project, capture, and RenderDoc session context before deeper investigation.
allowed-tools: [rdc_context, read_file, glob, grep]
---

# RDC Context
先调用 session-owned rdc_context，核对当前项目、打开的 capture、replay 状态和所有权。不从文件内容推测 live 状态。向用户只说明材料是否已打开、当前能做什么与下一步，不展示 lease、Capsule、控制者版本等内部术语。若当前 capture 未打开，只需告诉用户在 Session 的 Capture 区域选择该文件并点击 Open capture；不要重复搜索不存在的打开工具，也不要让用户诊断 runtime 或配置租约。仍可用 ask_user 确认问题区域、期望和验收标准。需要等待用户打开材料时，先用 turn_complete 声明 blocked，再说明已知信息与继续条件；不能以普通 final 回复冒充调查完成。
按需读取项目文件补充目标、约束与下一步所缺证据。保持简短，不读取原始 .rdc bytes。
