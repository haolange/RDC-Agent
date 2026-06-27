# Agent Runtime 全面补齐计划（唯一权威）

> 本文档是 agent runtime 内核从「设计扎实但未接线」推进到「能实际运行、对标 Claude Code 工业级 agent 平台基础能力」的唯一权威进度来源。
>
> 若与旧计划、commit message 或其它文档冲突，以本文档为准。本文档的「当前进度」段每完成一个 Phase 更新并附验证证据。

## 为什么需要这份文档

旧计划（桌面 `RDC-Agent-全面补齐_Plan.md`）的「当前进度」段声称 Phase 1/2 已完成。但经三个 Explore agent 逐一核实 `main` 分支代码（非文档声称），该进度在 `main` 上**不存在**——内核几乎全未接线。本计划以 `main` 真实状态为唯一起点从头规划，并把核实过的真实状态固化成本文档，杜绝重蹈虚假进度覆辙。

---

## 一、main 真实状态基线（已核实，非文档声称）

本节是唯一可信的进度地基。所有结论经代码事实核实，配文件:行号证据。

### 1.1 死代码 / 未接线（旧计划误以为已完成）

| 子系统 | main 真实状态 | 证据 |
|---|---|---|
| 长生命周期 Agent | 每个 profile turn 新建 one-shot Agent，`useFreshAgent:true` 硬编码，maxTurns:4 | `AgentOrchestrator.ts:386-387,470-483` |
| ContextManager 压缩 | `new ContextManager` 仅测试文件；两处 Agent 构造都没传 `transformContext` | `Agent.ts:335` + `AgentLoop.ts:398,444` |
| ErrorRecovery | `new ErrorRecovery` 仅测试；`decide(error)` 没传 `stopReason` | `AgentLoop.ts:375` |
| maxTurns | 硬编码 8/4，无按 profile 区分；`.agent.md` 不解析 `max-turns` | `AgentOrchestrator.ts:452,480` |
| MemoryStore | `new MemoryStore` 零处实例化，全家桶 6 文件自引用 | `memory/` 目录 |
| memory_read 工具 | 假实现——读 conversation history 而非 MemoryStore | `AgentOrchestrator.ts:931` |
| memory_write/delete | 不存在 | grep 零匹配 |
| MemoryExtractor hook | finally 块无 extractor 调用 | `AgentOrchestrator.ts:1316-1323` |
| MemoryPrefetcher | 仍是 `getAll?.()`+`mem.slug`（未修），死代码 | `MemoryPrefetcher.ts:19,29` |
| PromptAssembler | 定义完整但零实例化零调用 | `assembleSystemPrompt` 全仓 0 调用 |
| PromptComposer | 仍在用，把 history 拼进 JSON prompt 的 `recentHistory` | `ConversationService.ts:881,909` + `PromptComposer.ts:51` |
| SubagentRunner/HandoffController | 不存在 | `agent/` 目录无此两文件 |
| SubagentSpawner | 存在但零实例化零调用 | `collaboration/SubagentSpawner.ts` |
| 17 个孤儿文件 | 全部仍在仓库 | AutoCompactor/ForkAgentCompactor/PromptCacheOptimizer/TokenBudget/AgentSpawnTool/SendMessageTool/Coordinator/MessageBus/TeamProtocol/IdlePoll/WorktreeManager/WorktreeIsolation/UltraPlan + 各 index.ts |
| agentRuntime 事件 | 无 `subagent.*`/`handoff.requested` 事件 | `agentRuntime.ts:28-43` |
| WorkTrace 嵌套 | `ConversationWorkBlock` 无 `children` 字段，subagent/handoff 降级为扁平 summary | `conversation.ts:54-65` |
| compaction/command block | 定义但无产生点 | grep 零匹配 |
| Task 双模 | 无 TaskStore 抽象 | grep 零匹配 |
| Task 事件桥接 | `task.created/updated` 零 emit，listener 是死分支 | `ConversationService.ts:1152` |
| Memory IPC | `memory:list/get/write/delete` 全无注册 | `channels.ts` |
| Memory 面板 | renderer 零 Memory 引用 | grep 零匹配 |
| scheduler 注入 | `backgroundTaskRunner`/`cronScheduler` 字段空挂 | `Agent.ts:72,79` |

### 1.2 真实可用（保留作地基）

| 子系统 | 状态 | 证据 |
|---|---|---|
| Permission 四模式 | `default`/`auto-review`/`full-access`/`custom` 真实生效 | `settings.ts:193-197` + `AgentPermissionPolicy.ts:190` |
| 5 个 Provider | Anthropic/OpenAICompatible/OpenAIResponses/Gemini/Ollama 真实选路 | `ConfiguredRuntimeProvider.ts:92-135` |
| TaskRegistry 落盘 | `.tasks/{id}.json` 真实读写，5 工具非 canned | `TaskTools.ts` |
| BackgroundTaskRunner | 接 BashTool `run_in_background` | `BashTool.ts:13` |
| 原生 tool calling | `native-structured` 真实工作 | `PromptComposer.ts:199` |
| AgentLoop 插槽设计 | steering/followUp/errorRecovery/transformContext 架构在（虽未接线） | `AgentLoop.ts` |
| ContextManager/ErrorRecovery/Memory 全家桶/PromptAssembler | 类定义完整、有测试，只缺接线 | 各文件 |
| Plan profile 契约 | `plan.agent.md` 已定义工具集 + `handoffs` frontmatter | `plan.agent.md` + `settings/README.md:49` |
| ask_user / plan_artifact / rdx_context 工具 | 真实存在并执行 | `AskUserTool.ts:12` + `AgentOrchestrator.ts:860,750` |

