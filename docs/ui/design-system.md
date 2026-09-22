# RDC-Agent UI / Design System

权威来源（按优先级）：

1. [`DESIGN.md`](../../DESIGN.md) — 产品边界与不变量裁决
2. [`workbench-and-transcript.md`](workbench-and-transcript.md) — Workbench / Composer Effort / transcript 产品规格
3. [`AGENTS.md`](../../AGENTS.md) — token / 按钮 / Appearance 执行纪律
4. [`src/renderer/styles/design-system.css`](../../src/renderer/styles/design-system.css) — primitive + semantic token 定义
5. [`src/shared/theme/`](../../src/shared/theme/) — preset catalog、`ThemeChromeCompiler`、`rdc-theme-v1`、compose accent 派生
6. [`designs/rdc-agent-design-system/Design System Preview.html`](../../designs/rdc-agent-design-system/Design%20System%20Preview.html) — 可交互预览

## 视觉定位

### 组件与样式归属

`ui` 提供受控基础控件与容器，`patterns` 提供跨产品面组合，`features` 拥有专属交互与状态协调。独特视觉同样组件化，但 Composer 光环、Effort 与 Capture 操作不提升为无真实消费者的通用框架。Pattern 读取投影、通过 props 回调表达写入意图；实际 store action 由 feature 或 app 持有。

专属 CSS 与组件就近维护，按 shell、输入、工具栏、内容与动效等稳定职责命名；不要按行数切成数字文件。迁移保持级联顺序、选择器优先级、变量作用域与容器查询，删除被替代文件和引用。共享弹层统一复用 TaskDialog、overlay stack 和 focus 管理；图片等特殊内容用专属内容布局保留展示空间。视觉调整必须针对明确缺陷，与结构迁移分开记录。

RDC-Agent 是 **restrained、高密度、实色分层的精密工具**（参照 VS Code / JetBrains / Linear 的密度与克制）。裁决见 [`DESIGN.md`](../../DESIGN.md) UI 节。

- 层次由 1px 边框 + 实色表面建立；阴影只用于 popover 与 modal。
- 不使用无状态含义的装饰性背景。backdrop blur 只允许模态全屏遮罩（`--modal-backdrop` + `--modal-backdrop-filter`）；Dropdown / popover / chrome 仍为实色。Active Signal、Composer 绕光与 Effort 是核心状态视觉，保留完整动效。
- 单一 accent 只承担 focus / selected / primary CTA；状态色只表达状态。
- 信息密度优先于留白：同屏能多放一行真实信息，就不要用空白替代。

## 刻度（唯一真值：`src/renderer/styles/design-system.css`）

上手教程中的教学图用于解释真实入口和操作关系，不作为装饰背景。中性底色图卡以实色边框接入深浅主题，关键标注使用可访问的 HTML/i18n；教程以清晰的图文比例与留白辅助阅读，不改变工作台的信息密度。示例状态必须明确区别于当前配置。

| 维度 | 变量 | 取值 | 用法 |
|------|------|------|------|
| 控件高度 | `--control-height-sm/md/lg` | 28 / 32 / 36 | pill、列表行、导航项、输入框、按钮统一落在此三档 |
| 圆角 | `--radius-sm/md/lg/xl/full` | 4 / 6 / 8 / 12 / 9999 | 卡片 `md`；输入与按钮 `sm`；Composer 壳 `lg`；pill `full` |
| 间距 | `--space-*` | 4 基，禁奇数 px | panel 内边距 `--space-3`（工作台右栏 inspector 外壳同此）；section 间距 `--space-5` |
| 字号 | `--text-xs/sm/base/lg/xl` | 见 token 文件 | 禁 px 字面量 |
| 行高 | `--leading-tight/normal` | 两档 | 不再引入第三档 |
| 时长 | `--duration-fast/base/slow` | 120 / 180 / 240ms | 统一 `--ease-standard`；`--transition-*` 是 `duration + ease` 别名 |
| 字距 | `--tracking-tight/normal/wide` | -0.02 / 0 / 0.04em | 标题收紧、正文默认、标签加宽 |

**排版层级（唯一一套，跨界面通用）**

| 角色 | 组合 | 用于 |
|------|------|------|
| `page-title` | `--text-lg` / 600 | 模态标题、详情页头 |
| `section-title` | `--text-sm` / 600 | 卡片标题、区块标题、Right Rail 卡头 |
| `description` | `--text-xs` / `--token-text-caption` | 标题下说明、空态副文案 |
| `body` | `--text-sm` | 正文、列表主文本 |
| `mono` | `--font-mono` / `--text-xs` | 路径、命令、hash |

