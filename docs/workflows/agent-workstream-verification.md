# Agent Workstream Verification

## 1. 验证目标

Agent Workstream 的验收目标不是“页面能渲染”，而是证明消息流、右侧索引、审批、产物、上下文和 raw trace 的产品语义成立。

需要证明：

- 消息流不再是 workflow/debug trace 的直接投影。
- Task Workstream 按可交付结果组织。
- Plan approval / revision / execution 连续委托正确。
- User Confirmation / Revision Message 保留在消息流历史中。
- 右侧 Progress / Artifacts / Context 语义不混淆。
- Raw trace 可查可导出，但不污染默认 UI。
- Browser Preview 与真实 Electron 验证边界明确。

## 2. 验证分层

### 2.1 文档和静态一致性

适用于仅文档改动或设计契约变更。

检查：

- 路径归类符合 `docs/product`、`docs/ui`、`docs/architecture`、`docs/workflows`。
- 文档中文为主，必要英文术语保留。
- 不硬编码上游仓库绝对路径。
- 不把 `RDC-Agent-Frameworks`、`RDC-Agent-Tools`、CodePilot、Nexus 写成本仓库前提。
- 不把 Analyzer / Optimizer 写成当前已完整实现能力。
- 不绕过 `ToolBridge`。
- 不把 Browser Preview 写成真实 Electron 验收。

### 2.2 类型检查

代码改动后必须运行：

```text
npm run typecheck
```

如果新增或调整跨层类型，还需要确认 `src/shared`、`src/main`、`src/preload`、`src/renderer`、browser fallback 同步。

### 2.3 架构检查

涉及跨层契约、模块边界、IPC、workflow runtime 或文档架构规则时运行：

```text
npm run check:architecture
```

### 2.4 Build

涉及入口、preload、IPC、main process、窗口逻辑、打包产物或 Electron E2E 前必须运行：

```text
npm run build
```

Electron E2E 启动的是 `out/main/index.js` 和 `out/renderer`，不得用旧 `out/` 验收最新源码。

### 2.5 Browser Preview

适用：

- renderer UI/UX
- 消息流布局
- 右侧面板
- composer approval overlay
- scenario 数据
- BrowserElectronApiFallback

不适用：

- 真实 Electron
- preload / IPC
- main process
- workspace persistence
- ToolBridge
- RenderDoc / `rdx.bat`
- 真实 provider/model route

### 2.6 Electron E2E

适用：

- preload / IPC
- main process
- session persistence
- real settings
- ToolBridge boundary
- workspace artifacts
- window behavior

运行前必须先 build。

## 3. Browser Preview 场景矩阵

Browser Preview scenario 至少覆盖：

| 场景 | 需要验证 |
| --- | --- |
| Ask task | Ask 不创建正式 run；多步时可显示轻量 Progress |
| Debug Plan awaiting approval | Plan Result Block 出现在消息流；composer 被 approval overlay 覆盖 |
| Execute accepted plan | 插入 User Confirmation Message；旧 Plan accepted；新 Execution Workstream 出现 |
| Revision request | 插入 User Revision Message；旧 Plan needs_revision；新 Plan 出现后旧 Plan superseded |
| Execution report | Final Report Block section 正确；Artifacts 出现 report / visual report |
| Failed tool | Tool Row failed；错误摘要可见；Raw 可展开 |
| Failed task | Failure Result Block 收束任务 |
| Cancelled task | Cancelled Result Block 显示已完成和未完成 |
| Long prompt | Prompt 保留换行、限高、fade/blur、箭头展开 |
| Agent thinking | 连续文本合并；遇 tool/sub agent/result 断开 |
| Tool Row | 默认一行；展开默认 Summary tab |
| Sub Agent | 默认摘要；查看完整轨迹后显示 nested workstream |
| Right Panel | Progress/Artifacts/Context 语义分离，当前 task 置顶，历史折叠 |
| Context | Captures/Files/Sources/Capabilities 分组；默认 important；展开全部 |
| Branching | Copy/Edit 可见；Edit 不覆盖历史；branch navigator 能切换 |

## 4. Electron E2E 建议场景

至少补一条关键 smoke 或等价人工回归，确认：

- 主界面可达。
- 左侧项目/会话可达。
- 右侧控制面板可达。
- composer 可输入。
- Activity / 运行记录可达。
- Settings 可达。
- Capture Library 可达。
- Opened Capture Preview 可达。

涉及 Debugger 主链时，优先覆盖：

- `agent-workstream.spec.ts`
- `debugger-plan-intake.spec.ts`
- `session-lifecycle.spec.ts`
- `workbench-visual.spec.ts`
- `mode-switch.spec.ts`

