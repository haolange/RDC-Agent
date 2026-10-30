# Workbench 与 Transcript UI

> 产品/架构裁决：`DESIGN.md`。视觉 token 与 Appearance：[`design-system.md`](design-system.md)。本文承载原 DESIGN 中的 **Workbench / Work Process / Composer / Markdown** 产品规格（中文摘要 + 稳定英文术语）。

标题栏、启动闪屏、Settings 产品标记和运行中的任务栏图标使用 `resources/brand/rdc-agent-logo.png`。饱和青绿像素换成当前主题的完整 accent RGB；主色精确匹配，阴影和高光仅与黑白混合，白字和近黑底保持原样。安装包里的 `resources/icons` 是默认深色主题色 `#33d1ff` 的静态图，资源管理器中的 exe 图标不随运行中的主题变化。标题栏旁仍显示「RDC-Agent」文字，窄屏单行省略避免挤压窗口控制。三个 renderer 入口复用无 store/IPC 依赖的 `ui/ProductLogo`，canvas 在有限分辨率上重绘，不写内联 style。主进程在窗口创建、Appearance 保存和系统主题变化时更新缓存图标；缺失/解码失败写诊断，不反向失败已成功保存的设置。`pnpm run brand:icons` 从唯一源图生成平滑缩放的多尺寸 Windows ICO 与既有 PNG/ICNS 资产。所有入口沿源图圆环采用抗锯齿圆形轮廓，外部透明；缩放与原生位图按预乘 alpha 处理，避免黑边。

## 界面语言

- 应用自有标题、状态、按钮、提示、无障碍标签和错误外层使用当前界面语言；中英文词典必须完整覆盖同一组 key，占位参数一致。`pnpm run check:i18n` 纳入完整门禁，检查词典及 canonical builtin 工具覆盖；英文无需量词的空后缀是合法文案。
- 工作过程直接用类型化翻译 key 生成展示，不以中文字符串或正则反查翻译。语言变化重新投影历史及在途卡片，不执行工具、不改写会话、回执或冻结计划；卡片身份、用户展开选择、草稿与焦点保持。
- 用户内容、模型正文、工具原始输出、诊断原文和第三方名称保持原样；自有预览计数、审批标签及默认提示独立翻译。内置 Agent 的产品说明随语言变化，User / Project 覆写和编辑中的说明保留原文。
- 命令面板与斜杠菜单读取同一主进程命令目录，仅本地化内置命令说明和分类；自定义说明、命令 ID、参数及执行结果保持原样，读取失败不伪装成空目录。
- 原生应用菜单在语言设置成功保存后刷新；新打开的原生对话框读取当前语言，审批身份、按钮序号与取消行为保持。系统自带按钮、菜单 role 和文件浏览器内容遵循操作系统语言。语言选项始终使用自称 `简体中文` / `English`。
- 验收覆盖双向切换、历史重载、运行与终态、审批、聚合摘要、窄屏、字号和键盘；Browser 与原生 Electron 分开记录，隔离 UI fixture 不作为模型或 RDC 执行证据。

## 上手指南

首次 bootstrap 后展示四步图文教程：准备开始、连接模型、创建项目、启用 RDC。每页包含导语、至多三条操作与一条完成预期；桌面采用文字栏优先的左文右图布局，步骤编号固定对齐，介绍区块间距紧凑，720px 以下上图下文。正文可滚动而底部导航固定。标题栏右上角问号重新打开，重开从第一步开始。使用 TaskDialog、现有 Button/IconButton、overlay stack 和焦点返回；步骤切换沿用 motion token 的短位移与淡入，无自动播放。说明不内嵌业务配置、不探测环境、不创建项目或调用模型。关闭/完成只记录应用 UI 已阅读状态，不标记配置成功。深浅主题、窄屏、键盘与双语使用同一组件。

四张本地教学配图位于 onboarding/assets，随 renderer 构建离线分发。以实际工作台、供应商设置及项目入口为依据，通过 Image Gen 生成统一的中性底色、正视简化界面：工作台三入口；供应商凭据到模型选择；项目加号到文件夹再到项目栏；zip 到解压目录再到验证。生成要求为无文字、无品牌标识、无装饰光效；模型页二次移除生成的标识。编号、按钮名称和说明均为 HTML/i18n，图片提供替代文本；图卡始终标明“操作示意／非当前配置状态”。成功符号只解释完成预期，不投影用户真实配置。项目加号直接打开文件夹选择器，不虚构中间创建菜单；Tools 选择文件夹而非 exe。

RDC Tools 设置通过目录检测/选择和验证并应用完成安装绑定。高级项仅呈现启用、超时和环境；验证错误展示实际原因。普通 General 任务不要求 RDC 已配置。

## 消息结构

1. 用户消息；
2. Work Process 块；
3. final answer。

## Outer Rail

窄屏或自动收起左侧导航时，标题栏的左侧按钮打开导航抽屉，项目、会话、知识中心与用户设置仍可达。抽屉与右侧检查抽屉互斥，支持 Escape、焦点约束与关闭后焦点返回；关闭时不占主工作区宽度。

Docked 左导航与右检查栏在可见接缝可拖以改变栏宽；进入抽屉或自动收起后该接缝不再提供拖拽。

Workbench page shell、Local utilities、composer、transcript 共用 `--workbench-outer-rail-width`（源自 `WORKBENCH_CHAT_RAIL_MAX_WIDTH`）。禁止更窄 content-rail 把 composer 挤歪。Work Process 保留左侧内容起始线；可见卡片的右侧边界以既有左侧层级 gutter 校准，再通过 `--work-process-inline-end-inset` 做容器响应式收口，避免根节点宽度与卡片边界产生额外偏差。tool call、commentary、thinking/summary 及同一工作过程内的卡片共享该内容轨道，Composer 外框和运行态视觉不随 Transcript 收口改变。Final 回复继续占满 Transcript 内容列，不继承 Work Process 卡片收口。

- 用户 prompt：右对齐 raised bubble（`fit-content`、`--token-surface-raised`）。
- Assistant final answer、Work Process（含 tool 卡片）、loop commentary：full-bleed 透明散文；`.conversation-thread` 共用 `padding-inline: var(--space-3)`。

