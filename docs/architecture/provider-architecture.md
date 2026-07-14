# Provider / Model Capability 架构

本文描述 RDC-Agent 当前唯一的 Provider、模型目录、能力判定和请求编译路径。产品边界以根目录 `DESIGN.md` 为最高权威；代码契约以 `src/shared/types/providerCapability.ts`、`EffectiveCatalogService` 和 `RequestPlanner` 为准。

## 核心不变量

- `EffectiveModel` 是模型 capability 的唯一真相；Settings、Runtime、workflow 和 renderer 不得导入静态模型目录或按模型名猜能力。
- Runtime 只消费 `EffectiveCatalogService` 的快照和 `RequestPlan`，adapter 不得重新解析 1M、Fast、reasoning、temperature 或 budget。
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

- 上限：`maxTotalTokens` 是完整窗口，`maxPromptTokens` 是输入上限，`maxOutputTokens` 是输出预留；任一缺省都表示未知，不能拿 256K 补成服务端事实。
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

当前 registry 共加载 61 个 builtin preset。数量不是 capability 完整性的依据：每个 provider 是否可用，仍由所选认证模式、adapter、discovery 和 fixture 的闭环决定；缺少稳定公开契约的条目必须 truthful unavailable。

### Settings 目录投影与用户偏好

Settings 对 app-managed provider 始终投影当前 `EffectiveCatalogSnapshot.models` 的完整目录；持久化的 `provider.models` 只保存 D2 允许的模型偏好（enabled、默认 reasoning、客户端 budget），不能决定目录成员、label、availability、route 或服务端 tier。每个连接对话框只建立一次快照读取和一次更新订阅，目录刷新后前端按同一 `(providerId, accountId, protocol)` 真相重投影。

账号目录把旧模型 id 收敛为 canonical id 时，偏好更新按 canonical id 与 aliases 合并、重键，不生成重复行。user-managed provider 则继续以用户保存的模型定义为目录，并在存在 EffectiveModel 时叠加能力状态。Settings、Composer 和 Runtime 因而看到相同的模型可用性、1M/Fast、route 与 unavailable reason。

## 六层字段级合并

合并顺序从低到高固定如下：

1. `seed`：仓库保守基线；
2. `discovery`：账号或 endpoint 当前返回的模型事实；
3. `overlay`：按 `(modelId, protocol)` 生效的协议差异；
4. `entitlement`：账号计费档位、订阅模型组等授权事实；
5. `observed`：真实请求产生的确定性证据；
6. `user`：ownership 允许范围内的偏好。

合并通常是 leaf-level；`reasoning`、`fast`、`wireProfile` 和 tier `activation` 等 discriminated union 在 `kind` 改变时必须原子替换，禁止把旧分支的 `lockedSelection`、header 或 request patch 深合并进新分支。每个最终 leaf 记录 winning source、观测时间、可选过期时间、协议和说明。app-managed provider 的 user 层只能修改已被 seed/discovery 接纳模型的 enabled/default reasoning/client budget，不能创建目录成员、改 route、服务端 tier 或 entitlement；user-managed provider 才可定义 endpoint、protocol 和模型。

Observed 历史保存在 app state，按时间采用最新确定性证据。Discovery 使用 24 小时 TTL、stale-while-revalidate、single-flight refresh 和 last-known-good；刷新失败只把快照标 stale 并记录错误，不清空 LKG。缓存与 evidence 不写入项目 `.rdx`、Settings 导出或 session truth。

### 账号身份、凭据与持久化事务

Settings schema v2 用 `activeAccountId + authAccountIds[authMode]` 关联账号；secret ref 同时按 `(providerId, accountId, credential kind)` 分区。OAuth 优先采用上游返回的稳定 account id，缺失时生成 opaque 本地 id；API key 内容变化会轮换 account id，使旧账号的 discovery/evidence 不会污染新凭据。

凭据迁移、OAuth 登录和 refresh token 旋转遵守“先写新 secret → 提交 Settings → 再删除旧 secret”的顺序。提交失败时旧引用仍可恢复；成功后不保留旧 secret ref、旧字段双写或 provider 级共享 token。UI 当前只操作 active account，但缓存、evidence、刷新锁和 secret storage 已全部 account-keyed。

## 1M、Fast、reasoning 与 unknown

`1M` 是明确的上下文产品模式，而不是“选最高档”：

