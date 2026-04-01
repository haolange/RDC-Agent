# Codex Debug 全流程演示（当前仓库真相对齐版）

> 适用范围：
> - 当前文档描述的是 **Codex 平台下、local-first、CLI 入口** 的 `rdc-debugger` 主流程。
> - 本文以“用户一开始没有 `.rdc`，随后补齐 capture，再进入正式调试”为主线。
> - 本文以当前仓库中的 shared harness、workspace artifact、runtime owner 与 final audit 为准，不依赖宿主私有脚本或历史口径。
>
> 前提条件：
> - 平台根目录下的 `common/` 与 `tools/` 已正确覆盖。
> - `common/AGENT_CORE.md`、`tools/spec/tool_catalog.json`、`tools/rdx.bat` 均存在。
> - `python common/config/validate_binding.py --strict` 已通过，或至少能通过 shared preflight 验证。
> - 默认入口按当前平台矩阵走 **CLI**；对 Codex 来说，本地主路径是 local-first CLI。
> - Codex 的流程约束以以下真相对象为准：
>   - `common/config/platform_capabilities.json`
>   - `common/config/runtime_mode_truth.snapshot.json`
>   - `common/hooks/utils/harness_guard.py`
>   - `workspace/cases/<case_id>/artifacts/*.yaml`
>   - `common/knowledge/library/sessions/<session_id>/action_chain.jsonl`
>
> 关键纠正：
> - **当前仓库的正式共享 harness 入口不是** `.codex/runtime_guard.py`。
> - 当前正式入口应使用 `python common/hooks/utils/harness_guard.py ...`。
> - `tools/rdx.bat` 是终端用户默认入口；`tools/cli/run_cli.py` 与 `tools/mcp/run_mcp.py` 主要用于源码维护与排障。

---

## 1. 文档适用边界与核心概念

在当前仓库里，调试链的关键维度必须分开理解：

- `entry_mode`
  - `cli` 或 `mcp`
- `backend`
  - `local` 或 `remote`
- `coordination_mode`
  - `concurrent_team`、`staged_handoff`、`workflow_stage`
- `orchestration_mode`
  - `multi_agent` 或 `single_agent_by_user`

对 **Codex + local CLI** 这条主线来说：

- 平台默认入口是 `CLI`
- backend 走 `local`
- coordination mode 按当前平台矩阵是 `staged_handoff`
- orchestration mode 默认是 `multi_agent`

注意：

- `single_runtime_owner != single_agent_flow`
- `preview` 只属于人类观察面，不属于 gate truth
- `capture open` 只建立 tools-layer session state，**不等于** framework 已初始化 `case/run`

---

## 2. 用户第一次发起请求：只有粗略描述，没有 `.rdc`

### 用户

```text
帮我调试一下出现的 XXX 的 bug
```

### 正确行为

Codex 进入 `rdc-debugger` 后，可以先做：

1. preflight
2. intent gate
3. capture 缺失判定

但在没有任何可导入 `.rdc` 之前：

- 不得创建 `case_id`
- 不得创建 `run_id`
- 不得写 `case_input.yaml`
- 不得写 `hypothesis_board.yaml`
- 不得初始化 `workspace/cases/<case_id>/...`
- 不得进入 specialist dispatch
- 不得进入 live `rd.*`

### 推荐入口命令

```bash
python common/hooks/utils/harness_guard.py preflight
```

之后由 `rdc-debugger` 在当前会话中完成 `intent_gate` 判定。

### 结果

如果用户只是“帮我调试 bug”，而没有提供 `.rdc`：

- `intent_gate.decision = debugger` 可以成立
- 但整个流程必须停在：

```text
BLOCKED_MISSING_CAPTURE
```

### 此时给用户的回复示意

