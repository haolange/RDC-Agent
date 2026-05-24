# Agent Workstream Implementation Prompt

## 1. 用途

本文件是 Agent Workstream 的稳定实施提示模板，面向 Codex Goal / 后续实现 agent 使用。它不是仓库级 agent 规则，不替代 `AGENTS.md`、`DESIGN.md` 或 `docs/architecture/*`。

使用本 prompt 的目标是一次性完成 Agent Workstream 的数据契约、presentation model、UI 结构、右侧面板、approval flow、branch 预留和验证闭环。Codex 不需要因为任务复杂而人为拆碎等待；它需要的是阶段解耦、状态可验证、失败可恢复、上下文不漂移。

## 2. 角色

你是 Codex，负责在 `D:\Projects\Native\RDX\RDC-Agent` 中实现 Agent Workstream。

你不是在做局部 CSS 修补。你要把消息流从 workflow/debug trace 的直接投影改为产品级 Agent Workstream：

- Task Workstream
- User Prompt Bubble
- Agent Thinking Bubble
- Tool Row
- Sub Agent Row
- Task Result Block
- Composer Approval Overlay
- Right Panel: Progress / Artifacts / Context
- Raw trace / export / audit
- Prompt branching 预留或实现

## 3. 必读文件

开始前必须阅读：

```text
AGENTS.md
DESIGN.md
docs/architecture/overview.md
docs/architecture/module-map.md
docs/architecture/data-flow.md
docs/product/agent-workstream-prd.md
docs/ui/agent-workstream-ux-spec.md
docs/architecture/agent-workstream-technical-contract.md
docs/workflows/agent-workstream-verification.md
```

涉及 UI/UX、产品边界、架构边界、跨层契约或验证策略时，必须遵守这些文档的权威顺序。

## 4. 最高约束

- RDC-Agent 是 RenderDoc `.rdc` 垂直工作台，不是通用 coding-agent shell。
- `Ask` 不创建正式 run，不暴露 RenderDoc 工具。
- 正式执行类任务必须基于当前 project 的 `OpenedCaptureState(status=open)`。
- 用户 prompt 或任务文件里的 `.rdc` 路径不能绕过 Open capture 状态创建正式 run。
- RenderDoc 工具链必须走 `renderer -> preload -> IPC -> ToolBridge -> resources/tools/rdx.bat`。
- Agent SDK 只能作为 stage 内 runner，经 `AgentRunnerPort` 接入。
- 顶层 stage、gate、approval、final status 由本仓库 workflow runtime 决定。
- Browser Preview 只能验证 renderer fallback，不等价于真实 Electron / IPC / ToolBridge / RenderDoc 验收。
- 不改设计语言 token、配色、圆角、字体和整体产品气质。
- 可以重构 UI 结构、presentation model 和消息组织。

## 5. 执行原则

- 按解耦阶段推进，但阶段内部可以一次性做完。
- 不因为复杂度停止。
- 不把局部 UI 完成包装成整体完成。
- 每个阶段必须有输入、输出、验收和失败恢复点。
- 如果验证失败，修复后重跑。
- 如果遇到不可抗阻断，报告阻断点、已完成范围、未完成验证、剩余风险和恢复路径。

## 6. 阶段 0：仓库调查

目标：

- 理解当前 `AgentChat`、`AgentMessageTimeline`、右侧控制面板、Composer、Plan/Intake、Browser Preview scenario 和 shared conversation/workflow 类型。
- 找出当前 workflow/debug trace 到 UI 的投影路径。
- 找出右侧 Progress/Artifacts/Context 可落点。
- 找出 composer approval overlay 可挂载位置。

输出：

- 当前结构简短报告。
- 需要修改的文件清单。
- 风险点。

验收：

- 报告覆盖 `src/shared`、`src/main`、`src/preload`、`src/renderer`、browser fallback。
- 明确哪些只是 Browser Preview，哪些影响真实 Electron。

## 7. 阶段 1：共享类型与事件契约

实现：

- `TaskWorkstream`
- `ProcessEvent`
- `ProgressTask`
- `WorkstreamArtifactRecord`
- `WorkstreamContextRecord`
- `TaskResultRecord`
- `PlanStatus`
- UserRequest / branch 预留

要求：

- 类型放在合适的 `src/shared/types/*` 中。
- 不在 renderer / main 各自重复定义。
- 现有类型兼容路径要收敛，不留下无意义双轨。

验收：

- `npm run typecheck` 通过。
- main/preload/renderer/browser fallback 引用一致。

## 8. 阶段 2：Product Event 到 Presentation Model

实现：

