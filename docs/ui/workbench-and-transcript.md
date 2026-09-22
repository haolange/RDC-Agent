# Workbench 与 Transcript UI

> 产品/架构裁决：`DESIGN.md`。视觉 token 与 Appearance：[`design-system.md`](design-system.md)。本文承载原 DESIGN 中的 **Workbench / Work Process / Composer / Markdown** 产品规格（中文摘要 + 稳定英文术语）。

标题栏、启动闪屏、Settings 产品标记和运行中的任务栏图标使用 `resources/brand/rdc-agent-logo.png`。饱和青绿像素换成当前主题的 accent 色相，白字和近黑底保持原样。安装包里的 `resources/icons` 是默认深色主题色 `#33d1ff` 的静态图，资源管理器中的 exe 图标不随运行中的主题变化。标题栏旁仍显示「RDC-Agent」文字，窄屏单行省略避免挤压窗口控制。三个 renderer 入口复用无 store/IPC 依赖的 `ui/ProductLogo`，canvas 在有限分辨率上重绘，不写内联 style。主进程在窗口创建、Appearance 保存和系统主题变化时更新缓存图标；缺失/解码失败写诊断，不反向失败已成功保存的设置。`pnpm run brand:icons` 从唯一源图生成平滑缩放的多尺寸 Windows ICO 与既有 PNG/ICNS 资产。

## 上手指南

首次 bootstrap 后展示四步图文教程：准备开始、连接模型、创建项目、启用 RDC。每页包含一句主说明、至多三条操作与一条完成预期；桌面左文右图，720px 以下上图下文，正文可滚动而底部导航固定。标题栏右上角问号重新打开，重开从第一步开始。使用 TaskDialog、现有 Button/IconButton、overlay stack 和焦点返回；步骤切换沿用 motion token 的短位移与淡入，无自动播放。说明不内嵌业务配置、不探测环境、不创建项目或调用模型。关闭/完成只记录应用 UI 已阅读状态，不标记配置成功。深浅主题、窄屏、键盘与双语使用同一组件。

四张本地教学配图位于 onboarding/assets，随 renderer 构建离线分发。以实际工作台、供应商设置及项目入口为依据，通过 Image Gen 生成统一的中性底色、正视简化界面：工作台三入口；供应商凭据到模型选择；项目加号到文件夹再到项目栏；zip 到解压目录再到验证。生成要求为无文字、无品牌标识、无装饰光效；模型页二次移除生成的标识。编号、按钮名称和说明均为 HTML/i18n，图片提供替代文本；图卡始终标明“操作示意／非当前配置状态”。成功符号只解释完成预期，不投影用户真实配置。项目加号直接打开文件夹选择器，不虚构中间创建菜单；Tools 选择文件夹而非 exe。

RDC Tools 设置通过目录检测/选择和验证并应用完成安装绑定。高级项仅呈现启用、超时和环境；验证错误展示实际原因。普通 General 任务不要求 RDC 已配置。

## 消息结构

1. 用户消息；
2. Work Process 块；
3. final answer。

## Outer Rail

窄屏或自动收起左侧导航时，标题栏的左侧按钮打开导航抽屉，项目、会话、知识中心与用户设置仍可达。抽屉与右侧检查抽屉互斥，支持 Escape、焦点约束与关闭后焦点返回；关闭时不占主工作区宽度。

Docked 左导航与右检查栏在可见接缝可拖以改变栏宽；进入抽屉或自动收起后该接缝不再提供拖拽。

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

Active Signal：`active-signal-shimmer` clipped-gradient 能量扫光（`1.6s linear`、`background-size: 200%`、`repeat-x`、36% wash 整格循环）；仅用于权威 running/pending/streaming 主短语。`.work-process-label.status-running` 只设 `--active-signal-highlight`，**禁止**再设 `color`（否则扫光被固定字色遮住）。核心动效由真实运行状态驱动，不受 App 或系统减少动效偏好控制；保留 46% 位置达到高光的历史宽渐变。

## Human-in-the-loop

`ask_user`：batch `questions[]`；`ConversationToolCall.userInputQuestions` 为唯一跨层 payload；`argsPreview` 仅展示。Composer 区 wizard 答题；Work Process 记录紧凑 Q/A transcript。

