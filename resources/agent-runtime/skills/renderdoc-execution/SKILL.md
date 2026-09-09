---
name: renderdoc-execution
description: Consume a bound RenderDoc investigation plan, execute within its strategy, preserve evidence and return to the originating planner.
---

# RenderDoc Execution

General 消费本次执行绑定中的 Plan URI/hash、必需 Skill、返回对象和交付要求。按绑定读取原 Plan 和 Checkpoint，完成计划边界内的检查；不得静默改写战略目标或覆盖旧 Plan。需要战略改变时保存 Checkpoint，带触发证据回交规划者。CLI 用法见 $rdx-cli-shell，领域记录见本次必需方法，不另造执行引擎。

## 共享 Plan 模板

Plan 为按任务规模填写的 Markdown 策略，使用 plan_artifact 新版本保存并取得 URI/hash。必须说明以下六块，可明确标注不适用原因：

1. **目标与边界**：用户目标、成功标准、范围、质量约束、能力上限、输入缺口。
2. **输入与参考依据**：输入引用、已知事实、未知项；Knowledge 来源、适用条件、反例、失败经验和冲突。相似度只帮助选检查方向，不构成事实或因果证据。
3. **候选方向与选择依据**：方向及来源、待验证预测、最小区分检查、进入／排除／转向条件。不固定候选数量。
4. **执行策略与依赖**：首批检查、必要依赖、方法／Skill、预期产物、可委派工作及局部调整范围。不预写全部工具命令，不要求无关阶段。
5. **决策与循环**：Small Loop 补证、Big Loop 改策略、ask_user 条件，以及能力／权限／预算停止条件。
6. **交付与回评估**：必要证据、未解问题、验收意图和回交要求。新 Plan 引用上一 Checkpoint，说明战略变化和触发证据，不复制历史。

## 共享交接与循环

agent_handoff 必须提供非空 prompt 摘要及 contract。初始 route 不消耗周期且每 root 仅一次。规划者用 execute 绑定 plan {uri,hash}、requiredSkillIds、returnTo（自己）和 deliveryRequirements。接收方 prepareTurn 验证并冻结必需 Skill，不依赖摘要中的 $ 引用。
执行结束或需要 Big Loop 时，General 用 return 提交当前 executionHandoffId、更新后的 Checkpoint／产物 {uri,hash} 引用和摘要，回交实际派发者。Plan 保存策略，Checkpoint 保存执行事实，handoff 仅摘要和引用。
每 root 最多两轮完整的规划→执行→评估；初次执行后可有一次 Big Loop。第二轮始终保留回评估机会，第三轮自动派发被拒绝；保存 Checkpoint 和缺口，等待新的用户指令。额度耗尽未完成时，Mission 最终文本以 [INCOMPLETE] 开头，引用最后回交 Checkpoint 的 URI 和 contentHash，原样说明其 unresolvedFrontier 并等待新用户指令；这只结束当前 turn，不宣称调查完成，不提升报告状态。Small Loop 在当前周期补证，受工具、时间、取消和无进展上限约束。重启不自动续跑。

## 执行与证据

按规模使用 task_create / task_update，在计划边界内调整 Tasks；开放 Challenge 的后续检查引用 challengeId 和 requiredFollowUp，更新或 supersede 原 claim_set，不把领域字段写进 TaskRecord。通过 investigation_* 写 Evidence／Claim／Experiment／Challenge／Checkpoint，按 provenance 门禁标记 ready。
因果介入与优化实验必须有真实执行及恢复；shell.rdx 的 experimentId 绑定 baseline→intervention→variant→rollback→restored 签名回执（Experiment.executionEvidence）。权限拒绝、未执行、布尔声明或原 capture hash 不变均不是回滚证据。General 返回原规划者评估，不代替其声明调查完成。
普通 subagent 子代理不请求领域扩展；需要 RDX 时显式申请可选扩展并遵守串行租约和及时回收。用户未要求时不写持久 Memory／Knowledge。
