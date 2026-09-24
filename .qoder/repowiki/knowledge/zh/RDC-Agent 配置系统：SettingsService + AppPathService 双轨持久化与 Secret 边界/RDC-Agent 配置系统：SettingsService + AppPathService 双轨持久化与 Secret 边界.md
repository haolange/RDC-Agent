---
kind: configuration_system
name: RDC-Agent 配置系统：SettingsService + AppPathService 双轨持久化与 Secret 边界
category: configuration_system
scope:
    - '**'
source_files:
    - src/main/settings/SettingsService.ts
    - src/main/settings/settingsDefaults.ts
    - src/main/settings/settingsServiceHelpers.ts
    - src/main/settings/settingsSanitize.ts
    - src/main/settings/settingsProviderSanitize.ts
    - src/main/settings/SecretStorageService.ts
    - src/main/settings/README.md
    - src/main/runtime/AppPathService.ts
    - electron.vite.config.ts
    - package.json
---

## 1. 采用的方案

RDC-Agent 没有使用 `electron-store` 的默认行为（尽管它出现在 `package.json` 依赖中），而是自行实现了一套基于 JSON 文件的主进程配置系统，核心由两个服务组成：

- `src/main/settings/SettingsService.ts` — 应用设置、LLM Provider 连接、Agent 定义、权限、布局、外观等所有用户可配置项的加载、合并、校验、持久化入口。
- `src/main/runtime/AppPathService.ts` — 单例路径解析器，负责计算 user data root、project `.rdc-agent` 目录、内置资源根以及 `config.json` 等所有磁盘路径。

构建期配置通过 `electron.vite.config.ts` 中的 electron-vite 配置声明 main/preload/renderer 三个入口；打包产物入口在 `package.json` 的 `main: "out/main/index.js"`。运行时不依赖 `.env` 或环境变量注入框架，仅通过少量环境变量控制路径。

## 2. 关键文件

- `src/main/settings/SettingsService.ts` — 唯一对外暴露的 Settings 服务，导出单例 `settingsService`。
- `src/main/settings/settingsDefaults.ts` — `PersistedSettingsPayload` 结构、`SETTINGS_SCHEMA_VERSION = 8`、所有 DEFAULT_* 常量。
- `src/main/settings/settingsServiceHelpers.ts` — JSON 读写、schema version 断言、`rebuildPersistedSettings` / `normalizePersistedSettings` / `toRuntimeSettings` / `writeSettings`。
- `src/main/settings/settingsSanitize.ts` — 各子字段 sanitizer（window、sidebar、terminal、tooling、agentRuntime 等）。
- `src/main/settings/settingsProviderSanitize.ts` — Provider 归一化、secretRef 生成、OAuth 账户映射。
- `src/main/settings/SecretStorageService.ts` — 独立于 settings JSON 的 secret 存储（API key、OAuth bundle）。
- `src/main/settings/README.md` — 文档化的 provider catalog contract、secret boundary、plan/route boundary 与验证脚本清单。
- `src/main/runtime/AppPathService.ts` — `getUserRdcRoot()`、`getBuiltinAgentRuntimeRoot()`、`initializeRuntime()`、`getProjectRdcPaths()`。
- `electron.vite.config.ts` — electron-vite 三进程构建配置。
- `package.json` — `scripts` 中大量 `check:*` 质量门禁脚本，以及 `electron-builder` 打包配置入口。

## 3. 架构与约定

### 3.1 持久化格式与版本迁移

- 配置文件是位于用户目录下的 `config.json`（即 `AppPathService.getUserRdcRoot() + '/config.json'`）。
- 持久化结构为 `PersistedSettingsPayload`，顶层包含 `schemaVersion`、`appearance`、`layout`、`profile`、`llm.providers`、`tooling`、`agentRuntime`。
- `SETTINGS_SCHEMA_VERSION` 当前为 `8`；`assertPersistedSettingsSchemaVersion` 在读取时拒绝 `schemaVersion > SETTINGS_SCHEMA_VERSION` 的文件，抛出 `StorageSchemaError`。
- `rebuildPersistedSettings` 实现按 schema 版本的增量迁移逻辑（例如 schema 6 重置 chromeThemes、schema 7 移除 embedding、schema 8 提升 rdcCli timeoutMs 到 120000）。
- 写入采用原子替换：先写 `<path>.<pid>.tmp`，再 `fs.renameSync`，finally 清理临时文件；异步版本用 `randomUUID()` 后缀。

