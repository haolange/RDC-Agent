# 架构文档

产品边界、架构边界与验证门禁以根目录 [DESIGN.md](../../DESIGN.md) 为 SSOT。跨层契约权威在 [`docs/contracts/`](../contracts/)；本目录承载实现向架构说明与模块地图，不与 contracts 双轨裁决。

## 契约入口（权威）

- [`../contracts/runtime-kernel.md`](../contracts/runtime-kernel.md)
- [`../contracts/permissions.md`](../contracts/permissions.md)
- [`../contracts/failure-model.md`](../contracts/failure-model.md)
- [`../product/scoped-runtime-resources.md`](../product/scoped-runtime-resources.md)

## 本目录文档

- `overview.md`：Electron / React / Debugger 主链架构总览。
- `module-map.md`：能力域到源码、共享类型、IPC/preload、UI 与测试入口的地图。
- `data-flow.md`：Project、Session、Capture、Agent、Trace 与 RDX shell action 的端到端数据流。
- `agent-runtime-kernel.md`：实现向 kernel 说明（契约以 contracts/runtime-kernel 为准）。
- `rdx-runtime.md`：Scope、资源覆盖、Instructions、Skills、Hooks、Memory（产品规格见 product/scoped-runtime-resources）。
- `agentic-trace-protocol.md`：Trace、Progress 与 right-panel projection。
- `provider-architecture.md`：Catalog / EffectiveModel / RequestPlan / credential lease。
- `spec-driven-development.md`：跨层规范与执行约束。

## 对照资料

- `codepilot-comparison.md`：外部架构对照与迁移边界，不作为运行时事实来源。
