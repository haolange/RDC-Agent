# Fail-closed 三分类

> 权威裁决：`ARCHITECTURE.md` Architecture Principles §7。本文定义失败语义分类，并标注仓库内关键点。默认：**安全类必须 fail-closed**；完整性类允许 degrade-safe；可用性类应 recoverable。不得把可用性故障一律升级为安全 fail-closed，也不得把安全边界降级为“尽量继续”。

## 三类定义

失败由拥有该操作合同的边界确认，并携带原始类别与原因向调用方传播；调用方只负责自身范围内的恢复选择，不重新解释成可继续执行的成功状态。故障范围应限于无法满足合同的资源或操作；其余独立能力继续履行各自合同，失败对象保持明确不可用。隔离或退出必须释放自有资源；不能用“允许失败”跳过权限、事务与清理，也不为可用性增加绕过安全或完整性检查的路径。

### 1. Security fail-closed

威胁模型涉及：未授权访问、secret 泄漏、权限扩大、跨 session 污染、不可信 project 覆盖本机执行面、SSRF、任意代码执行。

行为：拒绝操作、拒绝启动、拒绝连接、返回结构化拒绝/诊断；**禁止**静默放行、明文降级、或“先跑起来再补权限”。

### 2. Integrity degrade-safe

威胁模型涉及：损坏记录、部分写入、schema 不匹配、通道冲突、上下文装不下。

行为：保留可验证子集、写 diagnostics、丢弃不可信块、或硬失败到用户可见诊断；**禁止**静默丢历史当真成功。可在明确边界内 degrade（例如 JSONL 坏行进 diagnostics、workTrace 非法置 null），但调用方必须 `assert` 或表面化。

### 3. Availability recoverable

威胁模型涉及：瞬时网络、provider 5xx、进程超时、用户取消、锁竞争。

行为：重试（若契约允许）、abort-and-join、释放 lease、恢复 Composer 快照、展示可恢复错误；**不应**因短暂不可用而永久锁死用户数据或误报为安全违规。

操作前自动审核的宿主超时、路由不可用或响应非法表示审核未完成：当前动作仍不执行，但不能投影成用户拒绝、科学实验失败或原生调用失败。沿现有审批事件保留宿主 `errorCode` 与 `reviewMethod`；模型理由文本不产生异常类别。取消优先保持取消语义，不自动重试或继承其它动作的批准。

## 错误契约

跨边界的失败只有一种形状：`AppError(code, detail?, { params?, cause? })`（`src/shared/errors/appError.ts`）。

- **登记表**：`src/shared/errors/errorCodes.ts` 是封闭登记表，每个码写明分类（security / integrity / availability）与 params 的 zod schema（strict object，值为字符串或数字）；`AppError` 只接受登记过的码，新增失败就是在这里加一行并补中英文案。分类决定调用方的反应（本文三类）；params 是文案可插值的全部字段。开发与测试运行（`NODE_ENV=development` 或 Vitest）构造 `AppError` 时按 schema 校验 params，形状不符当场抛错。
- **错误子类**：需要携带结构化字段的失败（Provider HTTP / 超时 / 流协议、RDC native 失败、adb、OAuth、工具权限、Agent 循环终止等）是 `AppError` 的子类，用登记码构造并保留 `cause` 与各自字段，所以 `errorCodeOf`、IPC 出口与 `humanizeError` 对它们一视同仁；不另写 `extends Error` 的错误类。
- **消息形状**：`message` 保持 `CODE: detail`，日志、工具结果与诊断照旧可读；分支只看 `code`，不解析消息文本。catch 内重抛必须带 `{ cause }`，保留原始失败（ESLint `preserve-caught-error` 与错误契约规则执行；`new Error('CODE: …')` 写法被禁止）。
- **IPC 唯一出口**：`invokeRegistry.dispatch` 是桌面与 Browser QA 共同的出口。处理器失败时返回错误结果 `{ __rdcIpcError: { code, params, category, technical } }`：没有登记码的失败归 `INTERNAL_ERROR`，`technical` 经凭据脱敏；high-impact 通道的审计 outcome 记录同一个 `code`。成功值原样返回。处理器失败一律抛 `AppError(code, detail, { params })`，不 catch 后返回 `{ success: false, error }` 一类字符串结果（那样码会丢失）；成功时返回的就是数据本身。用户在主进程对话框里取消不是失败：返回 `null` 或 `{ cancelled: true }`。Browser QA 桥把错误结果作为 `{ success: false, error, appError }` 返回（`INTERNAL_ERROR` 为 500，其余 422）。
- **renderer**：`createRendererApi` 在 renderer 自己的 realm 里把错误结果抛成 `RendererIpcError`（带 `code`、`params`、`category`、`channel`）。preload 只暴露按通道白名单检查的 `rdcIpc`，不在 preload 里抛错——context bridge 会剥掉自定义错误的属性。
- **说人话**：`humanizeError(error, t, contextKey?)` 对带登记码的失败取 `errors.<CODE>` 文案并以其 params 插值；没有登记码的失败取调用方的情境文案，缺省为 `errors.INTERNAL_ERROR`。技术文本只经「复制详情」进剪贴板。每个登记码都有中英文案（`src/renderer/i18n/locales/*/errors.ts`）。`notify.failure` 发出的错误提示常驻到用户关闭，并带「复制详情」。门禁（`check:i18n`）：每个登记码都有中英文案，每个 `errors.*` 键都是登记码，文案里的占位符必须是该码 params schema 的必填字段。
- **领域结果值不在此列**：Provider 连接结果（`errorCode` 为 kebab-case）、发送预检结果、设备准备结果（带 `ReplayDeviceIssue`）、项目 capture 移除的部分完成结果（`fileDeleted` / `cleanupPending`）、取消回合的结果等以返回值表达的领域状态保留各自的码与文案。

