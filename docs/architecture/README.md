# Architecture Docs

- `overview.md`：当前 Electron / React / Debugger 主链架构总览。
- `module-map.md`：能力域到源码入口、共享类型、IPC/preload、UI 和测试入口的地图。
- `data-flow.md`：Project、Session、Capture、Agent、Trace 与 RDX shell actions 的端到端数据流。
- `agent-runtime-kernel.md`：Agent Runtime kernel、provider/account abstraction、tool mediation、Ask readonly profile、Debugger serial multi-agent workflow 与 SDK backend boundary。
- `agentic-trace-protocol.md`：Agentic Trace 权威追踪契约。
- `provider-system.md`：Provider 体系架构，覆盖 `LlmProviderEntry` / `LlmProviderKind` / `LlmProviderAuthMode` / `LlmProviderCatalogGroup` / `LlmProviderCapability` 的正交维度与 Settings、Agent Runtime 路由契约。
- `spec-driven-development.md`：跨层规范与执行约束。
- `codepilot-comparison.md`：CodePilot 架构参考项与 RDC-Agent 迁移边界。

## 历史 / 阶段性参考

- `vertical-framework-implementation-plan.md`：垂直调试框架的历史实现规划。
- `framework-improvement-notes.md`：框架收敛与改进方向记录。

主阅读路径以根目录 `DESIGN.md`、本目录 `overview.md`、`module-map.md` 和 `data-flow.md` 为准。
