# Settings

## Provider / Account Runtime Boundary

`src/main/settings` 负责 settings、profile、provider、model route 与 secret 的主进程边界。Settings 层必须同时满足两个方向：

- renderer-facing API 只返回可展示、可保存、可诊断的数据；
- runtime-facing API 才能在主进程内解析 secret 并交给 provider adapter。

## Provider Catalog Contract

Provider Catalog 不是 `settings:get` 的派生 UI 状态。它有独立 contract：

- 事实输入：`src/shared/provider-catalog/manifests/{identities,profiles,surfaces}/*.json`
- 构建入口：共享 strict Schema 与 Catalog compiler
- 运行时入口：`ProviderCatalogRegistry.listProviderSummaries()` 与 `loadProviderSurface(id)`

- IPC: `settings:getProviderCatalog`
- Preload: `window.electronAPI.settings.getProviderCatalog()`
- Browser app bridge: 同名 API 经 `/invoke` 调用同一 IPC handler
- HTTP: `/api/settings/providers/catalog`

这些入口必须返回同一份 `LlmProviderCatalogResponse`：

- `categories: LlmProviderCategoryDescriptor[]`
- `protocols: LlmProviderProtocolDescriptor[]`
- `providers: LlmProviderCatalogEntry[]`

Catalog DTO 不得包含 `apiKey`、`secretRef`、`hasStoredSecret`、OAuth token、account label、plan label、last test/error 状态、credential、password 或任何 secret-like 字段。

Settings 初始列表只读取 summary index；surface 详情按需异步加载。renderer、preload 和 Browser bridge 不读取 raw manifest。任何 provider/model/route 更新只刷新对应 projection，不能重载完整 Catalog。

Provider definition 的公开维度是：

- `protocol`: wire protocol，供主进程 adapter 使用，例如 `AnthropicMessages` 或 `OpenAICompatibleChatCompletions`；
- `category`: Settings UI category，固定七类（OAuth/Login、第一方直连、Cloud、兼容接入、Coding/Token Plan、Local、Image）；
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
- Settings schema v4 不解析或迁移旧 credential 字段；Effective Catalog v5 直接失效旧缓存。

## Plan / Route Boundary

Provider catalog 中的 coding / token plan entries 必须作为独立 provider entry 保留，并归入 `coding-token-plan`。ClinePass、OpenCode Go、Wafer Pass 等订阅 plan 不得折叠进 Compatible Access 的 entitlement overlay。NanoGPT 指 `nano-gpt.com` 兼容网关，不是 Karpathy 教学仓库。

Plan agent 是独立 profile，用于研究、提问、计划 artifact 与 handoff。Settings 生成或保存 Plan route 时必须 fail-closed：provider/model 不存在、未启用、未配置或不可用时，route 写为空值，不得静默回退到默认模型。

Plan 的 seed manifest 不包含 `bash`、`write`、`edit` 或 `rdcContext`；获批后的实现由 Plan handoff 到 Edit。

## Validation

相关改动后至少运行：

- `pnpm run check:provider-system`
- `pnpm run check:provider-catalog`
- `pnpm run check:agent-runtime`
- `pnpm run check:settings-agents`
- `pnpm run check:shared-exports`
- `pnpm run typecheck`

涉及 browser-app endpoint 或 Settings UI 时，再用真实 browser-app session 检查 `settings:getProviderCatalog`、`/api/settings/providers/catalog`、Settings Provider Catalog 分组和 secret-free DTO。
