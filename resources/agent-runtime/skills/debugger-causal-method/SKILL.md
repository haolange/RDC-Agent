---
name: debugger-causal-method
description: Write Debugger First Bad Event, Hypothesis Matrix, and Counterfactual records on existing rdc.investigation.v1 kinds.
---

# Debugger Causal Method

Debugger 执行时用这份方法把三件事写进调查记录：首次异常在哪（First Bad Event）、有哪些可区分的解释（Hypothesis Matrix）、哪项可恢复的实验证明了因果（Counterfactual）。只用现有的 `rdc.investigation.v1` kind，不造新 kind。

## First Bad Event

形状：一条 Evidence（`kind: evidence`）加一条配套的 `observed_fact` Claim。

1. 用同一 capture 里的目标区与控制区、以及更早的写入，找到最早出现症状的区域；没有参考图也可以做。记录外观和覆盖范围，不预设什么是正确的。
2. 观察取自 $rdc-tool-shell、$pixel-forensics 和 $capture-facts。解释逐片元数值或测试标志前先读 $pixel-forensics：原生历史可能是重建的，也可能受格式限制。
3. 先持久化与观察状态相符的 WorldState，再写 Evidence（依赖顺序见 $artifact-provenance）；原始观察可以先采集，但不把新观察挂到历史 WorldState 上凑引用。Evidence 写 `mission: debugger`、`epistemicStatus: observed`、`region.kind` 取 `event` 或 `pixel`、`artifactRefs` 带实际内容 hash、`worldStateId` 可解析。未知的字段如实留空。
4. 配套 Claim 可以在 `scope.eventId` 里重复事件号，保持 `observed_fact`，不设 `declaresCounterfactual`，不带因果的 `experimentId`。

## Hypothesis Matrix

形状：一个 ClaimSet（`kind: claim_set`），成员是相互竞争的 `hypothesis` Claim。

1. 先看计划里的有界 Knowledge 检索；没做或条件过窄，就用对象、症状或领域概念的短词分别再查，读相关命中，或记下空结果。把线索转成可检验的特征，写明适用条件在这里哪些已匹配、未知或不符；线索不是当前证据。
2. 每个解释是 `claimKind: hypothesis`、`epistemic: inferred`、`experimentId: null`、`scope` 非空的 Claim，用 `supports`／`contradicts` 连起来。有证据支撑、彼此可区分的替代解释在检查之前保持可见；证据已排除其余解释时一个就够。不凭空加"驱动有问题"这类解释。
3. 写出最小的区分检查，以及支持与否定各自预测的读数。干预或匹配的追踪不可用时，先查每条路径必需的绑定和参数再决定暂缓：观察到某个前提被关闭，可以排除那条路径；开着不证明它有贡献。符合预测只算支持；读数区分不了各行时保留不确定。区分检查成为一个 Task 的主题，不写进矩阵。

矩阵里的行不在这里升级为 `causal_conclusion`。

## Counterfactual

形状：一条合格的 Experiment，加一条 `causal_conclusion`（或 `declaresCounterfactual: true`）的 Claim。

1. 针对已持久化的矩阵行（`hypothesisClaimId`）设计实验，`intervention.type` 不能是 `none`。持久化设计前，所需的 WorldState 引用都要能解析；将来的 variant／restored 锚点如实标为未测量。
2. 经配置的 RDC-Tool CLI 执行干预，记录指标和前后对比图。
3. Rollback 写 `executed === true`、`baselineRestored === true`，`verifyEvidenceIds` 至少一条且可解析；状态为 `recorded` 或 `rolled_back`。
4. 然后写引用该 `experimentId` 的因果 Claim。根因 Claim 填七元组 `rootCause`：Trigger、Fault Location、Failure Mechanism、Propagation、Manifestation、Scope、Counterfactual Evidence。
5. 因果成立后，原因若指向一个可以直接读到的输入（一张贴图、一个常量），读出它并把读数写进结论。

`S-CAUSAL-01` 与 `S-RDC-01` 由机器检查：没有合格实验的 Claim 不能 ready。不写 Knowledge，不调用 `memory_write`。
