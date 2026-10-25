# Runtime Kernel 契约

> 产品边界与不变量以根目录 `DESIGN.md` 为 SSOT。本文是从 DESIGN 分拆出的 **Runtime / Prompt / Provider / Tool / Session** 稳定契约；实现细节见 `docs/architecture/agent-runtime-kernel.md` 与源码，二者冲突时以 `DESIGN.md` + 本文为准并修正架构文。

历史压缩的冗余计数按整个 session journal 的实际记录数与有效消息数恢复和累计，新消息或 append-only 终态不得无条件清零。终态触发的历史维护只能在 WAL 已完成并移除后执行，不能改写仍受恢复前缀校验保护的文件。

## Agent Loop

会话终态提交沿同一存储事务路径执行。当前内部 terminal WAL v2 只保存本回合追加、原文件字节边界及 SHA256；固定 owning session 的 history/context 路径不从日志输入。恢复先验证两份前缀与可识别的部分追加，再按 prepared 回滚、committing/committed 前滚，数据 fsync 后才移除日志；未知尾部或前缀变化 fail-closed，不截断无关数据。仍有效的 v1 快照事务保留恢复解释，正常提交只写 v2；conversation/context JSONL 数据格式与既有记录不迁移、不删减。Context journal 逐行校验，物化与重复检查只保留所需 turn，未选记录的语法/结构错误不得隐去；终态不得把所有历史 context 重复序列化为 before/after 大对象。

唯一运行时路径：

1. 解析 profile、model route、policy、可用工具；
2. 调用 LLM；
3. 执行已批准工具；
4. 将工具结果回灌 loop；
5. 产出 final answer。

`ConversationWorkTrace` 是可见进度契约。块类型包括：`llm_turn`、`reasoning`、`approval`、`user_input`、`compaction`、`handoff`、`diagnostic`、`output`。`subagent` 是父 tool call，不是独立 work block；其子执行记录单独落在所属 session 的委派日志，父消息只保留关联和短状态。历史不匹配 canonical schema 的 `workTrace` 在存储读边界丢弃（`workTrace: null`），不做归一化。

每个工具回灌轮次必须经过 `LoopProgressGuard`。指纹包含有序工具名、规范化参数、成功/失败、语义结果与 runtime revision，忽略 call id、时间戳和耗时。连续第二次相同只向下一次请求注入不落盘的 `<runtime_no_progress>`；第三次仍相同抛出 `AgentLoopTerminationError('AGENT_NO_PROGRESS')`。参数、结果或 runtime revision 改变立即复位。接近 `maxTurns` 时，每次请求临时告知剩余轮数，提示先结算真实 Task、保存可恢复缺口和诚实终答；倒数第二次是最后一次提供工具的请求，最后一次不提供工具、只允许生成如实终答。该提示不写入会话，不放宽任何审批、证据或完成门禁。若 Provider 无视最后一次请求的工具缺席仍要求 continuation，抛出 `AgentLoopTerminationError('AGENT_MAX_TURNS_EXCEEDED')`，禁止静默完成或伪造缺失 final answer。

Work Process 的工具摘要只由 runtime tool result 计算 `succeeded / failed / skipped`，不得采信模型自述。可恢复的中途失败仍保留可见证据，产品不能显示“全部成功”的合成结论。

## 关键编排模块（Phase 1–4）

| 模块 | 职责 |
| --- | --- |
| `EffectiveRuntimePlan` | `schemaVersion: 3`；project-aware effective profile snapshot（definition + scope/provenance/sourceHash + compiled route）+ 冻结 `profileDelegates`（effective `agents`）；tools/skill intersection, deferred/MCP lease, permission/policy/route/request+prompt fingerprints, attachment manifest fingerprint；Prompt and Executor share it。`settings.llm.agentRoutes` 只是 `compiledRoute` 的 Settings 派生镜像；`getEffectiveModel` / `applyLlmConfig` / preflight 只读 snapshot 的 `compiledRoute`。 |
| `AgentOrchestrator` | façade（少于 800 行）；`ProfileTurnPreparation` 为 sendMessage/sendProfileMessage/subagent 唯一 prepare 入口；无 `preparedRuntime` → `TURN_NOT_PREPARED` |
| `TurnCoordinator` / `TurnHandle` | Session ownership Active→Aborting→Orphaned→Settled；Orphaned 时 `beginTurn` → `TURN_ORPHANED`；`abortAndJoin` 等 stream + producerCompletion；late producer join |
| `ProcessSupervisor` | spawn/joinAll；POSIX pgid；Windows `taskkill /T` 自身有有限 timeout；close-observed registry；timeout yields `unconfirmed_orphan`，不以终止命令返回冒充目标退出 |
| `ShutdownCoordinator` | `running → … → release_owned_runtimes → terminate_processes → … → exited`；before-quit 限时 `shutdownAll`；RDC clear+stop 不得与 `joinAll` 并行 |
| `AgentSlotRegistry` / `McpConnectionCoordinator` / `DeferredToolActivationTracker` / `TurnHandle.pendingHandoff` | Per-session/per-project ownership；AgentState 键 `scope::agentId`；MCP pool `realpath+projectId+descriptorHash`；orphan pool quarantine；transport 仅 stdio/streamable-http（sse fail-closed） |
| `RdcRuntimeContextRegistry` | 仅 per-session RDC context lease；无 global mirror |
| `LoopRuntimeState` | Agent 工具面 COW；每轮读 `runtime.current` |
| `LoopProgressGuard` | 检测相同工具轮次无进展；第二轮纠偏、第三轮 typed termination；runtime revision 变化即复位 |

Conversation 单一真相：turn 开始 `rehydrate(fromDisk)`；结束 flush 并清空 slot messages；分支切换 / rewrite 显式 `syncSessionSlots`。

## Prompt 与 Request

```text
Scoped Runtime Resolution
  -> EffectiveCatalogService
  -> PromptPlanBuilder
  -> Context / Message Transformation
  -> RequestEnvelopeBuilder
  -> RequestPlanner (closed RequestPlan)
  -> Provider Adapter
  -> Provider Wire Request
```

`PromptPlan` 每段含 id、kind、scope、source path/hash、precedence、content、token estimate、`stable|volatile`。稳定前缀指纹锚定 prompt-cache。Session 重建路径：`conversation.jsonl` + `conversation-branches.json` + `session-context.jsonl`。`context-view.json` 现写 `{ schemaVersion: '1', view }`；缺版本裸 view 走 `SESSION_CONTEXT_VIEW_MIGRATIONS`。`shell-state.json` 现写 `{ schemaVersion: '1', state: { cwd } }`，只存 cwd；缺版本或损坏 fail-closed / quarantine，未知更高版本 `STORAGE_SCHEMA_UNSUPPORTED`。

切模型不自动 compact、不写迁移事务。`ContinuationReplayPolicy` 按 compiled execution identity 决定同绑定回放 / 跨绑定 drop；普通 Send 与 rewrite 在将丢弃 continuation 制品时插入同一条系统通知。optional 制品保留最近 8 个可见 turn；`requirement: required` 制品不受该窗口过期，只随 compaction 边界终止。

仅自动压缩；产品不提供按钮、菜单、`/compact` 或 `/summary`。会话准备和执行途中复用同一条 LLM 结构化 handoff：`PromptPlan → RequestEnvelope → adapter`，单轮、无工具、禁用 cache write，`StructuredHandoff.derivation = 'model-generated'`。LLM 失败显式报错，不静默回退确定性抽取。低于压缩线原样继续且不生成压缩工作块。首条超大输入先完整外置并核验，不调用摘要模型，也不静默删减。

发送是 next-turn 事务：`preparing → committing → running → terminal`。Preflight 冻结 catalog/route/controls/`PromptPlan`/tools/attachments，并创建主进程 opaque credential lease。失败/取消的 preflight 不留 Session/journal/lease 残渣。Composer 附件先经 `conversation:stageAttachments` 写入 `{userData}/state/staging/attachments/`（进程启动清空）；turn commit 才拷进 session `attachments/`。`ConversationAttachmentMaterializer` 按 image / text / pdf / binary 四层物化：image 走 native vision；text/pdf 按 `min(固定上限, contextBudgetTokens * ratio)` 均分后 inline，prepare 冻结最终 session 逻辑路径与正文，run 只补 image 字节；binary 只给元数据。扫描件 PDF 无文本层写诊断；加载失败 / 加密不伪装成扫描件。SVG 硬拒。