禁止再出现第四套 section 标题字号（历史上 Right Rail 用 `--text-xl`、Settings 用 `--text-lg`、Sidebar 用 `--text-xs` 大写、Knowledge 用 `--text-sm` 四套并存）。

## Primitive → Semantic 迁移对照

组件 CSS 只能引用右列。左列 primitive 仅允许出现在 token 定义层。

| Primitive（禁止出现在组件 CSS） | Semantic（使用这个） |
|------|------|
| `rgb(var(--color-bg-0))` | `var(--token-bg-app)` |
| `rgb(var(--color-bg-1))` | `var(--token-bg-shell)` |
| `rgb(var(--color-bg-2))` | `var(--token-bg-panel)` |
| `rgb(var(--color-bg-3))` | `var(--token-bg-raised)`；作为 hover 底色时用 `var(--token-interactive-hover)` |
| `rgb(var(--color-surface-overlay))` | `var(--token-bg-overlay)` |
| `rgb(var(--color-border-subtle))` | `var(--token-border-muted)` |
| `rgb(var(--color-border-default))` | `var(--token-border-default)` |
| `rgb(var(--color-border-secondary))` | `var(--token-border-card)` |
| `rgb(var(--color-border-strong))` | `var(--token-border-strong)` |
| `rgb(var(--color-accent-500))` | 焦点环 `var(--token-border-focus)`；强调文本/图标 `var(--token-accent-primary)` |
| `rgb(var(--color-text-primary))` | `var(--token-text-heading)` |
| `rgb(var(--color-text-secondary))` | `var(--token-text-body)` |
| `rgb(var(--color-text-tertiary))` | `var(--token-text-caption)` |
| `rgb(var(--color-text-muted))` | `var(--token-text-placeholder)` |
| `rgb(var(--color-text-disabled))` | `var(--token-text-disabled)` |
| `rgb(var(--color-success \| warning \| error \| info))` | `var(--token-status-success \| warning \| error \| info)` |

**带 alpha 的 primitive**（如 `rgb(var(--color-bg-3) / 0.78)`）不能直接换成语义 token（token 已包含 `rgb()`）。改写为 `color-mix`：

```css
/* 迁移前 */
background: rgb(var(--color-bg-3) / 0.78);
/* 迁移后 */
background: color-mix(in srgb, var(--token-bg-raised) 78%, transparent);
```

边框 token 已内含 alpha，**禁止**再追加 `/ 0.65`。

## 状态与交互态

Settings 辅助解释使用字段标签旁的 HelpTip，支持悬停、聚焦与点击；错误、不可用和费用提醒仍在相应操作处可见。模型详情依次展示紧凑能力摘要、对齐的偏好表单、默认折叠的详细信息（档位、价格、验证与来源）；选择控件统一使用 Select。Agent 指令随内容增高，最小两行、最多视口高度 45%，之后内部滚动；独立技能/策略全文编辑器仍填满剩余空间。

- 状态类一律 `is-*`：`is-active` / `is-selected` / `is-running` / `is-disabled` / `is-error`，并配对应 `aria-*`。禁止裸 `.active` / `.current`。
- 任何定义了 `:hover` 的可交互选择器必须同时定义 `:focus-visible`。
- 焦点环统一 `--token-border-focus`；禁止 `outline: none` 而不提供等效焦点样式。
- 动效由真实交互与运行生命周期驱动；不提供减少动效设置，不读取系统减少动效偏好，不设置全局停播覆盖。

## 双体系（摘要）

| 体系 | 数据 | 作用域 |
|------|------|--------|
| 全局 Appearance | `appearance.theme` + `chromeThemes.light\|dark` | Shell、Settings、transcript、全局 CTA/focus |
| Compose Agent | `.agent.md` `accent` → `--composer-mode-accent` / `--composer-effort-*` | Composer 边框、send、Effort/Max 色相；运行态 `is-running` 使用 token 化 energy orbit |

- Light/Dark（含 system）影响两套体系的亮度调制。
- 不提供 translucent sidebar。
- 主题分享格式：`rdc-theme-v1:`（拒绝 `codex-theme-v1:`）。
- 预设：RDC（默认）+ Absolutely / Ayu / Catppuccin / Dracula / Everforest / GitHub / Gruvbox / Linear。

## CSS 入口

