---
kind: configuration_system
name: RDC-Agent 配置系统：基于 JSON + YAML + 环境变量 + Electron safeStorage 的多层运行时配置
category: configuration_system
scope:
    - '**'
source_files:
    - scripts/launch-rdc-agent.mjs
    - src/main/runtime/AppPathService.ts
    - src/main/settings/SettingsService.ts
    - src/main/settings/settingsDefaults.ts
    - src/main/settings/settingsServiceHelpers.ts
    - src/main/settings/SecretStorageService.ts
    - src/main/settings/AgentRuntimeConfigService.ts
    - electron-builder.json
    - package.json
---

## 1. 总体方案

RDC-Agent 的配置系统由四个层次组成，分别承担不同职责：

- **应用启动与构建期配置**：`scripts/launch-rdc-agent.mjs` 通过命令行参数 `--mode desktop|desktop-dev|browser|browser-dev|prepare-only` 以及一组 `RDC_AGENT_*` 环境变量（`RDC_AGENT_USER_DATA`、`RDC_AGENT_HOME`、`RDC_AGENT_HEADLESS`、`RDC_AGENT_BROWSER_QA`、`RDC_AGENT_TEST_MODE`、`RDC_AGENT_REBUILD_SETTINGS_ONLY`、`RDC_AGENT_USE_CANONICAL_USERDATA`）控制依赖安装、Electron 二进制恢复、构建缓存和运行模式。
- **用户/项目级资源路径解析**：`src/main/runtime/AppPathService.ts` 统一计算三类路径——用户根目录（`~/.rdx` 或 `RDC_AGENT_HOME`）、应用状态目录（`app.getPath('appData')` 下的 `state/`、`logs/`、`secrets/` 等）、项目 `.rdx` 子目录；所有子服务通过该单例获取路径，避免硬编码。
- **持久化设置**：`src/main/settings/SettingsService.ts` 以 JSON 文件形式持久化到 `<userRdxRoot>/config.json`，并通过 `schemaVersion`（当前为 7）做向后兼容迁移。
- **密钥存储**：`src/main/settings/SecretStorageService.ts` 将 API Key / OAuth token 等敏感信息经 `electron.safeStorage` 加密后写入 `<userDataRoot>/secrets/provider-secrets.json`，并尝试在 Windows 上通过 `icacls` 限制为当前用户独占。

此外，Agent 运行时还从 `resources/agent-runtime`（内置）→ `user.skillsPath` → `project.skillsPath` 三层扫描 Skill/MCP/Hook/Prompt，形成“内置 + 用户 + 项目”的覆盖式加载顺序。

## 2. 关键文件与职责

| 文件 | 职责 |
|---|---|
| `scripts/launch-rdc-agent.mjs` | 入口脚本：校验 Node ≥22.13.0、解析 `--mode`、计算 pnpm store fingerprint、按需 `pnpm install --frozen-lockfile`、重建 Electron 二进制、触发 `electron-vite build`、注入 `NODE_ENV`/`RDC_AGENT_*` 环境变量并 spawn Electron |
| `src/main/runtime/AppPathService.ts` | 路径抽象：定义 `UserRdxPaths`/`AppStatePaths`/`ProjectRdxPaths`/`RuntimePaths` 接口；`initializeRuntime()` 一次性创建 user/state/logs/secrets/projects/sessions/traces/llm-calls/profile/staging 等目录；`getBuiltinAgentRuntimeRoot()` 按打包路径→cwd→`process.resourcesPath` 回退 |
| `src/main/settings/SettingsService.ts` | 设置门面：`initialize()` 读取 `config.json`、执行 `rebuildPersistedSettings` 迁移、合并默认值、调用 `settingsSanitize` 清洗各字段；`setAll()` 处理 provider 密钥轮换、agent global instructions 保存、窗口布局快速写入；`getLlmConfig()` 输出供渲染器使用的 LLM 配置 |
| `src/main/settings/settingsDefaults.ts` | 默认值与 schema：`SETTINGS_SCHEMA_VERSION = 7`、`DEFAULT_APPEARANCE`/`DEFAULT_LAYOUT`/`DEFAULT_PROFILE`/`DEFAULT_TOOLING`/`DEFAULT_AGENT_RUNTIME`、`createDefaultPersistedSettings()` |
| `src/main/settings/settingsServiceHelpers.ts` | 读写与迁移：`readJsonFile`/`writeSettings`/`writeSettingsAsync` 使用 `.pid.tmp` 原子替换；`assertPersistedSettingsSchemaVersion` 拒绝高于当前版本的配置；`rebuildPersistedSettings` 清理 fixture provider、去重、schema 6 重置 chromeThemes、schema 7 移除 embedding 选择；`toRuntimeSettings` 组装最终 `AppSettings` |
| `src/main/settings/SecretStorageService.ts` | 密钥存储：`provider-secrets.json` 中每条记录含 `encoding: 'safeStorage'`、base64 密文、`updatedAt`；`applySecretFileMode` 写 `0o600` 并在 Windows 上调用 `icacls` 仅授予当前用户；损坏时 quarantined 到 `.corrupt-{ts}` |
| `src/main/settings/AgentRuntimeConfigService.ts` | Agent 运行时配置：解析 `SKILL.md` frontmatter（YAML）、`*.mcp.json` MCP 描述符，按 builtin/user/project 三作用域合并，并对 project 作用域的 MCP 执行信任检查（`McpTrustService`） |
| `electron-builder.json` | 打包配置：产物包含 `out/**/*`、`resources/agent-runtime/**/*`、`resources/knowledge/**/*`；`hooks/**/*.mjs` 通过 `asarUnpack` 和 `extraResources` 单独释放以便运行时加载 |
| `package.json` | 声明 `main: out/main/index.js`、`engines.node >=22.13.0`、依赖 `electron-store`、`yaml`、`zod`、`@ai-sdk/provider` 等 |

