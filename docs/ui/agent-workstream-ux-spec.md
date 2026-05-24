# Agent Workstream UX Spec

## 1. 目标

Agent Workstream UI 的目标是把 RDC-Agent 的消息流从“chat 容器中的 debug trace 投影”改为 Codex/Cowork 风格的垂直 agent workstream，同时保留现有设计语言：深色产品气质、现有 token、配色、圆角、边框、字体、顶部暗带/模糊带等不因结构重构被替换。

本文件只定义 UX 结构、信息层级和交互规则。实现时不得把本文当成视觉改版授权；如果需要改动配色、圆角或全局视觉语言，必须另行更新 `DESIGN.md` 和 `docs/ui/design-system.md`。

## 2. 总体布局

```text
Main Workbench
  Message Stream
    Task Workstream Container
    User Confirmation / Revision Message
    Task Workstream Container

  Right Panel
    Progress
    Artifacts
    Context

  Composer Area
    Prompt Composer
    or Approval Overlay
```

顶部暗带 / 模糊带属于现有设计，消息流内容应整体避让该区域，不应关闭或覆盖。

## 3. Task Workstream Container

Task Workstream Container 是一次可交付 agent task 的 UI 外壳。

包含：

- User Prompt Bubble
- Process Trace
- Task Result Block

状态：

- `running`
- `completed`
- `failed`
- `cancelled`
- `awaiting_approval`

密度：

- `expanded`
- `compact`

行为：

- running + expanded：显示完整过程轨迹。
- running + compact：显示最新 thinking/tool/sub agent 轨迹，历史过程压缩。
- completed：process trace 自动折叠，result 保持可见。
- failed：显示 Failure Result Block。
- cancelled：显示 Cancelled Result Block。
- awaiting_approval：Plan Result Block 保持可见，Composer 显示 Approval Overlay。

历史 Task Workstream 必须完整保留在消息流中，不删除、不重排、不只剩一行摘要。默认可以处于 process collapsed 状态，用户展开后可查看完整过程。

## 4. User Prompt Bubble

User Prompt Bubble 表示一次任务委托，不是普通 IM 气泡。

视觉与布局：

- 轻气泡包裹。
- 整体稍微靠右。
- 保留换行。
- 短 prompt 全量显示。
- 长 prompt 限高显示。
- 底部使用 fade / blur 表示还有内容。
- 底部箭头控制展开 / 收起：折叠时向下，展开时向上。

交互：

- hover / focus 时右下角出现 Copy / Edit。
- Copy 复制当前 prompt 文本。
- Edit 原地进入编辑态，但提交后不覆盖历史，而是创建新 branch。
- Prompt Bubble 可显示 branch navigator：左箭头、右箭头、当前 index。

约束：

- User Prompt 可以有气泡，但不做强 IM 左右对话结构。
- Prompt 是 task 起点，不是聊天的一半。

## 5. Agent Thinking Bubble

Agent Thinking Bubble 表示 agentic thinking trace，是 agent 执行过程中的自然语言轨迹。

规则：

- 连续 agent 文本合并在同一个 Thinking Bubble 下。
- 保留自然段和换行。
- 遇到 Tool Row、Sub Agent Row、Plan Result、Report Result 时断开。
- 之后新的 agent 文本开启新的 Thinking Bubble。
- 执行中可完整显示。
- 任务完成后，Thinking Bubble 所在 Process Trace 自动折叠。
- 折叠状态才显示标题，例如“思考过程”；展开状态不需要额外标题压住内容。

禁止：

- 每句话拆成一个聊天气泡。
- 把 thinking 文本无容器地铺成文档流。
- 把 thinking 和 raw trace 混在一起。

## 6. Tool Row

Tool Row 表示一次工具调用。它按真实时间顺序显示在消息流中，不自动按类型分组或重排。

默认状态：

- 中等权重一行。
- 显示状态、动作、对象、耗时或简要结果。
- 默认折叠。

状态：

- running
- done
- failed
- skipped

示例：

```text
done · Inspect pipeline state · Event 1248 · 2.4s
failed · Export render target · Event 1248 · permission denied
```

展开后 tabs：

- Summary
- Input
- Output
- Artifacts
- Raw

默认 tab 是 Summary。

Raw command / stdout / stderr 只在 Raw tab 或 export 中出现。失败时默认显示错误摘要，可展开 Raw。

Tool Row 可以关联一个 Progress task，但不会自动创建 Progress task。

## 7. Sub Agent Row

Sub Agent Row 是特殊 Tool Row。它表示一次代理委托，而不是普通命令。

默认：

- 与 Tool Row 使用同一套基础结构。
- 有明确 agent-call 标识。
- 默认折叠。
- 显示委托对象、任务摘要、状态和结果摘要。

展开：

1. 先显示 sub agent result summary。
2. 提供“查看完整轨迹”入口。
3. 用户点击后显示 nested workstream。
4. nested workstream 与主消息流同构。
5. nested tool rows 默认折叠。
6. sub agent 内部不允许继续调度 sub agent。

右侧 Progress 默认不显示子 agent 名称；子 agent 归属信息在消息流展开详情中查看。

## 8. Task Result Block

