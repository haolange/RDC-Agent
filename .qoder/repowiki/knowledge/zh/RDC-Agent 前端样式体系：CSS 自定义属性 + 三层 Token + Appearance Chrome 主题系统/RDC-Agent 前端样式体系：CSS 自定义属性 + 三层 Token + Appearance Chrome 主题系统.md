---
kind: frontend_style
name: RDC-Agent 前端样式体系：CSS 自定义属性 + 三层 Token + Appearance Chrome 主题系统
category: frontend_style
scope:
    - '**'
source_files:
    - src/renderer/styles/design-system.css
    - src/renderer/styles/global.css
    - src/renderer/styles/global/base.css
    - src/renderer/ui/kit.css
    - src/renderer/ui/Button.css
    - src/shared/theme/compiler.ts
    - src/shared/theme/presets.ts
    - src/shared/theme/index.ts
    - scripts/check-appearance.mjs
    - designs/rdc-agent-design-system/readme.md
---

## 1. 采用的样式系统与方法论

RDC-Agent 的 UI 风格完全基于 **原生 CSS Custom Properties（CSS 变量）+ 语义化 Token 层**，没有引入 Tailwind、Styled Components、CSS Modules 或第三方 UI 组件库。核心思想是“设计系统即运行时可编译的主题”：所有颜色、字号、间距、圆角、阴影、动效时长、z-index 层级都通过 `:root` 下的 `--color-*`、`--space-*`、`--text-*`、`--radius-*`、`--shadow-*`、`--z-*`、`--transition-*` 等原始 token 声明，再在 `design-system.css` 中映射为 `--token-bg-*`、`--token-text-*`、`--token-accent-*`、`--btn-*`、`--input-*`、`--card-*`、`--modal-*` 等语义 token，最终由组件 CSS（如 `Button.css`、`Input.css`）消费这些语义 token。

主题切换不是靠切换 class，而是通过 `src/shared/theme/compiler.ts` 中的 `compileThemeChrome()` 把用户选择的 preset（`rdc`、`absolutely`、`ayu`、`catppuccin`、`dracula`、`everforest`、`github`、`gruvbox`、`linear`）与明/暗模式组合成一组 CSS 变量补丁，再以 **Constructable Stylesheets + `adoptedStyleSheets.replaceSync()`** 注入到 `:root`，从而覆盖默认 token。这使外观（Appearance）成为运行时可持久化的 chrome 配置，而非构建期产物。

## 2. 关键文件与包

- **设计系统根入口**：`src/renderer/styles/design-system.css` — 定义全部原始 token、动画 keyframes、通用 utility class（`.ui-badge`、`.ui-skeleton`、`.status-dot-*`、`.glow-*`、`.gradient-border` 等）、语义 token 层与组件 token 层；同时提供 light/dark 两套 `:root` 覆盖。
- **全局样式入口**：`src/renderer/styles/global.css` — 仅做 `@import` 编排：design-system → kit → global/base → app-shell → responsive → pointer-cursors。
- **基础重置与主题开关**：`src/renderer/styles/global/base.css` — box-sizing reset、`html { color-scheme: dark }`、`body` 使用 `var(--token-bg-app)` 背景、`html[data-resolved-theme='light']` 切换浏览器原生配色。
- **UI Kit 聚合**：`src/renderer/ui/kit.css` — 统一 import 每个原子组件的 `.css`（Button、IconButton、Input、SearchField、Checkbox、Tabs、Popover、Menu、Panel、Toast、Spinner、Icon、Switch 等），组件以 TSX + 同名 CSS 文件组织。
- **主题编译器**：`src/shared/theme/compiler.ts` — `compileThemeChrome(chrome, variant)` 将 preset 的 accent/surface/ink/contrast/fonts 编译为 `--color-accent-*`、`--color-bg-*`、`--color-text-*`、`--font-sans`、`--font-mono`、`--color-surface-overlay` 等 CSS 变量字符串。
- **预设目录**：`src/shared/theme/presets.ts` — `THEME_PRESET_CATALOG` 列出全部内置主题，`DEFAULT_THEME_PRESET_ID = 'rdc'`。
- **Design System 只读预览**：`designs/rdc-agent-design-system/readme.md` 明确禁止复制 token，要求直接引用运行时 `design-system.css` 与 `ui/kit.css`。
- **保真度门禁**：`scripts/check-appearance.mjs` — 强制断言：preset catalog 必须匹配 Codex 列表；checkbox 必须 outline + ink 不得用 accent fill；DropdownSelect 不得使用 backdrop blur；main.tsx 必须 import `styles/global.css` 且不得 import `styles/tokens`；applyChromeTheme 必须用 constructable stylesheets 且不得注入 `<style>` textContent；ColorField 不得使用原生 OS color input 等。

## 3. 架构与约定