## 存储原语

持久化文件只经两个原语读写（`src/main/runtime/atomicFile.ts`），宿主差异只在 `src/main/platform/fileRename.ts`：

- **写**：`writeFileAtomic(Sync)` 在目标旁写临时文件 → fsync → 改名覆盖目标 → fsync 目录（POSIX；Windows 由 NTFS 日志保证改名持久）。读者只会看到旧内容或新内容。Windows 上读者、索引或杀毒短暂占用目标时改名报 `EBUSY`/`EPERM`/`EACCES`，有界重试后仍失败才报错；不存在先删目标再改名、也不存在 `.bak` 交换。ESLint 禁止平台层之外调用 `rename`。
- **读**：`readValidatedSync` 区分三态。文件不存在为 `null`；存在但无法解析或校验为损坏：报 `STORAGE_CORRUPT`（Integrity），**每次读都报**，直到属主重新写入，绝不读成空值；损坏字节按内容哈希在旁边保留一份 `<file>.corrupt-<hash>`，后续写入不会毁掉证据。持久化格式不带版本号，其他格式写下的文件同样不符合严格 schema，按损坏报告并点名文件；I/O 失败报 `STORAGE_UNREADABLE`（Availability），文件原样保留。
- **信任记录**：hook、项目 MCP 与项目 Agent 的信任决定共用 `src/main/runtime/TrustStore.ts`（`{ records }`，原子写）。损坏的信任文件（包括其他格式写下的文件）读时报 `STORAGE_CORRUPT`，用户重新 trust 即覆盖它；hook 加载时把它作为无效文件上报，其中的 hook 全部按未信任处理。

## 关键点分类标注

