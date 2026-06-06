# Architecture Docs

- `agent-runtime-kernel.md`: Agent Runtime Kernel, provider/account abstraction, tool mediation, MCP/skills, Ask readonly profile, Debugger serial multi-agent workflow, and SDK backend boundary.

- `overview.md`：当前 Electron / React / Debugger 主链架构总览。
- `data-flow.md`：Project、Session、Capture、Workflow、ToolBridge 等端到端数据流。
- `module-map.md`：能力域到源码入口、共享类型、IPC/preload、UI 和测试入口的地图。
- `codepilot-comparison.md`：CodePilot 架构参考项与 RDC-Agent 迁移边界。
- `spec-driven-development.md`：跨层规范与执行约束。
- `agentic-trace-protocol.md`：**Agentic Trace 权威跨层契约**（Event Log → Trace Tree → UI Projection → Renderer Registry）。

## 历史/阶段性参考

- `vertical-framework-implementation-plan.md`：垂直调试框架的历史实现规划。
- `framework-improvement-notes.md`：框架收敛与改进方向记录。

主阅读路径以根目录 `DESIGN.md`、本目录 `overview.md`、`module-map.md` 和 `data-flow.md` 为准。
