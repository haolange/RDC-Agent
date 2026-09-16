---
kind: frontend_style
name: RDC-Agent 设计系统：CSS 自定义属性 + 运行时 Appearance Chrome 主题体系
category: frontend_style
scope:
    - '**'
source_files:
    - src/renderer/styles/design-system.css
    - src/renderer/styles/global.css
    - src/renderer/ui/kit.css
    - src/shared/theme/compiler.ts
    - src/shared/theme/presets.ts
    - src/shared/theme/uiPreferences.ts
    - src/shared/theme/color.ts
    - src/shared/theme/composeAccent.ts
    - src/shared/theme/sanitize.ts
    - src/shared/theme/rdxThemeV1.ts
    - scripts/check-design-tokens.mjs
    - scripts/check-appearance.mjs
    - docs/ui/appearance-checklist.md
    - designs/rdc-agent-design-system/Design System Preview.html
    - src/renderer/styles/global/app-shell.css
    - src/renderer/styles/global/responsive.css
    - src/renderer/styles/global/base.css
    - src/renderer/styles/global/pointer-cursors.css
---

## 1. 使用的系统与工具

- **纯 CSS 自定义属性（CSS Variables）驱动的设计系统**，无 Tailwind、无 CSS-in-JS 样式库。所有颜色、间距、圆角、字体、阴影、动效时长等均以 `--color-*` / `--space-*` / `--radius-*` / `--text-*` / `--shadow-*` 等原语变量声明。
- **三层 Token 架构**：
  - 原语层（Primitive）：`src/renderer/styles/design-system.css` 中 `:root` 下的 `--color-bg-*`、`--color-accent-*`、`--space-*`、`--radius-*`、`--text-*`、`--font-*`、`--shadow-*`、`--z-*`、`--duration-*`、`--control-*` 等。
  - 语义层（Semantic）：同一文件中的 `--token-bg-*`、`--token-text-*`、`--token-accent-primary`、`--token-status-*`、`--token-shadow-*`、`--token-surface-*`、`--token-context-*`、`--token-effort-*` 等，组件 CSS 必须引用这些而非原语。
  - 组件层（Component）：`--btn-*`、`--input-*`、`--card-*`、`--modal-*`、`--badge-*`、`--checkbox-*` 等 per-component 变量。
- **运行时 Appearance Chrome 主题系统**：`src/shared/theme/` 提供 TypeScript 主题编译器与预设目录，通过 `compileThemeChrome(chrome, variant)` 把用户选择的 accent/surface/ink/contrast/fonts 编译为 CSS 变量补丁，并以 Constructable Stylesheets (`adoptedStyleSheets.replaceSync`) 注入到 `:root`，覆盖 `design-system.css` 的默认值。
- **内置主题预设**：`THEME_PRESET_CATALOG` 包含 `rdc`、`absolutely`、`ayu`、`catppuccin`、`dracula`、`everforest`、`github`、`gruvbox`、`linear` 九套 light/dark 预设，默认主题为 `rdc`。
- **字体缩放**：通过 `data-font-scale='small'|'medium'|'large'` 在 `:root` 上覆盖 `--text-*` 字号。
- **构建与质量门禁**：`pnpm check:design-tokens` 扫描 `src/renderer/**/*.css`，禁止使用原始 `--color-*`、十六进制字面量、硬编码 px 间距/字号/圆角、`!important`、`backdrop-filter: blur`；仅 `design-system.css` 可豁免。结果以 `scripts/fidelity/design-tokens-baseline.json` 做债务 ratchet（只允许减少）。
- **Appearance 验收脚本**：`scripts/check-appearance.mjs` 断言预设目录、默认值、编译器输出、`rdx-theme-v1` 序列化/反序列化、Effort 动画契约、Constructable Stylesheet 注入方式、ColorField/DropdownSelect 无障碍与视觉约束等。

## 2. 关键文件

