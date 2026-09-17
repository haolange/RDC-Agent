---
kind: build_system
name: Electron + Vite/electron-vite 构建与打包体系
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - electron.vite.config.ts
    - vite.renderer.config.ts
    - electron-builder.json
    - .github/workflows/ci.yml
    - scripts/launch-rdc-agent.mjs
    - scripts/release/generate-checksums.mjs
    - scripts/release/generate-sbom.mjs
---

## 1. 构建系统概览

RDC-Agent 采用 **pnpm workspace + electron-vite** 统一编排 Electron 主进程、预加载脚本与渲染进程的构建，并通过 **electron-builder** 产出 Windows NSIS 安装包。所有构建入口集中在根 `package.json` 的 scripts 中，由 `scripts/launch-rdc-agent.mjs` 作为跨平台启动器与依赖/构建缓存协调者。

- Node.js 版本锁定：`engines.node >=22.13.0`，CI 固定使用 `22.13.0`。
- pnpm 版本锁定：`packageManager: "pnpm@11.7.0"`，CI 通过 `pnpm/action-setup@v4` 安装相同版本。
- 包管理器：`pnpm-lock.yaml` + `pnpm-workspace.yaml`（workspace 文件存在但当前为单包工程）。

## 2. 核心构建配置

### 2.1 electron-vite 多目标构建
`electron.vite.config.ts` 定义三个构建目标：
- **main**: 入口 `src/main/index.ts`，额外输出 `src/main/workers/turnPreparationWorker.ts`；启用 `externalizeDepsPlugin()` 将运行时依赖外置，并挂载自定义 `providerCatalogVitePlugin` 编译 provider catalog。
- **preload**: 入口 `src/preload/index.ts`，同样 externalize 依赖。
- **renderer**: 入口 `src/renderer/index.html`，使用 `@vitejs/plugin-react`，别名 `@renderer` → `src/renderer`、`@shared` → `src/shared`。

开发服务器运行在 `127.0.0.1:5173`，`strictPort: false` 允许端口复用。

### 2.2 独立渲染器开发配置
`vite.renderer.config.ts` 用于浏览器 QA 模式下的独立 Vite 服务，通过自定义插件将 HMR 样式注入替换为 `/platform/devStyles.ts`，以适配 BrowserAppBridge 的同源反向代理场景。

### 2.3 打包产物
`electron-builder.json` 配置：
- 应用 ID：`com.rdc-agent.app`，产品名：`RdcAgent`。
- 输出目录：`release/`，构建资源目录：`resources/`。
- 打包文件：`out/**/*`、`resources/agent-runtime/**/*`、`resources/knowledge/**/*`。
- `asarUnpack`：`resources/agent-runtime/hooks/**/*.mjs` 必须 unpack 以便 Hook 引擎动态加载。
- `extraResources`：将 hooks 目录按 `agent-runtime/hooks` 结构复制到可执行目录。
- Windows 目标：仅 `x64` 架构，NSIS 安装器，文件名模板 `${productName}-${version}-${arch}-setup.${ext}`，启用 `signAndEditExecutable`。
- `forceCodeSigning: false`，CI 中通过环境变量 `CSC_IDENTITY_AUTO_DISCOVERY=false` 关闭签名。

## 3. 启动器与增量构建

`scripts/launch-rdc-agent.mjs` 是统一的启动入口，支持以下模式：
- `desktop` / `desktop-dev`：可见 Electron 桌面应用。
- `browser` / `browser-dev`：headless 模式，通过 `ELECTRON_RENDERER_URL` 驱动渲染器进行浏览器 QA。
- `prepare-only`：仅准备依赖与构建产物，不启动 Electron。

