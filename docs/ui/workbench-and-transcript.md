# Workbench 与 Transcript UI

> 产品/架构裁决：`DESIGN.md`。视觉 token 与 Appearance：[`design-system.md`](design-system.md)。本文承载原 DESIGN 中的 **Workbench / Work Process / Composer / Markdown** 产品规格（中文摘要 + 稳定英文术语）。

## 消息结构

1. 用户消息；
2. Work Process 块；
3. final answer。

## Outer Rail

Workbench page shell、Local utilities、composer、transcript 共用 `--workbench-outer-rail-width`（源自 `WORKBENCH_CHAT_RAIL_MAX_WIDTH`）。禁止更窄 content-rail 把 composer 挤歪。

- 用户 prompt：右对齐 raised bubble（`fit-content`、`--token-surface-raised`）。
- Assistant final answer、Work Process（含 tool 卡片）、loop commentary：full-bleed 透明散文；`.conversation-thread` 共用 `padding-inline: var(--space-3)`。

## Work Process

真实 runtime transcript，不是假 stage 日志。

- 运行中标题：`工作中` / `Working` + Active Signal；
- 结束后：`工作过程` / `Work process` + duration/action meta；
- 禁止用 `执行完成` 做主标题。

Loop thinking：quiet spark + `正在思考` / `Thinking`（运行中默认展开）→ `已思考 · {duration}` / `Thought for`（完成后默认折叠）；手动开合 sticky 覆盖。禁止 `深度思考` / settled `思考了`。Readable `raw`/`summary`/`unknown` 共用标签；opaque/hidden 永不渲染 CoT 占位句。

Commentary：markdown 散文，不进 thinking 槽。Tool / Asked / Sub Agent / Tasks 快照 / Compact / 审批卡共用 `--transcript-card-*` 卡壳。Tool：统一单披露卡片（icon+动词 + **结果优先** body；展开内容层 + Raw；默认不展开 Raw；无 `toolGroup` 双层壳）。同 loop 连续 tool 外距 `--space-2`；thinking/commentary → 首 tool 与相邻 loop 顶距 `--space-3`。≥8 连续 tools 聚合成摘要行。Compact 是正式卡片，标题走 i18n。Tasks 快照卡与 tool 卡共用 `--transcript-card-icon-size` 与 `--text-sm`。

`web_search`：favicon + 域名 source pills（title 仅 tooltip）。`web_fetch`：Fetched page/已抓取 + 异形 page chip；favicon 仅经 `web:resolveFavicon` → data URL。`mcp__*` header glyph = `plug`。

`error_recovery_*` 仅 Agent Activity / runtime log，不进 Work Process 叙事。Request Inspector 不出现在消息流或右侧默认 Session/Trace。入场动画由真实事件驱动，禁止假 stagger。

Active Signal：`active-signal-shimmer` clipped-gradient 能量扫光；仅用于权威 running/pending/streaming 主短语。`.work-process-label.status-running` 只设 `--active-signal-highlight`，**禁止**再设 `color`（否则 shimmer 字体会冻在透明）。减少动效：`prefers-reduced-motion: reduce` 与 Settings `html[data-reduce-motion='on']` 均回退静态 `--active-signal-highlight`（移除透明 gradient）；全局 animation-duration kill 仍生效，fallback 负责可见高亮字。

## Human-in-the-loop

`ask_user`：batch `questions[]`；`ConversationToolCall.userInputQuestions` 为唯一跨层 payload；`argsPreview` 仅展示。Composer 区 wizard 答题；Work Process 记录紧凑 Q/A transcript。

## Composer 控件

