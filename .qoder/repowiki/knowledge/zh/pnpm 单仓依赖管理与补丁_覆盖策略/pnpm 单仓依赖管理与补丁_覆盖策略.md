---
kind: dependency_management
name: pnpm 单仓依赖管理与补丁/覆盖策略
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - patches/style-mod@4.1.3.patch
    - .github/workflows/ci.yml
    - scripts/pnpm-resolver.mjs
---

## 1. 使用的系统与方法

- **包管理器**：pnpm（版本锁定在 `package.json` 的 `packageManager: "pnpm@11.7.0"`，CI 通过 `pnpm/action-setup@v4` 固定安装相同版本）。
- **仓库模式**：单仓 monorepo，使用 `pnpm-workspace.yaml` 声明 workspace；未拆分子 package，所有依赖集中在根 `package.json` 中声明。
- **Node 版本约束**：`engines.node >= 22.13.0`，CI 与本地均使用 Node 22.13.0。
- **构建工具链**：electron-vite + vite + electron-builder，依赖由 pnpm 统一解析。

## 2. 关键文件

- `package.json`：唯一依赖清单，分 `dependencies`（运行时）、`devDependencies`（构建/测试）、`overrides`（强制提升版本）。
- `pnpm-lock.yaml`：锁定的依赖树（由 CI 以 `--frozen-lockfile` 校验）。
- `pnpm-workspace.yaml`：workspace 全局配置，包括 store 路径、offline 偏好、`overrides`、`allowBuilds`、`minimumReleaseAgeExclude`、`patchedDependencies`。
- `patches/style-mod@4.1.3.patch`：对第三方库 `style-mod@4.1.3` 的 diff 补丁，由 pnpm patchedDependencies 机制应用。
- `.github/workflows/ci.yml`：CI 流程，固定 pnpm 版本并执行 `pnpm install --frozen-lockfile`。
- `scripts/pnpm-resolver.mjs`：自定义 pnpm resolver（用于脚本侧解析依赖），配合测试用例 `src/main/testing/pnpmResolver.test.ts` 验证行为。

## 3. 架构与约定

### 3.1 依赖来源与私有源

- 仓库中未发现 `.npmrc` / `.pnpmrc` / `registry=` / `@scope:` 等私有 npm registry 配置，也未见 `GOPRIVATE` 或 Go module proxy 配置。依赖全部来自公共 npm registry。
- 因此本仓库当前不依赖企业私有 npm registry；若未来引入私有包，需通过 `.npmrc` 或 pnpm config 配置认证。

### 3.2 版本管理策略

- **精确版本为主**：多数依赖使用 `^` 语义范围（如 `react ^18.2.0`、`typescript ^5.3.0`），但部分关键依赖使用精确版本（如 `ai 6.0.226`、`electron-store ^8.1.0` 中的 `uuid ^9.0.0` 等）。
- **transitive 依赖强制提升**：通过 `overrides.fast-uri = "3.1.2"` 和 `overrides.postcss = "8.5.15"` 强制提升两个传递依赖的版本，解决安全或兼容问题。
- **workspace 级 overrides**：`pnpm-workspace.yaml` 中额外 `overrides.yauzl = "3.3.1"`，修复 electron@42 → extract-zip → yauzl@2 在 Node ≥24.16 下的挂起问题。
- **最小发布年龄豁免**：`minimumReleaseAgeExclude` 放行了 `@ai-sdk/gateway@3.0.150`、`@ai-sdk/provider-utils@4.0.39`、`ai@6.0.226`，允许新发布的 AI SDK 包跳过 pnpm 的最小发布年龄保护。

### 3.3 原生模块构建白名单

`allowBuilds` 显式允许以下包从源码编译：`@swc/core`、`electron-winstaller`、`esbuild`。其他含原生代码的包默认禁止 build，避免意外触发耗时编译。

### 3.4 补丁策略

- 使用 pnpm 内置的 `patchedDependencies` 机制，将 `style-mod@4.1.3` 的修改放入 `patches/style-mod@4.1.3.patch`。
- 补丁原因注释说明：CodeMirror 必须在桌面 CSP 下使用 `Document` 上构造的 sheet，因此需要修补 style-mod 的样式注入逻辑。
- 该补丁随仓库提交，安装时自动 apply，无需手动操作。

### 3.5 依赖缓存与离线

- `storeDir: ~/.cache/rdc-agent/pnpm-store`：将 pnpm store 固定在用户目录下的专用路径，避免污染全局 store。
- `preferOffline: true`：优先使用本地缓存，减少网络请求。
- CI 通过 `pnpm/action-setup@v4` 缓存 pnpm store，加速构建。
- Windows 启动器脚本会断言实际 store 路径等于 `$HOME\.cache\rdc-agent\pnpm-store`，确保环境一致性。

### 3.6 可重复安装

- CI 始终使用 `pnpm install --frozen-lockfile`，拒绝任何与 `pnpm-lock.yaml` 不一致的变更。
- `packageManager` 字段锁定 pnpm 版本，保证不同开发者/CI 使用同一 pnpm。

## 4. 约定与约束

| 约定 | 来源/证据 |
|---|---|
| 必须使用 pnpm 11.7.0 | `package.json#packageManager` 与 CI `pnpm/action-setup@v4 with version: 11.7.0` |
| Node ≥ 22.13.0 | `package.json#engines.node` |
| 依赖变更必须更新 lockfile 且保持冻结 | CI 步骤 `pnpm install --frozen-lockfile` |
| 仅允许白名单原生模块编译 | `pnpm-workspace.yaml#allowBuilds` |
| 新增补丁需放在 `patches/<pkg>@<version>.patch` 并在 `patchedDependencies` 注册 | `pnpm-workspace.yaml#patchedDependencies` 及现有 `patches/` 目录 |
| 传递依赖冲突通过 `overrides` 集中解决 | `package.json#overrides` 与 `pnpm-workspace.yaml#overrides` |
| 新发布的 AI 相关包如需跳过最小发布年龄，需在 `minimumReleaseAgeExclude` 添加 | `pnpm-workspace.yaml#minimumReleaseAgeExclude` |
| 私有 npm registry 尚未配置 | 仓库中未发现 `.npmrc` / `.pnpmrc` / registry 配置 |

## 5. 总结

本项目采用 **pnpm 单仓 + 严格 lockfile + 补丁/覆盖集中化** 的依赖管理模式：所有依赖在根 `package.json` 声明，通过 `pnpm-workspace.yaml` 统一管理 store、构建白名单、补丁与版本覆盖，并由 CI 以 `--frozen-lockfile` 强制执行可重复安装。当前未接入私有 npm registry，第三方依赖通过官方 npm 源获取，必要时用 `overrides` 与 `patches` 修正传递依赖或上游行为。