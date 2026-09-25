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
- 每轮回复各有自己的过程；绿色圆点为已完成。运行中的耗时写“已运行”，终态写“耗时”，不能用“持续”暗示完成后仍在执行。
- loop thinking 完成后默认折叠「已思考 · {duration} / Thought for」+ 前置 quiet icon。
- 用户对手动开合 sticky 覆盖自动策略。

## Commentary

- commentary 散文（markdown，不进 thinking 槽）。

## 统一卡壳

- 审批卡、tool 卡、Asked 卡、计划卡、计划阅读面板、handoff 建议行、子代理委派卡、Task 行、Compact 摘要共用 `--transcript-card-*`。一次委派只出现一张卡；展开后任务原话直接可读，事实与引用、执行约束按数据出现，下方工作过程、最终回复、调用详情独立折叠。运行卡首次展开自动打开工作过程，手动开合优先；已结束卡首次展开时下方各区收起。子过程复用主 Working Process 的行与工具详情，final 使用主回复 Markdown；真实空态、失败态和键盘焦点均须可辨。
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
- file/search/shell/git/web/memory/skill/mcp/runtime/interpreter/generic 族模板一致；Tasks 在主回合内每次实际创建/更新各留一张历史卡，批量创建一张，状态在提交时冻结，按事件 ID 去重。卡头显示添加/更新与完成数量，不显示伪工具耗时；逐项图形显示待办/进行中/完成/受阻/取消，右栏 Progress 仍用序号呈现最新状态。最新历史卡默认展开、旧卡默认收起，手动开合跨窗口化重挂载保持；旧记录以中性标题读取。Compact 区分自动/手动并展示计数。
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

- 子卡双行属于同一个 tool call，只有一个外卡交互入口；展开后无重复任务一级折叠和正文底壳。委派空集合不占行，零预算仍显示；终态后内部没有运行中思考或持续等待计时。检查 PowerShell Format-Table 格式化输出不被包装器破坏。

### 子代理结构一致性

- 普通工具与子代理共用单行卡头布局；状态、耗时、箭头同一行。子代理点阵仅在折叠时位于分隔线下、渐隐任务预览的右侧，与状态、耗时、箭头所在列等宽且左右对齐；不得撑高卡头。展开时预览和点阵节点均卸载，仅显示一份完整任务正文，加载时只显示正文读取状态。
- 任务原话与三个下方披露区连接在单一外卡内，标题与正文边界清晰，无标签空栏；工作过程、final 和详情独立开合。
- 委派次级事实与执行约束各为任务内独立二级卡，不使用工作过程、最终回复、调用详情的全宽一级边界；默认收起，原文字段完整可达、真实零值保留，手动开合在更新和重挂载后保持。
- 主区触发器保持透明；两张任务附属卡与调用详情中的每项记录共用二级卡样式，逐张采用卡头、圆角边界及展开分隔线，不额外包整组。箭头固定右端，hover 低对比，键盘焦点有圆角轮廓。委派主文和 final 直接进入内容流；原始调用项独立按需展开，不可用回执无空按钮。长预览不挤走箭头，窄屏无横向溢出。
- 同一事件序列在主子过程共用一棵工具行语义 DOM，保持顺序、参数、原始回执、诊断、错误及操作入口；子过程保留普通工具的卡头、分隔线、正文和展开详情，只用密度样式收紧间距。`background_wait` 沿同一树轻量展示并可展开原始回执；无真实进度比例时点阵仅循环表达活动，终态静止。
- 子过程内相邻 turn、thinking/commentary 到首工具、连续工具的间距与主过程相同；跨窗口化占位行仍保持 loop 边界节奏。
- 同一用户请求的后台子任务报告与完成只更新委派卡和 mailbox；父回复已结束后没有空 user turn 或额外 assistant 回复。
- 同一主题、字号和视口对照主子过程与 Markdown，检查宽屏、420px、键盘和焦点；生成参考图不能代替真实应用证据。

- 以相同事件序列核对主子过程：直属工具 rail 隐藏不影响子执行 rail；无叙述 turn 不留空白，嵌入起始内边距仅一次；完全重复的摘要/输出默认呈现一次但原始回执完整。
- 带真实 toolCallId 的 Hook 诊断按事件 ID 去重并归入对应工具卡：完成信息仅在展开详情，警告/错误在收起态提示；不改变工具自身状态。无有效关联的生命周期诊断及旧记录仍留在原事件位置；其中历史 Hook 完成诊断使用共享骨架的紧凑卡，默认只显示标题，展开可读原文，不按相邻位置猜测工具归属。没有真实 commentary 或可见 thinking 的 turn 不补造叙述，`已思考`仍用共享摘要组件。子过程工作区顶部 12px、底部 16px；视觉对照覆盖工具边界和下一 turn 间距。
- 独立 Hook 诊断卡与前一工具的边框实测相隔 12px，收起和展开一致；前一工具是嵌套步骤末项时也不清零。420 CSS px 下卡片同宽、页面无横向溢出，下一 turn 的间距仍大于相邻卡片。
- 架构等效整理时，用相同事件比较主子呈现的 ID、顺序与文字；定位请求只传任务 ID 和待回填的候选卡，不读取或改写右栏的状态。普通工具与 `background_wait` 均使用共享 `ToolRow`；后者的事件语义与紧凑样式须分别核对。
