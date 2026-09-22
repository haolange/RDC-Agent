---
kind: configuration_system
name: RDC-Agent 配置系统：基于 JSON 持久化 + Electron safeStorage 的 SettingsService 体系
category: configuration_system
scope:
    - '**'
source_files:
    - src/main/settings/SettingsService.ts
    - src/main/settings/settingsDefaults.ts
    - src/main/settings/settingsServiceHelpers.ts
    - src/main/settings/SecretStorageService.ts
    - src/main/settings/ExecutionProfileService.ts
    - src/main/runtime/AppPathService.ts
    - src/main/settings/AgentRuntimeConfigService.ts
    - electron-builder.json
---

## 1. 使用的系统与框架

- **Electron 主进程**：所有配置加载与持久化逻辑集中在 `src/main/settings/`，通过 `electron.app.getPath('appData')` 定位用户数据目录。
- **持久化格式**：应用设置以单文件 JSON 存储于用户目录下的 `config.json`（路径由 `AppPathService` 解析），Secrets 单独存放在 `secrets/provider-secrets.json`。
- **密钥加密**：使用 `electron.safeStorage`（平台原生安全存储）对 API Key、OAuth token 等敏感字段进行加密后落盘；若不可用则抛出 `SecretStorageUnavailableError`。
- **构建期资源注入**：`electron-builder.json` 将 `resources/agent-runtime/**/*` 打包进应用，并通过 `extraResources` 将 hooks `.mjs` 和品牌图标复制到可执行目录，供运行时按路径解析。

## 2. 核心文件与职责

| 文件 | 职责 |
|---|---|
| `src/main/settings/SettingsService.ts` | 唯一对外暴露的设置入口：初始化、读取、合并 patch、保存、Provider 连接管理、Agent 定义提交 |
| `src/main/settings/settingsDefaults.ts` | 定义 `PersistedSettingsPayload` 结构、`SETTINGS_SCHEMA_VERSION`、各模块默认值（appearance/layout/profile/tooling/agentRuntime） |
| `src/main/settings/settingsServiceHelpers.ts` | I/O 抽象：`readJsonFile`/`writeSettings`（原子写入）、`rebuildPersistedSettings`（schema 迁移）、`normalizePersistedSettings`、`toRuntimeSettings` |
| `src/main/settings/SecretStorageService.ts` | 凭据存储：创建/读取/删除/复制 secret ref，强制 `safeStorage` 加密，损坏文件 quarantine |
| `src/main/runtime/AppPathService.ts` | 统一解析用户目录 (`~/.rdc-agent`)、应用状态目录 (`appData/state`)、项目目录 (`.rdc-agent`)、内置 agent-runtime 根 |
| `src/main/settings/ExecutionProfileService.ts` | 根据 settings + agent manifest 合成运行时 profile（systemPrompt、provider/model、tool/skill/mcp allowlist） |
| `src/main/settings/AgentRuntimeConfigService.ts` | 读取 `resources/agent-runtime` 下 YAML front matter 声明的 Agent/Skill/MCP/Hook 清单 |
| `electron-builder.json` | 打包产物中保留 `resources/agent-runtime/**/*`，并额外拷贝 hooks `.mjs` 到 `agent-runtime/hooks` |

## 3. 架构与约定

### 3.1 分层模型

```
AppSettings (运行时视图) ← toRuntimeSettings() ← PersistedSettingsPayload (磁盘 JSON)
   ↑                        ↑
   normalizePersistedSettings() / rebuildPersistedSettings()
   ↑
   readJsonFile(settingsPath)
```

- **持久层**：`PersistedSettingsPayload`，仅含 `schemaVersion`、`appearance`、`layout`、`profile`、`llm.providers[]`、`tooling`、`agentRuntime`。不包含明文 `apiKey`。
- **运行时层**：`AppSettings`，在 `toRuntimeSettings` 中通过 `hydrateProviderSecrets` 把 secret ref 还原为明文，再注入 `agents`、`resourceCatalog`、`paths` 等计算字段。
- **默认值层**：`settingsDefaults.ts` 提供每个子域的默认对象，任何缺失字段都通过 `sanitize*` 函数回填。

### 3.2 Schema 版本演进

- `SETTINGS_SCHEMA_VERSION = 7`，每次变更需递增并在 `rebuildPersistedSettings` 中实现迁移逻辑。
- `assertPersistedSettingsSchemaVersion` 拒绝比当前版本更高的旧配置文件，抛出 `StorageSchemaError`。
- 已知迁移：schema 6 重置 `appearance.chromeThemes`；schema 7 移除已废弃的 `embedding` 字段。

### 3.3 原子写入与幂等性

- `writeSettings` / `writeSettingsAsync` 先写 `<path>.<pid>.tmp`，再 `fs.renameSync` 覆盖目标，失败时清理临时文件。
- Secret 写入同样使用 tmp+rename，并调用 `applySecretFileMode` 设置 `0o600`，Windows 上额外通过 `icacls` 限制为当前用户。
- `initializeRuntime()` 会一次性 `mkdir -p` 所有需要的目录（userRdcRoot、agents、skills、mcp、hooks、policies、knowledge、memory、state、projects、sessions、tasks、traces、secrets、logs…），保证后续读写不抛 ENOENT。

