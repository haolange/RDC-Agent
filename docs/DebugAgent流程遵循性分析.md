# Codex Debug 代理任务流程遵循性分析（供 Harness 设计）

## 1. 目的

本文不是重新分析 GPU 问题本身，而是把“最前面的代理任务”放回到新版《CodexDebug全流程演示-修正版》的流程框架里，逐项判断：

- 哪些环节实际上遵守了流程
- 哪些环节没有严格遵守
- 哪些偏差主要是 tool/runtime 能力问题
- 哪些偏差暴露出 harness 约束还不够硬

目标是让开发团队据此收紧 shared harness，使后续类似任务更早被约束、分流、阻断或规范化落证。

---

## 2. 对照基准

本次分析采用的流程基准来自新版演示文档，核心主线是：

```text
preflight
-> intent_gate
-> entry_gate
-> accept_intake
-> intake_gate
-> runtime_topology
-> dispatch_readiness
-> staged_handoff
-> fix_verification
-> skeptic
-> curator
-> final_audit
```

其中最关键的约束有四类：

1. 结构化 artifact 约束
   - `entry_gate.yaml`
   - `intake_gate.yaml`
   - `runtime_topology.yaml`
   - `fix_verification.yaml`
   - `action_chain.jsonl`
   - `session_evidence.yaml`
   - `skeptic_signoff.yaml`

2. 协调模型约束
   - `coordination_mode = staged_handoff`
   - `orchestration_mode = multi_agent`
   - `waiting_for_specialist_brief` 时主入口不能继续抢做 specialist live investigation

3. 证据链约束
   - live `rd.*` 工作要能在 `action_chain.jsonl` 中留下可核查的执行证据
   - workflow stage 必须与实际行为一致
   - topology 必须能被重算并一致复原

4. 结案约束
   - `fix_verification` 需要结构完整且结果明确
   - skeptic / curator 不能缺席
   - final audit 不只是“看报告是否写完”，而是看整个 run 是否形成可裁决真相链

---

## 3. 本次代理任务的实际观测摘要

从现有 artifacts 和 final audit 可还原出本次 run 的总体状态：

- 运行模式已经进入正式 case/run，且是 `cli + local`
- `runtime_topology.yaml` 记录为：
  - `coordination_mode: staged_handoff`
  - `orchestration_mode: multi_agent`
  - `workflow_stage: accepted_intake_initialized`
  - `delegation_status: none`
- `fix_verification.yaml` 已生成，但结论是：
  - `root_cause_identified_fix_not_strictly_verified`
  - `blocked_by_capability: true`
  - 阻断码为 `BLOCKED_SHADER_REPLACEMENT_OBSERVABILITY`
- `hypothesis_board.yaml` 仍保留未解决 blocker
- `action_chain.jsonl` 只有 intake gate pass 和 final audit fail 两类质量事件，没有 dispatch、tool_execution、skeptic、curator 等关键执行轨迹
- `final-audit` 的结果为失败，且失败项不是单点，而是多处流程闭环未成立

这说明本次 run 不是“完全乱做”，而是形成了一个“部分遵守、部分失真、最后靠 audit 才暴露问题”的状态。

---

## 4. 已遵守的流程环节

下面这些部分，基本符合新版流程文档要求。

### 4.1 缺 `.rdc` 时没有提前做假初始化

从本次任务的最终 case/run 形态看，case/run 的建立是建立在 capture 已经提供之后，而不是在缺少 `.rdc` 时就先写出 case 结构。

这与新版文档中的要求一致：

- 无 `.rdc` 时可以做 preflight / intent 判断
- 但不得提前进入正式 case/run 初始化

### 4.2 已形成 accepted intake 所需的基础真相对象

下列核心对象都已存在：

- `entry_gate.yaml`
- `case_input.yaml`
- `intake_gate.yaml`
- `runtime_topology.yaml`
- `capture_refs.yaml`

这说明流程并非绕开了 harness，而是确实经过了 accepted intake 初始化链路。

### 4.3 运行入口与 backend 选择符合主线

实际 run 走的是：

- `entry_mode: cli`
- `backend: local`

这与新版文档定义的 Codex 主线一致，没有把 remote/MCP 误写成当前执行真相。

