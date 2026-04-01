**RenderDoc 垂直 Agent 框架设计参考文档**

**版本**：1.0（基于 2026 年 4 月仓库真相对齐版流程文档）  
**目的**：本文档整合最新《全流程演示》及《流程遵循性分析》，结合前期讨论中的流程线性问题、回转链路缺失、session 管理约束、debug 代理边界以及修复结果参照要求，为团队提供清晰的现状分析与自研垂直 Agent 改进路径。文档旨在引导开发团队以第一性原理（调试本质为证据链闭环 + 可审计状态机）推进框架演进，确保后续实现严格遵守率、生产级鲁棒性与适应性。

### 一、最新流程核心梳理（仓库真相对齐版）

当前仓库以 **Codex + local-first + CLI** 为主线，采用 `shared harness`（`common/hooks/utils/harness_guard.py`）作为唯一事务入口。流程强调**产物驱动 + 硬约束 + staged_handoff** 协调模型，核心主线如下：

1. **入口阶段**：preflight → intent_gate。若无 `.rdc`，直接进入 BLOCKED_MISSING_CAPTURE，不创建 case/run 或任何产物。
2. **初始化阶段**：用户补交 `.rdc` 后，执行 `accept-intake`（统一完成 entry_gate、case/run bootstrap、capture 导入、intake_gate、runtime_topology）。仅 entry_gate 状态为 passed 后，方允许初始化 workspace/case/run 结构。
3. **调查阶段**：dispatch-readiness → staged_handoff（orchestration_mode 默认 multi_agent）。主入口负责 dispatch 与阶段推进，specialist 仅在 waiting_for_specialist_brief 阶段产出 brief。
4. **收敛阶段**：specialist_briefs_collected → expert_investigation_complete → fix_verification_complete → skeptic_ready → curator_ready。
5. **结案阶段**：final-audit（必须检查 entry_gate.yaml、intake_gate.yaml、runtime_topology.yaml、fix_verification.yaml、action_chain.jsonl、session_evidence.yaml、skeptic_signoff.yaml 等核心 artifact）。无 strict finalization 资格者不得 finalized。

关键约束：

- coordination_mode = staged_handoff（主入口禁止越权 live rd.*）。
- workflow_stage 必须事件驱动推进，并与 action_chain.jsonl 一致。
- session 管理：capture open 仅建立 tools-layer state，framework case/run 必须经 accepted intake。
- 产物优先级：结构化 artifact（yaml/jsonl）高于报告文件（report.md / visual_report.html）。

### 二、当前通用 Agent（Codex）在流程中的困惑与偏差分析

前期讨论已指出通用 Agent 在严格流程下的典型痛点（线性主路径缺乏回转、multi-agent session 约束、debug 代理边界模糊、主观 bug 验证依赖用户描述、entry_gate 缺少修复参照）。本次遵循性分析进一步验证了这些困惑在实际 run 中的表现：

1. **流程线性与回转链路缺失**：主路径为单向 staged_handoff，无显式 triage/orchestrator 反馈循环或 specialist 多轮 skeptic 仲裁。triage 建议无效时无法回溯；specialist 超时仅依赖 specialist-feedback 阻断，但 orchestrator 易静默接管，导致 overreach。
2. **multi-agent 与 session 管理约束**：orchestration_mode 记录为 multi_agent，但 delegation_status = none，无 dispatch/specialist handoff 证据。rdc tool single-context 特性导致 live rd.* 无法并行，实际执行仍为串行；软件重启后新 context_id 为预期行为，但跨 run 状态恢复依赖外部 harness，无框架级 run 结束标志与历史知识召回机制。
3. **debug 代理边界模糊**：Agent 能可靠处理客观 bug（NaN、像素 delta），但主观 bug（如 IK 模型变形、头发闪烁主观感受）缺乏量化 ground truth。fix_verification.yaml 虽存在，却因 schema 不完整或 blocked_by_capability（如 BLOCKED_SHADER_REPLACEMENT_OBSERVABILITY）无法 strict finalize。
4. **修复结果参照缺失**：entry_gate/intake_gate 未强制要求 fix_reference（文字描述 + 对比图 / baseline .rdc），导致后续 verification 无法定义“正常”。
5. **harness 控制强度不足**（本次分析核心偏差）：
   - 模式声明与执行脱节：multi_agent 仅名义存在，无 action_chain 支撑。
   - workflow_stage 漂移：停留在 accepted_intake_initialized，却已完成 live 调查与报告。
   - live rd.* 证据缺失：tool_execution 未强制写入 action_chain.jsonl。
   - blocker 前移不足：hypothesis_board 中 blocker 直到 final-audit 才暴露。
   - skeptic/curator 缺席：无阶段性 gate，仅事后审计。
   - topology 一致性问题：runtime_topology.yaml 与重算结果不匹配。

