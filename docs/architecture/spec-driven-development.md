# Spec-Driven Agentic Coding 规范宪章

> 说明：本文档定义跨层行为规范与执行约束；仓库当前目录真相、运行期目录映射与 Git 产物边界以根目录 `README.md` 为准。

> 版本：1.0 | 适用范围：RDC-Agent 仓库全部 Coding Agent
> 本文档是所有开发决策的单一事实来源（Single Source of Truth）。任何与本文档冲突的实现，以本文档为准。

---

## 目录

1. [产品定位与设计哲学](#第1章产品定位与设计哲学)
2. [Spec-Driven 方法论](#第2章spec-driven-方法论)
3. [12阶段工作流规范](#第3章12阶段工作流规范)
4. [Context Engineering 规范](#第4章context-engineering-规范)
5. [Harness Engineering 规范](#第5章harness-engineering-规范)
6. [UIUX 体验规范](#第6章uiux-体验规范)
7. [Agent 角色与协作规范](#第7章agent-角色与协作规范)
8. [质量门禁与测试规范](#第8章质量门禁与测试规范)
9. [开发路线](#第9章开发路线)
- [附录 A：执行原则](#附录a执行原则)
- [附录 B：关键文件路径速查表](#附录b关键文件路径速查表)
- [附录 C：成功指标体系](#附录c成功指标体系)
- [附录 D：避坑指南](#附录d避坑指南)

---

## 第1章：产品定位与设计哲学

### 1.1 核心定位公式

```
外层 = Cowork Agent（自然协作体验，类似 Qoder Work / Claude Cowork）
内核 = Vertical Debug Execution Engine（12阶段强制流程）
```

- Chat 是壳，Workflow 是核，控制面板是辅助手段
- 用户始终和一个"持续在线、持续理解上下文"的 Agent 打交道
- 只有在用户明确发起调试任务时，内部才切入严格执行机制

### 1.2 三层架构

```
┌──────────────────────────────────────────────────────────┐
│  用户交互层（Chat / UI / Report）                         │  表面：自然流畅
│  ConversationService / renderer/components               │
├──────────────────────────────────────────────────────────┤
│  工作流编排层（deterministic DebuggerRuntime）               │  中间：规范化可控
│  DebuggerRuntime / DebugWorkflowService / HarnessController│
├──────────────────────────────────────────────────────────┤
│  工具执行层（Tools / MCP / CLI）                          │  底层：可靠可审计
│  ToolBridge / AgentToolPort / rdx.bat                   │
└──────────────────────────────────────────────────────────┘
```

### 1.3 与通用 Agent 的关键差异

| 维度 | 通用 Agent | RDC-Agent |
|------|-----------|-----------|
| 用户界面 | 纯 Chat | Chat + Workflow + Report |
| 执行控制 | LLM 自由决策 | DebuggerRuntime 强制路由 |
| 工具访问 | 全量开放 | 按角色绑定 |
| 可审计性 | 无 | 完整 ActionEvent 证据链 |
| 失败处理 | 重试或放弃 | Blocker 机制 + Backtrack |
| 多轮对话 | 单 Agent | 9角色协作，staged_handoff |

### 1.4 设计原则

**自主性与可控性的混合模式**

- 12阶段为主干（Workflow），每阶段内允许 Agent 自主操作（Agentic）
- LLM 只提供建议，DebuggerRuntime 决定路由
- `workflow/stage/blocker` 是 Agent 的内部操作系统，不是用户首先面对的产品本体
- Agent 可以先聊天、先理解、先澄清、先建议，只有条件满足时才触发执行流程

**ConversationService 中的意图识别**

```typescript
// src/main/conversation/ConversationService.ts
const EXECUTE_PATTERN = /开始|启动|执行|正式分析|直接分析|现在分析|run\b|start\b|debug\b|analy[sz]e\b|帮我调试|请调试|开始调试|开始分析/i;
```

只有当 `control.intent === 'execute'` 且 `control.safe_to_start === true` 时，才升级为 Workflow 执行模式。

---

## 第2章：Spec-Driven 方法论

### 2.1 三层规范定义

```
Business Spec（业务规范）
  ↓ 描述产品能做什么、用户期望什么
Technical Spec（技术规范）
  ↓ 描述系统如何实现、类型契约、接口定义
Execution Spec（执行规范）
  ↓ 描述每一步怎么做、阶段规范、测试标准
```

### 2.2 规范即真理原则

- 规范定义行为，代码实现它；代码不符合规范，改代码
- 新增功能必须先更新规范，再写实现
- `src/shared/` 中的类型定义是技术规范的第一层；本文档是更上层的 Business + Execution Spec
- 任何跨层修改（IPC / 共享类型 / UI）必须一次内联完成，不留契约漂移

### 2.3 规范的生命周期

```
提案（PR 描述）→ 规范更新（本文档）→ 类型更新（shared/types）→ 实现→ 测试验证→ 合并
```

任何实现若无对应规范章节，视为技术债，须补规范或撤销实现。

### 2.4 阶段规范示例模板（以 `dispatch` 阶段为例）

```
阶段名称：dispatch（Specialist 分派）
阶段 ID：dispatch
WorkflowPhase：generator

入口条件（Precondition）：
  - approvalState === 'approved'
  - debugPlan.strictReady === true
  - debugPlan.recommendedSpecialists.length > 0
  - 无未解决 Blocker

出口条件（Postcondition）：
  - activeSpecialists 中每个 specialist.status === 'completed'
  - collectedBriefs 已填充所有 specialist 摘要
  - ActionEvent(event_type='dispatch', status='sent') 已写入证据链

允许工具：
  core / session / capture / event / pipeline / texture / shader / remote / macro

禁止操作：
  - rd.shader.edit_and_replace（默认只读）
  - rd.macro.shader_hotfix_validate（仅 optimizer 模式）
  - 跳过 DispatchGate 检查

Blocker 触发条件：
  - 前序 dispatch 仍 pending → BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT
  - target_agent 不在有效列表 → BLOCKED_UNKNOWN_SPECIALIST

Backtrack 规则：
  - fromStage: dispatch, toStage: plan
  - trigger: specialist_timeout
  - maxRetries: 2
  - requiresUserConfirmation: false

超时策略：每个工具调用 60 秒（ToolBridge 默认），整体阶段建议不超过 10 分钟
Token 预算：dispatch + investigate 合计建议 < 8000 tokens
```

---

## 第3章：12阶段工作流规范

### 3.1 WorkflowStage 枚举（来源：`src/shared/types/workflow.ts`）

```typescript
export type WorkflowStage =
  | 'preflight'          // 前置检查
  | 'entry_gate'         // 入口闸门
  | 'intake_gate'        // Intake 闸门
  | 'plan'               // 计划制定
  | 'speclist'           // Specialist 规格
  | 'dispatch'           // Specialist 分派
  | 'investigate'        // 综合调查
  | 'fix_verify'         // 修复验证
  | 'skepti'             // 怀疑审查
  | 'curate'             // 报告整理
  | 'finalize'           // 最终完成
  | 'blocked'            // 阻断状态
  | 'awaiting_user_input'; // 等待用户输入
```

WorkflowPhase 分类：

```typescript
export type WorkflowPhase =
  | 'planner'    // preflight / entry_gate / intake_gate / plan / speclist
  | 'generator'  // dispatch / investigate
  | 'evaluator'; // fix_verify / skepti / curate / finalize
```

### 3.2 状态转移图

```
START
  │
  ▼
[preflight] ──blocked──→ [blocked]
  │ pass
  ▼
[entry_gate] ──blocked──→ [blocked]
  │ pass
  ▼
[intake_gate] ──blocked──→ [blocked]
  │ pass
  ▼
[plan] ──blocked──→ [blocked]
  │      ──awaiting──→ [awaiting_user_input]
  │ pass
  ▼
[speclist] ──blocked──→ [blocked]
  │ pass
  ▼
[dispatch] ──→ [specialist_exec] ──→ [specialist_briefs]
                                          │ incomplete
                                          │──→ [specialist_exec] (loop)
                                          │ complete
  ┌───────────────────────────────────────┘
  ▼
[investigate] ──blocked──→ [blocked]
  │ pass
  ▼
[fix_verify] ──blocked──→ [blocked]
  │           ──retry───→ [investigate] (back-to-plan)
  │ pass
  ▼
[skepti] ──blocked──→ [blocked]
  │       ──rejected─→ [fix_verify] (back-to-plan)
  │ approved
  ▼
[curate] ──blocked──→ [blocked]
  │       ──retry───→ [curate] (self-loop)
  │ done
  ▼
[finalize]
  │
  ▼
END
```

### 3.3 各阶段详细规范

#### Stage 1: preflight

| 属性 | 值 |
|------|-----|
| Phase | planner |
| 负责 Agent | rdc-debugger |
| System Prompt | "Verify runtime prerequisites, capture availability, and operator configuration before the run starts." |
| 允许工具组 | core / session / capture / remote |
| 禁止操作 | 任何写入操作 |

**入口条件**：用户发起调试请求，工作流初始化

**出口条件**：
- 运行时环境检查通过
- `ToolBridge.isAvailable()` 返回 true（Windows 平台）

**Blocker 触发**：
- 缺少 .rdc 文件 → `BLOCKED_MISSING_CAPTURE`
- 工具路径不可用 → 路由到 `blocked`

**超时**：30 秒

---

#### Stage 2: entry_gate

| 属性 | 值 |
|------|-----|
| Phase | planner |
| 负责 Agent | rdc-debugger |
| System Prompt | "Validate entry contract, backend truth, and capture/device compatibility." |
| 允许工具组 | core / session / capture / remote |
| 对应 Gate | `HarnessController.executeEntryGate()` |

**入口条件**：preflight 通过

**出口条件**：
- capturePaths 全部存在
- Debugger 模式下 LLM Provider 已配置（`settingsService.hasConfiguredProvider()`）

**Blocker 触发**（来源：`src/main/workflow/debugger/HarnessController.ts`）：
- `BLOCKED_MISSING_CAPTURE`：无 .rdc 文件
- `BLOCKED_CAPTURE_IMPORT_FAILED`：文件不存在
- `LLM_KEY_MISSING`：Debugger 模式缺少 LLM 配置
- `REMOTE_CONFIG_MISSING`：Remote Capture 缺少在线设备

**RuntimeRevisionRule**：无（Gate 失败直接 blocked）

---

#### Stage 3: intake_gate

| 属性 | 值 |
|------|-----|
| Phase | planner |
| 负责 Agent | rdc-debugger |
| System Prompt | "Establish case input, capture references, and canonical intake state for downstream agents." |
| 允许工具组 | capture / session |
| 对应 Gate | `HarnessController.executeIntakeGate()` |

**入口条件**：entry_gate 通过

**出口条件**：
- `IntakeContext` 完整构建
- `intake_gate.yaml` 写入 run artifacts

**必需字段检查**：`session`、`symptom`、`captures`、`reference_contract.source_refs`

**Blocker 触发**：
- `BLOCKED_INTAKE_GATE_REQUIRED`：缺少必需字段
- `BLOCKED_MISSING_FIX_REFERENCE`：缺少参照契约

**IntakeContext 类型**（来源：`src/shared/types/workflow.ts`）：

```typescript
export interface IntakeContext {
  taskFilePath?: string;
  taskFileContent?: string;
  effectiveGoal: string;
  discoveredProjectRoot?: string;
  openedCaptureId?: string | null;
  openedCapturePath?: string | null;
  availableCaptureIds: string[];
  providerId?: string;
  modelId?: string;
  replayDeviceId?: string | null;
  replayDeviceLabel?: string | null;
}
```

---

#### Stage 4: plan

| 属性 | 值 |
|------|-----|
| Phase | planner |
| 负责 Agent | rdc-debugger |
| System Prompt | "Expand the user goal into a structured investigation plan, hypotheses, and risk map." |
| 允许工具组 | core / session |
| LLM 调用 | `DebugWorkflowService.generatePlanWithLlm()` |

**入口条件**：intake_gate 通过

**出口条件**：
- `DebugPlan` 完整构建（`planReadiness`、`strictReady`、`recommendedSpecialists`）
- 若 `strictReady === false`，则转 `awaiting_user_input`

**PlanReadiness 状态**：

```typescript
export type PlanReadiness =
  | 'discovering'         // 正在收集信息
  | 'needs_user_input'    // 需要用户补充
  | 'ready_for_approval'  // 等待用户批准
  | 'strict_ready'        // 严格就绪，可执行
  | 'blocked';            // 有阻断项
```

**LLM 输出结构**：

```json
{
  "scope": "调查范围描述",
  "notes": ["注释1", "注释2"],
  "recommended_specialists": ["triage_agent", "pixel_forensics_agent"],
  "verification_focus": ["验证焦点1"]
}
```

**用户确认流程**：`PlanApprovalState` 需经过 `pending_user → approved` 才能进入 dispatch

---

#### Stage 5: speclist

| 属性 | 值 |
|------|-----|
| Phase | planner |
| 负责 Agent | rdc-debugger |
| System Prompt | "Produce specialist briefs, ownership boundaries, and tool constraints for each investigator." |
| 允许工具组 | core / session |

**入口条件**：plan 通过且 approvalState === 'approved'

**出口条件**：
- 每个 recommendedSpecialist 有对应 brief 和工具约束
- `SpecialistState` 全部初始化为 `status: 'pending'`

---

#### Stage 6: dispatch

| 属性 | 值 |
|------|-----|
| Phase | generator |
| 负责 Agent | rdc-debugger |
| System Prompt | "Run specialist work, collect their briefs, and preserve every dispatch and tool trace." |
| 允许工具组 | core / session / capture / event / pipeline / texture / shader / remote / macro |
| 对应 Gate | `HarnessController.executeDispatchGate()` |

**入口条件**：speclist 通过

**出口条件**：
- 所有 `activeSpecialists[id].status === 'completed'`
- `collectedBriefs` 已填充

**Specialist 工具绑定**（来源：`src/main/workflow/debugger/AgentOrchestrator.ts`）：

```typescript
const SPECIALIST_TOOL_BINDINGS: Record<string, string[]> = {
  triage_agent: ['rd.session.get_context', 'rd.event.get_action_tree', 'rd.macro.summarize_frame'],
  capture_repro_agent: ['rd.capture.get_info', 'rd.capture.list_frames', 'rd.context.snapshot'],
  pass_graph_pipeline_agent: ['rd.pipeline.get_state_summary', 'rd.pipeline.get_output_targets', 'rd.macro.find_state_change_point'],
  pixel_forensics_agent: ['rd.macro.explain_pixel', 'rd.texture.get_pixel_value', 'rd.export.screenshot'],
  shader_ir_agent: ['rd.shader.get_disassembly', 'rd.shader.debug_start'],
  driver_device_agent: ['rd.session.get_context', 'rd.remote.connect', 'rd.remote.ping', 'rd.remote.list_devices'],
  skeptic_agent: [],  // 不使用 live tool
  curator_agent: [],  // 不使用 live tool
};
```

**Blocker 触发**：
- `BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT`：前序 dispatch 仍 pending
- `BLOCKED_UNKNOWN_SPECIALIST`：无效 agent ID

**Backtrack 规则**：

```typescript
// RuntimeRevisionRule（概念性定义，实际由 DebuggerRuntime policy 实现）
{
  fromStage: 'dispatch',
  toStage: 'plan',
  trigger: 'specialist_timeout',
  maxRetries: 2,
  requiresUserConfirmation: false
}
```

---

#### Stage 7: investigate

| 属性 | 值 |
|------|-----|
| Phase | generator |
| 负责 Agent | rdc-debugger |
| System Prompt | "Synthesize specialist evidence into a concrete diagnosis and next verification target." |
| 允许工具组 | 同 dispatch |
| LLM 调用 | `DebugWorkflowService.buildInvestigationSummary()` |

**入口条件**：所有 specialist 已完成，collectedBriefs 完整

**出口条件**：
- `ReasoningSummary` 生成（summary / evidence / nextStep / confidence）
- ActionEvent(event_type='agent_summary') 写入证据链

**LLM 输出结构**：

```json
{
  "summary": "综合诊断摘要",
  "evidence": ["证据1", "证据2"],
  "next_step": "下一步建议",
  "confidence": 0.74,
  "root_cause": "根本原因描述",
  "recommendations": ["建议1"]
}
```

**Token 预算**：maxTokens: 700，temperature: 0.2

---

#### Stage 8: fix_verify

| 属性 | 值 |
|------|-----|
| Phase | evaluator |
| 负责 Agent | rdc-debugger |
| System Prompt | "Verify the proposed fix against real tool evidence and return pass, retry, or blocked." |
| 允许工具组 | 同 dispatch |
| 关键工具 | `rd.export.screenshot` |

**入口条件**：investigate 完成

**出口条件**：
- 截图证据已生成（verification.png）
- VerifyGate 通过
- verdict 为 'passed' 或 'evidence_consistent_warning'

**VerifyGate 必需字段**（来源：`src/main/workflow/debugger/HarnessController.ts`）：
- `verdict`、`verification_mode`、`verification_confidence`
- `structural_verification`、`semantic_verification`、`overall_result`

**Backtrack 规则**：

```typescript
{
  fromStage: 'fix_verify',
  toStage: 'investigate',
  trigger: 'triage_low_confidence',
  maxRetries: 2,
  requiresUserConfirmation: false
}
```

---

#### Stage 9: skepti

| 属性 | 值 |
|------|-----|
| Phase | evaluator |
| 负责 Agent | skeptic_agent |
| System Prompt | "Challenge unsupported claims and require hard evidence for every conclusion." |
| 允许工具组 | 无（skeptic 不使用 live tool） |
| LLM 调用 | `DebugWorkflowService.executeSkepticReview()` |

**入口条件**：fix_verify 通过

**出口条件**：
- `verdict` 为 'approved' 或 'approved_with_warning'（rejected 则 throw，触发 back-to-plan）

**LLM 输出结构**：

```json
{
  "verdict": "approved | approved_with_warning | rejected",
  "summary": "审查摘要"
}
```

**Token 预算**：maxTokens: 400，temperature: 0.1

**Backtrack 规则**：

```typescript
{
  fromStage: 'skepti',
  toStage: 'fix_verify',
  trigger: 'skeptic_rejected',
  maxRetries: 1,
  requiresUserConfirmation: false
}
```

---

#### Stage 10: curate

| 属性 | 值 |
|------|-----|
| Phase | evaluator |
| 负责 Agent | curator_agent |
| System Prompt | "Compile the accepted investigation into a structured, operator-ready final report." |
| 允许工具组 | 无（curator 不使用 live tool） |
| 写入范围 | workspace_reports / session_artifacts / knowledge_library |

**入口条件**：skepti approved

**出口条件**：
- `Report` 完整生成（title / summary / rootCause / fixDescription / evidenceSummary / confidence）

**LLM 输出结构**：

```json
{
  "title": "报告标题",
  "summary": "摘要",
  "root_cause": "根本原因",
  "fix_description": "修复描述",
  "evidence_summary": ["证据1"],
  "recommendations": ["建议1"],
  "confidence": 0.85
}
```

**Token 预算**：maxTokens: 900，temperature: 0.2

---

#### Stage 11: finalize

| 属性 | 值 |
|------|-----|
| Phase | evaluator |
| 负责 Agent | rdc-debugger |
| System Prompt | "Finalize only when all gates, evidence, skeptic signoff, and backend truth checks pass." |
| 允许工具组 | core / session |

**入口条件**：curate 完成，Report 生成

**出口条件**：
- RunRecord.status === 'completed'
- reportPaths 写入（markdown / json / html）
- ActionEvent(event_type='report_published') 写入证据链

**错误处理**：finalize 只有 END，无 back-to-plan

---

#### Stage 12: blocked / awaiting_user_input（系统状态）

`blocked`：工作流因 Blocker 无法继续，等待人工介入

`awaiting_user_input`：需要用户回答 `AskUserQuestion` 才能继续

```typescript
export interface AskUserQuestion {
  id: string;
  prompt: string;
  recommendedOptionId?: string;
  options: [AskUserQuestionOption, AskUserQuestionOption, AskUserQuestionOption, AskUserQuestionOption];
  freeformPlaceholder?: string;
}
```

---

## 第4章：Context Engineering 规范

### 4.1 System Prompt 工程

**原则**：约束优先、强制语言、动态阶段注入

**System Prompt 构建逻辑**（来源：`src/main/settings/ExecutionProfileService.ts`）：

```typescript
// resolveAgentRuntimeProfile 中的合并逻辑
systemPrompt: [
  agentProfile.systemPrompt,       // Agent 角色基础 Prompt
  stagePolicy.systemPrompt
    ? `\n\nStage Policy:\n${stagePolicy.systemPrompt}` : '',  // 当前阶段 Policy
].join('').trim(),
```

**防止 Context Degradation 策略**：

1. 每个 Agent 角色有独立固定的基础 System Prompt，不随对话历史漂移
2. 阶段 System Prompt 在每次 `sendMessage` 时动态注入，确保约束新鲜
3. Cowork 模式有专用 System Prompt（`buildCoworkSystemPrompt()`），与 Workflow 模式完全隔离

**Cowork System Prompt 模板**（来源：`src/main/conversation/ConversationService.ts`）：

```typescript
function buildCoworkSystemPrompt(): string {
  return [
    '你是 RDC Debugger，一个面向 RenderDoc 调试场景的 Cowork Agent。',
    '1. 始终先用自然中文正常回答用户，不要像审批流或工单流。',
    '2. 如果用户问通用知识、产品能力、技术概念，直接回答，不要强行往调试执行上拐。',
    '3. 没有正式进入调试 run 前，不要假装自己已经分析过 capture。',
    '4. 只有当用户明确表达"现在开始正式调试/执行分析"，并且条件足够时，才把 intent 标成 execute。',
    '5. 回复正文结束后，必须额外附加一个 <control>{...}</control> 块，...',
    '6. 如果你不确定，就把 intent 设为 talk 或 intake，safe_to_start 设为 false。',
    '7. 控制块不要在正文里解释给用户。',
  ].join('\n');
}
```

**Control Block 格式**：

```json
{
  "intent": "talk | intake | execute",
  "safe_to_start": false,
  "needs_project": false,
  "needs_capture": false,
  "needs_target_capture": false,
  "needs_route": false,
  "reason": "可选原因"
}
```

### 4.2 工具描述 Schema-First

**原则**：描述精准，约束嵌入，结果 Schema 包含 thought_process

**ToolDefinition 结构**（来源：`src/shared/types/tool.ts`）：

```typescript
export interface ToolDefinition {
  name: string;
  namespace: ToolNamespace;
  group: string;
  description: string;          // 控制在 10-30 tokens
  parameters: ToolParameter[];
  returns: ToolReturn;
  capabilities?: string[];
  prerequisites?: string[];
  live?: boolean;               // 是否为 live RDC 工具
}
```

**ToolNamespace 范围**：

```typescript
export type ToolNamespace =
  | 'capture' | 'session' | 'event' | 'replay' | 'pipeline'
  | 'shader' | 'texture' | 'resource' | 'export' | 'remote'
  | 'core' | 'macro' | 'vfs';
```

**工具层级（LayeredToolDefinition）**：

```typescript
export type ToolLayer = 'rdc' | 'system' | 'skill' | 'mcp';

export interface LayeredToolDefinition extends ToolDefinition {
  layer: ToolLayer;
  mcpServer?: string;   // 仅 layer='mcp' 时有值
  skillName?: string;   // 仅 layer='skill' 时有值
}
```

**System Tool 名称约定**：

```typescript
export type SystemToolName =
  | 'fs.read' | 'fs.glob' | 'fs.grep'
  | 'web.fetch' | 'web.search'
  | 'bash.exec'
  | 'task.create' | 'task.update' | 'task.list';
```

**RDC 工具组定义**（来源：`src/main/tools/ToolBridge.ts`）：

```typescript
const RDC_TOOL_GROUPS = [
  'core', 'capture', 'event', 'pipeline', 'resource',
  'texture', 'buffer', 'shader', 'shader_debug', 'counters',
  'export', 'diagnose', 'macro', 'snapshot', 'mesh',
  'replay', 'remote', 'vfs'
] as const;
```

**工具调用结果结构**：

```typescript
export interface ToolCallResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    category: string;
    details?: Record<string, unknown>;
  };
  artifacts?: ToolArtifact[];
  duration_ms: number;
  trace_id?: string;
}
```

### 4.3 即时检索（JIT Context）

**原则**：仅加载当前阶段所需上下文，已完成阶段的 artifact 只保留摘要引用

**Cowork 对话上下文**（来源：`src/main/conversation/ConversationService.ts`）：

```typescript
function buildCoworkPrompt(context, history, message): string {
  const recentHistory = history.slice(-6);  // 只取最近 6 条历史
  return JSON.stringify({
    user_message: message,
    effective_user_message: resolvedTaskFile.effectiveMessage,
    current_project_id: context.projectId,
    current_session_id: context.session?.sessionId ?? null,
    active_run_id: context.currentRun?.runId ?? null,
    opened_capture: context.openedCapturePath,
    project_inputs: context.projectInputs.slice(0, 8).map(e => e.fileName),  // 最多 8 个
    recent_history: recentHistory,
  });
}
```

**已完成阶段 artifact 压缩策略**：

- specialist brief 存为磁盘文件（`notes/{agentId}.md`），只在当前阶段全量加载
- 后续阶段通过 `collectedBriefs` 的摘要引用获取内容
- `ReasoningSummary` 只保留关键字段（summary / evidence / nextStep / confidence）

### 4.4 长任务优化

**结构化记忆模型**：

- `WorkflowState projection.stageHistory`：已完成阶段历史（只追加）
- `WorkflowState projection.evidenceChain`：ActionEvent 列表（只追加）
- `WorkflowState projection.artifacts`：artifact 路径列表（只追加）

**上下文压缩策略**：

- `WorkflowAnnotation` 中的 reducer 决定每个字段如何合并（追加 vs 覆盖）
- Overwrite reducer（`(_a, b) => b`）用于阶段状态字段，防止历史污染
- Append reducer（`(a, b) => [...a, ...b]`）用于证据链和 artifact 列表

**检查点持久化**（来源：`StorageAdapter run/session state`）：

```
workspace/checkpoints/{thread_id}/{checkpoint_ns}/{checkpoint_id}.json
workspace/checkpoints/{thread_id}/{checkpoint_ns}/writes/{checkpoint_id}_{task_id}.json
workspace/checkpoints/{thread_id}/{checkpoint_ns}/index.json
```

---

## 第5章：Harness Engineering 规范

### 5.1 Guardrails（约束层）

**工作流级强制**：

- LLM 只建议（System Prompt 描述），DebuggerRuntime 决定路由（`DebuggerRuntime.ts` 的条件边）
- 所有路由函数返回值类型固定：`'blocked' | 'next_stage' | 'back-to-plan_target'`
- 禁止任何代码绕过 `wrapNode()` 包装直接操作 WorkflowState projection

**Schema 验证**：

```
调用前：Zod Schema 验证 ToolCallRequest 参数（AgentToolPort schema adapter）
调用后：ToolCallResult.ok 字段必须检查，error 必须处理
Gate 前：HarnessController 各 Gate 方法在阶段入口强制执行
```

**角色工具绑定强制**（来源：`src/main/workflow/debugger/AgentOrchestrator.ts`）：

```typescript
isToolAllowedForRole(toolName: string, agentId: AgentRole): boolean {
  // Shader 编辑工具默认不可用
  if (SHADER_EDIT_TOOLS.includes(toolName)) return false;
  const allowedTools = this.getToolsForRole(agentId);
  // 支持通配符匹配，如 rd.event.*
  for (const pattern of allowedTools) {
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      if (toolName.startsWith(prefix + '.')) return true;
    } else if (toolName === pattern) return true;
  }
  return false;
}
```

**默认只读约束**：

```typescript
const SHADER_EDIT_TOOLS = ['rd.shader.edit_and_replace', 'rd.macro.shader_hotfix_validate'];
// 仅 optimizer 模式或用户显式要求时启用
```

### 5.2 Observability（可观测层）

**ActionEvent 证据链**（来源：`src/shared/types/evidence.ts`）：

```typescript
export interface ActionEvent {
  schema_version: string;
  event_id: string;
  ts_ms: number;
  run_id: string;
  session_id: string;
  agent_id: string;
  event_type: EventType;
  status: EventStatus;
  duration_ms: number;
  refs: string[];
  payload: Record<string, unknown>;
}

export type EventStatus =
  | 'ok' | 'error' | 'sent' | 'pass' | 'fail'
  | 'blocked' | 'entered' | 'warning' | 'timeout' | 'completed';
```

**核心事件类型**：

| event_type | 触发场景 |
|-----------|---------|
| `workflow_stage_transition` | 阶段切换 |
| `dispatch` | Specialist 分派 |
| `tool_execution` | 工具调用（通过 `wrapToolExecution()`） |
| `agent_summary` | Agent 输出摘要 |
| `blocker` | Blocker 检测 |
| `verification` | fix_verify / skeptic 验证 |
| `report_published` | 报告生成 |
| `user_message` | 用户输入 |

**Token 追踪**（通过 `ExecutionProfileService`）：

- 每个 `callStructured()` 调用记录 Token 使用（agentId / stage / runId）
- `debuggerLlmService.getRunSummary(runId)` 获取整个 run 的 LLM 执行摘要

**ToolTrace 追踪**（来源：`src/shared/types/tool.ts`）：

```typescript
export interface ToolTraceEntry {
  traceId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: ToolCallResult;
  timestamp: number;
  contextId: string;
  runtimeOwner: string;
  ownerLeaseId?: string;
}
```

### 5.3 错误恢复机制

#### 6种失败模式及防护策略

**1. Context Degradation（上下文退化）**

- 现象：Agent 随着对话轮数增加逐渐忘记约束，开始自由发挥
- 防护：每次 `sendMessage` 重新注入 Stage Policy System Prompt；Cowork 模式只取最近 6 条历史；约束写在 System Prompt 开头

**2. Specification Drift（规范漂移）**

- 现象：实现与规范不一致，类型定义与 IPC 行为不匹配
- 防护：修改必须同步更新 `src/shared/types/`；提交前必须 `npm run typecheck`；本文档作为对照基准

**3. Sycophantic Confirmation（讨好式确认）**

- 现象：skeptic_agent 总是 approved，没有真正挑战
- 防护：skeptic System Prompt 强调"Challenge unsupported claims"；temperature 设为 0.1；verdict 只能为三值之一（强制解析）

**4. Tool Call Failure（工具调用失败）**

- 现象：rd.* 工具调用失败，LLM 继续执行而不报错
- 防护：`HarnessController.wrapToolExecution()` 强制记录 ActionEvent；`ToolCallResult.ok` 必须显式检查；工具超时 60 秒（`ToolBridge` 配置）

**5. Cascading Failure（级联失败）**

- 现象：一个 Specialist 失败导致整个 dispatch 崩溃
- 防护：`specialistExecNode` 使用 `Promise.all` 但各 specialist 独立 try/catch；失败的 specialist 标记为 `status: 'failed'` 而不抛出

**6. Silent Failure（静默失败）**

- 现象：工具调用失败但没有写入证据链
- 防护：所有 live 工具调用必须通过 `wrapToolExecution()`；`emitToolTrace()` 在成功和失败时都触发

#### 自纠正循环

```
工具调用失败
  → ToolCallResult.ok === false
  → Agent 读取 error.message
  → 在下一轮 LLM 调用中提供错误上下文
  → 最多 2 次重试（由 retry ledger 追踪）
  → 超出重试 → Blocker 写入 → blocked 状态
```

#### 工具级重试策略

- 当前 ToolBridge 实现：单次超时 60 秒，无自动重试
- 建议：指数退避（500ms → 1s → 2s），最多 3 次，超出则写 Blocker

#### 降级策略

- `DebugWorkflowService` 中所有 LLM 调用均有 `testValue`（deterministic fallback）
- 若 LLM 调用失败，使用 deterministic 值继续执行而不中断

### 5.4 流程遵循性度量

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| 阶段完成率 | > 95% | 统计 `workflow_stage_transition` 事件 |
| 规范遵循率 | > 99% | 验证所有工具调用在 `SPECIALIST_TOOL_BINDINGS` 范围内 |
| Gate 绕过率 | = 0% | 检查每个阶段前是否有对应 Gate 通过记录 |
| 证据链完整性 | 100% | `EvidenceChain.gaps.length === 0` |
| Skeptic 拒绝率 | > 5% | 防止纯橡皮图章 |

---

## 第6章：UI/UX 体验规范

### 6.1 Cowork 体验层设计

**对话模式 vs 工作流模式**：

```
用户视角：始终是同一个 Agent 在说话（rdc-debugger）
内部切换：
  talk/intake 模式 → handleCoworkTurn()（自由对话）
  execute_upgrade 模式 → debugWorkflowService.startPlan()（切入 Workflow）
  active_debug 模式 → handleActiveDebugTurn()（工作流进行中）
```

**模式切换对用户无感**：

- 对话内容无中断：`assistantContent` 先由 LLM 生成，再拼接 Workflow 状态反馈
- 错误时回退：`buildWorkflowUpgradeReply()` 提供友好错误消息
- UI Hints 辅助：`uiHints.showPlanIntake / highlightCaptureLibrary / highlightSettingsRoute`

**ConversationTurnResult 结构**（来源：`src/shared/types/conversation.ts`）：

```
mode: 'talk' | 'intake' | 'execute_upgrade' | 'active_debug'
executionTransition: { action: 'none' | 'started_run', runId?, sessionId? }
uiHints: { showPlanIntake?, highlightCaptureLibrary?, highlightProjectPicker?, highlightSettingsRoute? }
errorViewModel: { code, message, technicalMessage } | null
```

### 6.2 渐进式反馈

**事件驱动流式输出**：

IPC 事件列表（Electron main → renderer）：

| 事件名 | 触发时机 | Payload |
|--------|---------|---------|
| `workflow:stateChanged` | 每次阶段变化 | WorkflowState |
| `workflow:stageChanged` | 阶段 + blockers 变化 | {stage, blockers} |
| `workflow:runStatusChanged` | run 状态变化 | {sessionId, runId, status} |
| `evidence:eventAdded` | ActionEvent 写入 | ActionEvent |
| `agent:statusChanged` | Agent 状态切换 | AgentState |
| `agent:message` | Agent 消息记录 | AgentMessage |

**Loading States 设计规范**：

- 每个 WorkflowStage 对应一个 Loading 状态（阶段名 + 进度描述）
- blocked 状态：显示 Blocker 详情和解决建议
- awaiting_user_input 状态：显示 AskUserPrompt 卡片

### 6.3 错误体验

**友好消息规范**：

```typescript
// 来自 ConversationService.ts 的实际实现示例
'我可以先帮你梳理问题，不过正式调试要先选一个项目。'
'当前调试链路还没绑定可用模型，所以我不能开始正式执行。'
'我可以先帮你梳理问题，但正式分析需要一个 .rdc capture。'
```

规则：
1. 用中文，不露出技术栈内部名称（不说 "BLOCKED_MISSING_CAPTURE"）
2. 说明现在能做什么，不只说不能做什么
3. 提供具体的解决路径
4. 自动重试时告知用户正在重试

---

## 第7章：Agent 角色与协作规范

### 7.1 AgentRole 枚举（来源：`src/shared/types/agent.ts`）

```typescript
export type AgentRole =
  | 'rdc-debugger'               // 主入口 / Orchestrator
  | 'triage_agent'               // 症状分类
  | 'capture_repro_agent'        // Capture 复现
  | 'pass_graph_pipeline_agent'  // Pass/Pipeline 分析
  | 'pixel_forensics_agent'      // 像素取证
  | 'shader_ir_agent'            // Shader IR 分析
  | 'driver_device_agent'        // 驱动设备分析
  | 'skeptic_agent'              // 审批者
  | 'curator_agent';             // 报告/知识沉淀
```

AgentCategory 映射：

```typescript
export const AGENT_CATEGORY_MAP: Record<AgentRole, AgentCategory> = {
  'rdc-debugger': 'orchestrator',
  'triage_agent': 'investigator',
  'capture_repro_agent': 'investigator',
  'pass_graph_pipeline_agent': 'investigator',
  'pixel_forensics_agent': 'investigator',
  'shader_ir_agent': 'investigator',
  'driver_device_agent': 'investigator',
  'skeptic_agent': 'verifier',
  'curator_agent': 'reporter',
};
```

### 7.2 各角色规范

#### rdc-debugger（Orchestrator）

| 属性 | 值 |
|------|-----|
| 类别 | orchestrator |
| 写入范围 | workspace_control |
| 默认模型 | anthropic/claude-3-opus (openrouter) |
| 温度 | 0.3 |
| maxTokens | 4096 |

**职责**：Cowork 对话、工作流编排、意图识别、阶段路由决策
**工具范围**：`rd.core.*` / `rd.session.*` / `rd.capture.*` / `rd.remote.*`（全量）
**关键约束**：
- Cowork 模式不假装已分析 capture
- 工作流模式只提建议，由 DebuggerRuntime 决定路由
- 所有 LLM 输出必须有 deterministic fallback

**协作协议**：与所有 specialist agents 均有 dispatch 关系；接收 skeptic/curator 的最终结论

---

#### triage_agent（症状分类专家）

| 属性 | 值 |
|------|-----|
| 类别 | investigator |
| 写入范围 | workspace_notes |
| 默认模型 | anthropic/claude-3-sonnet (openrouter) |

**职责**：分类渲染问题、收窄症状家族、建议调查面
**System Prompt 核心约束**："Classify the rendering issue, narrow the symptom family, and suggest the right investigation surfaces."
**工具范围**：

```
rd.session.get_context
rd.event.get_action_tree
rd.macro.summarize_frame
```

**输出格式**：ReasoningSummary（summary / evidence / nextStep / confidence）

---

#### capture_repro_agent（Capture 复现专家）

| 属性 | 值 |
|------|-----|
| 类别 | investigator |
| 默认模型 | anthropic/claude-3-sonnet (openrouter) |

**职责**：验证 capture 质量、帧一致性、可复现锚点
**System Prompt 核心约束**："Validate capture quality, frame consistency, and reproducibility anchors."
**工具范围**：

```
rd.capture.get_info
rd.capture.list_frames
rd.context.snapshot
```

---

#### pass_graph_pipeline_agent（Pass/Pipeline 分析专家）

| 属性 | 值 |
|------|-----|
| 类别 | investigator |
| 默认模型 | anthropic/claude-3-sonnet (openrouter) |

**职责**：分析渲染通道序列、Pipeline 状态、依赖变化
**System Prompt 核心约束**："Analyze render-pass sequencing, pipeline state, and dependency shifts."
**工具范围**：

```
rd.pipeline.get_state_summary
rd.pipeline.get_output_targets
rd.macro.find_state_change_point
```

---

#### pixel_forensics_agent（像素取证专家）

| 属性 | 值 |
|------|-----|
| 类别 | investigator |
| 默认模型 | google/gemini-pro-1.5 (openrouter) |

**职责**：用像素级、Target 级、Event 级证据解释可见损坏
**System Prompt 核心约束**："Explain visible corruption with concrete pixel-, target-, and event-level evidence."
**工具范围**：

```
rd.macro.explain_pixel
rd.texture.get_pixel_value
rd.export.screenshot
```

---

#### shader_ir_agent（Shader IR 分析专家）

| 属性 | 值 |
|------|-----|
| 类别 | investigator |
| 默认模型 | anthropic/claude-3-sonnet (openrouter) |

**职责**：检查 Shader 源码、编译后 IR、精度和替换风险
**System Prompt 核心约束**："Inspect shader source, compiled IR, and precision or replacement risks."
**工具范围**：

```
rd.shader.get_disassembly
rd.shader.debug_start
```

**特殊约束**：`rd.shader.edit_and_replace` 默认禁止（仅 optimizer 模式启用）

---

#### driver_device_agent（驱动设备分析专家）

| 属性 | 值 |
|------|-----|
| 类别 | investigator |
| 默认模型 | anthropic/claude-3-sonnet (openrouter) |

**职责**：比较 backend / device / driver 特定行为，识别 Remote 运行时风险
**System Prompt 核心约束**："Compare backend, device, and driver specific behavior and identify remote-runtime risks."
**工具范围**：

```
rd.session.get_context
rd.remote.connect
rd.remote.ping
rd.remote.list_devices
```

---

#### skeptic_agent（审批者）

| 属性 | 值 |
|------|-----|
| 类别 | verifier |
| 写入范围 | session_signoff |
| 默认模型 | openai/gpt-4o (openrouter) |
| 温度 | 0.1（强制低温，减少讨好倾向） |

**职责**：挑战弱主张，要求每个结论有硬证据
**System Prompt 核心约束**："Challenge unsupported claims and reject conclusions not proven by the evidence chain."
**工具范围**：无（不使用 live tool）
**输出格式**：`{ verdict: 'approved' | 'approved_with_warning' | 'rejected', summary: string }`
**协作协议**：`rejected` 触发 back-to-plan 到 fix_verify；`approved_with_warning` 允许继续但警告

---

#### curator_agent（报告整理者）

| 属性 | 值 |
|------|-----|
| 类别 | reporter |
| 写入范围 | workspace_reports / session_artifacts / knowledge_library |
| 默认模型 | anthropic/claude-3-sonnet (openrouter) |
| 温度 | 0.2（低温确保报告一致性） |

**职责**：将被接受的调查结果整理成结构化最终报告
**System Prompt 核心约束**："Turn accepted evidence into a structured final report and operator-ready summary."
**工具范围**：无（不使用 live tool）

### 7.3 DEFAULT_MODEL_ROUTING（来源：`src/shared/types/agent.ts`）

```typescript
export const DEFAULT_MODEL_ROUTING: Record<AgentRole, { provider: LlmProviderId; model: string }> = {
  'rdc-debugger':                { provider: 'openrouter', model: 'anthropic/claude-3-opus' },
  'triage_agent':                { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'capture_repro_agent':         { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'pass_graph_pipeline_agent':   { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'pixel_forensics_agent':       { provider: 'openrouter', model: 'google/gemini-pro-1.5' },
  'shader_ir_agent':             { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'driver_device_agent':         { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  'skeptic_agent':               { provider: 'openrouter', model: 'openai/gpt-4o' },
  'curator_agent':               { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
};
```

### 7.4 WriteScope 权限控制

```typescript
export type WriteScope =
  | 'workspace_control'   // rdc-debugger：工作流控制
  | 'workspace_notes'     // investigator agents：调查笔记
  | 'session_signoff'     // skeptic_agent：审批签名
  | 'workspace_reports'   // curator_agent：最终报告
  | 'session_artifacts'   // curator_agent：Session artifact
  | 'knowledge_library';  // curator_agent：知识库沉淀
```

---

## 第8章：质量门禁与测试规范

### 8.1 代码提交门禁

必须在每次提交前通过：

```bash
npm run typecheck   # TypeScript 类型检查（必须零错误）
npm run lint        # ESLint 代码规范检查
```

**跨层联动检查清单**：

在提交任何修改前，检查以下问题是否存在：

- [ ] 是否只改了 UI 没改 IPC 或共享类型？
- [ ] 是否只改了主进程没改渲染层入口或状态展示？
- [ ] 是否引入了新的重复定义、旧命名或兼容分支？
- [ ] 新增 IPC 事件是否同步更新了 `src/preload/index.ts` 和 renderer 订阅？
- [ ] 新增 WorkflowStage 是否同步更新了 `DebuggerRuntime.ts` 的节点和路由？

### 8.2 E2E 测试要求

E2E 测试位于 `e2e/` 目录，使用 Playwright。

**核心测试文件**：

| 测试文件 | 覆盖场景 |
|---------|---------|
| `debugger-intake.spec.ts` | 调试 intake 流程 |
| `debugger-plan-intake.spec.ts` | 计划制定流程 |
| `live-debugger-mainchain.spec.ts` | 完整主链路（E2E） |
| `run-stop-recovery.spec.ts` | 停止和恢复场景 |
| `session-lifecycle.spec.ts` | Session 生命周期 |
| `mode-switch.spec.ts` | 模式切换 |
| `debugger-cowork-chat.spec.ts` | Cowork 对话模式 |

**测试环境变量**：`RDC_AGENT_TEST_MODE=1` 启用 mock 模式，绕过真实 LLM 调用

### 8.3 新增阶段/工具/角色的规范同步要求

**新增 WorkflowStage**：

1. 更新 `src/shared/types/workflow.ts` 的 `WorkflowStage` 类型
2. 在 `DebuggerRuntime.ts` 中添加节点和边
3. 在 `ExecutionProfileService.ts` 中添加 `DEFAULT_STAGE_POLICIES` 条目
4. 在本文档第3章补充阶段规范表格
5. 运行 `npm run typecheck`

**新增 AgentRole**：

1. 更新 `src/shared/types/agent.ts` 的 `AgentRole` 类型
2. 更新 `DEFAULT_MODEL_ROUTING` 和 `AGENT_CATEGORY_MAP`
3. 在 `AgentOrchestrator.ts` 的 `SPECIALIST_TOOL_BINDINGS` 中添加工具绑定
4. 在 `ExecutionProfileService.ts` 的 `DEFAULT_AGENT_PROMPTS` 和 `DEFAULT_AGENT_TOOLS` 中添加条目
5. 在本文档第7章补充角色规范

**新增工具（rd.*）**：

1. 更新 `resources/tools/spec/tool_catalog.json`
2. 确认工具组在 `RDC_TOOL_GROUPS` 中已包含
3. 在对应 specialist 的 `SPECIALIST_TOOL_BINDINGS` 中添加
4. 在本文档第3章对应阶段的"允许工具"列表中更新

### 8.4 验收标准定义

每个 Milestone 任务的验收标准：

1. `npm run typecheck` 零错误
2. `npm run lint` 零错误
3. 对应 E2E 测试通过（`npm run test:e2e`）
4. 跨层联动检查清单全部通过
5. 本文档对应章节已更新

---

## 第9章：开发路线

### Milestone 1：基础加固（Context + Harness + 错误恢复）

**目标**：让系统在真实 LLM 下稳定运行，消除静默失败和上下文退化

#### M1-1 System Prompt 重构

- 涉及文件：`src/main/settings/ExecutionProfileService.ts`、`src/main/conversation/ConversationService.ts`
- 任务：规范化所有 Agent 的 System Prompt 结构，确保约束前置
- 验收：所有 Agent System Prompt 符合第4.1章模板；typecheck 通过

#### M1-2 Context 压缩策略

- 涉及文件：`src/main/conversation/ConversationService.ts`、`src/main/workflow/debugger/DebuggerRuntime.ts`
- 任务：实现 Cowork 历史截断（已有 slice(-6)，验证其有效性）；已完成阶段 artifact 只保留摘要
- 验收：长对话（> 20 轮）不触发 Token 超限错误

#### M1-3 工具调用显式错误处理

- 涉及文件：`src/main/workflow/debugger/HarnessController.ts`、`src/main/workflow/debugger/DebugWorkflowService.ts`
- 任务：所有 live 工具调用路径确保通过 `wrapToolExecution()` 包装
- 验收：工具失败时 ActionEvent 写入证据链，EventStatus 为 'error'

#### M1-4 自纠正循环

- 涉及文件：`src/main/workflow/debugger/DebuggerRuntime.ts`（节点函数）
- 任务：实现工具失败 → 错误上下文回注 → 重试 → 超限触发 Blocker 的完整循环
- 验收：`retry ledger` 正确追踪重试次数；超出 maxRetries 正确写 Blocker

#### M1-5 超时策略统一

- 涉及文件：`src/main/tools/ToolBridge.ts`
- 任务：工具超时从硬编码 60 秒改为可配置；添加指数退避重试
- 验收：超时 60 秒后工具调用返回 `ToolCallResult.ok === false`

#### M1-6 Token 预算管理

- 涉及文件：`src/main/workflow/debugger/DebugWorkflowService.ts`（各 LLM 调用处）
- 任务：按第3章各阶段 Token 预算规范，审查并修正所有 maxTokens 配置
- 验收：plan(700) / investigate(700) / skepti(400) / curate(900) 符合规范

#### M1-7 6种失败模式防护

- 任务：实现第5.3章的 6 种失败模式防护策略
- 验收：e2e 故障注入测试全部通过

**M1 依赖**：无
**M1 成功指标**：主链路（M1-3执行的完整run）成功率 > 90%

---

### Milestone 2：用户体验提升（流式输出 + 对话增强 + UI 打磨）

**目标**：让用户感受到流畅、自然、有反馈的调试体验

#### M2-1 流式输出事件体系

- 涉及文件：`src/main/ipc/`、`src/renderer/`
- 任务：LLM 回复支持流式输出，每个 token 通过 IPC 推送到 renderer
- 验收：`workbench-visual.spec.ts` 中的流式输出测试通过

#### M2-2 Loading States 完善

- 涉及文件：`src/renderer/features/`
- 任务：每个 WorkflowStage 对应专用 Loading 状态组件
- 验收：阶段切换时 Loading 过渡无空白闪烁

#### M2-3 意图识别增强

- 涉及文件：`src/main/conversation/ConversationService.ts`
- 任务：优化 `EXECUTE_PATTERN` 正则；添加更多中文意图表达
- 验收：E2E 意图识别准确率 > 95%

#### M2-4 Cowork/Debug 无缝切换

- 涉及文件：`src/main/conversation/ConversationService.ts`、renderer
- 任务：execute_upgrade 模式下对话内容无中断；WorkflowState 变化自动刷新 UI
- 验收：`mode-switch.spec.ts` 全部通过

#### M2-5 错误消息友好化

- 涉及文件：`src/main/conversation/ConversationService.ts`（`createFallbackAssistantReply`）
- 任务：补全所有 Blocker 的友好消息映射（参照 `buildWorkflowUpgradeReply` 模式）
- 验收：所有 Blocker 码有对应中文友好消息

**M2 依赖**：M1 完成
**M2 成功指标**：用户测试中交互轮数 < 8 次（从提问到 debug run 启动）

---

### Milestone 3：可靠性与可观测性（测试 + 监控 + 审计）

**目标**：让每次 run 都可审计、可重放、可监控

#### M3-1 Backtrack 完整测试

- 涉及文件：`e2e/run-stop-recovery.spec.ts`、新增 `e2e/back-to-plan.spec.ts`
- 任务：覆盖所有 RuntimeRevisionTrigger（specialist_timeout / skeptic_rejected / triage_low_confidence / blocker_detected / user_requested）
- 验收：5种触发条件的 E2E 测试全部通过

#### M3-2 故障注入测试

- 涉及文件：新增 `e2e/fault-injection.spec.ts`
- 任务：模拟工具超时、LLM 失败、网络断开等场景
- 验收：所有故障场景有明确的 Blocker 而不是崩溃

#### M3-3 流程遵循性监控

- 涉及文件：`src/main/workflow/debugger/HarnessController.ts`
- 任务：实现第5.4章指标的实时计算和 IPC 推送
- 验收：每次 run 结束后可查询流程遵循性报告

#### M3-4 证据链完整性校验

- 涉及文件：`src/shared/types/evidence.ts`（EvidenceChain）、新增校验服务
- 任务：实现 `EvidenceChain.isValid` 和 `gaps` 的自动计算
- 验收：每次 run 完成后证据链完整性校验通过

#### M3-5 IPC handlers 模块化拆分

- 涉及文件：`src/main/ipc/handlers.ts`（若存在大文件）
- 任务：按功能拆分 IPC handlers，每个域一个文件
- 验收：单个 handler 文件 < 200 行

#### M3-6 StorageAdapter 并发安全

- 涉及文件：`StorageAdapter run/session state`
- 任务：添加写操作锁，防止多个 run 并发写入同一 checkpoint 目录
- 验收：并发 run 测试不出现数据损坏

**M3 依赖**：M1 完成
**M3 成功指标**：证据链完整性 100%；stage 完成率 > 95%

---

### Milestone 4：扩展与竞争力（MCP + Skill + 知识库 + Remote）

**目标**：开放扩展能力，支持更多场景

#### M4-1 MCP 集成测试

- 涉及文件：`src/main/mcp/`、`resources/tools/mcp/run_mcp.py`
- 任务：完善 MCP 工具注册和调用路径；添加 E2E 集成测试
- 验收：MCP 工具可正常通过 `LayeredToolDefinition.layer='mcp'` 调用

#### M4-2 Remote Device 完整支持

- 涉及文件：`src/main/workflow/debugger/HarnessController.ts`（Remote 前置检查）、driver_device_agent 工具
- 任务：完善 Remote Capture 的完整执行路径
- 验收：Android Remote 端到端调试流程通过

#### M4-3 知识库增强

- 涉及文件：`resources/knowledge/`
- 任务：设计知识库的写入和检索接口；curator_agent 自动沉淀知识
- 验收：每次 run 后知识库有新增条目

#### M4-4 Skill 市场

- 涉及文件：`src/main/skills/`
- 任务：完善 Skill 注册机制；支持用户自定义 Skill
- 验收：自定义 Skill 可通过 `LayeredToolDefinition.layer='skill'` 访问

#### M4-5 跨平台兼容

- 涉及文件：`src/main/tools/ToolBridge.ts`
- 任务：当前仅支持 Windows；设计 macOS/Linux 的 ToolBridge 适配层
- 验收：macOS 上工具路径解析正确（即使当前为 stub）

#### M4-6 Analyzer/Optimizer 模式

- 涉及文件：`src/shared/types/session.ts`（AppMode 已定义 'analyzer' | 'optimizer'）
- 任务：实现 analyzer 和 optimizer 模式的完整工作流（当前为占位页）
- 验收：Analyzer 模式可完成不依赖 LLM 的静态分析流程

**M4 依赖**：M3 完成
**M4 成功指标**：MCP 工具覆盖率 > 80%；Remote Device 支持 Android

---

## 附录A：执行原则

给所有 Coding Agent 的 6 条约束，不得违反：

**1. 规范先行**
任何新功能或修改，必须先确认本文档中有对应的规范描述。无规范描述的实现视为技术债。

**2. 跨层联动**
修改 `src/shared/types/` 时，必须同步检查 `src/main/`、`src/preload/`、`src/renderer/`。
修改 IPC 事件时，必须同步更新 `preload/index.ts` 和 renderer 订阅代码。

**3. 单一事实来源**
- `src/shared/types/` 是类型的单一事实来源
- `resources/tools/spec/tool_catalog.json` 是工具目录的单一事实来源
- 本文档是行为规范的单一事实来源
- 三者互相一致，任何不一致必须修复

**4. 完整内联**
一次修改内必须同步完成所有相关变更，不留"临时兼容"、"稍后补充"的残局。

**5. 强制垂直推进**
工作流阶段顺序不可跳跃。LLM 的建议必须经过 DebuggerRuntime 路由函数验证才能实际推进阶段。
任何绕过 Gate 检查的代码是严重 Bug，必须修复。

**6. 可验证交付**
每个任务完成后必须能通过：`npm run typecheck` + 对应 E2E 测试 + 跨层联动检查清单。
未通过以上验证的代码不算完成。

---

## 附录B：关键文件路径速查表

### 共享类型（`src/shared/`）

| 文件 | 内容 |
|------|-----|
| `src/shared/types/workflow.ts` | WorkflowStage / WorkflowState projection / Blocker / RuntimeRevisionRule / IntakeContext |
| `src/shared/types/agent.ts` | AgentRole / DEFAULT_MODEL_ROUTING / AgentConfig |
| `src/shared/types/tool.ts` | ToolDefinition / LayeredToolDefinition / ToolCallResult |
| `src/shared/types/evidence.ts` | ActionEvent / EvidenceChain |
| `src/shared/types/session.ts` | SessionRecord / ContextSnapshot / RunRecord |
| `src/shared/constants/agents.ts` | AGENT_DISPLAY_NAMES / AGENT_DESCRIPTIONS / INVESTIGATOR_AGENTS |
| `src/shared/constants/stages.ts` | STAGE_PHASES / normalizeWorkflowStage |
| `src/shared/constants/blockers.ts` | BLOCKER_CODES |

### 主进程服务（`src/main/workflow/debugger/`）

| 文件 | 职责 |
|------|-----|
| `DebuggerRuntime.ts` | DebuggerRuntime 定义、节点注册、边路由 |
| `DebugWorkflowService.ts` | 工作流编排、LLM 调用、run 生命周期管理 |
| `AgentOrchestrator.ts` | Agent 配置、System Prompt 构建、消息发送 |
| `ConversationService.ts` | Cowork 对话、意图识别、模式切换 |
| `HarnessController.ts` | Gate 前置检查、工具调用包装、早期 Blocker 检测 |
| `ToolBridge.ts` | rd.* 工具调用、CLI 执行、工具目录加载 |
| `ExecutionProfileService.ts` | 执行特征文件、Agent Runtime Profile 解析 |
| `StorageAdapter.ts` | 会话、运行、事件和 Runtime projection 持久化 |
| `StorageAdapter.ts` | 会话/运行/事件 持久化 |

### 主进程工具（`src/main/tools/`）

| 文件 | 职责 |
|------|-----|
| `ToolBridgeAgentToolPort.ts` | rd.* 工具适配为 AgentRunnerPort 可调用工具 |

### 工具目录（`resources/tools/`）

| 路径 | 内容 |
|-----|-----|
| `resources/tools/spec/tool_catalog.json` | 所有 rd.* 工具定义 |
| `resources/tools/cli/run_cli.py` | CLI 入口 |
| `resources/tools/mcp/run_mcp.py` | MCP 入口 |
| `resources/tools/rdx/` | 工具实现 |

---

## 附录C：成功指标体系

### 可靠性指标

| 指标 | 目标值 | 当前状态 |
|------|--------|---------|
| 主链路阶段完成率 | > 95% | 待测量 |
| 规范遵循率（工具绑定） | > 99% | 待测量 |
| Gate 绕过率 | = 0% | 待验证 |
| 静默失败率 | = 0% | 待测量 |
| Skeptic 拒绝率 | > 5% | 待测量（防橡皮图章） |
| 证据链完整性 | 100% | 待测量 |

### 用户体验指标

| 指标 | 目标值 |
|------|--------|
| 从提问到 run 启动的交互轮数 | < 8 轮 |
| 用户确认率（看到 plan 后批准） | > 80% |
| 模式切换感知（无感切换） | < 500ms 延迟 |
| 错误消息友好性（用户反馈） | > 4.0/5.0 |

### Token 效率指标

| 阶段 | Token 预算 | 含义 |
|------|-----------|-----|
| plan | < 700 tokens | planLlmPayload 生成 |
| investigate | < 700 tokens | 综合诊断摘要 |
| skepti | < 400 tokens | 审查输出 |
| curate | < 900 tokens | 最终报告生成 |
| Cowork 单轮 | < 1200 tokens | 对话回复 |
| 整个 run 合计 | < 15000 tokens | 建议上限 |

---

## 附录D：避坑指南

### 坑1：Context Degradation（上下文退化）

**现象**：Agent 在多轮对话后开始无视约束，自由发挥，忘记它是 RenderDoc 调试专家

**根本原因**：System Prompt 过长或约束排在后面被截断；对话历史无限增长

**解决方案**：
1. 约束写在 System Prompt 最前面（不是最后面）
2. Cowork 历史只取最近 6 条（`history.slice(-6)`，当前已实现）
3. 每次调用重新构建 System Prompt（不缓存带历史的 Prompt）
4. Workflow 模式使用 Stage Policy 注入而非对话历史传递

**检查代码**：`src/main/conversation/ConversationService.ts` 中的 `buildCoworkPrompt` 和 `buildCoworkSystemPrompt`

---

### 坑2：Silent Failure（静默失败）

**现象**：工具调用失败，LLM 继续生成输出，整个 run 最终给出错误结论

**根本原因**：没有检查 `ToolCallResult.ok`，或工具调用没有通过 `wrapToolExecution()`

**解决方案**：
1. 所有 live 工具调用必须经过 `HarnessController.wrapToolExecution()`
2. 检查 `result.ok === false` 后必须抛出或写入 Blocker
3. `ToolBridge.emitToolTrace()` 在成功和失败时都调用（确保可观测性）

**检查代码**：`src/main/workflow/debugger/DebugWorkflowService.ts` 中的 `executeVerification` 方法

---

### 坑3：Token Budget Overflow（Token 预算溢出）

**现象**：LLM 调用失败，错误为 "context length exceeded"；或 run 成本极高

**根本原因**：specialist brief 全量传入 investigate 阶段；工具描述冗长

**解决方案**：
1. specialist brief 存磁盘，investigate 只传摘要（`ReasoningSummary`，非全文）
2. 工具描述控制在 10-30 tokens（`ToolDefinition.description` 精简）
3. Cowork 历史截断（已实现）
4. 按第3章各阶段 Token 预算规范审查 maxTokens 配置

**检查代码**：`src/main/workflow/debugger/DebugWorkflowService.ts` 中的 `buildInvestigationSummary`

---

### 坑4：Sycophantic Confirmation（讨好式确认）

**现象**：skeptic_agent 对所有结论都 approved，没有任何拒绝，成为橡皮图章

**根本原因**：temperature 过高；System Prompt 没有强调"拒绝"的重要性；缺少反例训练

**解决方案**：
1. skeptic_agent temperature 设为 0.1（强制低温，已在规范中定义）
2. System Prompt 明确写"Reject only when the evidence chain is not strong enough"
3. 监控 Skeptic 拒绝率，若低于 5% 则检查 System Prompt
4. 输出强制为三值枚举（approved / approved_with_warning / rejected），不接受模糊回答

**检查代码**：`src/main/workflow/debugger/DebugWorkflowService.ts` 中的 `executeSkepticReview`

---

*文档维护：每次架构级变更后同步更新本文档。路径：`docs/architecture/spec-driven-development.md`*
