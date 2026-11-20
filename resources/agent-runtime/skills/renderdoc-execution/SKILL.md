---
name: renderdoc-execution
description: Execute a frozen RenderDoc investigation plan, deliver in place, and checkpoint changes requiring strategic realignment.
---

# RenderDoc Execution

General 执行已批准的调查计划时用这份方法：读冻结的计划和最新 Checkpoint，在计划边界内把调查做到证据允许的深度，就地交付。计划正文写策略，执行所需的引用在正文末尾的执行引用和主进程合同里。CLI 用法见 $rdc-tool-shell，专业操作与记录写法见本次预载的手册和领域方法。

## 调查主线

每得到一个结果，都回到这条主线判断下一步。它是判断顺序，不是固定的工具序列；知识检索、对象定位和计算分析可以交错。

1. **锚定**。把用户目标落到当前 capture 的具体对象：哪张原生纹理、哪个区域、哪个事件或 draw、哪条资源链，以及"它就是用户所指"的依据。依据分三档，写在锚点 Evidence 的 summary 开头：`user-confirmed`、`cross-validated`（两条独立路径互相印证）、`candidate`。做法见 $pixel-forensics。锚点仍是候选时，下一步优先做能确立或否定它的检查。
2. **解释与预测**。对已锚定的对象保留可以互相区分的解释，每条写明成立时应观察到什么、什么观察会削弱或排除它。来自 Knowledge 的解释另写适用条件里哪些已匹配、未知或不符；条件未知先核对，证伪了才排除。
3. **选下一项检查**。在合法、可执行的检查里选最能改变判断的一项，说清它区分哪几条解释。结果回来后更新谁被支持、削弱、排除或暂缓。符合预测只增加支持，不单独证明因果。
4. **在决策点记录**。探索阶段沿带 hash 的工具回执推进；到锚点确立、解释集合成形、实验设计与关闭、准备交付这些节点，再用 `investigation_*` 写记录。Checkpoint 的 `unresolvedFrontier` 写还没执行的有效检查。
5. **请独立核验**。形成拟接受的定位、归因或因果主张后派发审查；没有主张时不做空审查。
6. **继续或交付**。计划内还有合法且有区分力的检查就继续，"下一步还没查"不是阻塞。确实不能继续时交付 partial，逐项写缺口、试过的路径、挡住的条件和恢复条件；一次无副作用的拒绝不等于能力不可用。

## 续跑与循环

- **Small Loop**：批准范围内的补证、区分与核验在当前执行里继续，沿用原消费与期限。
- **Big Loop**：要换 capture 或设备、做计划外的操作或目标变了，保存 Checkpoint，在终答写清缺口与依据，由用户切回 Mission。
- 额度耗尽仍未完成时声明 `budget_paused` 并引用最后的 Checkpoint；先做能决定下一步的检查，为恢复和收口留出余量。
- 上下文压缩后先读回冻结计划和最新 Checkpoint，再决定下一步。

## 现场与实验

- **切换与恢复**：跨 capture 用计划批准的 inputId 经 `rdc_probe` 的 `capture_select` 切换。`runtime_context.captureRestoration` 是入口基线，不是当前事件，当前位置要实际查询。结束前调用 `capture_restore` 并检查 `restoration.restored`；终态回执由主进程在提交前签发。
- **故障**：现场被隔离时关闭中断的实验，用 `capture_recover` 在相同输入、设备和权限下重开，离线分析照常继续。中断实验的旧阶段不与新现场拼接；同一故障再现就停止重开，改做其他检查或如实交付。
- **取图**：临时路径读不到、当前事件没有普通颜色目标，都不等于图像取不到；用观察或导出能力（例如 `rd.session.observe` 的最终输出）写到有权限的位置再读取。坐标以原生纹理为准。
- **实验**：干预要真实执行并恢复。experimentId 绑定 baseline → intervention → variant → rollback → restored 五份签名回执，记在 Experiment 的 `executionEvidence` 里（取法见 $rdc-tool-shell）。撤销前保存变体现场需要的图像、参数和替换枚举。干预有语义依据、范围受限、预测可区分并能恢复就可以做，不要求事先证明它全局最小；对象与源材料的绑定、修改边界和恢复条件要先成立。
- 在计划边界内用 `task_create`／`task_update` 调整 Tasks，领域字段不写进 TaskRecord；用户没有要求时不写持久 Memory／Knowledge。

## 委派与独立审查

单次 lookup、必要抽查及低成本操作由 General 直接完成。需要隔离时按职责委派：知识综合用 knowledge-scout，机制与候选检查用 generator，Shader、Pass、Resource、Pixel 分析用对应的 analyst，独立审查用 verifier，报告组织按需用 report-writer。General 负责实时回放操作和整合，子级只处理获授的材料。每次 `subagent` 委派写明问题、范围、已确认的事实及来源、竞争解释、相关 Challenge、否定路径的适用与重验条件和输出要求。

计划要求的工作在所属 Task 的 `executionRequirements` 里声明执行方式；义务需要变更时，停止并 join 受影响的执行，经 `plan_artifact.taskRevisions` 修订同一 Task。

独立审查（委派与续审的通用做法见 execution-orchestrator）：

- 审查 Task 绑定 `profileId=verifier` 和独立的来源 Task；Capsule 的 `inputArtifactRefs` 授予被审记录的 URI/hash，运行时会补授它们依赖的证据和实验回执。General 自己读取 skeptic-review 不等于独立审查。
- 审查返回两类意见。Challenge 是"不处理，结论就不能按现在的措辞成立"的缺口，在最终接受前要有真实补证、范围修订或其他有依据的处理。审查结果 `unresolved` 里标 `not_required` 的是备注，写进交付的未知项，不改结论措辞。计划要求 typed Challenge 而审查只返回文字时，由 General 核对目标与来源后用 `investigation_write` 保存。
- 交付审查的范围要兑现冻结计划的必要目标，不能只审一个较弱的局部主张就结束。

## 材料

- 用户给出的区域、参考图和对比条件可以作为锚点的"用户确认"依据，不是已验证的原因，也不是修改授权。对象或区域确有歧义、材料又判定不了时，问用户一次。
- 参考图与 capture 的构图或曝光不一致时，跨图定量比较标为不可比；同一回放内的前后与目标区／控制区配对照常做。画质依实际读到的图像判断，看不清就读原生区域数值。

## 交付

General 的终答就是交付，按这个顺序写：

1. **结论**：第一句写证据支持的最强结论，后面跟一个等级标签，取自结论所依 Claim 的 `verification`：`[Observed]`、`[Reconstructed]`、`[Differential-Supported]`、`[Replay-Counterfactual]`；没有经过验证的陈述标 `[Inferred]` 或 `[Unresolved]`。有五份回执齐全的实验、干预改变了结果且撤销后复原时，结论就写成因果，不再加"支持""可能"之类的限定。
2. **证据**：关键读数、实验前后的对比、审查结果。
3. **未知项与未覆盖的范围**：单独成段，放在结论之后。
4. **现场与后续**：现场是否已恢复，是否需要用户决定。

正式报告由 Mission 在用户切回时产出，需要时可委派 report-writer。获批目标、必要核验、相关 Challenge 与现场恢复都闭合后声明 completed，否则如实声明 partial 或 blocked。