| 点 | 分类 | 说明 |
| --- | --- | --- |
| Browser Bridge 未 QA / 无 bearer / Origin / 未知或未注册 channel | Security | debug-only；canonical renderer manifest + handler registry fail-closed |
| `safeStorage` 不可用 / secret IPC 明文 | Security | 禁止明文存储与跨层暴露；Linux `basic_text` / `unknown` 后端视为不可用，提示安装并解锁钥匙环 |
| Provider secret 文件不可读（如 `EACCES`） | Availability（凭据操作仍 fail-closed） | 报 `STORAGE_UNREADABLE` 并保留原件；内容确实损坏才报 `STORAGE_CORRUPT`（旁存损坏副本），缺文件按空配置处理。启动阶段失败经正常资源释放后以非零状态退出，不留活锁 |
| Project MCP 覆盖 user executable / 未 trust | Security | `needsRetrust` + `assertConnectAllowed` |
| IPC Zod 非法 payload / approvalToken 重放 | Security | **全量** handler `parseIpcArgs`；单次消费 token |
| Sandbox / permission deny-by-default | Security | Electron 面 |
| CSP 绕过（`style-src`/`script-src` unsafe-inline、style attr） | Security | 生产无 unsafe-inline；`style-src-attr 'none'`；动态样式走 `useDynStyle` |
| RDC context 无 session / lease 所有权不匹配 | Security | 仅 per-session lease；禁止 global mirror |
| 在途 turn 读可变 Settings / 未冻结 plan | Integrity | `EffectiveRuntimePlan` 冻结权限约束、路由、工具面；当前 permission mode/revision 由主进程动态发布 |
| SSRF / private DNS（`web_fetch`/`web_search`/远程图片/favicon） | Security | 全部经 `runtime/net/publicEgress.fetchPublic`：每跳按统一地址表校验并 DNS pin，任一解析地址非公网即拒绝，请求不发出 |
| Web 来源超完整字节界 / 非法 UTF-8 / 续页来源 hash 不符 | Integrity | 明确拒绝；不将前缀、替换字符或变化后的来源拼为完整资料。页面截断有可校验续读游标，不是不存在匹配资料的证据 |
| Attachment SVG 脚本 / 超限媒体 | Security | `ATTACHMENT_MEDIA_UNSUPPORTED` |
| 附件数量/体积超限 | Security | `ATTACHMENT_LIMIT_EXCEEDED`；`retryable: false` |
| 附件路径缺失 | Integrity | `ATTACHMENT_NOT_FOUND`；`retryable: false` |
| 附件 manifest / magic 不匹配 | Integrity | `ATTACHMENT_INVALID`；`retryable: false` |
| Composer 附加 `.rdc` | Security | `ATTACHMENT_CAPTURE_USE_PROJECT_IMPORT`；引导 Project 右栏 Import |
| Composer 附加可执行文件 | Security | `ATTACHMENT_EXECUTABLE_DENIED` |
| 附件预览跨 session / path escape | Security | `IMAGE_PREVIEW_SESSION_DENIED` / `IMAGE_PREVIEW_NOT_FOUND` |
| 当前模型无 native vision | Integrity | `VISION_INPUT_UNSUPPORTED`；Composer 图片卡前置警告 |
| PDF 无文本层（扫描件） | Integrity | 诊断行，不静默空 inline |
| Policy 非法 / 弱于父级 | Security | `POLICY_INVALID` |
| Capture `ownerSessionId` 不匹配 | Security | 防跨 session 继承 |
| Deferred 未激活工具调用 | Security（授权面） | `TOOL_NOT_ACTIVATED` |
| Skill `allowedTools` 收窄 | Security（授权面） | `∩ skill ∩ runtime` |
| Capability `unknown` → text-only | Security（能力面） | 禁止猜测 native tools |
| Provider channel collision / 无 final_answer | Integrity | 终止 step + 诊断 |
| `PROVIDER_STREAM_*` 协议违规 | Integrity | 不重试；`CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION`；不得误报账号/额度 |
| Agent 连续三轮相同工具结果 | Integrity | `AGENT_NO_PROGRESS` → `CONVERSATION_AGENT_LOOP_STALLED`；不得误报 Provider failure |
| Agent 达到 maxTurns 仍要求 continuation | Integrity | `AGENT_MAX_TURNS_EXCEEDED` → `CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED`；不得静默完成 |
| 本回合 direct Task 未结算即声明完成 | Integrity | `turn_complete` 拒绝并指明待结算 Task；获批调查的普通提前终答将可处理的缺口反馈到同一逻辑执行，真实限制、取消或无进展仍按对应原因终止，不误报 Provider failure |
| Investigation 声明完成时缺 Checkpoint 或没有符合领域合同的 ready report | Integrity | `turn_complete` 返回 `MISSION_COMPLETION_DENIED` 而不记录 completed；报告状态、所需实验和相关 open Challenge 在声明前检查，存储或意外错误直接上报；部分或受阻可按原合同声明，最终答复仍复核实际引用的制品 |
| RDC delegated lease 退出未确认 | Security + Integrity | 隔离 parent lease（`revokeDelegatedLease` 缺停止证明即 quarantine，原因沿用子 lease 的故障或记为 `RDC_RECOVERY_CHILD_EXIT_UNCONFIRMED`）；不得回退 parent 或并发第二 owner |
| RDC 结果未知（原生故障、CLI 协议错误、取消、关闭或切换未确认） | Integrity | 唯一入口 `registerRdcFault`：隔离 owning lease，原因必填（操作、原生参数的 `rdcDigest`、观察到的码，取消为 `RDC_OPERATION_CANCELLED`），首个原因不被后续清理错误覆盖；probe 与 observe 路径登记每个没有无效果证明的原生故障与 CLI 协议错误，`executeRdcShell` 保留主进程复核安全的例外 |
| 获批 capture 切换／恢复的身份或退出无法核实 | Security + Integrity | 停止现场操作并隔离；保留签名 baseline 和未恢复状态，不能将 context clear 当成 daemon 已退出，也不将新现场补入旧实验 |
| RDC 恢复的进程变化无法由退出回执解释 | Integrity | `classifyRecovery` 判 `RDC_RECOVERY_PROCESS_UNEXPLAINED`：Agent 与用户恢复共用这一准入，只读 `context status`（不拉起 worker）；写 intent 与 failed 回执后停止，lease 保持隔离（`docs/architecture/rdc-runtime.md`「身份链恢复」） |
| RDC 恢复次数用尽 | Availability | 同一 {输入、内容、设备} 的 Agent 恢复按签名回执计数，跨 turn 至多 2 次，之后 `RDC_RECOVERY_BUDGET_EXHAUSTED`；用户在 Capture 面板的恢复不计入 |
| JSONL 坏行 diagnostics | Integrity | 不静默当成功；调用方 assert |
| JSONL 末尾残行（追加中断） | Integrity | 读取时作为 `tornTail` 返回，之前的完整记录照常可读，会话不因此打不开；下一次追加或回合终态提交前，残行字节原样移入同目录 `<file>.torn-<ts>`（fsync 后）再截断，并经运行日志报告 `JSONL_TORN_TAIL`；只缺换行的完整记录补换行保留 |
| 计划批准事务：旧 `expectedPlanHash` / 旧会话 revision / `agent.before-handoff` 否决 / 提交中途失败 | Integrity | 分别报 `PLAN_HASH_MISMATCH`、`SESSION_REVISION_STALE`、`HOOK_DENIED`，或原样抛出提交步骤的错误；提交前任一拒绝都没有副作用，提交中途失败按前像日志逆序撤销已写步骤，会话 Agent、模型、参数、计划状态与 offer 保持原值。`agent.after-handoff` 失败只写会话运行日志诊断，不回滚，与其它 after 事件一致 |
| 审计决定记录写入失败 | Security | `AUDIT_WRITE_FAILED`；记录在动作之前写，写失败则动作不发生（IPC 不执行、工具不执行、批准不生效、权限设置不写盘） |
| 工具写入应用自有文件（凭据、设置、trust、`state/**`） | Security | 任何挡位 `FILE_WRITE_PROTECTED`；仅 `sessions/**/artifacts/**` 可写 |
| 工具读取 minidump 或凭据目录 | Security | 任何挡位 `FILE_READ_PROTECTED`：读、grep（含长行 worker 的输入）、glob、文件审计、复制/移动的源、notebook 与输出登记都在 realpath 处拒绝，目录遍历跳过这些目录；Shell 不受此约束（见 `permissions.md`） |
| Storage schema 损坏 | Integrity | 每次读报 `STORAGE_CORRUPT`，原件留在原处并旁存一份损坏副本（见「存储原语」） |
| Storage 文件由其他格式写下（持久化格式不带版本号） | Integrity | 严格 schema 拒绝，报 `STORAGE_CORRUPT` 或 `STORAGE_SCHEMA` 并点名文件，原件保留；不迁移、不自动重建，也不提供转换工具。设置文件在启动时最先读取，提示删除整个数据目录与设置文件；数据目录外的知识库文件由用户按报错的文件名清理；用户编写的 `.agent.md` 声明已移走的字段时判无效并点名文件，由用户修改或删除 |
| Settings 文件（`config.json`）损坏、无法读取或结构不合法（包括其他格式写下的文件） | Integrity（启动 fail-fast） | 启动时主进程按 `app.getLocale()` 的语言弹原生错误框（headless / Browser QA 写 stderr），说明数据格式已变更或文件损坏，写出要删除的整个数据目录（userData）与 `config.json` 的路径，说明重启后以默认设置重建，经正常资源释放后以非零状态退出，不留活锁；不转换、不修复、不改写原件。目录已不再列出的 provider 条目原样保留，不进运行时视图，记 `settings_provider_not_in_catalog` 设置诊断 |
| Memory 跨进程锁超时 | Availability | `.memory.lock` / `.registry.lock` 记录 owner 的进程身份（pid 与 birth），活 owner 永不抢锁；身份证明已退出（pid 不存在或 birth 不同）的锁经独占回收标记串行回收，owner 记录或身份无法读取、回收标记无法安全确认失主时等待并超时，避免抢占正在初始化或新取得的锁；超时 `MEMORY_LOCK_TIMEOUT` / `PROJECT_REGISTRY_LOCK_TIMEOUT` |
| Session attachments.json | Integrity | 只读严格的 `{ attachments }`；纯数组、其他格式写下的文件、无法解析或结构不合法时读报 `STORAGE_CORRUPT`（旁存损坏副本，原件留在原处） |
| Session shell-state.json | Integrity | 写入 `{ state: { cwd } }`；只存 cwd 不存 env；其他格式写下的文件、无法解析或结构不合法时读报 `STORAGE_CORRUPT`（旁存损坏副本，原件留在原处） |
| 非法历史 `workTrace` → null | Integrity | 读边界丢弃 |
| Context 无法装入 → `CONTEXT_CANNOT_FIT` | Integrity | hard degrade 后仍失败则报错 |
| 配置文件单文件 invalid + diagnostics | Integrity | 逐文件隔离，不拖垮列表 |
| Provider stream buffer 超限 | Integrity | 8MiB fail-closed 截断会话步 |
| 用户 Stop / abortAndJoin | Availability | join producers；丢弃迟到 event |
| main 进程未处理的 rejection / 未捕获异常 | Integrity | 写运行日志（含 stack）并写生命周期账本 `fault`（脱敏、替换家目录与数据目录、按脱敏后的 stack 取指纹）；未捕获异常另弹原生错误框，与 Electron 默认可见性一致；main 生产代码由 ESLint `no-floating-promises` 保证每个 promise 被 await、处理或显式 `void` |
| renderer / GPU / utility 等 Chromium 子进程死亡、worker 线程意外退出、受监管子进程异常退出 | Availability | 各写一条账本记录（`process_gone`、`worker_thread_exited`、`supervised_child_exited`；正常退出与应用主动的超时、中止不记）；renderer 按下文「renderer 崩溃策略」恢复 |
| ProcessSupervisor timeout/abort | Availability | terminate process tree; settle only after observed close/error; abort opens a bounded observation window, so even an unbounded join resolves `unconfirmed_orphan` (kept in the registry) when close never arrives |
| RDC 操作卡住、worker 丢失或无法启动、daemon 丢失或无响应、操作取消 | Availability | `RDC_OPERATION_STUCK` / `RDC_WORKER_LOST` / `RDC_WORKER_UNAVAILABLE` / `RDC_DAEMON_LOST` / `RDC_DAEMON_UNRESPONSIVE` / `RDC_OPERATION_CANCELLED`；只有无进展预算，没有墙钟；取消先 `daemon cancel` 并等回执再终止 CLI；结果未知的 owning context 隔离，不自动重试（`docs/architecture/rdc-runtime.md`） |
| ShutdownCoordinator 限时 shutdown | Availability | 尽量排空后退出；`release_owned_runtimes` 失败必须记错误并保留归属记录，不得假装 daemon 已停。账本记录起因（`window-close` / `before-quit` / `update` / `renderer-failure`；SIGINT/SIGTERM 由 Electron 自己转成 quit，记为 `before-quit`）、超时的阶段及当时未完成的 disposable、是否超时；干净与超时两条路径走同一个退出 |
| 关停时停止的回合 | Availability | 停止原因 `app-shutdown` 写在 stopped 消息的 `stopCause` 与 cancelled run 的 `stopReason` 上，界面写「应用关闭时已停止」，不显示成用户停止 |
| 上次启动未正常结束（`instance.lock` 未释放） | Availability | 见下文「上次启动诊断」 |
| Provider 网络/配额类错误 | Availability | 按 ErrorRecovery 契约；不发明 entitlement；429 与明确 `quota_exceeded` 的 402 只记录短期 quota |
| Provider 空流 / wire 失败 / 恢复 abort | Availability | 见下文「provider 失败诊断保真」；空流不得合成 HTTP 502；最终 Work Process 只展示一条诊断 |
| Headless instance.lock 冲突 | Security + Availability | 冲突 fail-closed 避免串 userData |