### 3.4 配置来源分层

| 层级 | 来源 | 说明 |
|---|---|---|
| 内置 Agent/Skill/Prompt/Hook | `resources/agent-runtime/**` | 随应用打包，`AppPathService.getBuiltinAgentRuntimeRoot()` 优先从 `app.getAppPath()/resources` 或 `process.resourcesPath` 解析 |
| 用户扩展 Agent/Manifest | `~/.rdc-agent/agents` | 用户自定义，与内置合并 |
| Provider 目录 | `~/.rdc-agent/mcp` | MCP Server 注册 |
| 项目级配置 | `<project>/.rdc-agent/project.yaml` | 项目隔离的 agents/skills/mcp/policies/knowledge/memory/plans/artifacts |
| 用户设置 | `~/.rdc-agent/config.json` | 外观、布局、工具、权限、LLM Provider |
| 密钥 | `~/.config/<app>/secrets/provider-secrets.json` | 经 `electron.safeStorage` 加密 |
| 环境变量 | `RDC_AGENT_HOME`、`RDC_AGENT_USER_DATA` | 覆盖用户根与应用数据根 |

### 3.5 Provider 配置流程

1. `SettingsService.setAll(patch)` 接收 `AppSettingsPatch`。
2. 对每个 provider：若 `authMode === 'api-key'` 且 `apiKey` 变化 → 生成新 `secretRef`（含 `createLocalAccountId()`），写入 `SecretStorageService`，标记旧 ref 待删除。
3. 通过 `normalizeUserProviders` 结合 `ProviderCatalogService` 校验 provider id 必须来自 catalog，非 catalog 条目被丢弃。
4. 最终持久化的 providers 列表中 `apiKey` 字段始终清空，仅保留 `secretRef`。
5. 读取时 `getLlmConfig()` 按 provider 的 `authMode` 决定从 `secretStorageService.getSecret(secretRef)` 还是 OAuth 账户刷新管理器获取凭证。

## 4. 约定与约束

- **禁止直接读写 JSON**：所有设置 I/O 必须经过 `SettingsService`，窗口布局等高频写入走专用的 `persistWindowLayout` / `persistWindowLayoutAsync` 窄接口，跳过 provider 归一化以提升性能。
- **Secret 不得出现在持久化 payload**：`setAll` 在构造 `nextPersisted` 时将 `providers[].apiKey` 置空；`rebuildPersistedSettings` 也会对所有 provider 清空 `apiKey`。
- **Secret 文件损坏即 quarantine**：`SecretStorageService.readSecretMap` 解析失败会把原文件重命名为 `*.corrupt-<timestamp>` 并抛出 `SecretStoreCorruptError`，不会静默降级。
- **schemaVersion 只升不降**：`assertPersistedSettingsSchemaVersion` 对高于 `SETTINGS_SCHEMA_VERSION` 的文件直接抛错，防止回退场景破坏数据。
- **路径解析集中化**：所有路径通过 `AppPathService` 派生，用户根可通过 `RDC_AGENT_HOME` 覆盖，应用数据根可通过 `RDC_AGENT_USER_DATA` 覆盖，测试环境通过 `process.env.VITEST` 绕过部分安全限制。
- **构建产物路径约定**：`electron-builder.json` 要求 `resources/agent-runtime/hooks/**/*.mjs` 不被 asar 压缩（`asarUnpack`），并以 extraResource 形式复制到 `agent-runtime/hooks`，以便运行时按 `AppPathService.getBuiltinHooksPath()` 动态加载。
- **项目 .gitignore 模板**：`initializeProjectRdc` 自动写入包含 `inputs/`、`artifacts/`、`memory/`、`runtime/`、`replay/`、`replay.lock` 的 gitignore，确保项目内生成的 RDC 中间产物不被提交。
- **Provider 必须来自 catalog**：`rebuildPersistedSettings` 中 `!isBuiltinProviderId(rawId)` 的 provider 会被丢弃并记录 fix 日志，避免任意字符串作为 provider id。
- **Agent Runtime 权限模式受控**：`VALID_PERMISSION_MODES = ['default','auto-review','full-access','custom']`，超出此集合的值会在 sanitize 阶段被丢弃。

## 5. 与其他子系统交互

- `AgentManifestService`：负责用户自定义 Agent 定义的 CRUD 与全局指令持久化。
- `ProviderCatalogService`：扫描内置与用户目录中的 provider 定义，用于校验与补充 capabilities。
- `EffectiveModelResolver` / `RequestPlanner`：消费 `AppSettings.llm.providers` 做模型路由与请求规划。
- `HookEngine`：加载 `resources/agent-runtime/hooks` 与 `~/.rdc-agent/hooks` 中的 hook 脚本。
- `ShellResolver`：当 `tooling.shell.executable` 变更时通过 `clearCache()` 失效缓存。
- `ExecutionProfileService`：将 settings + agent manifest 合成为 `EffectiveAgentRuntimeConfig`，驱动 agent 运行时。

该配置系统的核心设计是：**JSON 持久化承载用户偏好与 Provider 元信息，Electron safeStorage 承载明文密钥，`SettingsService` 作为唯一编排者负责 schema 迁移、sanitization、归一化与生命周期管理。**