实际执行的 PromptPlan 以 volatile `runtime:request-plan` 投影同一主进程 RequestPlan 的 provider、selected/effective model、protocol、resolved reasoning selection/control/wire kind 和 execution fingerprint；普通会话与 Profile/子执行均传入各自已规划的 RequestPlan。不得从 Settings 默认值、用户正文或父路由推断控制值，unknown/off 分别保留。投影不包含 endpoint、headers、bodyPatch、凭据或推理正文，不扩大权限；它证明本机规划的请求控制，不冒称 Provider 内部计算。离线指令成本构建没有 Provider 请求，不生成这项执行事实。fact 不进入稳定缓存前缀，全文/预算/快照仍消费同一 PromptPlan。

回合额度使用同一执行解析规则：profile 的普通 Provider 循环上限（省略时为 25）与已编译 policy 取较小值，policy 为零拒绝执行。准备阶段在估算、缓存和 fingerprint 之前生成 volatile `runtime:execution-limits`，并把该最终 PromptPlan 随 prepared runtime 交给执行器；执行器不使用调用方遗留的准备前 prompt。`runtime:profile-limits` 只列同次解析快照中已知 enabled profile 的循环上界，供规划交接使用；未来回合仍须独立解析 policy/Task/Capsule，不能把上界视为预留或当前余量。普通无工具终答也占循环；工具外压缩等辅助请求须另计实际 Provider 消费，不能由循环上限推断额外授权。计划文本不能抬高宿主上限，投影不增加工具或权限，也不读取任意新 profile 来源。

用户 Stop 按相位分流：`preparing` → 干净撤销（Composer 恢复发送前草稿，transcript 不保留本轮）；`committing` / `running` → 单调落停（assistant/`workTrace` 进入 `stopped`，禁止再被迟到 `streaming` patch 或 optimistic 回滚打回运行中/发送前）。Main `ActiveConversationTurn.stop()` 落盘 pending 时不得再向 renderer emit `streaming`；权威终态由 `commitStoppedMessage` / terminal event 给出。已创建但未启动的 Task 只有带本回合 `creationTurnRef` 时才在 producer join 后结算为 `cancelled`；其他回合及旧记录不推断归属、不取消，Rewrite 不能把被停回合的新待办继续标作可执行。Edit and resend 提交后 renderer 立即 optimistic 切入新 branch variant，IPC 返回后 reconcile。多 session 并行时 renderer 投影与 Composer 恢复规则见 [`session-projection.md`](session-projection.md)。

迟到事件的代际硬拒绝不放宽。停止回合在最终提交时，从其已取得的 canonical terminal context 补齐本回合已有 pending/running 工具行：call ID、工具名及回合/工具开始时间须匹配，既有终态工具不改写，不创建未知工具行。复用正常事件的结果转换、预览和资源引用规则，保留真实成功或错误回执；有回执不再记成“未取得回执”，无回执仍明确失败。此对账不发起工具、恢复模型循环、结算独立子Task或生成实验签名。

## Provider 登录与目录投影

Grok 订阅仅走浏览器 Authorization Code + PKCE 和动态 loopback 回调；state、OIDC 签名/issuer/audience/nonce/有效期由主进程核验。一次登录拥有自己的监听、超时及 AbortController，取消、重启登录和退出均关闭监听并隔离迟到结果。订阅目录和请求使用订阅代理；独立 xAI API Key 入口不作为失败 fallback，不隐式改变计费入口。

Renderer 的 EffectiveCatalog store 只是主进程快照镜像：按 provider/account/protocol 合并请求、接受目录事件并隔离失效 scope，不推断能力。路由保存期间保持 syncing，提交后重新计算能力；偏好和连接变化失效，单纯测试时间戳变化不重取。发送前仍由主进程冻结和核验执行计划。

## Provider Reasoning 与输出通道

语义值：`raw` | `summary` | `opaque` | `none` | `unknown`。声明缺失保持 `unknown`，禁止静默升级。

每个 wire block 先获得稳定 `ProviderOutputRef`；首次语义声明永久归属 `thinking` | `text` | `tool_call` 之一。kind collision、start 前 delta、close 后 delta、terminal 后语义事件 → fail-closed。禁止按文本相同做跨通道去重。

Provider 请求失败或本地响应提交失败时，本次尚未交给工具执行器的 assistant 流式内容只保留为可见诊断，不进入下一次请求的 Agent 上下文；尤其不能重放没有对应 tool result 的 `tool_call`。仅成功结束的响应才进入正常工具循环。

仅显式 thinking block 可创建 `ThinkingArtifact`；普通 assistant text 永不合成 thinking。仅 `outputPhase='commentary'` 写 Work Process commentary；仅 `final_answer` 写正文与 final trace。正常结束但无 canonical final → fail-closed。

## Provider 错误模型契约

`src/shared/types/providerErrors.ts` 定义统一错误分类：

```typescript
type ProviderErrorCode =
  | 'provider_unknown' | 'auth_unconfigured' | 'auth_expired'
  | 'auth_scope_denied' | 'model_source' | 'request_rejected' | 'rate_limit'
  | 'quota_exceeded' | 'network' | 'timeout'
  | 'context_overflow' | 'stream_protocol' | 'aborted' | 'unknown';

interface ProviderErrorInfo {
  code: ProviderErrorCode;
  retryable: boolean;
  httpStatus?: number;
  message: string;
  details?: Record<string, unknown>;
}
```

**Retryable 分类**：`rate_limit`、`network`、`timeout` 始终可重试；`stream_protocol` 视具体模式（“stream ended without message_stop”“you can retry your request” 可重试，其余不可）；其余均不可重试。

分类器（`errorClassifier.ts`）为纯函数，无副作用；优先级：Abort → HTTP status → 消息模式 → 流协议 → fallback `unknown`。

## 诊断契约（Diagnostics）

`AssistantMessage.diagnostics` 在流失败时附加诊断条目：

```typescript
interface AssistantMessageDiagnostic {
  type: string;              // 诊断类型标识
  timestamp: number;         // Unix 毫秒时间戳
  error?: {
    name?: string;
    message: string;
    stack?: string;
    code?: string | number;  // HTTP status 或业务码
  };
  details?: Record<string, unknown>;  // 结构化补充信息
}
```

`isRetryableAssistantError(message)` 遍历 `diagnostics` 并对每个 `error` 调用 `classifyProviderError`，任一 retryable 则整条消息可重试。诊断信息不进入 IPC / renderer / Trace，仅供主进程重试决策与脱敏日志使用。

Agent loop 终止与 Provider 失败互斥：`AGENT_NO_PROGRESS` → `CONVERSATION_AGENT_LOOP_STALLED`；`AGENT_MAX_TURNS_EXCEEDED` → `CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED`；`PROVIDER_STREAM_*` → `CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION`。未结算的本回合 direct Task 先在 `turn_complete` 拒绝，要求模型用 `task_update` 明确完成或受阻；若模型仍直接终答，运行时将该执行结算为 blocked，并以 `CONVERSATION_TASK_COMPLETION_DENIED` 报告本地完整性失败。只有真实网络、鉴权、配额或 wire 故障才产生 `CONVERSATION_LLM_REQUEST_FAILED`。

## Tools 与 Permission（执行侧）

`artifact_read.jsonTextPointers` 可选开启受控 JSON 校验，必须绑定 `expectedHash`；仍先经过 owning session／委派精确引用、路径、配额、MIME 与 hash 校验。主进程解析同次读取的完整 JSON 制品，解码现有 `json-chunks` 表示，再按最多四个 RFC 6901 指针依次解析所选 JSON 文本；返回每层字节／UTF-8 文本 SHA-256 以及最终值的节点、数值、非有限数和数组长度直方图。空列表校验文档本身，并非“不启用”；读取图片或普通文本必须完全省略该字段，MIME 拒绝须给出这一可执行纠正方式，不能默默忽略参数或放宽类型。显示分页和完整解析是不同事实；生产结果的 truncated 标记另外保留。指针不能读取其他文件或执行代码，非法 JSON／指针及超限明确拒绝，不返回部分成功统计。文件层摘要对应原制品文件，文本层摘要对应解码后的 UTF-8 文本，均不等于领域语义、完整取证、原生实验签名或修复验收。非 JSON 制品及原权限限制不放宽。

