---
kind: configuration_system
name: RDC-Agent 配置系统：基于 JSON 持久化 + Electron safeStorage 的 SettingsService 架构
category: configuration_system
scope:
    - '**'
source_files:
    - src/main/settings/SettingsService.ts
    - src/main/settings/settingsDefaults.ts
    - src/main/settings/settingsServiceHelpers.ts
    - src/main/settings/SecretStorageService.ts
    - src/main/runtime/AppPathService.ts
    - src/main/settings/AgentRuntimeConfigService.ts
    - src/main/settings/ExecutionProfileService.ts
    - src/main/settings/settingsSanitize.ts
    - src/main/settings/settingsProviderSanitize.ts
    - src/main/settings/ProviderConnectionSchema.ts
---

## 1. 采用的系统与框架

RDC-Agent 在 Electron 主进程中实现了一套自研的 **SettingsService** 配置系统，核心由以下组件构成：
- **持久化格式**：用户级 `config.json`（路径由 `AppPathService` 解析），以 `PersistedSettingsPayload` 描述 schema，并通过 `schemaVersion` 字段做向后兼容迁移。
- **运行时配置对象**：通过 `toRuntimeSettings()` 将持久化的 `PersistedSettingsPayload` 归一化为 `AppSettings`，注入 provider、agent routes、resource catalog、paths 等运行时信息。
- **密钥存储**：`SecretStorageService` 使用 Electron 的 `safeStorage` 加密 API，将 LLM provider 的 api-key / oauth token 以 base64 密文形式写入 `secrets/provider-secrets.json`，并强制文件权限为 `0o600`，Windows 下额外调用 `icacls` 限制 ACL。
- **Agent 运行时资源加载**：`AgentRuntimeConfigService` 扫描 `resources/agent-runtime/skills`（builtin）、用户目录 `~/.rdx/skills`（user）与项目 `.rdx/skills`（project）三层作用域，按优先级合并；MCP server 则从 `mcp/*.mcp.json` 读取。
- **执行 Profile**：`ExecutionProfileService` 根据 Agent 角色（`AgentRole`）从 `agents.definitions` 推导 `EffectiveAgentRuntimeConfig`（systemPrompt、providerId、modelId、toolAllowlist、skillIds、mcpServerIds）。

## 2. 关键文件与包

| 文件 | 职责 |
|---|---|
| `src/main/settings/SettingsService.ts` | 配置系统的统一入口：初始化、读取、写入、Provider 连接管理、Agent 定义保存 |
| `src/main/settings/settingsDefaults.ts` | 默认值、`PersistedSettingsPayload` 类型、`SETTINGS_SCHEMA_VERSION = 7` |
| `src/main/settings/settingsServiceHelpers.ts` | JSON 读写、schema 版本校验、`rebuildPersistedSettings` 迁移、`normalizePersistedSettings`、`toRuntimeSettings` |
| `src/main/settings/SecretStorageService.ts` | 基于 `electron.safeStorage` 的密钥存取、隔离损坏文件、掩码预览 |
| `src/main/runtime/AppPathService.ts` | 解析 `RDC_AGENT_HOME` / `RDC_AGENT_USER_DATA` 环境变量，构造用户态与应用态路径 |
| `src/main/settings/AgentRuntimeConfigService.ts` | 扫描 builtin/user/project 三层的 Skill/MCP 配置，计算信任状态 |
| `src/main/settings/ExecutionProfileService.ts` | 根据 Agent 定义生成执行 profile 与诊断 |
| `src/main/settings/settingsSanitize.ts` | 各子段（appearance/layout/tooling/agentRuntime）的输入清洗 |
| `src/main/settings/settingsProviderSanitize.ts` | Provider 条目清洗、secretRef 解析、OAuth 账户映射 |
| `src/main/settings/ProviderConnectionSchema.ts` | Provider 连接字段的 schema 定义与主密钥字段识别 |

## 3. 架构与设计决策

### 3.1 分层加载顺序
配置数据遵循“默认 → 持久化 → 运行时覆盖”的三段式组装：
1. `createDefaultPersistedSettings()` 提供骨架（appearance/layout/profile/tooling/agentRuntime/llm.providers）。
2. `readJsonFile(settingsPath)` 读取用户 `config.json`，若缺失或 schema 不兼容则回退到默认。
3. `toRuntimeSettings()` 注入 provider secret、compiled agent routes、resource catalog、paths 等运行时上下文，产出最终 `AppSettings`。

### 3.2 Schema 版本迁移
`settingsServiceHelpers.rebuildPersistedSettings()` 在每次应用启动时执行硬重建：
- 检查 `schemaVersion`，拒绝高于当前 `SETTINGS_SCHEMA_VERSION` 的文件（抛出 `StorageSchemaError`）。
- 对历史 schema 做增量修复（如 schema < 6 重置 chromeThemes、schema 7 移除 embedding 选择）。
- 清理 fixture provider 与非 catalog provider，去重 provider id。
- 记录 `fixes` / `warnings` / `secretRefsToDelete` 并在 `persistHardRebuild` 中落盘。