关键行为：
- **Node 版本校验**：要求 `>=22.13.0`，否则直接失败。
- **pnpm 解析与 store 管理**：通过 `scripts/pnpm-resolver.mjs` 解析 pnpm，并将 store 路径固定到 `~/.cache/rdc-agent/pnpm-store`（CI 断言该路径）。
- **依赖指纹缓存**：基于 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、pnpm 版本、平台、arch、nodeAbi、storePath 计算 fingerprint，写入 `node_modules/.cache/rdc-agent/dependency-state.json`，跳过已就绪的安装。
- **构建指纹缓存**：基于 `src/`、`electron.vite.config.ts`、`vite.renderer.config.ts`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml` 计算 build fingerprint，写入同目录 `build-state.json`，跳过已就绪的 `electron-vite build`。
- **Electron 二进制恢复**：若 `node_modules/electron/dist` 缺失，先尝试 `pnpm rebuild electron`，再回退到通过 `@electron/get` 下载 zip 并用系统 `tar` 解压至 `dist/`，同时写 `path.txt` 指向平台可执行文件。
- **dev 模式**：`desktop-dev` 直接调用 `electron-vite dev`；`browser-dev` 启动独立 Vite 渲染器服务（端口 0 自动分配），等待其可达后设置 `ELECTRON_RENDERER_URL` 启动 headless Electron。

## 4. CI 流水线 (`.github/workflows/ci.yml`)

| Job | 平台 | 职责 |
|---|---|---|
| `build` | `ubuntu-latest` | checkout(LFS) → install → typecheck → lint → test → coverage → check:coverage-ratchet → check:gates → provider-catalog → scoped-resources → project-instructions → prompt-plan-snapshot → skills → hooks → memory-policy → contracts → git-diff whitespace → build |
| `macos-shell` | `macos-latest` | 仅对 `src/main/runtime` 与 `src/main/agent-runtime/tools/primitives` 跑 vitest |
| `launcher-fresh-checkout` | ubuntu/windows 矩阵 | 验证 `start-rdc-agent.cmd/sh --prepare-only` 的二次调用能跳过依赖安装与构建，并断言 pnpm store 位于 `~/.cache/rdc-agent/pnpm-store`；Windows 上执行 `pnpm run pack` |
| `browser-smoke` | windows-latest | 设置 `RDC_AGENT_SMOKE_START=1`，运行 `smoke:agent-browser` |
| `desktop-smoke` | windows-latest | prepare-only → pack → `smoke:desktop` → release-config + sbom + checksums |

并发策略：`concurrency.group = ci-${workflow}-${pr.number || ref}`，新提交取消进行中任务。

## 5. 质量门禁与检查脚本

根 `package.json` 暴露大量 `check:*` 脚本，最终由 `check:gates` 串联执行，包括：architecture、fidelity、shared-exports、work-process presentation/tool coverage、conversation-branch、reasoning-delivery、agent-runtime、tool-system、browser-capability、appearance、session-projection、right-rail、knowledge-system、investigation-system、legacy-residue、acceptance-ledger、settings-agents、provider-system、release-config、design-tokens、renderer-structure 等。这些脚本均位于 `scripts/check-*.mjs`，通过 AST/正则/契约比对实现静态质量门禁。

## 6. 发布与制品

- `pnpm run dist`：调用 `electron-builder` 生成正式安装包。
- `pnpm run pack`：调用 `electron-builder --dir` 生成未打包目录（供 CI smoke 测试）。
- `release:checksums` / `release:sbom`：分别生成校验和与软件物料清单（SBOM），由 CI 在 Windows 与通用 job 中执行。
- 版本号来源：`package.json.version`（当前 `0.6.0`），electron-builder 通过 `${version}` 变量嵌入产物名。

## 7. 约定与约束

- 所有 Node 工具链通过 `scripts/launch-rdc-agent.mjs` 间接调用，禁止绕过启动器直接运行 `electron-vite` 或 `electron`（CI 会校验）。
- 依赖安装与构建产物必须可缓存且幂等；任何破坏 `dependency-state.json`/`build-state.json` 的行为都会触发重新安装/重建。
- 渲染器开发服务器必须绑定 `127.0.0.1`，禁止监听 `0.0.0.0`（安全考虑）。
- Hook `.mjs` 文件必须从 asar 中 unpack，运行时通过 `extraResources` 映射到 `agent-runtime/hooks` 目录。
- Windows 打包仅支持 x64 架构；其他平台无官方发布目标。
- CI 中禁用代码签名（`CSC_IDENTITY_AUTO_DISCOVERY=false`），本地发布需自行配置签名环境。
- 所有 `check:*` 脚本必须全部通过才能合并 PR（由 `check:gates` 强制）。
