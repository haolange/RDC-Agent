# Agent Workstream PRD

## 1. 背景

当前 Debugger 消息流的问题不是单纯的视觉样式问题，而是产品模型和展示模型错位：workflow/debug trace 被直接投影进 chat 容器，再依赖 CSS 包装成用户可读界面。这会导致消息流同时承担聊天、工作流状态、工具日志、调试 trace、产物索引等职责，最终既不像 Codex/Cowork 这类 agent workstream，也不像 RenderDoc 调试工作台。

Agent Workstream 的目标是把 RDC-Agent 的主体验收敛为垂直 agent 工作流：

- 主消息流展示用户委托、agent 过程轨迹、工具/子 agent 调用、Plan/Report 等结果块。
- 右侧展示 session 级索引：Progress、Artifacts、Context。
- raw trace 保留为可展开、可导出的审计材料，不成为默认主体验。
- Debugger / Analyzer / Optimizer 的强流程由本仓库 workflow runtime 控制，Agent SDK 只作为 stage 内 runner。

本文件描述产品目标和用户可见行为，不定义源码实现细节。跨层契约见 `docs/architecture/agent-workstream-technical-contract.md`，UI 结构见 `docs/ui/agent-workstream-ux-spec.md`，验证规则见 `docs/workflows/agent-workstream-verification.md`。

## 2. 产品边界

RDC-Agent 是面向 RenderDoc `.rdc` capture 的 Electron 桌面工作台，不是通用 coding-agent shell。Agent Workstream 是 RDC-Agent 工作台中的任务消息流模型，不是新的顶层产品模式。

当前事实：

- `Ask` 是默认轻入口，只负责对话、澄清、解释和引导用户通过应用内 `Open` 打开 `.rdc`。
- `Debugger` 是当前现役执行主链。
- `Analyzer` / `Optimizer` 是一等产品模式占位。本文将它们纳入 Agent Workstream 的目标状态，但不声称它们已经拥有完整执行 harness。
- 正式执行类任务必须基于应用内当前 project 的 `OpenedCaptureState(status=open)`；用户 prompt、任务文件或项目目录中的 `.rdc` 路径只能作为文本线索，不能绕过 Open capture 状态创建正式 run。
- RenderDoc 工具链必须保持 `renderer -> preload -> IPC -> ToolBridge -> resources/tools/rdx.bat`。
- OpenAI Agents SDK / Claude Agent SDK 只能经 `AgentRunnerPort` 作为 stage 内 runner 接入；顶层 stage、gate、approval、final status 由本仓库 workflow runtime 决定。

目标状态：

- `Ask`、`Debugger`、`Analyzer`、`Optimizer` 共用同一种 Agent Workstream 外壳。
- `Debugger`、`Analyzer`、`Optimizer` 是强 orchestrator 任务，需要 Plan Approval。三者职责不同，但用户体验结构一致。
- `Ask` 是轻流程任务，仅在有工具或多步过程时显示 Progress。

## 3. 用户心智

目标用户接近 Codex 用户：他们不是在进行普通聊天，而是在委托一个垂直 agent 完成 RenderDoc capture 分析、验证和报告输出。

用户需要看到：

- 任务是如何开始的。
- agent 当前在做什么。
- 哪些工具或子 agent 被调用过。
- 计划是否可信，是否需要批准或修改。
- 最终结论、证据、验证和剩余风险。
- 产物在哪里，能否回到消息流来源。
- 结论基于哪些 capture、文件、source 和 capability。

用户不需要默认看到：

- 每条 raw stdout/stderr。
- 底层 Bash/CLI 调用列表。
- workflow/debug trace 的内部字段。
- SDK span、runtime event 或 LLM raw payload 的完整内容。

## 4. 核心概念

### 4.1 Agent Workstream

Agent Workstream 是用户看到的垂直 agent 消息流形态。它包含多个 Task Workstream，以及用户确认、修订、分支切换等连续委托轨迹。

### 4.2 Task Workstream

Task Workstream 按“可交付结果”划分，而不是按一次 tool call、一次 runtime loop 或固定 workflow phase 划分。

示例：

- Plan Phase 产出 Plan Result Block，这是一个 Task Workstream。
- 用户同意执行后开启 Execution Task Workstream，产出 Final Report / Generative UI。
- 用户输入修改建议后开启 Revision Task Workstream，产出新的 Plan Result Block。
- Ask 任务可以产出 Final Answer，也可以在多步工具调用后产出 Result Block。

### 4.3 Task Result Block

Task Result Block 是 Plan、Final Report、Failure Report、Cancelled Result、Visual Report Summary 的统一用户可见结果容器。

关键裁决：

- Plan Card 是 Plan Task 的 final report。
- Execution Report 是 Execution Task 的 final report。
- Plan 和 Report 不应该使用两套割裂 UI，而应共享 Task Result Block 抽象。

### 4.4 Process Trace

Process Trace 是 Task Workstream 中的过程轨迹，包含 Agent Thinking Bubble、Tool Row、Sub Agent Row 等。它不是 raw trace；raw trace 只在展开详情或导出中出现。

