---
kind: configuration_system
name: RDC-Agent 配置系统：JSON 持久化 + Electron safeStorage 密钥管理 + 多源资源目录编排
category: configuration_system
scope:
    - '**'
source_files:
    - src/main/settings/SettingsService.ts
    - src/main/settings/settingsDefaults.ts
    - src/main/settings/settingsServiceHelpers.ts
    - src/main/settings/SecretStorageService.ts
    - src/main/runtime/AppPathService.ts
    - src/main/settings/ExecutionProfileService.ts
    - src/main/settings/AgentRuntimeConfigService.ts
    - src/main/settings/settingsSanitize.ts
    - src/main/settings/settingsProviderSanitize.ts
    - src/main/settings/ProviderCatalogService.ts
    - src/main/settings/EffectiveModelResolver.ts
    - src/main/settings/compiledAgentRoutes.ts
---

## 1. 整体方案

RDC-Agent 的配置系统由三部分组成：
- **应用设置（AppSettings）**：通过 `src/main/settings/SettingsService.ts` 以 JSON 文件形式持久化到用户目录，负责 UI 外观、窗口布局、工具链、Agent 运行时权限、LLM Provider 元数据等。
- **密钥存储**：通过 `src/main/settings/SecretStorageService.ts` 使用 Electron `safeStorage` 加密后写入 `secrets/provider-secrets.json`，仅保存引用（secretRef），明文不出现在 settings 文件中。
- **运行时路径与资源目录**：通过 `src/main/runtime/AppPathService.ts` 统一计算 user/project/appState 三类路径，并自动创建目录；同时扫描 `resources/agent-runtime/skills`、`userRdxRoot/skills`、`projectRdxRoot/skills` 以及 MCP `.mcp.json` 描述符，形成可叠加的资源目录。

没有发现 `.env`、`.yaml`、`.toml`、`application.properties` 等外部配置文件加载逻辑；所有“配置”最终都收敛为 JSON 持久化 + 文件系统目录约定。

## 2. 关键文件与职责

| 文件 | 职责 |
|---|---|
| `src/main/settings/SettingsService.ts` | 单例 `settingsService`，提供 `initialize/getAll/setAll/getLlmConfig/saveProviderConnection` 等入口，协调 sanitize、normalize、secret、agent manifest、execution profile。 |
| `src/main/settings/settingsDefaults.ts` | 定义 `SETTINGS_SCHEMA_VERSION = 7`、`PersistedSettingsPayload` 结构、`DEFAULT_*` 默认值（appearance/layout/profile/tooling/agentRuntime）。 |
| `src/main/settings/settingsServiceHelpers.ts` | 读写 JSON 的 `readJsonFile/readJsonFileAsync/writeSettings/writeSettingsAsync`、schema version 校验 `assertPersistedSettingsSchemaVersion`、迁移 `rebuildPersistedSettings`、归一化 `normalizePersistedSettings/toRuntimeSettings`。 |
| `src/main/settings/SecretStorageService.ts` | 基于 Electron `safeStorage` 的密钥存取，文件 `secrets/provider-secrets.json`，支持 `createProviderSecretRef/createProviderOAuthSecretRef/createProviderAccountSecretRef/createProviderConnectionSecretRef` 等命名规范。 |
| `src/main/runtime/AppPathService.ts` | 计算 `userRdxRoot`（受 `RDC_AGENT_HOME` 覆盖）、`appData`（受 `RDC_AGENT_USER_DATA` 覆盖）、内置 agent-runtime 根、项目 `.rdx` 目录，并在 `initializeRuntime` 中递归创建所有目录。 |
| `src/main/settings/ExecutionProfileService.ts` | 根据当前 `AppSettings` 和 Agent 定义生成 `EffectiveAgentRuntimeConfig`，并产出诊断信息。 |
| `src/main/settings/AgentRuntimeConfigService.ts` | 扫描 skills（`SKILL.md` + YAML front matter）与 MCP 描述符（`.mcp.json`），按 builtin/user/project 三层合并，并通过 `scopedResourceResolver` 去重。 |
| `src/main/settings/settingsSanitize.ts` / `settingsProviderSanitize.ts` | 对 layout/window/sidebar/terminal/tooling/agentRuntime/provider 等字段做白名单式清洗。 |
| `src/main/settings/ProviderCatalogService.ts` / `EffectiveModelResolver.ts` / `CompiledAgentRoutes.ts` | 将 catalog 定义的 provider 能力注入到用户配置中，解析模型映射。 |