- eligibility 按完整窗口判断；922K prompt + 128K output 属于 1M-class；
- 一个 1M-class tier 可以同时承担 normal 与 1M，normal 使用 provider default/256K client budget，开启后使用 `min(1M, prompt cap)`；
- 不足 1M 的模型隐藏开关并直接使用实际窗口；超过 1M 的未来窗口也只投递 1M，不暗中扩成更高档；
- unknown entitlement 显示 `1M · 未验证`，短请求成功不得写成 granted；denied 不可选择。

Fast 由 `FastCapability` 声明 activation 和 entitlement。未知 activation 不显示可操作开关；不得再使用 `fastVariantModelId` 旁路。

`ReasoningControl.kind = unknown` 表示缺少 exact surface 证据，Composer 显示中性的 `未验证 / Provider managed`；`none` 只表示已确认不支持。Canonical named level 使用 `xhigh`，UI 显示 `XHigh`，不存在 `extra` 兼容别名。对于两个 live canonical id 组成的 reasoning variant family，`Off/On` 只切换 `effectiveModelId`，Planner 不发送虚构 reasoning 参数。

| 能力 | `unknown` 消费策略 | `unsupported` 消费策略 |
| --- | --- | --- |
| tool calling | fail-open，发送 native tools，并标记 unverified | text-only |
| vision input | fail-closed，不发送图片 | disabled |
| structured output | prompt fallback | prompt fallback |

`tool calling: unknown` 在 Settings 中显示为 `未验证 / Unverified`，不是失败状态。native protocol 在该状态下 fail-open 注册 tools，但只写 `route_tool_calling_unverified` / `info` 到 runtime log，不把非 actionable 提示塞进 transcript。显式 `unsupported` 使用 `route_tool_calling_unsupported` / `warning` 且不注册 tools；route 不可用或禁用使用 `route_tool_calling_disabled` / `error`。diagnostic 必须携带结构化 `code + severity + message + surface`，renderer 不得把所有级别统一渲染为红色。

当 provider adapter 第一次产出合法 `toolcall_end` 时，runtime 以当前 `(providerId, accountId, protocol, canonical modelId)` 写入 `toolCalling: supported` observed evidence，并广播新的 EffectiveCatalog snapshot；同一 run 只提交一次。若 provider 的目录协议与模型固定执行 route 不同，observed evidence 仍按模型的实际 route protocol 投影回 provider catalog snapshot，不得因目录协议过滤而让 Settings 长期停留在 Unverified。文本伪 tool call、工具自身执行失败和网络错误都不是 capability evidence，不能触发该写入。

Azure OpenAI、AWS Bedrock 和 Vertex 在没有本库 adapter 时统一标记 unavailable，Settings 和 Runtime 展示同一 reason。

## 显式 capability 探测

Settings 的模型能力测试只在用户明确点击后运行，不做后台试探。请求沿唯一生产链 `PromptPlan -> RequestEnvelope -> RequestPlan -> provider adapter` 发送，工具列表为空、输出上限为 1 token，并记录脱敏 request snapshot；认证秘密仍不进入 plan 或 snapshot。探测支持 default、1M context 和 Fast 三种模式，先经过同一 constraint evaluator，不能绕过 Planner 强行拼 wire 字段。

只有确定性结果写入 observed evidence：成功可确认实际采用的 tier/Fast；HTTP 400/403 可拒绝本次明确激活的 tier 或 Fast；404 可标记模型 unavailable。HTTP 429 只更新瞬态 quota，不降级 capability。未知且 implicit 的长上下文档位不能用极短请求证实，必须返回 inconclusive，并留到真正跨越默认阈值的用户请求产生证据。

## Route 与协议切换

route 优先级固定为：模型级固定 route > 用户协议 enum > preset 默认 route。模型固定 route 时 Settings 锁定协议选择。Overlay 必须以 `(modelId, protocol)` 为键。

协议切换会使旧 `(providerId, accountId, protocol)` discovery cache 失效，重新 discovery 和 projection，并对会话 turn controls 重新 clamp。失败时返回显式错误，不能静默切回旧协议。

OpenCode Go 是模型级 route 的代表：动态目录解析器按模型元数据分别固定 `AnthropicMessages`、`OpenAIResponses` 或 `OpenAICompatibleChatCompletions`。LongCat 则是 provider 可选择双 route 的代表。

## Discovery、quota 与模型消失

Discovery admission 区分输入与输出 modality：text/vision chat（image input、text output）保留；image/video/audio generation、embedding、rerank 和无证据 alias 拒绝。HTTP 429、IP/网络错误只产生瞬态 quota/connection 诊断，不会把 capability 或模型永久下架，且不持久化为 account denial。

