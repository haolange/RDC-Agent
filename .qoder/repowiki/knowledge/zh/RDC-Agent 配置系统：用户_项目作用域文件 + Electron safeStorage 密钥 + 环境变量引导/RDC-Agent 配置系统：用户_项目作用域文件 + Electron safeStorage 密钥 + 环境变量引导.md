---
kind: configuration_system
name: RDC-Agent 配置系统：用户/项目作用域文件 + Electron safeStorage 密钥 + 环境变量引导
category: configuration_system
scope:
    - '**'
source_files:
    - scripts/launch-rdc-agent.mjs
    - src/main/runtime/AppPathService.ts
    - src/main/settings/SettingsService.ts
    - src/main/settings/settingsDefaults.ts
    - src/main/settings/SecretStorageService.ts
    - src/main/settings/AgentRuntimeConfigService.ts
    - src/main/runtime/RdcRuntimeService.ts
    - electron.vite.config.ts
    - package.json
---

## 1. 整体方案

RDC-Agent 的配置系统由三层组成：
- **应用级路径与模式**：通过 `scripts/launch-rdc-agent.mjs` 在进程启动前解析 `--mode`（desktop / desktop-dev / browser / browser-dev / prepare-only），注入 `NODE_ENV`、`RDC_AGENT_HEADLESS`、`RDC_AGENT_BROWSER_QA`、`RDC_AGENT_TEST_MODE`、`RDC_AGENT_REBUILD_SETTINGS_ONLY` 等环境变量，再 spawn Electron。
- **运行时路径解析**：`src/main/runtime/AppPathService.ts` 集中计算所有持久化目录，用户根目录默认 `~/.rdc-agent`（可被 `RDC_AGENT_HOME` 覆盖），应用状态目录默认 `<appData>/state`（可被 `RDC_AGENT_USER_DATA` 覆盖），并自动 `mkdir -p` 创建 agents/skills/mcp/hooks/policies/knowledge/memory/logs/secrets 等子目录；项目级资源位于 `<project>/.rdc-agent/...`。
- **设置与密钥**：`SettingsService` 将应用设置以 JSON 写入 `settingsPath`（即 `<userRoot>/config.json`），LLM provider 的 API key/OAuth token 等敏感信息通过 `SecretStorageService` 使用 `electron.safeStorage` 加密后写入 `<userData>/secrets/provider-secrets.json`，非敏感连接值则直接留在 settings JSON 中。

没有使用 `.env`、`.yaml`、`.toml` 或 `electron-store` 作为主配置载体；配置文件是纯 JSON/YAML 文本，密钥走系统安全存储。

## 2. 关键文件与职责

| 文件 | 职责 |
|---|---|
| `scripts/launch-rdc-agent.mjs` | 入口脚本：校验 Node ≥22.13.0、解析 `--mode`、设置运行环境、缓存依赖指纹、触发 `electron-vite build`、spawn Electron |
| `src/main/runtime/AppPathService.ts` | 统一计算 user/project/appState 三类路径；`initializeRuntime()` 确保目录存在；`getBuiltinAgentRuntimeRoot()` 按 packaged → repo → `process.resourcesPath` 顺序回退 |
| `src/main/settings/SettingsService.ts` | 应用设置读写门面：合并 defaults、sanitize、provider 归一化、secret ref 管理、窗口布局快速写、`getLlmConfig()` 输出运行时 LLM 配置 |
| `src/main/settings/settingsDefaults.ts` | 定义 `SETTINGS_SCHEMA_VERSION = 7`、`PersistedSettingsPayload` schema、`DEFAULT_*` 常量（appearance/layout/profile/tooling/agentRuntime） |
| `src/main/settings/SecretStorageService.ts` | 基于 `electron.safeStorage` 的密钥存储：读写 `provider-secrets.json`，Windows 下用 `icacls` 限制 ACL，损坏文件 quarantine 到 `.corrupt-*` |
| `src/main/settings/AgentRuntimeConfigService.ts` | 扫描 `resources/agent-runtime/skills`、`<user>/skills`、`<project>/.rdc-agent/skills`，解析 YAML front matter 的 SKILL.md；扫描 `<user>/<project>/.rdc-agent/mcp/*.mcp.json` 并按 MCP transport 白名单过滤 |
| `src/main/runtime/RdcRuntimeService.ts` | 统一的 scoped resource CRUD：列出 agent/skill/mcp/hook/policy/knowledge/memory，按 `user` 与 `project` 作用域合并，project 覆盖 user；validate/upsert/delete 均做路径逃逸检查 (`assertInside`) |
| `electron.vite.config.ts` | electron-vite 构建配置：main/preload/renderer 三入口，`@shared` alias 指向 `src/shared` |
| `package.json` | 声明 `pnpm@11.7.0`、`engines.node >=22.13.0`、`dependencies.electron-store ^8.1.0`（当前代码未使用，仅保留）、`dependencies.yaml ^2.3.4`、`dependencies.zod ^4.3.6` |

## 3. 架构与约定