### 三层 Token 架构
`design-system.css` 内注释明确约束：
1. **Primitive**：`--color-bg-*`、`--color-accent-*`、`--space-*`、`--text-*`、`--radius-*`、`--shadow-*`、`--z-*`、`--transition-*` 等。
2. **Semantic**：`--token-bg-*`、`--token-text-*`、`--token-accent-*`、`--token-status-*`、`--token-effort-*`、`--token-context-*`、`--token-shadow-*`、`--control-height-*`、`--layout-*` 等。
3. **Component**：`--btn-*`、`--input-*`、`--card-*`、`--modal-*`、`--badge-*`、`--transcript-card-*` 等。

规则：**组件 CSS 优先使用 semantic token，禁止直接使用 hex 字面量；component token 必须引用 semantic token，不得回引 primitive。**

### 主题与变体
- 默认暗色主题，light 主题通过 `:root:where([data-resolved-theme='light'])` 覆盖同一组 token。
- 字体缩放通过 `data-font-scale='small'|'large'` 覆盖 `--text-*`。
- Appearance chrome 运行时编译后覆盖 `--color-accent-*`、`--color-bg-*`、`--color-text-*`、`--font-sans`、`--font-mono`、`--color-surface-overlay` 等，实现用户自定义 accent/surface/ink/contrast。
- 预置主题包括 RDC、Absolutely、Ayu、Catppuccin、Dracula、Everforest、GitHub、Gruvbox、Linear 九套。

### 组件样式组织
每个 UI 原子组件位于 `src/renderer/ui/`，采用 **TSX + 同名 `.css`** 双文件模式，并通过 `kit.css` 集中聚合。组件类名遵循 BEM-like 命名（如 `.button-primary`、`.button-sm`、`.ui-icon-btn--sm`、`.ui-badge--primary`）。组件不直接写颜色，而是消费 `--btn-*`、`--token-*` 等 token。

### 响应式策略
- 通过 `global/responsive.css` 与 `design-system.css` 底部的 `@media (max-width: 640px)` 调整布局常量（如 `--modal-workbench-inset`）。
- 无媒体查询驱动的组件级样式，主要依赖 CSS 变量与 flex/grid 自适应。

### 设计系统预览
`designs/rdc-agent-design-system/Design System Preview.html` 直接引用运行时 `src/renderer/styles/design-system.css` 与 `src/renderer/ui/kit.css`，作为只读视觉回归参考。

## 4. 约定与约束

以下约束由 `scripts/check-appearance.mjs` 在 CI/提交前门禁中强制执行：

- **Preset 白名单**：`THEME_PRESET_IDS` 必须严格等于 `['rdc','absolutely','ayu','catppuccin','dracula','everforest','github','gruvbox','linear']`，新增主题需同步更新。
- **Checkbox 视觉契约**：`--checkbox-checked-bg` 必须为 `transparent`，勾选标记走 `--checkbox-check-color`，禁止使用 `--token-accent-primary` 填充背景；CheckPill 必须复用 checkbox token。
- **DropdownSelect 禁用毛玻璃**：不得使用 `backdrop-filter: blur`，菜单背景必须使用 `var(----token-bg-shell)` 实心表面。
- **Composer 模型选择器尺寸**：高度可达 32rem，宽度必须限制为 320px（`width: min(calc(var(--space-10) * 8), calc(100vw - var(--space-6)))`）。
- **Effort 指示器**：普通档低浅→高深渐变，Max 档轨道保持半透明以保证像素场可读；Fast/Max 提示必须是居中 pill，不得定位成卡片。
- **主题应用方式**：`applyChromeTheme.ts` 必须使用 `adoptedStyleSheets` + `replaceSync`，禁止创建 `<style>` 文本节点或设置 inline style 属性（受 CSP `style-src` 限制）。
- **入口约束**：`main.tsx` 必须 import `styles/global.css`，不得 import `styles/tokens`；`styles/themes/oklch-themes.css` 与 `styles/tokens/index.css` 等遗留文件必须删除。
- **ColorField 无障碍**：色板与色相轨必须暴露 `role="slider"` 与键盘事件；不得使用原生 OS color input；hex 输入框宽度固定为 `9.5ch`，不得使用 `width: 100%`。
- **文档一致性**：`AGENTS.md` 必须包含 Appearance 说明并禁止恢复 translucent sidebar；`DESIGN.md` 必须指向 `docs/ui/` 作为权威来源并记录 CSP `style-src` 与 schema 版本边界；`docs/ui/design-system.md` 必须记录 `rdc-theme-v1` 与 `chromeThemes`。
- **Token 使用纪律**：组件 CSS 禁止直接使用 `--color-bg-*` 等原始 token，必须通过 `--token-*` 语义层；禁止硬编码 hex 值。

这套体系的核心优势是：视觉规范集中在单一 CSS 文件中，主题切换在运行时通过 CSS 变量注入完成，无需重建前端资源；同时通过脚本门禁将视觉契约固化为可执行的断言，确保多贡献者协作时风格一致。