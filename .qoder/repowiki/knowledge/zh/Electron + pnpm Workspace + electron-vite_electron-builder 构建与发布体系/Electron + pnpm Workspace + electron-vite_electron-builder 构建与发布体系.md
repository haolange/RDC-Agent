---
kind: build_system
name: Electron + pnpm Workspace + electron-vite/electron-builder 构建与发布体系
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - electron.vite.config.ts
    - vite.renderer.config.ts
    - vitest.config.ts
    - electron-builder.json
    - .github/workflows/ci.yml
    - scripts/release/generate-checksums.mjs
    - scripts/release/generate-sbom.mjs
    - scripts/start-rdc-agent.cmd
    - scripts/start-rdc-agent.sh
    - scripts/launch-rdc-agent.mjs
---

## 1. 使用的系统/工具链

- **包管理器**：pnpm（`packageManager: pnpm@11.7.0`，`engines.node >=22.13.0`），通过 `pnpm-workspace.yaml` 将 store 固定到 `~/.cache/rdc-agent/pnpm-store`，并全局 `overrides` 修复 `yauzl` 在 Node ≥24.16 下的挂起问题。
- **构建编排**：`electron-vite`（`electron.vite.config.ts`）统一构建 Electron 主进程、预加载脚本和渲染进程；渲染进程另有独立 Vite 配置 `vite.renderer.config.ts` 用于浏览器 QA 模式。
- **打包发行**：`electron-builder`（`electron-builder.json`），仅配置 Windows NSIS x64 安装包，输出目录为 `release/`，产物命名 `${productName}-${version}-${arch}-setup.${ext}`。
- **测试**：Vitest（`vitest.config.ts`），运行环境 `node`，覆盖率由 `@vitest/coverage-v8` 生成，阈值下限 lines/functions/statements=40、branches=30，并通过 `check:coverage-ratchet` 强制只升不降。
- **CI**：GitHub Actions（`.github/workflows/ci.yml`），在 `ubuntu-latest`、`macos-latest`、`windows-latest` 上执行类型检查、lint、单元测试、覆盖率门禁、架构/保真度/契约校验、构建以及桌面/浏览器冒烟测试。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 工程入口脚本、依赖版本、`scripts` 中所有质量门禁与构建命令 |
| `pnpm-workspace.yaml` | pnpm store 路径、`overrides`、`allowBuilds`、`minimumReleaseAgeExclude` |
| `electron.vite.config.ts` | electron-vite 三进程构建配置（main/preload/renderer 输入、alias、插件） |
| `vite.renderer.config.ts` | 渲染进程独立 Vite 配置（browser-dev HMR、CSP 样式替换） |
| `vitest.config.ts` | Vitest 测试范围、覆盖率 include/exclude、阈值与全局 setup |
| `electron-builder.json` | NSIS 打包目标、asarUnpack hooks mjs、extraResources、图标与产物名 |
| `.github/workflows/ci.yml` | CI 流水线：安装→typecheck→lint→test→coverage→gates→build→smoke |
| `scripts/release/generate-checksums.mjs` / `generate-sbom.mjs` | 发布产物校验和与 SBOM 生成 |
| `scripts/start-rdc-agent.{cmd,sh}` / `scripts/launch-rdc-agent.mjs` | 跨平台启动器，支持 `--prepare-only` 增量缓存与 `--mode desktop/browser/dev*` |

## 3. 架构与约定

### 3.1 多进程构建模型
- 主进程入口 `src/main/index.ts` 与 worker `src/main/workers/turnPreparationWorker.ts` 作为 electron-vite main 的 Rollup input。
- 预加载入口 `src/preload/index.ts` 单独构建。
- 渲染进程以 `src/renderer/index.html` 为入口，开发服务器监听 `127.0.0.1:5173`，HMR 使用 ws 协议并通过 BrowserAppBridge 反向代理访问。
- 通过 `@shared`、`@renderer` alias 共享 TypeScript 路径，避免重复编译。

