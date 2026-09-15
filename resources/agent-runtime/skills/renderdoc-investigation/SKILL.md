---
name: renderdoc-investigation
description: Route RenderDoc capture investigations of incorrect rendering, rendering architecture or GPU optimization to the appropriate planning agent. Not needed for terminology explanations or ordinary code questions.
---

# RenderDoc Investigation

仅当任务需要对 capture 进行证据驱动调查时使用本入口。错误渲染或根因定位交给 Debugger；渲染架构解释交给 Analyzer；GPU 成本与保真优化交给 Optimizer。术语解释、普通代码问题和无需调查的简单查询由 General 直接完成。
在终答里写清应使用哪一只 Mission，由用户通过 UI 切换；不要调用已删除的交接工具，也不要假装已经切到了 Mission。不要在入口重复执行领域调查方法；由接收方规划，用户批准后再点 Execute with General。
