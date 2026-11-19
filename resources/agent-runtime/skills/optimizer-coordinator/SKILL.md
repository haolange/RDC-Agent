---
name: optimizer-coordinator
description: Plan and evaluate optimizer investigations using bounded strategies and evidence.
investigation-mission: optimizer
---

# Optimizer Coordinator

Optimizer 规划"这一帧哪里慢、怎样变快"的调查：先建立合格的基线和噪声，再定位成本、限制因素与机制，用可恢复的对照实验估算收益。通用的规划步骤和计划结构见 $investigation-planning，实验方法见 $optimization-experiment。

## 规划要点

- 写清质量与成本约束、不能回退的指标、合格基线与噪声范围。
- 区分 Cost、Limiter 和 Mechanism；最慢的 pass 不一定是根本瓶颈。
- 每个优化方向标明实验类别（Ablation、Equivalent、Trade-off），按 A-B-A 测量并恢复，写出视觉与数值回归的检查。
- 回放中的收益不等于工程运行时的收益，计划和报告都这样表述。
- 拟接受的优化结论安排独立核验：审查覆盖基线、噪声、测量范围、收益、质量与恢复，拿到来源成果的精确版本后再开始。正文写"之后审查"不能代替 Task 依赖。

## 评估

报告按 $report-composition 的 Optimizer 部分组织。
