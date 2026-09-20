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
    - src/main/runtime/AppPathService.ts
    - src/main/settings/ExecutionProfileService.ts
    - src/main/settings/AgentRuntimeConfigService.ts
    - src/main/settings/settingsSanitize.ts
    - src/main/settings/settingsProviderSanitize.ts
    - src/main/settings/McpTrustService.ts
---

## 1. 使用的系统与框架

- **Electron 主进程**：所有配置加载、持久化与密钥管理均运行在 Electron main 进程中，通过 `electron.app.getPath('appData')` 定位用户数据目录。
- **JSON 文件持久化**：应用设置以单个 `config.json`（路径由 `AppPathService.getRuntimePaths().settingsPath` 给出）形式落盘，位于用户数据根目录下的 `config.json`。
- **Electron `safeStorage`**：敏感字段（LLM provider API key、OAuth token、连接字段等）不直接写入 `config.json`，而是通过 `SecretStorageService` 使用 `electron.safeStorage.encryptString` 加密后写入独立的 `provider-secrets.json`（位于 `<userData>/secrets/provider-secrets.json`）。
- **YAML front matter + Markdown**：Agent Runtime 的 Skill/Prompt/Hook/Agent 定义通过 `resources/agent-runtime` 下带 YAML front matter 的 `.md` 文件声明，由 `AgentRuntimeConfigService.parseSkill` 解析为运行时描述符。
- **pnpm workspace / electron-vite**：构建期产物中的 `resources/agent-runtime` 作为内置 Agent 资源被 `AppPathService.getBuiltinAgentRuntimeRoot()` 按优先级（打包 app path → 当前工作目录 → `process.resourcesPath`）发现。

## 2. 关键文件与包

- `src/main/settings/SettingsService.ts`：统一的设置入口，负责初始化、读取、合并 patch、持久化、Provider 连接与 Agent 定义保存。
- `src/main/settings/settingsDefaults.ts`：定义 `PersistedSettingsPayload` 结构、`SETTINGS_SCHEMA_VERSION = 7`、默认外观/布局/工具链/Agent 权限等常量。
- `src/main/settings/settingsServiceHelpers.ts`：JSON 读写、schema version 校验、`rebuildPersistedSettings` 迁移、`normalizePersistedSettings`、`toRuntimeSettings`、原子写 `writeSettings`/`writeSettingsAsync`。
- `src/main/settings/SecretStorageService.ts`：封装 `provider-secrets.json` 的加解密、ACL 加固（`chmod 0o600`、Windows `icacls`）、损坏隔离（`.corrupt-*` quarantine）。
- `src/main/runtime/AppPathService.ts`：集中计算 user/project/appState 三类路径；`initializeRuntime()` 自动创建所有必要目录；`getRuntimePaths()` 返回包含 `settingsPath` 的统一路径对象。
- `src/main/settings/ExecutionProfileService.ts`：根据 agent 定义与 provider 路由生成 `EffectiveAgentRuntimeConfig`，并产出诊断信息。
- `src/main/settings/AgentRuntimeConfigService.ts`：扫描 `builtin/user/project` 三层 skill/MCP 目录，解析 SKILL.md 的 YAML front matter，处理 MCP 信任与覆盖策略。
- `src/main/settings/settingsSanitize.ts`、`settingsProviderSanitize.ts`：对 UI、tooling、agent runtime、provider 条目进行字段级清洗与归一化。
- `src/main/settings/ProviderConnectionSchema.ts`、`ProviderConnectionService.ts`：动态 provider 连接字段的 schema 与连接生命周期。
- `src/main/settings/EffectiveModelResolver.ts`、`ModelsOverrideService.ts`：模型选择与覆盖逻辑。
- `src/main/settings/McpTrustService.ts`：项目级 MCP 描述符的信任指纹与重信任流程。

## 3. 架构与设计约定

