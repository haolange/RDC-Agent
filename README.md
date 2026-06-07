# RDC-Agent

`RDC-Agent` 是一个面向 `RenderDoc` `.rdc` capture 的 Electron 桌面应用，使用 `Electron + React + TypeScript` 构建。产品目标是把自然协作式对话入口和严格的垂直调试主链放在同一个工作台中，让 `Debugger` 模式以可审计、可回放的方式执行 RenderDoc 调试流程。

## 当前能力

- 管理本地项目，并约定 `<project-root>/.resource/inputs/` 作为 `.rdc` 输入目录。
- 在工作台内浏览、导入、打开和切换 capture。
- 维护 `workspace root`，统一承载设置、日志和应用级运行数据。
- 配置 `provider / model / agent route`，并把真实 LLM 路由视为 Debugger 主链的一部分。
- 以自研 deterministic `DebuggerRuntime` 作为唯一顶层流程权威，控制 stage、gate、approval、state、evidence 和 finalization。
- 通过自研 `AgentRuntime` / `ToolRegistry` 统一执行 agent turn 和 tool loop；provider、account、API key、OAuth 与 `LLMAdapter` 继续作为模型接入边界。
- 执行 `Plan / Intake -> 用户批准 -> execution loop -> verification / skeptic / curator -> report` 主链。
- 展示会话、运行状态、证据链、报告和中间产物。

## 仓库结构

- `src/main`：Electron 主进程，负责窗口、菜单、IPC、工作流编排和外部能力接入。
- `src/preload`：向渲染层暴露受控 API。
- `src/renderer`：界面、交互、状态展示和用户入口。
- `src/shared`：跨层共享的常量、类型与工具函数。
- `docs`：产品、架构、工作流和 UI 文档。
- `resources`：随应用分发或运行时依赖的资源。
- `scripts`：开发辅助脚本。
- `e2e`：Playwright browser session 与 Electron shell smoke。

仓库保持标准 Electron 应用布局。`Config / Saved / Intermediate / Binaries` 这类概念属于运行期或构建期产物，不作为仓库顶层目录。

## 运行期目录映射

应用运行时会在 `workspace root` 下管理本地数据，默认位于系统 `userData` 派生目录。当前主目录包括：

- `<workspace-root>/settings.json`
- `<workspace-root>/logs/`
- `<workspace-root>/projects/`
- `<workspace-root>/knowledge/`
- `<workspace-root>/migration-orphans/`
- `<workspace-root>/profiles/`
- `<workspace-root>/policies/`
- `<workspace-root>/secrets/`
- `<workspace-root>/migration-reports/`

对应关系如下：

| 产品概念 | 本仓库表达 |
| --- | --- |
| Documentation | `docs/` |
| Source | `src/` |
| Config | `workspace root` 下的 `settings.json`、provider 配置与策略目录 |
| Saved | `workspace root` 下的日志、运行数据、迁移数据 |
| Intermediate | `out/`、`.vite/`、`.electron-vite/` 等本地构建缓存 |
| Binaries | `release/`、`dist/` 以及打包产物 |

## 开发运行

```bash
npm install
npm run dev
```

人类日常打开软件也可以运行 `scripts/start-rdc-agent.cmd`，该脚本会使用构建产物启动同一套 Electron 主进程和 renderer；缺少构建产物时会先构建一次。主进程启动后会输出 `http://127.0.0.1:<port>/app`，供浏览器真实会话连接同一套 main/runtime。

agent 日常交互式迭代使用 headless 浏览器真实会话：设置 `RDC_AGENT_HEADLESS=1` 启动主进程后，打开主进程输出的 `/app` 地址。该模式只跳过 Electron 桌面窗口，renderer、样式、workspace、settings、ToolBridge 和 `window.electronAPI` 能力面与人类桌面软件保持同源。

常用命令：

- `npm run typecheck`
- `npm run build`
- `npm run pack`
- `npm run dist`
- `npm run test:browser-session`
- `npm run test:shell-smoke`

## 开发约定

- 涉及主进程、预加载脚本、渲染层、共享类型时，优先在一次改动内同步收敛相关契约。
- 不保留明显的 legacy 双轨入口、镜像目录或“临时兼容”路径。
- 文档以中文为主，必要英文术语保留原文。
- 目录、脚本和文档命名采用稳定主题名，不使用“设想 / 演示 / 建议 / 分析”这类阶段性文件名作为正式结构。

## Git 与产物治理

- `node_modules/`、`out/`、`dist/`、`release/`、测试输出和缓存目录都属于本地产物，不应提交。
- 仓库启用 Git LFS，`.rdc` 样本、二进制资源和大图资源按现有规则管理。
- 首次拉取带 LFS 资源的环境需要先执行 `git lfs install`。

## 文档入口

- [DESIGN.md](./DESIGN.md)：产品设计与工程架构权威入口
- [docs/README.md](./docs/README.md)：文档索引
- [docs/product/vertical-debugger-overview.md](./docs/product/vertical-debugger-overview.md)：产品总览
- [docs/architecture/overview.md](./docs/architecture/overview.md)：当前架构总览
- [docs/architecture/agent-runtime-kernel.md](./docs/architecture/agent-runtime-kernel.md)：Agent Runtime Kernel、provider/account、tool mediation、MCP/skills 和 Debugger 串行 multi-agent workflow
- [docs/architecture/module-map.md](./docs/architecture/module-map.md)：源码入口与能力地图
- [docs/architecture/data-flow.md](./docs/architecture/data-flow.md)：端到端数据流
- [docs/architecture/codepilot-comparison.md](./docs/architecture/codepilot-comparison.md)：CodePilot 对照与迁移边界
- [docs/architecture/spec-driven-development.md](./docs/architecture/spec-driven-development.md)：规范宪章
- [docs/ui/design-system.md](./docs/ui/design-system.md)：UI 设计系统