## Work Process

真实 runtime transcript，不是假 stage 日志。

普通工具声明与流式参数保留审计，权限、前置 Hook 与资源队列准入后实际开始才进入主轨道；未执行跳过不生成工具卡。审批、用户输入和执行前失败仍可见，审批等待不亮运行蓝点或计入运行耗时。卡片以 toolCallId 就地更新，思考/commentary 流式输出时不清空已有参数或结果。工具耗时基于 executionStartedAt，历史没有可靠起点时不补造；活动蓝点只对应真实 running。

模型结果流结束时，主进程同步结算所属段落；本段仍有未完成工具则继续运行，段落结束不等于整个请求结束。计划审批与提问按工具调用身份保序，不跨模型段合并。审批决定与工具执行终态分开，拒绝或批准不能提前替代工具回执。左侧蓝点只由真实段落及所属未完成操作驱动，历史完成段不得因后续审批重新点亮；普通灰点、扫光及布局保持既有规则。

- 运行中标题：`工作中` / `Working` + Active Signal；
- 结束后：`工作过程` / `Work process` + duration/action meta；
- 禁止用 `执行完成` 做主标题。

Loop thinking：quiet spark + `正在思考` / `Thinking`（运行中默认展开）→ `已思考 · {duration}` / `Thought for`（完成后默认折叠）；手动开合 sticky 覆盖。禁止 `深度思考` / settled `思考了`。Readable `raw`/`summary`/`unknown` 共用标签；opaque/hidden 永不渲染 CoT 占位句。

Commentary：markdown 散文，不进 thinking 槽。Tool / Asked / Sub Agent / Tasks 快照 / Compact / 审批卡共用 `--transcript-card-*` 卡壳。Tool：统一单披露卡片（icon+动词 + **结果优先** body；展开内容层 + Raw；默认不展开 Raw；无 `toolGroup` 双层壳）。相邻可见 tool、Tasks 快照与无叙述 section 的边框间距统一 `--space-2`，只由事件列表边界提供；有可见 thinking/commentary 的段落入口及其首 tool 保留 `--space-3`。隐藏或空模型段不补空位，窗口化占位不重复添加间距。≥8 连续 tools 仅在整组终止后聚合成摘要行；运行期间维持原卡片顺序，聚合保留子项身份及用户展开选择。Compact 是正式卡片，标题走 i18n。Tasks 快照卡与 tool 卡共用 `--transcript-card-icon-size` 与 `--text-sm`。

Tasks 在主回合内每次真实创建或更新各留下独立历史卡，按事件 ID 保序去重，卡内列表冻结为变更提交当刻的逐项状态；一批创建只产生一张「添加待办」，更新显示「已更新待办」。旧记录没有事件种类时用「任务列表」，不得把旧卡改写为最新状态。卡头右端为完成数和固定箭头，不使用 `0ms`；列表用状态图形呈现待办、进行中、完成、受阻和取消，原因仅在所属项详情展开时显示，默认无副标题或底部 tips，行内不叠加卡壳。每张卡初次出现默认展开，后续活动不自动收起旧卡；用户手动开合优先并跨分页／窗口化保持。右栏 Progress 仍是带序号的最新列表；其任务定位优先找到最后一张包含该任务的历史卡。父回复结束后的后台变更只更新子代理卡和右栏，不在旧回复中倒插历史卡。

一次 `subagent` tool call 只显示一张子代理卡；Tasks 快照是主时间线的独立历史事件。外卡与普通工具共用卡头：图标、子代理身份、真实状态、耗时和箭头同一行，折叠时分隔线下显示实际任务开头，两行共用单一入口；展开时卸载该预览，由完整 capsule 正文接替，不能同时出现两份任务。点阵仅在折叠时位于分隔线下任务预览的渐隐文字之后，与上方状态、耗时、箭头共用右侧列；展开后连同预览卸载，卡头仅保留身份、状态、耗时和箭头。点阵4px点径/4px间距，右缘对齐上方元信息列；槽位宽不超过20%/60px，按容器收为8/6/4列或隐藏，正常三行、高度不足两行，不撑高预览；点数不表示任务数量或进度。正文按冻结 capsule 字段展示原话，不总结或改写；事实与引用、执行约束仅在任务内部按真实非空内容缩进折叠。下方「工作过程」「最终回复」「调用详情」独立折叠：过程预览真实活跃或最新可见动作及步骤数，展开复用主 Working Process 的同一事件与工具 DOM，以样式调整紧凑密度；final 预览实际回复首个有效文本段，展开直接使用主回复 Markdown；详情逐项按需展示父参数、父回执、完整实际发送载荷、执行标识与错误。短预览不淡出，溢出才轻微淡出；子工具回执留在对应工具行。运行卡首次展开自动打开工作过程，此后尊重手动开合；已结束卡首次展开时下方各区收起。未产生 final 时准确提示且不能空展开，不推造隐藏 CoT。后台卡按 Task Execution 生命周期更新，父回复结束不停止该卡。工作过程首次取最近 40 步，向前每页 40 步；已加载长记录按页面滚动与实测高度窗口化。开合在流式更新、分页和重挂载后保持，加载更早记录保留阅读位置。

三个下方主区采用透明全宽入口、固定右端箭头及细分隔线；任务原话与最终回复直接处于卡片内容流，不再套实色底壳。任务内的事实与引用、执行约束，以及调用详情内每项记录，分别使用同一种二级披露卡：圆角边界、卡头、展开分隔线和所属正文；没有包住整组的额外外卡。不可用回执显示状态且不提供空操作。子过程与主过程共享同一事件渲染路径及工具卡骨架；子过程只收紧工具卡内边距，相邻事件仍统一为 --space-2，保留卡头、边框、分隔线与正文归属，长代码、JSON、表格才有内层载荷表面。带 toolCallId 的 Hook 诊断按精确调用身份归入主子共用的工具卡，正常完成放在展开详情，警告/错误在收起态提示；工具状态仍只表达工具自身结果。无有效关联的生命周期诊断按原事件位置显示。子过程工作区顶部留白 12px、底部 16px；无真实 commentary 或可见 thinking 时不补造模型叙述。`background_wait` 是可展开的轻量行，原始参数与回执仍可查。后台完成或报告只刷新自身卡片与 Task mailbox；父回复已结束时，不自动生成新的父 Work Process 或 assistant 回复。

