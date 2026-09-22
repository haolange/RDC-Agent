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
    - scripts/pnpm-resolver.mjs
    - patches/style-mod@4.1.3.patch
---

## 1. 使用的系统与工具

- **包管理器**：pnpm（版本锁定为 `11.7.0`，通过 `package.json#packageManager` 与 `scripts/pnpm-resolver.mjs` 双重约束）。
- **工作区**：仓库根目录使用 `pnpm-workspace.yaml` 声明全局 store、offline 偏好、构建白名单与 patch/override 策略；当前仓库仅包含一个顶层 package，未拆分子 workspace，但保留了 workspace 配置以支持未来扩展。
- **锁文件**：`pnpm-lock.yaml` 作为唯一依赖快照，提交至版本库。
- **Node 引擎**：`engines.node >= 22.13.0`，配合 pnpm 11.x 要求。
- **打包**：Electron 应用通过 `electron-vite build` + `electron-builder` 产出，依赖在构建期由 pnpm 解析并写入 `out/`。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 声明运行时依赖 (`dependencies`)、开发依赖 (`devDependencies`)、`overrides`（强制升级 `fast-uri`、`postcss`），并通过 `scripts/*` 暴露质量门禁、启动、测试等命令。 |
| `pnpm-workspace.yaml` | 全局 pnpm 行为：store 路径 `~/.cache/rdc-agent/pnpm-store`、`preferOffline: true`、对 `yauzl@3.3.1` 的 `overrides`、允许编译原生模块的白名单 (`@swc/core`、`electron-winstaller`、`esbuild`)、`minimumReleaseAgeExclude` 跳过 ai-sdk 新发布冷却期、`patchedDependencies` 指向 `patches/style-mod@4.1.3.patch`。 |
| `pnpm-lock.yaml` | 完整依赖树与子依赖版本的确定性快照。 |
| `scripts/pnpm-resolver.mjs` | 启动脚本在运行前按优先级查找 pnpm 可执行文件（相邻 node_modules → corepack → PATH），校验其版本必须等于 `REQUIRED_PNPM = '11.7.0'`，否则抛出错误。 |
| `patches/style-mod@4.1.3.patch` | 针对 CodeMirror 依赖的 `style-mod@4.1.3` 的本地 diff，移除对 `root.head` 的存在性判断，使其能在 Electron CSP 环境下使用 `adoptedStyleSheets`。 |
| `.gitignore` / `check-repository-hygiene.mjs` | 将 `node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc` 排除出发布产物，防止把依赖缓存或 npm 配置打入安装包。 |

## 3. 架构与约定

### 3.1 单一来源声明
所有第三方依赖统一集中在根 `package.json` 的 `dependencies` / `devDependencies` 中声明，没有子包级别的 manifest，也没有 vendoring 目录。依赖图由 pnpm 解析并以 `pnpm-lock.yaml` 固化。

### 3.2 版本管理策略
- **精确版本 vs 范围**：生产依赖大多使用精确主版本号（如 `ai@6.0.226`、`electron@^42.2.0`、`zod@^4.3.6`），开发依赖同样采用 `^` 范围以便获取小版本修复。
- **强制覆盖 (`overrides`)**：在 `package.json` 中对 `fast-uri`、`postcss` 进行强制覆盖；在 `pnpm-workspace.yaml` 中对 `yauzl@3.3.1` 进行覆盖，解决 electron@42 → extract-zip → yauzl@2 在 Node ≥24.16 下挂起的问题。
- **补丁机制**：通过 `pnpm-workspace.yaml#patchedDependencies` 将 `style-mod@4.1.3` 映射到 `patches/style-mod@4.1.3.patch`，遵循 pnpm 的 patch-package 兼容格式，使该补丁在每次安装时自动应用。
- **最小发布年龄豁免**：`minimumReleaseAgeExclude` 排除了 `@ai-sdk/gateway`、`@ai-sdk/provider-utils`、`ai` 的新发布冷却期，使这些高频更新的 AI SDK 能立即被拉取。

### 3.3 构建环境约束
- `allowBuilds` 白名单只允许 `@swc/core`、`electron-winstaller`、`esbuild` 三个需要编译原生代码的包执行 install 钩子，其余包禁止构建，降低 CI 依赖风险。
- `preferOffline: true` 鼓励离线安装，适合 CI 缓存场景。
- Store 固定到 `~/.cache/rdc-agent/pnpm-store`，避免多项目互相污染。

### 3.4 运行时入口对 pnpm 的依赖
`scripts/launch-rdc-agent.mjs` 通过 `import { resolvePnpm } from './pnpm-resolver.mjs'` 在启动阶段验证 pnpm 版本，确保开发者/CI 环境与 `packageManager` 字段一致。失败时会列出已检查到的候选及其版本。

## 4. 约定与约束

| 约定 | 说明 | 依据 |
|---|---|---|
| 新增依赖必须加到根 `package.json` | 仓库无子 package，所有依赖集中声明 | `package.json` 结构 |
| 禁止将 `node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc` 打入发布包 | 发布产物不得包含依赖缓存或 npm 配置 | `scripts/check-repository-hygiene.mjs` 中的正则过滤 |
| 原生模块安装需显式允许 | 只有 `@swc/core`、`electron-winstaller`、`esbuild` 可执行构建脚本 | `pnpm-workspace.yaml#allowBuilds` |
| 第三方库行为变更通过 patch 而非 fork | 对 `style-mod` 的修改以 diff 形式提交到 `patches/` | `pnpm-workspace.yaml#patchedDependencies` |
| pnpm 版本必须严格匹配 | 启动器会拒绝非 `11.7.0` 的 pnpm | `scripts/pnpm-resolver.mjs` + `package.json#packageManager` |
| 依赖更新应走 lockfile 变更 | 所有版本锁定在 `pnpm-lock.yaml`，不手动编辑 | pnpm 工作流惯例 |
| 私有仓库/认证 | 仓库中未发现 `.npmrc`、`NPM_TOKEN`、`NPM_REGISTRY` 等配置；依赖均来自公共 registry | 搜索结果为空 |

## 5. 总结

该仓库采用 **pnpm 单仓 + 锁文件 + 工作区级 overrides/patches** 的依赖管理模式：所有第三方依赖在根 `package.json` 声明，通过 `pnpm-lock.yaml` 锁定版本，借助 `pnpm-workspace.yaml` 集中管理覆盖、补丁和构建白名单，并用自定义的 `scripts/pnpm-resolver.mjs` 在启动时强制校验 pnpm 版本。这种设计保证了 Electron 应用在多平台下的依赖一致性，同时通过 `allowBuilds` 和 `minimumReleaseAgeExclude` 精细控制原生构建与新包拉取行为。