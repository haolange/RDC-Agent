# Provider / Model Catalog 架构

本文定义 RDC-Agent 唯一的 Provider、Model、Route、能力解析和请求编译链。产品语义以根目录 `DESIGN.md` 为最高权威；机器可验证契约位于 `src/shared/provider-catalog`、`src/shared/types/providerCapability.ts`、`EffectiveCatalogService` 与 `RequestPlanner`。

## 核心不变量

- 事实只来自严格 JSON manifest；TypeScript 只实现 Schema、编译器、Registry、Resolver、Planner、Adapter、认证和 Discovery 行为。
- 唯一链路是“声明 → 构建期编译 → 运行时解析”。禁止 TS 数据 preset、factory 推导、renderer 静态表或按名称猜测形成第二真值。
- `EffectiveModel` 是能力真值；`RequestPlan` 是一次请求的冻结执行真值。Adapter 不得重算 Fast、Max、1M、route、temperature 或 context budget。
- Conversation/Agent 调用不得注入隐藏的默认 	emperature；只有 manifest/route 明确固定的值或调用方显式选择才进入 RequestPlan，否则省略并交由 Provider 管理。
- 认证秘密不进入 manifest、`EffectiveModel`、`RequestPlan`、IPC、renderer、会话、journal 或 Trace。
- 未证实字段保持 `unknown`（Composer UI 呈现为灰掉的 `Disabled` / `禁用`，不发明档位；Settings 的能力摘要与默认档明确显示“未知”，不显示为关闭）；不得补写 256K、按后缀关联 variant，或按 provider 名、上游 SDK 包元数据、endpoint hostname 推断分类与协议。
- 当前账号 discovery、policy 和 entitlement 只能收窄账号可用性，不能把 manifest 中已证实的结构能力改成全局不支持。

## Manifest 分层

Catalog Kernel 位于 `src/shared/provider-catalog`，不依赖 Electron。

```text
manifests/identities/*.json
  固定 models.dev identity、上游 revision/hash、原始 provenance

manifests/profiles/*.json
  可复用的 protocol/auth/discovery/wire mechanics 引用
  不声明分类、operator、endpoint ownership 或模型能力默认值

manifests/surfaces/*.json
  RDC 展示 surface、分类、operator、endpoint、route、models、controls、bindings
  以及字段级 fact source
```

Manifest 使用 Zod strict schema。未知字段、重复 ID、失效引用、未注册实现、敏感 header/body key 或不闭合的执行路径均使构建失败。禁止 YAML、继承、anchor、动态模块路径、任意脚本和隐式名称规则。

Canonical identity 输入固定为 models.dev 2026-07-15 的 166 个 identity，SHA256 为 `d4f2aad138021cdd9052d910e326e7c1b40a627adfb5ecdc085764ab372d4733`。RDC 专属 OAuth、Cloud 与 Coding Plan surface 可以额外存在，但必须有独立 provenance；每个 models.dev identity 恰好有一个明确 surface owner。

## 编译与加载

Catalog compiler 负责：

- Schema 与跨文件闭集引用校验；
- 166 identity 精确覆盖；
- route、adapter、auth、discovery、wire implementation 覆盖；
- stable surface 的 endpoint、Connection Test 和最终操作 URL 闭环；
- model-level route matrix、internal target、协议兼容与 binding 冲突校验；
- selectable control 的确定执行路径；
- 分类、`serviceOperator`、`endpointOwnership`、`surfaceKind` 的显式性；
- 确定排序与 `catalogRevision` SHA256。

Electron Vite 构建调用同一编译器，产出轻量 summary index 和按 surface 分割的 lazy chunk，不向源码提交 generated 文件。编译失败时 fail-closed，不生成旧 Catalog fallback。Launcher 指纹覆盖 manifest 与 compiler；Browser `/health` 同时返回 build fingerprint、Settings schema、Effective Catalog schema 与 Catalog revision。

运行时只使用 `ProviderCatalogRegistry`：