### 3.2 资源打包策略
- `files` 包含 `out/**/*`、`resources/agent-runtime/**/*`、`resources/knowledge/**/*`。
- `resources/agent-runtime/hooks/**/*.mjs` 通过 `asarUnpack` 不被打入 asar，同时通过 `extraResources` 复制到 `agent-runtime/hooks` 以便运行时动态加载。
- 图标位于 `resources/icons/icon.ico`，NSIS 安装器非一键安装、允许选择安装目录、卸载不清理 AppData。

### 3.3 质量门禁体系
根 `package.json` 暴露大量 `check:*` 脚本（architecture、fidelity、design-tokens、renderer-structure、shared-exports、work-process-presentation、conversation-branch、reasoning-delivery、agent-runtime、tool-system、browser-capability、provider-system、settings-agents、appearance、session-projection、right-rail、knowledge-system、investigation-system、legacy-residue、acceptance-ledger、git-diff、repository-hygiene、scoped-resources、project-instructions、prompt-plan-snapshot、skills、hooks、memory-policy、contracts、coverage-ratchet、release-config），并由 `check:gates` 串联调用。CI 在 PR/Merge 时强制全部通过。

### 3.4 发布流程
- `pnpm run build` → `electron-vite build` 产出 `out/`。
- `pnpm run dist` → `electron-builder` 生成 NSIS 安装包到 `release/`。
- `pnpm run pack` → 仅打包不签名（CI 用 `--dir` 做 unpacked 健康检查）。
- 发布阶段额外执行 `check:release-config`、`release:sbom`、`release:checksums`。
- CI 在 Windows 上禁用代码签名（`CSC_IDENTITY_AUTO_DISCOVERY=false`）。

### 3.5 增量与缓存
- `scripts/start-rdc-agent.{cmd,sh}` 支持 `--prepare-only`，会检测依赖是否已安装、构建产物是否最新，跳过重复步骤，并在第二次执行时打印 `Dependencies are current; skipping pnpm install` 与 `Build outputs are current; skipping build`（被 CI 断言）。pnpm store 固定到 `~/.cache/rdc-agent/pnpm-store`。

## 4. 约定与约束

- **Node/pnpm 版本锁定**：`package.json` 声明 `engines.node >=22.13.0`、`packageManager: pnpm@11.7.0`；CI 通过 `pnpm/action-setup@v4` 指定相同版本号，确保可重现。
- **依赖覆盖**：`pnpm-workspace.yaml` 中 `overrides.yauzl=3.3.1` 是硬性修复，防止 electron@42 在 Node ≥24.16 下挂起；`package.json` 中 `overrides.fast-uri`、`postcss` 用于解决冲突。
- **构建产物位置**：主进程、预加载、渲染均输出到 `out/`，由 `electron-builder` 的 `files` 规则收集。
- **测试边界**：`vitest.config.ts` 显式 exclude Electron/OS 绑定模块（tools、media、captures、sessions、daemon、sdk、reports、commands、workers 等），仅对 main/shared 核心逻辑做覆盖率统计。
- **覆盖率门槛**：lines/functions/statements≥40、branches≥30，且必须满足 ratchet（只升不降）。
- **Windows 专属**：仅配置 `win.target=nsis`、`arch=[x64]`，无 macOS/Linux 打包目标；CI 仅在 Windows 上执行 `pack`、`release:checksums`。
- **钩子脚本外置**：Agent Runtime 的 hooks（`.hook.yml` + `.mjs`）通过 `asarUnpack` 与 `extraResources` 保持可执行，禁止被 asar 压缩。
- **CI 门禁不可绕过**：PR 与 push to main 均触发完整 gate 套件，包括 `check:gates`、`check:provider-catalog`、`check:scoped-resources`、`check:project-instructions`、`check:prompt-plan-snapshot`、`check:skills`、`check:hooks`、`check:memory-policy`、`check:contracts`、`check:git-diff` 及最终 `build`。