- `src/renderer/styles/design-system.css` — 设计系统唯一 token 定义入口，含暗/亮两套原语、语义 token、组件 token、全局动画 keyframes 与通用 utility class（`.ui-badge`、`.ui-icon-btn`、`.ui-avatar`、`.ui-skeleton`、`.gradient-border`、`.glow-*`、`.status-dot-*`、`.scrollbar-thin` 等）。
- `src/renderer/styles/global.css` — 应用级入口，`@import` design-system 与 `ui/kit.css` 以及 `global/base.css`、`app-shell.css`、`responsive.css`、`pointer-cursors.css`。
- `src/renderer/ui/kit.css` — 聚合所有共享 UI 原子组件（Button、Input、Checkbox、Tabs、Popover、Menu、Panel、Toast、Spinner、Icon、Switch、SectionHeader、Divider、Pill、ListRow、EmptyState、InlineError、Kbd、SearchField）的样式。
- `src/shared/theme/compiler.ts` — 将 `ThemeChromeConfig` 编译为 `CompiledChromeCssVars`，产出 `--color-accent-*`、`--color-bg-*`、`--color-text-*`、`--font-sans`、`--font-mono`、`--color-surface-overlay` 等覆盖变量。
- `src/shared/theme/presets.ts` — `THEME_PRESET_CATALOG` 与 `getPresetChrome()`、`createDefaultChromeThemes()`。
- `src/shared/theme/uiPreferences.ts` — `UiPreferences` 默认值、`sanitizeUiPreferences`、`mergeUiPreferences`，限定 theme ∈ {dark, light, system}、language ∈ {zh-CN, en}、fontScale ∈ {small, medium, large}。
- `src/shared/theme/color.ts`、`composeAccent.ts`、`sanitize.ts`、`rdxThemeV1.ts` — 色板缩放、对比度对生成、Compose 专用 accent 派生、`rdx-theme-v1:` 主题字符串编解码。
- `docs/ui/appearance-checklist.md` — Appearance 改动后的手动验收清单。
- `scripts/check-design-tokens.mjs`、`scripts/check-appearance.mjs` — CI 风格的质量门禁脚本。
- `designs/rdc-agent-design-system/Design System Preview.html` — 基于运行时 CSS 变量的 Design System 只读预览页面。

## 3. 架构与设计约定

- **Token 分层强制**：组件 CSS 只能引用 `--token-*`、`--text-*`、`--space-*`、`--radius-*`、`--control-*`、组件变量；禁止直接引用 `--color-*` 原语或写死 hex/px。该规则由 `check:design-tokens` 正则扫描并锁定 baseline，任何新增违规都会导致失败。
- **主题切换不依赖 `<style>` 注入**：`applyChromeTheme` 必须使用 `adoptedStyleSheets` + `replaceSync`，不得创建 `<style>` 节点或使用 `style.colorScheme` 内联属性，以兼容 CSP `style-src` 限制。
- **表面材质克制**：明确禁用 `backdrop-filter: blur`，所有面板/菜单/弹层使用实色 surface（`--token-bg-shell`、`--token-bg-panel`、`--token-bg-raised`），通过多层阴影与顶部 `inset 0 1px 0 rgba(255,255,255,0.08)` 高光（`--highlight-edge`）表达 macOS 风格层级。
- **暗/亮双套原语**：`design-system.css` 中 `:root` 定义暗色原语，`:root:where([data-resolved-theme='light'])` 覆盖亮色原语；`data-font-scale` 再叠加字号缩放。
- **组件尺寸统一**：控件高度走 `--control-height-sm|md|lg`（28/32/36px），圆角走 `--control-radius`，按钮/输入/卡片均有对应 `--btn-*`、`--input-*`、`--card-*` 变量族。
- **Effort 强度指示专用 token**：`--token-effort-fill-1..5`、`--token-effort-thumb`、`--token-effort-track`、`--token-effort-max-*` 专用于 Composer Effort 滑杆，注释明确“不得挪作装饰”；Light/Dark 下亮度递进方向不同，由 `check-appearance` 断言。
- **Context breakdown 分段专用 token**：`--token-context-system-prompt/memory-files/skills/system-tools/mcp-tools/subagents/summarized/conversation/deferred/free` 是独立语义位，不得复用 `--token-accent-*` / `--token-status-*`。
- **国际化与语言**：`UiPreferences.language` 限定为 `zh-CN` 或 `en`，默认 `zh-CN`。

