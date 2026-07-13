# Provider / Model Capability 架构

本文描述 RDC-Agent 当前唯一的 Provider、模型目录、能力判定和请求编译路径。产品边界以根目录 `DESIGN.md` 为最高权威；代码契约以 `src/shared/types/providerCapability.ts`、`EffectiveCatalogService` 和 `RequestPlanner` 为准。

## 核心不变量

- `EffectiveModel` 是模型 capability 的唯一真相；Settings、Runtime、workflow 和 renderer 不得导入静态模型目录或按模型名猜能力。
- Runtime 只消费 `EffectiveCatalogService` 的快照和 `RequestPlan`，adapter 不得重新解析 Max、Fast、reasoning、temperature 或 budget。
- `ProviderPreset` 只能包含 JSON-serializable 数据，不能包含函数、token、API key 或账号信息。
- provider identity 按产品 surface 拆分；`vendorId` 只用于展示分组，不能合并 ChatGPT Account、OpenAI API、Grok Account、xAI API 等不同授权面。
- 缓存键为 `(providerId, accountId, protocol)`；evidence 主键为 `(providerId, accountId, modelId)`，协议证据记录在 evidence 内。
- 认证秘密不进入 `EffectiveModel`、`RequestPlan`、项目 `.rdx`、Settings 导出或会话真相。

## 端到端数据流

```text
ProviderPreset seed
  -> discovery
  -> protocol overlay
  -> account entitlement
  -> observed evidence
  -> allowed user preference
  -> EffectiveCatalogService
  -> EffectiveModel + leaf provenance
  -> RequestPlanner(turn controls)
  -> RequestPlan
  -> provider adapter
  -> wire request
```

`ConversationService`、`ContextManager`、`AgentOrchestrator`、`DebuggerLlmService`、Settings IPC、preload、browser bridge 和 renderer 均沿这条路径读取能力。不存在旧 resolver、legacy capability projection、静态 catalog runtime fallback 或新旧字段双写。

## 公共契约

### EffectiveModel

`EffectiveModel` 至少包含模型 identity、route、availability、context tiers、client default budget、Fast、reasoning、tools、vision、structured output、constraints 和字段级 provenance。`CapabilityState` 与 entitlement 均使用 `supported/granted`、`unsupported/denied`、`unknown` 三值语义，不能提前压成布尔值。

`ContextTier` 描述服务端档位：

- 上限：`maxPromptTokens` 可缺省；缺省表示未知，不表示 256K。
- 激活：`implicit`、`header`、`body` 或 `model-variant`。
- entitlement：`granted`、`denied` 或 `unknown`。

`defaultBudgetTokens` 是客户端预算，不是服务端窗口声明。当前默认值可为 256K，但实际 request budget 始终取客户端预算与已知 tier 上限的较小值。

### RequestPlan

`RequestPlanner` 是纯函数，输入 `EffectiveModel + turn controls`，输出 `RequestPlanningResult`：成功时包含闭合的 `RequestPlan`、clamp 后 controls 和 warnings；失败时返回 typed error。它统一编译：

- tier 的 header/body/model-variant 激活；
- Fast 的 request patch、model variant 或 client tier；
- reasoning wire profile；
- fixed temperature；
- client budget；
- 声明式 `when + clamp/reject + reason` constraints。

两个 activation 写入同一 wire leaf 且值不同会返回 `PLAN_CONFLICT`，不得静默覆盖。API key、access token、refresh token 和 secret ref 永远不进入 plan。

### ProviderPreset

每个 builtin provider 在 `src/main/settings/presets/` 中拥有一个与 provider id 同名的文件。`schemaVersion` 当前固定为 `1`。preset 可声明 lifecycle status、availability、认证模式、route、seed、overlay、discovery 和推荐模型。

多认证 provider 使用 `authModes` 与 `authModeAvailability`：例如 Cline 同时声明 API key 与 OAuth，但在没有稳定公开 OAuth 契约时只开放 API key 子模式。UI 首版仍只操作 active account；account-keyed schema 已允许后续账号切换而不改变 runtime 真相模型。

