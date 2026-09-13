---
kind: build_system
name: Electron + pnpm + electron-vite/electron-builder 构建与发布流水线
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
    - pnpm-workspace.yaml
    - scripts/release/generate-checksums.mjs
    - scripts/release/generate-sbom.mjs
    - scripts/start-rdc-agent.cmd
    - scripts/start-rdc-agent.sh
    - scripts/check-architecture.mjs
    - scripts/check-fidelity.mjs
    - scripts/check-release-config.mjs
---

## 1. 构建系统总览

RDC-Agent 是一个基于 Electron 的桌面应用，采用 **pnpm workspace** 管理依赖、**electron-vite** 统一编排主进程/预加载/渲染三端打包、**Vitest** 执行单元测试并输出覆盖率，最终通过 **electron-builder** 生成 Windows NSIS 安装包。所有构建、测试、质量门禁与发布产物校验均通过 `package.json` 中的 npm scripts 暴露，并由 GitHub Actions (`.github/workflows/ci.yml`) 在 push / PR 上触发。

- Node 版本锁定：`engines.node >=22.13.0`，CI 使用 `actions/setup-node@v4` 固定安装 `22.13.0`。
- 包管理器：`pnpm@11.7.0`（`packageManager` 字段 + CI 中 `pnpm/action-setup@v4 with version: 11.7.0`），并通过 `pnpm-workspace.yaml` 将 store 目录固定到 `~/.cache/rdc-agent/pnpm-store`，配合 `preferOffline: true` 加速重复构建。
- 构建产物输出：`out/**/*`（由 electron-vite 产出），被 electron-builder 打包进 `release/` 目录下的安装包。

## 2. 关键文件与职责

| 文件 | 作用 |
|---|---|
| `package.json` | 定义入口 `main: out/main/index.js`、全部构建/测试/检查脚本、依赖及 devDependencies（electron、electron-vite、vitest、eslint、react 等） |
| `electron.vite.config.ts` | 主工程构建配置：为 main/preload/renderer 分别声明 Rollup input；注入 `externalizeDepsPlugin()` 将运行时依赖外置；注册 `providerCatalogVitePlugin`；设置 `@shared`、`@renderer` 别名 |
| `vite.renderer.config.ts` | 独立 Vite 开发服务器配置（端口 5173，HMR 走 ws），用于 `start:agent-browser` 模式下的浏览器 QA 调试 |
| `vitest.config.ts` | 测试运行器：全局 API、`node` 环境、仅扫描 `src/**/*.test.ts`；覆盖率覆盖 `src/main` 与 `src/shared`，排除 IPC handlers、worker 胶水、Electron/OS 绑定模块等；阈值 lines 40 / functions 40 / branches 30 / statements 40 |
| `electron-builder.json` | 应用 ID `com.rdc-agent.app`、产品名 `RdcAgent`；输出目录 `release`；打包 `out/**/*` 与 `resources/agent-runtime/**/*`、`resources/knowledge/**/*`；`asarUnpack` 保留 `hooks/**/*.mjs` 以便运行时动态加载；Windows 目标 `nsis x64`，产物命名 `${productName}-${version}-${arch}-setup.${ext}` |
| `.github/workflows/ci.yml` | CI 流水线：`build` job 在 ubuntu-latest 上执行 typecheck → lint → test → coverage → check:gates → provider-catalog → scoped-resources → project-instructions → prompt-plan-snapshot → skills → hooks → memory-policy → contracts → git-diff → build；另有 macos-shell、launcher-fresh-checkout、browser-smoke、desktop-smoke 多矩阵任务 |
| `scripts/release/generate-checksums.mjs`、`generate-sbom.mjs` | 发布产物校验：生成 checksum 与 SBOM，供 CI 验证 |
| `scripts/start-rdc-agent.{cmd,sh}`、`scripts/run-rdc-launcher.{cmd,sh}` | 跨平台启动/准备包装器，支持 `--prepare-only` 跳过已缓存依赖与构建输出 |
| `scripts/check-*.mjs` | 质量门禁脚本集合（架构、保真度、设计令牌、共享导出、会话投影、知识系统、调查系统等），由 `check:gates` 串联 |

## 3. 构建流程与约定

### 3.1 本地开发
- `pnpm dev`：通过 `scripts/launch-rdc-agent.mjs --mode desktop-dev` 启动 Electron 主进程，配合 electron-vite 热重载。
- `pnpm dev:renderer`：单独启动 Vite 渲染服务器（端口 5173），用于浏览器 QA 场景。
- `pnpm start`：以生产模式启动 `out/main/index.js`。

