# Settings

## Provider / Account Runtime Boundary

`src/main/settings` 负责 settings、profile、provider、model route 与 secret 的主进程边界。Settings 层必须同时满足两个方向：

- renderer-facing API 只返回可展示、可保存、可诊断的数据；
- runtime-facing API 才能在主进程内解析 secret 并交给 provider adapter。

## Provider Catalog Contract

Provider Catalog 不是 `settings:get` 的派生 UI 状态。它有独立 contract：

- 事实输入：`src/shared/provider-catalog/manifests/{identities,profiles,surfaces}/*.json`
- 构建入口：共享 strict Schema 与 Catalog compiler
- 运行时入口：`ProviderCatalogRegistry` 的 `listProviderSummaries()` 与按 id 读取的 `getProviderSurfaceSummary(id)` 等函数

- IPC: `settings:getProviderCatalog`
- Preload: `window.electronAPI.settings.getProviderCatalog()`
- Browser app bridge: 同名 API 经 `/invoke` 调用同一 IPC handler
- HTTP: `/api/settings/providers/catalog`

这些入口必须返回同一份 `LlmProviderCatalogResponse`：

- `categories: LlmProviderCategoryDescriptor[]`
- `protocols: LlmProviderProtocolDescriptor[]`
- `providers: LlmProviderCatalogEntry[]`

Catalog DTO 不得包含 `apiKey`、`secretRef`、`hasStoredSecret`、OAuth token、account label、plan label、last test/error 状态、credential、password 或任何 secret-like 字段。

renderer 在启动时经 `settings:getProviderCatalog` 读一次目录，再与 `settings:get` 的连接状态拼回 `LlmProviderEntry`；目录变化不引发设置重读。renderer、preload 和 Browser bridge 不读取 raw manifest。任何 provider/model/route 更新只刷新对应 projection，不能重载完整 Catalog。

Provider definition 的公开维度是：

- `protocol`: wire protocol，供主进程 adapter 使用，例如 `AnthropicMessages` 或 `OpenAICompatibleChatCompletions`；
- `category`: Settings UI category，固定六类，对应 manifest 的 `category` 枚举：登录授权、第一方直连、Cloud、Coding/Token Plan、兼容接入、Local；
- `authMode`: 用户如何认证；
- `capabilities`: 下游可验证的能力声明。

`openai-compatible` / `anthropic-compatible` 不得作为 UI `category` 输出。不要恢复旧 `catalogGroup` / `kind` 双轨，也不要在 Settings UI 中用 protocol 名作为产品分组。

## Secret Boundary

- `SettingsService` 只在主进程 runtime-facing 路径中通过 `SecretStorageService` 解析 credential。
- `settings:get` 返回的 provider entry 继续清空 `apiKey`。
- `settings:getProviderCatalog` 和 `/api/settings/providers/catalog` 不返回任何用户连接状态或 secret 引用。
- account provider 的 OAuth bundle 只通过 `ProviderAccountAuthService` 与 `SecretStorageService` 在主进程内流转。
- preflight 通过 `ProviderRuntimeCredentialService` 创建 opaque lease；typed connection secret、认证 header、Vertex/AWS 临时凭据只存在于该 lease。
- Adapter 没有 lease handle 必须 fail-closed，运行中不得回读 Settings。401 刷新只替换同一 lease 的 credential material，不改变冻结 route。
- Settings schema v9 只存用户状态，不含 credential 字段；secret ref 由 provider id 与账号 ID 派生，凭据存在性在组合 provider 时从 secret 存储读取。secret map 与解密结果缓存在主进程内存里，写入即失效，应用外的修改在回合准备与打开 Settings 时按文件 mtime + size 复核。旧版本设置文件不解析、不迁移；Effective Catalog 版本变化直接失效旧版本缓存。

## Plan / Route Boundary

Provider catalog 中的 coding / token plan entries 必须作为独立 provider entry 保留，并归入 `coding-token-plan`。ClinePass、OpenCode Go、Wafer Pass 等订阅 plan 不得折叠进 Compatible Access 的 entitlement overlay。NanoGPT 指 `nano-gpt.com` 兼容网关，不是 Karpathy 教学仓库。

Agent 的模型路由来自 Settings → Agents（`agentModels`）。provider/model 不存在、未启用、未配置或不可执行时 fail-closed，并给出同 provider 的已验证候选，不静默回退到默认模型（见 `ARCHITECTURE.md` Architecture Principles §9）。

## Validation

相关改动后至少运行：

- `pnpm run check:provider-system`
- `pnpm run check:provider-catalog`
- `pnpm run check:agent-runtime`
- `pnpm run check:settings-agents`
- `pnpm run typecheck`

涉及 browser-app endpoint 或 Settings UI 时，再用真实 browser-app session 检查 `settings:getProviderCatalog`、`/api/settings/providers/catalog`、Settings Provider Catalog 分组和 secret-free DTO。