- `listProviderSummaries()` 同步返回 Settings 首屏所需轻量字段；
- `loadProviderSurface(id)` 异步加载并缓存单一 surface；
- renderer/preload/browser bridge 只接收 revisioned projection，不读取 raw manifest；
- surface/model/route 变化只失效对应缓存，不广播完整 Catalog。

## 分类与 Route

主分类固定为 OAuth/Login、第一方直连、Cloud、兼容接入、Coding/Token Plan、Local、Image。分类按具体 surface，而不是公司品牌：

- 第一方直连必须同时具备官方运营 endpoint 与该运营方自有原生 wire；
- 厂商自营 endpoint 若使用 OpenAI Chat/Responses 或 Anthropic Messages 兼容 wire，仍属于兼容接入；
- Vertex、Azure、Bedrock 始终属于 Cloud；
- Google AI Studio 原生 Gemini 可以属于第一方直连；
- Kimi API、Kimi Coding Plan、ChatGPT OAuth、Copilot 等分别建模；
- MOA 是客户端编排，Copilot ACP 是外部进程，均不伪装为普通 HTTP Provider。

`serviceOperator`、`endpointOwnership`、`endpointClass`、`surfaceKind`、`protocolOwner` 与 catalog ownership 独立保存，禁止互相推导。

协议选择只来自 model-level `routeOptions`。多协议模型显示 enum，单协议显示只读值，不支持的组合禁用并 fail-closed。偏好按 provider surface + account + model 保存 `preferredRouteOptionId`。Provider 列表行对 `routes.length > 1` 的 surface 只摘要「多协议 · 默认 {protocol}」，不提供 Provider 级协议切换。LongCat 属于兼容接入，并显式提供 OpenAI Chat 与 Anthropic Messages；Vertex 属于 Cloud，Vertex Gemini、Vertex Anthropic 与精确获准的 OpenAI-compatible route 分开声明。Vertex Gemini 只有从 OpenAI-compatible `/models` 实际发现的模型才投影该兼容 route；Vertex Anthropic 从原生 Model Garden publisher catalog 发现候选，项目 entitlement 未经验证时保持 `unknown`，禁止借 Gemini OpenAI endpoint 伪造 Claude 可用性。

## Plan 拆分判据

Coding/Token Plan 与 Compatible Access 按**产品表面**拆分，不按公司品牌或 wire 格式：

- 独立订阅 / coding-plan 产品，且具备独立 surface（或独立目录权威 / 模型命名空间）时，必须作为单独 `coding-token-plan` entry（例如 OpenCode Go、ClinePass、Wafer Pass、Kimi Coding Plan）。
- 同一厂商的按量兼容网关保留在 Compatible Access（例如 OpenCode Zen、Cline usage/API）。
- Cline 不提供 OpenAI 风格 `/models`：usage 目录为 `/ai/cline/models`，ClinePass 目录为 `/ai/cline/recommended-models` 的 `clinePass` 桶；连接测试必须先用 `/users/me` 校验 API Key（目录接口本身不鉴权）。
- 仅有单一 OpenAI 兼容网关、没有独立 plan 入口或目录权威的产品（如 Kilo、Poe、iFlow、v0、FreeModel）留在 Compatible Access，不得为了“看起来像订阅”而伪造 plan surface。
- NanoGPT 是 `nano-gpt.com` 第三方聚合 API（Compatible Access），与 Karpathy 教学仓库 `nanoGPT` 无关。
- Plan surface 的 live discovery 必须走 `parser -> LiveModelObservation -> liveProjection`；禁止在 parser 里写死产品标签、route 或 tier。

## Controls 与 Execution Bindings

`ControlDefinition` 只描述产品控件语义：`unsupported`、`unknown`、`selectable`、`fixed`、`provider-managed`。

Fast、1M 和 reasoning 的执行方式只在 `ExecutionBinding` 中声明一次。Selector 可以组合 Fast、context mode 与 reasoning selection；action 闭集为 `request-patch`、`model-switch`、`client-tier`、`fixed`、`unsupported`。