`web_search`：favicon + 域名 source pills（title 仅 tooltip）。`web_fetch`：Fetched page/已抓取 + 异形 page chip；favicon 仅经 `web:resolveFavicon` → data URL。`mcp__*` header glyph = `plug`。

缺少工具调用标识的历史 Hook 完成诊断不与相邻工具强行关联；它在原事件位置以紧凑诊断卡显示，默认隐藏原始文字，展开后可读。此卡与工具使用相同的卡头、分隔线和焦点规则，但状态不计入工具执行结果。

独立 Hook 卡到上一工具的可见边框相隔 `--space-2`，与其他同层事件一致；下一段有可见叙述时才使用 `--space-3`。此节奏适用于主子同一行渲染路径的正常与紧凑密度。

`error_recovery_*` 仅 Agent Activity / runtime log，不进 Work Process 叙事。Request Inspector 不出现在消息流或右侧默认 Session/Trace。入场动画由真实事件驱动，禁止假 stagger。

Active Signal：`active-signal-shimmer` clipped-gradient 能量扫光（`1.6s linear`、`background-size: 200%`、`repeat-x`、36% wash 整格循环）；仅用于权威 running/pending/streaming 主短语。`.work-process-label.status-running` 只设 `--active-signal-highlight`，**禁止**再设 `color`（否则扫光被固定字色遮住）。核心动效由真实运行状态驱动，不受 App 或系统减少动效偏好控制；保留 46% 位置达到高光的历史宽渐变。

## Human-in-the-loop

`ask_user`：batch `questions[]`；`ConversationToolCall.userInputQuestions` 为唯一跨层 payload；`argsPreview` 仅展示。Composer 区 wizard 答题；Work Process 记录紧凑 Q/A transcript。

`plan_artifact` 与 `ask_user` 同构停顿。三层表面：Work Process 计划卡（`PlanCard`，无同意/拒绝按钮）、只读阅读面板（`PlanReviewPanel`）、Composer 待审门（`PlanReviewRequestPanel` + `HandoffActionRow`）。Composer 优先级 `pendingToolApproval > pendingPlanReview > pendingUserInput`。通过 = 点当前 Agent 声明的 continue 按钮（文案 = `label`）；拒绝意见必填。计划门那一击可以同时批准并 enqueue 续跑。superseded / rejected / cancelled 降为工具壳行；带反馈的 rejected 显示“已提出修改”，cancelled 显示“审阅已取消”，真实错误仍可见。计划不进 Right Rail。不得把计划写进 `final_answer` 冒充审阅门。只要本条 assistant 消息包含计划审阅交互，result 底部不显示“继续”及 handoff 按钮，主进程和 renderer 共用同一可见性规则；已有建议快照也按此规则呈现。计划执行入口仅在 Composer 待审区，批准后由既有队列发送一次。普通非计划回复仍保留符合现有资格的声明建议，General 无声明即无建议行。建议行与计划门共用 `HandoffActionRow`；人点后主进程 `applyDeclaredHandoff` 写/确认 offer 并 persist `session.agentId`，`send: true` 才自动发。手动改 Agent pill 不写 offer。

## Composer 控件

计划卡采用既有Transcript实色卡壳；标题最多两行，完整名称保留于可访问名称及阅读器。正文预览最多`min(6lh, 28dvh)`，真实溢出以DOM Range定位最后可见文字，在该文字末尾2lh由100%前缓后快地淡至透明，等距四分点不透明度为100%/94%/75%/44%/0%，过渡长度不超过可见正文高度的一半；不让Markdown段落/标题留白吞掉淡出；内容、字号、字体和宽度变化重测。短内容不遮罩、不撑高。标题、状态与背景不参与淡出；预览卡不再设置独立阅读按钮，整卡支持点击、Tab/Enter/Space及焦点返回，文本选中不打开。历史拒绝/替代/取消计划保留紧凑工具壳与按需阅读，不重复摘要。

计划待审区沿用Composer壳与菜单注册表：顶部标题及停止方块 IconButton（可访问名称/悬停为“停止当前请求”），按声明顺序的紧凑handoff行（无末尾箭头）、常驻自适应修改意见输入（仅保留向上提交图标）；二者使用相同32px最小高度、md圆角、边框和表面。随后是左下角模型胶囊。意见Enter提交、Shift+Enter换行、IME不提交；失败保留输入。低高度时仅内容区滚动，模型弹层不被裁切。无会话模型覆盖时胶囊显示“按Agent配置”并直接打开既有模型列表，不展示当前Agent默认模型作为所有交接目标的模型；选定后复用原Effort/Fast/Max，清除后恢复缺省标签。

模型选择保存到现有会话覆盖，只影响后续新请求。保存期间批准与修改意见提交暂停，停止仍可用；保存失败显示错误并保留原选择。批准后由原handoff队列按新配置发起请求；拒绝意见恢复当前冻结请求，不能中途切换模型。弹层及局部意见/错误随会话或计划身份重置，不另建目录或权限路径。

工程边界：`Composer` 编排，`ComposerEditor` 与 `ComposerFooter` 只获得所需字段和动作，草稿与发送仍由 `useComposer` 协调。待处理请求通过纯选择器、订阅 hook 和展示组件分离；会话切换重置菜单与 Effort 生命周期。普通输入的 Enter 在 IME composition 或兼容 keyCode 229 期间不触发发送，Shift+Enter 继续换行。

Composer、Transcript 与右栏样式按组件职责就近维护，入口导入顺序属于 cascade 合同。Composer 当前光环的角度渐变、2.85 秒周期、分层辉光和 accent 联动保持单一路径；右栏仍固定 Progress / Artifacts / Outputs / Context / Capture，不因壳组件收敛减少内容。Context 展开值与持久化动作归 Composer owner，pattern 仅接收值和回调。Material 编辑与查看共用 TaskDialog 的叠层和焦点机制，保留各自图片区域、48rem/70rem 空间与非 backdrop 关闭语义。

