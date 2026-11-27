---
name: investigation-planning
description: Turn a short symptom into a plan the user can read and General can execute, then evaluate the delivered result when the user returns.
audience:
  - debugger
  - analyzer
  - optimizer
---

# 调查规划

Debugger、Analyzer、Optimizer 三个 Mission 共用这份方法：把用户的一句话变成一份计划，用户读正文就明白打算怎么查，General 从附录和结构化字段拿到执行所需的全部引用；用户切回来时，评估 General 交付的结果。领域策略看各自的 coordinator。

## 先弄清要查什么

1. 先读能读到的材料：`runtime_context`、对已打开 capture 的只读探测、用户附件。
2. 目标仍模糊时，用 `ask_user` 问少量、渐进、不带诱导的问题：期望是什么、哪块区域、有没有参考、影响范围、查到什么程度算完成。允许用户答不知道、跳过或自由补充；不让用户诊断原因。
3. 用户说的、工具看到的、你推测的分开记。回答写进计划的目标、范围和完成标准；回答澄清不等于批准修改。
4. 计划修订会影响已有 Task 时，先取消并 join 旧执行，再修订和重新委派。

## 查历史知识

提交计划前，用症状、capture 范围和可见事件做一次有界的 Knowledge 检索。多词查询要求词项共同匹配，没有命中就拆成对象、症状或领域概念的短查询再试。读命中的来源、适用设备与渲染路径、反例和冲突；查不到就如实记下，不当成用户输入不足。历史案例只提供待核对的解释和区分检查，不是当前 capture 的观察或原因。检索复杂时委派 knowledge-scout。

## 计划怎么写

计划先给用户读。正文用对象的名字说话：哪个 pass、哪张贴图、哪个 draw，事件编号可以写。`session://` 路径、记录或 Task 编号、哈希和内部字段名放进结构化字段或末尾的执行引用；写进正文的计划会被主进程退回。

```
# 一句话说清要查什么
## 要解决的问题        用户原话；我们的理解；调查类型；查到什么程度算完成
## 已经知道的          已确认的事实；目标对象定位到哪一步、依据是什么（用户确认、两条路径互相印证或仅候选）；可用的 capture 和设备；历史案例及其在这里的适用程度
## 打算怎么查          候选解释对照表（解释｜成立时会看到什么｜用什么检查区分）；最先做的三到六项检查，按顺序写，注明依赖、要委派的分析和要独立审查的主张
## 可能需要你参与的地方  要用户回答的问题；需要用户批准的实验类型
## 什么时候停，交付什么  完成条件；停止条件；当前能力的上限；已知风险；哪些发现说明方向错了、需要回到规划
## Execution references  结构化字段放不下、执行方又需要的引用：Knowledge 来源、工具结果、锚点记录、Checkpoint
```

按规模取舍，某段不适用就写一句原因。执行引用必须是最后一节。修订后的正文完整自足，不写"其余同上一版"；计划新增的硬前置必须有执行侧读得到的来源，读不到就在计划门修正，不猜值。

结构化字段：

- 本回合建了未完成的 Task：填 `requiredTaskIds`，确无必需 Task 填 `[]`。正文里写 Task 名称不会冻结要求。
- 要用实时回放：填 `captureScope`（已登记的 `inputIds`、当前 `deviceId` 和调查目标，取自 `runtime_context.capturePlanning`）。临时切换事件并在结束时恢复入口位置属于导航，不需另批。
- 要做可逆干预：在 `authorizations` 逐项写操作、目标、效果、可逆性和被授权的修改次数；用户批准的就是这份清单，没写的干预不做。
- 已批准的 Task 定义或用户限制需要变更：经 `plan_artifact.taskRevisions` 正常修订，不静默删除。

额度权威在 Harness：请求上限见 `runtime:execution-limits`，Task root 与 Capsule 的工具数、子执行数和期限由主进程冻结执行，实际消费与余量读 `task_get.budgetSnapshot`／`requestUsage`。计划只引用这些真实限制和用户明确规定的限制，可以给可调整的估算，但不自编阶段配额，也不把估算写成停止条件。

## 提交

提交前写一份可解析的 Checkpoint。用 `plan_artifact` 提交，被拒绝就按意见修订同一份。批准后本回合结束；用户点执行按钮后由 General 执行。

## 用户切回后

读本周期的产物，用 $skeptic-review 和 $report-composition 评估证据、未解 Challenge、反证与限制，写 `kind=report` 的报告。记录和 schema 读过一次就直接 `investigation_write`，不反复列举同一批未变的记录。证据只支持部分结果时写草稿报告并声明 `partial`。需要换战略时在终答写清缺口和依据，由用户决定是否重新规划。

普通回复（澄清、说明下一步）不会完成调查或 Task。等待、部分交付或阻塞用 `turn_complete` 声明 `partial`／`blocked` 并列出未解项；报告满足合同时才声明 `completed` 并引用报告。内部门禁和租约术语不交给用户。