- 唯一全局入口：`src/renderer/main.tsx` → `styles/global.css` → `design-system.css`。
- 禁止恢复 `styles/tokens/*` 或未接线的 `oklch-themes.css`。
- 生产 CSP：`style-src 'self'`（无 `unsafe-inline`）+ `style-src-attr 'none'`。Appearance chrome（`applyChromeTheme`）与组件动态样式必须走 constructable stylesheet（`adoptedStyleSheets` / `useDynStyle` / `assignDynStyle`），禁止 `<style>.textContent` 或 `element.style` 注入。
- Settings `schemaVersion` **6**：升级时不可逆重置 `appearance.chromeThemes` 为 RDC 默认（清理历史污染）。

## Token 使用规则

- **必须**引用语义 token（`--token-*`），禁止在组件 CSS 中直接用 primitive token（`--color-bg-3`、`rgb(var(--color-accent-500))` 等）。
- `--token-*` 完整定义在 `src/renderer/styles/design-system.css` 的 "Semantic Token Layer" 部分。
- 边框 token 已内含 alpha，使用方式为 `rgb(var(--color-border-subtle))`，**禁止**追加额外 alpha：`rgb(var(--color-border-subtle) / 0.65)` 是无效 CSS。
- 字号必须用 `var(--text-*)` 变量，**禁止** px 字面值。
- 间距必须用 `var(--space-*)` 变量，**禁止**奇数像素值（3px、7px、9px）。

## 按钮规则

- 全局唯一按钮系统：`.button`（基类） + `.button-primary / button-secondary / button-ghost / button-danger`，定义在 `src/renderer/ui/Button.css`（由 `styles/global.css` → `ui/kit.css` 导入）。
- React 层用 `<Button variant="primary|secondary|ghost|danger" size="sm|md|lg">`（`src/renderer/ui/Button.tsx`）。
- 普通按钮为中性实色表面与细边框，主要动作使用强调色文字及描边，不铺大面积 accent；单选分段使用低饱和实色选中面。输入和按钮统一小圆角，默认控件高度 md，紧凑工具栏 sm。Composer Send 保留 Agent accent 实色的领域契约。
- **禁止**新增第三套按钮类名，禁止在 feature CSS 中重复定义按钮样式。

### 多行输入与全文编辑

共享 `Textarea` 是多行纯文本输入唯一实现。`sizing="content"` 从一行随内容增长，默认最多八行再内部滚动，清空后收缩；初始/异步值、宽度和字体变化及折叠展开均重新测量。动态尺寸使用 CSP 允许的 constructable stylesheet，不使用内联样式，不提供手动拖拽角。

`sizing="fill"` 用于技能、策略等全文编辑：上级 flex/grid 传递剩余高度，标题、标识与操作栏按内容占位，正文吸收余高并内部滚动，不叠固定像素上限。窄屏资源列表限高、正文保留可用编辑面积。Composer 的发送、IME、快捷键保持领域所有权；CodeMirror 是专用 Markdown 编辑实现，不复制普通 textarea 的测量逻辑。

## 颜色使用规则

- 强调色（`--color-accent-*`）只用于：焦点环、激活状态、主要 CTA（非 Composer）。不得用于正文、装饰或多处背景。全局 accent 来自 Appearance chrome 编译，不接管 Composer。
- 状态色（success / warning / error / info）只用于语义状态，不得挪作装饰。
- **双体系**：全局 chrome（`chromeThemes.light|dark` → `ThemeChromeCompiler`）驱动 shell/Settings/transcript；Composer 第二套由当前 agent 的 `.agent.md` `accent` 派生 `--composer-mode-accent` 与 `--composer-effort-*`（边框、send、Effort/Max 滑条、Max 字色、Max mode / Fast 角标开态）。禁止这些 compose 控件再读 `--token-border-focus` 或裸 `--token-effort-*` 作为唯一色源。Light/Dark 只调制 compose 派生色的亮度，不替换色相来源。`--token-effort-*` 仅为 compose 变量缺省回退，禁止挪作其它装饰或背景。
- Effort 弹层的 Max mode / Fast mode 是稳定能力槽位，不随模型消失：面板里始终占位；unsupported 显示灰色关闭，fixed 显示灰色开启，selectable 才允许切换。收起胶囊只在对应模式开启时前置图标。
- Agent accent 必须可配置（`.agent.md` + Settings → Agents GUI）；`AGENT_SEED_ACCENTS` 仅用于 builtin seed 初值，不是运行时权威。
- `--token-context-*` 色阶专用于 Context breakdown 弹窗的分段条与图例色点，不得挪作其它装饰或背景。
- 不得引入非 design-system.css / ThemeChromeCompiler 定义的新颜色；需要新颜色时先在 `--token-*` 或 chrome 编译层添加并说明用途。
- Composer 运行态用 `--composer-mode-accent` 驱动 `composerEnergyOrbit`：`composer-motion.css` 注册角度，从 −130° 到 230°，2.85s 一圈；固定圆角遮罩内的锥形渐变产生四角光带伸缩，2px 光环与分层 drop-shadow 保留历史辉光。光层不截获指针，不旋转矩形遮罩，不使用径向光斑沿四边平移。停止后光层消失，accent 同时用于边框、send 与 Effort。

