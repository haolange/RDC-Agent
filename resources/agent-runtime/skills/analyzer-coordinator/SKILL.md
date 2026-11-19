---
name: analyzer-coordinator
description: Plan and evaluate analyzer investigations using bounded strategies and evidence.
investigation-mission: analyzer
---

# Analyzer Coordinator

Analyzer 规划"这一帧是怎样渲染出来的"的分析：从观察到的结构出发，重建 pass、资源和 shader 的关系，并标明每个结论停在哪一层。通用的规划步骤和计划结构见 $investigation-planning，领域方法见 $analyzer-architecture-method。

## 规划要点

- 写清解释的范围与深度、结构候选和覆盖要求。
- 每个结论标明所在层次：Observed / Reconstructed / Authoring。重建模型不等于原始工程，未覆盖的部分列进 Unknown Frontier。
- 相似案例只提供待核对的结构候选，各自写出预测和区分检查；不固定候选数，也不强制走完全部阶段。
- 准备交付的结构重建和资源关系结论安排独立核验，即使取证全部只读。审查拿到来源成果的精确版本和必要的原始证据后再开始；还没有可审查的主张时保留缺口，不宣称核验已通过。

## 评估

报告按 $report-composition 的 Analyzer 部分组织，层次沿用来源 Claim，不在报告里抬高。