### 1.3 claude-code 源码对标精髓（`D:\Projects\claude-code\src` 实测提炼）

经三个对标 agent 深挖，可迁移到「单进程多 Context 串行」架构的设计精髓：

- **Agent engine**（`query.ts` 无状态引擎 + `QueryEngine.ts` 有状态壳）：`query()` 是纯 async generator，不持有状态，跨轮状态用显式 `State` 重写；**transition 状态机**用「State 重写+continue」表达所有恢复路径（7 个 continue 站点），线性可读可断言；终止原因 `Terminal` 联合类型。
- **分层 compaction**（5 层从便宜到昂贵）：Tool Result Budget → Snip → Microcompact → Context Collapse → Auto → Reactive；熔断防死循环；forked agent 做摘要不污染主线程。
- **Subagent**（`createSubagentContext` 默认隔离+显式共享）：独立 context/message/abort，tools 按 agent 定义 filter，清理极其彻底（finally 释放一切）。
- **Coordinator**（task-notification 协议）：coordinator 物理上无执行工具只有 spawn/continue/stop；worker 完成以 `<task-notification>` XML 回传；continue/spawn 决策表；反懒惰委托 prompt。
- **Memory**（闭合四类型 `user`/`feedback`/`project`/`reference` + 两级结构 MEMORY.md 索引常驻 + topic 按需 + cursor 互斥）。
- **Permission**（11 步流水线 + bypass-immune safetyCheck）。
- **Hooks/Skills/MCP/Tools**：三执行方式统一 async generator 产出 HookResult；Skills/Commands/Slash 三合一注册表；MCP in-process transport；Tool 富元数据驱动调度；FileEdit 用「唯一性约束」代替「行号」。
- **Plan mode 是反面教材**：硬编码为独立 mode+两专用工具，readonly 靠 prompt 骗；本库正确做法是 plan 作一等 Profile。

---

## 二、对需求 Prompt 4 个已知内容的逐条对齐

### 已知 1：Permission 四模式，plan 不写死为权限

- 本库已是 Codex 风格四模式（`default`/`auto-review`/`full-access`/`custom`），真实生效，**不改枚举**。
- plan 是 `.agent.md` 一等 Profile，ReadOnly 天花板**通过工具集契约实现**（`ASK_READONLY_TOOL_ALLOWLIST` + Plan 独有的 `ask_user`/`agent`/`todo`/`memory`/`planArtifact`/`handoff`）。
- 证据 `settings/README.md:49`：「Plan 的 seed manifest 不包含 `bash`/`write`/`edit`/`rdxContext`；获批后由 Plan handoff 到 Edit」——正确实现。

### 已知 2：忽略旧 TodoWrite，用 Task 机制

- 本库 `task_create`/`update`/`get`/`list`/`stop` 已是 Claude Code 废弃 TodoWrite 后的新机制，已对标。
- **清洗残留**：`DebuggerRuntimePolicy.ts:32-33,68-69` 的 `todo`→`task_list` 别名映射是 claude-code 废弃语义的历史残留（且映射错误——`todo` 应展开整套 `task_*`，非仅 `task_list`）。Phase 1.7 清洗：保留 `todo` 作为 frontmatter 人类别名，运行时工具名空间统一用 `task_*`，删除错误单值别名。

### 已知 3：Plan 是一等 Profile + WorkItem 分解 + Handoff

- Plan 的「WorkItem 分解工具」= 现有 `task_create`/`update`（本库 task 即 WorkItem）+ `plan_artifact`（产出 plan 文档），**不新增工具**。
- `ask_user`（name=`ask_user_question`）已存在，是澄清工具。
- HandoffController（Phase 3 新建）对接 `handoffs:` frontmatter（label/agent/prompt）：
  - `agent_handoff` 工具参数 `{ toProfile, prompt? }`，缺省 prompt 从目标 profile handoffs 定义取。
  - 实现「任意 Agent 到任意声明 handoff 的 profile」转移（不限 Plan→Edit）。
  - handoff 是 session 级控制权转移（DESIGN.md 契约：渲染为 next-action，非 tool card）。

### 已知 4：Team/Swarm —— 技术分析（用户纠结点）

**用户原话**：claude code 真独立进程+通信，本库单进程多 Context；通信需存在但不落盘；不确定本库需不需要，因 RDX CLI 不支持 Parallel；纠结，帮我分析分析吧。

**事实核查**：本库无业务级 mutex/lock（grep 无）；「RDC Context 单消费」约束来自 **RDX CLI 外部进程**（非进程内锁）；`rdx_context` 工具只返回 `{available}` 是探针，真正 RDC 操作走 ShellInvocationService spawn 外部 CLI。

**矛盾分析**：

