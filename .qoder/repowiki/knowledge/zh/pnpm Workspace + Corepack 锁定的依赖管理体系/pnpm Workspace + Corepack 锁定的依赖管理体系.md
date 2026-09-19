---
kind: dependency_management
name: pnpm Workspace + Corepack 锁定的依赖管理体系
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - scripts/pnpm-resolver.mjs
    - scripts/check-repository-hygiene.mjs
    - electron-builder.json
---

## 1. 使用的系统与工具

- **包管理器**：pnpm（通过 `package.json` 的 `packageManager` 字段锁定版本为 `pnpm@11.7.0`，并通过 Node.js `engines.node >=22.13.0` 约束运行时）。
- **工作区**：根目录存在 `pnpm-workspace.yaml`，将本仓库作为 pnpm workspace 管理；store 路径被重定向到 `~/.cache/rdc-agent/pnpm-store`，避免污染默认全局 store。
- **Corepack / 本地候选解析**：`scripts/pnpm-resolver.mjs` 在脚本层实现“按优先级查找 pnpm”逻辑——优先使用与当前 Node 可执行文件相邻的 `node_modules/pnpm/bin/pnpm.mjs`，其次尝试 `corepack pnpm`、系统 PATH 中的 `pnpm`，最后回退到 Codex 运行时的缓存路径。要求精确匹配 `REQUIRED_PNPM = '11.7.0'`，否则调用 `fail(...)` 终止。
- **构建与打包**：Electron 应用通过 `electron-vite` 编译，产物输出到 `out/`；`electron-builder` 负责打包，且 `electron-builder.json` 中 `files` 白名单仅允许 `out/**/*`，并显式禁止打包 `scripts|node_modules|\.pnpm-store|pnpm-lock|\.npmrc`（见 `scripts/check-repository-hygiene.mjs` 第 167 行）。
- **无私有 npm registry**：仓库内未发现 `.npmrc`、`.pnpmrc`、`pnpm.config.*` 或任何 `registry=` / `@scope:registry=` 配置；所有依赖均声明于根 `package.json` 的 `dependencies` / `devDependencies`，未使用子包 `package.json`。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 唯一声明所有运行时与开发依赖、`overrides`、`engines`、`packageManager` 及全部 `scripts` |
| `pnpm-workspace.yaml` | 定义 storeDir、`preferOffline`、workspace-level `overrides`、`allowBuilds`、`minimumReleaseAgeExclude` |
| `pnpm-lock.yaml` | 由 pnpm 生成的完整依赖树锁定文件 |
| `scripts/pnpm-resolver.mjs` | 强制要求 pnpm 11.7.0 的可执行发现与版本校验逻辑 |
| `scripts/check-repository-hygiene.mjs` | 门禁脚本，禁止在操作文件中出现 `npm`/`npx` 命令，禁止向 electron-builder 打包清单加入 `node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc` |
| `electron-builder.json` | 指定 `electronDist` 为 `node_modules/electron/dist`，并以白名单方式限制打包产物 |

## 3. 架构与约定

- **单仓单 manifest**：整个仓库只有一个 `package.json`，不存在子模块 `package.json`，因此没有跨包 workspace 引用（如 `workspace:*`），所有第三方依赖集中在根级声明。
- **依赖提升与扁平化**：pnpm 默认行为生效，`node_modules` 位于仓库根目录并被 `.gitignore` 忽略；依赖树通过 `pnpm-lock.yaml` 固化。
- **transitive 依赖覆盖**：通过两处 `overrides` 协同控制传递依赖版本——
  - `package.json` 的 `overrides.fast-uri=3.1.2`、`overrides.postcss=8.5.15`；
  - `pnpm-workspace.yaml` 的 `overrides.yauzl=3.3.1`（注释说明是为修复 `electron@42 install.js -> extract-zip -> yauzl@2` 在 Node ≥24.16 下的挂起问题）。
- **构建期原生模块白名单**：`pnpm-workspace.yaml` 的 `allowBuilds` 仅放行 `@swc/core`、`electron-winstaller`、`esbuild`，其他含 `install.js`/`binding.gyp` 的原生包将被拒绝编译。
- **最小发布年龄豁免**：`minimumReleaseAgeExclude` 针对 `@ai-sdk/gateway@3.0.150`、`@ai-sdk/provider-utils@4.0.39`、`ai@6.0.226` 三个包跳过 pnpm 的最小发布年龄检查，用于在 CI/CD 中提前拉取刚发布的包。
- **离线优先**：`preferOffline: true` 使 pnpm 默认优先使用本地 store，减少网络波动对构建的影响。
- **严格的环境约束**：`engines.node >=22.13.0` 配合 `packageManager: pnpm@11.7.0`，确保开发者与 CI 使用匹配的 Node 与 pnpm 版本。

## 4. 约定与约束

- **禁止使用 npm/npx**：`scripts/check-repository-hygiene.mjs` 扫描所有受管源文件，若发现 `\bnpm\b|\bnpx\b` 即报错（第 157 行），强制团队统一使用 pnpm。
- **禁止将开发工件打入发行包**：`check-repository-hygiene.mjs` 校验 `electron-builder.json` 的 `files` 白名单不得包含 `scripts|node_modules|\.pnpm-store|pnpm-lock|\.npmrc`（第 167 行），保证最终安装包只包含 `out/**/*` 编译产物。
- **pnpm 版本必须精确匹配**：`scripts/pnpm-resolver.mjs` 中 `REQUIRED_PNPM = '11.7.0'`，解析器会逐一尝试候选并比对版本号，不匹配则 `fail(...)` 终止脚本。
- **依赖变更需更新 lockfile**：由于 `pnpm-lock.yaml` 存在于仓库且被构建流程使用，任何依赖升级都应提交更新后的 lockfile，以保证可重现安装。
- **无 vendoring 策略**：仓库未使用 `vendor/`、`third_party/` 等目录存放源码副本，也未配置私有 registry；所有第三方代码通过 pnpm store 与 lockfile 管理。
- **Node 原生模块编译受限**：只有 `allowBuilds` 中列出的包允许在 pnpm install 时触发原生编译，其余含 build 步骤的依赖会被拒绝，降低不可控的构建风险。

总体而言，该仓库采用“单 package.json + pnpm workspace + 严格 lockfile + 门禁脚本”的集中式依赖管理模式，通过 `overrides`、`allowBuilds`、`minimumReleaseAgeExclude` 和多个 `check-*` 脚本共同约束依赖来源、版本与构建行为，确保 Electron 桌面应用在多平台环境下的可重现性与安全性。