## provider 失败诊断保真

Provider 请求失败须保留 cause 链与用户可区分诊断，不得把空流冒充真实 5xx，也不得把 Agent loop 停滞误报为 Provider failure。

### 错误类型（`providers/internal/http.ts`）

| 类型 | code / 形态 | 语义 |
| --- | --- | --- |
| `ProviderEmptyStreamError` | `PROVIDER_STREAM_EMPTY` | 流结束但无 assistant 正文或 structured tool call；**禁止**合成 HTTP 502 |
| `ProviderWireFailureError` | `PROVIDER_WIRE_FAILURE` | OpenAI/Azure Responses SSE `error` / `response.failed` 无 400–599 status 时；有 status 则 `ProviderHttpError` |
| `ProviderHttpError` | `PROVIDER_HTTP_ERROR` + HTTP status | 真实 4xx/5xx；`createResponsesStreamFailure` 仅在 wire 带明确 status 时使用；携带服务端 `retry-after-ms` / `Retry-After` 解析出的 `retryAfterMs` |
| `ProviderStreamProtocolError` | `PROVIDER_STREAM_TRUNCATED` | 已有输出、连接关闭，但没收到该协议的终止信号（`message_stop`、`finish_reason`、`[DONE]`、`done:true`、`response.completed` 等）；半截答案与半截工具调用不入库为完成 |
| `ProviderStreamProtocolError` | `PROVIDER_STREAM_MALFORMED_FRAME` | 流中一帧不是 JSON；不跳过、不拼接后续帧 |