## 5. Task 类型

| 类型 | 当前状态 | Harness 强度 | Plan Approval | Progress | 典型产物 |
| --- | --- | --- | --- | --- | --- |
| Ask | 当前默认入口 | 轻流程 | 通常不需要 | 有工具或多步时可选 | Final Answer |
| Debugger | 当前现役主链 | 强流程 | 强制 | 必须 | Plan、Report、Generative UI、Evidence Bundle |
| Analyzer | 目标状态 / 占位 | 强流程目标 | 强制 | 必须 | Analysis Plan、Analysis Report、Visual Report |
| Optimizer | 目标状态 / 占位 | 强流程目标 | 强制 | 必须 | Optimization Plan、Patch Proposal、Validation Report |

四种类型在 UI 上使用同一布局，只用轻标签区分。prompt 输入栏左侧的 orchestrator 入口负责选择任务类型。

## 6. 核心流程

### 6.1 Ask Flow

1. 用户在 `Ask` 入口输入问题。
2. agent 返回自然语言回答；若需要工具或多步过程，可显示 Progress 和 Process Trace。
3. 任务结束后产生 Final Answer / Result Block。
4. 不创建正式 Debugger run，不暴露 RenderDoc 工具，不从 prompt 中的 `.rdc` 路径自动进入执行。

### 6.2 Debugger Plan Flow

1. 用户在 Debugger 入口提交目标，前提是当前 project 已有 `OpenedCaptureState(status=open)`。
2. Runtime 创建 Plan Task Workstream。
3. agent 通过 intake、工具、必要的 AskUserQuestion 收集信息。
4. 消息流中出现 Plan Result Block。
5. Composer 区域被 Approval Overlay 覆盖，用户选择同意执行或输入修改建议。

### 6.3 Plan Approval

用户点击同意执行后：

- 消息流插入 User Confirmation Message，例如“同意执行”。
- 旧 Plan Result Block 标记 `accepted`。
- Runtime 创建新的 Execution Task Workstream。
- Execution 只能读取 latest accepted plan。

### 6.4 Plan Revision

用户输入修改建议后：

- 消息流插入 User Revision Message，内容为用户修改建议。
- 旧 Plan Result Block 标记 `needs_revision`。
- Runtime 创建 Revision Task Workstream。
- 新 Plan 生成成功后，旧 Plan 标记 `superseded`。
- 新 Plan 成为 latest displayed plan，并重新等待 approval。

### 6.5 Execution Flow

1. Execution Task Workstream 从 latest accepted plan 启动。
2. agent 根据 plan 初始化 Progress task list。
3. Runtime 在执行中通过 task 事件追加、更新、完成、阻塞或回溯 task。
4. Tool/Sub Agent 按时间顺序显示在消息流中，可关联 Progress task，但不会自动变成 Progress task。
5. 执行结束后产出 Final Report Block 和正式 Artifacts。

### 6.6 Failure / Cancellation

任务失败后必须产出 Failure Report Block，说明失败点、已完成内容、阻断原因、可恢复路径和剩余风险。

用户中断任务后必须产出 Cancelled Result Block，说明已完成内容和未完成项。中断不删除已有过程轨迹。

## 7. 右侧三块

右侧是 session 级索引，不是 workflow 固定阶段面板，也不是 raw log viewer。多轮连续委托时，右侧按 session 累积，当前 task 置顶，历史折叠。

### 7.1 Progress

Progress 是 agent runtime task list。

规则：

- 初始来自 Plan / execution_roadmap / todo list。
- 执行中由 runtime 事件动态维护。
- 已完成 task 保留并划线。
- 新 task 往下追加。
- tool/sub agent 可以关联 taskId，但不会自动创建 task。
- Progress 不是 Activity，也不是工具调用日志。

### 7.2 Artifacts

Artifacts 是当前 session 中每次任务产生的正式产物，不是 agent 读过的文件。

包括：

- `plan.md`
- `report.md`
- Generative UI / Visual Report
- Evidence Bundle
- Failure / Cancelled summary
- 其他用户可消费产物

每条 artifact 默认显示：

- 名称
- 类型
- 所属 task
- 状态
- 更新时间
- 打开入口

操作：

- 打开
- 定位到消息流来源
- 查看 raw
- 复制路径

不默认提供删除、重命名或到处导出。导出集中在 session 菜单、report block 或 bundle 操作中。

### 7.3 Context

Context 是 session 依赖过的上下文和高层能力索引，不是工具调用日志。

默认分组：

- Captures
- Files
- Sources
- Capabilities

规则：

- 自动记录全部读取、引用、使用过的上下文。
- agent 可标记 important / cited / decisive。
- UI 默认显示重要项，展开后显示全部自动记录项。
- Report 引用过的 context 自动标记 cited。
- 决定性证据标记 decisive。
- 重要性等级默认不暴露，展开详情时显示。

