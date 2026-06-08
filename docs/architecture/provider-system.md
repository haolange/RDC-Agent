# Provider 体系架构

## 概览

RDC-Agent 的 Provider 体系把“身份、认证方式、协议形态、产品分组、能力声明”拆成互相正交的维度：

- `LlmProviderEntry`：Provider 的稳定身份与运行时元数据。
- `LlmProviderKind`：HTTP wire protocol，例如 `openai-compatible`、`anthropic`、`bedrock`。
- `LlmProviderAuthMode`：认证方式，例如 `api-key`、`account`、`environment`、`local`。
- `LlmProviderCatalogGroup`：Settings UI 的产品展示分组。
- `LlmProviderCapability`：能力声明，用于运行时和 UI 的 fail-closed 判断。

这些类型只在 `src/shared/types/settings.ts` 定义，内置 Provider 清单只在 `src/shared/constants/llm.ts` 维护。跨层代码不得复制这些 union 或从某个维度反推另一个维度。

## 正交维度

### Protocol Kind

`LlmProviderKind` 表示请求/响应协议差异，只决定 adapter 或 strategy 的 wire 行为，不决定 Settings 分组或认证流程。

当前协议类型：

- `openrouter`
- `openai-compatible`
- `anthropic`
- `google-ai-studio`
- `azure-openai`
- `bedrock`
- `vertex`
- `ollama`

### Auth Mode

`LlmProviderAuthMode` 表示用户如何授权：

- `api-key`：用户提供 API Key，明文只进入 `SecretStorageService`。
- `account`：OAuth / Device Flow 账号登录，token 由账号授权服务维护。
- `environment`：运行环境凭据，例如 AWS/GCP credential chain。
- `local`：本地运行时，不需要远程凭据。

### Catalog Group

`LlmProviderCatalogGroup` 只决定 Settings UI 位置：

- `account`
- `openai-compatible`
- `anthropic-compatible`
- `cloud-platform`
- `local`
- `image`

`catalogGroup` 不等于 `authMode`。旧 settings 中的 `api-key`、`environment` 等认证导向旧值只允许作为迁移输入，加载后必须归一到新的产品导向分组。

### Capability

`LlmProviderCapability` 是 Provider 能力事实来源。调用方在使用 `tool-calling`、`structured-output`、`reasoning`、`vision-input`、`image-generation`、`video-generation` 等能力前必须显式检查；未声明能力按 fail-closed 处理。

## 分层职责

### Shared

`src/shared/types/settings.ts` 和 `src/shared/constants/llm.ts` 是跨层契约来源。Renderer、preload、main 和 Agent Runtime 只能导入这些定义，不得在本层重新声明 provider kind/group/capability。

### Settings

`src/main/settings` 负责 Provider 配置生命周期、凭据保管、连接测试、模型发现和配置迁移：

- `SettingsService`：加载、归一化和持久化 settings。
- `providerCatalogGroup.ts`：把旧 `catalogGroup` 输入归一到新产品分组。
- `ProviderConnectionService`：处理 API key/local/environment Provider 的连接和测试。
- `ProviderAccountAuthService`：处理 account Provider 的授权状态。
- `SecretStorageService`：保存 API key 和 account token。
- `MediaRuntimeService`：media generation fail-closed skeleton。

### Agent Runtime

Agent Runtime 以 `providerId + modelId` 路由，不依赖模型名前缀或字符串猜测。Provider strategy 只负责协议适配、stream 编解码、tool request 编解码和错误归一化，不决定 mode、stage、approval 或 tool policy。

## Fail-Closed 规则

- Provider 不存在、禁用或未配置时，运行时必须返回明确错误，不自动降级到任意 Provider。
- Secret 缺失时，上层把诊断同步到 conversation / Activity，不暴露 secret。
- 未声明 capability 时，调用方不得尝试对应能力。
- Media request 当前统一由 `MediaRuntimeService` 返回 `adapter-not-implemented`，不得进入 chat runtime。

## Settings UI

Settings > Providers 使用 `catalogGroup` 展示产品分组，同时保留 `authMode` 驱动的连接方式：

- Account Provider 单独展示。
- API key/local/environment Provider 留在同一 Provider catalog 中，以产品分组标签区分。
- `unavailableReason` 非空的 Provider 仍显示，但以不可用视觉状态标记，不静默删除。
- Connect dialog 根据 `authMode` 切换 API key、local、environment 或 account flow。

## 验证

Provider 体系的最小验证集合：

- `npm run typecheck`
- `npm run test:provider-system`
- `npm run check:shared-exports`
- `npm run check:fidelity`
- `npm run check:architecture`

涉及 Settings UI 结构、样式或状态展示时，补充 `npm run test:browser-session` 或等价浏览器真实会话检查。