最具体 selector 胜出；同等具体度冲突在编译期失败。Fast 为 model variant 时，target 只存在于 `model-switch` action；Fast 为 service tier 或 request patch 时不改变模型 ID。Reasoning Max 可以是普通 wire effort，也可以由 `reasoning=max` binding 切换真实模型。固定 1M 始终解析为开启且 disabled；unsupported 始终关闭且 disabled。

`ModelSelection.pickerVisibility` 与 execution role 解耦。Doubao Lite 可以既是 primary model，又作为其他模型的执行 target；Kimi highspeed、Opus Fast 等纯内部 target 才隐藏。关联必须来自 live metadata 或精确 manifest fact，禁止后缀猜测。Agent/Composer 可执行集合再叠加共享 `isAgentToolExecutableModel` gate：只有 source-backed `toolCalling.supported` 且 route 有已实现 structured-tool adapter 的模型可被选择；Settings catalog 仍展示完整事实。

禁止恢复 Embedding capability / Semantic lane / `settings.llm.embedding`。Discovery 继续 fail-closed 剔除非 agent modality（含 embedding/embeddings）。不得把 `EmbeddingCatalog` / `EmbeddingExecutionService` 写成现行产品能力；U02 删除这些源码。

`ResolvedModelControls` 由 UI 与 Planner 共用。selectable control 若没有执行路径、target 缺失或 denied、route 不兼容，则统一解析为 `blocked`；Composer 与发送阶段必须返回相同原因。`RequestPlan` 记录 selected/effective model、adapter、binding IDs、protocol、catalog/route revision 与公开 wire patch。

## Discovery 权限与模型存在性

Discovery authority 为 `authoritative-list`、`candidate-validation`、`additive`、`entitlement-overlay`。模型 presence policy 为：

- `maintained`：不会因部分目录缺席而 tombstone，只接受显式 denial；
- `discovered`：完整 authoritative list 的缺席可以判定不可用；
- `account-entitled`：由账号完整列表决定访问权。

Catalog ownership 只用于审计，不能决定 discovery 缺席语义。Kimi Coding Plan 只使用官方四个精确 model id：`k3`、`k3-256k`、`kimi-for-coding`、`kimi-for-coding-highspeed`。前三者是 primary；HighSpeed 是 `kimi-for-coding` 的 internal Fast target。`k3` 的 1M 是同一 model id 的 client-side context tier，禁止恢复虚构的 `k3[1m]` target。四个 live identity 均按 `account-entitled` 处理，缺席会 tombstone；internal target 不进入 selector 或持久化配置，已引用 primary route 保持 fail-closed。Anthropic-compatible base URL 固定为 `/coding`，OpenAI-compatible base URL 固定为 `/coding/v1`。后台版本名只可进入 provenance/脱敏诊断，禁止生成 selector、alias、持久化 route 或跨 surface 映射。
Credential-scoped live discovery follows one path: `parser -> LiveModelObservation -> manifest.liveProjection -> CatalogModelContribution -> Effective Catalog`. Parsers report only explicit upstream identity, availability, context, protocol, reasoning metadata, and capability evidence. Product labels, selection, routes, tiers, controls, bindings, and Fast targets remain compiled-manifest facts. `liveProjection` declares allowed fields and authority; it is never exposed through IPC or Settings persistence.
Missing protocol, context, or reasoning efforts remain manifest-owned or unknown; projection never guesses OpenAI-compatible, 256K, or High. `observedTierId` scopes a live capacity to one manifest tier, and `entitlementAuthority` independently selects manifest, catalog-observation, or execution-evidence authority. A default-tier 256K observation cannot erase a separate 1M tier; target presence cannot grant a Fast or Max binding.

