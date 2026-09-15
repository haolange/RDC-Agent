# Work Process UI 验收清单

> 触发条件：Work Process 投影、工具行文案/图标或 transcript UI 改动后执行 `pnpm run check:work-process`、`pnpm run check:work-process-tool-coverage`。

## 运行态

- 顶层标题「工作中 / Working」+ Active Signal clipped-gradient 能量扫光（`active-signal-shimmer`，1.6s / 200% / 36% wash，循环整格平铺）。
- loop thinking 运行态默认展开（summary/raw/unknown 与 final-answer/收束 thinking 同一生命周期）。
- Active Signal「正在思考 / Thinking」。
- `.work-process-label.status-running` **不得**设置 `color`（仅 `--active-signal-highlight`）；运行标签 shimmer 依赖 `color: transparent` + `background-clip: text`，任何后续规则覆盖 `color` 都会冻结为透明。
- `.work-process-label` 与 collapsed / header hover 只能给 `:not(.is-active)` 设 `color`；`.active-signal-text.is-active` 用 `inline-block`。

## 完成态

- 标题「工作过程 / Work process」+ meta。
- loop thinking 完成后默认折叠「已思考 · {duration} / Thought for」+ 前置 quiet icon。
- 用户对手动开合 sticky 覆盖自动策略。

## Commentary

- commentary 散文（markdown，不进 thinking 槽）。

## 统一卡壳

- 审批卡、tool 卡、Asked 卡、计划卡、计划阅读面板、handoff 建议行、Sub Agent 子行、Task 行、Compact 摘要共用 `--transcript-card-*`（radius / padding / border / surface / shadow）。
- Compact 是正式卡片（`work-process-summary-card`），标题走 i18n `chat.workProcessCompactTitle`，保留 token/message 计数。
- Task 状态、审批 risk、`output_register`「已发布输出」走 i18n，禁止硬编码英文 `Blocked` / `In progress` 或 `` `${risk} risk` ``。
- 禁止 primitive token 直用与奇数 px；审批动作使用 `<Button>`。

## Tool 卡片

- 统一单披露 tool 卡片：header icon+动词 + **结果优先** 族 body。
  - 有结果时显示计数/路径样本等，运行中才回退 pattern/path/`$ cmd`。
  - 展开为族内容层 + 样式化 Raw 面板；默认不展开 Raw。
  - 无 verb/target 双轨 toggle、无 `toolGroup` 双层壳。
- 或 ≥8 聚合摘要行。
- 同 loop 连续 tool 外距 `--space-2`。
- thinking/commentary → 首个 tool 与相邻 loop section 顶距均为 `--space-3`（只比 tool 宽一档；与是否有 commentary 无关）。
- file/search/shell/git/web/memory/skill/mcp/runtime/interpreter/generic 族模板一致；Tasks 用一轮一张活快照卡（`N of M completed` + `TaskStatusMarker` + `statusReason` + `data-work-process-task-id`），顺序与 Right Rail Progress 共用 `taskProjection`；Compact 区分自动/手动并展示计数。
- 每个 builtin tool 唯一 header glyph（`mcp__*`→`plug`）。
- 安静 loop 级轨道点。
- Rail marker 首行垂直居中：`margin-top: calc((var(--text-sm) * 1.65 - 6px) / 2)`；caption 行（`.first-line-caption`）用 `--text-xs * 1.45`。
- 失败 summary → diagnostic 列表间距 `--space-2`（`.work-process-summary { margin: 0 0 var(--space-2) }`）。

## Active Signal 与 Composer 核心动效

- 动画名 `active-signal-shimmer`；`.active-signal-text.is-active` 为 clipped-gradient 能量扫光（`1.6s linear`、`background-size: 200%`、`repeat-x`、36% wash 两端对齐，无关键帧停顿）。
- App 与系统偏好均不减少或关闭动效；不存在静态替代分支。
- Composer 真实 busy 状态下锥形渐变以 2.85s 角度匀速旋转，在四角自然伸缩，固定圆角遮罩不旋转；停止后光层消失。用实际回合检查，不用临时 class 模拟验收。
- 门禁：`ActiveSignalText.test.ts` + `check:work-process` 扫描 `.work-process-label.status-running` 不得含 `color:`。

## Web 族

- `web_search`：favicon+域名 source pills（title 仅 tooltip）。
- `web_fetch`：Fetched page/已抓取 + 异形 page chip（非 pill 条；favicon 仅经 main `web:resolveFavicon`→data URL，失败用字母 monogram 禁止全落 globe）。

## 边界与排除

- 无 Reply 边界行（收束 thinking 归入普通折叠）。
- opaque/hidden 永不渲染 CoT 占位句（仅保留真实 tools/commentary/可见 thinking；answer-only 静默）。
- `error_recovery_*` 自动恢复遥测不进 Work Process 叙事（仅 Agent Activity / runtime log；禁止蓝字「错误恢复成功…」旁白）。
- Provider turn 最终失败：**一条** diagnostic（`CONVERSATION_LLM_REQUEST_FAILED` + 分类 userMessage + `technicalMessage`：`provider HTTP <status|n/a> · attempts <n>/<max> · <snippet>`）；`stopReason === 'error'` 时不 emit `empty_response_without_tool_call`。
- Request Inspector 不出现在消息流也不在右侧默认会话/Trace 面板。
- 真实事件驱动的逐条出现与短 CSS 入场（禁止假 stagger）。

## Assistant Full-bleed

- 最终答案与 Work Process 含 tool 卡片横跨外轨全宽并与 composer 对齐。
- page-shell / Local utilities / composer / transcript 共用 `--workbench-outer-rail-width`，禁止再用更窄的 content-rail 把 compose 挤歪。
- 仅用户 prompt 使用 raised bubble、fit-content、右对齐。
- loop nest 用 `--space-3`。
- 用户 bubble / Work Process / final answer 共用 `.conversation-thread` 的 `padding-inline: --space-3` 离开左右轨/滚动条缝（同一内容列，禁止 WP 独享 gutter）。

## MessageMarkdown

- commentary、最终答案与 thinking/CoT：共用 `MessageMarkdown`（GFM、代码块 language+复制、KaTeX、Mermaid fail-closed）。
- thinking 槽位用 `.work-process-thinking-preview .markdown-body` 作用域压到克制尺度。

## 验证命令

```bash
pnpm run check:work-process
pnpm run check:work-process-tool-coverage
```
