# Provider 体系架构

## 概览

RDC-Agent 的 Provider 体系把“供应商身份、wire protocol、认证方式、Settings UI category、运行时能力、renderer-safe catalog DTO”拆成独立维度。调用方不得从 UI category 反推协议或能力，也不得把 runtime settings 当成公共 catalog 输出。

权威类型位于 `src/shared/types/settings.ts`，内置 provider 清单位于 `src/shared/constants/llm.ts`：

- `LlmProviderEntry`: 用户 settings 中的 runtime provider entry，进入主进程后可被 secret hydration 补齐。
- `LlmProviderCatalogEntry`: 只面向 renderer / HTTP 的 catalog DTO，不包含 secret、token、account label、plan label 或连接状态私有字段。
- `LlmProviderCatalogResponse`: catalog response，包含 `categories`、`protocols` 和 `providers` 三段。
- `LlmProviderProtocol`: HTTP wire protocol 枚举，例如 `OpenAICompatibleChatCompletions`、`OpenAIResponses`、`AnthropicMessages`、`OpenRouterChatCompletions`、`AzureOpenAIChatCompletions`、`GoogleGemini`、`AwsBedrock`、`GoogleVertexAI`、`OllamaOpenAICompatibleChatCompletions`。
- `LlmProviderAuthMode`: 认证方式，例如 `api-key`、`account`、`environment`、`local`。
- `LlmProviderCategory`: Settings UI 的产品展示 category，固定为 `login-authorization`、`official-direct`、`cloud-platform`、`official-compatible`、`coding-token-plan`、`third-party-compatible`、`local`、`image`。
- `LlmProviderCapability`: 运行时能力事实，例如 `chat`、`tool-calling`、`structured-output`、`reasoning`、`model-discovery`。

## Category 与 Protocol

`category` 只回答“Settings UI 应该把 provider 放在哪个产品分组”。它不是协议、认证方式或能力声明。

硬性约束：

- `LlmProviderCategory` 正好包含八个 UI category。
- `openai-compatible` 和 `anthropic-compatible` 只能作为历史迁移输入或底层 wire 语义出现，不能作为 UI category 输出。
- renderer 的 Provider Catalog 分组、分组 label 和 `data-testid` 不得输出旧 category 名。
- 内置 provider definition 使用 `category` + `protocol`，不得保留 `catalogGroup` + `kind` 双轨。
- coding / token plan provider 必须作为独立 provider entry 保留，并归入 `coding-token-plan`。

`protocol` 只回答“主进程用哪种 wire adapter 发请求”。Agent Runtime、Settings 连接测试和模型刷新必须读取 `protocol`，不得从 `category` 或 provider label 猜测。

## Catalog DTO

`settings:getProviderCatalog` 是 Provider Catalog 的主入口，返回 `LlmProviderCatalogResponse`。它只能来自内置 provider definition 的公开元数据，不能携带：

- `apiKey`、`secretRef`、`hasStoredSecret`；
- `accessToken`、`refreshToken`、OAuth token；
- `accountLabel`、`planLabel`、`oauthExpiresAt`、`oauthRefreshAvailable`；
- `lastTestedAt`、`lastModelRefreshAt`、`lastError`；
- 任何 credential / password / secret 字段。

`settings:get` 仍返回当前 workspace settings，并继续对 `LlmProviderEntry.apiKey` 做空值清洗；renderer 默认展示 catalog 时应使用 `settings:getProviderCatalog`，而不是从 settings provider list 重新拼 catalog。

浏览器真实会话必须与 Electron preload 共享同一主进程能力：

- Electron preload: `window.electronAPI.settings.getProviderCatalog()` -> `settings:getProviderCatalog`。
- Browser app bridge: `window.electronAPI.settings.getProviderCatalog()` -> `/invoke` -> `settings:getProviderCatalog`。
- HTTP catalog endpoint: `/api/settings/providers/catalog` 返回同一份 secret-free catalog response。

## Agent Runtime 路由

Agent turn 的结构化工具调用路径是：

```text
Agent Route Capability
  -> Prompt Composer
  -> Configured Runtime Provider
  -> Provider Strategy
  -> Normalized Agent Event Stream
  -> Work Process UI
```

关键规则：