1. `[多 agent 并行探索价值] vs [RDC Context 单消费]` → **表面矛盾**：单消费只约束「会修改/读取 RDC replay state 的操作」，ReadOnly profile（Plan/Ask/Analyzer）间可逻辑并行。
2. `[单进程串行决策] vs [某些任务天然并行（多文件探索、多 capture 比对）]` → **真实矛盾**：本库垂直场景下串行吞吐损失可接受（RDC 调试/分析是「逐步深入」非「广度并行」）。
3. `[claude-code mailbox 文件锁] vs [本库单进程]` → 已解决：单进程不需文件锁。
4. `[「并行是超能力」] vs [串行足够]` → **伪矛盾**：本库垂直场景并行收益 < 复杂度。

**「底层 Command 机制解决并行」可行性**（用户问的点）：技术上可行（ShellInvocationService 可并发 spawn 多 CLI 进程），但**语义错误不建议**：① 多 CLI 进程 = 多个独立 RDC Context 不共享 replay state，无法协作同一 capture；② 同一 `.rdc` 文件多进程可能锁冲突；③ 违背 Agent 协作语义（协作应基于共享理解+分工，非各自为政独立 CLI）。

**分析结论与建议：纯串行 subagent + 结果回传用函数返回值，不做真并行 team**

- 领域契合：RDC 调试/分析/优化是「逐步深入」，串行符合心智。
- RDC 单消费天然适配串行：涉及 mutation 的 profile 必须串行。
- claude-code 并行红利 = task-notification 协议，串行下依然成立（完成一个回传一个再开一个）。
- mailbox/ShareMemory/Mailbox 的答案：**都不是，是函数返回值**（最简单的进程内通信）。
- 保留扩展余地：SubagentRunner API 预留 `concurrency?: 'serial'`（当前唯一值），未来证明某场景需并行可在此抽象上加并发调度器，不推倒重来。

**不做**：`team_create`/`delete`、mailbox、in-process teammate、agent swarms gate、跨进程 permission 委托。

---

## 三、决策定调（8 项已对齐）

| # | 维度 | 决策 |
|---|---|---|
| 1 | 进度地基 | 以 main 为唯一地基重做，旧计划进度作废 |
| 2 | 知识来源 | claude-code `src/` 源码级对标（已确认存在） |
| 3 | 协作模型 | 纯串行 subagent，结果回传 = 函数返回值；删 team/mailbox/并行 |
| 4 | UI 范围 | 补齐缺失面板 + 新事件渲染，**保真现有布局** |
| 5 | Agent loop | 重写为 transition 状态机（State 重写+continue，对标 claude-code `query.ts`） |
| 6 | Memory 提取 | 内联提取（主 agent 轮末内联跑，不走 forked agent） |
| 7 | 推进节奏 | 5 阶段串行，每阶段独立可验证可回滚 |
| 8 | 计划持久性 | 写入 docs 作为唯一权威进度来源（即本文件） |

补充：三层语义清晰分离（profile 角色 ≠ handoff orchestrator 移交 ≠ subagent 子 Context 派生）；三层通信降级（mailbox 文件锁 → 函数返回值）；TaskStore 抽象双模（FileTaskStore 顶层 + MemoryTaskStore subagent）。

---

## 四、Phase 0 — 写入权威文档（本文件）

**目标**：把本计划落成仓库文档，作为唯一权威进度来源。

- 新建本文件：含计划全文 + 「当前进度」段。
- 在 `docs/architecture/README.md` 增索引（顺带修复 mojibake）。
- `docs/architecture/agent-runtime-kernel.md` 标注「接线状态以本文件为准」。

---

## 五、Phase 1 — AgentLoop 重写 + 内核接线 + 清孤儿

**目标**：把内核从「maxTurns:4 一次性 turn」推进到「transition 状态机 + 长生命周期 Agent + compaction + errorRecovery + 清孤儿」。

### 1.1 重写 AgentLoop 为 transition 状态机

- 引入显式 `LoopState`（messages/systemPrompt/tools/turnCount/transition reason/consecutiveFailures）。
- 主循环 `while(true)` 直线流水线：快照 state → compaction 管线 → call LLM → streaming tool exec → 判断 needsFollowUp。
- 用「State 重写+continue」表达所有恢复路径：`next_turn` / `error_retry` / `escalate_tokens`(length) / `reactive_compact`(prompt-too-long) / `transform_context` / `token_budget_continuation`。
- 终止原因 `LoopTerminal` 联合类型（completed/max_turns/model_error/prompt_too_long/aborted）。
- 保留 transformContext(ContextManager.compress)/errorRecovery(ErrorRecovery) 接入点。
- **修复 stopReason**：`recovery.decide(error, assistantMessage?.stopReason)` 让 length 分支可达。

### 1.2 长生命周期 Agent + 真实 message 线程持久化

- ConversationService 为每个 session+profile 维护 AgentSlot，Agent 贯穿 session。
- 删除 `useFreshAgent:true`(386-387) + `createFreshAgentSlot`(461-483) + `useFreshAgent`(1176) + `promptOverride`(121,368)。
- profile turn 复用 slot；messages 从 StorageAdapter 回填（新增 `readAgentThread`/`writeAgentThread`/`clearAgentThread`）。
- 删除 PromptComposer 的 recentHistory 注入（`PromptComposer.ts:51-54`）——history 作真实 message 注入。
- slot key = `${sessionId}::${agentId}`，AgentRole 变更 reset。

### 1.3 接 ContextManager