`artifact_read.textPointer` 在同一 JSON 解码链末尾选择一个普通字符串，返回显式文本视图而非 JSON 数值统计；不把该字符串再当作 JSON、路径或代码。`jsonTextPointers` 省略时链为空。原制品 URI/hash 保持，`textView` 另列选择指针、每层解码来源、完整字符串 UTF-8 字节数/SHA-256 与已知生产截断状态；不能用文本 hash 冒充原文件 hash。视图分页的行列定位于所选文本，保留 CRLF 和 Unicode，按返回游标拼接可重建其精确 UTF-8；不启用视图时沿原读取路径。选择必须绑定 `expectedHash`，无效 Unicode、非法/非自有 JSON 指针、非字符串与非 JSON 制品明确拒绝，委派仍只读原精确授权 URI/hash。

小文本的 `read_file(pinEvidence: true)` 显式复用既有制品化路径，保留内联结果并返回该读取窗口的会话 URI/hash；默认不额外落盘。整文件 hash/totalLines 不代表窗口已包含全文，截断与分页语义保持。图片制品化在模型结果中直接列出实际图片叶子的 URI/hash；包装 JSON 与图片是独立制品，委派者须逐个显式授予必需叶子，不递归推断授权、不放宽 hash/路径/容量边界。

`artifact_read.search` 对完整选定文本作区分大小写、非重叠的单行字面量检索（1–256 UTF-16 字符，不执行正则或代码）。可检索显式 JSON 文本视图，或原普通文本视图；图片拒绝。返回全视图匹配计数及最多64个有行/UTF-16列定位的摘录，并服从16KiB工具页上限；`limit` 可进一步收窄匹配数量，`next` 指向首个未返回匹配。继续检索必须沿用 URI/hash、全部视图选择参数与同一查询；摘录不等于整行/整份源码覆盖，需按返回定位读取必要原文。合法零匹配、源生产截断、分页截断与读取拒绝分别表达；计数只证明该有界文本中的字面匹配，不证明控制流、原生执行或领域主张。检索同样要求 `expectedHash`，不增加文件、journal、RDC 或跨会话访问权。

`read_file` 与 `read_image` 成功读取时在正文和 details 返回原始文件字节的 SHA-256（小写 hex）与字节数。文本按行展示仍对同一次完整读取流计算摘要，包含 BOM、原换行与未展示的行；摘要不属于带行号的展示文本。图片摘要对应实际送入模型的 image block 解码字节，不属于缩略图或重编码结果。它们只证明该次读取内容，不能追认历史执行所用的文件；执行前后绑定须有对应时点的来源。取消或读取失败不返回成功摘要，默认文本读取仍拒绝二进制，capture、vision 和路径权限限制不放宽，不用 Shell 文件访问补旁路。

`read_file(mode: audit)` 是同一权限路径上的显式只读文件计算，每个输入必须绑定 `expectedHash`（64位 SHA-256，可带 `sha256:`）。可选 `compareWith: {path, expectedHash}` 的第二路径独立经过权限与 realpath 检查。每份实际读取最多8MiB；文件类型、超限、hash不匹配、取消均拒绝。`.rdc` 与 RDOC capture magic 始终拒绝。返回实际原始字节数/hash、前64字节 hex；比较实际完整 Buffer，返回相等与否、首差异偏移和有界 hex 窗口。不执行文件或调用原生，不把 header 解释为完整模块验证。显式 `textComparison: true` 要求全部输入为无NUL合法UTF-8，仅 CRLF→LF，保留 BOM、裸CR及其它字符，另给规范化hash、精确相等判断、共同前后缀行数及有界中间区间。中间区间超限明确 `truncated`，不能冒称完整diff；未截断时所有变化均包含在中间区间，区间外逐行相等。摘要与比较基于实际读取快照，不声明磁盘随后不变，也不声明模型已消费全文或领域语义正确。审计模式不接受分页，不授予 read-before-edit；默认文本模式不接受审计参数，禁止静默改变读取语义。既有会话制品化机制持久化审计结果，reviewer仍需精确URI/hash授权。

文本工具判别 RenderDoc 文件头时匹配其实际 64 位 magic；以可打印 `RDOC` 开头的诊断文本仍按普通文本读取。`.rdc` 扩展名、NUL、异常控制字节和大小限制独立生效，改名为日志的二进制 capture 仍拒绝，不能按文件名或特定案例豁免。

`artifact_read.includeRecordedRequest=true` 只允许 owning root General 对绑定 `expectedHash` 的原生 RDC 工具结果使用。主进程校验原结果 owner/source、operation 与 native identity，再从同一 SessionContextJournal 精确匹配 toolCallId，生成单独的 `recorded-model-rdc-request` URI/hash；默认读取不查询 journal。重复回放的同一请求保留来源，参数冲突、缺失、敏感键或不匹配明确拒绝，不扫描其他会话、请求快照或私有 native 文件，不重跑原生操作，不改写旧输出。凭据只证明原模型记录请求，不能证明原生默认参数解析、实际效果、当前 replay 或实验签名。所有子执行（包括 General）不得访问 journal；父级须显式将新凭据引用授予审查者，旧结果授权不隐式包含新凭据。

同一原生结果可用互斥的 `artifact_read.includeRecordedOperationIndex=true` 生成同 operation 的请求索引。操作名仅来自已校验的锚点，不接受任意 journal 查询；仍只限 owning root General。索引覆盖该次读取的全部已提交 SessionContextJournal 内结构化 `shell.rdc.operation/args`，去重 toolCallId 并保留来源、experimentId、记录返回错误及可用原结果引用；同 ID 参数冲突或敏感参数拒绝整个索引，不挑选较新记录。coverage 明示请求结构、条目数、锚点请求是否存在、当前 active turn 排除和其他 conversation turn 的 journal 缺口。可见 conversation history 仅提供覆盖元数据，不充当参数备用来源。索引独立 URI/hash 受原配额限制，不能等同全原生调用目录；legacy/unstructured shell、其他工具、UI 生命周期调用及未提交中断段不在其覆盖内，返回状态与引用须另外验证。索引不判断记录相关性、实验额度、GPU算术或领域完成。审查者只可通过另行授予的精确索引引用读取，不获得 journal 权限。

索引保留同操作的非法参数请求和错误返回，`request` 为原记录的结构化 RDC 请求，`argumentsShape` 仅说明 object/array/null/missing 等形状，不宣称参数或权限有效；无 args 不补 null/零值。请求指纹覆盖原记录请求（含 experimentId 与额外字段），相同 callId 的请求变化不会被去重掩盖。非法请求数量不等于执行数量。

Builtin 目录以 `BUILTIN_AGENT_TOOL_IDS` 为准（49 ids，含 `shell` / `read_image` / `code_interpreter` / `artifact_read` / `rdc_probe`、五个 deferred `knowledge_*` 与三个 deferred `investigation_*`）。Manifest token 经 `CANONICAL_TOOL_TOKEN_EXPANSIONS` 展开（`read` 含 `read_file`+`read_image`+`artifact_read`，`knowledge` 含五个 Knowledge 工具，`investigation` 含三个 Investigation 工具，`interpreter`/`image`/`shell` 为专用 token）；`REJECTED_TOOL_TOKENS` 拒绝无静默 fallback（含旧 token `bash`）。

`read_image` 在 `visionInputMode !== 'native'` 时 `VISION_INPUT_UNSUPPORTED`。tool-result 图像由 `ContextManager.convertToLlm` 剥出并桥成紧随的 user image part；超阈值结果卸货可替换长文本，但必须保留已校验的 image block 供本次模型请求使用，artifact URI 不能替代像素输入。卸货时原图字节写入同一 session 的受控 image artifact，JSON 清单仅保存 URI、hash、MIME 和字节数，避免 base64 触发文本 artifact 单文件上限；清单失败须清理本次新建图像。UI 缩略图只走 session `image-previews` + `conversation:getToolImagePreview`，禁止把大 base64 写入 `resultPreview`。`code_interpreter` 执行 Settings 配置的外部解释器，未启用 fail-closed。

