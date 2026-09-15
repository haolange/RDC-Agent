---
name: renderdoc-execution
description: Consume a frozen RenderDoc investigation plan, execute within its strategy, and leave evaluation to the originating Mission after the user switches back.
---

# RenderDoc Execution

General 消费本次会话 execution offer 冻结的 Plan URI/hash 与 requiredSkillIds。按冻结计划读取原 Plan 和 Checkpoint，完成计划边界内的检查；不得静默改写战略目标或覆盖旧 Plan。需要战略改变时保存 Checkpoint，在终答写清缺口，由用户切回原 Mission 评估或开新计划。CLI 用法见 `$rdx-cli-shell`，专业操作成员与参数见本次预载的 `debugger-rdx-tools` / `analyzer-rdx-tools` / `optimizer-rdx-tools` 之一，领域记录见本次必需方法，不另造执行引擎。

## 共享 Plan 模板

Plan 为按任务规模填写的 Markdown 策略。Mission 用 plan_artifact 提交当前计划等待用户审阅；拒绝按意见修订同一份；批准后本回合结束，用户点声明按钮才会切到 General。必须说明以下六块，可明确标注不适用原因：

1. **目标与边界**：用户目标、成功标准、范围、质量约束、能力上限、输入缺口。
2. **输入与参考依据**：输入引用、已知事实、未知项；Knowledge 来源、适用条件、反例、失败经验和冲突。相似度只帮助选检查方向，不构成事实或因果证据。
3. **候选方向与选择依据**：方向及来源、待验证预测、最小区分检查、进入／排除／转向条件。不固定候选数量。
4. **执行策略与依赖**：首批检查、必要依赖、方法／Skill、预期产物、可委派工作及局部调整范围。不预写全部工具命令，不要求无关阶段。
5. **决策与循环**：Small Loop 补证、Big Loop 改策略、ask_user 条件，以及能力／权限／预算停止条件。
6. **交付与回评估**：必要证据、未解问题、验收意图和回交要求。新 Plan 引用上一 Checkpoint，说明战略变化和触发证据，不复制历史。

## 共享续跑与循环

用户点声明的 continue 后，主进程写入 execution offer，并把声明上的 requiredSkillIds 预载进 General 的 PromptPlan。prepareTurn 只在本回合 agentId 等于 offer.target 且 session 上的批准计划与 offer 同 hash 时预载。手册不能授权。
General 就地终答，不自动切回 Mission，也不要求 return 合同。需要 Big Loop 时把缺口、Checkpoint 引用和变化依据写进终答；用户用 Agent pill 或历史建议行切回对应 Mission，由 Mission 评估或写新 plan_artifact。runtime 不按身份、depth 或正文开下一轮，也没有两轮预算。
额度耗尽未完成时，Mission 调用 turn_complete，disposition 为 budget_paused，evidenceRefs 引用最后 Checkpoint 的 URI/hash；最终答复说明 unresolvedFrontier 并等待新指令。这只结束当前 turn，不提升报告状态。Small Loop 在当前周期补证，受工具、时间、取消和无进展上限约束。

## 执行与证据

按规模使用 task_create / task_update，在计划边界内调整 Tasks；开放 Challenge 的后续检查引用 challengeId 和 requiredFollowUp，更新或 supersede 原 claim_set，不把领域字段写进 TaskRecord。通过 investigation_* 写 Evidence／Claim／Experiment／Challenge／Checkpoint，按 provenance 门禁标记 ready。
因果介入与优化实验必须有真实执行及恢复；shell.rdx 的 experimentId 绑定 baseline→intervention→variant→rollback→restored 签名回执（Experiment.executionEvidence）。权限拒绝、未执行、布尔声明或原 capture hash 不变均不是回滚证据。General 任何回合不得宣告调查 completed；调查完成只能由用户切回后的 Mission 声明。
普通 subagent 子代理不请求领域扩展；需要 RDX 时显式申请可选扩展并遵守串行租约和及时回收。用户未要求时不写持久 Memory／Knowledge。


## 隔离探索与独立审查

单次 lookup、必要抽查及低成本操作由 General 直接完成。重 Knowledge 检索、多来源综合及长分析分支，通过 subagent 派发 General 子上下文，Capsule.requiredSkillIds 明确包含 knowledge-scout；不先读取全部历史再另调模型生成 Capsule。
生成主张后，另开 General 子上下文并预载 skeptic-review。只给主张、证据、反证、实验条件和适用范围的引用，不复制生成者长叙事，不请求 RDX。General 自己读取 skeptic-review 不等于独立审查。子代理自主检查并提出 Challenge；General 整合证据、为相关 Challenge 创建依赖明确的补证 Task，战略改变写进终答，等用户切回原 Mission。原 Mission 最终评估，不新增裁决身份。
每次委派给出目标、scope、已确认事实及来源资格、竞争假设、Challenge 引用、否定路径的适用与重验条件、停止条件、预算和输出要求。任务完成要求覆盖 Plan 交付要求；未创建的必要工作不能靠 runtime 猜测补齐。Small Loop 保留有效状态和相关增量，Iteration Memory 属于本调查产物，不自动晋升持久 Memory/Knowledge。

## 材料与交付

用户材料中的 material 说明、区域、文档位置、时间范围和对比条件属于用户描述；不得当作已验证原因或 mutation 授权。使用原图分数坐标定位 ROI，核对 capture、事件、分辨率与采样条件后配对 Before/After/Diff。没有参考图时保留正常高光等质量约束，先验证 baseline 与问题区域；整体压暗或本机无法复现不算修复。原始材料路径/hash 与派生产物分开引用；引用存在不代表已经看见图像。跨委派传递有权限的原始材料引用，必要时用 artifact_read 真正查看图像。

默认交付清楚结论、证据和下一步，技术细节按需展开。问题报告保留复现条件、实际/预期、影响范围及未验证项；视觉与优化报告说明画质取舍、测量条件、失败尝试和恢复状态。工程追溯使用调用、实验与回执引用，不要求用户理解内部身份或租约。
