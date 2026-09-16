---
kind: dependency_management
name: pnpm 工作区 + 锁定文件 + 构建期依赖治理（Electron 三进程工程）
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - electron-builder.json
    - scripts/pnpm-resolver.mjs
    - scripts/release/generate-sbom.mjs
    - scripts/check-repository-hygiene.mjs
---

## 1. 使用的系统/工具

- **包管理器**：pnpm（通过 `package.json#packageManager` 锁定为 `pnpm@11.7.0`，并通过 Node.js engines 要求 `node >=22.13.0`）。
- **工作区**：根目录存在 `pnpm-workspace.yaml`，将 pnpm store 重定向到 `~/.cache/rdc-agent/pnpm-store`，并启用 `preferOffline: true`。
- **锁定文件**：提交 `pnpm-lock.yaml`，所有依赖解析与安装均基于该锁文件。
- **构建/打包**：使用 `electron-vite` 编译 main/preload/renderer 三进程产物至 `out/`；使用 `electron-builder`（配置在 `electron-builder.json`）产出 Windows NSIS 安装包，输出目录为 `release/`。
- **SBOM**：提供 `scripts/release/generate-sbom.mjs`，从 `pnpm-lock.yaml` 的 `packages:` 段解析完整传递依赖图，生成 CycloneDX 1.5 格式的 `release/sbom.cdx.json` 及其 `.sha256` 校验文件，并在 metadata 中记录 git SHA、lockfile 路径及 lockfile sha256。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 声明应用名、版本、`dependencies`/`devDependencies`、`overrides`、`engines`、全部 npm scripts（dev/build/test/check:*） |
| `pnpm-workspace.yaml` | 自定义 store 路径、`preferOffline`、全局 `overrides`（如 `yauzl: 3.3.1`）、`allowBuilds`、`minimumReleaseAgeExclude` |
| `pnpm-lock.yaml` | 全仓库依赖锁定文件 |
| `electron-builder.json` | Electron 应用元信息、asar 打包策略、Windows NSIS 目标、额外资源（`resources/agent-runtime/hooks/**/*.mjs`） |
| `scripts/pnpm-resolver.mjs` | 启动脚本运行时探测 pnpm 可执行文件，要求精确版本 `11.7.0` |
| `scripts/release/generate-sbom.mjs` | 从锁文件生成 SBOM |
| `scripts/check-repository-hygiene.mjs` | 门禁脚本之一，检查 `electron-builder.json` 的 `files` 字段不得包含 `node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc` 等敏感/无关条目 |

## 3. 架构与约定

### 3.1 单仓 + 单一 package.json
仓库是单包结构（无子 workspace），所有依赖集中在根 `package.json`。`dependencies` 分为两类：
- **运行时依赖**：AI SDK（`ai`、`@ai-sdk/provider`、`gitlab-ai-provider`、`@jerome-benoit/sap-ai-provider-v2`、`@sap-ai-sdk/ai-api`）、渲染/编辑器（`mermaid`、`highlight.js`、`katex`、`react-markdown`、`@codemirror/*`、`@uiw/react-codemirror`）、PDF（`pdfjs-dist`）、状态管理（`zustand`、`zod`）、凭证（`aws4fetch`、`@aws-sdk/credential-providers`）等。
- **开发依赖**：`electron`、`electron-vite`、`vite`、`vitest`、`typescript`、`eslint`、`@swc/core` 等。

### 3.2 依赖版本治理
- **固定版本**：`dependencies` 与 `devDependencies` 大多使用精确版本号（如 `ai@6.0.226`、`electron@^42.2.0`、`electron-builder@^26.8.1`），由 pnpm 解析后写入 `pnpm-lock.yaml`。
- **覆盖（overrides）**：通过两处强制覆盖下游依赖——
  - `package.json#overrides`：`fast-uri@3.1.2`、`postcss@8.5.15`。
  - `pnpm-workspace.yaml#overrides`：`yauzl@3.3.1`（注释说明是为修复 `electron@42 install.js -> extract-zip -> yauzl@2 hangs on Node >=24.16`）。
- **最小发布年龄豁免**：`pnpm-workspace.yaml#minimumReleaseAgeExclude` 显式排除 `@ai-sdk/gateway@3.0.150`、`@ai-sdk/provider-utils@4.0.39`、`ai@6.0.226`，允许这些新发布包绕过 pnpm 的最小发布年龄保护。
- **原生模块构建白名单**：`pnpm-workspace.yaml#allowBuilds` 仅放行 `@swc/core`、`electron-winstaller`、`esbuild` 的原生编译，其余包禁止 build 钩子。

### 3.3 私有注册表 / 认证
仓库中**未检出任何 `.npmrc`、`NPM_TOKEN`、`registry=` 或私有 registry URL**。所有依赖均来自公共 npm 源（或通过 CI 环境变量注入）。`check-repository-hygiene.mjs` 明确禁止把 `.npmrc` 打入构建产物（见其正则匹配 `\.npmrc` 作为 forbidden entry）。

### 3.4 构建期依赖约束
- `scripts/pnpm-resolver.mjs` 在应用启动时按顺序探测：相邻 `node_modules` 中的 pnpm → corepack pnpm → PATH 中 pnpm → 特定缓存路径下的 pnpm，并要求版本恰好等于 `REQUIRED_PNPM = '11.7.0'`，否则抛出错误终止。
- `electron-builder.json` 指定 `win.target[0].arch = ["x64"]`，且 `forceCodeSigning: false`，仅打包 `out/**/*`、`resources/agent-runtime/**/*`、`resources/knowledge/**/*`，并将 `resources/agent-runtime/hooks/**/*.mjs` 以 asarUnpack 和 extraResources 形式单独释放。

## 4. 约定与约束

| 约定/约束 | 来源/证据 |
|---|---|
| 必须使用 pnpm 11.7.0 | `package.json#packageManager` 与 `scripts/pnpm-resolver.mjs#REQUIRED_PNPM` |
| Node 版本 ≥ 22.13.0 | `package.json#engines.node` |
| 依赖变更需更新 `pnpm-lock.yaml` | 仓库提交 `pnpm-lock.yaml`，SBOM 脚本以其为唯一数据源 |
| 禁止将 `node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc` 打入构建产物 | `scripts/check-repository-hygiene.mjs` 对 `electron-builder.json#files` 的正则断言 |
| 仅允许 `@swc/core`、`electron-winstaller`、`esbuild` 执行原生构建 | `pnpm-workspace.yaml#allowBuilds` |
| 某些 AI SDK 包可绕过最小发布年龄检查 | `pnpm-workspace.yaml#minimumReleaseAgeExclude` |
| 下游 `yauzl` 必须固定到 3.3.1 | `pnpm-workspace.yaml#overrides` 及注释 |
| 发布产物必须附带 CycloneDX SBOM | `scripts/release/generate-sbom.mjs` 被 `package.json#scripts.release:sbom` 暴露 |
| 运行时依赖与开发依赖严格分离 | 全部第三方包位于 `dependencies` 或 `devDependencies`，无混用 |

## 5. 总结

本仓库采用 **pnpm 工作区 + 锁定文件 + electron-vite/electron-builder** 的依赖管理体系：通过 `package.json` 声明依赖、`pnpm-lock.yaml` 锁定版本、`pnpm-workspace.yaml` 集中管控 overrides/allowBuilds/最小发布年龄豁免，并以自研脚本在启动期和发布期强制执行版本一致性、构建安全与 SBOM 合规。仓库未引入私有 npm registry 或 vendoring 机制，所有第三方代码均经公共源拉取并由锁文件固化。