左：attach / agent / permission；右：model / effort / context usage / send-stop。Permission 不得挨着 send 伪装成执行动作。`+` 只附加图片与文件（选择器 / 拖放 / 粘贴截图）。`.rdc` 不走 Composer，只从 Project 右栏 Import。待发附件渲染为输入框上方托盘：图片 72px 缩略图卡、文件类型字形 + 大小；hover / `:focus-within` 右上角叉移除。非法/超限卡片用错误描边；当前模型无 `visionInput` 时图片卡警告。已发送附件在用户气泡下显示可点击 pill（`app:openPath`）。Model 在 Effort 之前，规格复用现有 pill；菜单顶部搜索、搜索栏下常驻「按 Agent 配置」（不参与过滤）、按 provider 分组。显示并选择当前对话模型；pill 始终显示实际生效模型名，仅覆盖态加 `.is-override`。无 session 时可先选（只记草稿，不建 session）；有 session 则写入 `modelOverride`。选「按 Agent 配置」或 `/model default` 清除覆盖（session 写 `null` / 无 session 清草稿）。Agent 未配置或配置的模型当前不可执行时该行禁用。裸 `default` 先于模型 id；真名叫 `default` 的模型用 canonical `provider:model`。不写回 `.agent.md`，切 Agent 不清模型。

底栏弹窗（Agent / Permission / Effort / Usage / Model）走单一互斥注册表：任意时刻只开一个；Escape 关闭并把焦点还给 trigger；点空白关闭。

Edit-and-resend 使用 Composer 当前 agent + 当前对话模型，编辑框上方显示「将使用：agent · provider/model」。跨模型时 transcript 插入系统提示，说明推理续接已丢弃。

Effort：能力驱动 reasoning rail + `Max mode` + `Fast mode`。关档文案统一 `Disabled` / `禁用`。`unknown` / `none` → 同关态外观并灰掉不可调；`always-on` / fixed → 锁定开；wire `xhigh` 显示 `Extra`；产品最高档 `Max`。Max/Fast entitlement 未知时关态灰掉且状态文案亦为 `Disabled`。滑杆 inset 几何，松手 snap。Compose 色跟 agent `accent`（`--composer-effort-*`），禁止只用全局 `--token-border-focus`。

Context 环：面只显示 `%` / `—` / `…`；相位文案在 title/aria 与 breakdown。相位权威：Preparing / Current request ~ / Actual|Last actual。占用率分母是可执行 prompt 上限 `promptBudgetTokens`（不再扣模型输出上限，例如 DeepSeek 1M 环分母为 1M）。hero 下显示压缩线、条件完整窗口（仅 window > budget）与本轮可生成；分段条带压缩线刻度，圆环不标压缩位置。Actual 三栏 Tokens | Cache | Reasoning 在弹层宽度大于 `33rem` 时等宽三张独立圆角卡片同行排列，缺遥测显示 `—`，禁止假 0；仅真实窄屏才纵向单列堆叠。

`Current request` 固定渲染 `Tokens | Cache | Reasoning` 三栏：Tokens 的 Input 与 Total 都是 `~preparedInputTokens`，Output、Cache 和 Reasoning 都是 `—`；不得混入上一轮的 Actual / Last actual 数值。第一个同一 turn 的真实 provider usage 到达后原位切换为 Actual。终止后保留 Last actual，关闭再打开 session 仍可见；只有应用重启或从 `usage.json` 回读时标记 stale，新 session 从未拿到快照才显示「暂无用量」。产品弹窗不展示 continuation、derived context 或 prompt-cache policy 等内部诊断。

Send 不因打字/改模型触发 Context preview IPC。在途 turn 冻结创建时 `RequestPlan`。

Stop：Preparing 一次干净撤销（prompt 回填、无 stopped↔streaming 闪烁）；Turn 已开始后单调落停（按钮与 Work Process 不回跳运行态）。Edit and resend 提交后立即离开编辑态并 optimistic 切入新分支 draft，再进入工作过程。

Stacking：`composer < modal backdrop < modal < tooltip < notification`。

## Transcript Markdown

`MessageMarkdown`：GFM、代码块 language+复制、KaTeX、Mermaid fail-closed；commentary、最终答案与 thinking/CoT 共用；禁用 raw HTML。

## Appearance（入口）

Settings → Appearance 为权威。双体系：全局 chrome vs Composer agent accent。详见 [`design-system.md`](design-system.md)。禁止 translucent sidebar；分享串 `rdx-theme-v1:`（拒绝 `codex-theme-v1:`）。

