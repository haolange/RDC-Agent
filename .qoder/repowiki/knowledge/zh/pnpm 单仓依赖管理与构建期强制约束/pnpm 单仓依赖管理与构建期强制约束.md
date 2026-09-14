---
kind: dependency_management
name: pnpm 单仓依赖管理与构建期强制约束
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

## 1. 使用的系统与方法

- **包管理器**：项目使用 **pnpm v11.7.0**（通过 `package.json` 的 `packageManager: "pnpm@11.7.0"` 与 Node.js engines `>=22.13.0` 锁定），并配合 `corepack`/本地 `node_modules/.bin/pnpm` 自动解析，详见 `scripts/pnpm-resolver.mjs`。
- **仓库形态**：根级单一 workspace，没有子 `package.json`；所有依赖集中在根 `package.json` 的 `dependencies` / `devDependencies` 中，Electron main、preload、renderer 共享同一份依赖树。
- **锁文件**：使用 `pnpm-lock.yaml`，禁止其他 lockfile（`package-lock.json`、`yarn.lock`、`npm-shrinkwrap.json`）存在。
- **构建工具链**：`electron-vite` + `vite` 负责 main/preload/renderer 三进程构建，`electron-builder` 负责打包为 NSIS 安装包。
- **私有注册表**：仓库内未发现 `.npmrc`、`NPM_REGISTRY`、`pnpm.registry` 等配置，也未出现 `@rdc-agent/` 私有 scope 包；依赖全部来自 npm 公共源。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 声明应用版本、`packageManager`、`engines`、全部运行时与开发依赖、`overrides` |
| `pnpm-workspace.yaml` | 定义 pnpm store 路径、`preferOffline`、全局 `overrides`、`allowBuilds`、`minimumReleaseAgeExclude` |
| `pnpm-lock.yaml` | 锁定所有依赖及其传递依赖的确切版本 |
| `scripts/pnpm-resolver.mjs` | 在 CI/脚本中按优先级查找 `pnpm@11.7.0` 可执行（adjacent → corepack → PATH → IDE 缓存） |
| `scripts/check-repository-hygiene.mjs` | 强制校验 pnpm 工作区配置、lockfile 存在性、`packageManager` 字段、禁止非 pnpm lockfile |
| `electron-builder.json` | 控制打包产物，显式排除 `node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc` |
| `electron.vite.config.ts` / `vite.renderer.config.ts` | Electron 多进程构建入口，不引入额外包管理逻辑 |

## 3. 架构与约定

### 3.1 依赖声明与版本策略

- 所有第三方库以**精确主版本号或固定版本**声明在根 `package.json` 中，例如 `ai@6.0.226`、`electron@^42.2.0`、`zod@^4.3.6`、`mermaid@^11.16.0` 等。
- 对已知冲突或上游 bug 使用 `overrides` 进行**集中覆盖**：
  - `fast-uri@3.1.2`、`postcss@8.5.15`（解决 Vite/electron 生态中的兼容问题）
  - `yauzl@3.3.1`（解决 electron@42 install.js → extract-zip → yauzl@2 在 Node ≥24.16 挂起的问题）
- 通过 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 允许特定新发布包跳过最小发布时间限制（`@ai-sdk/gateway@3.0.150`、`@ai-sdk/provider-utils@4.0.39`、`ai@6.0.226`），说明团队主动跟踪 AI SDK 生态的快速迭代。
- 通过 `allowBuilds` 显式允许 `@swc/core`、`electron-winstaller`、`esbuild` 的原生编译，避免被默认安全策略阻断。

### 3.2 安装与缓存策略

- `storeDir: ~/.cache/rdc-agent/pnpm-store`：将 pnpm store 固定在用户目录下的独立路径，避免与其他项目冲突。
- `preferOffline: true`：默认优先使用本地 store，减少网络请求。
- 启动器 `scripts/launch-rdc-agent.mjs` 会检查 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 是否存在，确保环境就绪。

### 3.3 构建期强制约束（repository hygiene）

`scripts/check-repository-hygiene.mjs` 在 CI 中强制执行以下规则：

1. **禁止其他 lockfile**：若存在 `package-lock.json`、`npm-shrinkwrap.json`、`yarn.lock` 则失败。
2. **必须存在** `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`。
3. **workspace 配置必须匹配**：
   - `storeDir` 必须是 `~/.cache/rdc-agent/pnpm-store`
   - `preferOffline` 必须为 `true`
   - `yauzl` 必须被 override 到 `3.3.1`
4. **`packageManager` 字段**必须为 `pnpm@11.7.0`。
5. **禁止在文档/操作文件中出现 `npm`/`npx`**：`README.md`、`.github/workflows/ci.yml`、`src/main/agent-runtime/permissions/AgentPermissionPolicy.ts`、`src/main/commands/builtins/test.ts`、`src/main/settings/README.md`、`docs/architecture/*`、`docs/workflows/*` 中不得包含 `npm` 或 `npx` 字样，防止运维漂移。
6. **electron-builder 白名单**：`files` 只能包含 `out/**/*` 及资源目录，禁止包含 `scripts`、`node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc`。

### 3.4 打包阶段隔离

`electron-builder.json` 仅打包 `out/**/*`、`resources/agent-runtime/**/*`、`resources/knowledge/**/*`，并通过 `asarUnpack` 单独保留 `resources/agent-runtime/hooks/**/*.mjs` 以便运行时加载。这意味着生产产物中**不包含任何 node_modules、pnpm 配置文件或源码**，依赖以已编译 JS 形式随应用分发。

## 4. 约定与约束总结

| 约定 | 来源/证据 |
|---|---|
| 统一使用 pnpm v11.7.0，禁止 npm/yarn 混用 | `package.json.packageManager` + `check-repository-hygiene.mjs` 正则校验 |
| 所有依赖集中在根 `package.json`，无子包 | 仓库结构 + 无子 `package.json` |
| 必须提交 `pnpm-lock.yaml`，禁止其他 lockfile | `check-repository-hygiene.mjs` 第 104–108 行 |
| pnpm store 路径固定为 `~/.cache/rdc-agent/pnpm-store` 且启用离线优先 | `pnpm-workspace.yaml` + 正则校验 |
| 通过 `overrides` 集中修复上游兼容性问题 | `package.json.overrides` + `pnpm-workspace.yaml.overrides` |
| 原生模块需显式 `allowBuilds` 才能编译 | `pnpm-workspace.yaml.allowBuilds` |
| 运行时代码不包含 `node_modules`、`.pnpm-store`、`.npmrc` | `electron-builder.json.files` + `check-repository-hygiene.mjs` 第 167 行 |
| 文档与 CI 中禁止出现 `npm`/`npx` 命令 | `check-repository-hygiene.mjs` 第 147–158 行 |
| 所有入口脚本必须经 `scripts/launch-rdc-agent.mjs` 启动 | `check-repository-hygiene.mjs` 第 120–131 行 |
