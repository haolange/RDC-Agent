---
kind: build_system
name: Electron + Vite 多进程构建与发布流水线
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - electron.vite.config.ts
    - vite.renderer.config.ts
    - vitest.config.ts
    - electron-builder.json
    - scripts/launch-rdc-agent.mjs
    - scripts/start-rdc-agent.cmd
    - scripts/start-rdc-agent.sh
    - .github/workflows/ci.yml
    - scripts/release/generate-checksums.mjs
    - scripts/release/generate-sbom.mjs
---

## 1. 使用的系统与工具

- **包管理器**：pnpm（`packageManager: pnpm@11.7.0`，`pnpm-workspace.yaml` 声明 workspace），CI 通过 `pnpm/action-setup@v4` 固定版本安装。
- **Node 运行时**：要求 Node ≥22.13.0（`engines.node` 与 `scripts/launch-rdc-agent.mjs` 中硬编码校验）。
- **构建编排**：`electron-vite`（`electron.vite.config.ts`）统一构建 main、preload、renderer 三个 Electron 进程；Vite 同时承担 renderer 开发服务器与打包。
- **测试**：Vitest（`vitest.config.ts`），运行环境为 node，覆盖率使用 v8 provider，报告输出到 `coverage/`。
- **打包分发**：`electron-builder`（`electron-builder.json`），仅配置 Windows NSIS x64 安装包，产物输出到 `release/`。
- **CI**：GitHub Actions（`.github/workflows/ci.yml`），在 ubuntu/windows/macOS 上执行类型检查、lint、单元测试、覆盖率门禁、架构/保真度门禁、构建与 unpacked 包冒烟。
- **启动器**：`scripts/launch-rdc-agent.mjs` 是统一的入口脚本，封装依赖准备、增量构建、Electron 二进制恢复、dev server 拉起与模式切换（desktop / desktop-dev / browser / browser-dev / prepare-only）。

## 2. 关键文件

- `package.json`：脚本命令、依赖、版本号、`main` 入口指向 `out/main/index.js`。
- `electron.vite.config.ts`：定义 main/preload/renderer 三进程的 Rollup input、alias（`@shared`、`@renderer`）、插件（`externalizeDepsPlugin`、`providerCatalogVitePlugin`、React）。
- `vite.renderer.config.ts`：独立 renderer 开发配置，注入 CSP 相关样式替换、HMR over ws、端口 5173。
- `vitest.config.ts`：测试 include/exclude 策略、覆盖率阈值（lines/functions/branches/statements 最低 30~40%）、全局 setup。
- `electron-builder.json`：应用 ID、产物目录、asarUnpack hooks `.mjs`、extraResources、Windows NSIS 目标。
- `scripts/launch-rdc-agent.mjs`：依赖指纹缓存、增量构建、Electron 二进制自动恢复、多模式启动。
- `scripts/start-rdc-agent.cmd` / `scripts/start-rdc-agent.sh`：跨平台 wrapper，被 CI 用于 fresh checkout 验证。
- `.github/workflows/ci.yml`：CI 流水线，包含 build、macos-shell、launcher-fresh-checkout、browser-smoke、desktop-smoke 五个 job。
- `scripts/release/generate-checksums.mjs`、`scripts/release/generate-sbom.mjs`：发布产物校验和与 SBOM 生成。

## 3. 架构与约定

### 多进程构建模型
- main 进程入口：`src/main/index.ts`，额外 worker 入口：`src/main/workers/turnPreparationWorker.ts`。
- preload 进程入口：`src/preload/index.ts`。
- renderer 入口：`src/renderer/index.html`，由 Vite 单独 serve/build。
- 共享模块通过 `@shared` alias 在三个进程间复用。

