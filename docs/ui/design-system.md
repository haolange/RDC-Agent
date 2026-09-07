# RDC-Agent UI / Design System

权威来源（按优先级）：

1. [`DESIGN.md`](../../DESIGN.md) — 产品边界与不变量裁决
2. [`workbench-and-transcript.md`](workbench-and-transcript.md) — Workbench / Composer Effort / transcript 产品规格
3. [`AGENTS.md`](../../AGENTS.md) — token / 按钮 / Appearance 执行纪律
4. [`src/renderer/styles/design-system.css`](../../src/renderer/styles/design-system.css) — primitive + semantic token 定义
5. [`src/shared/theme/`](../../src/shared/theme/) — preset catalog、`ThemeChromeCompiler`、`rdx-theme-v1`、compose accent 派生
6. [`designs/rdc-agent-design-system/Design System Preview.html`](../../designs/rdc-agent-design-system/Design%20System%20Preview.html) — 可交互预览

## 视觉定位

RDC-Agent 是 **restrained、高密度、实色分层的精密工具**（参照 VS Code / JetBrains / Linear 的密度与克制）。裁决见 [`DESIGN.md`](../../DESIGN.md) UI 节。

- 层次由 1px 边框 + 实色表面建立；阴影只用于 popover 与 modal。
- 不使用 backdrop blur、装饰性动效、插画或渐变背景。
- 单一 accent 只承担 focus / selected / primary CTA；状态色只表达状态。
- 信息密度优先于留白：同屏能多放一行真实信息，就不要用空白替代。

## 刻度（唯一真值：`src/renderer/styles/design-system.css`）

| 维度 | 变量 | 取值 | 用法 |
|------|------|------|------|
| 控件高度 | `--control-height-sm/md/lg` | 28 / 32 / 36 | pill、列表行、导航项、输入框、按钮统一落在此三档 |
| 圆角 | `--radius-sm/md/lg/xl/full` | 4 / 6 / 8 / 12 / 9999 | 卡片 `md`；输入与按钮 `sm`；Composer 壳 `lg`；pill `full` |
| 间距 | `--space-*` | 4 基，禁奇数 px | panel 内边距 `--space-3`；section 间距 `--space-5` |
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

- 状态类一律 `is-*`：`is-active` / `is-selected` / `is-running` / `is-disabled` / `is-error`，并配对应 `aria-*`。禁止裸 `.active` / `.current`。
- 任何定义了 `:hover` 的可交互选择器必须同时定义 `:focus-visible`。
- 焦点环统一 `--token-border-focus`；禁止 `outline: none` 而不提供等效焦点样式。
- `prefers-reduced-motion` 在 `styles/global/base.css` 单点处理，组件不重复声明全局兜底。

## 双体系（摘要）

| 体系 | 数据 | 作用域 |
|------|------|--------|
| 全局 Appearance | `appearance.theme` + `chromeThemes.light\|dark` | Shell、Settings、transcript、全局 CTA/focus |
| Compose Agent | `.agent.md` `accent` → `--composer-mode-accent` / `--composer-effort-*` | Composer 边框、send、Effort/Max 色相；禁止 energy orbit / 流光 |

- Light/Dark（含 system）影响两套体系的亮度调制。
- 不提供 translucent sidebar。
- 主题分享格式：`rdx-theme-v1:`（拒绝 `codex-theme-v1:`）。
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
- **禁止**新增第三套按钮类名，禁止在 feature CSS 中重复定义按钮样式。

## 颜色使用规则

- 强调色（`--color-accent-*`）只用于：焦点环、激活状态、主要 CTA（非 Composer）。不得用于正文、装饰或多处背景。全局 accent 来自 Appearance chrome 编译，不接管 Composer。
- 状态色（success / warning / error / info）只用于语义状态，不得挪作装饰。
- **双体系**：全局 chrome（`chromeThemes.light|dark` → `ThemeChromeCompiler`）驱动 shell/Settings/transcript；Composer 第二套由当前 agent 的 `.agent.md` `accent` 派生 `--composer-mode-accent` 与 `--composer-effort-*`（边框、send、Effort/Max 滑条、Max 字色、Max mode / Fast 开关开态、`2x`/`Fast` pill）。禁止这些 compose 控件再读 `--token-border-focus` 或裸 `--token-effort-*` 作为唯一色源。Light/Dark 只调制 compose 派生色的亮度，不替换色相来源。`--token-effort-*` 仅为 compose 变量缺省回退，禁止挪作其它装饰或背景。
- Effort 弹层的 Max mode / Fast mode 是稳定能力槽位，不随模型消失：unsupported 显示灰色关闭，fixed 显示灰色开启，selectable 才允许切换。
- Agent accent 必须可配置（`.agent.md` + Settings → Agents GUI）；`AGENT_SEED_ACCENTS` 仅用于 builtin seed 初值，不是运行时权威。
- `--token-context-*` 色阶专用于 Context breakdown 弹窗的分段条与图例色点，不得挪作其它装饰或背景。
- 不得引入非 design-system.css / ThemeChromeCompiler 定义的新颜色；需要新颜色时先在 `--token-*` 或 chrome 编译层添加并说明用途。
- Composer 运行态禁止 energy orbit / 流光 / backdrop blur；agent accent 只体现在边框、send 与 Effort 色相。

