# Session Projection 契约

> 产品边界与不变量以根目录 `DESIGN.md` 为 SSOT。本文约定 renderer **Active Session Projection**：主进程允许多 session 并行 turn，UI 只投影当前 active session；后台 session 事件写入 sidelined cache，切回时 hydrate。

## Active Session

工具审批的 `reviewMethod` / `errorCode` 来自主进程，随 owning session / turn / toolCall 的现有 workTrace 持久化及 delegated 投影传递。规则检查、独立模型判定、审核异常与人工审批分别显示；历史缺字段保持未知，不依据 risk 或 reason 补造来源。拒绝与审核异常明确当前动作未执行，已批准后的工具错误按实际执行结果展示。Composer 的“模型思考”与审批的“操作风险”分开标识，不改变原有 generation、取消及 currentSession 隔离。

- `projectStore.currentSession.sessionId` 是 renderer 唯一 active session。
- 跨项目选择项目根而不选会话时，先缓存并清空旧 session 的 transcript、运行态、右栏与 Composer 上下文，再投影目标项目；此时 `currentSession=null` 不代表旧 turn 又成为前台。旧 turn 的流事件及最终返回留在所属 session cache，不能重新选择旧项目或会话。仅从当前所选项目的无会话 Composer 发出的首轮结果可以建立前台新 session。
- Sidebar 每个项目节点只投影 `session.projectId` 与该节点一致的会话；乐观切换期间旧项目的 session 列表不能暂挂到新项目标题下。
- Main `session:select` / `session:create` 更新权威 current；不 abort 其它 session 的 active turn（多 session 并行是契约意图，见 `concurrencyContract`）。
- Capture 所有权仍按 `ownerSessionId` fail-closed（见 `permissions.md`）。

## IPC 门控

所有带 `sessionId` 的流式/投影事件在进入 active UI store 前必须经 `isActiveSessionEvent(sessionId)`：

| 事件族 | 门控字段 | Active 路径 | Background 路径 |
| --- | --- | --- | --- |
| `conversation:*` stream | `event.sessionId` | upsert active conversation | `sessionProjectionStore.projectSession` |
| `trace:projectionChanged` | `payload.sessionId` | `setTracePresentation` | cache workflow.trace |
| workflow 状态 | 无 push | `workflow.getState` / restore → `setWorkflowState` | 无 push |
| `run:statusChanged` / usage | `runId` 或 `sessionId` | 已有 currentRun/session 比对 | ignore / cache |
| tool / evidence patches | turn 所属 `sessionId` 或 message 归属 | 仅更新 active message | cache |

**禁止**未门控直接 `upsertConversationMessage` / `setTracePresentation` / `setWorkflowState`。门禁：`pnpm run check:session-projection`。

## Composer Draft 与恢复

- Draft / pending attachments / pending skills 按 `{projectId}:{sessionId}` scope 隔离（`buildComposerSessionScopeKey`）。
- `lastSentPrompt` / `restoreComposerDraft` / Stop 恢复必须携带 owning `sessionId`（及 `projectId`）；恢复前校验与 `currentSession` 一致，否则跳过。
- Markdown Composer 输入以 `key={scopeKey}` remount，避免 CodeMirror 文档残留。

## Active Turn Context

计划审批局部状态按session、turn、toolCall及计划身份隔离，切换会话/修订时销毁意见、错误和弹层；模型保存的迟到反馈不能回填新面板。审批区复用 SessionRecord.modelOverride 与 turnControls，模型和参数保存串行提交；保存中或失败阻止批准但允许停止，批准前等待最新保存。排队保存离开所属会话后失效，不能切回时重新投影。覆盖只影响之后的新请求，不能改动已冻结的当前请求；批准交接沿原队列使用新配置，拒绝后仍恢复原冻结请求。无覆盖时由各声明目标 Agent 原配置决定模型，UI显示“按Agent配置”，每个继续入口校验实际目标模型。

执行准备期间保留本次提交的模型/参数作为待确认选择，阶段提示与模型身份分开；不得将旧请求配置标为本轮事实；主进程返回 PreparedTurnContextSummary 后，禁用的 Composer 从其 route 与 controls 显示实际请求。provider 停用/断连、模型不可执行时，保存的引用保持不变，选择区明确不可用，发送与批准均阻止；恢复可用后原引用可继续使用，在途请求不读取可变设置。