模型状态区分 live catalog omission、account entitlement、明确 policy denial 与瞬态网络/quota。available 才能进入新选择；unavailable/unknown 只在当前 session/agent 已引用时保留 disabled tombstone 和真实原因。模型从成功目录消失时：

1. 若存在 canonical alias，自动跟随 alias；
2. 否则返回同 provider 推荐模型供用户选择；
3. 当前请求返回 `MODEL_UNAVAILABLE`，禁止静默替换。

### Copilot 动态目录归一化

Copilot 只有当前账号 live `/models` 返回的 canonical id 才能进入目录；preset 的 `seedModels` / `recommendedModels` 均为空，账号未返回的 Claude 不得成为新选择。parser 读取 `supported_reasoning_efforts`、`default_reasoning_effort`、完整 `limits` 以及 `billing.token_prices.default/long_context.context_max`；两档 activation 都是 implicit。922K prompt + 128K output 投影为 1.05M 完整窗口。若 live billing 缺失、但 exact live model 命中维护的官方 overlay，可显示 `1M · 未验证`，短请求仍不能确认 entitlement。官方 overlay 只补充 exact live id，不能创建模型或 availability。

目录归一化把同一模型的标点差异 id 收敛为 provider 返回的 canonical id，并把旧 id 留作 alias；`*-fast` 目录项折叠进基础模型的 `FastCapability(kind: model-variant)`，不再作为第二个可选模型。没有 Fast variant 或目录证据的 Copilot 模型明确为 unsupported，避免把静态 seed、陈旧 tombstone 或重复 id 投影给用户。

### Exact surface capability matrix

- DeepSeek V4：reasoning 为 `Off / High / Max`；1M 是独立 context mode。Flash 是独立模型，不伪装成 Fast toggle。
- GLM-5：官方 200K 窗口，reasoning 为 `Off / On`；只有具体 live surface 明确返回 1M 才显示 1M。
- Anthropic Sonnet 5 直连：1M、reasoning `Off / Low / Medium / High / XHigh / Max`；Claude Account、proxy 和 Copilot 各自服从该账号 live surface，不能继承直连事实。
- Gemini：reasoning levels 按 exact model；Google 直连 1M 与 Copilot `long_context` 分别判定，不能跨 surface 推断。
- Super Grok：只有 `grok-4.20-0309-non-reasoning` 与 `grok-4.20-0309-reasoning` 同时 live 时才聚合成一个 `Off / On` family；缺一时保持单独 canonical model 并锁定真实 reasoning 状态。`grok-4.5` 是 500K、reasoning 不可关闭且只提供 `Low / Medium / High`。`grok-composer-2.5-fast` 只由 Builder live catalog 接纳。

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

Grok Account 使用 RDC-Agent 自己的 browser Authorization Code + PKCE 或 device flow，并保存自己的 token set。当前 xAI Grok Build public client 的实测 Browser 契约是：xAI consent 完成后显示一次性 authorization code，用户把 code 粘贴回 RDC-Agent，RDC-Agent 再以当前 PKCE verifier 交换 token。授权请求仍携带 public client 注册的 loopback-shaped redirect URI，但 RDC-Agent 不为 Grok 绑定 localhost callback server；一次性 code 不落盘、不进入日志或截图。Device Code 是远程/headless 的显式次选，UI 展示并允许复制 `user_code`，随后轮询 token；两种模式之间禁止静默 fallback。它不得读取、复制或迁移 Grok Builder/Grok CLI 的 `~/.grok/auth.json`、AppData 私有会话或 refresh token；共享旋转 token 会造成两个客户端相互踢下线。Browser OAuth 可以自然复用用户默认浏览器里已有的 xAI 登录 cookie，但这只是上游网页登录复用，不是凭据导入。

Super Grok discovery 并行读取 Builder `/models` 与 xAI API `/models`，按 canonical model id 合并，且 Builder contribution 对同 id 的执行 route 最终权威。`grok-composer-2.5-fast` 必须只由 live catalog 发现并以 `Composer 2.5` 展示；`seedModels` / `recommendedModels` 保持为空，不提供 `composer-2.5-fast` 别名、静态补齐或失败 fallback。

## Fixture 与验证门禁

外部行为一律使用固定 fixture；单元测试不得真实登录或发送推理。至少覆盖：

- 六层 merge 的缺层组合、冲突、账号隔离、TTL/SWR/LKG 和 provenance；
- RequestPlanner golden cases 与 typed errors；
- data-only、动态 catalog 和 OAuth contract fixtures；
- 冻结 representative EffectiveModel fixture；
- unknown 策略表；
- route precedence、protocol overlay、cache invalidation 和 session clamp。

