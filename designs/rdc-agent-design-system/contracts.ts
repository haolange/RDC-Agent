/** Documentation metadata only; samples always render the production implementation. */
export interface ComponentContract {
  avoid: string;
  states: string;
  layout: string;
  motion: string;
  consumers: string;
}

export const contracts = {
  'Composer Markdown': {
    avoid: '不用于只读消息或全屏文件编辑；不在文档中模拟发送、权限或持久化。',
    states: '编辑/预览、空内容、多行、选区、输入法组合；运行中输入的草稿独立于当前回复。',
    layout: '父 Composer 分配宽高，正文增长到限制后内部滚动，操作区保持可达。',
    motion: '编辑器不拥有运行绕光；Composer shell 根据真实运行投影控制原有角度动画。',
    consumers: 'features/composer/ComposerEditor.tsx',
  },
  PlanCard: {
    avoid: '不替代审批入口；不可把历史计划改成当前任务，或隐藏多个有效交接动作。',
    states: '标题/摘要、正文打开、文字选中；审批状态由领域协调器处理。',
    layout: '摘要随轨道宽度收缩，正文交给计划阅读器，不在卡片内嵌第二个长文滚动区。',
    motion: '仅保留原有交互反馈，不给历史计划附加运行效果。',
    consumers: 'features/transcript/WorkProcessRows.tsx → PlanReviewRow → usePlanReader',
  },
  TaskSnapshotCard: {
    avoid: '不作为可编辑任务数据库，也不把最新快照覆盖历史事件。',
    states: 'pending/in_progress/blocked/completed/cancelled；独立展开、会话展开记忆。',
    layout: '所属轨道负责滚动；展开内容保留层级，长正文换行。',
    motion: '运行标识来自任务状态；展开不重置历史，也不恢复已结束的运行效果。',
    consumers: 'features/transcript/WorkProcessRows.tsx',
  },
  'Working · 网页': {
    avoid: '不在卡片上显示状态码、字节数、哈希或 session:// 地址；不把网页卡并入通用「N 个工具」汇总。',
    states: '读取中、已读取、读取失败；搜索结果已读与未读；连续读取合并为一张卡。',
    layout: '胶囊单行不换行，从宽度 70% 处渐隐；展开后列出全部页面与摘要。',
    motion: '运行中胶囊逐个淡入；靠近高亮只在指针设备出现；减少动效时停用进场。',
    consumers: 'features/transcript/WorkProcessWebParts.tsx',
  },
  RightRailTaskList: {
    avoid: '不从选中状态推断 running，不显示其它会话的后台任务。',
    states: '空任务、各任务终态、活动任务、长名称、定位目标不可见。',
    layout: '单轨列表随右栏伸缩；名称按实际宽度渐隐并提供完整提示。',
    motion: '只由真实 in_progress 激活既有状态标识。',
    consumers: 'features/right-rail/SessionRightRail.tsx',
  },
  'SearchMultiSelect / Menu / ListRow / Feedback': {
    avoid: '多选不静默丢弃不可用引用；Toast 不取代字段错误；菜单不伪装导航。',
    states: '多选：加载/失败/重试/空/无匹配/禁用/不可用；菜单：禁用/焦点；列表：selected 与 disabled；反馈：成功/失败。',
    layout: 'Panel/SectionHeader/Divider 组织容器；ListRow 仅负责一行；菜单共享锚定边界。',
    motion: 'Spinner 只表示等待；Badge/Kbd 为静态内容；CheckPill 切换不发起业务调用。',
    consumers: 'Settings Agent 工具选择、Knowledge 列表、左栏菜单、app/NotificationLayer；精确路径见消费者索引。',
  },
  Button: {
    avoid: '不用于页面导航、选择标签或纯装饰。图标动作需 IconButton 的可访问名称。',
    states: 'primary/secondary/ghost/danger；sm/md/lg；hover/focus/pressed/disabled/loading。loading 阻止重复点击。',
    layout: '默认按内容宽度；父布局决定对齐，不用满宽按钮修补字段对齐。',
    motion: '生产 CSS 的颜色/边框反馈；loading 使用现有 Spinner，不新增动画运行库。',
    consumers: 'Settings、Composer、Knowledge、Transcript 及共享对话框。',
  },
  'Input / Textarea': {
    avoid: '标签不能仅用 placeholder；错误不能隐藏到披露区；全文编辑不套自动增长的短字段布局。',
    states: '空/已填/聚焦/只读/禁用/aria-invalid；Textarea auto/fill 与长内容。',
    layout: 'Input 与标签对齐；Textarea auto 在 minRows/maxRows 内增长，fill 占父容器剩余空间。',
    motion: '只使用焦点反馈，不对输入内容施加位移动画。',
    consumers: 'SettingsField 及各资源编辑器、MaterialContextEditor、Knowledge 写入弹层。',
  },
  Select: {
    avoid: '不用于多选或动作菜单；无选择/不可用值不能静默映射为首项。',
    states: '关闭/展开/选中/禁用选项/全局禁用/空目录/长标签。',
    layout: '锚点及实测内容决定翻转、限宽限高；内部滚动；字体加载与尺寸变化重新定位。',
    motion: '保留既有浮层反馈；不施加弹簧或持续动画。',
    consumers: 'Appearance、Providers、Agents、Tools、MaterialContextEditor。',
  },
  'Switch / Checkbox': {
    avoid: 'Switch 不表示执行中，Checkbox 不作为保存按钮；不能同时叠加重复的启用/停用说明。',
    states: 'checked/unchecked/disabled；Checkbox 可附 label/trailing。',
    layout: '与标签形成可辨认的一组；说明由表单布局管理。',
    motion: '仅保留开关本身的状态过渡。',
    consumers: 'Settings 偏好、Agent manifest、Hook/Policy 配置、SearchMultiSelect。',
  },
  Details: {
    avoid: '不隐藏错误、费用差异、权限和操作前约束；历史工作轨道继续使用领域受控披露。',
    states: 'inline/panel；开/关；默认 open 或外部受控 open；子树折叠后仍挂载。',
    layout: '统一箭头、焦点、间距；只管理自身披露，不强制其它项关闭。',
    motion: '箭头使用生产过渡，内容不引入高度弹簧动画。',
    consumers: 'Settings 高级字段、Knowledge 元数据/维护、MaterialContext、RightRailInvestigationPreview。',
  },
  'ReadingSheet / Disclosure': {
    avoid: 'ReadingSheet 只用于读一份长内容（计划、上下文用量），不承载表单编辑；Disclosure 不隐藏错误与权限约束。',
    states: 'Sheet：内容短时按内容高度、长时到可用高度后正文滚动；状态条保持可见；Escape 只关闭顶层。Disclosure：受控开合、trailing 操作、关闭时不渲染正文。',
    layout: 'Sheet 占据 Composer 上方的阅读区，头部、状态、底部固定，正文是唯一滚动区；工作台外居中。Disclosure 头部一行，箭头由组件绘制。',
    motion: 'Sheet 进入用 --motion-overlay；Disclosure 箭头旋转与正文进入用 --motion-disclosure。',
    consumers: 'PlanReviewPanel、ContextBreakdownSheet；精确路径见消费者索引。',
  },
  'Popover / TaskDialog': {
    avoid: 'Popover 不承载整页编辑；TaskDialog 不增加重复正文滚动；不能在基础层读取配置或 IPC。',
    states: 'open/closed、嵌套、异步内容增长、窄/低视口；顶层 Escape 与触发器焦点返回。',
    layout: 'Popover 锚定视口安全边界；TaskDialog 固定标题和动作，正文占余高并滚动。',
    motion: '使用现有模态/浮层时长；不改变 Composer 外沿溢出或遮罩。',
    consumers: '模型参数、ColorField、Settings/Knowledge 与项目弹层。',
  },
  'OverflowFade / EmptyState': {
    avoid: '不按字数截断；错误和正文不渐隐；空态不能伪装读取失败或不支持。',
    states: '未溢出/真实溢出/宽度改变；EmptyState inline/panel/page 与可选动作、visual。',
    layout: '单行名称 min-width:0，ResizeObserver 观察宽度；inline 是列表内一行说明，panel 是带创建动作的有界表面，page 填满所在栏位。消费方不再包边框盒子。',
    motion: '渐隐为静态遮罩，不是工作扫光。',
    consumers: 'Composer 附件、右栏任务、Settings 资源页、Knowledge 空态。',
  },
  'ActiveSignalText / TaskStatusMarker': {
    avoid: '不用于普通 selected、高亮或历史已完成项；不根据动画生成业务状态。',
    states: 'active/inactive、工作/思考 tone；pending/in_progress/blocked/completed/cancelled/failed（failed 由 main 从当前执行派生）。',
    layout: '由轨道放置；禁止父样式覆盖 active 文字遮罩、变量或伪元素层级。',
    motion: '冻结现有从左到右 active-signal-shimmer；进行中标记只旋转一段弧线，系统减少动效时静止。',
    consumers: 'Transcript 工作过程、TaskSnapshotCard、RightRailTaskList。',
  },
  'ColorField / HelpTip': {
    avoid: '不恢复系统原生取色弹窗；HelpTip 不承载必须立即可见的错误和权限。',
    states: 'grid/inline、合法/未提交 HEX 草稿、取色浮层、键盘色面与色相、帮助聚焦/悬停。',
    layout: 'HEX 保持紧凑；取色器通过 Popover 避让视口；帮助内容合理换行。',
    motion: '帮助退出延迟允许指针进入内容；颜色只改变当前样本，不改全局主题。',
    consumers: 'Appearance/Agents 颜色配置；Provider 能力说明。',
  },
  'Tabs / Pill / IconButton': {
    avoid: 'Tabs 不代替执行按钮；Pill 的 selected 不表示 running；装饰 Icon/ModeGlyph 不承担点击职责。',
    states: 'Tabs underline/segmented、图标、计数、collapsible 图标模式、禁用、单一 Tab 焦点；Pill selected/running/disabled；IconButton disabled。',
    layout: 'Tabs 可 fullWidth；collapsible 在带标签的一行放不下时整体降为图标加提示，容器变宽后恢复，永不重叠或换行；图标按钮保持控件高度和 label。',
    motion: '一个指示器在选项间滑动（--motion-indicator）；ModeGlyph 只表示模式身份。',
    consumers: 'Settings 页签、Composer 模式/权限选择、左右栏工具动作。',
  },
  UnsavedChangesDialog: {
    avoid: '只用于手动保存表单；自动保存失败继续由所属编辑器提供重试。',
    states: '打开默认聚焦继续编辑；Escape/关闭继续编辑；放弃只丢弃未提交草稿。',
    layout: '复用 TaskDialog，小尺寸、正文换行、底部动作固定。',
    motion: '沿用 TaskDialog，不额外延迟关闭或草稿恢复。',
    consumers: 'Settings 手动资源编辑、Knowledge 编辑退出保护。',
  },
} satisfies Record<string, ComponentContract>;

export type CatalogName = keyof typeof contracts;