### 4.4 问题定位与 fix verification 有结构化落点

虽然 fix 没有被严格验证通过，但以下动作是到位的：

- 根因已经被局部化到具体 event / material / shader
- `fix_verification.yaml` 已存在
- `report.md` 和 `visual_report.html` 已存在

这说明 run 至少没有停留在口头分析，而是有结构化验证与交付层产物。

### 4.5 最终确实触发了 final audit

这点很关键。很多流程偏差只有在 final audit 时才被显式暴露出来。当前 run 至少做到了：

- 没有把“报告写完”误当成“流程结束”
- 实际跑了 final audit
- audit 结果把缺失项明确打出来

这说明 shared harness 已经具备一定的兜底能力，只是兜底发生得偏晚。

---

## 5. 没有严格遵守的流程环节

下面这些偏差，才是开发团队应该重点用来设计更强 harness 控制的部分。

### 5.1 `multi_agent + staged_handoff` 被记录了，但没有真实发生 dispatch

流程要求：

- `coordination_mode = staged_handoff`
- `orchestration_mode = multi_agent`
- 进入该模式后，应该有 dispatch、brief、handoff、specialist 活动的证据链

实际现象：

- `runtime_topology.yaml` 明确写的是 `multi_agent`
- 但 `delegation_status = none`
- `action_chain.jsonl` 没有 dispatch event
- 没有 specialist-owned tool execution
- 没有 skeptic activity
- 没有 curator activity

判断：

这不是“只是少写了几条日志”，而是模式声明和真实执行脱节。

对 harness 的启示：

- 不能只让 `runtime_topology` 记录一个 target mode
- 必须校验“声明的模式”是否被实际执行证据支撑
- 否则 `multi_agent` 只是名义状态，不是可审计真相

### 5.2 workflow stage 没有跟着实际调查推进

流程要求：

- stage 应随着 run 推进而前进
- 不能长期停留在 `accepted_intake_initialized`，同时又已经完成根因分析、补丁实验和报告产出

实际现象：

- `runtime_topology.yaml` 中 `workflow_stage` 仍是 `accepted_intake_initialized`
- 但实际已经做了：
  - event 定位
  - shader 分析
  - replacement 实验
  - fix_verification
  - report/visual report 产出
  - final audit

判断：

这说明 stage machine 没有和真实执行链同步，导致“状态机真相”和“行为真相”出现断裂。

对 harness 的启示：

- 关键阶段切换不能只靠人工约定
- 应由 artifact 写入、tool_execution、dispatch/handoff 结果自动推进或强制校验

### 5.3 live 调查已经发生，但 `action_chain` 没有留下对应 tool execution 证据

流程要求：

- live `rd.*` 操作必须留下可核查证据
- action chain 不能只剩 gate 和 final audit

实际现象：

- 已经做了大量 live 调查与验证动作
- 但 `action_chain.jsonl` 统计结果里：
  - `tool_execution.total = 0`
  - 没有 live tool_execution evidence

判断：

这使得 harness 无法从行动账本重放“实际做过什么”，也无法对照 workflow_stage、context_binding、capture_ref、canonical_anchor_ref 是否一致。

对 harness 的启示：

- 需要把 live tool 调用写 action chain 做成默认强制行为，而不是依赖上层 agent 自觉补记

### 5.4 `runtime_topology` 与重算结果不一致

流程要求：

- `runtime_topology.yaml` 应是 run 当前拓扑的可重算真相对象

实际现象：

- final audit 明确报错：
  - `runtime_topology.context_bindings must match the recomputed topology`

判断：

这说明 topology 不是稳定真相快照，而更像“一次性写入后没有随着 run 演化更新”的静态记录。

对 harness 的启示：

- topology 不应只在 accept-intake 时落一次
- 关键 runtime 变更后需要重算、刷新或二次验证

### 5.5 `fix_verification.yaml` 已存在，但还不足以支撑 strict finalization

流程要求：

- `fix_verification.yaml` 不只是“有文件”
- 还必须结构完整，且结果能支撑是否可 finalize

实际现象：

- 文件存在
- 也明确记录了 blocked capability 和 semantic failure
- 但 final audit 仍判它 schema 不完整，缺少若干严格字段

