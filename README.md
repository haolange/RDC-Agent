# RDC-Agent

`RDC-Agent` 是面向 `RenderDoc` `.rdc` capture 的 Electron 桌面应用，使用 `Electron + React + TypeScript` 构建。产品目标是把自然协作式对话入口和严格的垂直调试主链放在同一个工作台中，让 `Debugger` 模式以可审计、可回放的方式执行 RenderDoc 调试流程。

## 当前能力

- 管理本地 project，并约定 `<project-root>/.resource/inputs/` 作为 `.rdc` 输入目录。
- 在工作台内浏览、导入、打开和切换 capture。
- 维护 workspace root，统一承载 settings、logs 和应用级运行数据。
- 配置 provider / model / agent route，并把真实 LLM 路由视为 Debugger 主链的一部分。
- 通过 `AgentRuntime` / `ToolRegistry` 统一执行 agent turn 和 tool loop。
- 通过配置化 Settings shell action / `bash -> ShellInvocationService -> system-installed RDX CLI` 调用 RenderDoc 工具。
- 展示会话、运行状态、证据链、报告和中间产物。

## 仓库结构

- `src/main`：Electron 主进程，负责窗口、菜单、IPC、工作流编排和外部能力接入。
- `src/preload`：向渲染层暴露受控 API。
- `src/renderer`：界面、交互、状态展示和用户入口。
- `src/shared`：跨层共享的常量、类型与工具函数。
- `docs`：产品、架构、工作流和 UI 文档。
- `resources`：随应用分发或运行时依赖的资源。
- `scripts`：可复用开发脚本。

仓库保持标准 Electron 应用布局。`Config`、`Saved`、`Intermediate`、`Binaries` 属于运行期或构建期概念，不作为仓库顶层源码目录。

## 运行期目录映射

应用运行时会在 workspace root 下管理本地数据，默认位于系统 `userData` 派生目录。当前主目录包括：

- `<workspace-root>/settings.json`
- `<workspace-root>/logs/`
- `<workspace-root>/projects/`
- `<workspace-root>/knowledge/`
- `<workspace-root>/migration-orphans/`
- `<workspace-root>/profiles/`
- `<workspace-root>/policies/`
- `<workspace-root>/secrets/`
- `<workspace-root>/migration-reports/`

| 产品概念 | 本仓库表达 |
| --- | --- |
| Documentation | `docs/` |
| Source | `src/` |
| Config | workspace root 下的 `settings.json`、provider 配置与策略目录 |
| Saved | workspace root 下的日志、运行数据、迁移数据 |
| Intermediate | `out/`、`.vite/`、`.electron-vite/` 等本地构建缓存 |
| Binaries | `release/`、`dist/` 以及打包产物 |

## 开发运行

```bash
npm install
npm run dev
```

人类开发模式运行 `scripts/start-rdc-agent-dev.cmd`，它启动可见 Electron React WebUI。人类本地构建产物运行 `scripts/start-rdc-agent.cmd`；发布包按平台双击 exe / app 包。两条人类路径都进入同一套 Electron main process、renderer、workspace、settings 和 RDX CLI invoker。

agent 日常交互式迭代运行 `scripts/start-browser-session.cmd` 或 `npm run start:agent-browser`，再用 Codex 内置浏览器打开主进程输出的 `/app` 地址。该模式只跳过 Electron 桌面窗口，renderer、样式、workspace、settings、project/session、RDX CLI invoker 和 `window.electronAPI` 能力面与人类桌面软件保持同源。

## 常用命令

- `npm run typecheck`
- `npm run build`
- `npm run check:architecture`
- `npm run check:fidelity`
- `npm run check:shared-exports`
- `npm run check:provider-system`
- `npm run check:settings-agents`
- `npm run start:human`
- `npm run start:human:dev`
- `npm run start:agent-browser`

本地产品级 smoke 需要显式传入真实输入路径：

```powershell
$env:RDC_AGENT_PRODUCT_SMOKE_PROJECT_ROOT='H:\DebugTest\custom'
$env:RDC_AGENT_PRODUCT_SMOKE_RDC_PATH="$env:USERPROFILE\Desktop\眼睛泪腺白点.rdc"
npm run start:agent-browser
```

## 开发约定

- 涉及主进程、预加载脚本、渲染层、共享类型时，优先在一次改动内同步收敛相关契约。
- 不保留明显的 legacy 双轨入口、镜像目录或“临时兼容”路径。
- 文档以中文为主，必要英文术语保留原文。
- 目录、脚本和文档命名采用稳定主题名，不使用“设想 / 演示 / 建议 / 分析”这类阶段性文件名作为正式结构。
- 仓库不保留内置 RDX tool 副本；RDX CLI 由系统安装或用户提供，并通过 Settings 中的 CLI invoker 与 RDX shell actions 配置。

## Git 与产物治理

- `node_modules/`、`out/`、`dist/`、`release/`、测试输出和缓存目录都属于本地产物，不应提交。
- 仓库启用 Git LFS，`.rdc` 样本、二进制资源和大图资源按现有规则管理。
- 首次拉取带 LFS 资源的环境需要先执行 `git lfs install`。

## 文档入口

- [DESIGN.md](./DESIGN.md)：产品设计与工程架构权威入口
- [AGENTS.md](./AGENTS.md)：仓库修改公约
- [docs/README.md](./docs/README.md)：文档索引
- [docs/product/vertical-debugger-overview.md](./docs/product/vertical-debugger-overview.md)：产品总览
- [docs/architecture/overview.md](./docs/architecture/overview.md)：当前架构总览
- [docs/architecture/agent-runtime-kernel.md](./docs/architecture/agent-runtime-kernel.md)：Agent Runtime Kernel
- [docs/architecture/module-map.md](./docs/architecture/module-map.md)：源码入口与能力地图
- [docs/architecture/data-flow.md](./docs/architecture/data-flow.md)：端到端数据流
- [docs/architecture/spec-driven-development.md](./docs/architecture/spec-driven-development.md)：规范宪章
- [docs/ui/design-system.md](./docs/ui/design-system.md)：UI 设计系统