重复图像卸货复用同一 owning session 内经 resolver 完整校验且字节 hash、MIME 一致的既有图像；子执行仅复用自己的隔离输出命名空间，不因相同像素取得其他执行或父级的读写权。新图像以内容 hash 命名，历史调用命名图像保持原 URI/hash/字节、不迁移或删除；每次调用仍各写一份带独立 source 的 JSON 清单，并保留本次模型原图输入。内容地址文件 hash 冲突明确失败，不能覆盖；清单失败只移除本次实际新建图像，不能删除复用来源。硬链接、符号链接、MIME、文件/会话配额及委派检查保持原拒绝边界，配额仍按真实文件逐项计量；复用只避免新增副本，不追溯释放既有占用。相同像素仅证明 payload 相同，不证明 replay 连续性、实验阶段或相同来源。

`native-structured` 路由：core schema 常驻；extended / `mcp__*` deferred，经 `tool_search` 等契约路径激活。未激活调用 → `TOOL_NOT_ACTIVATED`。计划审阅门 `plan_artifact` 与 Tasks 工具仅在冻结有效工具集允许时预激活；三种 Mission 的评估回合，以及已批准 Mission execution offer 的 General，均预激活同一有效工具集内的 `investigation_schema` / `investigation_read` / `investigation_write` / `investigation_list`，使必需的调查记录入口不依赖模型先搜索。普通 General 仍按需发现；角色、Skill 与 Policy 过滤均在预激活之前执行。

`investigation_list` 的 `kind` / `status` 可选；传 `any` 或省略即包含全部对应值，其他允许值作精确过滤。工具目录列出允许值，未知值须明确拒绝，不能把错误输入解释成“本会话无调查产物”。

Run **当前实现**唯一活跃 `schemaVersion` 为 `'3'`（`src/main/sessions/runV3/`）：discriminated union `kind: conversation|mission` + `profileId`，新写无 `mode` / `lastStage` / `runtime.workflow_stage`。产品只读 `run.json` v3；仅有 `run.yaml`、缺版本、旧版本或未知版本时明确报 `STORAGE_SCHEMA_UNSUPPORTED`，保留源文件，不在读取时迁移。只有精确三 Mission profile 才是 `kind: mission`；conversation 的 `captures=[]` 且不消费 investigation sidecar。既有一次性本机转换备份仅供核验，不参与 Run 枚举、IPC、UI 或 Right Rail。见 `DESIGN.md` 裁决 I。

Prompt 仅依据 route 最终实际注入的工具生成能力说明。text-only route 的有效工具集为空，不得列出或模仿工具调用。`tool_search` 无结果时返回 `NO_MATCH_IN_EFFECTIVE_TOOL_SET`、`authoritative: true` 与工具集 fingerprint；fingerprint 未变化时重复同一搜索属于无进展。

执行前先经 `toolValidator.validate` 和工具自身的语义参数校验，再进入 Permission/人工审批；两类校验失败都返回 `TOOL_SCHEMA_VIOLATION`，无效请求不展示审批。`shell` 的 provider 参数根保持普通 object，但只能提供非空 `command` 或 `rdc` 其中之一；同一规则在执行入口再次校验。`CompiledPolicy.deniedTools` 进入 Permission + Executor。非法 policy → fail-closed。

同轮工具并发：只有 `AgentTool.spec.isConcurrencySafe === true` 才安全，缺省 `false`。`ConcurrentToolScheduler` 只并发**连续**安全组；`shell` / write / task mutation / RDC（含 `rdc_probe`） / MCP / ask / handoff / `output_register` 与需要 RDC lease 的 `subagent` 一律串行。offline `subagent` 不请求 `domainExtensions.rdc`，且 **在 allowlist 层**就不能拿到 `rdc_context` / `rdc_probe` / `shell` 中的 RDC 路径。`domainExtensions.rdc.requiresLease=true` 的 child 必须经显式、受限、生命周期绑定的 delegated lease 取得 parent 上下文并串行。禁止并发 RDC 双 owner。`callIndex` 稳定回填。`reserveDispatchBudget` 在 dispatch 前原子扣减 `maxToolCalls` / `maxSubagents` / wall clock；失败整组不开。组内部分失败不连坐已发出调用，但不得继续开新组。abort 必须 `Promise.allSettled` join。

`subagent` 只接受有界 Delegation Capsule：goal/task/scope、带 sourceRefs/qualification 的 acceptedFacts、hypotheses、challengeRefs、带理由/适用/重验条件的 negativePaths、inputArtifactRefs、outputRequirements、stopConditions、requiredSkillIds 和 budget；可选 domainExtensions 仅申请能力。缺字段、超限或非法引用 fail-closed。父级需把子级实际要读的精确 `session://` contentUri 放入冻结引用；调查记录 ID 或 scope 正文不是读取授权，缺引用的子级读取继续拒绝。局部预算须覆盖计划内的读、写与完成调用。compiler 只向 system PromptPlan 加入 runtime 编写的解释规则，完整 Capsule 数据进入隔离子执行的 user 输入，不复制父历史。必需 Skill 在 prepareTurn 预载并冻结。

Temporary 外部路径只经当前 `ToolExecutionContext.temporaryAllowedPathRoots`，不得全局泄漏。

独立 Challenge 的目标引用与制品来源是两种关系：`record.targetRef` 指向被审查论断，`investigation_write.sourceRefs` 以已授权 Investigation `artifactId/expectedHash` 证明来源。`ready` 要求后者非空；`record.status=open` 不妨碍合格审查制品为 ready。子级可在原授权内容范围内读取 manifest/hash 并引用，未读取的元数据不是外部输入缺口；缺授权或预算不足时保持 Partial，不放宽来源检查或重置旧审查预算。

Slash 命令是 runtime 输入，不绕过 profile 权限。基线：`/help` `/context` `/memory` `/agents` `/skills` `/mcp` `/status` `/model`。`/model` 参数为 `[provider:model|modelId|default]`；`default` 跟随当前 Agent 配置，与 Composer 底栏共用 EffectiveCatalog + `isAgentToolExecutableModel` 可选集。裸 `default` 先于模型 id 解析，真名叫 `default` 的模型用 canonical `provider:model`。

权限模式：`Default` / `Auto-review` / `Full access` / `Custom(config.toml)`；主进程权威。即使 Full access：二进制/`.rdc` 拒绝进对话、realpath 约束、灾难性 shell 硬拒绝（按平台分集）、`web_*` SSRF fail-closed。agent `shell` 每次新进程，不提供 `run_in_background`。

`web_fetch` 的来源覆盖和输出窗口分别计量：每次通过同一逐跳 DNS pin 路径读取最多 2 MiB 的完整 UTF-8 来源，接收阶段即执行大小限制；每页正文最多 160 KiB。返回完整来源的 `sourceHash`、字节量和 UTF-16 `page.nextOffset`。续页必须给出 `offset` 与 `expectedSourceHash`，重新读取来源并验完整 hash，来源改变、越界或拆开 surrogate pair 均拒绝；不得拼接不同响应或将截断前缀标为全文。无另一路缓存/下载器，不接受调用者自定义 headers、secret 或大小上限。超过完整来源硬界、非法 UTF-8 和取消须明确失败。HTTP 非 2xx 保留实际 status，不能把其诊断正文当权威资料；来源 hash 与外层工具制品 hash 分别标明。分页的重复请求和成本计入实际工具预算。

解释器已返回的执行结果，无论成功、非零退出或超时，均沿同一 `ToolResultArtifactizer` / session resolver 固定保存，短输出也返回精确 URI/hash；不能因小于自动卸货阈值而只留下转录。`details.invocation` 记录实际传给 `-c` 的原样源码、UTF-8 SHA256、规范语言与本机参数前缀，`exitReason` 与 `exitCode` 来自 ProcessSupervisor 的观察；不保存解释器环境变量。输出截断标志仍必须核对，摘要、等价脚本或新执行不能冒充旧运行的全文回执。该记录证明本机工具所观察的执行输入和返回，不证明 GPU 运算、语义正确或独立复算。受控引用继续按 owning session、hash、配额及显式子级授权读取；持久化失败保留实际已执行事实并禁止仅因落盘错误重跑。配置拒绝等未启动执行仍明确拒绝，不制造执行回执；不追改旧结果。