```text
当前采用 CLI 模式。

我可以按 RenderDoc/RDC 调试流程继续，但现在缺少必需的 `.rdc` capture。
当前状态：BLOCKED_MISSING_CAPTURE

请提供以下任一输入：
1. 在当前对话上传至少一份 `.rdc`
2. 或给我一个当前宿主可访问的 `.rdc` 文件路径

在收到 `.rdc` 之前，我不会初始化 case/run，也不会进入 specialist dispatch 或 live `rd.*` 分析。
```

### 此时状态应当是

- `preflight_pending` -> 已通过 preflight
- `intent_gate` -> 已完成并接受为 debugger
- `entry_gate` -> 未执行
- `intake_gate` -> 未执行
- `runtime_topology` -> 未生成
- `workspace/cases/` -> 不应有本次任务的 case/run 初始化产物

---

## 3. 用户补料：提供 `.rdc` 与最基本症状描述

### 用户

```text
我上传了 `broken.rdc`。
现象是角色头发区域会闪烁，切镜头后更明显。
目标是帮我定位根因，并判断修复后是不是真的好了。
这是本地问题，不走 remote。
```

### 正确推进顺序

在当前仓库里，推荐使用 **shared harness 的事务入口** 来完成 accepted intake，而不是手工拆成很多独立步骤作为唯一标准写法。

推荐命令：

```bash
python common/hooks/utils/harness_guard.py accept-intake ^
  --case-root workspace/cases/case_xxx_001 ^
  --platform codex ^
  --entry-mode cli ^
  --backend local ^
  --capture-path "D:\path\to\broken.rdc" ^
  --case-id case_xxx_001 ^
  --run-id run_001 ^
  --session-id sess_case_xxx_001_run_001 ^
  --user-goal "定位根因，并验证修复是否成立" ^
  --symptom-summary "角色头发区域闪烁，切镜头后更明显"
```

### `accept-intake` 实际做的事

这个事务入口会统一完成：

1. `entry_gate`
2. case/run bootstrap
3. capture 导入
4. `intake_gate`
5. `runtime_topology`

只有在 `entry_gate.status = passed` 之后，才允许真正初始化 case/run。

### 成功后应落出的核心产物

```text
workspace/cases/<case_id>/
  case.yaml
  artifacts/
    entry_gate.yaml
  case_input.yaml
  inputs/
    captures/
      manifest.yaml
      <capture>.rdc
    references/
      manifest.yaml
  runs/
    <run_id>/
      run.yaml
      capture_refs.yaml
      notes/
        hypothesis_board.yaml
      artifacts/
        intake_gate.yaml
        runtime_topology.yaml
```

这里要强调的不是某几个演示性 notes 文件，而是结构化真相对象：

- `entry_gate.yaml`
- `intake_gate.yaml`
- `runtime_topology.yaml`
- `case_input.yaml`
- `capture_refs.yaml`

这些对象共同决定后续流程能否继续推进。

---

## 4. accepted intake 之后，哪些条件必须满足才能正式进入调查

### 硬规则

- `entry_gate.yaml` 没通过：不得进入 accepted intake
- `intake_gate.yaml` 没通过：不得进入 specialist dispatch 或 live `rd.*`
- `runtime_topology.yaml` 没通过：不得进入 staged handoff
- dispatch 之前应确认 dispatch readiness 满足

### 推荐检查命令

```bash
python common/hooks/utils/harness_guard.py dispatch-readiness ^
  --run-root workspace/cases/case_xxx_001/runs/run_001 ^
  --platform codex
```

### 当前主流程状态机

当前仓库里的 workflow state machine 固定为：

1. `preflight_pending`
2. `intent_gate_passed`
3. `entry_gate_passed`
4. `accepted_intake_initialized`
5. `intake_gate_passed`
6. `waiting_for_specialist_brief`
7. `specialist_briefs_collected`
8. `expert_investigation_complete`
9. `fix_verification_complete`
10. `skeptic_ready`
11. `curator_ready`
12. `finalized`

注意：