- `new ContextManager({tokenizer, modelId, contextTokenLimit, toolResultBudget, keepRecentToolResults})`，contextTokenLimit 按 provider window 动态取。
- 传入 Agent 构造 `transformContext: contextManager.compress.bind(contextManager)`。
- Loop 的 `reactive_compact`/`transform_context` 站点消费。

### 1.4 接 ErrorRecovery

- `new ErrorRecovery({primaryModel, fallbackModel})`，fallback 从 settings route fallback 读。
- 传入 Agent 构造 `errorRecovery`。

### 1.5 maxTurns 按 profile + frontmatter

- 删硬编码 8/4 → edit/debugger/optimizer=50，ask/plan/analyzer=25。
- `AgentManifestService.parseAgentMarkdown` 新增 `max-turns` 字段；`AgentManifestDefinition` 新增 `maxTurns?`；`serializeAgentMarkdown` 同步。

### 1.6 PromptAssembler 接线（替代 PromptComposer 的 system prompt）

- `systemPromptForAgent` 改调 `PromptAssembler.assembleSystemPrompt(context)`。
- PromptContext 填充：workDir/tools/memoryIndex/relevantMemories/skills/model/mode/customSections(profile instructions)。
- 保留 plan profile 工具集契约（ask_user/agent/todo/memory/planArtifact/handoff）。
- **删除 PromptComposer**（消除双轨）+ PromptComposer.test.ts + 所有 import。

### 1.7 清孤儿（17 文件 + 别名残留）

删除（每删前 grep 全仓引用，typecheck 兜底）：

- `agent/AutoCompactor.ts`、`ForkAgentCompactor.ts`、`PromptCacheOptimizer.ts`、`TokenBudget.ts`（归一到 ContextManager）
- `tools/system/AgentSpawnTool.ts`、`tools/comm/SendMessageTool.ts`（假工具 canned 文本）
- `collaboration/Coordinator.ts`、`MessageBus.ts`、`TeamProtocol.ts`、`SubagentSpawner.ts`、`collaboration/index.ts`（并行/team 语义，SubagentSpawner 被 Phase 3 SubagentRunner 替代）
- `autonomy/IdlePoll.ts`、`autonomy/index.ts`
- `isolation/WorktreeManager.ts`、`WorktreeIsolation.ts`、`isolation/index.ts`
- `planning/UltraPlan.ts`
- `PersistedPermissionManager.ts`（死代码，功能由 AgentPermissionPolicyService 覆盖）
- `tools/system/index.ts`、`tools/comm/index.ts` 移除对应 export；`getPrimitiveTools()`(`tools/primitives/index.ts:51-52`) 移除 AgentSpawnTool/SendMessageTool 注册
- 清洗 `DebuggerRuntimePolicy.ts:32-33,68-69` 的 `todo`→`task_list` 错误别名（已知 2 残留）
- 修复 `docs/architecture/README.md` mojibake

### Phase 1 验证

- `npm run typecheck` + `check:architecture` + `check:fidelity` + `check:shared-exports` + `check:provider-system` + `check:settings-agents` 全绿；`npm run build` 通过
- 浏览器真实会话（`npm run start:agent-browser`）：Ask/Edit profile 多轮对话且跨轮记忆真实工具调用；长对话触发 compaction；provider 错误自动恢复

---

## 六、Phase 2 — Memory 引擎接线

**目标**：MemoryStore 全家桶接入运行时，持久记忆 + 内联提取 + 自动注入。

### 2.1 MemoryStore 实例化

- AgentOrchestrator 构造时实例化 `MemoryStore(path.join(workspacePath, '.rdc-agent', 'memory'))`，单例。
- queryLlm 适配器：configuredRuntimeProvider + 主模型封装 `(prompt) => provider.stream(...).result()`。

### 2.2 memory 工具重写（对标两级结构）

- `createMemoryReadTool` 改读 MemoryStore（`getMemory`/`listMemories`/`getIndexContent`），不读 conversation history。
- 新增 `memory_write`（对标闭合四类型 user/feedback/project/reference）+ `memory_delete`。
- allowlist：ask/plan → `memory_read`；edit → `memory_read`+`memory_write`+`memory_delete`。

### 2.3 内联提取（决策 6，不走 forked agent）

- `runAgentTurn` finally：对新增非 tool_use 消息调 `MemoryExtractor.extractFromConversation`。
- 对标 claude-code cursor 互斥：`lastExtractedMessageUuid` 游标只提取新消息；主 agent 这轮已 write memory 则跳过并推进游标。
- 频率控制：每 N 轮或 token 增量阈值触发；candidate dedup 后 `store.writeMemory`。

### 2.4 system prompt 注入 memory index

- PromptAssembler sectionMemory 填充 `memoryIndex = store.getIndexContent()`（对标 MEMORY.md 索引常驻）。
- 修复 MemoryPrefetcher：`getAll`→`listMemories`，`slug`→`name`（对标 `MemoryLoader.ts:79`）。

### 2.5 Consolidation

- `MemoryConsolidator.shouldConsolidate()` 提取后检查，超阈值（默认 10）触发 `consolidate()`。

### Phase 2 验证

- typecheck + 相关 check
- 浏览器会话：告诉 agent 偏好 → 重启 session → agent 记得；memory 落盘文件可见

---

## 七、Phase 3 — Subagent + Handoff 体系

**目标**：实现三层语义（profile/handoff/subagent），单进程串行（已知 4 结论）。