## Skills 工具收窄

见产品文 [`../product/scoped-runtime-resources.md`](../product/scoped-runtime-resources.md) 与 `DESIGN.md` Invariant：

```text
allowedTools = ∩(skill_i) ∩ runtimeAllowlist
```

空 `allowed-tools` 不收窄。实现：`intersectSkillAllowedTools` + `combineActiveSkillAllowlists`（`DebuggerRuntimePolicy`）。

## Hooks

唯一引擎是 `HookEngine`。分发根：`resources/agent-runtime/hooks`（builtin）< `~/.rdc-agent/hooks` < `<project>/.rdc-agent/hooks`，与 `ScopedResourceResolver` 同序。Hook trust fingerprint = parsed definition + 所有 resolved 脚本/参数文件 bytes + canonical realpath + scope/provenance + PATH 解析后的 executable identity；任一变化 → `needsRetrust`。builtin 默认信任且内容变化必须随仓库发布；user/project 必须显式 trust。旧仅-YAML-hash trust 在首次加载时失效并要求 retrust（不静默沿用）。接线事件（12 canonical）：`session.before-start` / `session.after-end`、`turn.before-start` / `turn.after-end`、`tool.before-call` / `tool.after-call` / `tool.on-error`、`context.before-compact` / `context.after-compact`、`agent.before-handoff` / `agent.after-handoff`、`permission.denied`。禁止第二套 `AgentHooks`。

## Declared Continue and Execution Offer

`AgentHandoffDefinition` 只是 Copilot 式 UI 声明（label / agent / prompt / send / showContinueOn / requiredSkillIds）。人点建议行或计划门后，主进程 `applyDeclaredHandoff` 校验选项属于当前（或刚批准的）profile，触发 `agent.before-handoff` / `agent.after-handoff`，写入 `<sessionPath>/execution-offer.json`，并 persist `session.agentId`。不存在 `agent_handoff` 工具，也不存在 `prepared → committed → consumed` 状态机。打开会话时若仍有 `handoff-state.json`，只 unlink，不 parse、不迁移。

计划门是另一条人机停顿：`plan_artifact` 写活计划并挂起，`approval.requested kind=plan_review`；拒绝意见回同一 tool result，批准写入 `TurnHandle.approvedPlan`（`approvedHash` + target + frozenUri）并覆盖 execution offer。审批决定的时间权威是匹配 `plan-state` 在 approved 状态下的 `updatedAt`；offer 的 `approvedAt` 从该值生成，后续声明交接必须保留同一批准的时间，不能用点击交接的当前时间补写。prepareTurn 在核对批准状态、target 与计划 URI/hash 后，从该决定投影原时间（epoch milliseconds 与 UTC）到已批准交接事实；历史 offer 的错误交接时间不覆盖审批决定，也不重写历史记录，供执行者核对计划期限，后续回合、重试和重启不续预算。回合成功终态把冻结 `profileHandoffs`（`showContinueOn !== false`）快照到 assistant `handoffSuggestions`。Mission 仅在本回合 workTrace 含真实已批准 `plan_artifact` 时才快照 Execute；General 无声明即无按钮。

`send: true` 只表示点完后预填并自动发送。失败提示并留草稿，迟到结果不得写进别的 session。手动改 Composer Agent pill 不写 offer、不预载调查 Skill。prepareTurn 仅在 Agent、批准 handoff target 及冻结计划 URI/hash 与 execution offer 一致时，把声明 `requiredSkillIds` 并入 PromptPlan preload，并追加 volatile 的已批准交接事实（source/target/plan 引用）。它不改变工具、权限或 RDC lease；历史 Mission 规划消息仍作为历史处理。`handoff` / `agent` / `agent_handoff` token 拒绝。

## RDC / Capture

无内置 RDC toolchain。Settings `tooling.rdcCli` 必须配对同安装捆绑 Python 与 `cli/run_cli.py`。General 的 `shell.rdc`、主进程固定 open/remote/close 生命周期及 Live RDC mutate 经原生调用边界直接执行冻结 Python argv，并校验 exclusive lease；`shell.command` 不得调用 RDC，UI 不恢复旧 shell action 或 human-preview 入口。Mission planner 禁止 `shell` 与 `code_interpreter`，只通过受控只读 `rdc_probe` + `rdc_context` 访问 RDC（见 `DESIGN.md` 裁决 J）；probe 同样使用已验证绑定。`rdc_probe` 的模型可见参数按 action/query 分支收窄：非 `probe` 不携带 query args，`capturePath` 只用于 `lease_open`，event 与 VFS 字段只用于对应查询；session context 身份由冻结绑定提供，不要求模型填占位值。运行时仍校验同一身份与路径边界。仓库不硬编码本机安装路径。已打开 `.rdc` 由 `ownerSessionId` 拥有，不匹配 fail-closed；Local + Android-origin capture 不得静默 fallback remote。

RDC runtime context 仅绑定 per-session lease（`RdcRuntimeContextRegistry`）。禁止恢复 `legacyGlobalMirror` / `getRdcRuntimeContext` 全局 API；工具路径经 `assertRdcContextLeaseOwnership`，不得回退 parent。parent 经 `grantDelegatedLease` 授予 child 一条 scoped、生命周期绑定的 delegated lease；child 结束经实际停止确认后 `revokeDelegatedLease`；未确认时父资源保持隔离。未请求 `domainExtensions.rdc` 的 child 在 allowlist 编译期不得看到 `rdc_context` / `rdc_probe`。

## Model Capability（摘要）

`EffectiveCatalogService` 是唯一能力权威。Composer 跟已提交 Agent route revision，不跟乐观 Settings 投影。Agent/Composer 可执行模型必须通过共享 `isAgentToolExecutableModel` gate（source-backed `toolCalling.supported` + 已实现 structured-tool adapter + 账户 available）；`unknown`/`unsupported` 只留在 Settings catalog。Context 计量相位：`Preparing` → `Current request ~` → `Actual` / idle `Last actual`。缩窗在执行拥有的首次或后续安全请求边界安装派生窗口，准备阶段只测量权威历史。完整 UI 计量与控件语义见 `docs/ui/workbench-and-transcript.md`。

## 相关源码

- `src/main/workflow/debugger/` — Orchestrator façade、TurnCoordinator、DeferredTools
- `src/main/agent-runtime/EffectiveRuntimePlan.ts` — schemaVersion 3 冻结 plan
- `src/main/sessions/RdcRuntimeContextRegistry.ts` — per-session RDC lease
- `src/main/runtime/ProcessSupervisor.ts`、`src/main/lifecycle/ShutdownCoordinator.ts`
- `src/main/agent-runtime/` — prompt、providers、permissions、tools
- `src/main/conversation/` — Conversation、journal、Work Process 策略
- 门禁：`pnpm run check:orchestrator-facade`（挂于 `check:architecture`）


## 通用 Harness 与声明续跑（2026-09-15）

General 为默认通用工作身份。核心正文只负责可信上下文、授权、持续执行、Skill 发现与收口；领域名称可留在能力目录。renderdoc-investigation 按调查目标选择 Mission，普通术语问答不强制路由。Mission 策略采用 renderdoc-execution 的六块 Markdown 模板，按规模填写；Knowledge 相似性仅是检查线索。

Plan 经 session artifact plans 类别版本化：同意前覆盖 `session://plans/plan.md`，同意后冻结 `plan-<ISO>-<hash8>.md`，历史文件不迁移或删除。批准写入 execution offer；prepareTurn 仅当 hash 与 target 匹配时预载声明 Skill。通用 turn 仅调用 TurnCompletionValidator。Big Loop 由 General 终答写缺口、用户切回 Mission、新计划、再批准、再点 Execute 组成；runtime 不按身份 / depth / 正文开下一轮。 Mission 额度耗尽但未完成时可通过 `budget_paused` 结束 turn，绝不提升领域报告状态。