工具声明时间 startedAt 与实际执行时间 executionStartedAt 分开。后者仅由 tool.started 事件写入并在后续合并中保持；事件在权限、前置 Hook 与资源队列准入后、真实工具 effect 前产生。审批通过本身不代表工具已经开始。迟到参数声明不能将已运行或终止调用降为 pending。普通 pending/未执行跳过记录保留审计但不投影成主轨道工具卡；审批、输入和执行前错误仍可见。耗时以真实起点计算，历史缺少起点时留空。隐藏的后续声明仍参与整组是否终止的判断，不能因前八项完成而提前聚合。Task 快照按原事件身份与内容保留，默认展开及手动开合按所属 scope 记忆。

Send 与 Rewrite 共用 session-scoped `ActiveTurnContext`：

```typescript
interface ActiveTurnContext {
  sessionId: string;
  projectId: string | null;
  requestId: string;
  agentId: AgentId;
  optimisticTurnId: string | null;
  realTurnId: string | null;
}
```

- Session 切换时清空 context 与 `isPromptSending`；Agent 运行态只读取当前 context 的 `agentId`，禁止扫描历史 draft/streaming 消息推断。
- Stop 只读当前 session 的 context；禁止依赖跨 session 的 stale `activeRequestIdRef`。
- Send、Rewrite、Stop 与运行中菜单状态都按 `sessionId + requestId + agentId` 投影。Monotonic stop 以 **`requestId` 为主**、`turnId` 为辅：optimistic → real turnId 替换后，已停止的 request 仍拒绝迟到 `draft`/`streaming` patch。

## Session 切换 Hygiene

切换或新建 session 时同步：

跨项目直接选择 session 时，Immediate 清理必须先于 `currentProject/currentSession` 的乐观切换；不能等异步 `project.select` 和 session 列表完成后才清理，否则新项目加载期间会短暂显示旧项目 transcript 与右栏。
若目标项目或会话选择被拒绝，恢复原选择及其缓存投影，错误只展示在当前导航入口。

1. Immediate：`setConversationSnapshot([], null)`、`setTracePresentation(null)`、`setWorkflowState(null)`、clear usage / prepared turn；
2. Dispose 并重建 `conversationEventBatcher`（丢弃 pending RAF）；
3. Reset composer active turn context / lastSent（若 lastSent 不属于新 session）；
4. Async pull history / trace；若 cache 命中则优先 hydrate。

切回后台 session：`activateSession` 从 `sessionProjectionStore` hydrate，miss 则 IPC `getHistory` / `getProjection`。

## Stop / Rewrite

与 [`runtime-kernel.md`](runtime-kernel.md) 一致：

- `preparing` → 干净撤销（本 session 草稿恢复；transcript 不留本轮）；
- `committing` / `running` → 单调落停；
- Stop 回执成功不代表指定 assistant 被取消：可能仅停止了后台工作，原回合已先完成。committed 回合停止后，renderer 经现有 `conversation.getHistory` 对账同 session/request/turn/agent 的权威终态，仅合并该消息；已完成/失败/停止消息不得再被乐观停止改写。读取期间切换会话时只更新所属 cache，新请求的消息与 ActiveTurnContext 不被旧停止回执覆盖。
- Rewrite 提交立即写入 ActiveTurnContext；Stop 可在 optimistic 阶段按 `requestId` 落停，IPC reconcile 不得用 `streaming` 覆盖已停止 request。
- 改写分支的 `anchorUserMessageId/rootTurnId` 标识分叉首轮，不是后续每轮的身份。终态写入须核对当前 user/assistant 的 turn 与 branch，并验证分支锚点仍属于该分支及其 root turn；同分支后续回合允许提交，切换可见分支不撤销后台回合的归属。

## 验证

- 单元：`sessionEventGate`、composer restore session bind、monotonic requestId、projection cache activate。
- 静态：`pnpm run check:session-projection`。
- Browser QA：删尽 QA project sessions → 新建隔离 session → 多 session 串台 / Stop / Rewrite 矩阵（见 `AGENTS.md`）。

