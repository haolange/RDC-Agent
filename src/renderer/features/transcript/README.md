# Transcript

会话呈现从 `index.tsx` → `ConversationThread` → `MessageBubble` 进入。消息与运行状态由 conversation store / 主进程投影提供；本 feature 不重建运行状态，也不授权工具执行。

## 职责

- `workProcessTracePresentation`：将 block / loop 投影为消息内工作过程，处理 commentary、thinking、计数和默认展开。
- `workProcessToolRows`：工具行的状态、标题、目标、审批信息和结果组合；`workProcessDecisionRows` 负责审批、用户提问和计划行。
- `workProcessToolContent`：按工具语义解释结果；`workProcessContentText` 负责 envelope / 文本 / JSON 解析，`workProcessWebPresentation` 负责来源与网页内容。纯函数只解释结果，不执行工具。
- `workProcessTypes`、`workProcessFormat`、`workProcessStatus`、`workProcessBlockText`：共享行类型、格式与文字判定。消费者直接导入实际模块，不经过转发聚合文件。
- `WorkProcess*` 组件渲染投影；计划阅读器独立于消息列表挂载，保留弹窗与焦点恢复生命周期。
- `useTranscriptScroll` 只在读者仍靠近底部时跟随新消息、流式更新与内容尺寸变化；`VirtualMessageList` 保留短列表全量渲染、长列表窗口化与工具定位。

## 样式

`AgentChat.css` 和 `AgentChat.extras.css` 是按级联顺序加载的样式入口。各 sibling 样式按消息布局/动作/编辑器、工作过程布局/决策/工具卡/Web/答案/思考/展开/子任务/图片/任务/工具族归属；Markdown 独立加载。调整时必须保留入口顺序、选择器优先级、动画和容器查询。

Work Process 保持左侧内容轨道锚定。可见卡片的右侧收口以既有左侧层级 gutter 为基准，避免把根节点的宽度收窄量误当成卡片边界；tool call、commentary、thinking/summary、审批、计划和任务内容统一继承该边界。中等容器按实际内容宽度减少收口，窄容器取消额外收口以避免溢出。Composer 仍由工作台外部 rail 独立控制，不能通过 Transcript 样式改变其宽度或运行态视觉。

`Debugger.css` 仅负责页面容器。原计划表单与旧提问表单的无消费者样式不再保留；当前计划卡和阅读面板分别拥有 `plan-card.css` / `plan-review-panel.css`。

## 验证

运行本目录 Vitest 测试与 `ActiveSignalText.test.ts`，以及 `check:work-process` / `check:work-process-tool-coverage` 对应脚本。呈现样本覆盖工作循环、工具结果、失败、审批、计划和提问；happy-dom 测试覆盖滚动跟随、读者离开底部、尺寸变化、长短列表切换与卸载清理。类型检查、lint 和 renderer 门禁仍属于整体交付门禁。

源码级级联等价、纯函数测试与 DOM 测试不能证明视觉保真；运行态动效、真实长内容、窄屏与弹层仍需在真实工作台验收。