Transcript 内容解析与轨迹呈现分离，滚动跟随使用统一生产条件，不检测 `navigator.webdriver`。读者在底部附近时跟随新内容和已渲染消息尺寸变化；离底后保留阅读位置。虚拟列表对未挂载消息使用初始估算，对已挂载消息用 ResizeObserver 实测高度计算占位与定位；定位帧、尺寸观察与切片监听在替换或卸载时释放。

普通输入与 Markdown 共用外壳书写区：空内容最小高度 72px，随内容增高，上限 180px，超出后在书写区内滚动。高度只由 `COMPOSER_PROMPT_MIN_HEIGHT` / `COMPOSER_PROMPT_MAX_HEIGHT` 定义，通过动态样式表共享给 CSS；Markdown 使用实测 padding，随布局、字号和内容变化重新测量，卸载释放观察器和动态样式。普通输入不使用表单 Textarea 的灰底、边框和圆角，背景透出 `composer-shell`。底栏工具条与书写区同一面板，不另做底色。

左：attach / agent / permission；右：model-effort / context usage / send-stop。Permission 不得挨着 send 伪装成执行动作。`+` 只附加图片与文件（选择器 / 拖放 / 粘贴截图）。`.rdc` 不走 Composer，只从 Project 右栏 Import。待发附件渲染为输入框上方托盘：图片 72px 缩略图卡、文件类型字形 + 大小；hover / `:focus-within` 右上角叉移除。非法/超限卡片用错误描边；当前模型无 `visionInput` 时图片卡警告。已发送附件在用户气泡下显示可点击 pill（`app:openPath`）。模型与思考共用一颗胶囊：收起态在 Fast/Max 开启时前置对应图标，后面固定是生效模型名 + 思考等级；覆盖态加 `.is-override`。胶囊 hug 文案，不预留固定槽；只有模型名溢出才渐隐，完整名留在 `title`。点开后是同一弹层：左上 Fast（实心闪电）、右上 Max（层叠卡片；始终占位，不支持灰关、固定灰开、selectable 才可切；hover / `:focus-visible` 出对准图标的实色圆胶囊 tip，完全浮在弹层上方；有约束状态只显示状态，可用时只显示模式名，不占面板内行）、中间思考等级 + 模型名、底部思考滑杆。点模型名切到现有模型列表（搜索、搜索栏下常驻「按 Agent 配置」、按 provider 分组）；列表 picker 高到 `32rem`，宽仍 `320`（`space-10 * 8`）；选完回到思考面板，不关弹层。列表里 Escape 先回思考面板，面板上 Escape 或点空白关闭。无 session 时可先选模型（只记草稿，不建 session）；有 session 则写入 `modelOverride`。选「按 Agent 配置」或 `/model default` 清除覆盖（session 写 `null` / 无 session 清草稿）。Agent 未配置或配置的模型当前不可执行时该行禁用。裸 `default` 先于模型 id；真名叫 `default` 的模型用 canonical `provider:model`。不写回 `.agent.md`，切 Agent 不清模型。能力未就绪时滑杆与 Fast/Max 灰掉不可调，不把整页换成状态大卡。

底栏弹窗（Agent / Permission / model-effort / Usage）走单一互斥注册表：任意时刻只开一个；Escape 关闭并把焦点还给 trigger；点空白关闭。Composer 外环在壳内 `:focus-within` **或** 底栏弹层 `aria-expanded="true"` 时保持，不按点击几何脉冲检测。

Edit-and-resend 使用 Composer 当前 agent + 当前对话模型，编辑框上方显示「将使用：agent · provider/model」。跨模型时 transcript 插入系统提示，说明推理续接已丢弃。

Effort：能力驱动 reasoning rail + `Max mode` + `Fast mode`，嵌在合并胶囊的弹层里。关档文案统一 `Disabled` / `禁用`。`unknown` / `none` → 同关态外观并灰掉不可调；`always-on` / fixed → 锁定开；wire `xhigh` 显示 `Extra`；产品最高档 `Max`。Max/Fast entitlement 未知时关态灰掉且状态文案亦为 `Disabled`。滑杆 inset 几何，松手 snap。Compose 色跟 agent `accent`（`--composer-effort-*`），禁止只用全局 `--token-border-focus`。

Context 环：外框固定使用原有 sm 高度 token（28px），禁止通过增大外框解决文字与圆弧重叠。SVG 同尺寸填满，圆心等宽文字采用 xs 字号的 0.75 倍，四字符百分比采用 2/3 倍，长估值采用 7/12 倍；圆弧与文字共同在原外框内校准，保持清晰内边距。0% 无亮点、100% 无端点凸起。面只显示 `%` / `—` / `…`；相位文案在 title/aria 与 breakdown。相位权威：Preparing / Current request ~ / Actual|Last actual。占用率分母是可执行 prompt 上限 `promptBudgetTokens`（不再扣模型输出上限，例如 DeepSeek 1M 环分母为 1M）。hero 下显示压缩线、条件完整窗口（仅 window > budget）与本轮可生成；分段条带压缩线刻度，圆环不标压缩位置。Actual 三栏 Tokens | Cache | Reasoning 在弹层宽度大于 `38rem` 时等宽三张独立圆角卡片同行排列，缺遥测显示 `—`，禁止假 0；仅真实窄屏才纵向单列堆叠。

`Current request` 固定渲染 `Tokens | Cache | Reasoning` 三栏：Tokens 的 Input 与 Total 都是 `~preparedInputTokens`，Output、Cache 和 Reasoning 都是 `—`；不得混入上一轮的 Actual / Last actual 数值。每栏依次为标题、同一基线上的主数值与短说明、同一刻度起始的次级信息，不使用固定空高：Tokens 主数值为总量，Cache 为已节省量，Reasoning 为推理量；仅在真实推理量与输出量均已知且推理量不大于输出量时显示占输出比例。未知是 `—`，真实零值是 `0`，估值保留 `~`，包括投影中的已知明细。第一个同一 turn 的真实 provider usage 到达后原位切换为 Actual。终止后保留 Last actual，关闭再打开 session 仍可见；只有应用重启或从 `usage.json` 回读时标记 stale，新 session 从未拿到快照才显示「暂无用量」。产品弹窗不展示 continuation、derived context 或 prompt-cache policy 等内部诊断。

