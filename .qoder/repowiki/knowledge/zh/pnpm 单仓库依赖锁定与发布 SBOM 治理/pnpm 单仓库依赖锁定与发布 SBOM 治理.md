---
kind: dependency_management
name: pnpm 单仓库依赖锁定与发布 SBOM 治理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - scripts/pnpm-resolver.mjs
    - scripts/check-repository-hygiene.mjs
    - scripts/release/generate-sbom.mjs
    - electron-builder.json
    - DESIGN.md
---

## 1. 使用的系统/工具
- 包管理器：pnpm 11.7.0（通过 `package.json` 的 `packageManager` 字段声明，并由 `scripts/pnpm-resolver.mjs` 在启动脚本中强制校验版本）。
- 锁文件：仅允许 `pnpm-lock.yaml`；仓库卫生检查会主动拒绝 `package-lock.json`、`npm-shrinkwrap.json`、`yarn.lock`。
- 构建/打包：electron-vite + electron-builder，产物输出到 `release/`，仅 Windows NSIS 安装包。
- 运行时 Node：要求 `>=22.13.0`，由 `package.json.engines` 约束。

## 2. 关键文件
- `package.json`：声明所有 `dependencies` / `devDependencies`、`overrides`（`fast-uri`、`postcss`）、`scripts` 入口统一走 `scripts/launch-rdc-agent.mjs`。
- `pnpm-workspace.yaml`：固定 pnpm store 路径为 `~/.cache/rdc-agent/pnpm-store`，开启 `preferOffline: true`，并通过 `overrides.yauzl=3.3.1` 修复 Electron 42 在 Node ≥24.16 下的挂起问题；`minimumReleaseAgeExclude` 放行特定 `@ai-sdk/*` 包。
- `pnpm-lock.yaml`：唯一被允许的锁文件，SBOM 生成器以其完整传递依赖图为输入。
- `scripts/pnpm-resolver.mjs`：按优先级查找本地 `node_modules/.bin/pnpm`、Corepack、PATH 中的 pnpm，并校验版本必须等于 `REQUIRED_PNPM='11.7.0'`。
- `scripts/check-repository-hygiene.mjs`：以正则断言 `pnpm-workspace.yaml` 的 `storeDir`、`preferOffline`、`yauzl` override；禁止其他 lockfile；要求根目录存在 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`。
- `electron-builder.json`：定义应用 ID、产物目录、asarUnpack（`resources/agent-runtime/hooks/**/*.mjs`）、extraResources、Windows NSIS 签名等。
- `scripts/release/generate-sbom.mjs`：从 `pnpm-lock.yaml` 解析全部 packages 段，生成 CycloneDX 1.5 SBOM（`release/sbom.cdx.json`）及 `.sha256`，并在 metadata 中记录 git SHA 与 lockfile digest。
- `DESIGN.md`：明确“发布面是 Windows-only”、“SBOM 由完整 `pnpm-lock.yaml` 传递依赖图生成”。

## 3. 架构与约定
- **单一 pnpm 工作区**：仓库不使用多 package workspace 子项目，所有依赖集中在根 `package.json`；workspace 配置仅用于全局 store 与 overrides。
- **依赖版本管理策略**：生产依赖使用精确版本号（如 `ai@6.0.226`、`electron@^42.2.0` 等），并通过 `overrides` 强制覆盖下游冲突依赖（`fast-uri`、`postcss`、`yauzl`）。对 AI SDK 相关包通过 `minimumReleaseAgeExclude` 放宽最小发布时间限制，以便 CI 拉取刚发布的依赖。
- **安装与缓存隔离**：pnpm store 固定在每用户目录 `~/.cache/rdc-agent/pnpm-store`，避免污染项目磁盘；`preferOffline: true` 优先使用本地缓存。
- **启动即校验**：`scripts/launch-rdc-agent.mjs` 通过 `resolvePnpm()` 找到正确版本的 pnpm，并以 `--version` 比对；缺失或版本不符时直接失败，确保开发/CI 环境一致。
- **构建产物白名单**：`electron-builder.json` 的 `files` 仅包含 `out/**/*`、`resources/agent-runtime/**/*`、`resources/knowledge/**/*`，且显式排除 `node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc`（由 hygiene 检查断言）。
- **可追溯发布**：SBOM 脚本读取 `pnpm-lock.yaml` 全文计算 sha256，写入 `metadata.properties` 风格的属性（gitSha、lockfile、lockfileSha256、platform），并输出同目录 `.sha256` 校验文件。

## 4. 约定与约束（描述性 + 规则来源）
- **只允许 pnpm 作为包管理器**：`check-repository-hygiene.mjs` 检测并拒绝 `package-lock.json`、`npm-shrinkwrap.json`、`yarn.lock`；同时要求 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml` 必须存在。
- **pnpm 版本必须为 11.7.0**：`package.json.packageManager` 必须等于 `pnpm@11.7.0`；`scripts/pnpm-resolver.mjs` 在运行期再次校验，不匹配则报错。
- **Node 版本必须 ≥22.13.0**：由 `package.json.engines.node` 声明，README 也强调该契约。
- **pnpm store 路径不可变更**：hygiene 检查用正则强制 `storeDir: ~/.cache/rdc-agent/pnpm-store`。
- **Electron 兼容 override 不可移除**：`yauzl: 3.3.1` 的 override 被 hygiene 检查硬编码断言，用于修复 Electron 42 在 Node ≥24.16 下挂起的问题。
- **构建脚本必须经共享 launcher**：`check-repository-hygiene.mjs` 将 `start`、`dev`、`start:human`、`start:human:dev`、`start:agent-browser`、`start:agent-browser:dev`、`smoke:agent-browser` 等脚本命令与 `scripts/launch-rdc-agent.mjs` 的调用形式做精确字符串匹配，不允许绕过。
- **electron-builder 配置集中化**：`package.json` 不得有 `build` 字段，所有构建配置必须在 `electron-builder.json`；其 `files` 列表不得包含 `scripts`、`node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc`。
- **私有注册表/认证**：仓库未检出 `.npmrc`、`NPM_REGISTRY`、`NPM_TOKEN` 等配置；依赖均从 npm 公共源获取，无私有 registry 或 GOPRIVATE 类机制。
- **Agent Hook 资源不被打包进 asar**：`asarUnpack` 显式保留 `resources/agent-runtime/hooks/**/*.mjs`，并通过 `extraResources` 复制到 `agent-runtime/hooks`，使 Agent 可在运行时动态加载这些 mjs hook。
- **SBOM 完整性门槛**：`generate-sbom.mjs` 在解析到的组件少于 50 个时直接退出，防止误用部分安装的 lockfile 生成不完整 SBOM。