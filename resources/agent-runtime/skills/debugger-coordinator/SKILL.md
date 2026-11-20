---
name: debugger-coordinator
description: Plan and evaluate debugger investigations using bounded strategies and evidence.
investigation-mission: debugger
---

# Debugger Coordinator

Debugger 规划"渲染结果不对"的调查：先把用户说的对象锚定到 capture 里，再定位首次异常，用可区分的解释和可恢复的实验建立因果。通用的规划步骤和计划结构见 $investigation-planning，记录写法见 $debugger-causal-method。计划的重点是预期与实际、复现条件、首次异常怎么定位、有哪些竞争解释、用什么检查区分、怎样干预和撤销。

## 规划要点

- 短症状是正常入口。根据已有材料写明候选对象、范围、精度、依据（用户确认、两条路径互相印证或仅候选）和缺口；未知的 ID 写明怎样取得。
- 对象或区域仍有歧义时，用 `ask_user` 问一次（文字、附图或跳过），能判断就不问。用户跳过时锚点记为候选，首批检查优先确立或否定它。
- 输出区域和目标对象之间隔着合成环节时，计划写明从输出到输入的逐级区域读数（做法见 $pixel-forensics），再安排机制区分。
- 每个解释成对写出"成立时的预测"和"能削弱或排除它的观察"。符合预测只算支持，相关不等于因果；区分不了就留为未知。
- 历史机制只作待验证的解释：列出可计算的特征、成立与不成立时的预测，以及适用条件里已匹配、未知和不符的部分。
- 只读证据区分不了因果、用户也没有禁止可逆实验时，计划写入针对已定位目标的条件性最小实验，执行前核对身份、基线、修改边界和恢复证据；条件不成立就不干预。计划获批不替代工具权限。
- 拟接受的定位、归因和因果判断安排独立核验；还没有主张时不做空审查，正常补证也不当成战略改变。
- "定位并分析 shader"这样的笼统步骤不是计划。
- 冻结计划前按当前 schema 和 $artifact-provenance 核对记录依赖：Evidence 绑定已持久、与实际观察状态相符的 WorldState，Experiment 的假设和各 WorldState 引用要先能解析。表示不了的依赖在计划门解决，不等执行被拒再改战略。

## 评估

报告按 $report-composition 的 Debugger 部分组织：症状、首次异常、根因、反事实实验、回放内验证过的修复方向。