## 新增组件规则

每个新组件必须：
1. 覆盖所有交互状态：rest / hover / active / focus / disabled（按需加 loading / error）。
2. 通过 CSS 变量控制 variant，不得在选择器里硬编码颜色。
3. 不使用内联 `style={{}}`，动态值（宽度百分比、JS 计算值）例外。
4. 文件行数不超过 300 行（组件）/ 200 行（hook / service）。

## 空态

所有空态使用统一 `<EmptyState title description? actions?>`（restrained，无插画、无渐变几何体）。Right Rail 五卡、Settings 资源列表、Knowledge 列表、Sidebar 共用同一组件。文案一句 honest copy；需要操作时把按钮放进 `actions` 槽。

当前 `RightRailEmptyVisuals` 等距玻璃插画是待 B7 删除的实现债务，不得再扩散。B7 之后 `check:design-tokens` 不再豁免 `stop-color`。

## Composer 附件卡

- 待发附件走输入框上方托盘（`composer-attachment-tray` / `composer-attachment-card`），不用 chip 文本条。
- 图片卡 72px 圆角真实缩略图；文件卡类型字形 + 文件名 + `TYPE · size`。
- 移除叉仅 hover / `:focus-within` 显现；键盘聚焦时常驻。
- 颜色、字号、间距只引用 `--token-*` / `--text-*` / `--space-*`；样式在 `composer-attachments.css`，禁止回到 `app-shell.css` 的 primitive token chip。
- `<=480px` 卡片缩尺、托盘限高滚动，不得挤掉底栏控件。

## Transcript 卡壳

审批卡、Work Process tool 卡、Asked 卡、Sub Agent 子行、Tasks 快照卡、图像缩略图与 Compact 摘要共用同一组变量（定义在 `design-system.css`）：`--transcript-card-radius` / `--transcript-card-padding` / `--transcript-card-border` / `--transcript-card-surface` / `--transcript-card-shadow` / `--transcript-card-icon-size`。禁止再为某一类卡另起一套 radius/padding/border/背景，也禁止 tool 卡图标硬编码 px。缩略图经 `conversation:getToolImagePreview` 取 `data:` URL，禁止把大图 base64 写进 `resultPreview`。

## 模态尺寸

知识中心与 Settings 用视窗比例驱动：约 `min(92vw, 1920px) × min(90vh, 1240px)`，带最小尺寸下限；960 堆叠，640 全屏。禁止再写互相覆盖的多段 media query。`--settings-content-max` 随大屏上调，避免内容挤在中间一条。

知识中心与 Settings 的内容使用实色分层、紧凑工具栏与清晰标题，避免嵌套装饰框和重复说明。Knowledge 保持空间 / 列表 / 详情三列（列宽 `224 / minmax(280, 0.8fr) / 1.2fr`），左栏仅放视图与空间导航；类型、生命周期与六条检索通道收进列表的筛选入口，以文字按钮表达多选；索引维护与卡片元数据默认折叠；960px 以下用空间 / 列表 / 详情切换且始终提供关闭入口。Settings 保持九项导航与均分 User / Project 作用域；640px 以下导航单行横向滚动，内容全屏。宽屏下 Light / Dark 编辑器并排，小屏堆叠。资源空态共用 `EmptyState`，不添加装饰性文案；路径、模型名与元数据允许换行。说明文案仅保留操作条件、作用域和必要风险，内部实现细节留在文档。

## 右键上下文菜单

全应用文本面使用自绘 `ContextMenu`（`src/renderer/ui/ContextMenu`），不走原生 `Menu.popup`，以保证 Browser / Desktop parity。

- 背景 `--token-bg-overlay`，边框 `--token-border-card`，阴影 `--token-shadow-popover`，hover `--token-interactive-hover`，灰项 `--token-text-disabled`，分隔线 `--token-border-muted`，层级 `--z-popover`。
- 可编辑区：撤销 / 重做 / 剪切 / 复制 / 粘贴 / 粘贴并清理格式 / 全选；只读区：复制 / 全选。快捷键按平台显示 `Ctrl` 或 `⌘`。
- 定位走 `useDynStyle`（CSP `style-src-attr 'none'`）；靠近视口右/下边缘翻转；约 390px 必须完整在 viewport 内。
- `role="menu"` + `role="menuitem"`；Arrow / Home / End / Enter / Escape；Escape 把焦点还给原元素；`prefers-reduced-motion` 下不播入场动画。
- 侧栏 Session/Project 自有菜单用 `data-owns-context-menu` 排除。

## 窄屏 Workbench

