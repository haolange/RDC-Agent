---
name: renderdoc-investigation
description: Route RenderDoc capture investigations of incorrect rendering, rendering architecture or GPU optimization to the appropriate planning agent. Not needed for terminology explanations or ordinary code questions.
---

# RenderDoc Investigation

仅当任务需要对 capture 进行证据驱动调查时使用本入口。错误渲染或根因定位交给 Debugger；渲染架构解释交给 Analyzer；GPU 成本与保真优化交给 Optimizer。术语解释、普通代码问题和无需调查的简单查询由 General 直接完成。
使用 agent_handoff 的 route 意图提供用户目标、已有输入引用、事实与未知项、约束和授权摘要。每个用户 root 只允许一次初始路由，路由不消耗执行周期。不要在入口重复执行领域调查方法；由接收方规划并绑定 General 执行所需 Skill。