普通 Capsule 省略领域扩展且没有 RDC Lease prompt 段；仅 RDC 模块接受 domainExtensions.rdc.requiresLease=true 并注入租约上下文。缺省无 RDC；同一 live context 的租约独占覆盖完整子执行区间，其他安全工作仍可并行；finally 撤销须携带停止证明，否则隔离父资源；旧顶层字段拒绝，不保留双轨。


### Harness / 领域与上下文边界（2026-09-09 收敛）

通用完成检查不按 Mission/General 身份或 depth 推断 Big Loop。handoff Hook 只在人点声明续跑时触发。Checkpoint 与实验回执内容校验在领域服务。completed 才断言领域完成，且仅 Mission 可宣告；partial/blocked/cancelled 不提升报告。自然语言前缀不控制终态。

子执行 artifact_read 只读取显式授予且 hash 冻结的同一所属 Session 引用，嵌套委派取子集。子执行调查输出保存到原调查，输入引用的读权限不授予覆盖权限；只能更新本子执行新建的输出。退出撤销临时访问权，已保存产物继续归原 Session 所有。

Compact 使用原始 Journal、Task/执行记录及应用层组装的领域记录，不由通用 compactor 猜测调查步骤。压缩前保存可按行读取的分块 JSON 权威 Checkpoint；模型看到有界权威记录，以及首次的原始文本或经来源与路由核验的已安装窗口加新增原始文本。权威索引本身超出模型输入上限时，模型只接收明确标注总数、收录数和遗漏数的部分索引；完整 Task、执行、产物和调查记录仍在带 URI/hash 的权威 Checkpoint 中，需要依赖遗漏项时须读取原件。已校验的旧 Checkpoint 若与当前 Journal 前缀一致，新 Checkpoint 只存新增原文及旧源 URI/hash/count；读取或恢复时校验完整引用链，未匹配时保留完整原文分块。完整原始前缀始终可按 URI/hash 复原，不逐条截去长消息尾部。保存失败、hash 复核失败或该增量输入仍超过安全界限时保留原 view，禁止静默丢失。原始图像/测量产物按 URI/hash 保留，摘要须保留来源资格、适用条件和反证的重验条件。

跨回合复用的压缩窗口必须通过原始 Journal 前缀、归档 hash 和已提交的来源执行身份核验，并与当前认证路由匹配（Provider、credential scope、endpoint、协议、binding、contract 不变）。同一路由内仅模型、推理档位或聚合 Catalog revision 改变，不使已验证的可移植文本/图片失效；恢复时再次剥离旧 thinking、Provider response 与 output block 引用，当前 PromptPlan、工具目录和权限仍重新冻结。不匹配的认证/路由或未知来源执行仍拒绝复用，不能通过重放全历史绕过来源验证。稳定 hash 使用有界增量序列化，保持原规范化字节与历史 hash；执行身份查询逐行扫描但不额外保留消息正文，不能为降低内存跳过坏行或来源校验。

已安装窗口保留的原生图片也使用同一 compaction-authority 图片制品与 URI/hash 索引，不把 base64 再塞进受 2 MiB 文本上限约束的窗口 JSON。跨执行恢复须核对图片归属、hash、MIME 与消息/块位置，再恢复原始 vision bytes；缺失、篡改或位置冲突 fail-closed，不能静默替换为纯文本摘要。此类本地制品错误属于 Context 失败，不提示用户检查 Provider 账号或额度。

RDC delegated lease 暂停父控制权，父级 rebind/clear/close 必须先 join；原生结果不确定时隔离匹配版本，迟到失败不得隔离新版本。CLI 进程未观察 close 继续跟踪，相关 context 恢复受阻；观察实际 close 后可进入原有 capture close/open 验证并重新 prepareTurn。重开只恢复绑定，不证明实验 rollback。


### Task 执行、消息与资源生命周期

计划的必需 Task 绑定和定义修订由 canonical owning planner session 提交；委派 Capsule 不取得修改所属父计划义务的权限，新增计划绑定/修订参数在委派调用中明确拒绝。委派仍可按已有 Task 子树合同组织自身范围内的工作；本扩展不宣称实现嵌套计划义务覆盖或扩大子执行权力。

本次新增通用执行要求合同：Task 可声明严格类型的 `executionRequirements`（`mode: direct|subagent`、`requiredSkillIds`、`independentOfTaskIds`）。省略表示没有声明额外执行方式要求，不代表历史记录已证明独立性。`plan_artifact.requiredTaskIds` 从所属 TaskStore 读取必需工作，主进程生成可见目标、完成键、依赖与执行要求快照，纳入同一计划 Markdown 及批准 hash；不从自然语言或 metadata 猜测要求。批准绑定不能通过修改 Task、换同义 Task 或旧结果削弱；允许在原范围新增细分/补证工作，改变批准义务须走原计划修订。

启动门检查当前 Task、批准快照、依赖与实际执行方式；`subagent` 必需工作拒绝父级 direct 启动。必需 Skill 必须出现在真实准备后的 PromptPlan，不能仅凭 Capsule 声明或事后 skill_read 满足。独立执行绑定不同的实际 child session、当前 execution/generation 与最小 Capsule 输入，不继承生成者历史或共享 live domain 授权。结算重复验证 runtime 产生的准备证明、结果来源和必需输出，模型不能通过结果或 metadata 自报执行证明。材料可读和实际读取范围分别验证；科学正确性与审查完整性仍由领域方法和验收判断，不从 mode、空 Challenge 或 completed 标签推断。

此为向当前单一 Task/计划路径增加的可选合同，旧记录不迁移、不重写、不补造证明；取消/join、持久 root/child-local 预算、重启 interrupted 与原消费/期限规则继续生效。

正常重规划使用 `plan_artifact.taskRevisions` 显式提出对同一必需 Task 的变更，携带 expectedRevision；主进程读取当前定义并生成下一修订及前一修订/hash，展示在同一计划快照中。批准前不修改 Task，批准后按同一 TaskStore 原子安装定义修订，再发布批准；活执行须先取消/join，已完成 Task 不重开。CAS 冲突不安装候选或发布批准；同一提案重试不重复增代。原 execution、root、消费及期限不修改，新执行仍从原记录继承预算。取消或持久化失败不得发布迟到批准；已获用户点击授权但尚未完成批准发布的定义变更保持不可执行，正常重提计划可恢复，不手改状态。

单一 TaskStore 的 canonical 文件为 `task-state.json`（仅当前 schema）。Task 保存目标、依赖、父任务、完成要求、修订与执行关联；TaskExecution 独立保存 executionId、taskRevision、generation、父执行、运行状态、共享预算快照、结果及可选冻结计划引用。取消或修订不会让旧结果覆盖新实例。不存在全局唯一 in_progress 限制；依赖存在、无环、已满足，以及完成要求的输出键与执行终态由 TaskRegistry 校验。要求覆盖是否完整、科学结论是否成立仍由模型及领域证据合同负责。

task_update(in_progress)只启动调用者自己的direct execution；Task托管的subagent在wait/background两种模式都由runner独占启动，父级不得先占用同一Task。活跃执行未结算或取消并join之前不能改成pending，也不能再次派发；错误提示保留当前归属并说明恢复边界。误启动的direct execution只能诚实结算未完成结果，重试保留历史、generation和已消费预算，不移除互斥检查或自动改派。

Stop 后的 cancelled execution 保持不可变。用户在后续回合明确要求继续同一目标时，owning 非委派回合可通过 `task_update(status=in_progress, resumeCancelled=true)` 创建原 Task 的下一 generation；未显式声明、同一冻结回合身份、仍有未 join producer、completed Task 和委派 scope 均拒绝恢复。依赖、原 root、最严格限制、原 deadline 与累计消费仍经同一启动门禁；不修改旧 execution/result、不新建同义 Task，也不自动恢复已取消的子任务树。

续跑的 root 归属从该 Task 的前次执行恢复，不因前次为 direct 或 subagent 而丢失；不能从同 session 的其他任务推断或重建新根。父回合改为自己执行同一目标时，当前 live policy 与持久执行必须绑定同一原 root，并继续合并新增消费；委派的 child-local 账本与 root 的上限仍分别保留。

