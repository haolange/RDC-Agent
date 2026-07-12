# Provider 体系架构

## 概览

RDC-Agent 的 Provider 体系把供应商身份、`wire protocol`、认证方式、Settings UI category、catalog ownership、模型能力表和 renderer-safe catalog DTO 拆成独立维度。调用方不得从 UI category 反推协议或能力，也不得把 runtime settings 当成公共 catalog 输出。

权威类型位于 `src/shared/types/settings.ts`，内置 provider 清单位于 `src/shared/constants/llm.ts`，模型能力 catalog 位于 `src/shared/constants/modelCapabilityCatalog.ts`：

- `LlmProviderEntry`: 用户 settings 中的 runtime provider entry，进入主进程后可被 secret hydration 补齐。
- `LlmProviderCatalogEntry`: 面向 renderer / HTTP 的 catalog DTO，不包含 secret、token、account label、plan label 或连接状态私有字段。
- `LlmProviderCatalogOwnership`: provider model catalog 的归属，固定为 `app-managed` 或 `user-managed`。
- `LlmProviderCatalogResponse`: catalog response，包含 `categories`、`protocols` 和 `providers` 三段。
- `LlmProviderProtocol`: HTTP wire protocol 枚举，例如 `OpenAIResponses`、`AnthropicMessages`、`GoogleGemini`、`AwsBedrock`、`GoogleVertexAI`、`OllamaOpenAICompatibleChatCompletions`。
- `LlmProviderAuthMode`: 认证方式，例如 `api-key`、`account`、`environment`、`local`。
- `LlmProviderCategory`: Settings UI 的产品展示 category，固定为 `login-authorization`、`official-direct`、`cloud-platform`、`official-compatible`、`coding-token-plan`、`third-party-compatible`、`local`、`image`。
- `LlmProviderCapability`: provider 级运行时能力事实，例如 `chat`、`tool-calling`、`structured-output`、`reasoning`、`model-discovery`。

## Category 与 Protocol

`category` 只回答“Settings UI 应该把 provider 放在哪个产品分组”。它不是协议、认证方式或能力声明。

硬性约束：

- `LlmProviderCategory` 正好包含八个 UI category。
- `openai-compatible` 和 `anthropic-compatible` 只能作为历史迁移输入或底层 wire 语义出现，不能作为 UI category 输出。
- renderer 的 Provider Catalog 分组、分组 label 和 `data-testid` 不得输出旧 category 名。
- 内置 provider definition 使用 `category` + `protocol`，不得保留 `catalogGroup` + `kind` 双轨。
- coding / token plan provider 必须作为独立 provider entry 保留，并归入 `coding-token-plan`。

`protocol` 只回答“主进程用哪种 wire adapter 发请求”。Agent Runtime、Settings 连接测试和模型刷新必须读取 `protocol`，不得从 `category` 或 provider label 猜测。

OpenAI Chat Completions（`OpenAICompatibleChatCompletions`）与 OpenAI Responses（`OpenAIResponses`）是两套不同协议，Settings 不得合成一项。对官方同时提供 Anthropic Messages 与 OpenAI 协议的厂商，catalog 通过 `protocolEditable` + `protocolOptions` + `protocolBaseUrls` 暴露可切换协议；切换协议时，若当前 Base URL 仍是上一协议默认值，则同步到新协议默认 URL。无官方 Responses 文档的厂商不得开放 Responses 选项。

## Catalog Ownership

`catalogOwnership` 说明模型列表和能力表由谁维护：

- `app-managed`: RDC-Agent 内置维护 provider 的 model list 与 capability table。覆盖 `login-authorization`、`official-direct`、`cloud-platform`、`official-compatible`、`coding-token-plan`。
- `user-managed`: endpoint 或用户配置维护模型列表，RDC-Agent 不托管能力表。覆盖 `third-party-compatible`、`local`、`image`。

`app-managed` provider 的 Settings 连接、测试和刷新可以调用远端接口验证账号/API 可用性，也可以用远端 model list 标记内置模型是否当前可用；远端返回值不得成为 capability 来源。不可用的内置模型保留在 Settings 列表中并显示 disabled 灰态和原因，不隐藏。普通用户不能在 Settings UI 中填写 context window、reasoning level 或 fast variant model id。

`user-managed` provider 包括 OpenRouter、Custom endpoints、302.AI、SiliconFlow、LiteLLM、Vercel AI Gateway、Hugging Face Router、Manifest、Ollama 等。即使这些 endpoint 使用 OpenAI 或 Anthropic 协议，也不得套用 RDC-Agent 的主流服务能力表。

## Model Capability Catalog

`src/shared/constants/modelCapabilityCatalog.ts` 是模型能力的单一来源。Catalog entry 以 `providerId + modelId/alias` 管理：