Discovery、overlay、entitlement、observed evidence 和 user preference 按字段合并。冲突记录 provenance，不静默覆盖。Unknown model fallback 不创造窗口、Fast、Max mode 或 reasoning 事实。Max mode 的目标 tier 在每次 live overlay 合并后都必须保持完整窗口至少一百万 tokens；否则只阻断 Max mode，默认模型继续可用。 Account discovery 只有在当前认证表面同时证明 endpoint 与协议可执行时才可贡献 route；Super Grok 的 direct xAI `/models` 仅提供 availability/context 事实，执行 route 继续由 `cli-chat-proxy.grok.com` OAuth manifest/Builder catalog 掌管。该 proxy 所需的非秘密客户端协议版本同样属于 route manifest；不得依赖运行机器恰好安装 Grok CLI，也不得在 adapter 中按 hostname 猜测或伪造。
`catalogRevision` 是 preflight 与冻结 `RequestPlan` 共用的语义 revision：它包含 effective model 的 route、control、availability、selection、quota 等行为事实，但排除 provenance 时间戳与快照生成时间。SWR discovery 只续期相同 evidence 时 revision 必须不变；有效模型事实变化时才使旧 preflight fail-closed。
Structural capability, account entitlement, expiring execution evidence, and transient quota are independent dimensions. Unknown or denied entitlement disables normal execution without hiding the explicit Retry surface. Observed evidence replaces the same provider/account/protocol/model/binding scope, and capability-probe denials expire or are cleared by catalog refresh and explicit Retry. HTTP 401/403 is not itself subscription evidence: only a strict manifest matcher scoped to the model, mode, and optional protocol may classify a rejection as entitlement denial. HTTP 429 is transient quota; HTTP 402 is transient quota only when the response explicitly identifies `quota_exceeded` / quota exhaustion, otherwise it remains unknown. Capability probes attach a bounded retry expiry and never downgrade structural capability.


## 凭据与请求事务

Settings schema 当前为 v4，Effective Catalog cache schema 为 v6。版本不匹配的缓存直接失效；不保留旧字段 parser、双读或兼容 shim。稳定 provider/model/surface ID、secret ref 与合法 route preference 继续使用当前字段；失效 route 要求用户重新选择，禁止静默回退。

发送 preflight 创建主进程内 opaque credential lease，冻结 provider 配置、typed connection values、认证 headers、OAuth/Vertex 短时 token 与 AWS Bedrock credentials。认证 header 不进入 `ModelRoute` 或 `RequestPlan`。Adapter 必须持有 lease handle 才能发送；运行中不允许回读 Settings。

账号请求在尚未输出 stream 内容的 401 上只重试一次：先刷新上游凭据，再原位替换同一 lease 的 credential material，保持冻结 endpoint、route、model 与 controls 不变。Terminal、取消与异常路径统一释放 lease。

Conversation 发送状态为 `preparing → committing → running → terminal`：

1. flush 最新 Agent/Provider commit；
2. 加载 surface，刷新 credential、entitlement 与必要 live catalog；
3. 冻结 EffectiveModel、route、controls、variant、PromptPlan、tools、attachments 与 credential lease；
4. 在有界 worker 中估算 token、压缩并做 fit check；
5. 原子提交 Session、Turn、消息、assistant draft 与 requestId 映射；
6. Adapter 只消费冻结 RequestPlan/lease；
7. 写入 actual usage、脱敏 Trace 与终态。

Preflight 失败或取消不得留下 Session、Turn、branch、attachment、journal、transcript、draft 或 lease。相同 requestId 在提交后幂等。新 Session 用 staging directory 原子 rename；已有 Session 使用单 Session 锁与可恢复 journal。

## 重点事实契约