旧格式不由 TaskStore 自动迁移。转换须先逐文件备份原字节与 hash，再验证当前文档、依赖和状态后安装 `task-state.json` 并移除被替代的活动文件；历史完成状态不伪造执行证明。正常运行只有当前格式，无法读取时明确拒绝。runtimeInstanceId 变化使未结束执行转 interrupted；持久化恢复不自动启动模型、工具或重置预算。显式重试/恢复创建新执行，并继承限制与已消费预算。

subagent（mode=background） 必须绑定 Task，持久化启动状态后返回执行标识。query/result 读取状态与结果；wait/join 等待既有执行；message 提交有限补充；cancel 和 task_stop 取消执行树并 join。父回复可以结束而 Task 继续托管；父 Task 正式完成检查子任务、阻塞、失败及结果。用户 Stop、会话删除和应用退出清理运行树；未观察进程退出不能声明清理完成。

每个父 `subagent` tool call 只绑定一份所属 session 的子代理可见记录；child session、Task execution ID 与 generation 约束归属并隔离迟到事件。子事件按主 `ConversationWorkBlock` 语义增量投影可见 loop、消息、工具、审批和诊断，不复制 opaque / 隐藏推理。冻结 capsule 的结构化任务正文、实际发送载荷、实际 final、父工具回执、调用参数及子工具长回执分别保存；final 不与结构化完成声明或执行错误混用。后台头部另存 Task Execution 生命周期状态，不能用 child turn 结束或 Task aggregate 状态代替；等待、取消中、部分完成、受阻与终态由实际 Execution 更新。正文受会话所有权、身份和大小上限约束，超限明确标记不可完整读取。renderer 收起时仅取头部，展开后分页读取步骤、按 revision 合并活跃项并按需分块读取正文。子执行记录不复制进父 `workTrace`，后台完成不修改父回复的 continuation。

后台 subagent 的生命周期由持久 Task 与 mailbox 投影，不进入父回复的同步 subagent continuation，也不由父回复 finalizeTrace 提前结束；审批/信息请求仍走受控入口。结构化 turn_complete 的 disposition、evidenceRefs 位于顶层，result 包含 summary、outputs、counterevidence、unresolved、scope、sideEffects、recoveryState。unresolved 表达认识与适用条件，不自动成为 missingRequirements；完成要求仍由 Task 的必需输出及执行状态校验，不能由通用 runtime 推测科学结论。

后台 Task 的 `progress`、`blocked`、`decision_required` 与终态结果先写持久 mailbox，再投影到所属卡片。它们不发起新的父模型请求、不附加空 user turn，也不撤回已完成的父回复；用户下一次显式请求时，现有 request commit 边界负责投递并确认尚未消费的 mailbox 内容。子执行的审批和信息请求仍按 owner 入口处理。

TaskRootBudget 是同一 TaskStore 中的持久预算记录，以 execution.rootBudgetId 关联，不是第二个执行器或独立预算存储。直接执行、同步与后台子执行、handoff 共用根账本；Capsule 的局部上限及已消费量另存当前执行，派发、重试与恢复只收窄局部上限，不把 child 上限写成 root 上限。同步与后台均恢复本执行局部计数，并在工具效果前等待预算预留持久化；保存失败不得执行效果。parent 回复结束后，后台事件续跑沿用同一 live root ledger，不能创建零消费账本。

`task_get` 保留 Task 原有字段，并增加只读 `budgetSnapshot`：所属执行的持久快照、同一根账本及其查询时余量。仅当执行仍 running、当前 turn 活跃且根绑定相同时，`live` 才提供实际 policy 祖先链及各上限剩余量的最小值；历史执行不能冒充当前额度。subagent-tree admission 单独来自现有检查，不替代 policy 约束或 Capsule 实际分配。无执行、无根或根记录缺失明确返回原因及 null，不能当零或无限额度；身份链接不一致拒绝。查询不会重绑、修改预算或新建账本。执行快照的旧计数不当作 live 余量，读取所得数据也不是 Provider 配额证明或未来资源预留（`isReservation=false`）；并发执行可随后消耗资源，派发仍走既有原子预留与 Capsule 校验。查询调用本身继续由正常工具调度记账。

`task_get.requestUsage` 只读投影当前调用执行 scope 及其后代的已提交模型请求快照数，按 scope/turn 列出，包含失败、重试与辅助压缩请求；未启动 Task 也可核对既有规划消费。子执行不能读取父级或兄弟的请求计数。投影仅扫描现有快照目录与提交文件名，不读取 transcript、凭据或推理正文，不建立第二份账本或迁移历史。未提供调用 scope 时为 null，目录读取失败明确报错，不返回假零。该计数是主进程已提交的本地请求尝试，不等同于 Provider 接收/计费证明、配额余量、未来预留或计划各桶自动授权；模型仍须按批准范围归账，不能跨桶或重置消费。

Task 启动时必须有未过期的 deadline；运行中的执行到期后仍须持久化最终消费并结算，不能把合法的到期回执误判为无效预算。Capsule 墙钟耗尽记为可核对的 `blocked` 预算结果，与用户主动取消区分；原 deadline 和已消费量不因重试而放宽。

父回合内 `maxAggregateWallMs` 的计时窗口从首个子执行开始，仅在至少一个子执行活跃时推进；全部子执行结束至下次委派期间暂停，重叠活跃时间只计一次。准备阶段和执行入口共用该计数；此窗口不重置 TaskRootBudget，也不放宽 child-local `maxWallTimeMs`。

新顶层回合的 subagent-tree 上限来自同一冻结 policy：depth、children、aggregate tools 和 aggregate wall 分别取 `maxChildDepth`、`maxSubagents`、`maxToolCalls`、`maxWallTimeMs`。不得在已有有效 policy 之外另套未投影的默认五分钟墙钟；较短的 policy 同样必须收窄准入。显式传入的子树账本保持其原上限、活跃计时与消费，不在续跑时重建；Capsule 的局部 deadline、父 policy deadline 和持久 TaskRootBudget 仍各自独立执行。

同一 root 的首次并发绑定串行提交，旧持久消费与新上下文独立消费只合并一次；后续绑定同一 live ledger 不重复计费。root 的计数不下降、cap 不增加、deadline 不延后。已经绑定 root A 的 live ledger 再请求不同 root B 时显式拒绝 TASK_ROOT_BUDGET_REBIND_DENIED，保留 A/B 与观察者归属，须由独立执行上下文处理，不能静默换绑。已有执行的重试继续使用原 rootBudgetId，不允许借新父轮次脱离旧预算。

direct Task 启动按目标 taskId 查找本 Task 的既有执行；重试只恢复该 Task 的原预算根，新 Task 使用当前执行上下文的根。不得取整个会话最近一次无关 direct 执行来绑定预算。受委派执行仍由实际 parentExecutionId 继承根，逻辑 parentTaskId 或依赖关系不替代执行归属。

handoff Task 的取消所有权从 durable prepared 实例转交 receiving turn。已 consumed 但接收者尚未登记的空隙内，取消保留 cancelling 并拒绝宣称清理完成；接收者登记时读取此取消意图，在首个 Provider 请求或工具效果前 abort/join。同一接收 turn 内 task_stop 或 task_update(cancelled) 只请求停止，避免等待自身；最终取消记录在 producer 与所属进程退出确认之后提交。

消息存入同一 TaskStore，绑定 taskId/executionId/generation/sequence，区分 to_parent/to_child。有效进展、阻塞、决策请求和结果经安全请求边界消费；游标去重，失效代次不能推进现任务。消息是有来源的数据，不改变冻结 PromptPlan 或授权。UI 事件不等于模型通知；不建立固定频率父模型轮询。审批继续使用现有受控入口，消息不继承审批。

资源仲裁按真实项目路径（含符号链接/junction 解析）或所属 Session 锁定。安全读可共享，unsafe 工具和 Hook 外部效果互斥；审批在工具效果锁之前。调度/等待工具以内部 orchestration 元数据绕开它们所等待的子执行效果锁，实际子工具仍各自仲裁。ProcessSupervisor 的 unconfirmed_orphan 结果只表示有界等待结束，资源锁与原进程记录继续保留到真实 close/error。按执行会话查询/等待进程退出供 Task 取消收口使用；隔离资源阻止新效果，无关资源不受阻。

