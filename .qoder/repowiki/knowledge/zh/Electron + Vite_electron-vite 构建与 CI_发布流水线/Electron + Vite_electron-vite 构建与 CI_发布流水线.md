---
kind: build_system
name: Electron + Vite/electron-vite 构建与 CI/发布流水线
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - electron.vite.config.ts
    - vite.renderer.config.ts
    - vitest.config.ts
    - electron-builder.json
    - .github/workflows/ci.yml
    - scripts/launch-rdc-agent.mjs
    - scripts/start-rdc-agent.cmd
    - scripts/start-rdc-agent.sh
    - scripts/release/generate-checksums.mjs
    - scripts/release/generate-sbom.mjs
---

## 1. 构建系统总览

本项目采用 **pnpm workspace**（`pnpm-workspace.yaml`）+ **electron-vite** 统一编排 Electron 三进程（main / preload / renderer）的编译、测试与打包，并通过 **electron-builder** 产出 Windows NSIS 安装包。所有脚本集中在 `package.json` 的 `scripts` 中，通过 Node 脚本 (`scripts/*.mjs`) 实现质量门禁、启动器与发布辅助。

- 包管理器：`pnpm@11.7.0`（由 `packageManager` 字段锁定），Node 版本要求 `>=22.13.0`。
- 构建工具链：`electron-vite` 作为顶层入口，内部复用 `vite` + `@vitejs/plugin-react`；主进程与预加载进程使用 `externalizeDepsPlugin()` 将依赖外联，渲染进程单独配置 React 插件与 HMR。
- 产物输出：`out/**/*`（main/preload/renderer 编译产物）、`resources/agent-runtime/**/*`、`resources/knowledge/**/*` 被 electron-builder 打包进 `release/` 目录下的 NSIS 安装程序。
- 多模式运行：通过 `scripts/launch-rdc-agent.mjs` 的 `--mode` 参数区分 `desktop` / `desktop-dev` / `browser` / `browser-dev` / `prepare-only`，配合 `scripts/start-rdc-agent.{cmd,sh}` 跨平台封装。

## 2. 关键文件与职责

| 文件 | 作用 |
|---|---|
| `package.json` | 定义版本号 `0.6.0`、所有 npm scripts（dev/build/pack/dist/test/check:*）、依赖与 overrides |
| `electron.vite.config.ts` | 三进程构建入口：main 输入 `src/main/index.ts` + worker `turnPreparationWorker.ts`，preload 输入 `src/preload/index.ts`，renderer 输入 `src/renderer/index.html`；配置 `@shared`、`@renderer` 别名 |
| `vite.renderer.config.ts` | 浏览器开发模式专用 Vite 配置，注入 CSP 兼容样式替换、HMR over ws 协议 |
| `vitest.config.ts` | 单元测试配置：仅覆盖 `src/main` + `src/shared`，排除 IPC handlers、worker glue、OAuth、daemon 等进程/OS 绑定代码；覆盖率阈值 lines=40/functions=40/branches=30/statements=40 |
| `electron-builder.json` | 应用 ID `com.rdc-agent.app`、产品名 `RdcAgent`、NSIS 目标（x64）、asarUnpack hooks `.mjs`、extraResources 映射、签名开关 `forceCodeSigning: false` |
| `.github/workflows/ci.yml` | GitHub Actions CI：Ubuntu 上执行 typecheck/lint/test/coverage/gates/provider-catalog/scoped-resources/project-instructions/prompt-plan-snapshot/skills/hooks/memory-policy/contracts/git-diff/build；macOS 上跑 runtime 相关 vitest；Windows 上验证 prepare-only 幂等性、生成 unpacked release 并执行 desktop/browser smoke |
| `scripts/release/generate-checksums.mjs` | 生成发布校验和 |
| `scripts/release/generate-sbom.mjs` | 生成软件物料清单 (SBOM) |
| `scripts/{start-rdc-agent.cmd,sh,launch-rdc-agent.mjs}` | 跨平台启动器，支持 `--prepare-only` 缓存 pnpm store 到 `~/.cache/rdc-agent/pnpm-store` 并跳过重复 install/build |

## 3. 架构与约定

