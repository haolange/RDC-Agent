# Provider 体系架构

## 概览

RDC-Agent 的 Provider 体系把身份、认证方式、wire protocol、产品分组和能力声明拆成相互正交的维度：

- `LlmProviderEntry`：Provider 的稳定身份与运行时元数据。
- `LlmProviderKind`：HTTP wire protocol，例如 `openai-compatible`、`anthropic`、`google-ai-studio`、`ollama`。
- `LlmProviderAuthMode`：认证方式，例如 `api-key`、`account`、`environment`、`local`。
- `LlmProviderCatalogGroup`：Settings UI 的产品展示分组。
- `LlmProviderCapability`：运行时可用能力事实，例如 `chat`、`tool-calling`、`reasoning`。

这些跨层类型定义在 `src/shared/types/settings.ts`，内置 Provider 清单维护在 `src/shared/constants/llm.ts`。调用方不能从 provider id、model name 或 UI 分组反推能力，必须读取 capability。

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
- Provider 未启用、未配置、未验证、未声明 `chat`，一律 `disabled`。
- Provider 声明 `chat` 但未声明 `tool-calling`，一律 `text-only`。
- Provider 声明 `tool-calling` 且 runtime strategy 支持 native tools，才是 `native-structured`。
- 当前 `kimi-code / kimi-for-coding` 是 Anthropic-style native structured route。
- 当前 `openrouter` 未声明 `tool-calling`，因此在 agent runtime 中保持 text-only/fail-closed，除非后续逐 route 真实 smoke 后提升 capability。

## Provider Strategy

Agent Loop 不再通过 settings 层 `LLMAdapterProvider` 发起 agent turn。它使用 `ConfiguredRuntimeProvider` 从 Settings 中读取已验证 provider 的真实 `apiKey/baseUrl/model`，再映射到现有 runtime provider strategy：

- `anthropic` -> `AnthropicProvider`
- `openai-compatible` / `openrouter` / `azure-openai` -> `OpenAICompatibleProvider`
- `google-ai-studio` -> `GeminiProvider`
- `ollama` -> `OllamaProvider`

Settings 层 `LLMAdapter` 仍可用于连接测试、模型刷新和非 agent 专用调用；它不是 Work Process 的 agent tool-call 数据源。

## Prompt Composer

Profile conversation 的 system/turn prompt 由 `src/main/agent-runtime/prompt/PromptComposer.ts` 组合。

- `native-structured` route 才注入工具使用说明和 runtime catalog，并向 provider 注册 tool schema。
- `text-only` / `disabled` route 不注册 tools，并明确告知模型不能执行 runtime tools，只能说明缺少哪些信息。
- 禁止在 ConversationService 主流程中硬编码工具提示片段或“不要写文本工具调用”规则。

## Event Contract

Work Process 只消费 normalized agent runtime events：

- `assistant.delta`
- `tool.requested`
- `tool.started`
- `tool.completed`
- `tool.denied`
- `diagnostic`
- `assistant.completed`
- `run.completed` / `run.failed` / `run.cancelled`

Provider 私有协议只在 provider strategy 中解析。模型正文里的 `tool call: ...` 或“工具调用：...”不会被转换成可执行工具调用；runtime 只会发出 `textual_tool_call_not_executed` diagnostic。

## Fail-Closed 规则

- 未声明 capability 的 route 不得假设支持工具。
- 不支持 structured tools 的 route 不注册 tool schema，不执行文本工具调用。
- 空助手消息且无结构化 tool call 时，runtime 发出 `empty_response_without_tool_call` diagnostic。
- Provider 请求失败时，ConversationService 显示真实 diagnostic，不生成假 Work Process tool card。

## 验证

最小门禁：

- `npm run typecheck`
- `npm run check:agent-runtime`
- `npm run check:provider-system`
- `npm run check:settings-agents`
- `npm run check:architecture`
- `npm run check:fidelity`
- `npm run check:shared-exports`

涉及 Work Process 或 Agent Chat UI 时，还必须启动真实 browser-app session，用 Codex in-app Browser 打开 `/app` 验证真实事件流、console、布局和水平溢出。