## 新增组件规则

每个新组件必须：
1. 覆盖所有交互状态：rest / hover / active / focus / disabled（按需加 loading / error）。
2. 通过 CSS 变量控制 variant，不得在选择器里硬编码颜色。
3. 不使用内联 `style={{}}`，动态值（宽度百分比、JS 计算值）例外。
4. 文件行数不超过 300 行（组件）/ 200 行（hook / service）。

## 空态

所有空态使用统一 `<EmptyState title description? actions? visual?>`。Settings 资源列表、Knowledge 列表、Sidebar 只用文案，不放装饰几何体。Right Rail 五卡通过可选 `visual` 槽恢复 token 着色的等距场景（`RightRailEmptyVisuals`，轻模糊、语义 `stop-color`），配一句 honest copy；需要操作时把按钮放进 `actions` 槽。`check:design-tokens` 不豁免 primitive `stop-color`。

共享空态区分紧凑区块与填充面板用途。资源空态以有边界的中性实色承载标题、说明和统一动作组；Tools 的 MCP 保持紧凑，独立资源页使用剩余空间。资源列表行以实色表面、细边框和明确 hover/focus/selected 状态承载内容，长名称可换行，状态不能被挤掉；技能 description 不在列表展开。

## Composer 附件卡

- 待发附件走输入框上方托盘（`composer-attachment-tray` / `composer-attachment-card`），不用 chip 文本条。
- 图片卡 72px 圆角真实缩略图；文件卡类型字形 + 文件名 + `TYPE · size`。
- 移除叉仅 hover / `:focus-within` 显现；键盘聚焦时常驻。
- 颜色、字号、间距只引用 `--token-*` / `--text-*` / `--space-*`；样式在 `composer-attachments.css`，禁止回到 `app-shell.css` 的 primitive token chip。
- `<=480px` 卡片缩尺、托盘限高滚动，不得挤掉底栏控件。

## Transcript 卡壳

审批卡、Work Process tool 卡、Asked 卡、计划卡、计划阅读面板、handoff 建议行、Sub Agent 子行、Tasks 快照卡、图像缩略图与 Compact 摘要共用同一组变量（定义在 `design-system.css`）：`--transcript-card-radius` / `--transcript-card-padding` / `--transcript-card-border` / `--transcript-card-surface` / `--transcript-card-shadow` / `--transcript-card-icon-size`。禁止再为某一类卡另起一套 radius/padding/border/背景，也禁止 tool 卡图标硬编码 px。缩略图经 `conversation:getToolImagePreview` 取 `data:` URL，禁止把大图 base64 写进 `resultPreview`。

## 模态尺寸

知识中心与 Settings 居中，外壳在 `88vw × 86vh`（硬顶 `120rem × 70rem`）内接最大 16:10，不写死 `aspect-ratio`；带 `min(45rem/40rem, 视窗 − 2×inset)` 下限。backdrop `padding: var(--modal-workbench-inset)`（`--space-4`，`≤640px` 为 0），底为 `--modal-backdrop`（`--token-bg-app` 40% 压暗）加 `--modal-backdrop-filter`（`blur(16px)`）；组件 CSS 只写 `var(--modal-backdrop-filter)`，禁止字面量 `blur()`。960 堆叠导航，640 全屏去圆角。禁止再写互相覆盖的多段 media query。设置内容列与面板同宽，只靠 panel padding 留白，不再用居中 `--settings-content-max`。内部表单分栏按 `.settings-center-panel` 容器宽度查询，不按视口猜测。