### Provider 请求时限（`providers/internal/streamWatchdog.ts`）

每条 provider 流只有一个看门狗，由 `startProviderStream` 持有；适配器与帧读取器不自带计时器，也没有总时长上限。

| 阶段 | 起算 | 时限 | 超时 |
| --- | --- | --- | --- |
| `first-byte` | 请求发出时（覆盖建连、响应头与首个 chunk） | `providerFirstByteTimeoutMs(plan)`：`reasoningWire.control.kind` 为 `none`，或 `selection` 为 `off` 时 **20s**；否则 **180s**（推理模型可能长时间不出字） | `ProviderTimeoutError`（`PROVIDER_TIMEOUT`，`phase: 'first-byte'`） |
| `idle` | 每收到一个 chunk / part（含 keepalive 字节；AI SDK 路径按 stream part，`start` 除外）后重置 | **60s** | `ProviderTimeoutError`（`phase: 'idle'`） |

只要持续有进展，流就不会被总时长截断。`ProviderTimeoutError.afterContent` 记录触发时 `AssistantStreamBuilder` 是否已产出模型输出（正文、thinking 或工具调用）；`ErrorRecovery` 把 `ProviderTimeoutError`（含 cause 链中的）归为 `network_error`，输出前超时沿用该类的 3 次重试，输出后超时不重试（重试会丢弃已产出内容并重发整个请求），直接 abort 并保留 cause，已推送的 partial 消息仍留在 UI。AI SDK 路径（`AiSdkStreamingProvider`）按 stream part 重置看门狗（SDK 在发请求前就产出的 `start` 除外），看门狗触发的中止按超时错误报告（`stopReason: 'error'`），用户取消仍为 `aborted`。AI SDK 路径的超时按超时错误报告（`stopReason: 'error'`），不再报成 `aborted`。

