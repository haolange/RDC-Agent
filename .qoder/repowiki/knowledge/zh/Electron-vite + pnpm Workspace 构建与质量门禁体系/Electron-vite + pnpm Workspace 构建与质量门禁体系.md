---
kind: build_system
name: Electron-vite + pnpm Workspace 构建与质量门禁体系
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - electron.vite.config.ts
    - vite.renderer.config.ts
    - electron-builder.json
    - vitest.config.ts
    - pnpm-workspace.yaml
    - .github/workflows/ci.yml
    - scripts/launch-rdc-agent.mjs
    - scripts/start-rdc-agent.cmd
    - scripts/start-rdc-agent.sh
    - patches/style-mod@4.1.3.patch
---

## 1. 构建系统总览

RDC-Agent 采用 **pnpm workspace + electron-vite** 统一编排 Electron 主进程、预加载脚本与渲染进程，并通过 `electron-builder` 产出 Windows NSIS/ZIP 安装包。所有构建、测试、打包与发布流程由根 `package.json` 的 scripts 驱动，配合 `.github/workflows/ci.yml` 在 GitHub Actions 中执行。

- Node.js 版本锁定：`engines.node >=22.13.0`，CI 固定使用 `node-version: '22.13.0'`。
- 包管理器锁定：`packageManager: "pnpm@11.7.0"`，CI 通过 `pnpm/action-setup@v4` 安装相同版本，并强制 `--frozen-lockfile`。
- 工作区缓存：`pnpm-workspace.yaml` 将 store 路径固定到 `~/.cache/rdc-agent/pnpm-store`，并启用 `preferOffline: true`。

## 2. 核心构建配置

### 2.1 electron-vite 三进程构建
`electron.vite.config.ts` 定义三个入口：
- main：`src/main/index.ts` + `src/main/workers/turnPreparationWorker.ts`，使用 `externalizeDepsPlugin()` 外联依赖，并挂载 `providerCatalogVitePlugin`。
- preload：`src/preload/index.ts`。
- renderer：`src/renderer/index.html`，使用 React 插件，别名 `@renderer` → `src/renderer`、`@shared` → `src/shared`。

开发时渲染进程独立 Vite 服务器（`vite.renderer.config.ts`），监听 `127.0.0.1:5173`，HMR 协议为 `ws`，并通过自定义插件把 CSS 热更新路由切换到 `/platform/devStyles.ts` 以适配 BrowserAppBridge CSP。

### 2.2 启动器与增量构建
`scripts/launch-rdc-agent.mjs` 是统一的入口脚本，支持模式：`desktop`、`desktop-dev`、`browser`、`browser-dev`、`prepare-only`。

关键行为：
- 校验 Node 版本 ≥22.13.0。
- 通过 `pnpm-resolver.mjs` 解析 pnpm，store 路径来自 `pnpm store path`。
- 依赖指纹：对 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 计算 sha256，结合 pnpm/nodeAbi/platform/arch/storePath 生成 fingerprint，写入 `node_modules/.cache/rdc-agent/dependency-state.json`；指纹变化才重新 `pnpm install --frozen-lockfile --prefer-offline`。
- Electron 二进制恢复：若 `rebuild electron` 后仍缺失，则调用 `@electron/get` 下载对应版本 zip，用系统 `tar` 解压到 `node_modules/electron/dist` 并写 `path.txt`。
- 构建指纹：对 `src/`、`resources/brand/`、`electron.vite.config.ts`、`vite.renderer.config.ts`、`tsconfig.json`、`package.json`、`pnpm-lock.yaml` 计算哈希，输出产物为 `out/main/index.js`、`out/main/provider-catalog/index.json`、`out/preload/index.js`、`out/renderer/index.html`；命中缓存直接跳过 build。
- 开发模式：`desktop-dev` 直接运行 `electron-vite dev`；`browser-dev` 先启动独立 Vite 服务器（端口 0 自动分配），等待其可访问后再启动 headless Electron 注入 `ELECTRON_RENDERER_URL`。