- 阶段只能前进，不能跳级 finalize
- 每次阶段切换都必须记录到 `action_chain.jsonl`

---

## 5. Codex 下的 `staged_handoff` 到底是什么意思

`staged_handoff` 不是“主入口自己一边 orchestrate，一边继续抢做所有 specialist live 调查”。

它的正确定义是：

- 主入口 `rdc-debugger` 负责 gate、dispatch、阶段推进、timeout、redispatch 与最终裁决前置条件
- specialist 负责各自 write scope 内的调查和 brief 产出
- 主入口在 specialist 已 dispatch 后，会进入等待 brief / 汇总 brief 的阶段

### 默认 orchestration mode

对当前 Codex 主线，默认应理解为：

```text
orchestration_mode = multi_agent
```

只有用户显式要求不要 multi-agent context 时，才允许：

```text
single_agent_by_user
```

### 正确的 specialist 理解方式

文档里可以继续沿用以下角色作为演示，但要明确：

- 这些是 framework specialist 角色
- 具体宿主是否真的原生 team-agent 并发，不由这份文档假装扩展
- 对 Codex 而言，上层消费的是 `staged_handoff + puppet_sub_agents` 语义

示意角色可包括：

- `triage_agent`
- `capture_repro_agent`
- `pixel_forensics_agent`
- `shader_ir_agent`
- `pass_graph_pipeline_agent`
- `driver_device_agent`
- `skeptic_agent`
- `curator_agent`

---

## 6. `waiting_for_specialist_brief` 阶段主入口能做什么、不能做什么

一旦 specialist 已 dispatch，主入口会进入：

```text
workflow_stage = waiting_for_specialist_brief
```

### 允许做的事

- 读取 specialist brief
- 更新 `notes/hypothesis_board.yaml`
- 记录 blocker
- 做 timeout / redispatch 决策

### 禁止做的事

- 自己继续 live `rd.*` 调查
- 代替 specialist 补调查
- 抢写 specialist notes
- 抢跑 patch/debug

### 违反后会怎样

必须在 `action_chain.jsonl` 中记录：

- `event_type = process_deviation`
- `blocking_code = PROCESS_DEVIATION_MAIN_AGENT_OVERREACH`

这不是“建议遵守”，而是运行协调模型里的硬约束。

---

## 7. specialist 超时与 redispatch 的正确处理

如果 specialist 长时间没有回报，正确做法不是让 orchestrator 自己顶上去做 specialist 的 live investigation。

应使用 shared harness 的超时检查：

```bash
python common/hooks/utils/harness_guard.py specialist-feedback ^
  --run-root workspace/cases/case_xxx_001/runs/run_001
```

### 两种结果

#### 仍在预算内

- 继续等待
- 更新 `hypothesis_board.yaml`
- 不抢活

#### 超出预算

进入阻断，例如：

```text
BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT
```

此时正确行为：

- 进入 blocker 状态
- 向用户说明 specialist brief 超时
- 视情况 redispatch 或补料
- 但不让 orchestrator 静默接管 specialist live work

---

## 8. 结案门槛：不是写完 report 就算完成

当前仓库里，完整调试闭环的第一层真相对象至少包括：

- `entry_gate.yaml`
- `intake_gate.yaml`
- `runtime_topology.yaml`
- `fix_verification.yaml`
- `common/knowledge/library/sessions/<session_id>/action_chain.jsonl`
- `common/knowledge/library/sessions/<session_id>/session_evidence.yaml`
- `common/knowledge/library/sessions/<session_id>/skeptic_signoff.yaml`

### `fix_verification.yaml` 的角色

它是 run 级唯一修复验证真相对象，至少要表达：

- `verdict`
- `verification_mode`
- `verification_confidence`
- `blocked_by_capability`
- `blocked_capability_codes`
- `candidate_fix_prepared`
- `candidate_fix_live_applied`
- `candidate_fix_structurally_validated`
- `candidate_fix_semantically_validated`
- `structural_verification`
- `semantic_verification`
- `overall_result`