## 六层字段级合并

合并顺序从低到高固定如下：

1. `seed`：仓库保守基线；
2. `discovery`：账号或 endpoint 当前返回的模型事实；
3. `overlay`：按 `(modelId, protocol)` 生效的协议差异；
4. `entitlement`：账号计费档位、订阅模型组等授权事实；
5. `observed`：真实请求产生的确定性证据；
6. `user`：ownership 允许范围内的偏好。

合并是 leaf-level，不是整对象替换。每个最终 leaf 记录 winning source、观测时间、可选过期时间、协议和说明。app-managed provider 的 user 层只能改 enabled/default reasoning/client budget 等白名单字段，不能改 route、服务端 tier 或 entitlement；user-managed provider 可改 endpoint、protocol 和模型定义。

Observed 历史保存在 app state，按时间采用最新确定性证据。Discovery 使用 24 小时 TTL、stale-while-revalidate、single-flight refresh 和 last-known-good；刷新失败只把快照标 stale 并记录错误，不清空 LKG。缓存与 evidence 不写入项目 `.rdx`、Settings 导出或 session truth。

## Max、Fast 与 unknown

Max 不按 token 数字推导：

- 至少两个 granted tier：Max 选择最高 granted tier；
- 一个 granted tier，且存在更高 unknown tier：显示“未验证”，首次真实使用可产生 evidence；
- 单 tier且无更高候选：隐藏 Max；
- denied tier：不可选择。

Fast 由 `FastCapability` 声明 activation 和 entitlement。未知 activation 不显示可操作开关；不得再使用 `fastVariantModelId` 旁路。

| 能力 | `unknown` 消费策略 | `unsupported` 消费策略 |
| --- | --- | --- |
| tool calling | fail-open，发送 native tools，并标记 unverified | text-only |
| vision input | fail-closed，不发送图片 | disabled |
| structured output | prompt fallback | prompt fallback |

Azure OpenAI、AWS Bedrock 和 Vertex 在没有本库 adapter 时统一标记 unavailable，Settings 和 Runtime 展示同一 reason。

## Route 与协议切换

route 优先级固定为：模型级固定 route > 用户协议 enum > preset 默认 route。模型固定 route 时 Settings 锁定协议选择。Overlay 必须以 `(modelId, protocol)` 为键。

协议切换会使旧 `(providerId, accountId, protocol)` discovery cache 失效，重新 discovery 和 projection，并对会话 turn controls 重新 clamp。失败时返回显式错误，不能静默切回旧协议。

OpenCode Go 是模型级 route 的代表：动态目录解析器按模型元数据分别固定 `AnthropicMessages`、`OpenAIResponses` 或 `OpenAICompatibleChatCompletions`。LongCat 则是 provider 可选择双 route 的代表。

## Discovery、quota 与模型消失

Discovery admission 会过滤 embedding、rerank、图像、音频和无证据 alias；preset 可继续声明 allow/deny patterns 和 modality 白名单。HTTP 429 只产生包含 `Retry-After`/reset 的瞬态 quota，不会把 capability 降级，且 quota 不持久化。

模型从目录消失时：

1. 若存在 canonical alias，自动跟随 alias；
2. 否则返回同 provider 推荐模型供用户选择；
3. 当前请求返回 `MODEL_UNAVAILABLE`，禁止静默替换。

## Adapter / preset 边界白名单

只需新增或修改 preset 的情况：

- 已有 wire protocol；
- 已有认证 header 形态；
- 标准 JSON catalog 可用声明式 mapping 描述；
- 差异仅为 base URL、header、seed、overlay、admission 或 lifecycle。

只有下列情况允许写 adapter/service 代码：

- 新 wire protocol 或 request signing；
- OAuth、PKCE、device flow、refresh 或 subprocess/ACP；
- 无法由 JSON mapping 表达的动态 catalog；
- provider-specific streaming/usage/reasoning wire 解析。