### ErrorRecovery 分类与重试

| category | 行为 |
| --- | --- |
| `empty_stream` | 最多重试 **1** 次后 abort；**不**归入 `server_error` |
| `rate_limit` / `network_error` / `server_error` | 均最多 **3** 次重试（`DEFAULT_MAX_RETRIES`），耗尽后 abort；`server_error` 为真实 HTTP 5xx。等待取 `max(指数退避, 服务端 Retry-After)`；服务端要求超过 **60s**（`MAX_RETRY_AFTER_MS`）时直接 abort 并写明要求的等待 |
| `network_error`（`ProviderTimeoutError` 且 `afterContent`） | 不重试，直接 abort；`maxAttempts` 为 1 |
| `overloaded` | HTTP **503/529**，或文案含 `at capacity` / `high demand` / `overloaded` / `service unavailable`；最多 **3** 次重试（`DEFAULT_MAX_RETRIES`）；连续 **3** 次（`OVERLOAD_SWITCH_THRESHOLD`）命中且存在不同的 fallback model 时 `switch_model` 并清零计数；无 fallback 则重试耗尽后 abort |
| `prompt_too_long` | 先做一次 reactive compact；仍超长则 abort |
| `max_tokens` | 输出上限决策：先 reactive compact（未尝试时），再 `continue_prompt` 最多 **2** 次（`DEFAULT_MAX_RECOVERY_RETRIES`），耗尽后 abort |
| `unknown` | 立即 abort |
| `auth_error` | **401/403**；立即 abort |
| `stream_protocol` | `PROVIDER_STREAM_*` 协议违规（含截断与坏帧）；不重试 |