总体困惑总结：通用 Agent 在 harness 约束偏“事后审计”而非“过程控制器”的情况下，遵守率低（本次 run 仅部分 intake 环节达标），导致“声明的协调模式”与“真实执行真相”断裂。根因在于流程设计对 LLM 局部决策的依赖过高，而非将约束下沉至共享 harness。

### 三、自研垂直 Agent 的改进想法

为解决上述困惑，自研垂直 Agent 应以“证据链闭环 + harness 铁血控制”为核心目标，构建比当前仓库更严格、更具适应性的框架。以下建议基于第一性原理（调试 = 可验证状态机 + 受控回转），提供可执行路径：

1. **强化 entry_gate 与修复参照前置**  
   扩展 accept-intake 为硬 gate：必须提供 fix_reference（文字 + 多模态对比 / baseline .rdc / 量化阈值）。缺少时直接 BLOCKED_MISSING_FIX_REFERENCE，并向用户索要。  
   **可执行步骤**：在 case_input.yaml 中新增 fix_reference schema；harness_guard.py 新增 --require-fix-ref 参数；后续 fix_verification.yaml 直接引用该参照作为 semantic_verification ground truth。

2. **引入受控回转链路**  
   将 staged_handoff 升级为带条件分支的闭环：triage 后增加 orchestrator 置信度校验（< 0.6 触发 ask_user 或 self_heuristic）；specialist 阶段支持多轮 skeptic 仲裁（每轮 confidence < 阈值则 continue_explore）；全局 blocker 触发 validation_blocked 状态。  
   **可执行步骤**：定义 workflow_stage 扩展集（含 backtrack_to_orchestrator）；harness_guard.py 新增 specialist-feedback 与 redispatch 子命令；action_chain.jsonl 强制记录每一次 stage 切换事件。

3. **优化 multi-agent session 与证据链**  
   明确 run 为独立 session 单元；reopen 后新 context_id 视为正常，框架提供 run 结束标志与历史知识召回接口。所有 live rd.* 必须经 wrapper 强制写入 action_chain.jsonl（含 context_id、runtime_owner、capture_ref）。  
   **可执行步骤**：在 runtime_topology.yaml 中增加 delegation_status 校验逻辑；harness_guard.py 为 tool_execution 增加 action-chain 自动包装；新增 session_evidence.yaml 作为 skeptic 前置输入。

4. **明确 debug 代理边界与 fix_verification 分层**  
   客观 bug 走自动化路径（rdc tool 多模态 check）；主观 bug 强制 human-in-the-loop。fix_verification.yaml 分“报告可读层”与“strict finalization 层”（schema 完整校验）。  
   **可执行步骤**：在 fix_verification.yaml 中新增 verification_mode（objective/subjective）字段；harness_guard.py final-audit 时强制检查 strict 层；为主观 bug 增加 interrupt 级 human_review 节点。

5. **提升 curator 与知识沉淀可控性**  
   curator_agent 拆为两阶段：第一阶段 SOP/BugCard semantic diff 维护（避免启发式污染）；第二阶段基于固定模板生成报告。  
   **可执行步骤**：新增 SOP 库 diff 校验协议；curator-ready 前置 skeptic_signoff gate；定期 batch review 子流程（每 N run 触发）。

6. **整体 harness 控制前移**  
   将当前“结尾审计”升级为“过程控制器”：模式声明必须有执行证据支撑；blocker 自动改变 finalization eligibility；topology 关键事件后自动重算。  
   **可执行步骤**：harness_guard.py 新增 dispatch-consistency 与 stage-consistency 子命令；final-audit 前置所有 gate 校验；action_chain.jsonl 作为唯一过程真相来源。

**实施优先级建议**：先落地 1、3、6（入口参照 + 证据链 + harness 前移），可使遵守率从当前 ~20% 快速提升至生产可用；后续迭代 2、4、5 以增强适应性。团队可据此制定迭代计划，每轮 run 后复盘遵循性分析，确保自研框架真正解决通用 Agent 的本质局限。

本文档可作为团队内部参考基准。如需针对特定模块细化 schema 或 gate 规则，请直接反馈，我将进一步完善。