Send 不因打字/改模型触发 Context preview IPC。在途 turn 冻结创建时 `RequestPlan`。

Stop：Preparing 一次干净撤销（prompt 回填、无 stopped↔streaming 闪烁）；Turn 已开始后单调落停（按钮与 Work Process 不回跳运行态）。停止只在 Work Process 标题显示一次，不生成重复摘要、兜底回复或底部徽标；原模型输出和真实错误保留。通用工作块/运行中工具因取消进入 cancelled，未执行工具为 skipped，真实失败为 error，用户修改意见为 rejected，不能互相代替。main 与乐观停止复用同一纯结算函数。Edit and resend 提交后立即离开编辑态并 optimistic 切入新分支 draft，再进入工作过程。

Stacking：`composer < modal backdrop < modal < tooltip < notification`。

## Transcript Markdown

Model/Effort控制状态由Composer稳定父层唯一持有，普通输入区、待审区及计划修订共用；局部控件重挂不能重新初始化用户已选择的Effort。模型保存监听原项目/会话scope，离开后即使切回也不投影迟到结果。计划预览仅去除已在Markdown节选中完全相同的摘要，不改写计划原文或完整阅读结果。

`MessageMarkdown`：GFM、代码块 language+复制、KaTeX、Mermaid fail-closed；commentary、最终答案与 thinking/CoT 共用；禁用 raw HTML。

## Appearance（入口）

Settings → Appearance 为权威。双体系：全局 chrome vs Composer agent accent。详见 [`design-system.md`](design-system.md)。禁止 translucent sidebar；分享串 `rdc-theme-v1:`（拒绝 `codex-theme-v1:`）。

## 验证

- `pnpm run check:work-process`、`check:work-process-tool-coverage`、`check:appearance`
- 浏览器真实会话清单见 `AGENTS.md`

## Right Rail

左右停靠栏最大宽度同为 520px。最小宽度与默认宽度仍按各自内容下限，不跟着上限一起改。

The right rail has two explicit target surfaces. A selected Project shows only `Import .rdc` and its project-scoped capture inputs. A selected Session always shows `Progress / Artifacts / Outputs / Context / Capture`. Empty sessions keep all five sections with honest empty states; they never fall back to Classic, Working Directory, Memory, Skills/MCP, Capture Library, or other retired panels.

- **Progress**: only projects real session-scoped `TaskRegistry` tasks through `taskProjection`. Simple read-only asks may remain empty. The list is a single creation-order array; completed and cancelled items stay in place. Clicking a task locates and focuses the corresponding Work Process snapshot. Its lifecycle state and blocked reason remain the TaskRegistry truth even after the surrounding turn completes; stage, harness, or UI-synthesized progress is forbidden. Runtime-owned Stop reasons are translated only when displayed; the stored reason and user-authored reasons remain unchanged. Stop settles unstarted Tasks created by the stopped turn as cancelled after producer join; older Tasks without known turn ownership remain unchanged.
- **Artifacts**: only projects main-owned `rdc.investigation.v1` records. The renderer never rebuilds this inventory from action events, working-directory scans, or tool catalogs. Row actions copy the ID or open a read-only preview through the owning session's `investigation:read` and expected content hash. Report preview presents the existing typed record in seven readable groups, marks omitted data as unrecorded, and keeps raw JSON secondary; it does not create another report schema or upgrade a Claim. Investigation records never enter Outputs.
- **Outputs**: only shows user-recognizable output files that can be opened or copied. A finished project file enters this lane only through the explicit `output_register` action, which copies it into the active run; it never discovers arbitrary workspace paths. UI source labels are limited to `Report`, `Evidence`, `Image`, `Document`, `Data`, and `Other`. Backend stores remain implementation details; the rail does not surface live or frozen session plans, scan arbitrary action payload paths, or expose artifact-store/run-report/action-output producer names. Attachments and uploads are Task Context inputs, not output artifacts. Missing files stay visible as `failed` without internal store names.
- **Context**: contains only concrete attachments, files, directories, preloaded Skill sources, invoked MCP tools, and web references proven by frozen Prompt segments or successful tool results. It never turns `Shell / Files / Runtime lookup` tool categories or configured-but-unused Skill/MCP entries into resources, and renderer never reconstructs resources from preview strings. Rows show the concrete name plus parent path/server/source metadata. Without resources it uses the quiet contextual-card empty state and one normal-size sentence.
- **Capture**: is always-visible in a selected session. Without inputs it explains that a `.rdc` must first be imported to the project; with an input it is the application-owned, owner-session interaction surface. It owns capture selection, Replay Device, open/close, the shared human/Agent inline event replay, refresh, and one deduplicated actionable diagnostic. Agent operation evidence stays in the main-owned archive; there is no separate history browser or playback surface. contextId, replaySessionId, capture IDs, runtime owner, lease, remoteId, and remote status stay owner-scoped for agent consumption, not as human-facing inventory. CLI unavailable is only a failed shell-action diagnostic; the rail never shows a CLI catalog, tool count, or namespace inventory.

The visual form follows a quiet cowork inspector. Project import and Session inspector share one `.right-rail` shell: four-side padding is `--space-3`. Session card gap is the same `--space-3` so the corridor around a card equals the corridor between cards. Project import is a single card and keeps `gap: 0`. The resize-handle visible stroke stays in the 8px column / sidebar 1px border and must not paint into card radii; the pointer hit may still overlap the seam. Progress, Artifacts, Outputs, Context, and Capture are always five separate, non-collapsible rounded cards: their background, border, title treatment, padding, and inter-card spacing never change when content arrives. Empty sections span the docked rail inline-size during resize, stay compact in block size without flex-expanding dock height, and pair one isometric frosted-glass illustration (`RightRailEmptyVisuals.tsx`, token-backed gradient stops, multi-color translucent blocks with soft ground shadows) with one honest sentence as two deliberate vertical anchors. Populated content only grows its own card and uses hairlines between sibling rows inside that card. Output files use a neutral file mark rather than internal source initials. Context stays silent until real resources exist. Capture shows its selected file name and size in the picker, then Replay Device and Open/Reopen on a compact second row; full paths remain tooltip and accessibility information, while runtime identifiers stay in the owner-scoped projection for agent consumption and never become sidebar inventory. Diagnostics are one short actionable line, never a raw error wall. The docked rail remains resizable through compact desktop widths; at or below the shared `RIGHT_RAIL_DRAWER_BREAKPOINT` (920px), or when the layout cannot retain its minimum main work surface, it moves into the same overlay drawer. The drawer supports mask close, Escape, focus trap, focus return, keyboard navigation, and no horizontal overflow.

