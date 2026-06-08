# Provider 体系架构

## 概述

RDC-Agent 的 provider 体系采用分层解耦设计：把 provider 的「身份」「认证方式」「协议形态」「产品分组」「能力声明」拆成正交维度，分别在共享类型、Settings 层和 Agent Runtime 层落地。`Settings` 负责把 provider 描述（`LlmProviderEntry`）落地到磁盘并管理凭据与发现状态，`Agent Runtime` 负责按 `providerId + modelId` 路由到具体的协议实现。两层共享 `src/shared/types/settings.ts` 中的 provider 类型定义和 `src/shared/constants/llm.ts` 中的 builtin 清单，以确保跨层契约只有一处事实来源。

本文件描述当前 provider 体系的稳定结构，对应代码入口在 `src/main/settings`、`src/main/agent-runtime` 和 `src/shared`。运行时执行链以 `Agent Runtime` 为权威，HTTP provider adapter 不决定 mode、stage、approval 或 tool policy。

## 核心概念

Provider 模型的五个维度互相正交：身份用 `LlmProviderEntry` 表达；协议形态用 `LlmProviderKind` 表达；认证方式用 `LlmProviderAuthMode` 表达；产品分组用 `LlmProviderCatalogGroup` 表达；能力声明用 `LlmProviderCapability` 数组表达。任意维度都不应被另一维度的取值反推。

### Provider Profile (LlmProviderEntry)

`LlmProviderEntry` 是供应商/服务入口的稳定身份描述，承载从 UI 展示到运行时路由所需的全部 metadata：

- canonical provider id（`id`）：全局唯一标识，对应 `BuiltinLlmProviderId` 或自定义 string id。
- 显示名 (`label`)：Settings UI 与日志中展示的可读名称。
- 产品分组 (`catalogGroup`)：决定在 Settings UI 中所属的产品分组卡片。
- 协议种类 (`kind`)：决定 wire protocol 适配器实现。
- 认证方式 (`authMode`)：决定凭据采集与刷新流程。
- 能力声明 (`capabilities`)：描述该 provider 当前支持的功能集合。
- 默认模型 (`recommendedModels`)：内置候选模型 id 列表，仅作为推荐入口，不等同于「已发现」或「已验证」。
- 模型发现策略 (`modelDiscovery`)：标识使用哪一种发现策略（OpenAI 兼容 list、Anthropic candidate validation、Google AI Studio、Azure list、Ollama tags、account catalog、static 等）。
- 运行状态 (`status`)：`unconfigured` / `verified` / `failed` / `unavailable`。
- 诊断信息 (`lastError`, `unavailableReason`)：分别承载最近一次连接/验证错误，以及 provider 在当前环境下不可用的稳定原因（例如缺少必要 SDK、缺少授权流）。

### Protocol Kind (LlmProviderKind)

协议层分类 — 表示 wire protocol 级别的差异，与认证方式和产品分组解耦：

- `openai-compatible`：OpenAI Chat Completions / Responses API 形态。
- `anthropic`：Anthropic Messages API 形态。
- `google-ai-studio`：Google Generative Language（AI Studio / Gemini）原生协议。
- `azure-openai`：Azure 托管的 OpenAI 部署，endpoint 路径、版本与认证方式与原生 OpenAI 不同。
- `bedrock`：AWS Bedrock 调用 API，使用 AWS 凭据链签名。
- `vertex`：Google Cloud Vertex AI，使用 GCP 凭据链签名。
- `openrouter`：OpenRouter 网关，使用 OpenAI 风格 wire 协议并扩展额外 headers。
- `ollama`：Ollama 本地运行时，提供 OpenAI 风格 endpoint。

### Auth Mode (LlmProviderAuthMode)

认证方式 — 表达 HOW to authenticate，决定 settings 层选择哪条凭据采集路径：

- `api-key`：用户输入 API key，明文只进入 `SecretStorageService`。
- `account`：OAuth / Device Flow 账户登录，由 `ProviderAccountAuthService` 维护 token 与刷新状态。
- `environment`：使用运行环境凭据（AWS/GCP credential chain），settings 仅保存状态和模型列表。
- `local`：本地服务无需远程凭据。

### Catalog Group (LlmProviderCatalogGroup)

产品展示分组 — 决定 Settings UI 中条目所在的产品分组卡片，独立于 `authMode`：

- `account`：登录授权类入口（如 Claude / ChatGPT / GitHub Copilot / Grok / Gemini / Qwen account）。
- `openai-compatible`：OpenAI Chat Completions 兼容端点。
- `anthropic-compatible`：Anthropic Messages 兼容端点。
- `cloud-platform`：云平台托管供应（Azure / Bedrock / Vertex 等）。
- `local`：本地运行时（Ollama 等）。
- `image`：图像生成 skeleton 分组，当前迭代不挂载具体 provider。

### Capability (LlmProviderCapability)