知识中心与 Settings 的内容使用实色分层、紧凑工具栏与清晰标题，避免嵌套装饰框和重复说明。Knowledge 保持空间 / 列表 / 详情三列（列宽 `224 / minmax(280, 0.8fr) / 1.2fr`），左栏仅放视图与空间导航；类型、生命周期与六条检索通道收进列表的筛选入口，以文字按钮表达多选；索引维护与卡片元数据默认折叠；960px 以下用空间 / 列表 / 详情切换且始终提供关闭入口。Settings 保持八项导航（常规 / 外观 / Provider / Agents / Skills / Tools / Hooks / Policy）与均分 User / Project 作用域；常规页不提供「资源与诊断」，只保留资源各自编辑页的只读「资源位置」。640px 以下导航单行横向滚动，内容全屏。宽屏下 Light / Dark 编辑器并排，小屏堆叠。资源空态共用 `EmptyState`，不添加装饰性文案；路径、模型名与元数据允许换行。说明文案仅保留操作条件、作用域和必要风险，内部实现细节留在文档。

## 任务子弹窗（TaskDialog）

导入、导出、资源编辑、连接配置、写入确认等「离开当前阅读面会丢上下文」的任务，一律用 `src/renderer/ui/TaskDialog`，叠在 Settings / Knowledge 之上，不替换背后的列表、筛选、选择或滚动位置。

- 结构固定 `title`（+可选 `description`）/ `body`（唯一滚动区）/ `footer`（右对齐动作，主要动作在最右）。尺寸档位 `sm 420px` / `md 560px` / `lg 760px`，高度上限 `min(88vh, ...)`，`≤640px` 全屏。
- 层级 `--z-overlay`，背景 `--token-bg-overlay`，阴影 `--token-shadow-modal`。焦点经 `lib/useModalFocus` 捕获；每个弹层在 `lib/overlayStack` 注册，Escape 与 Tab trap **只**作用栈顶层，关闭后焦点回到触发控件。
- `ConfirmationDialog` 是 TaskDialog 的 `alertdialog` 变体，承担删除等危险确认（`danger` 主按钮，默认焦点在取消）；`UnsavedChangesDialog` 承担手动保存表单的「继续编辑 / 放弃更改」。自动保存表单失败走自身重试语义，不套这个模板。
- 禁止 feature 内再造第二套 overlay / backdrop / 焦点栈。

## 轻量选择控件

- **多选**用 `CheckPill`（勾选 + 文字，`role="checkbox"`，`aria-checked`，`is-selected`）或列表里的 `Checkbox`。两者共用空心方框 + 字色勾（`--checkbox-*`）。禁止 accent 实心方砖，禁止为多选画大方框卡片。`Switch` 是唯一胶囊，开态才灌 accent。
- **单选**用 `Tabs` 的 `variant="segmented"`（`role="tablist"` / `radiogroup`），用于主题模式、字号、导入输入方式、导出范围与格式。默认按内容宽度布局；同组需要统一铺满时显式使用 `fullWidth`，各项等分可用宽度。语言选项在所有界面语言下统一使用自称 `简体中文` / `English`，便于用户在不熟悉当前界面语言时识别切换入口，并避免紧凑选择器因外语全称溢出。
- 动作按钮与选择控件不混同：普通执行 `ghost` / `secondary`，主要动作 `primary`，危险动作 `danger`。

## 颜色选择浮层

`ColorField` 是自绘 `Popover` 取色器：色域（饱和度 × 明度）+ 色相条 + HEX 输入 + 当前色样，指针位置与 HEX 双向同步。色域渐变是选择器本体的合法用途，不得外溢为页面背景。键盘必须可达：触发器 Enter/Space 打开，色域支持方向键步进（Shift 加速），HEX 可直接输入，Escape 关闭并回焦。主题预设仍由 `ThemePresetId` 提供，取色器不替代预设。

## 右键上下文菜单

全应用文本面使用自绘 `ContextMenu`（`src/renderer/ui/ContextMenu`），不走原生 `Menu.popup`，以保证 Browser / Desktop parity。

- 背景 `--token-bg-overlay`，边框 `--token-border-card`，阴影 `--token-shadow-popover`，hover `--token-interactive-hover`，灰项 `--token-text-disabled`，分隔线 `--token-border-muted`，层级 `--z-popover`。
- 可编辑区：撤销 / 重做 / 剪切 / 复制 / 粘贴 / 粘贴并清理格式 / 全选；只读区：复制 / 全选。快捷键按平台显示 `Ctrl` 或 `⌘`。
- 定位走 `useDynStyle`（CSP `style-src-attr 'none'`）；靠近视口右/下边缘翻转；约 390px 必须完整在 viewport 内。
- `role="menu"` + `role="menuitem"`；Arrow / Home / End / Enter / Escape；Escape 把焦点还给原元素；入场动画保持正常播放。
- 侧栏 Session/Project 自有菜单用 `data-owns-context-menu` 排除。