## 3. 架构与设计决策

### 3.1 分层加载顺序

- **Skill / MCP / Hook / Prompt**：`builtin`（`resources/agent-runtime`）→ `user`（`~/.rdx/skills`、`mcp`、`hooks`、`policies`）→ `project`（`.rdx/skills`、`mcp`、`hooks`、`policies`）。同 ID 下 project 可覆盖 user 的 name/description/enabledByDefault，但禁止覆盖 user 的 command/args/url/env（安全约束，见 `projectOverridesUserExecutable` 逻辑）。
- **Provider 配置**：`settingsService.setAll()` 对每个 provider 进行 `sanitizeUserProvider` → `normalizeUserProviders`，只保留 catalog 中存在的 provider id，删除非 catalog / fixture 条目。

### 3.2 持久化格式与迁移

- 配置文件固定为 `<userRdxRoot>/config.json`，结构体 `PersistedSettingsPayload` 包含 `schemaVersion`、`appearance`、`layout`、`profile`、`tooling`、`agentRuntime`、`llm.providers`。
- 每次启动先读原始 JSON，再经 `rebuildPersistedSettings` 做 schema 升级（如 schema 6 重置 chromeThemes、schema 7 移除 embedding），最后写回。若磁盘版本 > 当前 `SETTINGS_SCHEMA_VERSION`，抛出 `StorageSchemaError` 阻止启动。
- 写入采用 `.pid.tmp` 临时文件 + `fs.renameSync` 原子替换，异步路径用 `randomUUID()` 后缀。

### 3.3 密钥隔离策略

- 所有 provider secret（API Key、OAuth refresh token、connection field secret）不进入 `config.json`，而是通过 `secretRef` 指向 `provider-secrets.json` 中的加密条目。
- 解密仅在需要时通过 `getResolvedProviderSecret` / `hydrateProviderSecrets` 完成，且 `getLlmConfig()` 返回给渲染器的 provider 列表已剥离明文 apiKey。
- 当 API Key 变更时生成新的 `authAccountIds['api-key']` account id，旧 ref 加入 `secretRefsToDelete` 在提交后清理。

### 3.4 路径与环境变量约定

| 变量 | 含义 | 默认行为 |
|---|---|---|
| `RDC_AGENT_HOME` | 用户数据根目录（`~/.rdx`） | 不存在则回退到 `~/.rdx` |
| `RDC_AGENT_USER_DATA` | Electron appData 根（`state/`、`logs/`、`secrets/`） | 走 `app.getPath('appData')` 或 `~/AppData/Roaming` / `~/.config` |
| `RDC_AGENT_HEADLESS` | 启动 headless 浏览器模式 | 由 launcher 根据 mode 自动设置 |
| `RDC_AGENT_BROWSER_QA` | 启用浏览器 QA 模式 | 同上 |
| `RDC_AGENT_TEST_MODE` | 测试模式开关 | launcher 强制设为 `0` |
| `RDC_AGENT_REBUILD_SETTINGS_ONLY` | 仅重建 settings 后退出 | 由 launcher 传入 |
| `RDC_AGENT_USE_CANONICAL_USERDATA` | 禁用 headless 模式下 disposable browser home | 未设置时在 headless 下删除 `RDC_AGENT_HOME` |

## 4. 约定与约束

- **配置必须带 `schemaVersion`**：`rebuildPersistedSettings` 始终写入 `SETTINGS_SCHEMA_VERSION`；读取时若存在更高版本直接抛错，禁止降级。
- **Provider 必须来自 catalog**：`rebuildPersistedSettings` 会删除不在 `isBuiltinProviderId` 白名单中的 provider，防止任意 ID 被持久化。
- **Secret 不可明文落盘**：`SecretStorageService.getSecret` 拒绝 `encoding !== 'safeStorage'` 的记录并返回空串；`setSecret` 在写入前调用 `assertSafeStorageAvailable()`，否则抛出 `SecretStorageUnavailableError`。
- **Windows 权限加固**：写入 `provider-secrets.json` 后尝试 `chmod 0o600` 并调用 `icacls` 仅授予当前用户完全控制权；失败时静默忽略（best-effort）。
- **项目 MCP 不可覆盖用户命令**：`projectOverridesUserExecutable` 检测后标记 `executableOverrideRejected` 并置 `blockedReason`，禁止 project 作用域覆盖 user 的 command/args/url/env。
- **路径一律通过 `AppPathService` 获取**：所有模块不直接拼接 `~/.rdx` 或 `app.getPath`，保证多实例、自定义 userData、打包后 `process.resourcesPath` 场景一致。
- **Agent 运行时资源以 frontmatter 声明**：Skill 通过 `SKILL.md` 顶部 YAML frontmatter 声明 `name`、`description`、`allowed-tools`，其余内容作为指令；MCP 通过 `*.mcp.json` 声明 `id`、`transport`、`enabledByDefault` 等。
- **打包产物排除 hooks JS**：`electron-builder.json` 中 `asarUnpack` 与 `extraResources` 确保 `resources/agent-runtime/hooks/**/*.mjs` 不被压缩进 asar，保持可被外部 hook 引擎动态加载。

## 5. 适用性说明

本仓库是一个 Electron 桌面应用，具备完整的配置加载、持久化、密钥管理、路径解析与构建期环境编排能力，因此本类别完全适用。