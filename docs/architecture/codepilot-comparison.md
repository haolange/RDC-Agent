# CodePilot 对照报告

本文仅作外部架构对照参考，不作为 `RDC-Agent` 运行时事实来源。对照对象是外部 CodePilot 仓库的结构化架构索引表达方式；其架构 wiki 索引不是本仓库要照搬的目标结构。

## 结论

CodePilot 值得学习的是架构表达方式，而不是技术栈迁移：

- CodePilot 用 `Electron shell -> App/API -> lib -> hooks -> feature components -> ui/patterns -> tests/docs` 把每层职责写得很清楚。
- CodePilot 的 API、Provider、工作区、Bridge、媒体等能力都有源码入口、数据流、故障边界和测试入口。
- `RDC-Agent` 当前的技术方向仍应保持 `Electron + React + electron-vite`。本仓库的产品边界是通用 agent workbench，RenderDoc `.rdc` 能力通过 Settings 中配置的外部 RDC-Tool CLI 接入，不内置 tool 副本。
- 本次迁移的是“可读边界”：领域目录、IPC/API 域、共享契约入口、数据流文档和后续拆分路线。

## 架构对照

| 维度 | CodePilot | RDC-Agent 当前状态 | RDC-Agent 升级方向 |
| --- | --- | --- | --- |
| 桌面外壳 | `electron/` 管理窗口、preload、嵌入式服务 | `src/main` 同时承担窗口、IPC、服务编排 | 保留主进程，但把 `ipc`、`shell`、`runtime`、`workflow` 等边界写清 |
| 应用/API 层 | Next.js App Router + REST API | preload + IPC 是主要 API 面 | 以 `window.electronAPI`、IPC channel、shared types 作为跨层契约 |
| 核心业务 | `src/lib` 承载 db、SDK、stream、provider、workspace | `src/main` 已收敛到 workflow、sessions、captures、conversation、tools、settings、runtime、reports、shell | 后续继续拆内部 facade，不恢复 services 技术桶 |
| UI 分层 | `components/ui`、业务组件、layout 分层明显 | `src/renderer` 已收敛到 shell、features、ui、patterns、platform | 后续继续拆 `App.tsx` glue，不恢复 components 技术桶 |
| 数据流文档 | wiki 中按 API、workspace、Bridge 分域描述 | 已有架构总览、数据流、模块地图 | 继续以 `DESIGN.md` 与 `docs/architecture/*` 为稳定入口 |
| 测试策略 | Playwright、单元、构建文档有集中描述 | 以 `typecheck`、契约 `check:*`、浏览器真实会话为主；不以 Playwright E2E 为门禁 | UI/UX 验收走 `pnpm run start:agent-browser` |

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
- 不把 Analyzer / Optimizer 自动并入 Debugger harness；它们与 Debugger、Edit 一样是独立 executable profile，由 profile visibility、handoff 和 tool policy 调度。
- 不做 UI 视觉改版，不改变现有布局、面板层级、测试定位符和交互路径。

## 采用方式

本次采用“先立边界、再逐步抽离热点”的方式：

1. 文档先变成后续 agent 的入口，而不是继续从巨型文件反推系统。
2. IPC/preload/shared 先建立域入口，保持 `window.electronAPI` 形状兼容。
3. `DebugWorkflowService`、`StorageAdapter`、`App.tsx`、Browser App Bridge 后续按现有 DOM 和业务行为保真继续拆分。
4. 每次结构迁移都以 `pnpm run typecheck` 为底线，涉及入口或窗口逻辑时补 `pnpm run build`；UI 验收优先浏览器真实会话。
