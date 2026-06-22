# Settings

## Provider / Account Runtime Boundary

`src/main/settings` 负责 settings、profile、provider、model route 与 secret 的主进程边界。Settings 层必须同时满足两个方向：

- renderer-facing API 只返回可展示、可保存、可诊断的数据；
- runtime-facing API 才能在主进程内解析 secret 并交给 provider adapter。

## Provider Catalog Contract

Provider Catalog 不是 `settings:get` 的派生 UI 状态。它有独立 contract：

- IPC: `settings:getProviderCatalog`
- Preload: `window.electronAPI.settings.getProviderCatalog()`
- Browser app bridge: 同名 API 经 `/invoke` 调用同一 IPC handler
- HTTP: `/api/settings/providers/catalog`

这些入口必须返回同一份 `LlmProviderCatalogResponse`：

- `categories: LlmProviderCategoryDescriptor[]`
- `protocols: LlmProviderProtocolDescriptor[]`
- `providers: LlmProviderCatalogEntry[]`

Catalog DTO 不得包含 `apiKey`、`secretRef`、`hasStoredSecret`、OAuth token、account label、plan label、last test/error 状态、credential、password 或任何 secret-like 字段。

Provider definition 的公开维度是：

- `protocol`: wire protocol，供主进程 adapter 使用，例如 `AnthropicMessages` 或 `OpenAICompatibleChatCompletions`；
- `category`: Settings UI category，固定八类；
- `authMode`: 用户如何认证；
- `capabilities`: 下游可验证的能力声明。

`openai-compatible` / `anthropic-compatible` 不得作为 UI `category` 输出。不要恢复旧 `catalogGroup` / `kind` 双轨，也不要在 Settings UI 中用 protocol 名作为产品分组。

## Secret Boundary

- `SettingsService` 只在主进程 runtime-facing 路径中通过 `SecretStorageService` 解析 credential。
- `settings:get` 返回的 provider entry 继续清空 `apiKey`。
- `settings:getProviderCatalog` 和 `/api/settings/providers/catalog` 不返回任何用户连接状态或 secret 引用。
- account provider 的 OAuth bundle 只通过 `ProviderAccountAuthService` 与 `SecretStorageService` 在主进程内流转。

## Plan / Route Boundary

Provider catalog 中的 coding / token plan entries 必须作为独立 provider entry 保留，并归入 `coding-token-plan`。

Plan agent 是独立 profile，用于研究、提问、计划 artifact 与 handoff。Settings 生成或保存 Plan route 时必须 fail-closed：provider/model 不存在、未启用、未配置或不可用时，route 写为空值，不得静默回退到默认模型。

Plan 的 seed manifest 不包含 `bash`、`write`、`edit` 或 `rdxContext`；获批后的实现由 Plan handoff 到 Edit。

## Validation

相关改动后至少运行：

- `npm run check:provider-system`
- `npm run check:agent-runtime`
- `npm run check:settings-agents`
- `npm run check:shared-exports`
- `npm run typecheck`

涉及 browser-app endpoint 或 Settings UI 时，再用真实 browser-app session 检查 `settings:getProviderCatalog`、`/api/settings/providers/catalog`、Settings Provider Catalog 分组和 secret-free DTO。