判断：

这说明目前的 `fix_verification` 生成逻辑能表达结论，但还没完全满足 strict truth contract。

对 harness 的启示：

- 修复验证对象需要区分“可读报告结论”和“可审计 finalization 结构”
- 不能只追求内容上说清楚，必须保证 schema 完整

### 5.6 blocker 直到 final audit 才被正式拦住，拦截时机偏晚

流程要求：

- `hypothesis_board.yaml` 中有 unresolved `blocking_issues` 时，不应继续把流程当作可 finalize 状态推进

实际现象：

- `BLOCKED_SHADER_REPLACEMENT_OBSERVABILITY` 已经在 hypothesis board 中明确存在
- 但还是继续产生了报告、visual report，并走到了 final audit

判断：

这里不是说“报告不该写”，而是说 harness 没有在更早的阶段把 run 明确收口为：

- blocked validation
- strict finalization forbidden

对 harness 的启示：

- blocker 应尽早改变 workflow stage 和 finalization eligibility
- 不能把所有拦截都推迟到 final audit

### 5.7 skeptic / curator 缺失没有被更早暴露

流程要求：

- multi-agent 主线下，skeptic 与 curator 不应缺席

实际现象：

- 没有 `session_evidence.yaml`
- 没有 `skeptic_signoff.yaml`
- action chain 中没有 skeptic/curator activity

判断：

这说明当前 harness 更像是在最终合规检查时发现“收尾角色没来”，而不是在流程推进到相应阶段时就阻断。

对 harness 的启示：

- 需要把 skeptic-ready / curator-ready 变成前置 gate，而不是事后审计项

---

## 6. 哪些偏差是 tool/runtime 问题，哪些是 harness 控制缺口

为了便于开发团队分工，下面把偏差分成两类。

### 6.1 更偏向 tool/runtime 能力问题

#### A. Shader replacement 报 applied，但结果无可观察变化

这是 strict fix verification 失败的直接原因，更像 replay/runtime observability 问题，不是单纯流程纪律问题。

#### B. Preview 创建失败，但 preview 状态看起来又像已启用

这是工具状态机一致性问题，说明 observer surface 和真实窗口状态不同步。

#### C. 输出绑定、pixel readback、replacement 生效状态之间不完全一致

这会直接削弱验证层真相的可信度，也属于工具链可观测性问题。

### 6.2 更偏向 harness 控制缺口

#### A. 模式声明没有被执行证据约束

`multi_agent` 被允许成立，但没有 dispatch/specialist 证据。

#### B. workflow stage 没有被真实执行自动推进

导致 `accepted_intake_initialized` 与后续调查事实长期脱节。

#### C. live tool evidence 没有被强制写入 action chain

这会让审计知道“结果存在”，但不知道“过程是否合规”。

#### D. blocker 没有提前改变 finalization eligibility

直到 final audit 才失败，太晚。

#### E. strict verification schema 与报告型 verification 没被分层治理

结果是文件看起来“有了”，但 finalization 仍然不能用。

#### F. skeptic / curator 缺席只在最终审计才暴露

缺少阶段性硬门槛。

---

## 7. 面向开发团队的 Harness 设计建议

下面这些建议不是泛泛而谈，而是直接对应本次现象。

### 7.1 为模式声明增加“执行一致性检查”

建议：

- 当 `orchestration_mode = multi_agent` 时，进入 live investigation 前必须至少满足其一：
  - 已记录 dispatch event
  - 已建立 specialist handoff artifact
  - 或显式降级为 `single_agent_by_user` 并记录原因

如果三者都不满足，应阻断进入正式 live investigation。

### 7.2 把 workflow stage 推进改成“事件驱动 + 结构校验”

建议：

- `dispatch` 发生后自动推动到 `waiting_for_specialist_brief`
- brief 回收后自动推动到 `specialist_briefs_collected`
- 首次 live verification artifact 写入后自动推动到 `expert_investigation_complete` 或 `fix_verification_complete`
- 若 stage 与已有 artifacts/action_chain 矛盾，应立即产生 process deviation

### 7.3 对 live `rd.*` 调用增加强制 action_chain 包装