### 3.2 构建与打包
- `pnpm build`：调用 `electron-vite build`，同时编译 main、preload、renderer 三个入口，输出至 `out/`。
- `pnpm pack`：`electron-builder --dir` 生成未签名的 unpacked 目录，用于 CI 的 smoke 测试。
- `pnpm dist`：`electron-builder` 完整打包，生成 NSIS 安装包到 `release/`。

### 3.3 测试与覆盖率
- `pnpm test`：`vitest run`，默认 node 环境，仅包含 `src/**/*.test.ts`。
- `pnpm test:coverage`：使用 v8 提供者输出 text/lcov/json-summary 到 `./coverage`，并按 `vitest.config.ts` 中的 include/exclude 白名单计算覆盖率。
- `pnpm check:coverage-ratchet`：通过 `scripts/check-coverage-ratchet.mjs` 强制覆盖率只升不降（ratchet）。

### 3.4 质量门禁（gates）
`pnpm check:gates` 顺序执行 20+ 个 `check:*` 脚本，涵盖架构一致性、代理门面、保真度契约、共享导出、工作流呈现、对话分支、推理交付、Agent 运行时、工具系统、浏览器能力、外观、会话投影、右侧栏、知识系统、调查系统、遗留残留、验收账本、设置 Agent、Provider 系统、发布配置、设计令牌、渲染结构等。CI 将其作为合并前必过关卡。

### 3.5 发布制品校验
- `pnpm release:sbom`：生成软件物料清单。
- `pnpm release:checksums`：生成发布产物校验和。
- `pnpm check:release-config`：校验发布配置一致性。
- CI 在 `launcher-fresh-checkout` 与 `desktop-smoke` job 中依次执行上述命令，确保发布产物可追溯。

## 4. 架构与约定

- **三端分离**：main (`src/main`)、preload (`src/preload`)、renderer (`src/renderer`) 各自拥有独立 Rollup input，通过 electron-vite 统一构建。
- **共享代码**：`src/shared` 通过 `@shared` 别名在主进程、预加载、渲染侧共同引用，避免重复实现。
- **外部化依赖**：main/preload 使用 `externalizeDepsPlugin()` 将运行时依赖外置，减小 bundle 体积并加快冷启动。
- **资源打包策略**：Agent Runtime 的 `resources/agent-runtime/hooks/**/*.mjs` 通过 `asarUnpack` 从 asar 中解包，保证 Hook 可在运行时被 Node 动态 require/import；其他静态资源（prompts、skills、icons、knowledge seed）直接随应用分发。
- **跨平台启动**：Windows 使用 `scripts/start-rdc-agent.cmd`，POSIX 使用 `scripts/start-rdc-agent.sh`，两者都支持 `--prepare-only` 模式，利用 `~/.cache/rdc-agent/pnpm-store` 与构建缓存跳过重复安装/构建。
- **CI 多矩阵**：Ubuntu 负责全量检查与构建；macOS 额外验证 runtime 工具；Windows 验证 launcher 包装器行为、打包与健康冒烟；Browser QA 在 Windows 上以不同 `RDC_AGENT_BROWSER_QA_FULL_ACCESS` 值运行。

## 5. 约束与规则

- Node 版本必须 ≥22.13.0（`engines` 字段 + CI 固定 `22.13.0`）。
- 依赖安装必须使用 `pnpm install --frozen-lockfile`（CI 所有 job 均如此）。
- pnpm store 路径必须位于 `~/.cache/rdc-agent/pnpm-store`（`pnpm-workspace.yaml` 的 `storeDir` + CI 断言）。
- 覆盖率阈值：lines/functions/statements ≥40%，branches ≥30%（`vitest.config.ts` thresholds）。
- 覆盖率必须“只升不降”（`check:coverage-ratchet` 在 CI 中强制执行）。
- 构建产物必须输出到 `out/`，且 `electron-builder` 打包范围限定为 `out/**/*` 与指定 `resources/**/*`，防止无关文件进入安装包。
- Windows 安装包目标仅限 `nsis x64`，产物命名遵循 `${productName}-${version}-${arch}-setup.${ext}` 模板。
- 所有 `check:*` 脚本必须通过 `pnpm check:gates` 才能视为通过质量门禁。