## 右下角 Capture 内容

RDC 非空时保留固定卡片：文件与大小、实际设备与打开/关闭、紧凑控制权状态、唯一等比完整画面、颜色输出与 EID 控件、唯一原生事件滑条和简短反馈。人工与 Agent 共享同一套实际 EID 回放，不设双 Tab、Agent 足迹折叠区、历史播放或返回当前入口。EID 输入和滑条操作实际回放，不浏览历史快照。

Agent preparing/running、委派和原生退出未确认均以主进程 interactionLock 为权威，禁用文件/设备/打开/关闭/刷新与事件操作；同一控件原位显示并跟随实际 EID，锁释放后原位恢复，不自动 apply。控制权用一行状态呈现，详细锁定原因放 title，不重复展示大幅说明。requested/applied/image EID 在途状态分别表达，旧图不得改标为新事件；图片读取失败可独立重试，不触发 replay。后台证据保存与既有记录保留，不构成第二套 UI。

项目 RDC 为零时保持改造前原空态，不显示选择器、画面或历史。右栏宽度、drawer、五卡顺序不变；不恢复独立 preview 窗口，不加最小窗口宽度。Progress 只展示任务与定位入口，不提供额外的「停止此会话全部工作」按钮；停止执行沿用 Composer 的会话级 Stop 生命周期。

计划卡是文档预览入口：类型和真实状态、左对齐标题、摘要与章节的有界 Markdown 摘录、独立公共阅读 Button。短内容自然收缩，长内容裁切且不产生卡内滚动；预览不含链接、代码复制等次级交互，卡片空白可打开阅读器，选择文字不触发打开。不展示内部 URI，不在卡片内批准或折叠分节。

Composer 计划门只显示“实施此计划？”、当前计划声明的全部执行目标及默认收起的修改意见入口。`HandoffActionRow` 的 decisions 展示逐项列出目标；普通续跑建议保留 buttons 展示。展开修改意见后聚焦 Textarea，空意见不可提交，提交期间禁止重复操作，失败保留意见。会话、turn/tool call 和计划 revision/hash 共同隔离本地状态；切换会话、Stop、替换或撤销请求后丢弃迟到续跑，批准事件先于 IPC 返回也不误丢合法续跑。

工作区内唯一 `PlanReaderHost` 承载阅读器，避免 Transcript 行重挂载打断阅读。WorkBench 布局通过 renderer 内部上下文提供主工作区和 Composer 外壳边界；阅读器左右与外壳对齐，上下占满主工作区并保留 `--space-4`（窄屏 `--space-2`）安全边距。ResizeObserver、布局状态和视口通知驱动 `useDynStyle`，不猜测侧栏宽度、不设置固定阅读宽高上限、不写内联样式。

阅读器Portal保留共享overlay/focus，透明点击关闭层不模糊底下界面；正文卡片实色、边框、圆角与阴影对齐Context Window，与Composer同宽并锚定上方，短内容自然收缩，长内容限制在可用高度内；标题/版本/操作栏固定，正文单独滚动，窄屏操作栏换行，长路径与代码块不撑破面板。复用 overlay stack 和焦点约束，Escape/遮罩关闭并回焦当前计划卡或历史阅读入口。加载、失败与 hash 校验后的全文明确区分，不拼接 sections 冒充原文；复制、导出、保存集中于阅读器。建议行切换失败展示错误并保留草稿，发送过程中禁重复选择。

委派正文直接读取冻结 capsule 的结构化资源，任务为主体，非空约束、事实、引用与输出要求分组呈现；原始发送内容在调用详情按需展开。预览去除 Markdown 语法外壳但不总结改写，代码原文保留。调用详情的执行标识独立折叠；最终回复与主回复共用 Markdown，展开不重复预览。


## 右栏紧凑列表与完整浏览

Progress 保持创建序，序号来自原始 order，状态图标占独立列；标题最多两行，完整名称可聚焦查看，完成不划线。定位动作揭示最新匹配历史快照及其原因，不改写快照状态。

调查制品默认显示最新五项，创建时间及同时间稳定 ID 均倒序；上下文保留原序前五项。两者默认行仅图标、原名与进入指示，不展示元数据或重复操作。超过五项才显示「查看全部 N 项」。列表使用 md 控件最小高度、space-4 图标与原正文刻度，不按设计概念图放大。

制品完整列表由同一 main 选择路径分页，每次50项，明确点击加载更多；上下文完整列表每次挂载50项。弹窗限定高度并内部滚动。制品整行打开现有 hash 校验预览，完整 ID 与复制反馈在详情中；状态、版本、来源和正文保留。上下文路径使用原打开能力，无路径项仅展示已持有的完整标识、摘要和定位信息。两级弹窗只响应顶层 Escape/Tab，关闭后回原焦点与列表位置；切项目/会话卸载，迟到结果丢弃。


## 模型菜单加载与保存

模型菜单读取共享 EffectiveCatalog 内存投影。设置就绪后预取当前所需目录，重复打开同步复用快照；慢 provider 不阻塞已就绪分组。只有首次没有快照时显示 loading，后台刷新不清空已有列表，失败 provider 独立重试。模型保存期间显示即时状态并阻止重复选择；失败保留原选择。Agent/会话的 model override、发送前主进程校验与历史身份不变。Composer 28px 底栏、运行态边缘扫光和 `ActiveSignalText` 的左向右文字扫光保持各自唯一实现，不为共享组件重新绘制或改变比例。

### 计划与请求归属