## 验证

- `pnpm run check:work-process`、`check:work-process-tool-coverage`、`check:appearance`
- 浏览器真实会话清单见 `AGENTS.md`

## Right Rail

The right rail has two explicit target surfaces. A selected Project shows only `Import .rdc` and its project-scoped capture inputs. A selected Session always shows `Progress / Artifacts / Outputs / Context / Capture`. Empty sessions keep all five sections with honest empty states; they never fall back to Classic, Working Directory, Memory, Skills/MCP, Capture Library, or other retired panels.

- **Progress**: only projects real session-scoped `TaskRegistry` tasks through `taskProjection`. Simple read-only asks may remain empty. The list is a single creation-order array; completed items stay in place. Clicking a task locates and focuses the corresponding Work Process snapshot. Its lifecycle state and blocked reason remain the TaskRegistry truth even after the surrounding turn completes; stage, harness, or UI-synthesized progress is forbidden.
- **Artifacts**: only projects main-owned `rdc.investigation.v1` records. The renderer never rebuilds this inventory from action events, working-directory scans, or tool catalogs. The only row action is Copy ID. Investigation records never enter Outputs.
- **Outputs**: only shows user-recognizable output files that can be opened or copied. A finished project file enters this lane only through the explicit `output_register` action, which copies it into the active run; it never discovers arbitrary workspace paths. UI source labels are limited to `Report`, `Evidence`, `Image`, `Document`, `Data`, and `Other`. Backend stores remain implementation details; the rail does not pin `plan.md`, scan arbitrary action payload paths, or expose artifact-store/run-report/action-output producer names. Attachments and uploads are Task Context inputs, not output artifacts. Missing files stay visible as `failed` without internal store names.
- **Context**: contains only concrete attachments, files, directories, preloaded Skill sources, invoked MCP tools, and web references proven by frozen Prompt segments or successful tool results. It never turns `Shell / Files / Runtime lookup` tool categories or configured-but-unused Skill/MCP entries into resources, and renderer never reconstructs resources from preview strings. Rows show the concrete name plus parent path/server/source metadata. Without resources it uses the quiet contextual-card empty state and one normal-size sentence.
- **Capture**: is always-visible in a selected session. Without inputs it explains that a `.rdc` must first be imported to the project; with an input it is the application-owned, owner-session interaction surface. It owns capture selection, Replay Device, open, preview, refresh, copy, clear, and one deduplicated actionable diagnostic. contextId, replaySessionId, capture IDs, runtime owner, lease, remoteId, and remote status stay owner-scoped for agent consumption, not as human-facing inventory. CLI unavailable is only a failed shell-action diagnostic; the rail never shows a CLI catalog, tool count, or namespace inventory.

The visual form follows a quiet cowork inspector. Progress, Artifacts, Outputs, Context, and Capture are always five separate, non-collapsible rounded cards: their background, border, title treatment, padding, and inter-card spacing never change when content arrives. Empty sections span the docked rail inline-size during resize, stay compact in block size without flex-expanding dock height, and pair one isometric frosted-glass illustration (`RightRailEmptyVisuals.tsx`, token-backed gradient stops, multi-color translucent blocks with soft ground shadows) with one honest sentence as two deliberate vertical anchors. Populated content only grows its own card and uses hairlines between sibling rows inside that card. Output files use a neutral file mark rather than internal source initials. Context stays silent until real resources exist. Capture shows its selected file name and size in the picker, then Replay Device and Open/Reopen on a compact second row; full paths remain tooltip and accessibility information, while runtime identifiers stay in the owner-scoped projection for agent consumption and never become sidebar inventory. Diagnostics are one short actionable line, never a raw error wall. The docked rail remains resizable through compact desktop widths; at or below the shared `RIGHT_RAIL_DRAWER_BREAKPOINT` (920px), or when the layout cannot retain its minimum main work surface, it moves into the same overlay drawer. The drawer supports mask close, Escape, focus trap, focus return, keyboard navigation, reduced-motion support, and no horizontal overflow.