不得因模型列表不同复制 adapter，也不得把 capability 表写进 adapter。

## 用纯 preset 新增 provider

1. 在 `src/main/settings/presets/<provider-id>.ts` 创建 `schemaVersion: 1` 的声明。
2. 选择现有 route protocol，并填写官方 base URL、认证模式和 lifecycle。
3. 优先使用 `json-catalog`，声明 collection path、字段 mapping 和 admission；确无稳定 endpoint 时标 `beta + unavailable`，不要猜。
4. seed 只放离线保守兜底；账号动态目录不得伪装成静态完整表。
5. 在 `presets/index.ts` 注册；不得从 renderer/runtime 直接 import preset。
6. 为 discovery 增加固定 fixture，验证解析、过滤、route 和 context metadata。
7. 执行 `pnpm test`、`pnpm run typecheck`、`pnpm run check:provider-system`。

纯 preset provider 不得修改 adapter。当前数据型条目包括 iFlow、LongCat、OpenCode Zen、Together AI、Fireworks AI、Novita AI、Synthetic、Chutes、LM Studio、NVIDIA NIM、GitHub Models 和 Ollama Cloud。

## 认证生命周期

OAuth refresh 统一经 `(providerId, accountId)` keyed single-flight manager：到期 skew、并发去重、旋转 refresh token 原子提交和 `invalid_grant` 隔离使用同一机制。401 只允许在尚未输出 stream 内容时刷新并重试一次；已有内容后禁止重放请求。

OpenRouter PKCE 按公开契约生成 S256 challenge、打开 localhost callback，并把 `/api/v1/auth/keys` 交换结果作为 API key 存储；它没有 refresh token。MiniMax global/CN contract 固定参考 `NousResearch/hermes-agent@dfeedf613dcd2ca97d0903ad7fcacad118e39bca`，两区均复用 `AnthropicMessages` adapter，并经通用 refresh manager 提交旋转 token；在账号实测前保持 unavailable。Cline OAuth 没有稳定公开 endpoint/callback 契约，因此不注册 flow。

Gemini Account 和 Qwen Account 只有 `beta + unavailable` 空 preset 骨架，不注册测试 flow、伪 token 或静态账号模型表。

## Fixture 与验证门禁

外部行为一律使用固定 fixture；单元测试不得真实登录或发送推理。至少覆盖：

- 六层 merge 的缺层组合、冲突、账号隔离、TTL/SWR/LKG 和 provenance；
- RequestPlanner golden cases 与 typed errors；
- data-only、动态 catalog 和 OAuth contract fixtures；
- 冻结 representative EffectiveModel fixture；
- unknown 策略表；
- route precedence、protocol overlay、cache invalidation 和 session clamp。

`pnpm run check:provider-system` 还静态禁止 runtime import preset/static catalog、旧 resolver、`ResolvedModelCapability`、`fastVariantModelId`、1M Max 常量、`BUILTIN_LLM_PROVIDER_DEFINITIONS`、不可序列化 preset 和绕过 RequestPlan 的 adapter 调用。

## 活体验证清单

以下项目必须由账号所有者在后续交互 session 执行。验证前备份 `~/.rdx`，使用测试会话，不提交凭据或运行期 state。

### 1. MiniMax global / CN

步骤：分别选择 global 与 CN；完成 PKCE user-code 登录；刷新目录；用可撤销的小请求确认 `AnthropicMessages` route；等待 access token 进入 60 秒 refresh skew 后并发发起两个无内容请求；注销。

预期：global 使用 `api.minimax.io/anthropic`，CN 使用 `api.minimaxi.com/anthropic`；同账号只发生一次 refresh；旋转 refresh token 原子保存；旧 token 不再出现；目录模型可选。任一字段与固定参考不符时保持 unavailable 并更新 fixture，不现场猜契约。

### 2. Cline API key / OAuth / ClinePass