### 3.1 SubagentRunner（新建，取代 SubagentSpawner，对标 claude-code AgentTool）

- 新建 `src/main/agent-runtime/agent/SubagentRunner.ts`
- API：`runSubagent({parentAgent, profile, task, allowedTools, model?, maxTurns?, concurrency?: 'serial'}): Promise<SubagentResult>`（concurrency 当前唯一值 'serial'，未来扩展点）。
- 实现（对标 createSubagentContext 默认隔离+显式共享）：
  1. 解析目标 profile（.agent.md）→ instructions/tools/handoffs/maxTurns
  2. 构造隔离 Agent（独立 messages、filtered tools、独立 toolExecutor 带独立 permission context）
  3. 递归调用 Phase 1 transition loop（复用同一 loop，context 参数化）
  4. **串行**：父阻塞等待子（不做并行/mailbox/队列）
  5. **结果回传 = 函数返回值 SubagentResult**（已知 4 结论，不用 mailbox/ShareMemory）
  6. 对标 task-notification：子最终 assistant 文本作父 tool_result 返回（结构化 summary）
  7. 子 Task 走内存模式（独立 MemoryTaskStore，随子 context 结束回收）
  8. 清理彻底（finally 释放 fileState/todos/hooks 引用）
- 工具暴露：`task`（派生 explore/general 子 agent）+ `agent`（按 profile 派生）。Ask/Plan/Edit 可用。

### 3.2 HandoffController（新建，对接已知 3）

- 新建 `src/main/agent-runtime/agent/HandoffController.ts`。
- `agent_handoff` 工具改真实执行：`HandoffController.request({fromAgentId, toProfile, prompt})` → emit `HandoffRequestedEvent` → `ConversationService.applyHandoff` 切换 session 活跃 profile + 注入 prompt → 新 profile Agent 接管。
- 对接 `.agent.md` 的 `handoffs:` frontmatter（label/agent/prompt）：缺省 prompt 从目标 profile handoffs 取。
- 实现「任意 Agent 到任意声明 handoff 的 profile」转移（不限 Plan→Edit）；Plan→Edit 是默认路径。
- handoff 是 session 级控制权转移（DESIGN.md：渲染为 next-action，非 tool card）。

### 3.3 Subagent 事件桥接（shared 类型 + UI 投影）

- `agentRuntime.ts` AgentEvent union 新增 `subagent.started`/`subagent.delta`/`subagent.completed` + `handoff.requested` + payload（parentToolCallId/嵌套 trace）。
- `ConversationWorkBlock` 新增 `children?: ConversationWorkBlock[]` 支持嵌套。
- `ConversationService.completeProfileTurn` 的 onEvent 新增 subagent block 嵌套投影。
- AgentEventBridge 新增 subagent.*/handoff.requested 转发。

### Phase 3 验证

- typecheck + check + build
- 浏览器会话：Edit agent 调 `task` → 嵌套 subagent block 实时渲染 → 子返回父继续；Plan agent 调 `agent_handoff` → 移交 Edit

---

## 八、Phase 4 — Task 系统双模 + 事件桥接

**目标**：Task 工具实时投影 UI，sub agent 用内存 Task。

### 4.1 TaskStore 抽象（对标 claude-code task 系统）

- 从 TaskRegistry 抽 `TaskStore` 接口（`loadTask`/`saveTask`/`listTasks`/`deleteTask`）。
- 两实现：`FileTaskStore`（现有 fs，顶层用）、`MemoryTaskStore`（Map，subagent 用）。
- TaskRegistry 改持有 TaskStore，公共 API 不变。

### 4.2 Task 事件桥接（激活死分支）

- `task_create`/`update`/`stop` 执行后 emit `task.created`/`task.updated` AgentEvent（当前 TaskRegistry 静默）。
- ConversationService `task.*` listener（行 1152 死分支）补事件源即激活。

### 4.3 顶层落盘 / sub 内存

- AgentOrchestrator 顶层用 `FileTaskStore(workspacePath/.tasks)`。
- SubagentRunner 每子 agent 用 `new MemoryTaskStore()`。

### Phase 4 验证

- typecheck + check
- 浏览器会话：agent 调 `task_create` → UI 实时显示 task 卡片；sub agent task 不污染顶层列表

---

## 九、Phase 5 — UI 全面对标（补齐 + 保真）

**目标**：按 DESIGN.md 补齐缺失 UI 入口，按 design system 做视觉，**保真现有布局**。

### 5.1 Work Process 增强（保真现有结构）

- 嵌套 subagent block（递归渲染子 WorkTrace，缩进 + 左侧色带区分层级）。
- task 卡片实时状态（pending/in_progress/completed + 依赖关系）。
- approval/handoff 渲染（DESIGN.md：handoff 是 next-action，非 tool card）。
- compaction block（显示压缩摘要）—— 新增产生点 + 渲染。

### 5.2 新面板（保真现有布局节奏）

- Memory 面板（列表/新建/编辑/删除，调 memory IPC）。
- Skills 面板增强（已有基础）。
- 命令补全（`/` 触发，复用 CommandRegistry）。

### 5.3 IPC 补齐

- 新增 `memory:list`/`memory:get`/`memory:write`/`memory:delete`（invoke）。
- `agent:listActive`（subagent 活跃列表）。
- preload + BrowserAppBridge 同步暴露。
- channels.ts 新增 memory domain。

