# RDC-Agent

`RDC-Agent` 是面向 RenderDoc `.rdc` capture 的 Electron 桌面应用。它把通用 Agent 协作入口与可审计的图形调试流程放在同一工作台中，并通过用户配置的外部 RDX CLI 执行本机 RenderDoc 能力。

## 当前能力

- 管理本地 Project，并使用 `<project-root>/.rdx/inputs/` 作为 `.rdc` 输入目录。
- 在工作台内浏览、导入、打开和切换 capture；失败时 fail-closed 并展示 RDX/RenderDoc 诊断。
- 使用固定的 `~/.rdx` User Scope 与 `<project-root>/.rdx` Project Scope 管理 Agent、Skill、MCP、Hook、Policy、Knowledge 与显式 Memory。
- 配置真实 Provider、Model 与 Agent Route，通过统一的 `PromptPlan -> RequestEnvelope -> Provider Adapter` 管线执行 LLM 调用。
- 在 Work Process 中展示真实运行过程与 provider reasoning 语义；脱敏 Request Inspector 放在 Control Panel Runtime 调试面，不嵌入消息流。
- 通过 Settings 中的 RDX CLI 与 shell actions 接入系统安装或用户配置的外部工具链。

## Canonical Runtime

用户资源固定在 `~/.rdx`：

```text
~/.rdx/
  config.json
  RDX.md
  agents/ skills/ mcp/ hooks/ policies/ knowledge/ memory/
```

项目资源固定在 `<project-root>/.rdx`：

```text
<project-root>/
  RDX.md
  .rdx/
    project.yaml
    agents/ skills/ mcp/ hooks/ policies/ knowledge/ memory/
    inputs/ artifacts/
```

应用状态、Secret、日志和缓存保存在 OS `userData` 目录，不进入 User/Project Scope。项目 `.rdx/.gitignore` 默认忽略 `inputs/`、`artifacts/`、`memory/` 与 runtime state。

## 仓库结构

- `src/main`：Electron 主进程、IPC、工作流编排、Provider 与外部能力接入。
- `src/preload`：向 renderer 暴露受控 API。
- `src/renderer`：界面、交互和状态投影。
- `src/shared`：跨层类型、常量与契约。
- `resources`：随应用分发的 Core Prompt 与 builtin Agent/Skill 资源。
- `docs`：稳定产品、架构、工作流和 UI 文档。
- `scripts`：可复用开发、验证和启动脚本。

## 开发与验证

```bash
npm install
npm run dev
```

真实浏览器会话：

```bash
npm run start:agent-browser
```

主验证命令：

```bash
npm run typecheck
npm test -- --run
npm run check:architecture
npm run check:fidelity
npm run check:shared-exports
npm run check:provider-system
npm run check:settings-agents
npm run check:reasoning-delivery
npm run check:work-process
npm run check:work-process-tool-coverage
npm run build
```

## 文档入口

- [DESIGN.md](./DESIGN.md)：产品与工程架构 SSOT。
- [AGENTS.md](./AGENTS.md)：仓库修改与验证规范。
- [docs/README.md](./docs/README.md)：正式文档索引。
- [docs/architecture/agent-runtime-kernel.md](./docs/architecture/agent-runtime-kernel.md)：RDX Runtime 与 Agent Kernel。
- [docs/ui/design-system.md](./docs/ui/design-system.md)：设计系统与 UI 约束。
