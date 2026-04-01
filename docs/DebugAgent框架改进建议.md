

我将基于第一性原理，从整体架构出发，系统性还原当前流程的核心逻辑、各 Agent 角色、关键设计约束，并针对您提出的线性流程、回转链路、session 管理、debug 代理边界以及修复结果参照等问题，给出可操作的改进建议。整个分析聚焦于流程设计层面，旨在提升该垂直 Agent 的严格性、可预测性和鲁棒性。

### 一、当前流程总体理解

该流程设计的核心理念是将 RenderDoc 调试过程构建为一个**严格分阶段、可审计的 staged handoff 流水线**。它将通用 Agent 的不确定性问题（例如 Codex 遵守率仅 20%）转化为工程级约束：Orchestrator（主入口 rdc-debugger）仅负责协调与守卫，绝不越权执行 specialist 的定向调查；所有动作均需通过 runtime_guard.py 校验并产出显式文件证据（yaml、md、artifacts）。流程强调“前置阻断 + 产物驱动 + 最终合规审计”，确保每一步都有可追溯的硬约束。

流程本质上是一条**线性主路径 + 有限 blocker/redispatch 接口**：

- 用户输入 → 入口校验 → 资源初始化 → 分派调查 → 收敛审计 → 结束。
- 整个过程以 workspace/ 目录下的文件（case.yaml、run.yaml、notes/*.md、artifacts/*.yaml）作为唯一真相来源。
- 多 Agent 协作采用**串行化并发**模式（single rdc context 约束下），session 管理由外部 harness 负责，而非 Agent 内部。

### 二、流程阶段详细梳理

1. **入口阶段（无 .rdc 或输入不完整时）**  
   声明 CLI 模式 → preflight → intent_gate。  
   若缺少 .rdc，则直接进入 BLOCKED_MISSING_CAPTURE 状态，不创建任何 case/run 或产物文件。仅向用户索要 .rdc 路径或上传文件。

2. **初始化阶段（用户补交 .rdc 后）**  
   entry_gate（case 级）→ case/run 初始化 + capture import → intake_gate（run 级）→ runtime_topology → dispatch-readiness。  
   每步必须通过 guard 并写入对应 artifacts/ 文件，否则阻断后续动作。

3. **调查阶段（staged handoff）**  
   triage_agent + capture_repro_agent → specialist dispatch（pixel_forensics_agent、shader_ir_agent、pass_graph_pipeline_agent 等）→ waiting_for_specialist_brief。  
   主入口在此阶段**禁止**自行执行 live rd.* 调查，仅汇总 brief 并更新 hypothesis_board.yaml。

4. **收敛与审计阶段**  
   specialist brief 回流 → skeptic_agent（证据链质疑）→ curator_agent（报告产出 + 知识沉淀）→ final-audit（run_compliance_audit）。  
   仅当 run_compliance.yaml 通过后，才视为完整结束。

5. **session 与多轮分析约束**  
   rdc tool 采用 single-context 模型（session_id / context_id / remote_id）。多轮分析（multi-turn）仅发生在同一 run 内部，通过 shared 状态（hypothesis_board、action_chain）维系；跨 run（软件重启后）视为新对话，新 session ID 为预期行为，无需跨对话一致性。

6. **debug 代理边界**  
   Agent 仅能可靠代理**客观、可多模态量化验证**的 bug（例如精度 NaN、像素 delta、event timeline）。主观 bug（例如 IK 模型变形、头发闪烁的主观感受）需依赖用户定义的“正常”标准，否则 fix_verification 无法闭环。

### 三、主要 Agent 角色

- **rdc-debugger（Orchestrator，主入口）**：流程总指挥与守卫者。负责 gates 执行、staged handoff 协调、hypothesis_board 维护及最终审计。严格禁止越权执行 specialist 工作。
- **triage_agent**：症状分类与路由建议器。基于用户描述、.rdc 上下文及知识库，输出 candidate_bug_refs 和 recommended_investigation_paths，但不拍板根因。
- **capture_repro_agent**：Capture 质量检验员。验证当前 .rdc 是否足以稳定复现，并指出是否需补充 baseline 或 second capture。
- **Specialists（pixel_forensics_agent、shader_ir_agent、pass_graph_pipeline_agent 等）**：定向调查专家。分别聚焦像素证据、shader IR/精度、pass graph 依赖等，仅在 waiting_for_specialist_brief 阶段执行单次 brief 产出。
- **skeptic_agent**：证据链质疑者。在 specialist 调查后，验证 counterfactual 与 causal anchor 的充分性。
- **curator_agent**：报告官与知识沉淀官。在 skeptic signoff 后，生成最终报告，并判断是否需更新 BugCard、BugFull 或 SOP。

### 四、改进建议

当前流程在严格性和可审计性上已具备较高成熟度，但线性特征明显，面对“triage 建议无效”、“specialist 长时间无进展”或“主观 bug 定义模糊”等场景时，鲁棒性仍有提升空间。以下建议基于第一性原理（“bug 调试本质是证据链 + 验证闭环”），聚焦流程设计优化，不改变现有 guard 机制与产物驱动原则：

1. **引入 triage → orchestrator 的显式反馈循环**  
   在 triage 后增加条件分支：若 orchestrator 根据 hypothesis_board 判断 recommended_investigation_paths 置信度不足（例如 < 0.6），则可回退至“ask_user”或“self_heuristic”状态，要求用户补充描述或 orchestrator 基于历史 SOP 库进行启发式路径生成。避免单向建议导致后续卡死。

2. **强化 specialist 的多轮调查与回溯机制**  
   将 specialist 阶段设计为带仲裁的循环路径：每轮调查后必须经过 skeptic_agent 打分。若 confidence < 阈值或 evidence_chain 不闭合，则允许继续探索（最多 N 轮）。若连续失败，则触发回溯至 orchestrator，重新评估 triage 方向或请求新 capture。这样可避免“一直失败却无法回溯”的线性死角。

3. **在 entry_gate / intake_gate 强制要求修复结果参照**  
   明确将 fix_reference 作为 gate 通过的硬性前置条件（文字描述 + 修复前后对比图 / baseline .rdc / 量化阈值）。这能为后续 fix_verification 提供客观 ground truth，尤其适用于主观 bug（例如“模型变形恢复自然”或“头发不再闪烁”）。缺少参照时，直接进入 BLOCKED_MISSING_FIX_REFERENCE 状态，并向用户索要。

4. **优化 curator_agent 为两阶段独立子流程**  
   
   - 第一阶段：SOP/BugCard 维护。从全部探索路径中提炼最高效路径，通过与现有知识库的 semantic diff 进行增删改，避免 LLM 直接启发式生成导致知识库污染。  
   - 第二阶段：报告生成。基于真实根因 + 全过程 evidence（文本、截图），使用固定模板产出面向开发者的详细 MD 报告（含证据时间线、视觉对比）和面向领导的归因摘要。建议在流程中增加模板校验环节，确保报告结构一致性与可读性。

5. **session 管理与软件重启恢复的流程化处理**  
   明确定义：每个 run 为独立 session；reopen 后生成新 context_id 属于正常行为，无需跨对话 ID 一致性。多轮分析仅在同一 run 的 shared 状态内进行。建议在流程文档中增加“run 结束标志”与“历史 run 知识召回”机制，便于新 run 复用 prior evidence，而不依赖旧 session ID。

6. **SOP 匹配与提供权的明确分工**  
   推荐由 orchestrator 最终负责 SOP 匹配（triage 仅提供 hints），匹配失败时触发 orchestrator 的 heuristic 子流程（基于梯度下降式最可能原因）。这能降低 triage hallucination 风险，同时保持 SOP 库的迭代可控性。

7. **整体鲁棒性提升**  
   
   - 增加全局 timeout 与 blocker 状态的标准化处理：specialist 反馈超时 → 自动进入 blocker 并通知用户，而非静默继续。  
   - 为客观 bug 增加自动化验证路径（rdc tool 多模态 check），为主观 bug 增加强制 human-in-the-loop 节点。  
   - 定期（每 N 个 run 后）触发知识库 batch review 子流程，确保 SOP/BugCard 随使用而持续精炼。

这些改进可使流程从“严格线性”升级为“带受控回转的闭环系统”，在不牺牲遵守率的前提下显著提升问题解决率与适应性。如果您需要进一步细化某一阶段的 gate 规则、Agent 边界定义，或针对特定 bug 类型（如精度 vs IK 变形）的验证标准，我可以继续深入讨论。