### 3.2 运行态 vs 持久态分离

`SettingsService.getAll()` 返回的是 `AppSettings`（运行态），而非直接返回持久化 payload。转换链路：

```
readJsonFile → rebuildPersistedSettings → normalizePersistedSettings → toRuntimeSettings
```

`toRuntimeSettings` 会额外执行：
- 从 `SecretStorageService` 水合 provider secret（`hydrateProviderSecrets`）。
- 调用 `agentManifestService.getSettings` 与 `routesFromDefinitions` 编译 agent routes。
- 通过 `executionProfileService.normalizeResourceCatalog` 注入 resource catalog。

因此，renderer-facing API（如 IPC `settings:get`）拿到的是已脱敏的 `AppSettings`，而主进程 runtime-facing API 才持有真实 secret。

### 3.3 Secret 边界

`src/main/settings/README.md` 明确定义了 secret boundary：

- `SettingsService` 只在主进程 runtime-facing 路径中通过 `SecretStorageService` 解析 credential。
- `settings:get` 返回的 provider entry 清空 `apiKey`。
- `settings:getProviderCatalog` 和 `/api/settings/providers/catalog` 不返回任何用户连接状态或 secret 引用。
- account provider 的 OAuth bundle 只通过 `ProviderAccountAuthService` 与 `SecretStorageService` 在主进程内流转。
- preflight 通过 `ProviderRuntimeCredentialService` 创建 opaque lease；adapter 没有 lease handle 必须 fail-closed，不得回读 Settings。

API key 与 OAuth token 不保存在 `config.json` 中，而是通过 `SecretStorageService` 以 `secretRef` 形式存储在 `appStatePaths.secretsPath`（即 userDataRoot/secrets）。Provider 条目只保留 `secretRef` 与 `authAccountIds`。

### 3.4 路径体系

`AppPathService` 维护三类路径：

| 类型 | 根位置 | 说明 |
|---|---|---|
| User RDC Paths | `process.env.RDC_AGENT_HOME || ~/.rdc-agent` | 用户级 agents/skills/mcp/hooks/policies/knowledge/memory |
| App State Paths | Electron `app.getPath('appData')` 或 `~/.config`（受 `RDC_AGENT_USER_DATA` 覆盖） | projects/sessions/tasks/traces/logs/secrets/profile |
| Project RDC Paths | `<projectRoot>/.rdc-agent` | 项目级隔离目录，含 plans/artifacts/inputs/replay |

`initializeRuntime()` 会在启动时递归创建所有目录；`initializeProjectRdc` 还会初始化 `.gitignore` 并追加 `replay/` 与 `replay.lock`。

### 3.5 环境变量

仓库中没有 `.env` 文件，运行时环境变量只有：

- `RDC_AGENT_HOME` — 覆盖用户数据根（`AppPathService.getUserRdcRoot()`）。
- `RDC_AGENT_USER_DATA` — 覆盖 Electron appData 根（`AppPathService.getUserDataRoot()`）。

构建期变量由 electron-vite 与 Node 进程提供，无自定义 `.env` 加载逻辑。

### 3.6 Provider Catalog 作为配置源

Provider 定义不是纯用户编辑的 JSON，而是来自共享 manifest 与用户配置的合并：

- 事实输入：`src/shared/provider-catalog/manifests/{identities,profiles,surfaces}/*.json`。
- 构建入口：`ProviderCatalogRegistry.listProviderSummaries()` 与 `loadProviderSurface(id)`。
- Settings UI 只消费 summary index，surface 详情按需异步加载。
- Catalog DTO 禁止包含 `apiKey`、`secretRef`、OAuth token、account label、plan label 等敏感字段（见 README 第 29 行）。