### 分层加载顺序
1. **路径层**：`AppPathService` 根据 `RDC_AGENT_USER_DATA`、`RDC_AGENT_HOME` 环境变量或平台默认位置（Windows `%APPDATA%`、macOS/Linux `~/.config`）计算所有路径，并在 `initializeRuntime()` 时递归创建目录。
2. **持久化层**：`SettingsService.initialize()` 读取 `config.json`，调用 `assertPersistedSettingsSchemaVersion` 检查 `schemaVersion ≤ SETTINGS_SCHEMA_VERSION`，再经 `rebuildPersistedSettings` 做向后兼容迁移（如 schema 6 重置 chromeThemes、schema 7 移除 embedding 选择）。
3. **归一化层**：`normalizePersistedSettings` + `sanitize*` 系列将脏/旧数据补齐到默认值；`toRuntimeSettings` 进一步注入 provider secret、agent routes、resource catalog 与 paths。
4. **运行时层**：`ExecutionProfileService`、`EffectiveModelResolver`、`AgentRuntimeConfigService` 基于已归一化的设置生成最终可执行的 Agent 配置。

### Provider 与密钥分离
- `config.json` 中仅保留 provider 元数据与 `secretRef` 引用，绝不存明文 API key。
- `SecretStorageService` 提供 `createProviderSecretRef` / `createProviderAccountSecretRef` / `createProviderConnectionSecretRef` 等命名规则，并通过 `safeStorage` 加密存储。
- 读取时通过 `hydrateProviderSecrets` 把 `secretRef` 还原为真实凭据，供上层消费；对外暴露的 `getProviderSecret` / `hasProviderSecret` 统一走该路径。

### 原子写入与损坏恢复
- `writeSettings` / `writeSettingsAsync` 先写 `<path>.<pid>.tmp` 再 `renameSync` 为目标文件，失败时清理临时文件。
- `SecretStorageService.writeSecretMap` 同样采用 tmp + rename 模式，并在写入后调用 `applySecretFileMode` 设置 POSIX 600 权限及 Windows ACL（仅非测试环境）。
- 若 secrets 文件解析失败，会被重命名为 `<file>.corrupt-<timestamp>` 并抛出 `SecretStoreCorruptError`，避免污染正常状态。

### Agent Runtime 资源发现
- `AgentRuntimeConfigService` 按 `builtin → user → project` 三级目录扫描 `skills/` 和 `mcp/`，用 `scopedResourceResolver.resolve` 合并冲突，并以 `scope` 标记来源。
- Skill 通过 `SKILL.md` 的 YAML front matter 声明 `name`、`description`、`allowed-tools` 等，正文即 instructions。
- MCP 描述符要求 `transport` 属于白名单 `MCP_TRANSPORTS`，否则标记 `blockedReason`；项目级 MCP 需经 `McpTrustService` 信任后才可用。

## 4. 约定与约束

- **配置版本必须递增**：`SETTINGS_SCHEMA_VERSION` 当前为 7；任何写入都带上该版本号，读取时禁止接受高于当前版本的 `schemaVersion`，否则抛 `StorageSchemaError`。
- **Provider 必须来自 catalog**：`rebuildPersistedSettings` 会移除 fixture provider 与非 catalog provider，只保留 `isBuiltinProviderId` 匹配的条目。
- **API key 变更触发 ref 轮换**：`SettingsService.setAll` 在 api-key 变化时生成新的 `authAccountIds['api-key']` 与新 `secretRef`，并把旧 ref 加入 `secretRefsToDelete` 在提交后删除。
- **窗口布局写入走专用窄接口**：`persistWindowLayout` / `persistWindowLayoutAsync` 跳过 provider 归一化与 secret hydration，仅更新 `layout.window`，用于窗口关闭与 move/resize 防抖场景。
- **Shell 可执行变更需刷新缓存**：修改 `tooling.shell.executable` 时会调用 `shellResolver.clearCache()`。
- **Project `.rdc-agent` 目录结构固定**：`project.yaml`、`.gitignore`、`agents/skills/mcp/hooks/policies/knowledge/memory/plans(inputs/artifacts/replay)` 等子目录由 `initializeProjectRdc` 自动创建，且 `.gitignore` 强制追加 `replay/` 与 `replay.lock`。
- **环境变量覆盖**：`RDC_AGENT_USER_DATA` 覆盖应用数据根，`RDC_AGENT_HOME` 覆盖用户 RDC 根，便于测试与多实例隔离。
- **安全边界**：secret 文件仅在 Electron main 进程内访问；渲染进程只能通过 IPC 间接请求，且 `maskSecretPreview` 仅展示末尾 4 位掩码。