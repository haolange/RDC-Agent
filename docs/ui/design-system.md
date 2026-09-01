# RDC-Agent UI / Design System

权威来源（按优先级）：

1. [`DESIGN.md`](../../DESIGN.md) — 产品边界与不变量裁决
2. [`workbench-and-transcript.md`](workbench-and-transcript.md) — Workbench / Composer Effort / transcript 产品规格
3. [`AGENTS.md`](../../AGENTS.md) — token / 按钮 / Appearance 执行纪律
4. [`src/renderer/styles/design-system.css`](../../src/renderer/styles/design-system.css) — primitive + semantic token 定义
5. [`src/shared/theme/`](../../src/shared/theme/) — preset catalog、`ThemeChromeCompiler`、`rdx-theme-v1`、compose accent 派生
6. [`designs/rdc-agent-design-system/Design System Preview.html`](../../designs/rdc-agent-design-system/Design%20System%20Preview.html) — 可交互预览

## 双体系（摘要）

| 体系 | 数据 | 作用域 |
|------|------|--------|
| 全局 Appearance | `appearance.theme` + `chromeThemes.light\|dark` | Shell、Settings、transcript、全局 CTA/focus |
| Compose Agent | `.agent.md` `accent` → `--composer-mode-accent` / `--composer-effort-*` | Composer 边框流光、泛光、mode pill、send、Effort/Max |

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

- 全局唯一按钮系统：`.button`（基类） + `.button-primary / button-secondary / button-ghost / button-danger`，定义在 `panels-composer.css`。
- React 层用 `<Button variant="primary|secondary|ghost|danger" size="sm|md|lg">`（`src/renderer/ui/Button.tsx`）。
- **禁止**新增第三套按钮类名，禁止在 feature CSS 中重复定义按钮样式。

## 颜色使用规则

- 强调色（`--color-accent-*`）只用于：焦点环、激活状态、主要 CTA（非 Composer）。不得用于正文、装饰或多处背景。全局 accent 来自 Appearance chrome 编译，不接管 Composer。
- 状态色（success / warning / error / info）只用于语义状态，不得挪作装饰。
- **双体系**：全局 chrome（`chromeThemes.light|dark` → `ThemeChromeCompiler`）驱动 shell/Settings/transcript；Composer 第二套由当前 agent 的 `.agent.md` `accent` 派生 `--composer-mode-accent` 与 `--composer-effort-*`（边框流光、边缘泛光、mode pill、send、Effort/Max 滑条、Max 字色、Max mode / Fast 开关开态、`2x`/`Fast` pill）。禁止这些 compose 控件再读 `--token-border-focus` 或裸 `--token-effort-*` 作为唯一色源。Light/Dark 只调制 compose 派生色的亮度，不替换色相来源。`--token-effort-*` 仅为 compose 变量缺省回退，禁止挪作其它装饰或背景。
- Effort 弹层的 Max mode / Fast mode 是稳定能力槽位，不随模型消失：unsupported 显示灰色关闭，fixed 显示灰色开启，selectable 才允许切换。
- Agent accent 必须可配置（`.agent.md` + Settings → Agents GUI）；`AGENT_SEED_ACCENTS` 仅用于 builtin seed 初值，不是运行时权威。
- `--token-context-*` 色阶专用于 Context breakdown 弹窗的分段条与图例色点，不得挪作其它装饰或背景。
- 不得引入非 design-system.css / ThemeChromeCompiler 定义的新颜色；需要新颜色时先在 `--token-*` 或 chrome 编译层添加并说明用途。

## 新增组件规则

每个新组件必须：
1. 覆盖所有交互状态：rest / hover / active / focus / disabled（按需加 loading / error）。
2. 通过 CSS 变量控制 variant，不得在选择器里硬编码颜色。
3. 不使用内联 `style={{}}`，动态值（宽度百分比、JS 计算值）例外。
4. 文件行数不超过 300 行（组件）/ 200 行（hook / service）。

## 空态插画（Right Rail Empty Visuals）

Session 右侧栏五张卡（Progress / Artifacts / Outputs / Context / Capture）的空态使用统一的**等距 3D 磨砂玻璃插画**语言，实现在 `src/renderer/features/debugger/ControlPanel/RightRailEmptyVisuals.tsx`，样式在 `RightRail.css`：

- 构图：等距投影几何体（顶面高亮、左右侧面半透明渐变互透）+ 底部 `feGaussianBlur` 弥散地面投影 + 顶部边缘 1px 白色高光；无动画，天然兼容 `prefers-reduced-motion`。
- 色彩：插画是图形资产而非 UI 语义色载体。渐变 stop 只允许引用既有 primitive 色谱（`--color-primary-*` / `--color-accent-*` / `--color-success` / `--color-warning` / `--color-purple` / `--color-pink` 及其 `color-mix` 淡化），通过 `.rr-eg-{tone}-hi/lo` 类经 CSS 注入 `stop-color` / `stop-opacity`（presentation attribute，CSP 合规），随 chrome light/dark 与预设自动适配；**禁止**在 SVG 属性或 CSS 中写死 hex 色值。白色高光与黑/墨阴影是玻璃技法固有中性色，透明度由 `.right-rail-empty-visual` 上的 `--rr-eg-*-op` 变量按主题分支调制。
- 上述状态色/彩虹 primitive 在插画内的装饰性使用是本小节的显式例外，不违反「状态色只用于语义状态」；例外范围仅限 `.right-rail-empty-visual` 内部，不得扩散到其它组件。
- 语义：Progress=上升台阶（蓝→青→绿→琥珀，最高块带进行中光点）；Artifacts=分层玻璃记录+链接节点；Outputs=虚线收集框+悬浮玻璃文件；Context=异色玻璃节点发光连线网；Capture=玻璃 capture 卡+播放徽标+REC 点。文案保持一句 honest copy，图形不承载文字。
- gradient/filter 的 `id` 必须带场景前缀（`rr-eg-<scene>-*`），保证五卡同屏唯一；不引入 svgr/图片资产双轨。

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

## 视觉参考

`designs/rdc-agent-design-system/Design System Preview.html`——在浏览器打开，可交互查看所有 token、组件规范和完整 dark/light 两套主题展示。写新组件前应先参考对应 section。

## 验证

```bash
pnpm run check:appearance
pnpm run typecheck
```

浏览器真实会话覆盖 Settings → Appearance、agent accent、Light/Dark、Compose Effort 染色边界（见 [`appearance-checklist.md`](appearance-checklist.md)）。验收前须重启最新 `start:agent-browser`，并删除该 QA project 下全部 session 后新建隔离 session。
