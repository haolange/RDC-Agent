# Provider / Model Catalog 架构

本文定义 RDC-Agent 唯一的 Provider、Model、Route、能力解析和请求编译链。产品语义以根目录 `DESIGN.md` 为最高权威；机器可验证契约位于 `src/shared/provider-catalog`、`src/shared/types/providerCapability.ts`、`EffectiveCatalogService` 与 `RequestPlanner`。

## 核心不变量

- 事实只来自严格 JSON manifest；TypeScript 只实现 Schema、编译器、Registry、Resolver、Planner、Adapter、认证和 Discovery 行为。
- 唯一链路是“声明 → 构建期编译 → 运行时解析”。禁止 TS 数据 preset、factory 推导、renderer 静态表或按名称猜测形成第二真值。
- `EffectiveModel` 是能力真值；`RequestPlan` 是一次请求的冻结执行真值。Adapter 不得重算 Fast、Max、1M、route、temperature 或 context budget。
- Conversation/Agent 调用不得注入隐藏的默认 	emperature；只有 manifest/route 明确固定的值或调用方显式选择才进入 RequestPlan，否则省略并交由 Provider 管理。
- 认证秘密不进入 manifest、`EffectiveModel`、`RequestPlan`、IPC、renderer、会话、journal 或 Trace。
- 未证实字段保持 `unknown / Provider managed / Unverified`；不得补写 256K、按后缀关联 variant，或按 provider 名、上游 SDK 包元数据、endpoint hostname 推断分类与协议。
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

协议选择只来自 model-level `routeOptions`。多协议模型显示 enum，单协议显示只读值，不支持的组合禁用并 fail-closed。偏好按 provider surface + account + model 保存 `preferredRouteOptionId`。LongCat 属于兼容接入，并显式提供 OpenAI Chat 与 Anthropic Messages；Vertex 属于 Cloud，Vertex Gemini、Vertex Anthropic 与精确获准的 OpenAI-compatible route 分开声明。Vertex Gemini 只有从 OpenAI-compatible `/models` 实际发现的模型才投影该兼容 route；Vertex Anthropic 从原生 Model Garden publisher catalog 发现候选，项目 entitlement 未经验证时保持 `unknown`，禁止借 Gemini OpenAI endpoint 伪造 Claude 可用性。

## Controls 与 Execution Bindings

`ControlDefinition` 只描述产品控件语义：`unsupported`、`unknown`、`selectable`、`fixed`、`provider-managed`。

Fast、1M 和 reasoning 的执行方式只在 `ExecutionBinding` 中声明一次。Selector 可以组合 Fast、context mode 与 reasoning selection；action 闭集为 `request-patch`、`model-switch`、`client-tier`、`fixed`、`unsupported`。

最具体 selector 胜出；同等具体度冲突在编译期失败。Fast 为 model variant 时，target 只存在于 `model-switch` action；Fast 为 service tier 或 request patch 时不改变模型 ID。Reasoning Max 可以是普通 wire effort，也可以由 `reasoning=max` binding 切换真实模型。固定 1M 始终解析为开启且 disabled；unsupported 始终关闭且 disabled。

`ModelSelection.pickerVisibility` 与 execution role 解耦。Doubao Lite 可以既是 primary model，又作为其他模型的执行 target；Kimi highspeed、Opus Fast 等纯内部 target 才隐藏。关联必须来自 live metadata 或精确 manifest fact，禁止后缀猜测。

`ResolvedModelControls` 由 UI 与 Planner 共用。selectable control 若没有执行路径、target 缺失或 denied、route 不兼容，则统一解析为 `blocked`；Composer 与发送阶段必须返回相同原因。`RequestPlan` 记录 selected/effective model、adapter、binding IDs、protocol、catalog/route revision 与公开 wire patch。

## Discovery 权限与模型存在性

Discovery authority 为 `authoritative-list`、`candidate-validation`、`additive`、`entitlement-overlay`。模型 presence policy 为：

- `maintained`：不会因部分目录缺席而 tombstone，只接受显式 denial；
- `discovered`：完整 authoritative list 的缺席可以判定不可用；
- `account-entitled`：由账号完整列表决定访问权。

Catalog ownership 只用于审计，不能决定 discovery 缺席语义。Kimi Coding Plan 使用稳定产品身份：`kimi-for-coding` 是基础 primary，精确 `k3` 仅在当前 credential-scoped authoritative catalog 返回时成为第二个 primary，`kimi-for-coding-highspeed` 始终是不可选择的 internal Fast target，`k3[1m]` 是 manifest-maintained 的 internal Context Max target。三个 live identity 均按 `account-entitled` 处理，缺席会 tombstone；internal target 永远不进入 selector 或持久化配置，已引用 primary route 保持 fail-closed。后台 K2.x/K3 版本名只可进入 provenance/脱敏诊断，禁止生成 selector、alias、持久化 route 或跨 surface 映射。
Credential-scoped live discovery follows one path: `parser -> LiveModelObservation -> manifest.liveProjection -> CatalogModelContribution -> Effective Catalog`. Parsers report only explicit upstream identity, availability, context, protocol, reasoning metadata, and capability evidence. Product labels, selection, routes, tiers, controls, bindings, and Fast targets remain compiled-manifest facts. `liveProjection` declares allowed fields and authority; it is never exposed through IPC or Settings persistence.
Missing protocol, context, or reasoning efforts remain manifest-owned or unknown; projection never guesses OpenAI-compatible, 256K, or High. `observedTierId` scopes a live capacity to one manifest tier, and `entitlementAuthority` independently selects manifest, catalog-observation, or execution-evidence authority. A default-tier 256K observation cannot erase a separate 1M tier; target presence cannot grant a Fast or Max binding.