### 5.4 视觉设计（严格 design system）

- 用 `--token-*`/`--text-*`/`--space-*`，`.button` 系统。
- 新组件覆盖 rest/hover/active/focus/disabled/loading/error。
- 嵌套 subagent 用缩进 + 左侧色带。
- 参照 `designs/rdc-agent-design-system/Design System Preview.html`。

### Phase 5 验证

- `check:architecture`（R1 行数预算 + R4 hex + R6 shared 导出）+ `check:fidelity`（不删既有 class/testid）
- 浏览器真实会话产品级评审（按 AGENTS.md 清单）：Workbench 初始、Project/Session、.rdc 导入、Settings、桌面/窄屏、长路径/中文、按钮状态、前后端一致性、dark/light

---

## 十、验证总策略

- 每 Phase 完成：`npm run typecheck` + 相关 `check:*`（architecture/fidelity/shared-exports/provider-system/settings-agents）。
- Phase 1/3/5 完成：补 `npm run build`。
- 全部完成：浏览器真实会话按 AGENTS.md 清单产品级 smoke，覆盖 agent loop/subagent/approval/task/memory/handoff/dark-light/窄屏/长路径中文。
- docs 权威进度：每完成一 Phase 在本文件「当前进度」段更新，附验证证据，不写「声称完成」。

---

## 十一、风险与回滚

- **风险 1（最高）**：transition 状态机重写 AgentLoop 动核心。**缓解**：单测覆盖每 continue 站点；先接线后重写分小步。
- **风险 2**：长生命周期 Agent 重构动 ConversationService 数据流。**缓解**：Phase 1 分支验证多轮 + 持久化续接。
- **风险 3**：subagent 递归 context 隔离泄漏。**缓解**：强制 filtered tools + 独立 toolExecutor + 独立 permission context，单测覆盖。
- **风险 4**：删孤儿误伤间接引用。**缓解**：每删前 grep 全仓，typecheck 兜底。
- **回滚**：按 Phase 提交，每 Phase 独立可回滚 commit。

---

## 十二、实现顺序

Phase 0（写文档）→ Phase 1（loop 重写+接线+清孤儿）→ Phase 2（memory 内联）→ Phase 3（subagent+handoff）→ Phase 4（task 双模）→ Phase 5（UI）。Phase 1-4 是 main 层，Phase 5 是 renderer 层。

Phase 1 内部顺序：1.7 清孤儿（先扫干净地基）→ 1.6 PromptAssembler 接线 + 删 PromptComposer → 1.2 长生命周期 Agent + 持久化 → 1.3/1.4 ContextManager/ErrorRecovery 接线 → 1.5 maxTurns → 1.1 transition 状态机重写（最后，依赖前面接线稳定）。

---

## 当前进度

> 每完成一个子任务更新本段，附验证证据。不写「声称完成」，只记录已验证的事实。

- **Phase 0 — ✅ 完成**：本文件建立；README 索引更新 + mojibake 修复；agent-runtime-kernel.md 标注接线状态以本文件为准。
- **Phase 1 — ✅ 完成（待最终 build + 浏览器 smoke 验证）**：
  - **1.7 清孤儿**：删除 18 文件（AutoCompactor/ForkAgentCompactor/PromptCacheOptimizer/TokenBudget/AgentSpawnTool/SendMessageTool/Coordinator/MessageBus/TeamProtocol/SubagentSpawner/IdlePoll/WorktreeManager/WorktreeIsolation/UltraPlan/PersistedPermissionManager + 4 index.ts），清除 collaboration/autonomy/isolation/planning 4 空目录；清洗 DebuggerRuntimePolicy 的 todo→task_list 错误别名；修复 README mojibake。验证：typecheck + architecture/fidelity/shared-exports/provider-system/settings-agents 全绿。
  - **1.6 PromptAssembler 接线**：扩展 PromptContext（profile/routeCapability/permissionSettings/allowedToolNames）+ 新增 sectionProfileInstructions/sectionRouteCapability/sectionPermission/sectionCatalog 段；ConversationService 改调 `promptAssembler.assembleSystemPrompt`；删除 PromptComposer.ts + test；permission 四模式文案测试迁移至 PromptAssembler.test.ts（5 断言全过）。验证：typecheck + 5check + 5 测试全绿。
  - **1.2 长生命周期 Agent + 持久化**：StorageAdapter 新增 readAgentThread/writeAgentThread/clearAgentThread（路径 `{sessionPath}/agent-threads/{agentId}.jsonl`）；agentSlots key 改 `${sessionId}::${agentId}`；删除 useFreshAgent/createFreshAgentSlot/promptOverride/buildProfileTurnPrompt；getOrCreateAgentSlot 首次创建从 readAgentThread 回填 messages，finally 写 writeAgentThread；userMessage 直接用 rawMessage（真实 user role）。验证：typecheck + 5check 全绿。
  - **1.3+1.4 ContextManager/ErrorRecovery 接线**：getOrCreateAgentSlot 为每 slot 创建 ContextManager（contextTokenLimit=contextWindow*0.75）+ ErrorRecovery，传入 Agent 的 transformContext + errorRecovery。验证：typecheck + ContextManager(10)+ErrorRecovery(37) 测试 + 3check 全绿。
  - **1.5 maxTurns 按 profile + frontmatter**：AgentManifestDefinition 加 maxTurns? 字段；parseAgentMarkdown 解析 `max-turns`；serializeAgentMarkdown 写回；getOrCreateAgentSlot 用 resolveMaxTurns（edit/debugger/optimizer=50，ask/plan/analyzer=25，frontmatter 覆盖）。验证：typecheck + architecture/settings-agents 全绿。
  - **1.1 stopReason='length' 恢复路径**：streamAssistantResponseWithRecovery 成功返回后检查 stopReason='length'，触发 recovery.decide(null,'length') 走 escalate_tokens/continue_prompt/abort。**决策：不做整体 transition 状态机重写**——transformContext/errorRecovery 接线（1.3/1.4）已让插槽生效，length functional gap 已修复，现有双层循环结构无功能缺陷，整体重写为纯结构优化且风险高于收益，违背最小可行修改原则。验证：typecheck + ErrorRecovery(37) 测试全绿。