- ChatGPT OAuth：现行 Codex `models.json` 里 `gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`的 `input_modalities` 都包含 `image`。`gpt-5.4-mini` 与 `gpt-5.3-codex-spark` 已不在当前可选目录中，不保留 text-only 特例或 alias。GPT-5.5/5.6 的 Fast 按该 surface 精确 binding。5.6 支持 Low/Medium/High/Extra/Max。`gpt-5.4` 的 Codex `upgrade.retirement_at` 为 2026-08-31，已从 OAuth 清单移除；OpenAI API 同名模型独立维护。ChatGPT discovery 不覆盖 manifest 的视觉、工具和结构化输出基线。
- Anthropic Direct：`claude-opus-5` 为 1M input / 128K output、$5/$25、Low/Medium/High/Extra/Max（默认 High）并显式支持 Off。Fast 是 `speed=fast` + beta header 的 request binding；只有真实 usage 返回 `speed=fast` 才授予 entitlement。
- Copilot：结构能力由 manifest/user-observed fact 保留，账号 `/models` 的 `supported_reasoning_efforts`、`capabilities.supports`、默认/long-context billing tier、endpoint 与 policy 是当前账户的覆盖真值。支持扩展上下文的模型必须呈现“默认窗口 + 可选 1M”，禁止再把 Claude/GPT 扩展窗口写成固定 1M。`claude-opus-5` 只有在当前账户 discovery 精确返回 model id 和 agent endpoint 时可选，不继承 Direct API Fast。
- Kimi Coding Plan：账户目录只接纳 `k3`、`k3-256k`、`kimi-for-coding`、`kimi-for-coding-highspeed`。`kimi-for-coding` 为固定 1M，推理 Off/Low/High/Max（默认 Max），模型对应 K2.8 Preview。K3 两个精确 ID 均为 Low/High/Max（默认 High）；关闭 Thinking 会路由到 K2.8 Preview，因此 K3 UI 不暴露 Off。`k3` 的 1M entitlement、HighSpeed Fast 与各模型多模态能力分别服从该 surface 的 live contract，不从名称或其他 Moonshot surface 推断。
- GLM-5.2：固定 1M、High/Max、默认 High、无 Off/Fast；不同协议使用不同 wire profile。
- DeepSeek Direct：`deepseek-flash`（V4.1 Flash）与 `deepseek-v4-pro` 都固定 1M、默认 High，UI 为 Off/Low/High/Max。两者都支持 Responses（默认）、Chat Completions 与 Anthropic。Flash 有原生视觉；Pro 视觉为 unsupported。兼容输入 `minimal/medium/xhigh` 只在 wire 折叠，不渲染成额外档位。Thinking 开启时无效的 temperature / presence_penalty / frequency_penalty 从 wire 删除；top_p 保留，其有效范围由服务端限制为 0.95–1。`deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 已退役且不保留 alias；`deepseek-chat` / `deepseek-reasoner` 已删除。
- Grok 4.20 non-reasoning、reasoning、multi-agent 是三个独立模型；multi-agent 推理控件 fail-closed（UI=`Disabled`），不提供 reasoning toggle。Grok 4.3 是固定 1M 的 Max mode。Grok 4.7 与 Grok 4.6 都是 500K、Low/Medium/High/Extra、默认 High，视觉与工具按当前 surface 事实为 supported。Grok 4.7 的 Fast mode 在 xAI 直连与 Super Grok OAuth/Builder route 均由独立 `service_tier=priority` binding 驱动，不能跨 surface 合并 entitlement。Grok Build 0.1 为 256K。`grok-code-fast-1` 已于 2026-05-15 退役，不保留 alias。
- canonical wire 保留 `xhigh`，产品统一显示 `Extra`；不存在 Ultra 档位。

## Adapter 边界

Manifest 只能引用注册过的 `adapterId`、`authSchemaId`、`discoveryPolicyId` 和 `wireProfileId`。现有协议、认证机制、标准 discovery mapping、endpoint、route、model facts、controls、bindings 与 provenance 只改 JSON。

只有新 wire protocol、请求签名、OAuth/device/refresh、非标准动态目录或外部进程集成才新增 TS 行为。GitLab Duo 与 SAP AI Core 使用专用 adapter；标准 OpenAI-compatible surface 复用统一 adapter，但不能把原生/混合 surface 强压成兼容协议。

`OpenAIResponsesProvider` 必须处理 `response.reasoning_text.delta/done`、raw reasoning item、function-call continuation、terminal usage/error。DeepSeek 工具 loop 回放 Provider 要求的 raw reasoning/function-call item，且不使用 `previous_response_id`；Chat/Anthropic route 则按各自 continuation contract 回放 `reasoning_content`。

最终操作 URL 按 operation builder 构建并逐 route 测试，禁止重复追加 `/chat/completions`、`/responses` 或 Anthropic `/v1`。所有 stable surface 必须具有 adapter、auth schema、endpoint、Connection Test 与 operation URL；无凭据显示 `Unconfigured`，不得显示假 `Available`。

Connection Test、Connect 与已配置 Refresh 共用同一条 credential-scoped discovery 写入路径（`refreshEffectiveCatalogDiscovery` → Effective Catalog）。Test 成功必须就地写入已发现的 contributions 并广播，禁止为徽章另开 renderer 假状态；未提交的替换密钥写入 `anonymous:{providerId}`，不得覆盖 live `activeAccountId`。Settings 模型行徽章只反映 catalog `availability`：有新鲜缓存显示 OK；无缓存或 `refreshing` 显示加载中，禁止先闪「未验证」。

## HAL Adapter 实现注册

实现注册表（`src/shared/provider-catalog/implementationRegistry.ts`）当前包含 **16 个** adapter：

| adapterId | 协议 | transport |
| --- | --- | --- |
| `anthropic-messages` | AnthropicMessages | http |
| `azure-openai-chat` | AzureOpenAIChatCompletions | http |
| `azure-openai-responses` | AzureOpenAIResponses | http |
| `bedrock-converse-stream` | BedrockConverseStream | http |
| `gitlab-duo` | GitLabDuo | sdk |
| `google-interactions` | GoogleInteractions | http |
| `google-gemini` | GoogleGemini | http |
| `google-vertex-anthropic` | GoogleVertexAnthropic | http |
| `google-vertex-gemini` | GoogleVertexGemini | http |
| `mistral-conversations` | MistralConversations | http（无 selectable surface；保持不可选） |
| `ollama-openai-compatible` | OllamaOpenAICompatibleChatCompletions | http |
| `openai-compatible` | OpenAICompatibleChatCompletions | http |
| `openai-responses` | OpenAIResponses | http |
| `openrouter-chat` | OpenRouterChatCompletions | http |
| `sap-ai-core-foundation-models` | SapAiCoreFoundationModels | sdk |
| `sap-ai-core-orchestration` | SapAiCoreOrchestration | sdk |

Phase 7 新增的三个 HAL adapter：

- **Mistral Conversations**（`MistralProvider.ts`）：adapter 源码仍在，但当前没有 compiled selectable surface；产品面保持不可选，不得把它写成已上线续接能力。
- **Azure OpenAI Responses**（`AzureOpenAIResponsesProvider.ts`）：适配 Azure OpenAI Responses API，支持 API version 查询参数、deployment 路径与 Azure AD 认证。
- **Bedrock Converse Stream**（`BedrockConverseProvider.ts`）：适配 AWS Bedrock Converse Stream API，使用 SigV4 签名、`cachePoint` 缓存标记与原生 SSE 事件流解析。

## 成本计算（Cost Calculation）

`Usage.cost` 由 `src/main/agent-runtime/providers/internal/costCalculator.ts` 的 `calculateUsageCost()` 在流结束时计算。定价来源为 `Model.cost`（manifest / models.json 声明的每百万 token 美元价格）：

```text
cost.input  = (model.cost.input  / 1M) × usage.inputTokens
cost.output = (model.cost.output / 1M) × usage.outputTokens
cost.cacheRead  = (model.cost.cacheRead / 1M) × cacheReadTokens
cost.cacheWrite = (model.cost.cacheWrite / 1M) × shortWrite
               + (model.cost.input × 2 / 1M) × longWrite   // Anthropic 1h TTL = 2× input
