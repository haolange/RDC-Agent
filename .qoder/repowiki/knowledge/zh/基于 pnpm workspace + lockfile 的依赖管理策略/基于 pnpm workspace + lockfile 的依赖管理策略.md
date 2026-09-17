---
kind: dependency_management
name: 基于 pnpm workspace + lockfile 的依赖管理策略
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - scripts/pnpm-resolver.mjs
    - electron-builder.json
    - .gitignore
    - scripts/check-repository-hygiene.mjs
---

## 1. 使用的系统/工具

- **包管理器**：pnpm（通过 `package.json` 的 `packageManager` 字段声明版本为 `pnpm@11.7.0`，并通过 Node.js `engines.node >=22.13.0` 约束运行环境）。
- **工作区**：根目录存在 `pnpm-workspace.yaml`，但当前仓库是单根项目（无 `packages/` 子工作区），workspace 配置主要用于集中控制 store、overrides 与构建开关。
- **锁定文件**：使用 `pnpm-lock.yaml` 作为唯一权威依赖锁定文件；`.gitignore` 中仅忽略 `node_modules/`，lockfile 与 store 均纳入版本控制。
- **打包产物**：通过 `electron-builder` 将 `out/**/*`、`resources/agent-runtime/**/*`、`resources/knowledge/**/*` 打包进 NSIS 安装包，并显式 `asarUnpack` 钩子脚本（`*.mjs`）以便运行时可写/可执行。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 声明所有生产/开发依赖、`overrides`、`scripts`（dev/build/pack/dist/test 等） |
| `pnpm-workspace.yaml` | 自定义 pnpm store 路径、全局 `overrides`、允许 native build 的包、最小发布年龄豁免 |
| `pnpm-lock.yaml` | 完整依赖树锁定（含 transitive deps） |
| `scripts/pnpm-resolver.mjs` | 在 CI/本地脚本中按固定顺序探测 pnpm 可执行（corepack → PATH → 缓存 bundled pnpm），要求版本严格等于 `REQUIRED_PNPM = '11.7.0'` |
| `electron-builder.json` | 定义打包时包含的资源与 asar 解包规则 |
| `.gitignore` | 仅忽略 `node_modules/`，不忽略 lockfile |
| `scripts/check-repository-hygiene.mjs` | 校验提交内容不得包含 `scripts/node_modules/.pnpm-store/pnpm-lock/.npmrc` 等临时文件 |

## 3. 架构与约定

### 3.1 依赖声明方式
- 所有第三方依赖集中在根 `package.json` 的 `dependencies` / `devDependencies` 中，没有子包 `package.json`，因此不存在多包版本冲突问题。
- 对已知有安全或兼容问题的传递依赖使用顶层 `overrides` 强制升级：`fast-uri@3.1.2`、`postcss@8.5.15`。
- 针对 electron 安装脚本在 Node ≥24.16 下挂起的问题，在 `pnpm-workspace.yaml` 中用 `overrides.yauzl=3.3.1` 进行全局覆盖。

### 3.2 Store 与离线优先
- `pnpm-workspace.yaml` 将 pnpm store 重定向到 `~/.cache/rdc-agent/pnpm-store`，避免污染默认 store 位置。
- `preferOffline: true` 使 pnpm 默认优先使用本地缓存，减少网络请求。
- 该 store 路径被 `check-repository-hygiene.mjs` 列入禁止提交清单（正则匹配 `.pnpm-store`），确保依赖缓存不被入库。

### 3.3 构建期原生模块白名单
- `allowBuilds` 显式允许 `@swc/core`、`electron-winstaller`、`esbuild` 三个需要编译原生扩展的包参与构建，其余未列出的包若触发 `node-gyp` 构建将被拒绝。这是一种“白名单”式的构建安全策略。

### 3.4 pnpm 版本治理
- `package.json` 通过 `packageManager` 字段声明 `pnpm@11.7.0`，配合 Corepack 可在团队内统一版本。
- `scripts/pnpm-resolver.mjs` 提供 `resolvePnpm()` 函数，按以下候选顺序探测可用 pnpm：
  1) 与 Node 执行路径相邻的 `node_modules/pnpm/bin/pnpm.mjs`
  2) `corepack pnpm`
  3) PATH 中的 `pnpm` / `pnpm.cmd`
  4) 特定缓存路径下的 bundled pnpm
  任一候选版本不等于 `REQUIRED_PNPM` 即失败，从而保证构建/测试环境一致性。

### 3.5 发布最小版本豁免
- `minimumReleaseAgeExclude` 列出 `@ai-sdk/gateway@3.0.150`、`@ai-sdk/provider-utils@4.0.39`、`ai@6.0.226` 三个包，跳过其“新发布需等待最小发布时间”的限制，便于及时获取上游修复。

### 3.6 打包阶段资源隔离
- `electron-builder.json` 的 `files` 仅包含 `out/**/*` 与 `resources/**/*`，不会把 `node_modules/` 打入 asar。
- `asarUnpack` 将 `resources/agent-runtime/hooks/**/*.mjs` 排除出 asar，使其以真实文件形式存在于安装目录，供运行时 Hook 引擎加载和执行。
- `extraResources` 将 hooks 目录额外复制到 `agent-runtime/hooks`，满足 Hook 引擎的文件路径期望。

## 4. 约定与约束

| 约定/约束 | 来源/证据 |
|---|---|
| 必须使用 pnpm 11.7.0 进行安装与构建 | `package.json.packageManager` + `scripts/pnpm-resolver.mjs.REQUIRED_PNPM` |
| Node 版本不低于 22.13.0 | `package.json.engines.node` |
| 依赖变更必须反映在 `pnpm-lock.yaml`，且不得提交 `node_modules/`、`.pnpm-store/`、`.npmrc` | `.gitignore` + `scripts/check-repository-hygiene.mjs` 中的正则校验 |
| 新增需要 native build 的依赖需加入 `allowBuilds` 白名单 | `pnpm-workspace.yaml.allowBuilds` |
| 对传递依赖的安全/兼容修复通过 `overrides` 集中处理 | `package.json.overrides` + `pnpm-workspace.yaml.overrides` |
| 新发布的 AI SDK 相关包可通过 `minimumReleaseAgeExclude` 绕过冷却期 | `pnpm-workspace.yaml.minimumReleaseAgeExclude` |
| 打包产物不包含源码与依赖，仅包含编译输出与资源 | `electron-builder.json.files` 白名单 |
| Hook 脚本必须以真实文件形式存在（不在 asar 内） | `electron-builder.json.asarUnpack` + `extraResources` |

综上，该项目采用“单一根 package.json + pnpm workspace 集中配置 + 锁定文件 + 白名单构建 + 自定义 pnpm 解析器”的组合策略，在保证跨平台一致性的同时，对 Electron 生态的原生模块和运行时资源做了针对性约束。