### 2.3 打包与产物
`electron-builder.json` 配置：
- `appId: com.rdc-agent.app`，`productName: RDC-Agent`。
- 输出目录 `release/`，构建资源目录 `resources/`。
- 打包文件：`out/**/*`、`resources/agent-runtime/**/*`、`resources/knowledge/**/*`。
- `asarUnpack`：`resources/agent-runtime/hooks/**/*.mjs`（Hook 需作为独立文件执行）。
- `extraResources`：将 hooks 中的 `.mjs` 和品牌 logo 复制到应用目录。
- Windows 目标：NSIS（x64，非一键安装，允许选择安装目录）+ ZIP（x64），产物命名 `${productName}-${version}-${arch}-setup.${ext}`。
- `forceCodeSigning: false`，但 `signAndEditExecutable: true`。

## 3. 测试与覆盖率

- 测试框架：Vitest 4.x，`vitest.config.ts` 设置 environment 为 `node`，包含 `src/**/*.test.ts`，全局 setup 为 `scripts/vitest-global-setup.ts`。
- 覆盖率：v8 provider，报告目录 `coverage/`，仅统计 `src/main/**` 与 `src/shared/**`，排除 IPC handlers、工具调用、媒体、捕获、会话服务、OAuth、daemon、reports、commands 等 Electron/OS 绑定代码。
- 覆盖率阈值：lines 40%、functions 40%、branches 30%、statements 40%，并通过 `check:coverage-ratchet` 脚本强制只升不降。

## 4. CI 流水线（GitHub Actions）

`.github/workflows/ci.yml` 定义多个 job：

| Job | 平台 | 职责 |
|---|---|---|
| `build` | ubuntu-latest | checkout(lfs) → pnpm install → typecheck → lint → test → test:coverage → check:coverage-ratchet → check:gates → provider-catalog → scoped-resources → project-instructions → prompt-plan-snapshot → skills → hooks → memory-policy → contracts → git-diff whitespace → build |
| `macos-shell` | macos-latest | 验证 Electron 运行时初始化（串行避免并发提取冲突） |
| `launcher-fresh-checkout` | ubuntu/windows | 验证 `start-rdc-agent.cmd/sh --prepare-only` 的幂等性（第二次应跳过 install/build）、pnpm store 路径、Windows 下 `pack` |
| `browser-smoke` | windows-latest | 矩阵 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=0|1`，执行 `smoke:agent-browser` |
| `desktop-smoke` | windows-latest | prepare-only → pack → `smoke:desktop` → release-config + sbom + checksums |

## 5. 质量门禁脚本体系

`scripts/check-*.mjs` 构成仓库级门禁，通过 `pnpm run check:gates` 串联执行，包括：架构检查、编排门面、保真度契约、共享导出、渲染结构、设计令牌、工作进程呈现、对话分支、推理交付、Agent 运行时、工具系统、浏览器能力、外观、会话投影、右侧栏、知识系统、调查系统、遗留残留、验收账本、设置 Agent、Provider 系统、发布配置、标识、Git diff 空白等。

## 6. 依赖与补丁策略

- `overrides`：强制 `fast-uri@3.1.2`、`postcss@8.5.15`。
- `pnpm-workspace.yaml` 中 `overrides.yauzl=3.3.1` 修复 Node ≥24.16 下 `extract-zip` 挂起问题。
- `patchedDependencies.style-mod@4.1.3` 指向 `patches/style-mod@4.1.3.patch`，使 CodeMirror 在桌面 CSP 下使用构造式样式表。
- `allowBuilds` 允许 `@swc/core`、`electron-winstaller`、`esbuild` 编译原生模块。

## 7. 约定与约束

- 所有构建/测试命令必须通过 `pnpm` 执行，禁止绕过 `launch-rdc-agent.mjs` 直接调用 `electron`。
- 依赖变更必须更新 `pnpm-lock.yaml`，CI 使用 `--frozen-lockfile` 拒绝未提交锁文件。
- 新增入口或构建输入会改变 `buildFingerprint` 的哈希集合，导致重建——新增文件需同步加入指纹列表。
- Hook 脚本必须以 `.mjs` 形式放在 `resources/agent-runtime/hooks/`，并通过 `asarUnpack` 保持可执行。
- Windows 打包产物命名遵循 `${productName}-${version}-${arch}-setup.${ext}`，不得修改 `electron-builder.json` 中的模板。
- 覆盖率阈值与 ratchet 检查必须在 PR 上通过，否则阻塞合并。
- 跨平台启动器 `scripts/start-rdc-agent.cmd` / `scripts/start-rdc-agent.sh` 必须保证第二次运行跳过依赖安装与构建（CI 断言输出中包含相应日志）。