## 4. 约定与约束

**观察到的约定：**

- 所有用户可配置项都通过 `SettingsService.setAll(patch: AppSettingsPatch)` 提交，patch 中每个子字段都有对应的 sanitizer。
- 窗口布局有专用的快速写入路径 `persistWindowLayout` / `persistWindowLayoutAsync`，跳过 provider normalization 与 secret hydration，用于 window close / move / resize 高频场景。
- Provider 更新时，若 `authMode === 'api-key'` 且新 key 与旧 key 不同，会生成新的 `localAccountId` 并标记旧 `secretRef` 待删除（`deleteSecretsAfterCommit`）。
- Agent 定义与 Provider 定义分别通过 `SettingsAgentOps` 与 `SettingsProviderOps` 委托保存，支持 revision 冲突检测。
- 每次 `setAll` 后都会重新编译 agent routes（`compiledRoutesFromDefinitions`）并返回最新 `AppSettings`。

**被代码强制的规则：**

1. **向后兼容规则**：`assertPersistedSettingsSchemaVersion` 拒绝 `schemaVersion > SETTINGS_SCHEMA_VERSION` 的配置，升级时必须递增 `settingsDefaults.ts` 中的 `SETTINGS_SCHEMA_VERSION` 并在 `rebuildPersistedSettings` 中添加迁移分支。（来源：`settingsServiceHelpers.ts` 第 111–125 行）
2. **Secret 不落地规则**：`getLlmConfig()` 与 `getAll()` 返回的 provider 条目中 `apiKey` 始终为空字符串；真实 secret 仅通过 `SecretStorageService` 在主进程内访问。（来源：`SettingsService.ts` 第 452–481 行、`settingsServiceHelpers.ts` 第 370 行）
3. **Provider 白名单规则**：`rebuildPersistedSettings` 会移除非 catalog provider（`!isBuiltinProviderId(rawId)`）与 fixture provider（`isFixtureProvider(entry)`），只保留 catalog 中存在的 provider。（来源：`settingsServiceHelpers.ts` 第 187–231 行）
4. **Plan route fail-closed 规则**：Settings 生成或保存 Plan route 时，provider/model 不存在、未启用、未配置或不可用时，route 写为空值，不得静默回退到默认模型。（来源：`src/main/settings/README.md` 第 56 行）
5. **Catalog DTO 脱敏规则**：`settings:getProviderCatalog` 与 `/api/settings/providers/catalog` 不得返回 `apiKey`、`secretRef`、`hasStoredSecret`、OAuth token、account label、plan label、credential、password 或任何 secret-like 字段。（来源：`src/main/settings/README.md` 第 29 行）
6. **路径隔离规则**：User-level 与 project-level 资源严格分目录（`userRdcRoot` vs `<projectRoot>/.rdc-agent`），`AppPathService.initializeProjectRdc` 自动创建 `.gitignore` 并追加 `replay/`、`replay.lock`。（来源：`AppPathService.ts` 第 199–225 行）
7. **原子写入规则**：`writeSettings` / `writeSettingsAsync` 总是先写 `<path>.<pid>.tmp` 或 `<path>.<pid>.<uuid>.tmp`，再 rename，finally 清理临时文件。（来源：`settingsServiceHelpers.ts` 第 334–356 行）

**构建/打包配置：**

- electron-vite 配置在 `electron.vite.config.ts`，main 入口为 `src/main/index.ts`，worker 入口为 `src/main/workers/turnPreparationWorker.ts`，preload 入口为 `src/preload/index.ts`，renderer 入口为 `src/renderer/index.html`。
- `package.json.scripts` 中集中了全部质量门禁（`check:architecture`、`check:fidelity`、`check:provider-system`、`check:settings-agents` 等），并通过 `pnpm run check:gates` 串联执行。
- 打包使用 `electron-builder`，命令为 `pnpm dist` / `pnpm pack --dir`。

该配置系统没有引入外部配置库（如 dotenv、conf、configstore），完全基于 Node `fs` + JSON + 自定义 service 层实现，强调主进程内的 secret 隔离与 schema 版本迁移。