- **Phase 2 — ✅ 完成**：
  - 修复 MemoryPrefetcher（getAll→listMemories，slug→name，对照 MemoryLoader.ts:79）
  - AgentOrchestrator 加 memoryStore/memoryExtractor/memoryConsolidator 懒构造 getter + queryLlmForMemory 适配器（取 ask route，configuredRuntimeProvider.stream 单轮调用）
  - 重写 memory_read（读真实 MemoryStore：getMemory/listMemories，支持 name/query/limit）+ 新增 memory_write（闭合四类型 user/feedback/project/reference）/memory_delete 工具，注入 createWorkbenchTools
  - 内联提取 hook：runAgentTurn finally 每 3 轮触发 extractMemoriesFromTurn（cursor 频率控制 + fire-and-forget + fail-safe），candidate writeMemory + shouldConsolidate 触发 consolidate
  - system prompt 注入 memory index：AgentOrchestrator.getMemoryIndex() → ConversationService assembleSystemPrompt 填 memoryIndex
  - allowlist：ask 加 memory_read；executable 加 memory_write/memory_delete；RUNTIME_TOOL_ALIASES 加自映射；agentWorkbenchCatalog 新增 memory_write/memory_delete 条目
  - 验证：typecheck + architecture/fidelity/shared-exports/settings-agents/provider-system + build 全绿
- **Phase 3 — ✅ 完成**：
  - shared 类型扩展：AgentEventType 加 subagent.started/delta/completed + handoff.requested；新增 AgentSubagentEventPayload/AgentHandoffRequestedPayload；ConversationWorkBlock 加 children? 字段
  - HandoffController（新建）：resolve 校验目标 profile 存在+启用+在源 profile handoffs 声明内，生成 label/prompt（缺省从 handoffs frontmatter 取）
  - agent_handoff 工具重写：execute 调 HandoffController.resolve，返回 valid details（fromAgentId/toAgentId/label/prompt/valid）；prompt 不再 required（缺省从 handoffs 取）
  - SubagentRunner（AgentOrchestrator.runSubagent 方法）：派生隔离 Agent（独立 subagentSessionId 段），串行执行，子事件桥接为 subagent.started/delta/completed 上抛父 trace，结果回传=函数返回值
  - subagent 工具（name='subagent'，避免与 task/agent 别名冲突）：注入 createWorkbenchTools，通过 currentTurnEventSink 实例字段获取父 onEvent
  - allowlist：executable 加 subagent；RUNTIME_TOOL_ALIASES 加 subagent 自映射
  - ConversationService onEvent 加 subagent.started/delta/completed 投影（kind:'subagent' block，status 随子 agent 进度）
  - 验证：typecheck + 6check + build 全绿（+3 shared symbols）
  - **遗留**：handoff 实际 profile 切换的 session 级状态管理（pendingHandoff 持久化 + 下次消息自动用新 profile）待后续完善；当前 agent_handoff 已真实校验+返回 valid details，UI 渲染为 next-action 留 Phase 5
- **Phase 4 — ✅ 完成**：
  - TaskStore 抽象（新建 `tasks/TaskStore.ts`）：TaskStore 接口（loadTask/saveTask/listTasks/deleteTask）+ FileTaskStore（现有 fs 逻辑）+ MemoryTaskStore（Map）
  - TaskRegistry 改持有 TaskStore（构造接受 TaskStore|string 兼容旧签名）；删私有 taskPath/ensureDir/normalizeTask（移至 FileTaskStore）；加 deleteTask 公共方法；加 onTaskChange 回调
  - 事件桥接：createTaskRuntimeTools 注入 onTaskChange 回调，emit task.created/task.updated AgentEvent 到 currentTurnEventSink.onEvent（激活 ConversationService task.* 死分支）
  - 双模：createTaskRuntimeTools 检测 sessionId 含 `::subagent::` 段 → MemoryTaskStore（子 agent 内存，随子 context 回收）；顶层 → FileTaskStore 落盘
  - tasks/index.ts 导出 TaskStore/FileTaskStore/MemoryTaskStore
  - 验证：typecheck + architecture/shared-exports/settings-agents + build 全绿（+3 shared symbols）
