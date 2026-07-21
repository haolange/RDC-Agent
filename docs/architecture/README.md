# 架构文档

产品边界、架构边界与验证门禁以根目录 [DESIGN.md](../../DESIGN.md) 为 SSOT。本目录只承载稳定主题，不保存阶段性 completion plan 或 handover。

## 当前契约

- `overview.md`：Electron / React / Debugger 主链架构总览。
- `module-map.md`：能力域到源码、共享类型、IPC/preload、UI 与测试入口的地图。
- `data-flow.md`：Project、Session、Capture、Agent、Trace 与 RDX shell action 的端到端数据流。
- `agent-runtime-kernel.md`：RDX Runtime、Prompt/Request pipeline、provider routing、tool mediation 与 Agent Loop。
- `rdx-runtime.md`：Scope、资源覆盖、Project Instructions、Skills、Hooks、显式 Memory、Request Snapshot 与 Reasoning contract。
- `agentic-trace-protocol.md`：Trace、Progress 与 right-panel projection 契约。
- `provider-architecture.md`：strict JSON Catalog、compiler/Registry、EffectiveModel、RequestPlan、credential lease 与账号证据契约。
- `spec-driven-development.md`：跨层规范与执行约束。

## 对照资料

- `codepilot-comparison.md`：外部架构对照与迁移边界，不作为运行时事实来源。