RenderDoc/RDX capability 不应在右侧默认显示成 Bash/CLI/RenderDoc Tool 分类。底层 CLI 细节只在 Tool Row Raw tab、capability 详情或 raw trace 导出中出现。

## 8. Plan 与 Report

### 8.1 Plan Result Block

Plan Result Block 默认显示：

- 目标
- 已知事实
- 假设 / 判断
- 执行路线
- 验收标准
- 风险 / 阻断
- 预计产物

完整 `plan.md` 或 raw action plan 作为 artifact / raw 入口打开，不直接铺满消息流。

### 8.2 Final Report Block

Final Report Block 默认显示：

- 结论
- 关键证据
- 已完成验证
- 剩余风险
- 产物入口

完整 `report.md` 和 Generative UI 通过 artifact 打开。

### 8.3 Generative UI

`report.md` 是 canonical report。Generative UI 是由 `report.md` 或同一份 structured report data 派生的可视化阅读层，不能引入 Markdown Report 中没有的新结论。

## 9. Prompt Branching

User Prompt Bubble 支持 Copy / Edit。

Copy 复制原 prompt 文本。

Edit 不覆盖历史，而是创建新的 request branch。新分支有自己的后续 Task Workstream。UI 在 prompt 附近显示 branch navigator：

- 左箭头
- 右箭头
- 当前分支 index

切换分支时，下方消息流显示该分支对应的后续 Workstream。Session 导出可以包含所有分支。

第一版实现如果风险过大，可以先完成数据模型和 presentation model 预留，但不得把 Edit 设计成覆盖历史消息。

## 10. Raw Trace 与导出

Raw trace 默认不出现在主消息流。

可见入口：

- Tool Row 展开后的 Raw tab。
- Session 菜单导出完整 raw trace / debug bundle。
- 失败时显示错误摘要，可展开 raw。

Session 菜单至少支持：

- Export session summary
- Export raw trace / debug bundle

第一版不提供删除 raw trace / context 记录，只提供导出。

## 11. 非目标

- 不把 RDC-Agent 变成通用 coding-agent shell。
- 不从 prompt 中的 `.rdc` 路径自动创建正式 run。
- 不让 Agent SDK 决定顶层 stage、gate、approval 或 final status。
- 不绕过 `ToolBridge` 调 RenderDoc 工具。
- 不把 Analyzer / Optimizer 写成当前已完成执行能力。
- 不把 raw trace 默认铺进主界面。
- 不把右侧 Context 做成 Bash/CLI/MCP 调用列表。
- 不把 Artifacts 做成文件管理器。
- 不用 Plan Card 内散落按钮替代 Composer Approval Overlay。

## 12. 决策映射

| 轮次 | 决策 | 落点 |
| --- | --- | --- |
| 1 | 不是聊天，是 Codex/Cowork 风格 vertical agent workstream；工具要在消息流中折叠显示 | 产品定位、消息流结构 |
| 2 | Prompt 固定高度、换行、fade/blur、箭头；tool 一行摘要；Raw trace 走 session 菜单 | User Prompt Bubble、Tool Row、Raw Trace |
| 3 | workflow 是编排层，不做固定阶段 UI；工具严格按时间顺序逐条显示 | Process Trace、右侧 Progress |
| 4 | Plan 在消息流中是结构化卡片，审批 overlay 覆盖 composer；需要 Plan history | Plan Flow、Approval |
| 5 | Plan Card 是结构化视图，可切 Raw；多份 plan 通过消息流历史与版本保存 | Plan Result、Artifacts |
| 6 | 右侧为 Progress / Artifacts / Context；Artifacts 是正式产物，Context 收上下文和 capability | 右侧三块 |
| 7 | Prompt 有轻气泡靠右；Agent thinking 同气泡合并；Tool/Sub Agent 中等权重；Plan 也是 final report | UX Spec、Task Result Block |
| 8 | 任务完成后过程自动折叠；Tool 默认 Summary tab；Sub Agent 摘要后可查看完整轨迹 | Workstream density |
| 9 | Task Workstream 按可交付结果划分；Progress 来自 Plan 初始化 + runtime 维护；artifact 绑定 session/task/source | Technical Contract |
| 10 | 同意执行/修改建议都插入用户消息；Plan accepted / needs_revision / superseded；右侧 session 累积 | Approval / Revision |
| 11 | Plan/Report section、Generative UI 派生关系、Artifact 信息和操作 | Result Block、Artifacts |
| 12 | Context 分组、默认重要项、capture 粒度、cited/decisive | Context |
| 13 | 完成后收起过程；历史完整保留；tool 状态；时间戳规则 | Density、状态 |
| 14 | Ask 轻流程；Debug/Analyzer/Optimizer 强 approval；同布局轻标签 | Task 类型 |
| 15 | Raw trace 在 Tool Raw tab + session export；失败显示错误摘要 | Raw Trace / Export |
| 16 | Failure/Cancelled Result Block；Prompt Copy/Edit branch | Error、Branching |
| 17 | 文档包、中文、Codex Goal 式实施和验证纪律 | 文档与实施 prompt |
