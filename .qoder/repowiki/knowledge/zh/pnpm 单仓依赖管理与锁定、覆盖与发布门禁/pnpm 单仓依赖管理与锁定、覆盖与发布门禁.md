---
kind: dependency_management
name: pnpm 单仓依赖管理与锁定、覆盖与发布门禁
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - scripts/pnpm-resolver.mjs
    - electron-builder.json
    - scripts/check-release-config.mjs
    - scripts/check-repository-hygiene.mjs
---

## 1. 使用的系统/方法
- 包管理器：pnpm（通过 `package.json` 的 `packageManager: "pnpm@11.7.0"` 强制版本，配合 Corepack）。
- 仓库模式：单仓（root-level），无子 workspace；所有依赖集中在根 `package.json`。
- 构建工具链：electron-vite + vite（渲染进程）+ electron-builder（打包为 Windows NSIS 安装包）。
- 锁文件：根目录 `pnpm-lock.yaml`，用于锁定所有依赖树。
- 私有/缓存策略：`pnpm-workspace.yaml` 将 pnpm store 固定到 `~/.cache/rdc-agent/pnpm-store`，并开启 `preferOffline: true`，减少网络访问。

## 2. 关键文件
- `package.json`：声明 `dependencies` / `devDependencies`、`overrides`、`engines.node >=22.13.0`、以及全部脚本入口。
- `pnpm-workspace.yaml`：定义 store 路径、`overrides.yauzl=3.3.1`、允许 native build 的包列表、以及 `minimumReleaseAgeExclude` 白名单。
- `pnpm-lock.yaml`：完整依赖锁定快照。
- `scripts/pnpm-resolver.mjs`：在 CI/本地脚本中按候选顺序查找 `pnpm@11.7.0`（corepack → PATH → 特定缓存路径），找不到则失败。
- `electron-builder.json`：仅打包 `out/**/*`、`resources/agent-runtime/**/*`、`resources/knowledge/**/*`，并将 `hooks/**/*.mjs` 作为 `extraResources` 原样输出，不进入 asar。
- `scripts/check-release-config.mjs`：校验 `electron-builder.json` 必须声明 `appId`、`files`、`win` 平台，禁止 mac/linux 目标，禁止提交明文证书密码，要求签名环境变量仅在 release channel/tag 时生效。
- `scripts/check-repository-hygiene.mjs`：拒绝把 `node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc` 等纳入 `electron-builder.files`。

## 3. 架构与约定
- **集中式依赖声明**：所有运行时与开发期依赖都在根 `package.json` 中声明，没有子模块独立 manifest，避免多版本碎片化。
- **精确版本 + overrides**：生产依赖大多使用精确版本号（如 `ai@6.0.226`、`electron@^42.2.0`、`zod@^4.3.6`），并通过 `overrides.fast-uri=3.1.2`、`overrides.postcss=8.5.15` 以及 workspace 级 `overrides.yauzl=3.3.1` 修复上游兼容问题（注释说明是为解决 `electron@42 install.js -> extract-zip -> yauzl@2 hangs on Node >=24.16`）。
- **Node/pnpm 版本锁定**：`engines.node >=22.13.0` 与 `packageManager: pnpm@11.7.0` 双重约束；`scripts/pnpm-resolver.mjs` 在运行质量检查前会显式验证存在 `pnpm 11.7.0`，否则直接报错退出。
- **离线优先 + 固定 store**：`preferOffline: true` 与 `storeDir: ~/.cache/rdc-agent/pnpm-store` 保证团队共享同一份缓存位置，降低重复下载。
- **native addon 白名单**：`allowBuilds` 仅放行 `@swc/core`、`electron-winstaller`、`esbuild`，防止其他包意外触发原生编译。
- **最小发行面**：`electron-builder.json.files` 白名单只包含产物与资源；`check-repository-hygiene.mjs` 主动检测并拒绝把 `node_modules`、`.pnpm-store`、`pnpm-lock`、`.npmrc` 打入安装包。
- **发布安全门禁**：`check-release-config.mjs` 禁止在配置文件中硬编码私钥/证书密码，要求 Windows 代码签名凭据通过 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 环境变量注入，且仅在 `RDC_AGENT_RELEASE_CHANNEL=release` 或 tag 构建时强制校验。
- **SBOM/校验和**：通过 `release:sbom` 与 `release:checksums` 脚本生成软件物料清单与校验和，被 `check-release-config.mjs` 强制要求存在。

## 4. 约定与约束
- **pnpm 版本必须为 11.7.0**：由 `package.json.packageManager` 与 `scripts/pnpm-resolver.mjs.REQUIRED_PNPM` 共同约束，任何环境缺少该版本都会导致脚本失败。
- **Node 版本必须 ≥22.13.0**：由 `engines.node` 声明，配合 pnpm 的引擎检查生效。
- **禁止提交 `.npmrc` 到安装包**：`check-repository-hygiene.mjs` 明确禁止 `electron-builder.files` 中包含 `.npmrc`，避免泄露 registry/token。
- **禁止提交明文证书密码**：`check-release-config.mjs` 扫描 `electron-builder.json`，匹配 `BEGIN PRIVATE KEY`、`certificatePassword`、`cscKeyPassword`、`APPLE_APP_SPECIFIC_PASSWORD`、`sk-...`、`-----BEGIN CERTIFICATE-----` 等模式，命中即失败。
- **Windows-only 发布**：`check-release-config.mjs` 强制要求声明 `win` 平台，若出现 `mac` 或 `linux` 配置直接报错；同时禁止 `mac.notarize`。
- **不允许任意 native build**：只有 `@swc/core`、`electron-winstaller`、`esbuild` 在 `pnpm-workspace.yaml.allowBuilds` 中被显式允许，其余包安装时会被阻止。
- **依赖升级需通过 lockfile 锁定**：所有依赖版本以 `pnpm-lock.yaml` 为准，新增/更新依赖后应提交锁文件变更。
- **第三方包的最小发行年龄豁免**：`pnpm-workspace.yaml.minimumReleaseAgeExclude` 仅对 `@ai-sdk/gateway@3.0.150`、`@ai-sdk/provider-utils@4.0.39`、`ai@6.0.226` 三个包跳过最小发布年龄检查，其他包仍受默认策略约束。
- **Hook 资源不被 asar 压缩**：`electron-builder.json.asarUnpack` 与 `extraResources` 确保 `resources/agent-runtime/hooks/**/*.mjs` 以可执行脚本形式随安装包分发，供运行时加载。