## Right Rail scoped payloads

Right Rail task resources and Capture state are scoped by the full `{ projectId, sessionId, payload }` envelope. `context:get`, `capture:getOpenedState`, replay apply, and close requests require an explicit scope and return `null` when no owner scope exists. `context:changed`, `capture:openedStateChanged`, and session capture status updates use the same envelope. Renderer caches background payloads by owner session; only the active session hydrates Context resources and the always-visible Capture area, and late events from another session cannot overwrite either surface.

Outputs use the same session-owned projection path. `output_register` writes an explicit run-scoped artifact record after copying one completed project file; a refresh for that session projects it into Outputs. Investigation Artifacts ride the same `tracePresentation.rightPanel` envelope as `Progress / Artifacts / Outputs / Context / Capture` and never mix with Outputs. No renderer-side path discovery or background-session artifact event may populate the active rail.

## Capture Replay projection

`capture:replayChanged` 携带 projectId/sessionId、binding generation 与单调 revision。只有 Active Session 能写当前卡片；其他会话继续拥有其 context。`capture:getReplayState` 读取所属完整快照，不使用全局最近 context。刷新与事件应用仅改变 owning binding；requestedEventId、appliedEventId、imageEventId 不互相代替。切 session 时丢弃旧订阅、请求结果和历史图片结果。RDC 列表为空保持原空态，不因残留历史或错误重新挂载新增内容。

`project:inputsChanged` 反映完整扫描确认并持久化的当前输入，发布不等待回放清理成功。清理错误与待办通过独立 `replayCleanupPending` 和 `project:inputsError` 保留；renderer 不从清理待办、旧 capture binding 或历史足迹恢复已确认不存在的 RDC。最后一个输入删除后，重新挂载或重启仍显示原空态。

Agent preparing 与 active turn 使用独立锁 owner，准备转入运行时不能出现解锁间隙；delegation 和 native process 未确认退出仍为锁定。运行中同一画面和 EID 控件继续投影实际状态，禁止人工打开/关闭/切文件/切设备/事件 apply。

Capture 的人工与 Agent 控制共用同一当前回放状态、图片、原生事件列表与控件，不按控制者选择图片来源，不提供独立历史滑条。interactionLock 仅决定人工操作可用性，不卸载控件；Agent 观察成功时 requestedEventId 同步该次 appliedEventId，失败时不保留旧 requested/image 归属。图片刷新包含 image.updatedAt，避免同 EID replacement 留旧图；迟到图片与状态仍按 scope/generation/revision 隔离。既有操作证据保留在主进程存档，不向 renderer 暴露第二套图片镜像。

子代理卡片由父消息中的 tool call 定位；会话拥有的委派日志独立增量持久化。`conversation:getDelegationTrace` 的零页只返回头部，含子执行状态及后台 Task Execution 状态；两者含义不同。步骤页带稳定 ID、revision 和可见 `ConversationWorkBlock`；工作过程首次展开取最近 40 步，向前每页 40 步，运行中按 revision 合并。`conversation:getDelegationContent` 校验当前 session、父调用、child session、execution ID 与 generation，再以 UTF-8 字节偏移分块读取结构化任务、实际发送载荷、final、父调用/回执或指定子工具回执；分页不得拆断字符。`conversation:delegationChanged` 携带 session、父调用与 revision，仅刷新对应卡片；切换 session、取消及身份变化后的迟到结果不得进入当前视图。后台 Task 在父消息结束后仍可更新其记录，终态后迟到通知不得重新激活。

Progress 的任务定位仅通过 renderer 内部有类型的请求收集工作记录中的候选卡，由窗口化列表负责展开、滚动与聚焦；请求不提供任务状态，也不增加公共 IPC。历史 Task 卡保留事件发生时的列表，右栏仍读取最新 `taskProjection`。

计划门与普通工具审批互斥投影，包括 delegated 请求。子计划的内容与决定绑定 child owner，parent 仅承载显示与回答入口。建议行 Agent 切换成功后，send:true直接发送显式载荷、send:false才预填；当前会话变化、Stop、请求失效或切换失败必须丢弃迟到结果，不覆盖其他会话草稿。