步骤：先以 API key 连接并刷新目录；确认普通模型与目录明确标注的 ClinePass 模型组；再由账号所有者提供当前官方登录契约，审查 endpoint、scope 和 callback 后才临时启用 OAuth 子模式。

预期：API key 可用；只有显式 `cline-pass` group 产生 granted entitlement；普通模型 entitlement 保持 unknown。若仍无公开 OAuth 契约，OAuth 必须继续 unavailable。

### 3. OpenRouter localhost PKCE

步骤：选择 OAuth 子模式；启动 localhost callback；浏览器授权；用返回 code 与 verifier 交换 key；刷新模型目录；本地注销并检查 secret store。

预期：authorize URL 含 callback、S256 challenge；交换响应只把 `key` 保存为 API key，不保存 code/verifier，不出现 refresh token；注销删除本地 account secret，现有独立 API key 配置不被误删。

### 4. GitHub Copilot default / long_context

步骤：登录 Copilot；保存 `/models` 原始脱敏 fixture；检查 `billing.token_prices.default.context_max` 与 `long_context.context_max`；分别选择默认档和 Max 发起一次明确允许的请求。

预期：默认档按账号值（例如 272K），long_context 按账号值（例如 922K），激活为 implicit；缺 entitlement 时 UI 显示未验证，不硬推 1M；只有目录/实测确认后变为 granted/denied。

### 5. Grok account surface

步骤：完成 Super Grok browser/device OAuth；记录 `/v1/models` 脱敏目录；与当前 Web 和 Builder 可见模型对照；刷新、重新登录并模拟目录移除。

预期：RDC-Agent 只显示账号 API 实际返回的目录，不回落 `grok-4.5/4.3` 静态表；Web/Builder 差异只作为 surface evidence，不按模型名补齐；空目录显式失败。

### 6. Claude Account / Anthropic API 1M

步骤：Claude Account 选择 Max 并检查请求 header；直连 Anthropic 的现代模型选择 Max 并检查 wire request；分别记录成功、403/400 或 capability 响应。

预期：Claude Account 1M 通过 `anthropic-beta: context-1m-2025-08-07` 激活，初始 entitlement unknown；直连现代 Anthropic 1M 为 implicit granted，不添加该 header；实测结论进入对应账号 evidence，互不污染。

### 7. ChatGPT Account Codex surface

步骤：登录 ChatGPT Account；保存 Codex catalog 脱敏响应；检查 context 与 Fast；搜索 Settings/Composer 是否出现 Web Instant、Thinking 或 Pro；用允许的请求确认 Fast patch。

预期：context 完全采用 Codex surface 返回值，不按 GPT 版本硬推；Fast 编译为 `service_tier: priority`；Web Instant/Thinking/Pro 不可见也不可构造请求。Codex 限制变化只更新 discovery/evidence。

### 8. 模型真实下架

步骤：在测试账号记录现有模型，随后使用提供“已移除模型”的 fixture 或等待真实下架；保持旧会话 route 并刷新目录；分别测试有 canonical alias 与无 alias 两种情况。

预期：有 alias 时显式跟随 canonical model；无 alias 时返回 `MODEL_UNAVAILABLE` 和同 provider 推荐项，当前请求不自动换模型；会话历史 route 和原模型 id 仍可审计。

## 外部契约来源

- OpenRouter OAuth PKCE：<https://openrouter.ai/docs/use-cases/oauth-pkce>
- OpenCode Go：<https://opencode.ai/docs/go/>
- Cline API：<https://docs.cline.bot/cline-api>
- xAI API：<https://docs.x.ai/docs/api-reference>
- MiniMax 待验证固定参考：<https://github.com/NousResearch/hermes-agent/blob/dfeedf613dcd2ca97d0903ad7fcacad118e39bca/hermes_cli/auth.py>

外部文档只用于定义 endpoint/flow/fixture；运行时 capability 仍由账号目录、entitlement 和 observed evidence 决定。