## 4. 约定与约束（描述性 + 经脚本验证的规则）

- **组件 CSS 必须使用语义 token**：禁止 `var(--color-*)`、十六进制颜色字面量、硬编码 `font-size`/`padding`/`margin`/`border-radius` 的 px 值；仅 `design-system.css` 可豁免。违反时 `check:design-tokens` 报错并通过 `scripts/fidelity/design-tokens-baseline.json` 做债务 ratchet。
- **禁止 `!important`**：组件 CSS 不得使用 `!important`。
- **禁止 backdrop blur**：所有下拉/菜单/弹层必须用实色背景，不得使用 `backdrop-filter: blur`。
- **主题注入必须使用 Constructable Stylesheets**：`applyChromeTheme` 必须使用 `adoptedStyleSheets` + `replaceSync`，不得注入 `<style>` 文本或设置 `style.colorScheme`。
- **主题预设集合固定**：`THEME_PRESET_CATALOG` 必须恰好包含 `rdc`、`absolutely`、`ayu`、`catppuccin`、`dracula`、`everforest`、`github`、`gruvbox`、`linear`，且每项 `light.presetId`/`dark.presetId` 必须等于自身 `id`。
- **默认主题与偏好**：默认 theme 为 `dark`，默认 chrome preset 为 `rdc`，默认 fontScale 为 `medium`，默认 language 为 `zh-CN`，`usePointerCursors` 默认为 false。
- **Contrast 范围与 sanitize**：contrast 被 clamp 到 100，未知 presetId 回退到 `rdc`，非法 accent 回退为 hex。
- **Effort 动画契约**：Max 模式 stop opacity 必须由 `EffortMaxField` 通过 `assignDynStyle('--composer-effort-stops-opacity', ...)` 独占控制并在 cleanup 时 `clearDynStyle`；布局测量必须在启用 position transition 前完成（`positionTransitionsReady` + `requestAnimationFrame` + `cancelSettleFrame`）。
- **ColorField 无障碍**：必须使用自绘 `ColorPickerSurface`，平面与色相轨暴露 `role="slider"` 与键盘事件；hex 输入宽度固定为 `9.5ch`，不得使用原生 OS color input。
- **DropdownSelect 菜单**：必须使用 `--token-bg-shell` 实色背景，带 caret tip，选中项用 checkmark 而非实心圆点。
- **主入口导入约束**：`main.tsx` 必须 import `styles/global.css`，不得 import `styles/tokens`；`styles/themes/oklch-themes.css` 与 `styles/tokens/index.css` 必须不存在。
- **文档一致性**：`AGENTS.md` 必须提及 Appearance 与“禁止恢复 translucent”，`DESIGN.md` 必须指向 `docs/ui/` 作为 Appearance/UI 权威来源并记录 CSP `style-src` 与 schema 版本边界，`docs/ui/design-system.md` 必须记录 `rdx-theme-v1` 与 `chromeThemes`。
- **响应式策略**：通过 `styles/global/responsive.css` 与 `useNarrowViewport` hook 处理窄屏（如 390px 下右键菜单翻转、Composer 底栏 Model override 不越界）。
- **Design System 预览**：`designs/rdc-agent-design-system/Design System Preview.html` 直接复用运行时 CSS 变量，作为只读视觉参考。

## 5. 总结

RDC-Agent 采用“CSS 自定义属性 + 运行时主题编译器”的轻量设计系统：所有视觉原语集中在 `design-system.css`，组件通过语义 `--token-*` 变量消费，Appearance 设置通过 TypeScript 编译器动态覆盖 CSS 变量，并由 `check:design-tokens` 与 `check:appearance` 两个 Node 脚本在提交前强制执行 token 合规、禁用模糊玻璃态、固定预设集合与 Effort/ColorField/Dropdown 等交互契约。整个体系不依赖第三方 UI 框架或 CSS 预处理器，完全由 CSS Variables 与脚本门禁保障一致性与可维护性。