委派记录使用显式结构契约；不符合当前契约的详细记录返回不可用。结构化任务与实际发送文本是不同正文种类，读取同受 session、父调用及子执行身份校验。终态先增量持久化收束后的内部步骤，再发布头部 revision；重启中断读出的步骤使用持久时间收束，迟到事件不得恢复运行。


## 调查制品摘要与完整列表

main-owned artifacts 投影仅含 rows（最多5项）、totalCount、storeDegraded；同一选择路径排除已被取代记录并按 createdAt、artifactId 倒序。只读 investigation:list 请求显式 projectId/sessionId 及可选 createdAt/artifactId 游标，主进程校验当前session/project归属、严格游标和固定50项页面；返回 rows/totalCount/storeDegraded 及可选 nextCursor。renderer不重建版本关系，不访问存储。存档及 supersedes 链保持，旧的替代/截断计数UI字段删除。

列表、分页和预览状态按完整project/session身份隔离，切换时关闭并拒收旧结果。预览沿既有 investigation:read 与 expectedHash，分页不能扩大读取权限。上下文只限量展示，不改变被冻结Prompt段和成功tool result的资源来源。


### 目录内存投影

Renderer 的 EffectiveCatalog snapshot 只按 provider/account/protocol 保存，不写用户资源或历史会话。会话与 Agent 选择共用快照，账号或协议切换后旧请求和事件不得进入新 scope；模型选择成功才更新会话，失败不推进本地选择。共享目录不会替代 prepareTurn 冻结的 RequestPlan，也不会改变子 Agent 的模型继承边界。

## 请求取消与计划归属

- ConversationMessage/WorkTrace 的 stopped 是当前请求终态，不表示会话结束或某种模式退出。main 与 renderer 乐观停止共用纯取消结算，结束时间幂等，已完成及真实失败不被取消覆盖。未执行工具 skipped，运行中中止工具及工作块 cancelled；后台 Task 保留自身生命周期。
- 待审计划取消使用 cancelled，无伪造 reject decision；修改意见继续通过 reject + feedback 恢复同一冻结请求。通用结果回执不得将明确已取消的交互改回 error/running。
- PlanReviewState 的 ownerTurnId 在新写入时必需；未证明归属的已有记录只读不推断。不同 owning Turn 开启新周期；取消/决定按 ownerTurnId、planId、revision 核对。无新 IPC、模式开关或批量历史迁移。
- 包含计划交互的 assistant result 永不渲染 handoff 建议；共享判定用于主进程及 renderer，不按 Agent 名称新增显示特判。审批区是唯一计划执行入口。
- 新请求的 user/assistant 共用 owning request/turn，按真实消息顺序投影；审批反馈不是新 user 消息。Bridge 外部调用与真实 Composer 驾驶证据须分别记录，不能通过伪用户消息修饰历史。


### 图片工具展示投影

同段相邻成功read_image可在renderer形成只读展示组；原ConversationToolCall身份、顺序、回执与终态不改变，不跨Turn/段落/子过程。imageCalls仅属renderer行模型，不落持久会话。imagePreviews由main在工具结果转存后保留并按既有session scope读取；renderer不扫描存储或重读源路径。预览响应按会话隔离，缺失/失败不同于加载中；展示数量不取决于缩略图是否成功加载。

### Tasks 依赖等待投影

ProgressTask 与 ConversationTaskSnapshotItem 可带只读 waitingOn（taskId、可选 title、reason: unfinished/unverified/missing）。五种 status 不因依赖变化改写；statusReason 只保留任务本身原因。主进程执行准入和等待信息共用同一证明判定。右栏读取任务与执行的一致快照，任务事件在当前事务中冻结同一信息；renderer 不重算依赖，历史快照不跟随最新状态。pending 等待使用灰色空心圆及“等待前置任务”提示，原因按需展开；真正 blocked 才使用黄色受阻标记。


### 自动审查与计划交接

Plan 批准的正常退出携带宿主 owning turn 的批准身份；主进程核对冻结制品、当前计划与 execution offer，普通缺失 final_answer 仍失败。批准确认到交接共用来源计划身份，迟到成功、Stop、会话切换与修订均不能重新发送；投递不确定只核查 requestId。准备时保留本次选择并标待确认，不能投影旧请求模型/参数。