涉及 settings/provider 时再覆盖：

- `settings-persistence.spec.ts`

## 5. 产品语义验收

### 5.1 Task Workstream

通过条件：

- Plan、Execution、Revision 按可交付结果成为不同 Task Workstream。
- 历史 Workstream 保留真实顺序。
- completed task 的 process trace 默认折叠，但可展开完整历史。
- Task Workstream 标题显示开始/结束时间。

失败信号：

- UI 仍直接按 workflow stage 渲染固定阶段。
- Tool call 被自动变成 Progress task。
- 历史 task 被删除、覆盖或重排。

### 5.2 User Prompt

通过条件：

- Prompt 有轻气泡包裹并稍靠右。
- 长 prompt 限高，底部 fade/blur，可展开。
- 保留换行。
- Copy/Edit 可见。
- Edit 不覆盖历史。

失败信号：

- Prompt 像普通 IM 对话泡泡一样和 agent 对等。
- 长 prompt 撑爆消息流。
- Edit 直接修改历史消息。

### 5.3 Tool / Sub Agent

通过条件：

- Tool Row 默认一行摘要。
- 状态支持 running / done / failed / skipped。
- 展开默认 Summary tab。
- Raw command/stdout/stderr 只在 Raw tab 或 export 中出现。
- Sub Agent 默认摘要，查看完整轨迹后显示 nested workstream。
- Sub Agent 不继续调度 Sub Agent。

失败信号：

- 主消息流默认铺 stdout/stderr。
- 右侧显示 Bash/CLI 调用表。
- Sub Agent 默认展开大量内部日志。

### 5.4 Plan Approval / Revision

通过条件：

- Plan Result Block 只展示内容和状态。
- Approval Overlay 覆盖 composer。
- 同意执行插入 User Confirmation Message。
- 修改建议插入 User Revision Message。
- latest displayed plan 和 latest accepted plan 区分。
- Execution 只读取 latest accepted plan。

失败信号：

- Plan Card 内散落主要审批按钮。
- 未 accepted plan 被执行。
- revision 覆盖旧 plan。
- 只改 Plan 状态但消息流没有用户确认/修订消息。

### 5.5 Right Panel

Progress 通过条件：

- task 来自 Plan 初始化和 runtime 更新。
- 已完成 task 保留并划线。
- 新 task 往下追加。
- 当前 task 置顶。

Artifacts 通过条件：

- 只显示正式产物。
- 默认显示名称、类型、所属 task、状态、更新时间、打开入口。
- 操作包括打开、定位消息流来源、查看 raw、复制路径。

Context 通过条件：

- 分组为 Captures / Files / Sources / Capabilities。
- 读过的文件进入 Context，不进入 Artifacts。
- Report 引用项标记 cited。
- 决定性证据标记 decisive。

失败信号：

- Progress 变成工具日志。
- Artifacts 混入读过的文件。
- Context 默认显示 Bash/CLI/MCP 调用列表。

## 6. Raw Trace / Export 验收

通过条件：

- Tool Raw tab 可查看局部 raw。
- Session 菜单可导出 session summary。
- Session 菜单可导出 raw trace / debug bundle。
- 第一版不提供删除 raw trace/context。
- 失败时显示错误摘要，而不是默认展开 raw stderr。

失败信号：

- raw trace 默认铺在消息流。
- raw trace 作为 artifact 列表主项刷屏。
- secret/token/API key 出现在 renderer 可见 raw/context/export 中。

## 7. Codex Goal 执行纪律

面向 Codex Goal / 长任务 agent 的实施验证：

- 不因为复杂度停止。
- 按解耦阶段推进，但阶段内部可以一次性完成。
- 每个阶段必须有输入、输出、验收、失败恢复点。
- 不允许只完成局部 UI 后声称整体完成。
- 验证失败必须修复后重跑。
- 遇到不可抗阻断必须报告：
  - 阻断点
  - 已完成范围
  - 未完成验证
  - 剩余风险
  - 恢复路径

完成声明必须能逐项对应到当前文件、命令输出、截图、E2E 结果或其他 authoritative evidence。

## 8. 文档变更验收

仅文档改动时至少检查：

- 术语与 `DESIGN.md` 一致。
- 路径与当前仓库结构一致。
- 没有新增临时性、讨论式、个人化文件名。
- README / 索引文件已列出新增文档。
- 如果文档改变产品边界、UI/UX 规则、架构边界、跨层契约或验证策略，`DESIGN.md` 已同步。