`plan_artifact` 与 `ask_user` 同构停顿。三层表面：Work Process 计划卡（`PlanCard`，无同意/拒绝按钮）、只读阅读面板（`PlanReviewPanel`）、Composer 待审门（`PlanReviewRequestPanel` + `HandoffActionRow`）。Composer 优先级 `pendingToolApproval > pendingPlanReview > pendingUserInput`。通过 = 点当前 Agent 声明的 continue 按钮（文案 = `label`）；拒绝意见必填。计划门那一击可以同时批准并 enqueue 续跑。superseded / rejected 降为工具壳行。计划不进 Right Rail。不得把计划写进 `final_answer` 冒充审阅门。Mission 回合成功终态仅在本回合 `plan_artifact` 的真实批准事件已投影到 workTrace 时才在 final answer 下快照 `handoffSuggestions`；该事件在冻结计划后发布。澄清/散文计划不挂 Execute。General 无声明即无建议行。建议行与计划门共用 `HandoffActionRow`；人点后主进程 `applyDeclaredHandoff` 写/确认 offer 并 persist `session.agentId`，`send: true` 才自动发。手动改 Agent pill 不写 offer。

## Composer 控件

普通输入与 Markdown 共用外壳书写区：空内容最小高度 72px，随内容增高，上限 180px，超出后在书写区内滚动。高度只由 `COMPOSER_PROMPT_MIN_HEIGHT` / `COMPOSER_PROMPT_MAX_HEIGHT` 定义，通过动态样式表共享给 CSS；Markdown 使用实测 padding，随布局、字号和内容变化重新测量，卸载释放观察器和动态样式。普通输入不使用表单 Textarea 的灰底、边框和圆角，背景透出 `composer-shell`。底栏工具条与书写区同一面板，不另做底色。

左：attach / agent / permission；右：model-effort / context usage / send-stop。Permission 不得挨着 send 伪装成执行动作。`+` 只附加图片与文件（选择器 / 拖放 / 粘贴截图）。`.rdc` 不走 Composer，只从 Project 右栏 Import。待发附件渲染为输入框上方托盘：图片 72px 缩略图卡、文件类型字形 + 大小；hover / `:focus-within` 右上角叉移除。非法/超限卡片用错误描边；当前模型无 `visionInput` 时图片卡警告。已发送附件在用户气泡下显示可点击 pill（`app:openPath`）。模型与思考共用一颗胶囊：收起态在 Fast/Max 开启时前置对应图标，后面固定是生效模型名 + 思考等级；覆盖态加 `.is-override`。胶囊 hug 文案，不预留固定槽；只有模型名溢出才渐隐，完整名留在 `title`。点开后是同一弹层：左上 Fast（实心闪电）、右上 Max（层叠卡片；始终占位，不支持灰关、固定灰开、selectable 才可切；hover / `:focus-visible` 出对准图标的实色圆胶囊 tip，完全浮在弹层上方；有约束状态只显示状态，可用时只显示模式名，不占面板内行）、中间思考等级 + 模型名、底部思考滑杆。点模型名切到现有模型列表（搜索、搜索栏下常驻「按 Agent 配置」、按 provider 分组）；列表 picker 高到 `32rem`，宽仍 `320`（`space-10 * 8`）；选完回到思考面板，不关弹层。列表里 Escape 先回思考面板，面板上 Escape 或点空白关闭。无 session 时可先选模型（只记草稿，不建 session）；有 session 则写入 `modelOverride`。选「按 Agent 配置」或 `/model default` 清除覆盖（session 写 `null` / 无 session 清草稿）。Agent 未配置或配置的模型当前不可执行时该行禁用。裸 `default` 先于模型 id；真名叫 `default` 的模型用 canonical `provider:model`。不写回 `.agent.md`，切 Agent 不清模型。能力未就绪时滑杆与 Fast/Max 灰掉不可调，不把整页换成状态大卡。

底栏弹窗（Agent / Permission / model-effort / Usage）走单一互斥注册表：任意时刻只开一个；Escape 关闭并把焦点还给 trigger；点空白关闭。Composer 外环在壳内 `:focus-within` **或** 底栏弹层 `aria-expanded="true"` 时保持，不按点击几何脉冲检测。

Edit-and-resend 使用 Composer 当前 agent + 当前对话模型，编辑框上方显示「将使用：agent · provider/model」。跨模型时 transcript 插入系统提示，说明推理续接已丢弃。

Effort：能力驱动 reasoning rail + `Max mode` + `Fast mode`，嵌在合并胶囊的弹层里。关档文案统一 `Disabled` / `禁用`。`unknown` / `none` → 同关态外观并灰掉不可调；`always-on` / fixed → 锁定开；wire `xhigh` 显示 `Extra`；产品最高档 `Max`。Max/Fast entitlement 未知时关态灰掉且状态文案亦为 `Disabled`。滑杆 inset 几何，松手 snap。Compose 色跟 agent `accent`（`--composer-effort-*`），禁止只用全局 `--token-border-focus`。