### 3.3 密钥与敏感信息分离
- 普通设置（appearance/layout/profile/tooling/agentRuntime）直接以明文 JSON 存储在 `config.json`。
- 敏感信息（LLM provider 的 api-key、oauth token、connection secret fields）一律通过 `SecretStorageService` 以 `encoding: 'safeStorage'` 存入 `secrets/provider-secrets.json`，引用通过 `secretRef` 字符串传递。
- `SettingsService.setAll()` 在写入 provider 时自动判断是否需要轮换 `authAccountIds['api-key']` 并删除旧 secret ref。
- 读取时通过 `hydrateProviderSecrets()` 将 `secretRef` 还原为明文，但对外暴露的 `getProviderSecret()` / `hasProviderSecret()` 支持掩码预览。

### 3.4 多作用域资源发现
`AgentRuntimeConfigService` 采用“builtin → user → project”三级作用域叠加：
- Builtin：打包在 `resources/agent-runtime/skills` 下的 Markdown + YAML front matter。
- User：`~/.rdx/skills`。
- Project：`<project>/.rdx/skills`，且受 `scopedResourceResolver` 控制可见性。
Skill 通过 `SKILL.md` 的 YAML front matter 声明 `name` / `description` / `allowed-tools`；MCP server 通过 `<id>.mcp.json` 声明，transport 必须属于预定义的 `MCP_TRANSPORT_LIST`，否则标记 `blockedReason`。

### 3.5 路径与环境变量
- `RDC_AGENT_HOME`：用户态根目录（默认 `~/.rdx`），包含 `config.json`、`agents/`、`skills/`、`mcp/`、`hooks/`、`policies/`、`knowledge/`、`memory/`。
- `RDC_AGENT_USER_DATA`：Electron `app.getPath('appData')` 的替代，存放 `state/`、`logs/`、`secrets/` 等应用内部状态。
- `initializeRuntime()` 会递归创建所有需要的目录，保证首次运行无需手动准备。

## 4. 约定与约束

- **配置文件位置固定**：用户配置始终位于 `getUserRdxRoot()/config.json`，由 `AppPathService.getRuntimePaths().settingsPath` 唯一确定。
- **Schema 只增不减**：新增字段通过 `sanitize*` 函数提供默认值；禁止破坏性变更现有字段语义。
- **Provider 必须来自 Catalog**：`rebuildPersistedSettings` 会移除非内置 catalog 的 provider id，防止自定义 provider 绕过能力契约。
- **Secret 不可明文落盘**：`SecretStorageService.getSecret()` 拒绝 `encoding !== 'safeStorage'` 的记录，已存在的明文记录会被静默忽略。
- **原子写**：`writeSettings` / `writeSettingsAsync` 先写 `*.tmp` 再 `rename`，失败时清理临时文件；secret 文件同样采用 tmp+rename 模式。
- **权限加固**：secret 文件写入后调用 `fs.chmodSync(0o600)`，Windows 下尝试 `icacls` 限制为当前用户独占。
- **Agent 执行 Profile 派生规则**：`resolveAgentRoute` 要求 provider 处于 `enabled && isConfigured && status === 'verified'`，否则回退到空 route。
- **Project .gitignore 维护**：`initializeProjectRdx` 确保 `.rdx/.gitignore` 包含 `inputs/`、`artifacts/`、`memory/`、`runtime/`、`replay/`、`replay.lock` 等排除项。
- **Shell 变更缓存失效**：修改 `tooling.shell.executable` 后调用 `shellResolver.clearCache()`，避免旧 shell 进程被复用。

## 5. 与其他模块的交互点

- **IPC 层**：`src/main/ipc/settingsLlmHandlers.ts` 暴露 `saveProviderConnection` / `disconnectProvider` 等 RPC，委托给 `SettingsService`。
- **Provider Catalog**：`ProviderCatalogService` 与 `EffectiveCatalogService` 负责动态发现与合并外部 provider 定义，`SettingsService` 仅持有用户侧持久化副本。
- **Agent Manifest**：`AgentManifestService` 管理 `agents/` 目录中的 YAML 定义，`ExecutionProfileService` 据此生成运行时 profile。
- **Hook 引擎**：`src/main/hooks/HookEngine.ts` 依赖 `AgentRuntimeConfigService.listSkills()` 获取可加载 hook 列表。
- **测试夹具**：`src/main/testing/contracts/` 与 `src/main/settings/fixtures/` 提供 settings 快照与 mock provider，用于验证配置迁移与 provider 路由。