### 3.1 作用域分层
- **builtin**：打包进应用的 `resources/agent-runtime/{agents,skills,hooks,prompts}`，只读。
- **user**：`<userRoot>/{agents,skills,mcp,hooks,policies,knowledge,memory}`，用户级扩展。
- **project**：`<project>/.rdc-agent/{agents,skills,mcp,hooks,policies,knowledge,memory,...}`，项目级覆盖 user。
- RdcRuntimeService 对同名 id 的资源，project 优先于 user，并以 `effectiveStatus: 'overridden'` 标记被覆盖项。

### 3.2 资源文件格式
- Agent/Skill：Markdown + YAML front matter（`---\n...\n---\n`），id 由目录名或文件名推导，`enabled` 字段控制生效。
- Hook/Policy：YAML（`.hook.yml` / `.policy.yml`）。
- MCP server：JSON（`.mcp.json`），transport 必须属于 `MCP_TRANSPORT_LIST`，否则标记 `blockedReason: MCP_TRANSPORT_UNSUPPORTED`。
- Skill 目录内可附带 `references/`、`scripts/`、`assets/` 子目录。

### 3.3 密钥与权限
- 所有 secret 统一通过 `SecretStorageService` 存取，编码固定为 `{ encoding: 'safeStorage', payload: base64(safeStorage.encryptString(...)), updatedAt }`。
- 读取时若 `encoding !== 'safeStorage'` 会拒绝解密并返回空串。
- Windows 上写入后调用 `icacls <file> /inheritance:r /grant:r <USER>:F` 收紧 ACL；POSIX 上 `chmod 0o600`。
- 损坏的 secrets 文件会被重命名为 `<file>.corrupt-<timestamp>` 并抛出 `SecretStoreCorruptError`。
- Policy 层支持 project policy tighten user policy（`scopedResourceResolver.tightenPolicy`），实现“限制性策略叠加”。

### 3.4 版本与迁移
- `PersistedSettingsPayload.schemaVersion` 由 `SETTINGS_SCHEMA_VERSION` 管理，`SettingsService.initialize()` 调用 `assertPersistedSettingsSchemaVersion` 并在必要时 `rebuildPersistedSettings` 重建旧格式。
- 项目 `.gitignore` 由 `AppPathService.initializeProjectRdc()` 自动写入，追加 `inputs/`、`artifacts/`、`memory/`、`runtime/`、`replay/`、`replay.lock`。

### 3.5 环境变量约定
| 变量 | 用途 |
|---|---|
| `RDC_AGENT_HOME` | 覆盖用户根目录（默认 `~/.rdc-agent`） |
| `RDC_AGENT_USER_DATA` | 覆盖 Electron userData 根（默认 `app.getPath('appData')`） |
| `RDC_AGENT_HEADLESS` | 由 launcher 注入，headless 模式设为 `1` |
| `RDC_AGENT_BROWSER_QA` | 由 launcher 注入，browser QA 模式开关 |
| `RDC_AGENT_TEST_MODE` | 测试模式标志 |
| `RDC_AGENT_REBUILD_SETTINGS_ONLY` | 仅重建设置标志 |
| `RDC_AGENT_USE_CANONICAL_USERDATA` | 禁用 headless 临时 userData |
| `RDC_AGENT_BROWSER_BRIDGE_PORT` | Browser App Bridge 端口 |
| `RDC_AGENT_BROWSER_QA_BOOTSTRAP` | Browser QA bootstrap token |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | Bedrock 区域回退 |
| `RDC_WORKSPACE_ROOT` | Shell tool 的工作区根 |

## 4. 约定与约束

- **配置不可变来源**：builtin 资源只读，用户/project 资源通过 `RdcRuntimeService.upsert` 写入，禁止任意路径写入（`assertInside` 校验目标相对 root 不以 `..` 开头）。
- **密钥不落地明文**：任何通过 `SettingsService.setAll` 保存的 `apiKey` 都会存入 `SecretStorageService`，settings JSON 中只保留 `secretRef`；`getLlmConfig()` 输出给 LLM 调用方时才解密。
- **MCP 白名单**：只有 `MCP_TRANSPORT_LIST` 中的 transport 允许启用，其余标记 blocked。
- **Project 覆盖 User**：同名 resource id 在 project scope 下的条目会覆盖 user scope，并以 `effectiveStatus` 标注来源。
- **Hook/MCP 信任模型**：project 级 hook 和 mcp descriptor 需要显式信任（`trustProjectMcp` / `trustProjectHook`），未信任时 `needsRetrust=true` 且被阻止。
- **路径隔离**：所有路径经 `normalizePath` 解析为绝对路径，`getUserDataRoot` 通过 `resolveCanonicalUserDataPath` 处理符号链接，防止路径逃逸。
- **原子写入**：settings、secrets、launcher 的状态文件均采用 `tmp -> rename` 原子更新，避免部分写入导致损坏。
- **构建产物位置**：electron-vite 输出到 `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html`，launcher 通过哈希 `package.json`+`pnpm-lock.yaml`+`src`+`resources/brand`+`electron.vite.config.ts`+`vite.renderer.config.ts`+`tsconfig.json` 决定是否重新构建。
