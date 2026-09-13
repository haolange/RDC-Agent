---
kind: configuration_system
name: RDC-Agent 配置系统：基于 JSON 持久化 + Electron safeStorage 的 SettingsService
category: configuration_system
scope:
    - '**'
source_files:
    - src/main/settings/SettingsService.ts
    - src/main/settings/settingsDefaults.ts
    - src/main/settings/settingsServiceHelpers.ts
    - src/main/settings/SecretStorageService.ts
    - src/main/settings/settingsSanitize.ts
    - src/main/settings/settingsProviderSanitize.ts
    - src/main/runtime/AppPathService.ts
    - src/main/settings/AgentManifestService.ts
    - src/main/settings/ExecutionProfileService.ts
    - src/main/settings/ProviderCatalogService.ts
---

## 1. 采用的方案

RDC-Agent 使用自研的 `SettingsService`（位于 `src/main/settings/SettingsService.ts`）作为唯一的应用级配置入口，底层以 **JSON 文件** 持久化用户设置，并通过 **Electron `safeStorage`** 加密存储敏感凭据。配置加载遵循“默认值 → 磁盘持久化 → 运行时注入”的分层模型，不依赖 `.env`、`.yaml`、`.toml` 等外部配置文件。

## 2. 关键文件与职责

- `src/main/settings/SettingsService.ts`：单例服务，提供 `initialize()` / `getAll()` / `setAll()` / `getLlmConfig()` 等 API，协调路径、默认值、清理、Provider 归一化与 Agent Manifest。
- `src/main/settings/settingsDefaults.ts`：定义 `SETTINGS_SCHEMA_VERSION = 7`、`PersistedSettingsPayload` 结构、所有默认值（appearance/layout/profile/tooling/agentRuntime）。
- `src/main/settings/settingsServiceHelpers.ts`：读写 JSON 配置（`readJsonFile` / `writeSettings`）、schema 版本校验（`assertPersistedSettingsSchemaVersion`）、迁移重建（`rebuildPersistedSettings`）、运行时装配（`toRuntimeSettings`）。
- `src/main/settings/SecretStorageService.ts`：将 provider API key / OAuth token 等写入 `<userData>/secrets/provider-secrets.json`，使用 `electron.safeStorage.encryptString` 加密，并以原子写（临时文件 + rename）+ `0o600` 权限 + Windows `icacls` 加固。
- `src/main/runtime/AppPathService.ts`：集中计算所有路径——用户根目录 `~/.rdx`（可被 `RDC_AGENT_HOME` 覆盖）、应用状态目录 `appData/state`、以及 `config.json`（即 settingsPath）。
- `src/main/settings/settingsSanitize.ts`、`settingsProviderSanitize.ts`：对每个字段执行白名单/格式清洗，保证写入数据始终合法。
- `src/main/settings/AgentManifestService.ts`、`ExecutionProfileService.ts`、`ProviderCatalogService.ts`：在 `toRuntimeSettings` 阶段把 Agent 定义、执行 profile、Provider catalog 合并进最终 `AppSettings`。

## 3. 架构与约定

### 3.1 分层加载顺序
1. **默认值**：`createDefaultPersistedSettings()` 提供完整骨架（appearance/layout/profile/tooling/agentRuntime/llm.providers）。
2. **磁盘读取**：从 `appPathService.getRuntimePaths().settingsPath`（即 `~/.rdx/config.json`）读 `PersistedSettingsPayload`；不存在则回退到默认值。
3. **Schema 校验**：`assertPersistedSettingsSchemaVersion` 拒绝 `schemaVersion > SETTINGS_SCHEMA_VERSION` 的配置，防止新版本二进制打开旧版配置。
4. **迁移重建**：`rebuildPersistedSettings` 按 schema 版本增量修复（如 schema 6 重置 chromeThemes、schema 7 移除 embedding 选择），并删除废弃 secret ref。
5. **Provider 归一化**：通过 `normalizeUserProviders` + Provider Catalog 校验，仅保留内置 catalog 中的 provider，剔除 fixture/non-catalog 条目。
6. **Secret 水合**：`hydrateProviderSecrets` 根据 `secretRef` 从 `SecretStorageService` 解密出明文 apiKey/OAuth token，注入到运行时 `AppSettings.llm.providers`。
7. **Agent Manifest 合并**：`agentManifestService.getSettings` 把全局指令、definitions、routes 合并进最终对象。