## 3. 架构与约定

### 3.1 持久化格式与版本演进
- 设置文件路径 = `userRdxRoot/config.json`（即 `AppPathService.getRuntimePaths().settingsPath`）。
- 每次写盘使用 **原子替换**：先写 `${settingsPath}.${process.pid}.tmp`，再 `renameSync` 到目标，失败时清理临时文件。
- 每个 persisted 对象带 `schemaVersion`，读取时调用 `assertPersistedSettingsSchemaVersion`，若磁盘版本 > 当前 `SETTINGS_SCHEMA_VERSION` 则抛出 `StorageSchemaError`。
- 升级路径集中在 `rebuildPersistedSettings`：例如 schema 6 重置 `appearance.chromeThemes`，schema 7 移除 `llm.embedding` 字段，删除 fixture provider 并清理对应 secret。

### 3.2 默认值与补丁合并策略
- `createDefaultPersistedSettings()` 提供完整骨架；`normalizePersistedSettings` / `toRuntimeSettings` 用 `sanitizeUiPreferences`、`sanitizeSidebar`、`sanitizeTerminal`、`sanitizeWindow`、`sanitizeToolingSettings`、`sanitizeAgentRuntimeSettings` 将用户值与默认值合并。
- `setAll(patch)` 采用 patch 语义：只覆盖传入字段，未传字段保留旧值；provider 列表会先走 `sanitizeUserProvider` + `normalizeUserProviders`，再在持久化前清空 `apiKey` 字段。

### 3.3 密钥分层
- Settings 文件只存 **引用**（`secretRef`），如 `provider-{id}-api-key`、`provider-{id}-account-{accountId}-{kind}`、`{provider}:{account}:connection:{fieldId}`。
- 真实密钥由 `SecretStorageService` 写入 `secrets/provider-secrets.json`，以 `{ encoding: 'safeStorage', payload: base64(safeStorage.encryptString(...)), updatedAt }` 形式存储。
- 读取时通过 `getResolvedProviderSecret` / `resolveAccountRuntimeCredential` 按需解密，返回给运行期；UI 侧通过 `maskSecretPreview` 显示掩码。
- 当 API Key 变更或 authAccountIds 变化时，`SettingsService.setAll` 会生成新的 `localAccountId`，并将旧 secretRef 加入 `secretRefsToDelete`，提交后由 `deleteSecretsAfterCommit` 清理。

### 3.4 路径与环境变量
- `RDC_AGENT_HOME` 覆盖用户根目录（默认 `~/.rdx`）。
- `RDC_AGENT_USER_DATA` 覆盖 Electron `app.getPath('appData')` 的 canonical 路径（Windows 默认 `AppData/Roaming`，Linux 默认 `~/.config`）。
- `AppPathService.initializeRuntime` 会确保以下目录存在：`agents/skills/mcp/hooks/policies/knowledge/memory`、`state/{projects,sessions,tasks,traces,llm-calls,profile,staging/attachments}`、`logs`、`secrets`、`capture-previews`。
- 项目级 `.rdx` 目录包含 `project.yaml`、`.gitignore`（默认忽略 `inputs/artifacts/memory/runtime/replay/replay.lock`），打开项目时会补写缺失的 gitignore 条目。