当前计划状态记录 ownerTurnId。只有已证明属于同一 Turn 的未终结计划才递增修订；不同 Turn、已批准或已取消后重新提交均开启新计划周期。取消/决定须匹配 Turn、planId 和 revision，迟到结果不能覆盖新计划。旧无归属记录可读但不得推断归属，不迁移历史。修改意见属于原审批交互，不新造 user 消息；新请求必须以实际 user 消息为锚点。Browser 数据注入可走 Bridge，但新请求交互验收须通过真实 Composer 发送并核对主进程历史，外部调用仅返回结果不能代替 renderer 的消息对账。

批准后的 handoff 队列必须等待发送器的活跃执行屏障（含主进程投影的活跃会话/Run，不将队列自身的忙碌反馈作为准入条件），不能只看内存 activeTurn；重载待审页后也须等原请求结算，再消费一次队列并经原发送链发起新请求，不新增定时重试。取消交互通过类型化 AbortError 和结构化 abort 回执保留真实原因，通用完成投影使用该原因归类 cancelled，完整原始回执只在详情展示。


### 图片工具与紧凑输入

修改意见使用共享Textarea/Icon/IconButton，标准字号单行32px、图标16px；外框拥有内边距，Textarea原生padding归零，大字号与一至五行自然增高。批准、反馈、模型保存与停止语义不变。

同段连续成功的read_image在renderer组成图片展示组，其他调用/状态打断，不跨Turn或子过程。数量取成功图片实例而非缩略图加载数，原始调用顺序和回执不变；该组先于通用聚合。默认最多四张80px缩略图，窄容器64px、8px间距、object-fit:contain；+N展开其余图片，详情按调用展示完整路径/复制/原始回执，每批20项显式加载。只有原结构化预览引用可读，历史缺引用明确不可用，不猜路径。结果转存保留imagePreviews。

缩略图独立呈现，全局最多四项并发；失败可单项重试，会话切换隔离迟到结果。预览复用TaskDialog/overlay/focus，展示既有受控分辨率；无独立全局Escape和固定z-index遮罩，不宣称原图。

### 依赖等待与交接发送

Tasks 的五种生命周期状态忠实投影；pending 的未满足依赖以可选只读 waitingOn 表示，灰色空心圆的提示与可访问名称为“等待前置任务”。依赖 ID、标题及 unfinished/unverified/missing 原因只在已有详情展开。statusReason 仅为任务自身原因；blocked 保持黄色，依赖完成不自动解除真实受阻或启动下游。历史快照冻结事件当时的任务与执行证明，不能用当前右栏替换。

阅读器由 Workbench 提供当前可见 Composer border-box 引用；普通/审批壳切换重新绑定测量，左右同宽，底部间距 space-2、主内容顶部至少 space-4；短内容收缩、长正文滚动。透明外部点击层、hash检查、键盘与关闭回焦不变。

send:true 声明交接使用主进程确认目标与 prompt 直接调用同一 sendComposerConversationTurn，不写入或恢复到输入框，也不携带/清空原草稿、附件及临时 Skill。send:false 仍预填。队列等待旧请求/Run释放，单次领取并核对 session 与来源计划的 Turn/call/revision/hash；失败保留原位重试，结果不明只通过 requestId 查历史确认，不盲目重发或重复批准。配套 prompt 仍是 Transcript 中真实的新用户消息。

### 进度、时间线与图片预览密度

Progress 标题采用 text-sm / normal / leading-normal，固定单行，剩余宽度跟随侧栏拖拽自适应；使用共享 OverflowFade，仅在真实溢出时末尾渐隐，悬停 title 提供完整原文，不设字符数截断或固定文本宽度；序号与紧凑状态图形对齐首行，列表不叠加 gap。非空 Progress 卡头按自然行高排版，右侧用既有已完成计数显示当前投影的完成数/总数；卡头到列表 space-2。序号和状态各 space-3，列间距 space-1 + space-0-5；行最小高 control-height-md，上下内边距 space-1 + space-0-5，以低对比 hairline 分隔。Progress 样式单独由 RightRailProgress.css 持有，不混入通用资源行；空卡及其余四卡沿用共享外壳。时间线节点独占 space-4 槽位、space-1 内容间隔，细线采用 border-muted，运行光环不得进入内容列。成功审批仅在工具展开详情显示；等待、拒绝、审核失败及取消保留必要提示，审批本身允许展开且不替代执行结果。图片预览复用 TaskDialog 层栈与焦点，单行文件名和关闭按钮采用紧凑头部，无技术副标题，图片按剩余空间 contain。


### 工具结果摘要与对齐

主时间线独立 Tasks 历史卡使用与 section 内容相同的 space-4 节点槽位和 space-1 间隔；嵌套列表不再次缩进。所有工具共用 WorkCardHeader，状态与标题同义时只保留标题。任务列表状态对齐首行；可展开原因的箭头位于右端，不将标题向右挤出共同起始线，标题采用常规字重。

技能收起态只显示技能名称正文，不使用孤立胶囊，不暴露完整磁盘路径；说明与可复制路径保留在展开详情。工具搜索以一行实际匹配名称和返回总数展示，溢出名称复用 OverflowFade 与完整 title，全部名称可在详情查看。调查 read/write/schema 从结构化结果提取标题、类型与实际就绪状态；写入请求的 title 只作为对象名称，不能替代返回 manifest 的 status。ID、hash 和协议回执只在展开详情/Raw 中显示。turn_complete 卡头为“已记录本轮结果”，正文分别表示完成、部分完成、受阻、取消或预算暂停；成功记录声明不等于任务完成。失败或跳过不投影成功结果摘要。窄容器的次级元信息自然换到下一行，主体标题保持单行溢出渐隐。

### 工作过程连续轨道与节点

每个 WorkProcessContent 的过程容器拥有一条连续轨道，起始节点中心至最后已显示事件底边；工具、Tasks、审批、Plan 和加载入口不打断轨道，最终答复在外。单个可见事件只留起始节点；整段折叠时内部轨道隐藏。section 与事件身份/顺序保留，模型轮次和无叙述工具续接不另打灰点。

灰点标识起始入口和真实 commentary/可见 thinking 的入口，同段叙述共用一个节点。实际运行工具或流式叙述使用蓝点，pending/等待审批/回答不据此变蓝；临时活动结束后消失，结构节点恢复中性。节点使用不透明语义色，线不透圆心；16px槽位、4px内容间隔约束光环，普通事件8px、真实叙述入口12px。