Task Result Block 是 Plan、Final Report、Failure、Cancelled、Visual Report Summary 的统一 UI 抽象。

通用字段：

- title
- subtitle / status
- task type label
- sections
- linked artifacts
- source workstream
- source event

### 8.1 Plan Result Block

Plan Result Block 是 Plan Task 的 final report，也是审批材料。

默认 section：

- 目标
- 已知事实
- 假设 / 判断
- 执行路线
- 验收标准
- 风险 / 阻断
- 预计产物

操作：

- 查看 raw `plan.md`
- 定位 artifact

不在 Plan Result Block 内散落同意/修改按钮；审批操作由 Composer Approval Overlay 承载。

### 8.2 Final Report Block

Final Report Block 是执行类 Task 的完成回执。

默认 section：

- 结论
- 关键证据
- 已完成验证
- 剩余风险
- 产物入口

产物入口包括 `report.md`、Generative UI、Evidence Bundle 等。

### 8.3 Failure Result Block

Task failed 后必须显示 Failure Result Block。

内容：

- 失败结论
- 失败点
- 已完成内容
- 阻断原因
- 可恢复路径
- 关联 raw trace / artifact

### 8.4 Cancelled Result Block

用户中断任务后显示 Cancelled Result Block。

内容：

- 中断时间
- 已完成内容
- 未完成项
- 已产生 artifact
- 可继续路径

## 9. Approval Overlay

Approval Overlay 覆盖 Composer Area，不在 Plan Card 内放主要操作按钮。

布局：

- 上方：同意执行
- 下方：修改建议输入栏

同意执行后：

- 插入 User Confirmation Message。
- Plan Result Block 标记 accepted。
- 创建新的 Execution Task Workstream。

输入修改建议后：

- 插入 User Revision Message。
- 旧 Plan Result Block 标记 needs_revision。
- 创建新的 Revision Task Workstream。
- 新 Plan 生成成功后旧 Plan 标记 superseded。

## 10. User Confirmation / Revision Message

用户确认和修改建议必须作为消息流历史的一部分，而不只是状态变化。

示例：

```text
User: 同意执行
```

```text
User: 修改建议：不要使用 remote 模式，改为本地 capture 分析。
```

这些消息保留真实时间顺序，不重排、不合并进 Plan Card。

## 11. Right Panel

右侧是 session 级索引。当前 task 置顶，历史折叠。多轮连续委托时，右侧持续增量。

### 11.1 Progress

Progress 显示 agent runtime task list。

规则：

- task 来自 Plan 初始化。
- runtime 执行中可以追加、更新、完成、阻塞、重新打开、取消。
- 已完成 task 保留并划线。
- 新 task 往下追加。
- 当前 task 置顶。
- 历史 task 可折叠。

Progress 不显示每个 Tool/Sub Agent 调用，不显示 Bash/CLI 日志。

空状态：

```text
No progress yet
```

### 11.2 Artifacts

Artifacts 显示正式产物。

分组：

- Current Task
- Previous Tasks

默认 item 信息：

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

空状态：

```text
No artifacts yet
```

### 11.3 Context

Context 显示上下文和高层能力索引。

分组：

- Captures
- Files
- Sources
- Capabilities

默认只显示 important 项，展开后显示全部自动记录项。

Capture 粒度：

- `.rdc` 文件
- event id
- draw call
- pipeline state
- shader
- texture / render target

Context item 详情可显示：

- importance: normal / important / cited / decisive
- 来源 task
- 关联消息
- 最后使用时间
- 关联 artifact

空状态：

```text
No context yet
```

## 12. Raw Trace

Raw trace 不是默认 UI。

可见位置：

- Tool Row 的 Raw tab。
- 失败摘要后的展开详情。
- Session 菜单导出 raw trace / debug bundle。

Raw trace 不应污染 Artifacts 列表，也不应成为 Context 的默认主分类。

## 13. 时间戳

规则：

- 单个消息/row 的时间戳默认 hover 或详情显示。
- Task Workstream 标题显示开始/结束时间。
- 不在每个小节点上常驻时间戳，避免噪音。

## 14. Prompt Branching

Edit 提交后创建新的 request branch。

UI 行为：

- 原 prompt 不被覆盖。
- prompt 附近显示 branch navigator。
- 切换 branch 时，下方消息流切换到该 branch 的后续 Task Workstream。
- session export 可包含所有 branch。

数据约束见 `docs/architecture/agent-workstream-technical-contract.md`。

## 15. 视觉保真约束

实现本 UX 时必须保持：

- 现有深色产品气质。
- 现有设计 token、配色、圆角、字体体系。
- 顶部暗带 / 模糊带。
- 主界面、左侧项目/会话、右侧控制面板、composer、Activity、settings、capture library、opened capture preview 可达。

允许改变：

- 消息流 DOM 结构。
- presentation model。
- 消息组织方式。
- 右侧面板信息架构。
- Tool/Sub Agent/Plan/Report 的组件层级。

禁止：

- 借结构重构顺手做无关视觉改版。
- 关闭顶部暗带。
- 把消息流顶到暗带下方被遮挡。
- 把右侧做成 CLI/Bash 调用表。