`AgentRecoveryAbortError` 必须经 `createAbortError` 构造，始终携带 `cause` + `recoveryCategory`（上表的恢复分类；`category` 是 `AppError` 的失败类别）/ `attempts` / `maxAttempts` / `lastStatus?` / `bodySnippet`（脱敏 ≤300）；禁止裸 `new Error('[Recovery abort]')`。

### Turn 失败诊断（`createTurnFailedDiagnostic`）

- 对外 code 仍为 `CONVERSATION_LLM_REQUEST_FAILED`。
- `userMessage` 按 cause 分类：**auth** / **quota-rate** / **overloaded** / **real 5xx** / **empty_stream** / **network**。
- `technicalMessage` 固定：`provider HTTP <status\|n/a> · attempts <n>/<max> · <snippet>`（经 `redactTechnicalMessage` / `redactRecoverySnippet`）。

### Agent loop 与 Work Process 投影

- `AgentLoop` 不得把 provider `error` 事件 remap 为 `message_end`。
- `AgentTurnRunner` 的订阅阶段（`AgentTurnSubscription`）在 `stopReason === 'error'` 时跳过 `empty_response_without_tool_call`。
- `error_recovery_*` 不进 Work Process；最终失败为 **一条** diagnostic（含 `technicalMessage`）。

## 过度 fail-closed 的纠正原则

下列场景**不应**仅因“出错”就按 Security 永久拒绝（除非同时触及授权/秘密）：

1. **单条 JSONL 损坏**：Integrity — 报告 diagnostics，保留可读行；全文件不可读才抛文件级错误。
2. **单个 scoped 资源文件损坏**：Integrity — 该资源 `invalid`，其它资源继续列出。
3. **用户主动取消 turn**：Availability — abort-and-join 后允许下一 turn，不把 session 标为不可信。
   知识导入、导出与重建索引的取消同属 Availability：`KNOWLEDGE_OPERATION_CANCELLED` 在两项之间生效、不打断写入，主进程先把状态恢复到操作之前（导入删除本次写入的卡片，导出删除临时文件，重建保留旧快照）再拒绝；renderer 把它当作中性结果，不显示错误。
4. **Mermaid/KaTeX 渲染失败**：Integrity/Availability（UI）— 该块 fail-closed 展示错误，不影响整条消息其它块。
5. **Reasoning `unknown`**：不是 Security 拒绝发送；UI 呈现与关档相同的 `Disabled` / `禁用`（灰掉不可调），控件不发明档位。

代码注释应使用 `// failure-class: security|integrity|availability` 标注意图（仅在边界函数处，避免噪声）。

## 相关测试

- Provider 失败保真：`ErrorRecovery.test.ts`、`providers/internal/streamWatchdog.test.ts`、`providers/internal/providerStreamDriver.test.ts`、`AiSdkStreamingProvider.test.ts`、`ConversationTurnDiagnostic.test.ts`、`providers/internal/http.test.ts`、`OpenAIResponsesProvider.test.ts`、`AgentLoop.recoveryDiagnostic.test.ts`
- Integrity 存储：`src/main/runtime/jsonl.test.ts`、`src/main/testing/contracts/storageFaultContract.test.ts`
- Availability 取消：`TurnCoordinator.test.ts`、`ProcessSupervisor.test.ts`、`cancellationContract.test.ts`、`KnowledgeImportService.test.ts` / `KnowledgeExportService.test.ts` / `KnowledgeIndexService.test.ts`（知识长任务取消）
- Security 矩阵：`securityContract.test.ts`

## Capture 分阶段失败

Open 失败、图片获取失败、设备显示不支持、Close 未确认分别投影。native context 已打开而图片失败时保留 lease，重试只请求图片；但图片失败本身是原生故障或 CLI 协议错误、又没有 RDC-Tool 的无效果证明时，回放状态未知，按下文统一登记故障并提供关闭/恢复。无颜色输出不可复用上一事件图片。关闭和半开恢复失败保留 context/设备占用，必须显式关闭确认；不以清空 UI 模拟释放。历史写失败或达到配额后明确未保存，已有历史保持不变。Remote `unsupported` 是能力边界，不能投影显示成功。

## 会话取消与执行失败