Context 环：面只显示 `%` / `—` / `…`；相位文案在 title/aria 与 breakdown。相位权威：Preparing / Current request ~ / Actual|Last actual。占用率分母是可执行 prompt 上限 `promptBudgetTokens`（不再扣模型输出上限，例如 DeepSeek 1M 环分母为 1M）。hero 下显示压缩线、条件完整窗口（仅 window > budget）与本轮可生成；分段条带压缩线刻度，圆环不标压缩位置。Actual 三栏 Tokens | Cache | Reasoning 在弹层宽度大于 `33rem` 时等宽三张独立圆角卡片同行排列，缺遥测显示 `—`，禁止假 0；仅真实窄屏才纵向单列堆叠。

`Current request` 固定渲染 `Tokens | Cache | Reasoning` 三栏：Tokens 的 Input 与 Total 都是 `~preparedInputTokens`，Output、Cache 和 Reasoning 都是 `—`；不得混入上一轮的 Actual / Last actual 数值。第一个同一 turn 的真实 provider usage 到达后原位切换为 Actual。终止后保留 Last actual，关闭再打开 session 仍可见；只有应用重启或从 `usage.json` 回读时标记 stale，新 session 从未拿到快照才显示「暂无用量」。产品弹窗不展示 continuation、derived context 或 prompt-cache policy 等内部诊断。

Send 不因打字/改模型触发 Context preview IPC。在途 turn 冻结创建时 `RequestPlan`。

Stop：Preparing 一次干净撤销（prompt 回填、无 stopped↔streaming 闪烁）；Turn 已开始后单调落停（按钮与 Work Process 不回跳运行态）。Edit and resend 提交后立即离开编辑态并 optimistic 切入新分支 draft，再进入工作过程。

Stacking：`composer < modal backdrop < modal < tooltip < notification`。

## Transcript Markdown

`MessageMarkdown`：GFM、代码块 language+复制、KaTeX、Mermaid fail-closed；commentary、最终答案与 thinking/CoT 共用；禁用 raw HTML。

## Appearance（入口）

Settings → Appearance 为权威。双体系：全局 chrome vs Composer agent accent。详见 [`design-system.md`](design-system.md)。禁止 translucent sidebar；分享串 `rdc-theme-v1:`（拒绝 `codex-theme-v1:`）。

## 验证

- `pnpm run check:work-process`、`check:work-process-tool-coverage`、`check:appearance`
- 浏览器真实会话清单见 `AGENTS.md`

## Right Rail

左右停靠栏最大宽度同为 520px。最小宽度与默认宽度仍按各自内容下限，不跟着上限一起改。

The right rail has two explicit target surfaces. A selected Project shows only `Import .rdc` and its project-scoped capture inputs. A selected Session always shows `Progress / Artifacts / Outputs / Context / Capture`. Empty sessions keep all five sections with honest empty states; they never fall back to Classic, Working Directory, Memory, Skills/MCP, Capture Library, or other retired panels.

- **Progress**: only projects real session-scoped `TaskRegistry` tasks through `taskProjection`. Simple read-only asks may remain empty. The list is a single creation-order array; completed items stay in place. Clicking a task locates and focuses the corresponding Work Process snapshot. Its lifecycle state and blocked reason remain the TaskRegistry truth even after the surrounding turn completes; stage, harness, or UI-synthesized progress is forbidden.
- **Artifacts**: only projects main-owned `rdc.investigation.v1` records. The renderer never rebuilds this inventory from action events, working-directory scans, or tool catalogs. The only row action is Copy ID. Investigation records never enter Outputs.
- **Outputs**: only shows user-recognizable output files that can be opened or copied. A finished project file enters this lane only through the explicit `output_register` action, which copies it into the active run; it never discovers arbitrary workspace paths. UI source labels are limited to `Report`, `Evidence`, `Image`, `Document`, `Data`, and `Other`. Backend stores remain implementation details; the rail does not surface live or frozen session plans, scan arbitrary action payload paths, or expose artifact-store/run-report/action-output producer names. Attachments and uploads are Task Context inputs, not output artifacts. Missing files stay visible as `failed` without internal store names.
- **Context**: contains only concrete attachments, files, directories, preloaded Skill sources, invoked MCP tools, and web references proven by frozen Prompt segments or successful tool results. It never turns `Shell / Files / Runtime lookup` tool categories or configured-but-unused Skill/MCP entries into resources, and renderer never reconstructs resources from preview strings. Rows show the concrete name plus parent path/server/source metadata. Without resources it uses the quiet contextual-card empty state and one normal-size sentence.
- **Capture**: is always-visible in a selected session. Without inputs it explains that a `.rdc` must first be imported to the project; with an input it is the application-owned, owner-session interaction surface. It owns capture selection, Replay Device, open/close, inline event replay, Agent history, refresh, and one deduplicated actionable diagnostic. contextId, replaySessionId, capture IDs, runtime owner, lease, remoteId, and remote status stay owner-scoped for agent consumption, not as human-facing inventory. CLI unavailable is only a failed shell-action diagnostic; the rail never shows a CLI catalog, tool count, or namespace inventory.