## 窄屏 Workbench

- `<=720px` 时桌面工作区最小宽度必须解除，主区与 Composer 以真实 viewport 收缩，不得用 `overflow: hidden` 掩盖被裁掉的桌面宽度。
- Composer Footer 始终单行、控件高 `--control-height-sm`（含发送按钮）。缩窄时禁止折成两行；Agent / Permission 收成 28 图标，合并的 model-effort 胶囊保留模型名 + 思考等级但设最长宽度，只有模型名溢出才用线性渐隐而不是省略号。
- Agent / Permission / model-effort / Usage 菜单在窄屏锚定到 Composer 上方并完整位于 viewport 内；同一时刻只开一个；running 与 selected 分列，约 8px 状态点使用 semantic status token，运行点保持状态动画。
- Browser 验收至少覆盖约 390px viewport、水平溢出、菜单 selected/running、键盘导航、Escape 焦点返回及持续播放。

## 组件清单（`src/renderer/ui`）

原子：`Button`、`IconButton`、`Icon`、`Switch`、`Checkbox`、`Kbd`、`Divider`、`Spinner`、`Toast`。

分子：`Pill`、`CheckPill`、`SectionHeader`、`Popover`、`Menu`、`Input`、`Textarea`、`SearchField`、`Select`、`ListRow`、`OverflowFade`、`Panel`、`EmptyState`、`InlineError`、`Tabs`、`ColorField`、`TaskDialog`、`ConfirmationDialog`、`UnsavedChangesDialog`。

每件必须：全部交互态、CSS 变量 variant、共置 CSS ≤300 行、`ui/index.ts` 导出。禁止 feature 再造第二套弹层 / 空态 / 输入。

## 各面推荐 composition

| 产品面 | 组合 |
|--------|------|
| Settings 八 section | `SectionHeader` + `Panel` + `ListRow` + `Input` / `Select` / `Switch` + `Button` |
| 任务子弹窗（导入 / 导出 / 编辑 / 确认） | `TaskDialog`（`title` / `body` / `footer` + `size`），危险确认用 `ConfirmationDialog`，未保存离开用 `UnsavedChangesDialog` |
| Settings / Composer / Sidebar 弹层 | `Popover` 或 `Menu`（锚定、viewport clamp、Escape 焦点返回） |
| Knowledge 三列 | `Panel` + `ListRow` + `SearchField` + `Pill` + `EmptyState` + `Tabs` |
| Composer 底栏 | `Pill` + `Popover` / `Menu`；控件高 `--control-height-sm`（28） |
| Right Rail 五卡 / Sidebar | `SectionHeader` + `ListRow` + `EmptyState` |
| 表单校验 | `InlineError`，不用 toast 代替字段错误 |

## 目标目录

见 [`DESIGN.md`](../../DESIGN.md) UI 节「渲染层目录」。CSS 与组件共置；`pages/`、`styles/tokens/*`、`styles/base/` 不得恢复。

## 视觉参考

`designs/rdc-agent-design-system/Design System Preview.html` 已经直接引用运行时 `src/renderer/styles/design-system.css` 与 `src/renderer/ui/kit.css`（含 `.button-*` 与分子 class）。`designs/tokens/*` 与独立 `styles.css` 已删除，不得恢复。

## 验证

```bash
pnpm run check:design-tokens       # 组件 CSS token 合规；B0 棘轮锁定债务，B1 清零
pnpm run check:renderer-structure  # 分层依赖、feature 横向、组件直调 IPC、is-* 状态命名；B0 棘轮，B3 清零
pnpm run check:appearance
pnpm run typecheck
```

`check:design-tokens` 豁免：token 定义层 `styles/design-system.css`；Right Rail `stop-color` 随 B7 空态收敛删除。新增豁免必须先改本文件再改脚本。

### 规则 → 门禁 / 债务批次