- `nominalContextWindowTokens`
- `reasoningControl.kind`: `none`、`toggle`、`levels` 或 `always-on`
- `reasoningControl.supportsOff`: 当前 provider/model 是否真的支持关闭 reasoning
- `reasoningControl.levels`: 官方具名档位子集，canonical naming 为 `minimal | low | medium | high | extra | max | ultra`
- `reasoningControl.defaultSelection` / `lockedSelection?`
- `reasoningControl.wireProfile`: provider request body 映射真相源
- `fastVariantModelId`：当厂商用**独立 model id** 表达 Fast/HighSpeed 时填写（例如 `kimi-for-coding` → `kimi-for-coding-highspeed`，`kimi-k2.7-code` → `kimi-k2.7-code-highspeed`，`claude-opus-4-8` → `claude-opus-4-8-fast`）。变体必须同时作为 catalog 行存在；Composer `turnControls.fastModel` 仅在该变体已启用时可用，并由 `resolveEffectiveModelId` 改写请求 model id。同一 model 下仅靠请求参数切换的 Fast，只有官方文档给出可映射 wire 时才进入 profile；否则 `fastModelAvailable=false`，不得发明假 Fast 档。
- `toolCalling`
- `visionInput`
- `structuredOutput`
- `source.kind`: `official`、`observed`、`conservative`
- `source.updatedAt`
- `source.urls`
- `source.note`

能力解析顺序固定为：

1. `app-managed` provider 的静态 catalog；
2. conservative default。

旧的 `LlmProviderModel.capabilityOverride`、per-model context override、regex-only seed fallback 不是产品路径。读取 settings 时必须丢弃旧字段，不新增兼容 shim，不把旧 override 写回 settings。

Reasoning 控件的运行时映射固定为：

- `off`：发送 provider 官方关闭语义，或在 wire profile 明确要求时不发送 reasoning/thinking 参数，并关闭 provider summary-thinking 请求。
- `on`：仅用于 `toggle` / `always-on` 控件，发送该模型 wire profile 中声明的默认开启语义。
- `minimal`、`low`、`medium`、`high`、`extra`、`max`、`ultra`：仅当 catalog 对具体 provider/model row 明确支持时可选；adapter 只能按照 `reasoningControl.wireProfile` 做显式映射，不能在 UI、settings adapter 或 runtime provider 里各自猜测或静默降级。

Settings 与 Composer 必须使用同一套 capability-driven reasoning 语义，不再保留 `Auto`。`toggle` 只显示 `Off | On`；`always-on` 只显示锁定的 `On`；`levels` 只显示该模型官方支持的具名档位，并且只有在官方确认可关闭时才把 `Off` 插到最前面。产品层 canonical naming 为 `Off | On | Minimal | Low | Medium | High | Extra | Max | Ultra`；provider wire spellings 例如 `xhigh` 只允许存在于映射层。Composer rail 的 stop 集合来自 `reasoningControl` 的单一真相源，而不是 provider 专属 UI 分支。拖动必须是连续交互：拖动中 thumb 跟随指针，释放时按 `round(ratio * (visibleStops - 1))` 最近取整到当前可见档位集合，并吸附动画回档位点。`Max context` 与 `Fast mode` 这类非 slider 能力仍保持可见灰态，不隐藏，但 compact popup 只显示 label 和 switch，不显示细节小字。

维护第一版或后续版本 catalog 时：

- 优先使用官方文档、官方 model card、官方 API reference；
- 官方资料不完整时，用 `conservative` source kind 标记，并使用保守能力值；
- 低成本实测只用于验证 endpoint/model 可用性，不把 runtime 探测结果当作永久 capability 来源；
- 更新模型列表时同步 `llm.ts` 的 provider ownership 派生、相关测试和 Settings 只读展示。
- 2026-07-11：OpenAI GPT-5.6 家族（`gpt-5.6-sol` / `terra` / `luna`，alias `gpt-5.6`→sol）在 Responses 路由暴露产品档 `extra→xhigh` 与 `max→max`；xAI 新增 `grok-4.5`（500k context，low/medium/high，默认 high）。Claude Fable 5 既有 `max` 档保持不变。OpenAI multi-agent `ultra` 与 `reasoning.mode: pro` 本轮不进入 Composer 滑杆。
- 2026-07-12：全量对照官方文档修订。DeepSeek 产品档固定 `Off|High|Max`（thinking off + effort high/max）。Kimi Coding Plan 增加 `kimi-for-coding-highspeed` 与 `fastVariantModelId`。`grok-4.5` `supportsOff=false`。Groq/Mistral 模型列表对齐现行 production/featured。Bailian Coding Plan 的 `qwen3-coder-*` 改为 reasoning `none`。
- `chatgpt-account` 的模型列表对齐 Codex ChatGPT-sign-in（`https://developers.openai.com/codex/models`）：`gpt-5.6-sol/terra/luna` + `gpt-5.5` / `gpt-5.4` / `gpt-5.4-mini`。不含网页 ChatGPT Instant/Thinking/Pro 产品 ID，也不与 API-key `openai` catalog 混用；ChatGPT sign-in 已弃用的 `gpt-5.2` / `gpt-5.3-codex` 不收录。
- `volcengine-coding-plan` 对齐方舟 Coding Plan 网关模型面与 docs `https://www.volcengine.com/docs/82379/1928261`（非失效的 `1928262`，也非通用 Ark `/api/v3`）：Doubao Seed 2.0（code/pro/lite + Fast→lite）、`doubao-seed-code`、MiniMax m2.7/m2.5、`kimi-k2.7-code`(+highspeed Fast)、kimi-k2.6/k2.5、**`glm-5.2`**（alias `glm-latest`；`glm-5.1` 降为次级保留）、glm-4.7、DeepSeek v4-pro/v4-flash/v3.2（Off|High|Max）。Anthropic / OpenAI 发现统一走 `GET …/api/coding/v3/models`（Bearer）；merge 认 catalog aliases，并把 `/models` 返回的日期后缀 / vendor 前缀 / mini→lite id 归一到友好 catalog id；仅返回 `ark-code-latest` 等元模型、或归一后与 catalog 零交集时，**鉴权成功则 fallback 为 catalog Available**（chat 接受友好路由 id，避免 Test 成功却全部 Unavailable）。
Composer compact controls are display-only consumers of resolved capability. They may render labels, values, and short disabled reasons, but must not render provider documentation excerpts, source claims, marketing notes, catalog research notes, or explanatory paragraphs. Long capability rationale belongs in Settings details, catalog source metadata, or this architecture document.