### 3.2 持久化策略
- 主配置：`~/.rdx/config.json`，通过 `writeSettings` / `writeSettingsAsync` 以 `<file>.<pid>.tmp` 临时文件 + `fs.renameSync` 原子写入，避免并发损坏。
- 窗口布局：提供 `persistWindowLayout` / `persistWindowLayoutAsync` 窄接口，跳过 Provider 归一化以提升关闭时性能。
- Secret 存储：`<userData>/secrets/provider-secrets.json`，每条记录形如 `{ encoding: 'safeStorage', payload: base64, updatedAt }`；写入后调用 `chmod 0o600` 并在 Windows 上尝试 `icacls` 限制为当前用户。
- 项目级资源：`AppPathService.getProjectRdxPaths` 为每个项目生成 `.rdx/{agents,skills,mcp,hooks,policies,knowledge,memory,inputs,artifacts}` 子目录，并在初始化时自动创建。

### 3.3 环境变量
- `RDC_AGENT_USER_DATA`：覆盖 Electron `app.getPath('appData')`，决定应用状态目录（含 secrets/logs/sessions）。
- `RDC_AGENT_HOME`：覆盖用户根目录 `~/.rdx`，用于测试或容器化部署。
- 其他路径均通过 `AppPathService` 派生，不在代码中硬编码绝对路径。

### 3.4 配置项域
`PersistedSettingsPayload` 将配置划分为以下互斥域：
- `appearance`：UI 主题、chrome 主题、侧边栏宽度等。
- `layout`：左右面板、终端高度、窗口位置。
- `profile`：昵称、头像路径。
- `tooling`：`rdxCli`、`rdxActions`、`codeInterpreter`、`shell` 等工具链配置。
- `agentRuntime`：权限模式（default/auto-review/full-access/custom）、可读/可写 roots、命令前缀黑白名单、上下文压缩阈值。
- `llm.providers`：LLM Provider 列表（不含明文密钥）。

## 4. 约定与约束

- **单一来源**：所有模块通过 `settingsService.getAll()` 获取 `AppSettings`，禁止直接读 `config.json`。
- **Schema 演进**：新增字段必须兼容旧版本；升级逻辑集中在 `rebuildPersistedSettings`，并通过 `SETTINGS_SCHEMA_VERSION` 控制。
- **敏感信息隔离**：`config.json` 中只存 `secretRef` 引用，明文永远由 `SecretStorageService` 经 `safeStorage` 解密后注入运行时；`setAll` 写入后会清空 `apiKey` 字段再落盘。
- **Provider 白名单**：非 catalog 内置的 provider 会在重建时被丢弃，防止任意 JSON 注入 LLM 路由。
- **原子写**：所有写操作使用临时文件 + rename，失败时清理 tmp 文件，避免半写配置。
- **路径不可变**：所有路径通过 `AppPathService` 计算，禁止业务代码拼接路径字符串。
- **安全降级**：若 `safeStorage.isEncryptionAvailable()` 为 false，`SecretStorageService` 抛出 `SecretStorageUnavailableError`，拒绝存储凭据。
- **Project RDX 目录契约**：项目 `.rdx` 下固定子目录名（agents/skills/mcp/hooks/policies/knowledge/memory/inputs/artifacts）由 `AppPathService.getProjectRdxPaths` 强制约定，新目录需在此处注册。