| 规则 | 当前 enforcement | 清零批次 |
|------|------------------|----------|
| 语义 token / 禁 primitive、hex、px 字号间距圆角、`!important`、blur | `check:design-tokens` | B1 已清零 |
| 层依赖、feature 横向、组件直调 IPC、退役目录、global feature 选择器 | `check:renderer-structure` 棘轮 45 | B3 → hits=0 |
| `is-*` 状态类（禁裸 `.active` / `.current`） | `check:renderer-structure` 已扫 TSX | B3 清零剩余 5 |
| 刻度 control 28/32/36、radius 4/6/8/12、duration 120/180/240 | 文档权威；token 文件 B1 已改值 | B1 已落地 |
| `:hover` 必配 `:focus-visible`；禁无替代 `outline: none` | 无自动门禁 | **B8** 扫描清零 |
| 分子组件清单与交互态 / CSS 变量 variant / 禁内联 style | `src/renderer/ui` 已落地；luna 审查 | **B2** 已落地 |
| 统一 `EmptyState` + 可选 visual | 组件已落地；Right Rail 五卡恢复 token 着色等距场景 | **B2** 组件；二次收敛恢复 visual |
| Composer 运行态 energy orbit | `check:work-process` 验证注册角度、锥形渐变、2.85s 周期、固定遮罩和分层辉光；无偏好停播覆盖 | 真实 busy 状态下验收四角伸缩与终态停止 |
| Select 禁 backdrop blur | `check:appearance` 要求实色 `--token-bg-shell`、禁止 blur | B1 已反转 |
| Preview 引用运行时 CSS，删除 `designs/tokens/*` | Preview 已改；副本已删并入 `retired` | **B2** 已落地 |
| i18n 拆分、硬编码入 i18n、sentence case | key 已拆到 `i18n/locales/{en,zh-CN}/`；硬编码与 sentence case 仍待扫 | **B3** 拆分；**B8** 文案 |
| `check:architecture` R4 hex exempt | 仅 `design-system.css` | B1 已清空 |
| `pages/`、`styles/base/` 删除 | 两者已删并入 `retired`；`check:renderer-structure` hits=0 | B1 已删 `styles/base`；**B3** 已删 `pages/` |

受门禁锁定的 renderer 文件路径集中登记在 [`scripts/fidelity/renderer-contract.json`](../../scripts/fidelity/renderer-contract.json)：`files` 为必存在锚点，`retired` 为必须保持删除的退役路径。移动或重命名这些文件时只改该 manifest。

浏览器真实会话覆盖 Settings → Appearance、agent accent、Light/Dark、Compose Effort 染色边界（见 [`appearance-checklist.md`](appearance-checklist.md)）。验收前须重启最新 `start:agent-browser`，并删除该 QA project 下全部 session 后新建隔离 session。

Knowledge Case 详情正文按章节分节，目录使用可换行的链接控件；缺失章节统一提示，不重复渲染空白章节。卡片信息使用带 aria-expanded 的统一 Button 展开，元数据分组排版。完整 JSON 对象 / 数组仅在阅读层转为字段与列表，保留未知字段及所有值；普通 Markdown 和无法解析的内容保持原文，禁止回写或改变知识事实。

Case 阅读层按内容安排主次：预期 / 实际使用并列对照，短属性使用紧凑网格与行内列表；禁止递归缩进线和宽标签列。证据摘要常驻，来源及参数由统一按钮按需展开，不将编号、参数置于摘要之前占据正文。窄屏对照改为纵向排列。

### Settings / Knowledge / Composer 组件所有权

- Settings 入口装配导航与弹层，`SettingsPageContent` 组合页面；`useSettingsNavigation` 统一未保存导航，各领域 controller 保留独立草稿、校验与保存语义。页面展示组件不直接调用 IPC。
- Knowledge 查询、选中详情、导入、导出和写入各有明确 controller。`useKnowledgeSelection` 是详情选择的唯一来源；查询或会话切换、关闭及卸载使旧请求失效。失效只阻止迟到结果更新界面，不冒充取消已经提交的写操作。
- Composer 编辑／预览使用共享 segmented `Tabs`。Tabs 的 DOM ID 按实例生成；没有对应面板的选择控件不输出 `aria-controls`。编辑器内部焦点由 Composer 外壳呈现，不全局关闭焦点样式。
- 基础控件负责焦点、选中、禁用与内容尺寸；领域层通过语义变量配置布局。ListRow 不因父列表高度不足而压缩内容，列表自己滚动。单行长文本使用 `OverflowFade`：保留完整 DOM / `title`，根据真实 overflow、ResizeObserver、字体加载与文本变化决定是否渐隐，空值仍占一行。ColorField 的紧凑布局与隐藏标签由组件自身管理。
- Provider、Agents、Tools、Appearance 与 Knowledge 的样式按展示职责组织；响应式规则跟随所属组件。CSS 入口仅声明加载关系，不恢复已替代的集中覆盖文件。
- Settings 的 `AgentListItem` 在 feature 内组合 `ListRow` / `ModeGlyph` / `OverflowFade`，父级持有数据与选择状态。每行沿用共享中性实色表面、细边框、小圆角及选中态，行间 `--space-1`；图形为 18px，位于 28px（`--control-height-sm`）无底色、无边框的图标列，不再使用图标底座。名称 `--text-sm` / `--font-medium`，描述 `--text-xs` / `--token-text-body`，各一行、间隔 `--space-0-5`；空描述仍占位。上下内边距 `--space-2`，行高随字体与两行内容自然增长，不固定高度裁切。布局经 ListRow 变量配置，不依赖全局 kit 与 feature CSS 的加载顺序。等高与渐隐的工程证据不能替代图标比例、条目分隔和深浅主题的真实视觉验收。

