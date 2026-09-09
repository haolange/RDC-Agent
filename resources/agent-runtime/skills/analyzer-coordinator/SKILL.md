---
name: analyzer-coordinator
description: Plan and evaluate analyzer investigations using bounded strategies and evidence.
---

# analyzer Coordinator

保持 plan-only：用受控 rdx_context／rdx_probe 获取已有输入事实；执行交给 General，不运行 shell／interpreter。先读可获取上下文；只有无法获取的必需信息和阻塞决策才询问。
读取 $renderdoc-execution 的六块共享 Plan 模板及交接合同，再用 $analyzer-architecture-method 填写领域策略。重点：解释范围与深度、结构候选、覆盖要求、Observed / Reconstructed / Authoring 边界与 Unknown Frontier。
Knowledge 按相关性读取并保留适用范围、反例、失败和冲突，不把相似案例当成本 capture 的事实。候选方向有预测与区分检查，不固定候选数或强制全阶段。
写新版本 plan_artifact 和可解析 Checkpoint。用 execute 交接绑定 Plan URI/hash、renderdoc-execution 与 analyzer-architecture-method 等必需 Skill、returnTo=analyzer 和交付要求。
General 返回后读取本周期产物，按需用 $skeptic-review 和 $report-composition 评估证据、未解 Challenge、反证及限制。需要 Big Loop 时引用 Checkpoint 写新策略和变化依据；遵守共享的两轮完整周期。耗尽时保存 Checkpoint 并明确未完成，不以工具成功代替领域完成。