`pnpm run check:provider-system` 还静态禁止 runtime import preset/static catalog、旧 resolver、`ResolvedModelCapability`、`fastVariantModelId`、旧 Max-context 常量、`BUILTIN_LLM_PROVIDER_DEFINITIONS`、不可序列化 preset 和绕过 RequestPlan 的 adapter 调用。

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

步骤：在 Settings > Providers 登录 Copilot；保存 `/models` 原始脱敏 fixture；检查 `supported_reasoning_efforts`、完整 limits 以及 `billing.token_prices.default.context_max` 与 `long_context.context_max`；确认同模型标点 alias 与 `*-fast` variant 已合并；分别选择 normal 与 1M 发起一次明确允许的请求。

预期：默认档按账号值（例如 272K），long_context 922K prompt + 128K output 按 1M-class 完整窗口投影，激活为 implicit；缺 entitlement 时 UI 显示 `1M · 未验证`；Fast variant 只显示为基础模型开关，不出现重复模型；未返回的 Claude 不进入新选择，只有目录/实测确认后 entitlement 才变为 granted/denied。

### 5. Grok account surface

步骤：在 Settings > Providers 打开 Super Grok Account，优先选择 browser code；只在已有 xAI 登录态的 Chrome 中完成 consent，复制 xAI 显示的一次性 code，粘贴回 RDC-Agent 并连接；或显式改用 device code。分别记录 Builder `/models` 与 xAI API `/models` 的脱敏目录；选择 live catalog 实际返回的模型并检查 `RequestPlan` route；刷新、重新登录并模拟目录移除。全程不得读取或导入 `~/.grok/auth.json`、AppData 私有会话或 Builder refresh token，也不得把一次性 code 写入日志、截图或 fixture。

预期：普通浏览器 cookie 可减少重复登录，但 RDC-Agent 生成并持有独立 token set；Builder 保持登录且不会因 RDC-Agent refresh 被挤下线。两个 live surface 按 model route 合并，Builder contribution 最终权威；只有 live Builder 返回 `grok-composer-2.5-fast` 时才显示 `Composer 2.5`。RDC-Agent 不回落静态表、不按模型名补齐，空目录显式失败。

### 6. Claude Account / Anthropic API 1M

步骤：Claude Account 选择 1M 并检查请求 header；直连 Anthropic 的现代模型选择 1M 并检查 wire request；分别记录成功、403/400 或 capability 响应。

预期：Claude Account 1M 通过 `anthropic-beta: context-1m-2025-08-07` 激活，初始 entitlement unknown；直连现代 Anthropic 1M 为 implicit granted，不添加该 header；实测结论进入对应账号 evidence，互不污染。

### 7. ChatGPT Account Codex surface

步骤：登录 ChatGPT Account；保存 Codex catalog 脱敏响应；检查 context 与 Fast；搜索 Settings/Composer 是否出现 Web Instant、Thinking 或 Pro；用允许的请求确认 Fast patch。

预期：context 完全采用 Codex surface 返回值，不按 GPT 版本硬推；Fast 编译为 `service_tier: priority`；Web Instant/Thinking/Pro 不可见也不可构造请求。Codex 限制变化只更新 discovery/evidence。

### 8. 模型真实下架

步骤：在测试账号记录现有模型，随后使用提供“已移除模型”的 fixture 或等待真实下架；保持旧会话 route 并刷新目录；分别测试有 canonical alias 与无 alias 两种情况。

预期：有 alias 时显式跟随 canonical model；无 alias 时返回 `MODEL_UNAVAILABLE` 和同 provider 推荐项，当前请求不自动换模型；会话历史 route 和原模型 id 仍可审计。

每项验证完成后都应：导出脱敏 fixture、确认 Settings 与 Composer 投影一致、注销本次测试账号或撤销测试 key、恢复测试前的 agent route，并确认 `~/.rdx` 中没有明文 secret、PKCE verifier、authorization code 或临时回调状态。

## 外部契约来源

- OpenRouter OAuth PKCE：<https://openrouter.ai/docs/use-cases/oauth-pkce>
- OpenCode Go：<https://opencode.ai/docs/go/>
- Cline API：<https://docs.cline.bot/cline-api>
- xAI API：<https://docs.x.ai/docs/api-reference>
- MiniMax 待验证固定参考：<https://github.com/NousResearch/hermes-agent/blob/dfeedf613dcd2ca97d0903ad7fcacad118e39bca/hermes_cli/auth.py>

外部文档只用于定义 endpoint/flow/fixture；运行时 capability 仍由账号目录、entitlement 和 observed evidence 决定。