cost.total  = input + output + cacheRead + cacheWrite
```

无定价信息时返回 `undefined`，UI 不显示成本字段。

## 统一错误模型（Error Model）

`src/shared/types/providerErrors.ts` 定义 `ProviderErrorCode` 联合类型，`src/main/agent-runtime/providers/internal/errorClassifier.ts` 实现分类逻辑：

| ProviderErrorCode | 含义 | retryable |
| --- | --- | --- |
| `provider_unknown` | Provider 未注册/未找到 | ✗ |
| `auth_unconfigured` | 凭据未配置 | ✗ |
| `auth_expired` | 凭据过期/无效 | ✗ |
| `auth_scope_denied` | 权限/scope 不足 | ✗ |
| `model_source` | 模型不存在（404） | ✗ |
| `request_rejected` | 工具/参数格式被拒绝（400 invalid-argument） | ✗ |
| `rate_limit` | 速率限制（429） | ✓ |
| `quota_exceeded` | 配额/余额耗尽 | ✗ |
| `network` | 网络连接错误（5xx） | ✓ |
| `timeout` | 请求超时 | ✓ |
| `context_overflow` | 上下文超长 | ✗ |
| `stream_protocol` | 流协议违规 | 视情况 |
| `aborted` | 用户取消 | ✗ |
| `unknown` | 未分类 | ✗ |

分类优先级：Abort → HTTP status → 消息模式匹配 → 流协议 → fallback `unknown`。`isRetryableAssistantError()` 检查 `AssistantMessage.diagnostics` 判定是否可自动重试。

## models.json 用户覆盖（3 层真值合并）

Effective Catalog 的模型事实来自三层合并（优先级递增）：

1. **Manifest 基线**（`src/shared/provider-catalog/manifests`）：编译期确定的结构能力、协议、route、controls、bindings。
2. **Discovery 投影**（live catalog）：账号级 live discovery 贡献的可用性、上下文窗口、reasoning metadata；只能收窄或补充，不能覆盖 manifest 结构能力。
3. **用户覆盖**（`~/.rdc-agent/models.json`，由 `ModelsOverrideService` 管理）：最高合并优先级，自带 provenance；可覆盖定价、上下文窗口、显示名等非安全字段。**禁止**触及 `route.protocol`、`authSchemaId`、`adapterId`、`compatibilityGroup`、`carrier` 等安全/延续性字段。

合并冲突记录 provenance，不静默覆盖。`EffectiveModelResolver` 在 `userOverrideContribution()` 中执行合并。

## Prompt Cache 契约（Cache Retention）

`src/main/agent-runtime/providers/promptCacheWire.ts` 定义统一缓存抽象：

```text
CacheRetention = 'none' | 'short' | 'long'
```

由 manifest `ProviderCacheContract.ttl` 经 `resolveCacheRetention()` 派生：

| TTL 声明 | CacheRetention | Anthropic wire | OpenAI wire |
| --- | --- | --- | --- |
| `none` | `none` | 无 cache_control | 无 cache 字段 |
| `five-minutes` / `thirty-minutes` / `provider-managed` / `unknown` | `short` | `{ type: 'ephemeral' }` | `prompt_cache_key` |
| `one-hour` / `twenty-four-hours` | `long` | `{ type: 'ephemeral', ttl: '1h' }` | `prompt_cache_key` + `prompt_cache_retention: '24h'` |

Bedrock 使用 `cachePoint: { type: 'default' }` 标记 stable prefix。`partitionSystemPrompt()` 将 PromptPlan segments 按 stable/volatile 分割，stable 前缀锚定缓存断点；不匹配时 fail-closed（`PROMPT_PLAN_CONTEXT_MISMATCH`）。

## 验证门禁

- `pnpm run check:provider-catalog`：strict schema、166 identity、确定 hash、route/control/binding/secret-free 语义。
- `pnpm run check:provider-system`：编译后的语义对象、Resolver、Planner、Discovery 与最终 wire 契约。
- `pnpm run check:agent-runtime`：冻结 RequestPlan/credential lease、PromptPlan 与 adapter 边界。
- `pnpm run check:settings-agents`：`.agent.md` 单一持久化真值与 scoped save。
- `pnpm run typecheck`、`pnpm test`、架构/保真/共享导出/仓库卫生门禁与 `pnpm run build`。

真实 UI 验收只使用连接真实 main process 的 in-app Browser。测试必须核对 Settings 与 Composer 的同一 revision projection、`selectedModelId`、`effectiveModelId`、binding IDs、adapter、protocol、route revision 与脱敏 wire patch；无凭据 provider 只能报告 mock/Connection Test，不能宣称账号级 live 可用。