- `<=720px` 时桌面工作区最小宽度必须解除，主区与 Composer 以真实 viewport 收缩，不得用 `overflow: hidden` 掩盖被裁掉的桌面宽度。
- `<=480px` 时 Composer Footer 使用两层、每层不换行的工具栏：Attach / Agent / Permission 在第一层，Model / Effort / Usage / Send 在第二层；所有控件必须可点击，不得互相覆盖。
- Agent / Permission / Effort / Usage / Model 菜单在窄屏锚定到 Composer 上方并完整位于 viewport 内；同一时刻只开一个；running 与 selected 分列，约 8px 状态点使用 semantic status token，`prefers-reduced-motion: reduce` 时停止动画。
- Browser 验收至少覆盖约 390px viewport、水平溢出、菜单 selected/running、键盘导航、Escape 焦点返回及 reduced-motion。

## 组件清单（`src/renderer/ui`）

原子：`Button`、`IconButton`、`Icon`、`Switch`、`Checkbox`、`Kbd`、`Divider`、`Spinner`、`Toast`。

分子：`Pill`、`SectionHeader`、`Popover`、`Menu`、`Input`、`Textarea`、`SearchField`、`Select`、`ListRow`、`Panel`、`EmptyState`、`InlineError`、`Tabs`、`ColorField`。

每件必须：全部交互态、CSS 变量 variant、共置 CSS ≤300 行、`ui/index.ts` 导出。禁止 feature 再造第二套弹层 / 空态 / 输入。

## 各面推荐 composition

| 产品面 | 组合 |
|--------|------|
| Settings 九 section | `SectionHeader` + `Panel` + `ListRow` + `Input` / `Select` / `Switch` + `Button` |
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

`check:design-tokens` 豁免：token 定义层 `styles/design-system.css`；`styles/global/base.css` 的 reduced-motion `!important`；Right Rail `stop-color` 随 B7 空态收敛删除。新增豁免必须先改本文件再改脚本。

### 规则 → 门禁 / 债务批次

| 规则 | 当前 enforcement | 清零批次 |
|------|------------------|----------|
| 语义 token / 禁 primitive、hex、px 字号间距圆角、`!important`、blur | `check:design-tokens` | B1 已清零 |
| 层依赖、feature 横向、组件直调 IPC、退役目录、global feature 选择器 | `check:renderer-structure` 棘轮 45 | B3 → hits=0 |
| `is-*` 状态类（禁裸 `.active` / `.current`） | `check:renderer-structure` 已扫 TSX | B3 清零剩余 5 |
| 刻度 control 28/32/36、radius 4/6/8/12、duration 120/180/240 | 文档权威；token 文件 B1 已改值 | B1 已落地 |
| `:hover` 必配 `:focus-visible`；禁无替代 `outline: none` | 无自动门禁 | **B8** 扫描清零 |
| 分子组件清单与交互态 / CSS 变量 variant / 禁内联 style | `src/renderer/ui` 已落地；luna 审查 | **B2** 已落地 |
| 统一 `EmptyState`（无插画） | 组件已落地；Right Rail 玻璃空态仍在 | **B2** 组件；**B7** 替换五卡空态 |
| Composer 禁 energy orbit / 流光 | 文档禁止；实现仍在 | **B6** |
| DropdownSelect 禁 backdrop blur | `check:appearance` 要求实色 `--token-bg-shell`、禁止 blur | B1 已反转 |
| Preview 引用运行时 CSS，删除 `designs/tokens/*` | Preview 已改；副本已删并入 `retired` | **B2** 已落地 |
| i18n 拆分、硬编码入 i18n、sentence case | key 已拆到 `i18n/locales/{en,zh-CN}/`；硬编码与 sentence case 仍待扫 | **B3** 拆分；**B8** 文案 |
| `check:architecture` R4 hex exempt | 仅 `design-system.css` | B1 已清空 |
| `pages/`、`styles/base/` 删除 | 两者已删并入 `retired`；`check:renderer-structure` hits=0 | B1 已删 `styles/base`；**B3** 已删 `pages/` |

受门禁锁定的 renderer 文件路径集中登记在 [`scripts/fidelity/renderer-contract.json`](../../scripts/fidelity/renderer-contract.json)：`files` 为必存在锚点，`retired` 为必须保持删除的退役路径。移动或重命名这些文件时只改该 manifest。

浏览器真实会话覆盖 Settings → Appearance、agent accent、Light/Dark、Compose Effort 染色边界（见 [`appearance-checklist.md`](appearance-checklist.md)）。验收前须重启最新 `start:agent-browser`，并删除该 QA project 下全部 session 后新建隔离 session。

Knowledge Case 详情正文按章节分节，目录使用可换行的链接控件；缺失章节统一提示，不重复渲染空白章节。卡片信息使用带 aria-expanded 的统一 Button 展开，元数据分组排版。完整 JSON 对象 / 数组仅在阅读层转为字段与列表，保留未知字段及所有值；普通 Markdown 和无法解析的内容保持原文，禁止回写或改变知识事实。

Case 阅读层按内容安排主次：预期 / 实际使用并列对照，短属性使用紧凑网格与行内列表；禁止递归缩进线和宽标签列。证据摘要常驻，来源及参数由统一按钮按需展开，不将编号、参数置于摘要之前占据正文。窄屏对照改为纵向排列。
