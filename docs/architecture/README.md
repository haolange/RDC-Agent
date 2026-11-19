# 架构文档

产品边界、架构边界与验证门禁以根目录 [ARCHITECTURE.md](../../ARCHITECTURE.md) 为 SSOT。跨层契约权威在 [`docs/contracts/`](../contracts/)；本目录承载实现向架构说明与模块地图，不与 contracts 双轨裁决。

## 契约入口（权威）

- [`../contracts/runtime-kernel.md`](../contracts/runtime-kernel.md)
- [`../contracts/permissions.md`](../contracts/permissions.md)
- [`../contracts/failure-model.md`](../contracts/failure-model.md)

## 产品规格

- [`../product/scoped-runtime-resources.md`](../product/scoped-runtime-resources.md)：Scope、Skills、Hooks、Memory、Knowledge 的产品规格。

## 本目录文档

- `overview.md`：Electron / React / Debugger 主链架构总览。
- `module-map.md`：能力域到源码、共享类型、IPC/preload、UI 与测试入口的地图。
- `data-flow.md`：Project、Session、Capture、Agent、Trace 与 RDC shell action 的端到端数据流。
- `agent-runtime-kernel.md`：实现导览，从属于 `docs/contracts/runtime-kernel.md`。
- `rdc-runtime.md`：RDC 操作契约：CLI 绑定、lease/隔离、回执、capture_select/restore/recover、Android 连接与回放观察。
- `agentic-trace-protocol.md`：Trace、Progress 与 right-panel projection。
- `provider-architecture.md`：Catalog / EffectiveModel / RequestPlan / credential lease。
- `browser-qa-surface.md`：Browser（debug-only）与 Desktop 的单轨 API、transport、安全及状态 parity。