## Catalog DTO

`settings:getProviderCatalog` 是 Provider Catalog 的主入口，返回 `LlmProviderCatalogResponse`。它只能来自内置 provider definition 的公开元数据，不能携带：

- `apiKey`、`secretRef`、`hasStoredSecret`
- `accessToken`、`refreshToken`、OAuth token
- `accountLabel`、`planLabel`、`oauthExpiresAt`、`oauthRefreshAvailable`
- `lastTestedAt`、`lastModelRefreshAt`、`lastError`
- 任意 credential / password / secret 字段

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
- `user-managed` provider 不因为 model id 命中主流服务名字就获得 app-managed capability。

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
- OpenAI-compatible Chat Completions routes that emit readable `reasoning_content` (DeepSeek, Kimi, GLM, MiniMax, MiMo, and similar) store raw thinking with `replayPolicy: 'openai-reasoning-content'`. Assistant turns that carry `tool_calls` must replay that field on subsequent requests. OpenRouter-style, Gemini, and Ollama readable thinking remain `replayPolicy: 'none'` unless a provider-specific opaque replay artifact is explicitly captured.
- Context compaction and token estimation count ordinary visible transcript separately from provider artifact replay payloads; raw readable thinking must not inflate the ordinary conversation budget.

Work Process consumes provider thinking through `ConversationWorkTrace` only. Its visible header uses process-first copy and must not regress to status-first labels. Each provider turn is projected as an `llm_turn` section with a fixed hierarchy: thinking disclosure first when available, loop result/narration second, and nested tool-call / approval / `ask_user` evidence third.

Answer-only turns after visible tool/thinking evidence are final-response boundaries, not new reasoning sections. Their provider-visible closing summary can be exposed only as folded boundary detail, while assistant answer tokens remain exclusively in the assistant message body.

## Provider Strategy

Agent Loop 不通过 Settings 层 `LLMAdapterProvider` 发起 agent turn。它使用 `ConfiguredRuntimeProvider` 从 Settings 中读取已验证 provider 的真实 credential/baseUrl/model，再映射到 runtime provider strategy。Settings 层 `LLMAdapter` 仍可用于连接测试、模型刷新和非 agent 专用调用；它不是 Work Process 的 agent tool-call 数据源。

## 验证

最小门禁：

- `npm run check:provider-system`
- `npm run check:agent-runtime`
- `npm run check:settings-agents`
- `npm run check:shared-exports`
- `npm run typecheck`

涉及 renderer category 输出、Settings modal 或浏览器 endpoint 时，还要启动真实 browser-app session，确认 `settings:getProviderCatalog` 与 `/api/settings/providers/catalog` 返回一致、无 secrets，Settings Provider Catalog 不再渲染旧 category，Settings > Providers 中 app-managed provider 显示只读 capability，`third-party-compatible` / `local` 显示用户自管说明。

## Super Grok OAuth

- `grok-account` is the account-login provider surfaced to users as `Super Grok Account`; the internal ID stays stable for settings, secrets, and agent routes.
- Super Grok OAuth reads `https://auth.x.ai/.well-known/openid-configuration` for browser, device, token, userinfo, and revoke endpoints; code must not hardcode old device/token endpoints.
- Browser login is the default path and uses PKCE S256 plus the fixed loopback redirect URI. Device-code login is the remote/headless fallback. Both are canonical login modes of the same account provider, not legacy dual paths.
- `xAI (Grok)` remains the separate API-key provider. OAuth Client ID accepts only an xAI-issued public OAuth client id, never an xAI API key.