请求 stopped、操作 cancelled、未执行 skipped、真实执行 error 与计划 rejected 是不同事实。取消不得生成拒绝意见或虚构错误；已有真实失败回执保留。待审计划的取消须结算对应 owning Turn 的当前计划状态，不能影响较新审阅。停止提示由 Work Process 标题承担，详细原因仍在所属调用详情，原始模型输出保持。崩溃恢复的 interrupted 继续作为中断错误处理，不冒充用户主动取消。

## 生命周期账本与崩溃追踪

**账本**：`src/main/runtime/LifecycleLedger.ts`，文件 `<appStateRoot>/lifecycle/ledger.jsonl`，每条经 `appendJsonlDurable`（open → write → fsync → close）写入，4 MiB 封顶并保留一代 `ledger.previous.jsonl`。每次启动一个 `instanceId`（Task execution 的 `runtimeInstanceId` 用同一个）。事件为严格 zod 联合：实例启动与退出、关停（起因、阶段超时、结束）、进程死亡、worker 线程、受监管子进程、`fault`、回合开始与结束（含停止原因）、续接丢弃决策、上次启动诊断、renderer 恢复动作，以及留给 RDC 执行层的 `rdc_operation`（started / terminal）与 `recovery_step`。账本只记事实，不记 prompt、工具参数、文件内容与凭据；自由文本经 `redactSecretsDeep` 与家目录、数据目录替换。写入失败只写 stderr，不让生产者抛错；读取（`tail()`）跳过追加中断的末行，其他坏行计数为 damaged。

**本地崩溃文件**：拿到 `instance.lock` 后，主进程把 `crashDumps` 指到 `<appStateRoot>/crash` 并以 `uploadToServer: false` 启动 Electron crash reporter（Crashpad 在进程外写 minidump，主进程自身崩溃也会留下）。disposable Browser QA 不启用。启动时最多保留最新 5 个、不超过 14 天的 minidump；「设置 › 常规 › 崩溃报告」显示数量与大小并可清除（只删 `.dmp`，保留 Crashpad 自身记录）。没有任何导出读取 `state/`：知识导出只读知识空间内的卡片与图片，计划导出只写计划文档，崩溃文件不会经应用离开本机。

**上次启动诊断**：`acquireUserDataInstanceLock` 回收 owner 已退出的锁时返回 `staleOwner`（锁记录 pid、birth、mode、startTs 与 `instanceId`；无法读取的锁视为什么都没记录），本次启动在读取任何会话之前由 `diagnosePreviousInstance` 归类：

| 依据（按顺序） | 归类 |
| --- | --- |
| 上次启动之后写下的 minidump 多于记录到的子进程死亡 | `native-crash-suspected` |
| 否则取最晚的一条结束性事实：未捕获异常 | `js-fatal` |
| renderer 死亡 | `renderer-gone` |
| 其他 Chromium 子进程死亡 | `child-process-gone` |
| 关停已开始但没有 `instance_exited` | `shutdown-interrupted` |
| 以上都没有（进程无痕消失） | `killed-or-power-loss-suspected` |

诊断写入账本，并经 `app:getMeta` 交给 renderer，启动时以常驻 `notify.failure`（`PREVIOUS_INSTANCE_*` 码）提示，「复制详情」带归类、进程、原因、最后记录时间与未结束的会话/回合。由上次启动留下的记录按时间与 `instanceId` 关联：`CONVERSATION_INTERRUPTED` 诊断带结构化 `interruption.cause`，renderer 按当前语言写出；恢复的 run 写 `stopReason: previous-instance:<cause>`；中断的 Task execution 用按原因区分的 summary。更早启动留下的记录原因为 `unknown`。

**renderer 崩溃策略**（`src/main/window/rendererRecovery.ts`）：renderer 死亡先写账本；第一次自动重载；60 秒内再次死亡则带崩溃参数加载入口，renderer 直接进入整页错误视图（`ui/EmptyState` page：重新加载、复制详情）；错误视图本身再死亡或入口文档加载失败时，弹原生对话框（`src/main/window/rendererStartupFailure.ts`，重新加载 / 退出）。根 React error boundary 对渲染期异常显示同一页面，并经 `app:reportRendererFault` 写账本 `fault`（`renderer-exception`）。

相关测试：`LifecycleLedger.test.ts`、`previousInstanceDiagnosis.test.ts`、`userDataInstanceLock.test.ts`、`crashFiles.test.ts`、`ShutdownCoordinator.test.ts`、`rendererRecovery.test.ts`、`RootErrorBoundary.test.ts`。