The visual form follows a quiet cowork inspector. Project import and Session inspector share one `.right-rail` shell: four-side padding is `--space-3`. Session card gap is the same `--space-3` so the corridor around a card equals the corridor between cards. Project import is a single card and keeps `gap: 0`. The resize-handle visible stroke stays in the 8px column / sidebar 1px border and must not paint into card radii; the pointer hit may still overlap the seam. Progress, Artifacts, Outputs, Context, and Capture are always five separate, non-collapsible rounded cards: their background, border, title treatment, padding, and inter-card spacing never change when content arrives. Empty sections span the docked rail inline-size during resize, stay compact in block size without flex-expanding dock height, and pair one isometric frosted-glass illustration (`RightRailEmptyVisuals.tsx`, token-backed gradient stops, multi-color translucent blocks with soft ground shadows) with one honest sentence as two deliberate vertical anchors. Populated content only grows its own card and uses hairlines between sibling rows inside that card. Output files use a neutral file mark rather than internal source initials. Context stays silent until real resources exist. Capture shows its selected file name and size in the picker, then Replay Device and Open/Reopen on a compact second row; full paths remain tooltip and accessibility information, while runtime identifiers stay in the owner-scoped projection for agent consumption and never become sidebar inventory. Diagnostics are one short actionable line, never a raw error wall. The docked rail remains resizable through compact desktop widths; at or below the shared `RIGHT_RAIL_DRAWER_BREAKPOINT` (920px), or when the layout cannot retain its minimum main work surface, it moves into the same overlay drawer. The drawer supports mask close, Escape, focus trap, focus return, keyboard navigation, and no horizontal overflow.

## 右下角 Capture 内容

RDC 非空时保留固定卡片：文件与大小、实际设备与打开/关闭、帧回放/Agent 足迹 Tab、等比完整显示的内嵌画面、事件或历史步骤滑条和简短反馈。修改文件或设备为待切换，确认后才改变实际绑定；重试对应失败动作，不统一重开 capture。Agent 运行时禁止手动回放变化，历史回看继续可用。历史播放不执行工具，返回实时恢复跟随。没有活跃回放不能标记实时。

项目 RDC 为零时保持改造前原空态，不显示选择器、Tab、画面或历史。右栏宽度、drawer、五卡顺序不变；不恢复独立 preview 窗口，不加最小窗口宽度。

计划卡是文档预览入口：类型和真实状态、左对齐标题、摘要与章节的有界 Markdown 摘录、独立公共阅读 Button。短内容自然收缩，长内容裁切且不产生卡内滚动；预览不含链接、代码复制等次级交互，卡片空白可打开阅读器，选择文字不触发打开。不展示内部 URI，不在卡片内批准或折叠分节。

Composer 计划门只显示“实施此计划？”、当前计划声明的全部执行目标及默认收起的修改意见入口。`HandoffActionRow` 的 decisions 展示逐项列出目标；普通续跑建议保留 buttons 展示。展开修改意见后聚焦 Textarea，空意见不可提交，提交期间禁止重复操作，失败保留意见。会话、turn/tool call 和计划 revision/hash 共同隔离本地状态；切换会话、Stop、替换或撤销请求后丢弃迟到续跑，批准事件先于 IPC 返回也不误丢合法续跑。

工作区内唯一 `PlanReaderHost` 承载阅读器，避免 Transcript 行重挂载打断阅读。WorkBench 布局通过 renderer 内部上下文提供主工作区和 Composer 外壳边界；阅读器左右与外壳对齐，上下占满主工作区并保留 `--space-4`（窄屏 `--space-2`）安全边距。ResizeObserver、布局状态和视口通知驱动 `useDynStyle`，不猜测侧栏宽度、不设置固定阅读宽高上限、不写内联样式。

阅读器保留全窗口 Portal 与模态遮罩，背景使用 blur token，面板实色；标题/版本/操作栏固定，正文单独滚动，窄屏操作栏换行，长路径与代码块不撑破面板。复用 overlay stack 和焦点约束，Escape/遮罩关闭并回焦当前阅读按钮。加载、失败与 hash 校验后的全文明确区分，不拼接 sections 冒充原文；复制、导出、保存集中于阅读器。建议行切换失败展示错误并保留草稿，发送过程中禁重复选择。