```text
runtime/session data
  -> product events
  -> AgentWorkstreamPresentation
  -> renderer components
```

要求：

- UI 不再从 raw trace 直接猜 chat nodes。
- 连续 `agent.text` 合并为 Thinking Bubble。
- Tool/Sub Agent 按时间顺序保留。
- Task Result Block 和 Artifacts 引用同一 record。
- Right Panel 从 session 级 model 派生。

验收：

- Browser Preview scenario 能生成 AgentWorkstreamPresentation。
- 旧 scenario 有稳定迁移或明确 fallback。
- 不引入 legacy 双轨入口。

## 9. 阶段 3：Message Stream UI

实现：

- Task Workstream Container
- User Prompt Bubble
- Agent Thinking Bubble
- Tool Row
- Sub Agent Row
- Task Result Block
- User Confirmation / Revision Message
- completed process auto collapse
- long prompt collapse
- hover/detail timestamp
- running/done/failed/skipped 状态

验收：

- 长 prompt 不撑爆。
- Prompt 保留换行、fade/blur、箭头展开。
- Agent thinking 不碎片化。
- Tool 默认一行，展开默认 Summary。
- Sub Agent 默认摘要，查看完整轨迹后显示 nested workstream。
- Plan/Report 使用同一 Task Result Block 抽象。
- 顶部暗带保留，消息流避让暗带。

## 10. 阶段 4：Approval / Revision / Continuation

实现：

- Composer Approval Overlay。
- 同意执行插入 User Confirmation Message。
- 修改建议插入 User Revision Message。
- Plan 状态：awaiting_approval / accepted / needs_revision / superseded / executed / failed。
- latest displayed plan。
- latest accepted plan。
- Execution 只读取 accepted plan。

验收：

- 同意执行后旧 Plan accepted，新 Execution Workstream 创建。
- 修改建议后旧 Plan needs_revision，新 Revision Workstream 创建。
- 新 Plan 生成成功后旧 Plan superseded。
- 历史消息不覆盖、不删除、不重排。

## 11. 阶段 5：Right Panel

实现：

- Progress
- Artifacts
- Context

Progress：

- Plan 初始化。
- Runtime 动态维护。
- 已完成 task 划线。
- 新 task 往下追加。
- 当前 task 置顶。

Artifacts：

- 只放正式产物。
- item 显示名称、类型、所属 task、状态、更新时间、打开入口。
- 操作：打开、定位消息流来源、查看 raw、复制路径。

Context：

- Captures / Files / Sources / Capabilities。
- 默认 important，展开全部。
- cited / decisive 标记。

验收：

- Progress 不变成 tool log。
- Artifacts 不混入读过的文件。
- Context 不默认显示 Bash/CLI/MCP 调用表。
- 当前 task 置顶，历史折叠。

## 12. 阶段 6：Prompt Branching

优先策略：

- 如果当前结构允许，直接实现 Copy / Edit / branch navigator。
- 如果实现会显著扩大风险，至少完成 shared type、presentation model 和 UI 预留。

硬约束：

- Edit 不覆盖历史。
- Edit 创建新的 request branch。
- branch 切换影响后续 Workstream 展示。
- session export 可包含所有 branch。

验收：

- Copy 可复制原 prompt。
- Edit 后原 prompt 仍可回看。
- 新 branch 有独立后续 workstream。

## 13. 阶段 7：Browser Preview Scenarios

新增或更新稳定 scenario，覆盖：

- Ask
- Debug Plan awaiting approval
- Execute accepted plan
- Revision request
- Execution report
- Failed tool
- Failed task
- Cancelled task
- Sub Agent
- Long prompt
- Artifacts / Context accumulation
- Branch navigator

要求：

- Scenario 不包含 secret。
- 不把真实用户敏感数据放入 scenario。
- 命名表达稳定职责，不用临时调试名。

## 14. 阶段 8：验证

必须运行：

```text
npm run typecheck
```

按改动范围运行：

```text
npm run check:architecture
npm run build
```

涉及 UI 时：

- Browser Preview 截图/人工检查。
- 检查主界面、左侧项目/会话、右侧控制面板、composer、Activity、settings、capture library、opened capture preview 可达。

涉及真实 Electron / IPC / ToolBridge 时：

- 先 `npm run build`。
- 再运行关键 Electron E2E 或等价 smoke。

## 15. 最终交付格式

最终报告必须包含：

- 修改摘要。
- 文件清单。
- 验证结果。
- 未完成项。
- 剩余风险。
- 若有阻断：阻断点、恢复路径。

不得仅凭“代码已写完”声称完成。完成必须有当前文件、命令输出、截图、E2E 或其他 authoritative evidence 支撑。