- `src/main/agent-runtime/capabilities/RouteCapabilityResolver.ts` 是 agent route capability 的事实来源。
- Provider 未启用、未配置、未验证、未声明 `chat` 时，一律 `disabled`。
- Provider 声明 `chat` 但未声明 `tool-calling` 时，一律 `text-only`。
- Provider 声明 `tool-calling` 且 runtime strategy 支持 native tools 时，才是 `native-structured`。
- 当前 `openrouter` 仍保持 text-only / fail-closed，除非后续 route 真实 smoke 后提升 capability。

## Plan Entries 与 Fail-Closed

Plan 有两层含义，必须拆开：

- Provider catalog 中的 coding / token plan entries 是具体 provider endpoint，必须独立列出并归入 `coding-token-plan`。
- Agent profile 中的 Plan 是规划 agent，不是硬编码 AppMode，也不是可直接改文件的实现入口。

Plan agent 约束：

- Plan seed tools 只允许研究、提问、任务整理、记忆、`planArtifact` 和 `handoff` 等规划交接工具。
- Plan seed tools 不得包含 `bash`、`write`、`edit` 或 `rdxContext`。
- Plan 的默认 handoff 指向 Edit，由 Edit 执行获批后的实现。
- Plan route 缺失、provider 未启用、model 不可用时，必须保存为空 route 并 fail-closed，不得静默回退到默认 provider/model。

## Reasoning / Thinking Protocol Rules

Provider adapters must preserve the difference between UI-visible thinking and provider-native continuation state.

- OpenAI Responses keeps the stateless `store:false` route, requests `reasoning.summary='auto'` when summary events are enabled, and requests `include: ['reasoning.encrypted_content']` for provider replay. The replay item stays a Responses `reasoning` item, not assistant text.
- Anthropic Messages preserves `thinking`, `signature_delta`, and `redacted_thinking` blocks for tool-use continuation. Replay uses native Anthropic content blocks only when the stored artifact belongs to the same protocol.
- OpenAI-compatible Chat Completions, OpenRouter-style routes, Gemini, Ollama, and DeepSeek/Qwen/Kimi/GLM-style readable `reasoning_content` are raw thinking artifacts with `replayPolicy: 'none'` unless a provider-specific opaque replay artifact is explicitly captured.
- Context compaction and token estimation count ordinary visible transcript separately from provider artifact replay payloads; raw readable thinking must not inflate the ordinary conversation budget.

Work Process consumes provider thinking through `ConversationWorkTrace` only. Each provider turn is projected as an `llm_turn` section: thinking disclosure first when available, loop result stream second, and nested tool-call rows third. `assistant.thinking_end` only changes `thinkingStatus` from `streaming` to `complete`; it never promotes thinking into result text. Models without thinking support skip the thinking row and stream result directly. Opaque provider continuation artifacts render as retained-state status without plaintext preview.

## Provider Strategy

Agent Loop 不通过 Settings 层 `LLMAdapterProvider` 发起 agent turn。它使用 `ConfiguredRuntimeProvider` 从 Settings 中读取已验证 provider 的真实 credential/baseUrl/model，再映射到 runtime provider strategy。Settings 层 `LLMAdapter` 仍可用于连接测试、模型刷新和非 agent 专用调用；它不是 Work Process 的 agent tool-call 数据源。

## 验证

最小门禁：

- `npm run check:provider-system`
- `npm run check:agent-runtime`
- `npm run check:settings-agents`
- `npm run check:shared-exports`
- `npm run typecheck`

涉及 renderer category 输出、Settings modal 或浏览器 endpoint 时，还要启动真实 browser-app session，确认 `settings:getProviderCatalog` 与 `/api/settings/providers/catalog` 返回一致、无 secrets，且 Settings Provider Catalog 不再渲染旧 category。

## Super Grok OAuth

- `grok-account` is the account-login provider surfaced to users as `Super Grok Account`; the internal ID stays stable for settings, secrets, and agent routes.
- Super Grok OAuth reads `https://auth.x.ai/.well-known/openid-configuration` for browser, device, token, userinfo, and revoke endpoints; code must not hardcode old device/token endpoints.
- Browser login is the default path and uses PKCE S256 plus the fixed loopback redirect URI. Device-code login is the remote/headless fallback. Both are canonical login modes of the same account provider, not legacy dual paths.
- `xAI (Grok)` remains the separate API-key provider. OAuth Client ID accepts only an xAI-issued public OAuth client id, never an xAI API key.