Discovery、overlay、entitlement、observed evidence 和 user preference 按字段合并。冲突记录 provenance，不静默覆盖。Unknown model fallback 不创造窗口、Fast、Max mode 或 reasoning 事实。Max mode 的目标 tier 在每次 live overlay 合并后都必须保持完整窗口至少一百万 tokens；否则只阻断 Max mode，默认模型继续可用。 Account discovery 只有在当前认证表面同时证明 endpoint 与协议可执行时才可贡献 route；Super Grok 的 direct xAI `/models` 仅提供 availability/context 事实，执行 route 继续由 `cli-chat-proxy.grok.com` OAuth manifest/Builder catalog 掌管。该 proxy 所需的非秘密客户端协议版本同样属于 route manifest；不得依赖运行机器恰好安装 Grok CLI，也不得在 adapter 中按 hostname 猜测或伪造。
Structural capability, account entitlement, expiring execution evidence, and transient quota are independent dimensions. Unknown or denied entitlement disables normal execution without hiding the explicit Retry surface. Observed evidence replaces the same provider/account/protocol/model/binding scope, and capability-probe denials expire or are cleared by catalog refresh and explicit Retry. HTTP 401/403 is not itself subscription evidence: only a strict manifest matcher scoped to the model, mode, and optional protocol may classify a rejection as entitlement denial.


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

- ChatGPT OAuth：GPT-5.4/5.5/5.6 的 Fast 按该 surface 精确 binding；GPT-5.4 mini 与 Spark 均无 Fast。5.6 支持 Low/Medium/High/Extra/Max。
- Copilot：结构能力由 manifest/user-observed fact 保留，账号 `/models` policy 与 entitlement 只收窄访问。Gemini 3.1 Pro 默认 200K 并可选 Max mode；Gemini 3.5 Flash 只有固定 1M Max mode，不存在 200K 普通模式。标记原生 1M 的 Claude 显示固定 Max mode；Opus Fast 仅使用精确 internal binding。
- Kimi Coding Plan：稳定基础入口为 `kimi-for-coding`；账户目录精确返回 `k3` 时才增加 `Kimi K3`，highspeed 仅作为内部 Fast target。禁止显示或接纳 `Kimi K2.7 Code` / `kimi-k2.7-code`。K3 reasoning、Context Max mode 与 Fast 分别服从该 surface 的 live contract，不从名称或其他 Moonshot surface 推断。
- GLM-5.2：固定 1M、High/Max、默认 High、无 Off/Fast；不同协议使用不同 wire profile。
- DeepSeek Pro/Flash：固定 1M、Off/High/Max、默认 High。
- Grok 4.20 non-reasoning、reasoning、multi-agent 是三个独立模型；multi-agent 为 Provider managed，不提供 reasoning toggle。Grok 4.3 是固定 1M 的 Max mode，Grok 4.5 Super Grok OAuth 不继承 direct xAI API 的 Priority Fast，Grok Build 0.1 为 256K。
- canonical wire 保留 `xhigh`，产品统一显示 `Extra`；不存在 Ultra 档位。

## Adapter 边界

Manifest 只能引用注册过的 `adapterId`、`authSchemaId`、`discoveryPolicyId` 和 `wireProfileId`。现有协议、认证机制、标准 discovery mapping、endpoint、route、model facts、controls、bindings 与 provenance 只改 JSON。

只有新 wire protocol、请求签名、OAuth/device/refresh、非标准动态目录或外部进程集成才新增 TS 行为。GitLab Duo 与 SAP AI Core 使用专用 adapter；标准 OpenAI-compatible surface 复用统一 adapter，但不能把原生/混合 surface 强压成兼容协议。

最终操作 URL 按 operation builder 构建并逐 route 测试，禁止重复追加 `/chat/completions`、`/responses` 或 Anthropic `/v1`。所有 stable surface 必须具有 adapter、auth schema、endpoint、Connection Test 与 operation URL；无凭据显示 `Unconfigured`，不得显示假 `Available`。

## 验证门禁

- `pnpm run check:provider-catalog`：strict schema、166 identity、确定 hash、route/control/binding/secret-free 语义。
- `pnpm run check:provider-system`：编译后的语义对象、Resolver、Planner、Discovery 与最终 wire 契约。
- `pnpm run check:agent-runtime`：冻结 RequestPlan/credential lease、PromptPlan 与 adapter 边界。
- `pnpm run check:settings-agents`：`.agent.md` 单一持久化真值与 scoped save。
- `pnpm run typecheck`、`pnpm test`、架构/保真/共享导出/仓库卫生门禁与 `pnpm run build`。

真实 UI 验收只使用连接真实 main process 的 in-app Browser。测试必须核对 Settings 与 Composer 的同一 revision projection、`selectedModelId`、`effectiveModelId`、binding IDs、adapter、protocol、route revision 与脱敏 wire patch；无凭据 provider 只能报告 mock/Connection Test，不能宣称账号级 live 可用。
