---
kind: configuration_system
name: RDC-Agent 配置系统：分层持久化、作用域资源与密钥管理
category: configuration_system
scope:
    - '**'
source_files:
    - src/main/runtime/AppPathService.ts
    - src/main/settings/SettingsService.ts
    - src/main/settings/settingsDefaults.ts
    - src/main/settings/SecretStorageService.ts
    - src/main/settings/AgentRuntimeConfigService.ts
    - src/main/runtime/RdxRuntimeService.ts
    - src/main/settings/McpTrustService.ts
    - src/main/runtime/ScopedResourceResolver.ts
    - src/main/settings/ProviderConnectionService.ts
    - src/main/settings/EffectiveCatalogService.ts
    - src/main/settings/RequestPlanner.ts
---

## 1. 使用的系统与框架

- **Electron 原生 `safeStorage`**：用于加密存储 LLM Provider API Key、OAuth Token 等敏感信息，文件位于 `<userData>/secrets/provider-secrets.json`。
- **JSON 配置文件**：应用设置集中持久化为 `~/.rdx/config.json`（即 `userRdxRoot/config.json`），通过 `electron-store` 的同类 JSON 读写模式实现。
- **YAML + Markdown front matter**：Agent、Skill、Hook、Policy、MCP 等运行时资源以 YAML front matter 声明元数据，正文为 Markdown/YAML/JSON，由 `yaml` 库解析。
- **Zod 4**：对 MCP descriptor、Provider connection schema 等进行运行时校验。
- **环境变量注入路径**：`RDC_AGENT_HOME` 覆盖用户根目录，`RDC_AGENT_USER_DATA` 覆盖 Electron userData 根，`process.env.RDC_AGENT_*` 在启动阶段被 `AppPathService` 消费。

## 2. 核心文件与包

| 职责 | 关键文件 |
|---|---|
| 路径解析与作用域划分 | `src/main/runtime/AppPathService.ts` |
| 应用设置持久化与合并 | `src/main/settings/SettingsService.ts` |
| 默认值与 schemaVersion | `src/main/settings/settingsDefaults.ts` |
| 密钥安全存储 | `src/main/settings/SecretStorageService.ts` |
| Agent 运行时资源发现（skill/mcp/hook/policy） | `src/main/settings/AgentRuntimeConfigService.ts` |
| 作用域资源 CRUD 与策略收紧 | `src/main/runtime/RdxRuntimeService.ts` |
| MCP 信任与项目级可执行覆盖保护 | `src/main/settings/McpTrustService.ts` |
| 作用域资源解析与策略合并 | `src/main/runtime/ScopedResourceResolver.ts` |
| Provider 连接/路由/能力探测 | `src/main/settings/ProviderConnectionService.ts`, `EffectiveCatalogService.ts`, `RequestPlanner.ts` |
| 进程/工作区生命周期中的路径初始化 | `src/main/runtime/RdxRuntimeService.ts`, `ExecutionProfileService.ts` |

## 3. 架构与设计约定

### 3.1 三层作用域的资源模型
所有运行时资源（agent/skill/mcp/hook/policy/knowledge/memory）统一遵循 **builtin → user → project** 三层作用域叠加：
- `builtin`：打包在 `resources/agent-runtime/{agents,skills,hooks}` 下的只读模板。
- `user`：`~/.rdx/{agents,skills,mcp,hooks,policies,knowledge,memory}`，跨项目共享。
- `project`：`<projectRoot>/.rdx/{...}`，仅对当前项目生效，且受用户层 `policies/*.policy.yml` 约束。

`AppPathService` 是唯一的路径来源，`initializeRuntime()` 会递归创建上述目录；`initializeProjectRdx()` 还会写入 `.gitignore`（包含 `replay/`、`replay.lock` 等）。`RdxRuntimeService.list()` 按 kind×scope 扫描并标记 `effectiveStatus: effective | overridden | invalid | disabled`。

### 3.2 设置文件的版本化与迁移
`settingsDefaults.ts` 暴露 `SETTINGS_SCHEMA_VERSION = 7`。`SettingsService.initialize()` 读取 `config.json` 后调用 `assertPersistedSettingsSchemaVersion`，并通过 `rebuildPersistedSettings` 做向后兼容的重建，再写回磁盘。`setAll()` 每次保存都显式写入 `schemaVersion`。

### 3.3 设置项的分层合并
`SettingsService.setAll()` 将 patch 与现有 `PersistedSettingsPayload` 逐项 merge：`appearance` 走 `mergeUiPreferences`，`layout` 各子区域走 `sanitizeSidebar/sanitizeTerminal/sanitizeWindow`，`tooling` 中 shell executable 变更会触发 `shellResolver.clearCache()`，`agentRuntime` 权限/上下文分别走对应 sanitize。