聚合收起使用一个活动点及实际子工具执行数量，错误与运行可并存；展开后活动点位于各运行子工具，聚合头不重复蓝点。父、子过程各有轨道作用域，共享事件组件；父线贯穿委派卡，子线只覆盖内部过程。分页加载入口纳入过程容器；窗口化占位保留逻辑高度，首事件卸载不把首挂载项当起点。主过程披露作用域由会话+消息构成，子过程使用会话+委派调用，用户开合选择在聚合、窗口化和整段折叠后恢复。


### 自动审查与计划交接

待审区直接打开 Effort，点击模型名进入模型列表。只保留一套会话 modelOverride 与 turnControls，所有声明方向共享；多个方向指向同一执行 Agent 时，无覆盖的参数能力直接取该目标路由；仅调参数不创建模型覆盖，无覆盖时沿用实际执行 Agent 配置并按能力合法化。模型胶囊保留名称、参数及 Fast/Max 图标，另用紧凑状态行显示确认计划、交接、准备请求；收到冻结摘要后显示实际请求。自动审查只占 Work Process，人工请求才替换 Composer。


### 这次修正解决了什么（2026-10-30）

自动审核是在后台替当前这一次操作作判断，并不等于向用户发出授权问题。之前两者用了同一种待处理事件，界面把后台审核也画成了“批准一次”；用户点击时，主进程自然找不到人工授权请求。现在后台审核留在工作过程里，只有真实人工请求才显示授权按钮。

计划审批处的模型和参数决定接下来的执行请求，不会修改已经发给规划模型的请求。用户可以直接调思考强度、Fast、Max；不必先换一个模型来打开参数面板。未明确选模型时继续按执行 Agent 的配置运行。按钮灰色也可能来自模型不支持、档位固定或权限未确认，不能靠界面覆盖绕过这些能力限制。

点击执行以后，原来还要等待规划模型额外回答一次“计划已同意”，才轮到执行模型。现在批准结果直接结束规划回合，完成已有资源清理后进入交接。界面保留模型与参数，并明确显示确认、交接和准备阶段；后端校验和准备仍需要时间。批准响应先到、界面事件后到时，按钮也会保持锁定，避免短暂重开或重复发送。

真实跨模型验证已覆盖 GPT 到 DeepSeek、Grok 和 GPT-Luna，以及不换模型、只开启Fast的路径。Kimi K3双向验证因订阅访问权限返回403，用户确认延期；不能把这两组描述成已通过。详细工程验证、性能样本限制及证据边界见 acceptance ledger 的同日记录。

## 组件复用与窗口归属

### 这轮界面整理解决了什么

随着功能增加，同一种操作逐渐出现了不同做法：有的高级设置使用浏览器默认三角，有的自己画展开区；菜单各自计算位置，窗口变窄后容易贴边；有些短页面被撑得很空，长编辑内容又挤在多层滚动区域里。这轮整理把这些重复做法收敛到现有组件体系，让设置、素材、知识和调查详情遵循一致的展开、焦点与布局规则。

使用时，主要信息和动作仍直接显示；协议来源、原始记录、位置与比较条件等附属内容在所属详情里展开。错误、权限限制、未保存状态和写入确认继续保持可见。设置窗口的宽高分别随可用空间调整，长正文在内容区域滚动；菜单会按屏幕边界调整位置，按 Escape 逐层关闭并返回原来的按钮。长附件名按实际宽度渐隐，完整名称仍可查看。

工作区仍沿用现有布局、颜色与控件刻度。Agent 正在工作的从左到右扫光、输入框边缘绕光，以及 Max 滑条进入、持续和退出的特殊效果继续使用原实现。会话加载还修正了一处参数显示问题：能力信息未到达时，不再把已保存的 Low 错误显示成 Off。

开发者现在可运行 `pnpm run design:dev` 打开生产组件活文档，在同一处查找组件、查看深浅主题和不同字号、试用加载失败与键盘交互，并找到真实使用位置。示例只修改页面内的展示状态。后续改组件应同步维护交互契约和消费者索引，避免文档里的控件与产品逐渐分成两套。

本轮工程检查、Browser 页面交互、Low 模型流式停止和原生窗口调整已分别验证，详细记录见[验收台账](../product/acceptance-ledger.md)。历史计划与调查记录的隔离样本用于验证阅读器、滚动和来源校验；设备调查能力仍以对应真实设备回执为准。

普通配置、素材、Knowledge 和调查原始信息披露统一使用 `ui/Details`。Transcript 受控工作轨道保留 `ScopedWorkDisclosure`，历史 Plan 顺序、多项 handoff、任务展开记忆与 selected/running 语义不受控件迁移影响。`PlanCard` 只接收计划与 `onOpen`；生产 `PlanReviewRow` 将动作交给既有 `PlanReaderHost`，读取/审批身份仍由领域链路校验。

Settings 以独立宽高上限适应视口；桌面 Agent 列表与编辑区各自滚动，窄容器顺序布局由正文区滚动。短空态不撑出额外空洞，Skill 全文编辑器继续填满已分配余高。TaskDialog 操作区固定，超高正文内部滚动。Composer 的素材文件名按实际宽度渐隐，不按字符数裁剪。

Max 档位效果由 `useMaxVisualController`、`maxVisual` 与 `EffortMaxField` 共同维护；主题颜色、轨道尺寸和进入/退出生命周期通过现有契约连接，禁止把这一领域效果复制到基础控件。内部活文档位于 `designs/rdc-agent-design-system`，只复用生产视图，不连接真实模型或 RDC。

会话切换期间能力目录尚未就绪时，Composer 保留待恢复的持久控制值；目录到达后再按真实能力解析，不能让加载阶段的临时 Off 覆盖会话中的 Low。用户在同一会话里的正常编辑仍优先，不因普通重渲染重置。

运行记录筛选属于表单浮层，使用共享 Popover；内部 Select 的 Escape 先关闭选择菜单，再关闭筛选浮层，并逐层返回触发器。Knowledge 空结构明确显示无条目/无字段，未知、false、0 和 null 不合并为空；写入确认的版本时间使用统一格式。