建议：

- 所有 live `rd.*` 工具调用，统一经过一个 action-chain wrapper
- wrapper 自动记录：
  - `event_type = tool_execution`
  - `context_id`
  - `runtime_owner`
  - `capture_ref`
  - `canonical_anchor_ref`
  - 调用结果与失败码

这样 final audit 就不必从“结果文件存在”倒推过程。

### 7.4 把 blocker 前移成“验证态 gate”

建议：

- 一旦 `hypothesis_board.blocking_issues` 非空，且 blocker 属于 verification-critical 类别，应自动切换 run 到：
  - `validation_blocked`
  - 或等价不可 finalize 状态

允许继续写报告，但必须把 run 标为“可交付说明，不可 strict finalize”。

### 7.5 区分“报告可读版 fix verification”和“strict finalization 版 fix verification”

建议：

- 让 `fix_verification.yaml` 分两层：
  - 面向人类的结论层
  - 面向 final audit 的严格 schema 层

如果只有结论层，没有严格层，harness 应在生成时就提示“不满足 strict finalization contract”，而不是等最终 audit 才发现。

### 7.6 为 topology 漂移增加自动重算与落盘保护

建议：

- 在以下事件后自动重算或验证 `runtime_topology`：
  - dispatch
  - context rebinding
  - capture/session 重新绑定
  - fallback execution mode 变化

如果发现 drift，应立即要求刷新 artifact，不能带着过期 topology 继续 run。

### 7.7 为 skeptic / curator 增加阶段 gate，而不是只做结案检查

建议：

- 没有 skeptic signoff，不允许进入 curator-ready
- 没有 curator 最终 artifact，不允许进入 finalized
- 如果 run 被声明为 multi-agent，skeptic/curator 缺席应尽早报错

### 7.8 为“工具能力阻断”引入统一的验证降级协议

建议：

- 当出现类似 `replacement reported applied but no visual delta` 这类 observability blocker 时：
  - 自动记录统一 blocker code
  - 自动把 semantic verification 置为 blocked/failed
  - 自动标记“strict fix verification unavailable”
  - 自动限制 finalization 路径

这样开发团队能把 tool bug 和流程偏差分开看，不会混成一个问题。

---

## 8. 结论

本次最前面的代理任务，不是“完全没有按流程来”，而是：

- intake 之前和 case/run 初始化这部分基本遵守了
- 根因定位、报告输出、fix_verification 也形成了结构化产物
- 但在进入 `staged_handoff + multi_agent` 之后，执行真相没有被 harness 严格收住

最典型的现象是：

- mode 写成了 multi-agent，但没有 dispatch
- 实际做了大量 live investigation，但 action chain 几乎没有过程证据
- blocker 已经成立，但直到 final audit 才集中暴露
- strict finalization 所需的 skeptic / curator / session_evidence 也没有在中途被硬性卡住

因此，这次 run 给开发团队最有价值的信号不是“某个 agent 没按要求写文件”，而是：

**shared harness 现在更像是“结尾审计器”，还不够像“过程控制器”。**

如果后续要把控制系统做得更细，优先级最高的不是再加几条文档说明，而是把以下三件事做成硬约束：

1. 声明的协调模式必须被执行证据支撑
2. live tool 调查必须自动进入 action chain
3. blocker 与 strict-finalization 资格必须在中途就收口，而不是留到 final audit 才发现

---

## 9. 附：本次分析直接参考的实际产物

以下文件用于支撑本次判断：

- `workspace/CodexDebug全流程演示-修正版.md`
- `workspace/cases/case_eye_lacrimal_white_spot_20260331/runs/run_001/artifacts/runtime_topology.yaml`
- `workspace/cases/case_eye_lacrimal_white_spot_20260331/runs/run_001/artifacts/fix_verification.yaml`
- `workspace/cases/case_eye_lacrimal_white_spot_20260331/runs/run_001/notes/hypothesis_board.yaml`
- `workspace/cases/case_eye_lacrimal_white_spot_20260331/runs/run_001/artifacts/run_compliance.yaml`
- `common/knowledge/library/sessions/sess_eye_lacrimal_white_spot_run001/action_chain.jsonl`