### 严格结案要求

- 无 `fix_verification.yaml`：不得进入 skeptic
- 无 skeptic strict signoff：不得进入 curator
- 无 curator 最终写入：不得视为 `finalized`

### 最终审计命令

```bash
python common/hooks/utils/harness_guard.py final-audit ^
  --run-root workspace/cases/case_xxx_001/runs/run_001 ^
  --platform codex
```

因此，报告文件只是对外交付层的一部分：

- `reports/report.md`
- `reports/visual_report.html`

它们不是第一层真相，也不能替代 gate / verification / signoff artifact。

---

## 9. 当前仓库里的正式入口命令清单

### 9.1 终端用户默认入口

```bat
tools\rdx.bat
tools\rdx.bat --non-interactive cli --help
tools\rdx.bat --non-interactive mcp --ensure-env
```

### 9.2 Shared harness / framework gate 入口

```bash
python common/hooks/utils/harness_guard.py preflight
python common/hooks/utils/harness_guard.py entry-gate ...
python common/hooks/utils/harness_guard.py accept-intake ...
python common/hooks/utils/harness_guard.py intake-gate ...
python common/hooks/utils/harness_guard.py runtime-topology ...
python common/hooks/utils/harness_guard.py dispatch-readiness ...
python common/hooks/utils/harness_guard.py specialist-feedback ...
python common/hooks/utils/harness_guard.py final-audit ...
```

### 9.3 源码维护 / 排障入口

这些入口仍存在，但不应写成终端用户默认主路径：

```bash
python tools/cli/run_cli.py --help
python tools/mcp/run_mcp.py --help
```

---

## 10. 常见误区更正

### 误区 1：`.codex/runtime_guard.py` 是正式规范入口

错误。

当前仓库的正式共享 harness 入口应以：

```bash
python common/hooks/utils/harness_guard.py ...
```

为准。

### 误区 2：`CLI` 是工具规范源

错误。

工具规范源优先级是：

1. `spec/tool_catalog.json` 与共享响应契约
2. runtime 实际行为
3. `CLI` convenience wrapper

### 误区 3：preview 是 gate truth

错误。

- `rd.session.get_context.preview` 只属于 human observer surface
- preview 不进入 gate / verification / finalization 的真相裁决链

### 误区 4：`capture open` 就等于 framework 已初始化 case/run

错误。

- `capture open` 只建立 tools-layer session state
- framework 的 `case/run` 初始化必须经过 accepted intake 流程

### 误区 5：specialist brief 必须固定写成某几个 `notes/*.md`

不准确。

当前仓库强调的是：

- specialist brief 应写入 `runs/<run_id>/notes/**`
- 关键真相对象应以结构化 artifact 为准

因此，文档可以示意 `notes/triage.md`、`notes/shader_ir.md` 等文件，但不应把它们写成框架唯一规范。

---

## 11. 本文适用边界

本文只覆盖：

- Codex 平台
- local-first
- CLI 主线
- `rdc-debugger` 公共入口

本文不把以下路径作为主线展开：

- remote backend
- MCP-only 宿主路径
- `single_agent_by_user`

这些路径可以在附录中补充，但不应混入当前主流程说明，否则会把平台真相、框架策略和宿主差异搅在一起。

---

## 12. 一句话总结

如果要把这份流程文档写成“当前仓库可交付、可审计、可给开发团队直接参考”的版本，核心不是多写几个 specialist 名字，而是始终围绕下面这条主线：

```text
preflight -> intent_gate -> entry_gate -> accept_intake -> intake_gate -> runtime_topology -> dispatch_readiness -> staged_handoff -> fix_verification -> skeptic -> curator -> final_audit
```

并且所有命令入口、artifact 名称与状态机都必须以当前仓库中的 shared harness 和 truth store contract 为准。