### 3.5 资源目录叠加（skills/MCP）
- Skills 从三个来源扫描并按 scope 排序：`builtin`（`resources/agent-runtime/skills`）→ `user`（`userRdxRoot/skills`）→ `project`（`projectRdxRoot/skills`），同名 id 由 `scopedResourceResolver` 决定 effective 值。
- Skill 定义格式：目录名作为 id，`SKILL.md` 首行 YAML front matter 含 `name`/`description`/`allowed-tools`，正文为 instructions；可选 `references/`、`scripts/`、`assets/` 子目录。
- MCP 服务器通过 `<dir>/*.mcp.json` 声明，transport 必须在 `@shared/types/mcp.MCP_TRANSPORT_LIST` 中；project 级 MCP 需要 `McpTrustService` 信任后才能启用。

### 3.6 运行时配置组装
- `toRuntimeSettings` 将持久化设置归一化后，调用 `hydrateProviderSecrets` 注入密钥，再通过 `agentManifestService.getSettings` 与 `compiledRoutesFromDefinitions` 生成 `agents`、`resourceCatalog`、`paths`，最终得到进程内可读的 `AppSettings`。
- `getLlmConfig()` 过滤出 `enabled && isConfigured && status === 'verified'` 的 provider，并按 authMode 注入 apiKey/baseUrl/accountId，供 agent runtime 消费。

## 4. 约定与约束

- **设置文件必须带 `schemaVersion`**：`assertPersistedSettingsSchemaVersion` 拒绝高于当前支持的版本，防止未知结构破坏。
- **Provider 必须来自 catalog**：`rebuildPersistedSettings` 会移除非 `isBuiltinProviderId` 的 provider 以及空 id、重复 id 的 provider，并记录 fixes。
- **API Key 不持久化到 settings**：`setAll` 写入前将 `apiKey` 置空，真实值通过 `secretStorageService.setSecret` 单独保存。
- **写盘必须原子**：`writeSettings` / `writeSettingsAsync` 一律先写 `.pid.tmp` 再 rename，避免部分写入导致损坏。
- **密钥文件权限加固**：`applySecretFileMode` 尝试设置 `0o600`，Windows 下额外调用 `icacls` 限制为当前用户访问。
- **路径不可信输入需规范化**：`AppPathService` 对所有路径调用 `path.resolve`，并对 capture preview 的 projectId/inputId 做 `sanitizePathSegment` 过滤非法字符。
- **Agent 运行时权限模式限定**：`VALID_PERMISSION_MODES = ['default','auto-review','full-access','custom']`，超出范围会被 sanitize 丢弃。
- **Shell 可执行变更需刷新缓存**：`mergeAgentShellSettings` 在 `executable` 变化时调用 `shellResolver.clearCache()`。
- **项目 `.rdx` 目录初始化时强制追加 `replay/` 与 `replay.lock` 到 `.gitignore`**，保证录制产物不被误提交。

## 5. 与其他子系统交互

- **IPC 层**：`src/main/ipc/settingsLlmHandlers.ts` 暴露 `saveProviderConnection`、`disconnectProvider`、`rotateProviderAccountCredential` 等 IPC handler，委托给 `SettingsService`。
- **Provider Catalog**：`ProviderCatalogService` 与 `EffectiveModelResolver` 在启动时把内置 provider 能力注入用户配置，使 `capabilities` 字段可从 catalog 定义水合。
- **Hook/Agent Manifest**：`AgentManifestService` 与 `ExecutionProfileService` 共同决定 agent 的系统提示、工具白名单、skill/mcpServer 列表。
- **Electron 打包**：内置 agent-runtime 资源位于 `resources/agent-runtime`，`AppPathService.getBuiltinAgentRuntimeRoot` 优先从 `app.getAppPath()/resources/agent-runtime`、`process.resourcesPath` 等候选中查找已存在的目录。

## 6. 结论

该仓库的配置系统是一个**以 JSON 为中心、以 Electron safeStorage 保护敏感信息、以文件系统目录约定组织扩展资源**的纯代码实现。它没有引入第三方配置框架，而是通过 `SettingsService` + `settingsServiceHelpers` + `SecretStorageService` + `AppPathService` 四个核心组件，配合 `settingsDefaults` 中的 schema 版本与默认值，实现了跨主进程生命周期的一致配置加载、迁移、持久化和安全隔离。