# CodePilot 对照报告

本文把 `D:\Projects\Native\CodePilot` 的结构化架构索引作为参考对象，用来校准 `RDC-Agent` 的结构升级方向。`.qoder` 是 CodePilot 的架构 wiki 索引，不是 `RDC-Agent` 要照搬的目标结构。

## 结论

CodePilot 值得学习的是架构表达方式，而不是技术栈迁移：

- CodePilot 用 `Electron shell -> App/API -> lib -> hooks -> feature components -> ui/patterns -> tests/docs` 把每层职责写得很清楚。
- CodePilot 的 API、Provider、工作区、Bridge、媒体等能力都有源码入口、数据流、故障边界和测试入口。
- `RDC-Agent` 当前的技术方向仍应保持 `Electron + React + electron-vite`，因为本仓库是 RenderDoc `.rdc` 垂直调试工作台，不是通用 coding agent 客户端。
- 本次迁移的是“可读边界”：领域目录、IPC/API 域、共享契约入口、数据流文档和后续拆分路线。

## 架构对照

| 维度 | CodePilot | RDC-Agent 当前状态 | RDC-Agent 升级方向 |
| --- | --- | --- | --- |
| 桌面外壳 | `electron/` 管理窗口、preload、嵌入式服务 | `src/main` 同时承担窗口、IPC、服务编排 | 保留主进程，但把 `ipc`、`shell`、`runtime`、`workflow` 等边界写清 |
| 应用/API 层 | Next.js App Router + REST API | preload + IPC 是主要 API 面 | 以 `window.electronAPI`、IPC channel、shared types 作为跨层契约 |
| 核心业务 | `src/lib` 承载 db、SDK、stream、provider、workspace | `src/main/services` 承载 workflow、storage、settings、tool、runtime log | 不机械搬家，先建立 `workflow/sessions/tools/settings/runtime/reports/shell` 领域入口 |
| UI 分层 | `components/ui`、业务组件、layout 分层明显 | `App.tsx` 和部分组件承担较多 shell glue | 先建立 `renderer/ui`、`patterns`、`features/debugger`、`shell` 边界，后续按 UI 保真拆分 |
| 数据流文档 | wiki 中按 API、workspace、Bridge 分域描述 | 主链散落在 README、workflow 文档和服务代码中 | 新增架构总览、数据流、模块地图，作为后续 agent 入口 |
| 测试策略 | Playwright、单元、构建文档有集中描述 | E2E 已存在，但入口与构建前置规则不够显眼 | 在模块地图中标出关键 smoke 与构建前置 |

## 明确迁移

- 迁移 CodePilot 式模块地图：每个能力域写清源码入口、跨层 API、UI 入口和测试入口。
- 迁移 CodePilot 式数据流表达：从用户交互到持久化、工具执行、证据、报告的端到端链路。
- 迁移 CodePilot 式 API 分域：IPC handlers 和 preload API 先按 shell、conversation、workflow、project/session、capture/device、settings/profile、tool/evidence/runtimeLog、terminal/context 分组。
- 迁移 CodePilot 式 public surface：`src/shared` 提供稳定导出入口，减少跨层调用方猜测类型路径。

## 明确不迁移

- 不迁移 Next.js App Router。
- 不引入 CodePilot 的 REST API server 层。
- 不引入 SQLite 作为当前工作区数据的强制替代。
- 不把 RenderDoc 工具链泛化成通用 coding-agent tool system。
- 不把 Analyzer / Optimizer 自动并入 Debugger harness；当前可执行主链仍是 Debugger。
- 不做 UI 视觉改版，不改变现有布局、面板层级、测试定位符和交互路径。

## 采用方式

本次采用“先立边界、再逐步抽离热点”的方式：

1. 文档先变成后续 agent 的入口，而不是继续从巨型文件反推系统。
2. IPC/preload/shared 先建立域入口，保持 `window.electronAPI` 形状兼容。
3. `DebugWorkflowService`、`App.tsx`、`browserElectronApi.ts` 后续按现有 DOM 和业务行为保真拆分。
4. 每次结构迁移都以 `npm run typecheck` 为底线，涉及入口或窗口逻辑时补 `npm run build`。