Small/Big Loop、Scout/Skeptic 委派和补证方向由实际加载的 Skill 与模型决定。runtime 不根据 Agent 名称、depth、正文前缀或关键词启动下一轮。root 两轮 execute/return 预算是硬上限，不是自动循环次数。


子执行的审批/信息请求在主进程绑定 ownerSessionId 与真实 child turn/request/execution 标识。父会话只投影待响应控件，答案仍进入原子请求服务并一次性消费；其他会话、缺失所有者和重复响应拒绝。后台请求可更新已结束父回复的 Work Process，不撤回正文或自动重开父模型。历史读取将进程重启后已无 pending 记录的子请求标为中断/取消，不能复活旧审批权限。

显式 artifact_read 图像在 native vision 路由返回标准 image block 与原 URI/hash；非视觉路由明确拒绝，不用省略提示冒充已审图。该显式读回不会再被大结果外置器换回引用，仍受原生请求预算及产物大小限制。子执行的大工具结果（包括错误）写回已登记根 Session，使用执行隔离路径并登记精确只读引用；长文本以可逆 JSON chunks 分页保存。引用文件 hash 与历史 envelope payload hash 依既有 resolver 合同区分，旧产物仍可读取。

项目根不能证明 shell/MCP 的副作用彼此隔离。unsafe effects 与 Hook effects 除 canonical 项目/会话排他区间外，共享一个保守串行区间；安全只读工作可并行。未观察进程退出时两个区间均保留，无关安全读不被该全局 unsafe 区间阻塞。


### 材料读取与委派参数的实际可用性

`artifact_read` 返回最多 16 KiB UTF-8 文本及同一 URI/hash 的 `next.offset`（行）和 `next.column`（UTF-16 列）游标；按原序拼接页体可重建超长单行和分块 JSON，不拆开 Unicode 字符。`expectedHash` 接受 resolver 返回的 64 位裸十六进制，以及 Investigation manifest 的 `sha256:<64 hex>`；统一核对实际内容哈希，错误值仍 fail-closed。已受控分页的结果不再次外置成包装产物。原始图片单项上限 32 MiB，文本产物仍为 2 MiB，会话配额为 512 MiB、tool-outputs 最多 2048 文件；超限明确失败，不以缩略图替换原图。该有限总量适用于所有会话，支持保留长期调查证据及恢复材料，不增加模型、Task 或原生实验预算；容量快照不等于预留，也不替代具体实验的恢复储备门。

工具效果返回后发生的制品持久化失败必须与执行失败分开：整体工具回执仍标错误并给出存储错误码，明确原工具已返回成功或错误、禁止仅因落盘错误重复执行。序列化结果不超过 32 KiB 时保留完整原正文；更大正文仅保留有界事实索引，明确全文不可得。原 details 独立按 8 KiB 上限保留并显式投影是否省略，以免大正文丢失已先行写入的签名回执引用；该回执仍须独立验签。本次失败外置不生成成功的工具结果 URI/hash 或合格证据。不删除历史证据、不绕过配额；文件数容量与 Task/模型调用预算分别计量。

冻结 RDC 目录的 `search` / `describe` / `list` 成功结果也经同一工具结果归档器提供 owning session 的 URI/hash；小结果仍保留内联正文。归档记录保留实际 catalog fingerprint、完整结果及 toolCallId，沿既有 owner/hash、委派引用与配额规则读取；目录材料不是原生观察或五阶段签名。持久化失败仍给错误且不生成假引用。搜索按关键词相关度保留部分匹配，`total` / `truncated` 仅表示本次候选覆盖，不能用于断言全目录没有某能力。`list` 以绑定 fingerprint 的游标有界分页，提供全冻结目录的 scope/effects/prerequisites 静态准入汇总及同源策略；不替代参数、路径、身份、审批和运行期检查，不授予权限，也不证明外部原生状态为空。

超阈值的原生 RDC `shell` 回执保留完整 session artifact 引用和文件 hash；模型可见摘要从同一主进程校验后的结果提取四项 execution identity、原生 result kind/ok/trace。Pixel History 另投影目标、事件、历史/片元/通过/有效 shader 数量和少量通过的 primitive ID。摘要仅是可追溯的事实索引，不替代完整 payload、五阶段签名回执或领域结论；身份不一致时显式报错，不生成看似可信的正常摘要。

Capsule 的 `profile` 是 Agent 身份，`model` 是 `providerId:modelId`，可选 `reasoningLevel` 经现有 Provider 请求规划校验；不能以推理强度充当身份。子级不继承父会话模型覆盖；若目标 Profile 没有已配置路由且 Capsule 未指定可用 `model`，派发前以 `MODEL_ROUTE_REQUIRED` 拒绝，不生成一个无法请求模型的子执行。`sourceRefs`、`challengeRefs`、`inputArtifactRefs` 都只接受已有受控 URI；自然语言质疑属于 hypotheses/negativePaths。工具搜索按关键词排序，仅在已经过滤的有效工具集中发现；无匹配只证明当前筛选无匹配，不证明能力整体不存在。

压缩先验证原始来源，再持久保存候选，检查取消后原子安装窗口，安装后才发布 after-compact。此前 Provider response ID 不进入新窗口，以免 stateful adapter 绕过可移植续做状态；后续新响应仍可按已验证路由正常续接。签名/加密 reasoning 不进入可读摘要，原始用户历史不删除。原始文本与权威状态无法放入专用调用安全预算时暂停并保留原内容；未声称无限长度或无损压缩。


Task 的 completionRequirements 是 result.outputs 的精确键；验收语义写入描述，由模型依据证据判断，runtime 不猜测领域结论。委派时从所属 Task 存储读取这些键，与 Capsule 一起传入隔离子输入；调用方不能用另一个 Capsule 隐去必需交付。turn_complete 在记录声明前返回可修正的合同错误，最终 Task settlement 仍重复验证当前代次、依赖及结果完整性。完整返回与结构化输出先持久化并校验，再发送有界父投影和引用；子代理不需要另一个文件写入工具完成 runtime 自管的结果保存。

后台重试先选择已有 Task 的根预算，再绑定新执行；不先绑定新父轮预算后尝试换根。旧执行、消费与期限保留。自动压缩、角色恢复和 Provider 元数据刷新不重置这些状态。Composer 的推理选择按实际 Provider/模型路由恢复，同一路由下恢复 Agent 身份不应套用模型默认档位。

Task 状态文件的提交保持同一候选文件与原子 rename。短暂 EPERM/EBUSY 在持有存储锁期间最多重试三次（10/20/40 ms）；不删除目标、不重复领域操作。持续失败删除未安装候选、保留权威旧文件并返回原错误，不能宣称结果已持久保存。

计划批准先验证正文并冻结制品、持久化决策，再发布 TurnHandle 执行授权与 answered 事件；失败不发布批准，新审阅撤销旧在途授权。根/子计划审阅均不得同时生成普通工具审批；子请求回答与读取按持久 delegated owner 路由。

## 专用工具路由与读取前置

文件路由表独立于灾难 shellHardDeny 表，均在权限模式和自定义允许前缀之前求值；Full access 不能绕过。有效工具集合有对应工具时，shell.command 文件读写/搜索返回 SHELL_FILE_TOOL_BYPASS，命令行 RDC 返回 RDC_VIA_COMMAND_DENIED。edit_file 和覆盖已有文件的 write_file 必须先在同一 session 成功 read_file 同一 realpath，否则 READ_BEFORE_EDIT_REQUIRED。已读状态跨 turn、仅内存持有，重启须重读；子 session 不继承。新建文件免先读。

Agent 只绑定同安装捆绑 python.exe 的绝对路径与 cli/run_cli.py；旧 bat 和 PowerShell 转发返回 RDC_BAT_REJECTED，不迁移、不 fallback。旧配置仍可打开修正，但不能执行。

主子可见工作过程共享终态收束：完成、失败和停止冻结所属 loop 与思考状态；未执行工具标为 skipped，已启动但无回执的工具明确失败，不推造成功。独立 Task 生命周期不因父执行完成而终止。模型输入包装不承担产品标题或正文的结构契约。