### 3.4 Provider 配置与密钥分离
- 非敏感字段（id、baseUrl、models、authMode、connectionValues 等）持久化到 `config.json` 的 `llm.providers[]`。
- 敏感字段（apiKey、OAuth token、connection secret field）通过 `SecretStorageService` 以 `encoding: 'safeStorage'` 存入 `secrets/provider-secrets.json`，并以 `provider-{id}-api-key` / `provider-{id}-oauth` / `provider-{id}-account-{accountId}-{kind}` / `{id}:{accountId}:connection:{fieldId}` 等命名空间隔离。
- `getProviderSecret` / `getProviderConnectionValues` / `getProviderOAuthSecret` 在读取时按需解密，返回给调用方的是明文但仅在内存中持有。

### 3.5 MCP 信任与项目覆盖保护
`AgentRuntimeConfigService.listMcpServers()` 加载 `user/mcp/*.mcp.json` 与 `project/.rdx/mcp/*.mcp.json`，计算 `descriptorHash`，若项目 MCP 试图覆盖用户层的 command/args/url/env，则拒绝并标记 `executableOverrideRejected`。项目级 MCP 需经 `trustProjectMcp` 授予信任后才可用。

### 3.6 运行时资源验证与策略收紧
`RdxRuntimeService.validate()` 强制：
- agent/skill 必须含 YAML front matter；
- hook/policy 必须是合法 YAML；
- mcp 必须是合法 JSON；
- 当 scope 为 `project` 且 kind 为 `policy` 时，使用 `scopedResourceResolver.tightenPolicy(base, content)` 将用户层 restrictive policy 作为上限收紧项目策略。

## 4. 约定与约束

| 约定 | 说明 | 依据 |
|---|---|---|
| 用户根目录可通过 `RDC_AGENT_HOME` 覆盖 | 默认 `~/.rdx` | `AppPathService.getUserRdxRoot()` |
| 应用状态目录可通过 `RDC_AGENT_USER_DATA` 覆盖 | 默认 Electron `app.getPath('appData')` | `AppPathService.getUserDataRoot()` |
| 设置文件路径固定为 `config.json` | 位于 `userRdxRoot` | `AppPathService` 常量 `CONFIG_FILE_NAME` |
| 密钥文件固定为 `provider-secrets.json` | 位于 `secrets/` 子目录 | `SecretStorageService.SECRET_FILE_NAME` |
| 新 provider 的 apiKey 变更会生成新的 `authAccountIds['api-key']` 并删除旧 ref | 避免密钥泄露残留 | `SettingsService.setAll()` 中 `secretRefsToDelete` 逻辑 |
| 密钥文件写入采用临时文件 + rename 原子替换 | 防止半写损坏 | `SecretStorageService.writeSecretMap()` |
| 密钥文件在 Windows 上通过 `icacls` 限制为当前用户独占 | 最佳 effort ACL | `applySecretFileMode()` |
| 项目 `.rdx` 目录自动注入 `replay/`、`replay.lock` 到 `.gitignore` | 保证二进制回放不被提交 | `AppPathService.initializeProjectRdx()` |
| Skill 目录名即为 skill id，`SKILL.md` 的 front matter 提供 name/description/allowed-tools | 约定式文件系统协议 | `AgentRuntimeConfigService.parseSkill()` |
| MCP transport 必须在 `MCP_TRANSPORTS` 白名单内 | 否则标记 `blockedReason` | `AgentRuntimeConfigService.listMcpServers()` |
| 资源 id 必须经 `safeId` 规范化（仅 a-z0-9._-） | 防止路径穿越与非法字符 | `RdxRuntimeService.safeId` |
| 资源路径必须落在作用域 root 内 | 防止逃逸 | `assertInside(root, target)` |
| 设置变更必须递增 `schemaVersion` | 升级入口 | `SettingsService.setAll()` 写入 `SETTINGS_SCHEMA_VERSION` |

## 5. 总结

该仓库的配置系统围绕 **`AppPathService` 定义的作用域路径**、**`SettingsService` 的版本化 JSON 设置**、**`SecretStorageService` 的 OS safeStorage 密钥**、以及 **`AgentRuntimeConfigService`/`RdxRuntimeService` 的文件系统资源发现与策略合并** 四部分组成。它不依赖外部配置中心或环境变量驱动业务行为，而是以本地文件系统为单一事实源，通过 builtin/user/project 三层叠加实现“内置模板 + 用户定制 + 项目覆盖”的可组合配置模型，并在 MCP 与 Policy 层面施加安全约束。