能力声明 — provider 在当前环境下支持的功能 flag，用于运行时能力查询和 UI 能力提示：

- `chat`、`tool-calling`、`structured-output`、`reasoning`、`prompt-cache`、`vision-input`、`model-discovery`、`image-generation`、`video-generation`。

不在 capabilities 中声明的能力，调用方必须在请求前显式判定并提供 fail-closed 行为。

## 架构分层

### Settings 层（`src/main/settings/`）

Settings 层负责 provider 配置生命周期、凭据保管和 LLM 调用接入：

- `LLMAdapter`：Provider 工厂与 HTTP 调用入口，按 `kind` 选择对应的协议客户端（OpenAI、Anthropic、Google AI Studio、Azure OpenAI、Ollama 等）。
- `DebuggerLlmService`：把 `AgentRoute(agentId)` 解析成 `providerId + modelId`，调度到 `LLMAdapter`，并对外暴露 Debugger 主链消费的 chat 接口。
- `ProviderAccountAuthService`：Claude / ChatGPT / GitHub Copilot / Grok / Gemini / Qwen 等账号 provider 的 OAuth/Device Flow 状态机，负责发起授权、刷新 token、判定 `available/connected` 状态。
- `ProviderConnectionService`：API key / local / environment provider 的连接管理，统一处理 `Connect` 与 `Test` 动作。
- `SecretStorageService`：API key 与账号 token 的加密落盘；`settings:get` 与 detail 二次打开禁止把已存密钥回传 renderer。
- `MediaRuntimeService`：图像生成入口，当前实现为 fail-closed skeleton，对所有请求返回 `adapter-not-implemented`。

### Agent Runtime 层（`src/main/agent-runtime/`）

Agent Runtime 层负责按 `Model.api` 中携带的 `providerId + modelId` 选择协议策略：

- `ProviderRegistry`：Provider 策略注册表，按 `LlmProviderKind` 注册具体实现。
- `ModelRegistry`：模型元数据登记入口，记录可路由的 `(providerId, modelId)` 集合。
- `providers/`：协议实现层，包含 OpenAI、Anthropic、Gemini、Ollama 等策略，承担 stream 协议适配、tool request 编解码与 provider-specific 错误归一化。
- `LLMAdapterProvider`：把 Agent Runtime 的策略调用桥接到 Settings 层的 `LLMAdapter`，确保 Agent Runtime 不重复维护一份 HTTP 客户端。

### 共享类型（`src/shared/`）

跨层契约只在 `shared` 中定义一次：

- `types/settings.ts`：`LlmProviderEntry`、`LlmProviderKind`、`LlmProviderAuthMode`、`LlmProviderCatalogGroup`、`LlmProviderCapability`、`LlmProviderModelDiscoveryStrategy`、`LlmProviderConnectionStatus` 等 provider 相关类型。
- `constants/llm.ts`：当前 48 个 builtin provider 的稳定描述，作为初始化时的来源；workspace settings 优先于 builtin。

## 路由机制

Provider 路由完全基于 `providerId + modelId`，**不依赖 model name 前缀**或字符串前缀匹配。

### Settings 层路由

```
AgentRoute(agentId) → providerId + modelId → LlmProviderEntry → LLMProvider.chat()
```

`DebuggerLlmService` 拿到 `AgentRoute` 后，先在 `LlmSettings.providers` 中按 `providerId` 找到 `LlmProviderEntry`，再交由 `LLMAdapter` 按 `kind` 选择协议客户端发起请求。

### Agent Runtime 路由

```
Model.api → ProviderRegistry → ProviderStrategy.stream()
```

Agent Runtime 拿到 `Model.api` 中的 `providerId` 后，从 `ProviderRegistry` 查询策略实例；策略需要发起 HTTP 请求时通过 `LLMAdapterProvider` 桥接到 Settings 层，避免在 runtime 内重复维护凭据和 baseUrl。

## Fail-Closed 策略

Provider 体系遵循 fail-closed 原则：缺凭据、缺配置或缺能力时直接返回明确错误，不静默降级或随机选择 provider。

- Provider 不存在 → 明确 throw Error，不退化到任意可用 provider。
- Provider disabled → 明确 throw Error，UI 可以展示该条目但运行时不会路由到它。
- Secret 缺失 → 返回 Blocker 错误码，由上层把诊断同步给 conversation message 与 Activity。
- Media request → 在 `MediaRuntimeService` 当前实现下统一返回 `adapter-not-implemented`，不进入 chat runtime。

## 配置迁移

provider 配置的迁移在 settings 加载阶段完成，对运行时透明：

- Retired provider id 在加载时按内置映射规范化为当前 canonical id，以便老 workspace 仍可恢复。
- `catalogGroup` 旧值在加载时映射到新产品分组（例如 legacy 的认证导向分组迁移到产品导向分组）。
- 迁移失败时保留原值并写入 settings 诊断，**不静默删除**用户配置；后续可在 UI 中提示用户清理。