### 工作台壳层接线与项目 Capture 面板

`app/App.tsx` 实际使用 `shell/AppShell` 组合 TitleBar / WorkbenchShell / overlays；壳层 CSS 必须从 `main.tsx` 的运行时 import 图可达，不能只保留组件文件。`check:renderer-structure` 检查这一接线。

侧栏 Knowledge / 用户入口共用 ghost Button、36px 行高、24px 图标轨与一致文本起点，使用实色 sidebar，不保留原生灰按钮、58px 用户卡或渐变装饰。项目 Capture 面板共用 SectionHeader / Button / EmptyState，与 Session rail 使用同一 panel 刻度；列表仅展示文件与大小，不伪装成可点击控件。冗余导入说明与局部 primary 样式已删除。DeviceSelector 仅保留工作台顶部入口，退役 sidebar variant。

Composer Send / Stop 共用 Button 的 primary / danger 状态，尺寸固定 28×28；圆角与 padding 通过 `--btn-*` 配置，避免全局 CSS 加载顺序覆盖。Send 是 agent accent 实色与向上箭头，Stop 为停止方块；禁用、hover、按下使用共享 Button 行为，焦点环跟随 agent accent。不保留全局 chat-send-button 渐变与 icon-only / label 旧分支。

用户入口再次点击直接关闭菜单；外部点击处理须排除入口自身，避免 mousedown 关闭后 click 重开。入口使用 aria-expanded / aria-controls，与弹层状态一致，保留 Escape 焦点返回。菜单使用实色 overlay、无嵌套卡片的紧凑头像/名称头部，语言/主题/字号采用公共标签列和等宽 `Tabs fullWidth` 控件列；弹层以实测尺寸定位并限制在 viewport 内，窄屏自身滚动。项目 Capture 的导入与刷新使用 SectionHeader actions 内两个 28px IconButton（加号 / 刷新），共用默认、hover、focus、disabled 状态和可访问名称，不保留独立文字按钮行。

Composer 宽度分配：左组及图标 menu wrapper 不参与压缩；右组允许收缩。model-effort 菜单独随生效模型名 + 思考等级 hug，用 `max-width` 封顶（默认 12rem），`min-width: 0` 可压；胶囊 `width: auto`，不预留固定槽、不贯通 `width: 100%`。窄容器只收紧 `max-width`（560px → 8rem，420px → 6rem），不用 `flex-basis` 预留槽。窄宽规则具有足够 specificity，不受后加载 Pill / Effort 基础样式覆盖。禁止 viewport 规则恢复右组 flex-shrink:0。<=720px 主内容轨道使用留白内全宽，不继续使用桌面 77% 上限；模型名只对实际溢出文本渐隐，完整名留在 `title`。

计划卡使用 transcript-card padding/border/radius 与实色 token-bg-raised；标题左对齐，正文为连续、有界 Markdown 预览，短内容自然收缩、长内容裁切，无分节折叠、内部 URI 或卡内滚动。阅读入口复用公共 Button 焦点环。Composer 计划门使用紧凑决策列表与按需展开的修改意见，不重复标题/摘要，不以关闭或跳过隐式批准。

计划阅读器左右严格对齐 Composer 外壳；上下使用主工作区边界并留 `--space-4` 安全边距，≤640px 改为 `--space-2`。几何由工作区上下文测量，经 `useDynStyle` 随布局、字体及视口变化更新，不使用固定 rem 宽高上限。全窗口遮罩沿用 `--modal-backdrop` / `--modal-backdrop-filter`，面板采用实色 `--token-bg-overlay`。标题、版本和操作栏固定，正文独立滚动，窄屏将标题与操作分行；保留 overlay stack、键盘焦点循环和关闭回焦。模糊效果须观察实际界面，computed style 不能替代视觉验收。