### 增量构建与缓存
- `launch-rdc-agent.mjs` 将依赖状态与构建状态写入 `node_modules/.cache/rdc-agent/dependency-state.json` 与 `build-state.json`。
- 依赖指纹基于 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、pnpm 版本、platform/arch/nodeAbi/storePath 计算；构建指纹基于 `src/`、各 vite/electron-vite 配置、`tsconfig.json`、`package.json`、`pnpm-lock.yaml` 的 sha256。
- 当指纹未变且输出存在时，跳过 `pnpm install` 与 `electron-vite build`，实现“Dependencies are current; skipping pnpm install.”、“Build outputs are current; skipping build.”。
- 若 `node_modules` 中的 Electron 二进制缺失，会尝试 `pnpm rebuild electron`，再回退到通过 `@electron/get` 下载并 `tar -xf` 解压恢复。

### 模式与环境变量
- `--mode desktop`：生产桌面应用；`desktop-dev`：走 `electron-vite dev`；`browser` / `browser-dev`：headless 模式，设置 `RDC_AGENT_HEADLESS=1`、`RDC_AGENT_BROWSER_QA=1`，并启动 Vite dev server 后以 `ELECTRON_RENDERER_URL` 注入给主进程。
- `prepare-only`：仅完成依赖与构建，不启动 Electron。
- `rebuild-settings-only`：仅重建 settings，便于调试。

### 测试与覆盖率门禁
- Vitest 仅对 `src/main/**` 与 `src/shared/**` 统计覆盖率，排除 IPC handlers、worker glue、Electron shell、media、captures、oauth、daemon、reports、commands 等进程/平台绑定代码。
- 覆盖率阈值 lines/functions/branches/statements 分别为 40/40/30/40；`check:coverage-ratchet` 脚本进一步强制覆盖率只升不降。
- 大量 `check:*` 脚本作为质量门禁（architecture、fidelity、design-tokens、work-process、agent-runtime、tool-system、provider-system、session-projection、right-rail、knowledge-system、investigation-system、legacy-residue、acceptance-ledger、repository-hygiene 等），由 `check:gates` 串联执行。

### 打包与发布
- `electron-builder` 仅配置 Windows NSIS x64 安装包，产物命名 `${productName}-${version}-${arch}-setup.${ext}`，输出到 `release/`。
- `resources/agent-runtime/hooks/**/*.mjs` 通过 `asarUnpack` 与 `extraResources` 保持可执行 Hook 不被压缩进 asar。
- CI 在 `launcher-fresh-checkout` 与 `desktop-smoke` job 中调用 `pnpm run pack`（unpacked 包）+ `smoke:desktop` 健康检查，并生成 SBOM 与 checksums。

## 4. 约定与约束

- **Node/pnpm 版本锁定**：`engines.node >=22.13.0`，`packageManager: pnpm@11.7.0`，CI 固定安装相同版本，确保可重现。
- **依赖安装必须冻结**：所有 `pnpm install` 均带 `--frozen-lockfile`，禁止锁文件变更。
- **构建产物位置固定**：main/preload/renderer 输出到 `out/`，`package.json.main` 指向 `out/main/index.js`，启动器据此判断构建是否完成。
- **覆盖率门槛不可低于当前值**：`vitest.config.ts` 设定基线阈值，并由 `check:coverage-ratchet` 在 CI 中强制执行只增不减。
- **Renderer 开发不走直连**：`vite.renderer.config.ts` 注释明确说明 browser-dev 模式下 Vite 位于 BrowserAppBridge 同源反向代理之后，应通过桥 `/qa` URL 访问而非直接浏览。
- **Hook 资源必须可执行**：`electron-builder.json` 显式 `asarUnpack` hooks `.mjs` 并通过 `extraResources` 复制到 `agent-runtime/hooks`，保证运行时可加载。
- **CI 门禁链**：PR/Push main 必须依次通过 typecheck → lint → test → coverage → check:gates → check:provider-catalog → scoped-resources/project-instructions/prompt-plan-snapshot/skills/hooks/memory-policy/contracts → git-diff whitespace → build，任一失败即中断。
- **Fresh checkout 验证**：CI 在干净仓库上通过 `start-rdc-agent.{cmd,sh} --prepare-only` 验证依赖缓存与二次 prepare 的 skip 行为，并断言 pnpm store 路径落在 `$HOME/.cache/rdc-agent/pnpm-store`。