### 3.1 三进程构建模型
- main 进程：Rollup input 为 `src/main/index.ts`，额外打包 `src/main/workers/turnPreparationWorker.ts` 作为独立 worker 入口。
- preload 进程：单入口 `src/preload/index.ts`。
- renderer 进程：基于 `src/renderer/index.html`，启用 React 插件，开发服务器监听 `127.0.0.1:5173`，HMR 使用 ws 协议以便 BrowserAppBridge 代理升级。
- 共享模块：通过 `@shared` 别名指向 `src/shared`，在 main、preload、renderer、vitest 四套配置中保持一致。

### 3.2 开发与生产路径
- `pnpm dev` → `scripts/launch-rdc-agent.mjs --mode desktop-dev`，走 electron-vite 热重载。
- `pnpm start` → `--mode desktop`，直接启动已构建产物。
- `pnpm build` → `electron-vite build`，输出至 `out/`。
- `pnpm pack` → `electron-builder --dir`，生成 unpacked 目录用于 smoke 测试。
- `pnpm dist` → `electron-builder`，生成正式 NSIS 安装包。

### 3.3 质量门禁体系
`package.json` 提供大量 `check:*` 脚本，由 `check:gates` 串联执行，CI 中逐一调用：
- 架构一致性：`check-architecture.mjs`、`check-orchestrator-facade.mjs`
- 保真度契约：`fidelity:extract` + `check:fidelity`（对比 baseline）
- 渲染器结构：`check-renderer-structure.mjs`
- 共享导出契约：`check-shared-exports.mjs`
- Agent/Provider/Tool/Knowledge/Investigation/Session/Settings/Hook 等子系统契约校验
- 覆盖率门限：`check-coverage-ratchet.mjs` 仅允许覆盖率上升
- Git diff 空白检查、仓库卫生检查、接受账本检查

### 3.4 测试策略
- 单元：`vitest run`，环境 node，仅覆盖 main + shared，排除 Electron/IPC/worker/OAuth/daemon 等边界代码。
- 冒烟：`smoke:agent-browser`（Windows，带 `RDC_AGENT_SMOKE_START=1` 环境变量驱动）、`smoke:desktop`。
- 验收套件：`test/work-process-cot/` 纯浏览器 HTML 场景集，不依赖 Electron。

### 3.5 发布流程
- 版本来源：`package.json` 的 `version` 字段（当前 `0.6.0`）。
- 产物命名：`${productName}-${version}-${arch}-setup.${ext}`（NSIS）。
- CI 触发：push 到 `main` 或 PR 时运行；macOS job 单独验证 shell 相关代码；Windows job 验证 prepare-only 幂等性与打包。
- 发布后工件：`release/` 目录下的安装包；`release:sbom` 生成 SBOM；`release:checksums` 生成校验和。
- asar 处理：hooks 下的 `.mjs` 通过 `asarUnpack` 与 `extraResources` 保持可执行。

## 4. 约定与约束

- **Node 版本锁定**：`engines.node >= 22.13.0`，CI 固定使用 `22.13.0`。
- **pnpm 版本锁定**：`packageManager: pnpm@11.7.0`，CI 通过 `pnpm/action-setup@v4 with version: 11.7.0` 强制。
- **依赖冻结**：CI 使用 `pnpm install --frozen-lockfile`，禁止隐式更新。
- **覆盖率门槛**：vitest 配置中设置 lines/functions/branches/statements 阈值，并由 `check:coverage-ratchet` 确保只升不降。
- **构建产物位置**：所有编译输出统一位于 `out/`，electron-builder 仅打包 `out/**/*` 及指定 resources。
- **外部资源隔离**：agent-runtime hooks 中的 `.mjs` 必须通过 `asarUnpack` 暴露，避免被压缩进 asar。
- **跨平台启动器**：Windows 用 `scripts/start-rdc-agent.cmd`，POSIX 用 `scripts/start-rdc-agent.sh`，均支持 `--prepare-only` 以复用 `~/.cache/rdc-agent/pnpm-store` 并跳过重复安装/构建。
- **CI 门禁不可绕过**：PR 与 push main 均强制运行完整 gate suite（typecheck、lint、test、coverage、gates、provider-catalog、scoped-resources、project-instructions、prompt-plan-snapshot、skills、hooks、memory-policy、contracts、git-diff、build）。
- **签名关闭**：`electron-builder.json` 中 `forceCodeSigning: false`，本地/CI 默认不签名，需手动开启。
- **浏览器 QA 模式**：`vite.renderer.config.ts` 注释明确禁止直接访问 Vite 服务，必须通过 BrowserAppBridge 的 `/qa` URL 访问，且 HMR 使用 ws 协议由 bridge 升级。