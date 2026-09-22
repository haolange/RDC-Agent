---
kind: dependency_management
name: pnpm 工作区 + 锁定文件 + patch-package 风格的依赖治理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - patches/style-mod@4.1.3.patch
    - scripts/pnpm-resolver.mjs
---

## 1. 使用的系统与工具

- **包管理器**：pnpm（`package.json` 中通过 `packageManager: "pnpm@11.7.0"` 声明，并通过 `engines.node >=22.13.0` 约束 Node 版本）。
- **工作区**：根目录存在 `pnpm-workspace.yaml`，但当前仓库是单包结构（无 `packages/` 子工作区），该文件用于集中配置 pnpm 行为。
- **锁定文件**：使用 `pnpm-lock.yaml` 作为唯一可复现的依赖快照，提交到版本控制。
- **补丁机制**：采用与 `patch-package` 兼容的 `patches/` 目录 + `pnpm-workspace.yaml` 中的 `patchedDependencies` 字段对第三方库进行本地 diff 修补。
- **构建期依赖控制**：通过 `overrides`、`allowBuilds`、`minimumReleaseAgeExclude` 等 pnpm workspace 配置项精细控制依赖树与构建行为。

## 2. 关键文件

- `package.json`：声明所有运行时与开发时依赖、`overrides`、脚本入口。
- `pnpm-workspace.yaml`：定义 store 路径、`preferOffline`、`overrides`、`allowBuilds`、`minimumReleaseAgeExclude`、`patchedDependencies`。
- `pnpm-lock.yaml`：完整依赖锁定文件（由 pnpm 生成并随仓库提交）。
- `patches/style-mod@4.1.3.patch`：针对 CodeMirror 依赖 `style-mod` 的 CSP 兼容修补。
- `scripts/pnpm-resolver.mjs`：在启动脚本中按固定顺序探测 pnpm 可执行文件，要求版本严格等于 `11.7.0`。
- `electron.vite.config.ts` / `vite.renderer.config.ts`：Electron 主进程与渲染进程分别由 electron-vite/Vite 构建，依赖通过同一份 `package.json` 共享。

## 3. 架构与约定

### 3.1 单一 package.json + 多进程共享依赖
项目以 Electron 三进程（main / preload / renderer）组织代码，但仅维护一个顶层 `package.json`，所有依赖集中在一处声明。主进程、预加载脚本和渲染进程通过 `electron-vite build` 统一打包，不存在子模块各自管理依赖的情况。

### 3.2 依赖版本策略
- **精确版本 vs 范围**：运行时依赖大多使用精确版本号（如 `ai@6.0.226`、`electron@^42.2.0`、`zod@^4.3.6`），少数使用 `^` 允许小版本升级；开发依赖也多为精确或 `^` 范围。
- **强制覆盖**：通过 `overrides.fast-uri = "3.1.2"` 与 `overrides.postcss = "8.5.15"` 强制提升依赖树中冲突版本的解析结果。
- **workspace 级 override**：`pnpm-workspace.yaml` 中 `overrides.yauzl = "3.3.1"` 用于修复 `electron@42` → `extract-zip` → `yauzl@2` 在 Node ≥24.16 下的挂起问题，注释明确记录了原因。

### 3.3 构建期原生依赖白名单
`allowBuilds` 仅放行 `@swc/core`、`electron-winstaller`、`esbuild` 三个需要编译原生扩展的包，其余包禁止在 install 阶段执行 `node-gyp` 等构建流程，降低安装失败面。

### 3.4 最小发布年龄豁免
`minimumReleaseAgeExclude` 将 `@ai-sdk/gateway@3.0.150`、`@ai-sdk/provider-utils@4.0.39`、`ai@6.0.226` 从 npm 的最小发布年龄限制中排除，以便立即使用刚发布的 AI SDK 相关依赖。

### 3.5 离线优先与缓存位置
`storeDir: ~/.cache/rdc-agent/pnpm-store` 将 pnpm 全局存储迁移到项目用户目录，`preferOffline: true` 默认优先使用本地缓存，适合 CI 与团队协作场景。

### 3.6 补丁策略
`patches/style-mod@4.1.3.patch` 移除了 `root.head &&` 的前置判断，使 CodeMirror 在桌面 CSP 环境下改用 `adoptedStyleSheets` + `CSSStyleSheet` 注入样式。该补丁通过 `patchedDependencies.style-mod@4.1.3` 映射到具体版本，确保每次安装都应用相同修改。

### 3.7 pnpm 版本锁定
`scripts/pnpm-resolver.mjs` 定义了 `REQUIRED_PNPM = '11.7.0'`，并在候选列表中按以下顺序探测：
1. 与 Node 执行路径相邻的 `node_modules/pnpm/bin/pnpm.mjs`
2. `corepack pnpm`
3. 系统 PATH 中的 `pnpm` / `pnpm.cmd`
4. 特定 IDE 缓存路径下的 bundled pnpm
任何候选必须返回恰好 `11.7.0`，否则抛出错误。这保证了无论开发者环境如何，构建与安装都使用指定 pnpm 版本。

## 4. 约定与约束

| 规则 | 来源 | 说明 |
|---|---|---|
| 新增依赖必须在根 `package.json` 的 `dependencies` 或 `devDependencies` 中声明 | `package.json` | 仓库为单包结构，无子模块 manifest |
| 依赖版本变更需更新 `pnpm-lock.yaml` | `pnpm-lock.yaml` | 锁定文件提交至版本控制，保证可复现安装 |
| 第三方库行为不一致时使用 `patches/` + `patchedDependencies` 打补丁 | `pnpm-workspace.yaml` | 目前仅对 `style-mod@4.1.3` 使用此机制 |
| 不允许任意原生包在 install 时编译 | `pnpm-workspace.yaml` 的 `allowBuilds` | 仅放行 `@swc/core`、`electron-winstaller`、`esbuild` |
| 必须使用 pnpm `11.7.0` | `scripts/pnpm-resolver.mjs` + `package.json` 的 `packageManager` | 启动脚本会校验 pnpm 版本，不匹配则失败 |
| 依赖树中冲突版本可通过 `overrides` 强制提升 | `package.json` + `pnpm-workspace.yaml` | 已用于 `fast-uri`、`postcss`、`yauzl` |
| 新发布的 AI SDK 依赖可绕过最小发布年龄限制 | `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` | 仅列出显式豁免的包 |
| 依赖安装默认优先使用本地缓存 | `pnpm-workspace.yaml` 的 `preferOffline: true` | 减少网络请求，加速重复安装 |

## 5. 不适用场景说明

本仓库未使用 Go 模块（无 `go.mod`）、未使用 Ruby Gemfile、未使用 Python requirements/pipenv、未使用 Java Maven/Gradle，因此上述语言生态的依赖管理模式在此不适用。当前依赖管理完全围绕 pnpm + Node.js/Electron 生态展开。