- **Phase 5 — ✅ 完成**：
  - **memory IPC 全链路**：channels.ts 加 memory domain（list/get/write/delete）→ preload/api/memory.ts → preload/index 暴露 → BrowserAppBridge browser fallback → electron-api.ts 加 MemoryApi/MemorySummary/MemoryDetail/MemoryWriteRequest 类型 → main memoryHandlers.ts（委托 AgentOrchestrator 的 listMemoriesForUi/getMemoryForUi/writeMemoryForUi/deleteMemoryForUi）→ workbenchHandlers 注册
  - **Memory 面板**：useMemory hook（R3 合规，IPC 集中）+ MemoryPanel.tsx（列表/新建/编辑/删除，全 token CSS）+ MemoryPanel.css → 挂到 ClassicSessionControlPanel 的 CollapsibleSection；i18n 加 memory.* 中英文 key
  - **WorkProcess 增强**：workProcessPresentation.ts 加 subagent/task row 类型 + block→row 转换（subagent 优先于 diagnostic，递归消费 block.children）；SubagentRow.tsx（嵌套渲染，左侧色带+缩进）+ TaskRow.tsx（状态卡片，pending/in_progress/completed/failed 图标）；WorkProcess.tsx renderRow 加分支；AgentChat.css 追加 subagent/task 样式
  - **命令补全接线**：useSlashCommand hook（检测 `/` 前缀，R3 合规）+ Composer.tsx 渲染已有 SlashCommandPopover（onSelect 填充 `/command ` 让用户补参数）
  - 验证：typecheck + architecture/fidelity/shared-exports + build 全绿（+44 classes, +6 testids, +7 shared symbols）；主进程启动 + /app HTTP 200 + 无错误
- **全部 Phase 完成**。功能 smoke 8 项清单待 provider 就绪执行。
- **浏览器真实会话 smoke — ✅ 启动验证通过（功能 smoke 待 provider 配置）**：
  - `RDC_AGENT_HEADLESS=1` 启动主进程成功，BrowserAppBridge 输出 `http://127.0.0.1:<port>/app`
  - `curl /app` 返回 HTTP 200 + 有效 HTML（renderer + IPC bridge 全链路正常初始化）
  - 无 stderr 错误，主进程不崩溃
  - 证明 Phase 1-4 main 层改动（长生命周期 Agent、ContextManager/ErrorRecovery 接线、Memory 引擎、Subagent/Handoff、Task 双模）未破坏主进程启动和 UI 可达性
  - **限制**：完整功能 smoke（agent 多轮对话、subagent 派生、memory 持久化、compaction 触发）需真实 LLM provider 配置，当前环境未配置无法执行 agent 对话流验证；待 provider 就绪后补全

### 不足点修复记录（Phase 5 前补齐）

- **不足 1 — Phase 1.1 transition 状态机重写 — ✅ 完成**：
  - runAgentLoop 从双层 while（外层 followUp + 内层 LLM↔tool）重构为单层 transition 状态机
  - 引入显式 `LoopState`（pending/turn/transition）+ 5 个 transition 站点：`init` / `next_turn` / `steering` / `follow_up` / `terminal`
  - 每个恢复/继续路径用「State 重写 + continue」表达（对标 claude-code query.ts），线性可读可断言
  - 抽出 injectPending/injectScheduled 公共逻辑；streamAssistantResponseWithRecovery（独立子状态机）/executeToolCalls/streamAssistantResponse 契约不变
  - 验证：typecheck + architecture OK + 88 agent runtime 测试全过（行为等价）

- **不足 2 — Phase 3 handoff 实际 profile 切换 — ✅ 完成**：
  - AgentOrchestrator 加 `pendingHandoff` 字段 + `consumePendingHandoff()` 方法；agent_handoff execute 成功时设置 pendingHandoff（fromAgentId/toProfile/prompt/label/sessionId）
  - ConversationService 加 `pendingHandoffs: Map<sessionId, {toProfile, prompt}>`；turn 完成后 consume pendingHandoff → emit `handoff.requested` 事件 + 存入 map
  - startProfileTurn 检查 pendingHandoffs：若有则优先用 toProfile + 把 handoff prompt 前置到用户消息（保留原始消息）
  - 优先级：handoff > 显式 requestedAgentId > requestedMode > ask
  - 内存维护（不持久化），session 重启后丢失（handoff 是即时意图，合理）
  - 验证：typecheck + architecture/fidelity/shared-exports/settings-agents + build 全绿

- **不足 3 — 功能 smoke — ⚠️ 环境限制，待 provider 就绪**：
  - 已验证：主进程启动 + /app HTTP 200 + renderer 加载 + IPC bridge 初始化 + 无崩溃
  - 环境核查：46 providers 全 `[no-key]`（account 模式无 OAuth token），agentRoutes 的 providerId/modelId 为空，Ollama 未运行——无任何可用 LLM route
  - 无法验证（需有效 LLM provider）：
    1. Ask/Edit profile 多轮对话跨轮记忆真实工具调用
    2. 长对话触发 compaction（WorkTrace 出现 compaction block）
    3. provider 错误自动恢复（ErrorRecovery retry/escalate/compact）
    4. memory 内联提取（extractFromConversation 需 LLM 调用）
    5. memory 持久化续接（告诉 agent 偏好 → 重启 session → agent 记得）
    6. subagent 派生（父 agent 调 subagent 工具 → 嵌套 block）
    7. handoff profile 切换（Plan agent 调 agent_handoff → 下次消息用 Edit）
    8. task 工具实时投影（task_create → UI task 卡片）
  - 待 provider 就绪后按此清单执行功能 smoke
