---
name: report-composition
description: Compose an Investigation report as a View that must not raise Claim rank or rewrite measured facts.
---

# Report Composition

写调查报告时用这份方法。报告是调查记录的一个视图（kind 为 `report`），不是新的事实来源：它投影已有的 Claim、Evidence、Experiment 和 Challenge，不改数值、范围、验证等级和结论。

## 结论怎样写

报告和终答都按同一顺序：

1. **结论**（`reportContract.conclusion`）：第一句写证据支持的最强结论，后面跟一个等级标签，取自结论所依 Claim 的 `verification`：`[Observed]`、`[Reconstructed]`、`[Differential-Supported]`、`[Replay-Counterfactual]`；未经验证的陈述标 `[Inferred]` 或 `[Unresolved]`。实验合格（定义见 $debugger-causal-method）时，结论写成因果，不加"支持""可能"之类的限定。一条结论一个标签，正文不再重复限定语。
2. **证据**（`evidence`）与**验证覆盖**（`verification`）：关键读数、实验前后、独立审查读过什么。
3. **未知项与未覆盖的范围**（`limitations`）：单独成段。审查结果里标 `not_required` 的备注放在这里，不改结论措辞。

证据只够差分支持时，结论就写到差分支持并标 `[Differential-Supported]`；没有实验支持的结论不写成因果。

## 写作步骤

1. 读一次 report schema，以及本周期已经确定的相关记录。不另造替代记录，不反复列举同一批未变的记录。
2. Claim 存在当前 ClaimSet 的 `items` 里；`investigation_list(kind=claim)` 只列独立的 Claim，结果为空不代表 ClaimSet 没有 Claim。读当前 ClaimSet，投影相关成员，不复制成独立 Claim。
3. 每条投影带非空的 `compactProvenance`，来源的 `claimId`、`epistemic`、`verification` 逐字一致，投影的认识等级不高于来源中最低的一条（`S-CLAIM-01`，`report-contract` hook 会检查）。版式只改布局、字体、图示和叙述。
4. 用 `investigation_write` 写 `kind=report`。发布 ready 报告时 `reportContract` 带齐 `conclusion`、`evidence`、`verification`、`limitations`、`status`（只能是 `verified`／`conclusive`／`complete`）、`links`、`artifactIds`（非空）和 `candidateStatus`（`none`／`session-created`／`not-requested`）。
5. 在 `turn_complete.evidenceRefs` 里写当前 ready 报告的 `contentUri` 和 `contentHash`；终答给用户可访问的报告链接和结论，内部编号和哈希不必写进正文。终检判定声明无效时，按反馈修正后再次声明。

调查是 partial、inconclusive 或 blocked 时，报告保持 `draft`，写清缺的是哪项验证，声明 `partial` 或 `blocked`。写入失败时读错误和相关 schema，不重复同一组读取。

通用章节：Goal、Input、Environment、Capability、Plan、Task Timeline、Evidence、Claims、Experiments、Challenges、Limitations、Artifact Index。只有本回合确实创建了 Session Candidate 才提它；用户没有要求时不创建 Knowledge Candidate。

## 各 Mission 的章节

通过已有的 Claim、Evidence、Experiment 编号投影，不加报告专用字段或新 kind。

- **Debugger**：症状（预期与实际、复现）；First Bad Event（$debugger-causal-method 写的 `observed_fact` 与 Evidence）；Root Cause（被接受的因果 Claim 上的七元组）；Counterfactual（合格的 Experiment 与对应 Claim）；修复方向，只有打过补丁且验证了恢复结果才写已执行，否则写未执行。
- **Analyzer**：Observed Model、Resource Versioning、Pass Reconstruction、Shader Fingerprint／Block、Traceability、Architecture Model 版本（当前与被替代的）、Unknown Frontier。Observed／Reconstructed／Authoring 沿用来源 `claimKind`，不在报告里抬层。
- **Optimizer**：Baseline 与 Noise Floor、Frame Breakdown、Cost／Limiter／Mechanism、实验类别（Ablation／Equivalent／Trade-off）与 A-B-A 结果、视觉与数值回归、不能回退的约束。回放收益不等于工程运行时收益。
