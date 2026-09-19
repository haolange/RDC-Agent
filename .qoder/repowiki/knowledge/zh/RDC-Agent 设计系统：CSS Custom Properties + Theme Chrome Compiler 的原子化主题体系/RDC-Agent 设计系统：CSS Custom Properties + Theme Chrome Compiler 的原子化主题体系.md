---
kind: frontend_style
name: RDC-Agent 设计系统：CSS Custom Properties + Theme Chrome Compiler 的原子化主题体系
category: frontend_style
scope:
    - '**'
source_files:
    - src/renderer/styles/design-system.css
    - src/renderer/styles/global.css
    - src/renderer/styles/global/base.css
    - src/renderer/styles/global/app-shell.css
    - src/renderer/ui/kit.css
    - src/shared/theme/index.ts
    - src/shared/theme/compiler.ts
    - src/shared/theme/presets.ts
    - src/shared/theme/color.ts
    - src/shared/theme/uiPreferences.ts
    - src/shared/theme/composeAccent.ts
    - scripts/check-design-tokens.mjs
    - scripts/check-appearance.mjs
    - scripts/fidelity/design-tokens-baseline.json
    - docs/ui/design-system.md
    - designs/rdc-agent-design-system/Design System Preview.html
---

## 1. 采用的样式体系

RDC-Agent 采用 **纯 CSS Custom Properties（CSS 变量）+ 运行时 Theme Chrome Compiler** 的设计系统，不使用 Tailwind、Styled Components、Emotion、JSS 等框架。所有视觉刻度（颜色、间距、圆角、字号、行高、阴影、z-index、动效时长、字体族）集中在 `src/renderer/styles/design-system.css` 的 `:root` 中声明为 primitive token（`--color-primary-*`、`--color-accent-*`、`--color-bg-0..5`、`--space-*`、`--radius-*`、`--text-*`、`--leading-*`、`--shadow-*`、`--duration-*`、`--ease-*`、`--z-*`），并通过语义层 `--token-*` 暴露给组件使用。

主题切换由 `src/shared/theme/` 下的 TypeScript 模块驱动：`presets.ts` 定义预设目录（`THEME_PRESET_CATALOG`，包含 rdc / absolutely / ayu / catppuccin / dracula / everforest / github / gruvbox / linear），`compiler.ts` 的 `compileThemeChrome()` 将用户选择的 accent/surface/ink/contrast/fonts 编译为一组 CSS 自定义属性补丁，再通过 constructable stylesheet（`adoptedStyleSheets` / `useDynStyle` / `assignDynStyle`）注入到 `:root`，从而在 CSP 限制下（生产策略 `style-src 'self'` + `style-src-attr 'none'`）实现无内联 `<style>` 的主题渲染。

## 2. 关键文件与包

- **设计系统 token 定义**：`src/renderer/styles/design-system.css`（primitive 与 semantic token 层）、`src/renderer/styles/global.css`（唯一全局入口，import design-system.css、ui/kit.css、global/base/app-shell/responsive/pointer-cursors.css）
- **主题编译器与预设**：`src/shared/theme/compiler.ts`、`src/shared/theme/presets.ts`、`src/shared/theme/color.ts`、`src/shared/theme/index.ts`、`src/shared/theme/uiPreferences.ts`、`src/shared/theme/rdxThemeV1.ts`、`src/shared/theme/composeAccent.ts`、`src/shared/theme/sanitize.ts`
- **UI 组件库**：`src/renderer/ui/` 下每个组件一个 `.tsx` + `.css` 对，统一通过 `src/renderer/ui/kit.css` 聚合导入；按钮系统为全局唯一（`.button` + variant 类名）
- **应用外壳布局**：`src/renderer/styles/global/app-shell.css`（三列 Grid 布局、标题栏、侧边栏、主内容区、上下文用量弹窗、输入栏）
- **质量门禁脚本**：`scripts/check-design-tokens.mjs`（正则扫描 CSS，禁止 primitive token、硬编码 hex、px 字号/间距/圆角、`!important`、非 `var(--modal-backdrop-filter)` 的 backdrop-filter）、`scripts/check-appearance.mjs`（校验预设目录、默认主题、序列化/反序列化 round-trip、Compose accent 派生规则）
- **保真度基线**：`scripts/fidelity/design-tokens-baseline.json`（B1 清零，任何新命中即失败）
- **文档**：`docs/ui/design-system.md`（权威规范，含 Primitive→Semantic 迁移对照表、状态类命名约定、新增组件规则、模态尺寸、窄屏 Workbench 规则等）
- **预览资源**：`designs/rdc-agent-design-system/Design System Preview.html`（只读 HTML，直接复用运行时 CSS 进行交互预览）

## 3. 架构与约定

### Token 分层
- **Primitive 层**（`design-system.css` 的 `:root`）：颜色阶梯、空间刻度、排版刻度、阴影、z-index、动效、布局常量。
- **Semantic 层**（`design-system.css` 的 `--token-*`）：`--token-bg-app/shell/panel/raised/overlay`、`--token-text-heading/body/caption/placeholder/disabled`、`--token-border-*`、`--token-status-*`、`--token-accent-primary`、`--token-shadow-*`、`--token-context-*` 等。
- **组件层**：仅允许引用 `--token-*`、`--text-*`、`--space-*`、`--radius-*`、`--control-*` 及组件自身变量，禁止直接使用 `--color-bg-3`、`rgb(var(--color-accent-500))` 等 primitive。

### 双体系主题
- **全局 Appearance 体系**：由 `appearance.theme` + `chromeThemes.light|dark` 经 `ThemeChromeCompiler` 驱动 Shell、Settings、transcript、全局 CTA/focus。
- **Compose Agent 体系**：由当前 agent 的 `.agent.md` `accent` 派生 `--composer-mode-accent` 与 `--composer-effort-*`，用于 Composer 边框、send、Effort/Max 滑条、Max 字色、运行态 energy orbit 光带。

### 组件组织
- 每个 UI 组件位于 `src/renderer/ui/<ComponentName>/` 或 `src/renderer/ui/ComponentName.tsx` + 同名 `.css`，通过 `kit.css` 集中聚合。
- 按钮系统全局唯一：`.button` 基类 + `.button-primary/button-secondary/button-ghost/button-danger` 变体，React 层用 `<Button variant="..." size="sm|md|lg">`。
- 状态类一律 `is-*`（`is-active/is-selected/is-running/is-disabled/is-error`），禁止裸 `.active/.current`。

### 响应式策略
- 基于 CSS Container Query（`@container (max-width: ...)`）与 CSS Grid 可变列宽（`--left-sidebar-width`、`--right-panel-width` 等 CSS 变量控制面板宽度）。
- 窄屏 Workbench：`<=720px` 解除桌面最小宽度，主区与 Composer 以真实 viewport 收缩；`<=480px` 附件卡缩尺、托盘限高滚动。
- 模态尺寸：知识中心与 Settings 居中，外壳 `88vw × 86vh`（硬顶 `120rem × 70rem`），`≤640px` 全屏去圆角。

### CSP 约束
- 生产 CSP 禁止 `unsafe-inline` 与 `style-src-attr 'none'`，因此所有动态样式必须走 constructable stylesheet（`adoptedStyleSheets` / `useDynStyle` / `assignDynStyle`），禁止 `element.style` 注入。

## 4. 约定与约束

### 强制约定（由脚本与文档双重保障）
- **Token 使用规则**（`check-design-tokens.mjs` 正则扫描 + `design-system.md` 明文规定）：组件 CSS 必须引用 `--token-*` 语义 token，禁止 primitive `--color-*`、硬编码 hex、px 字号/间距/圆角、`!important`；backdrop-filter 只能写 `var(--modal-backdrop-filter)`。
- **预设目录锁定**（`check-appearance.mjs`）：`THEME_PRESET_IDS` 必须严格等于 `['rdc','absolutely','ayu','catppuccin','dracula','everforest','github','gruvbox','linear']`，且每个 preset 的 light/dark 必须自标识 `presetId`。
- **默认主题**：light/dark 默认均为 `rdc`；`sanitizeUiPreferences` 对非法 accent/contrast/presetId 做 fail-closed 处理。
- **主题序列化格式**：必须使用 `rdx-theme-v1:` 前缀，拒绝 `codex-theme-v1:`。
- **Compose accent 派生规则**：`deriveComposeAccentVars` 必须输出 `--composer-mode-accent` 与 `--composer-effort-fill-*`，且 dark/light 模式下普通 effort fill 亮度随等级加深，Max rail 保持半透明。
- **Checkbox 视觉契约**：checkbox 必须使用 outline + ink（`--checkbox-checked-bg: transparent`），禁止 accent 实心方砖；CheckPill 必须共享 checkbox tokens，不得引入 `--token-accent-primary`。
- **Composer 运行态动画**：energy orbit 固定角度范围 −130° 至 230°、2.85s 一圈；Max 模式动画拥有 stop opacity 帧交付权，必须在清理时调用 `clearDynStyle`。
- **历史债务清零**：`design-tokens-baseline.json` 已设为 B1（零容忍），任何新命中都会导致构建失败；旧遗留文件 `oklch-themes.css`、`styles/tokens/index.css` 必须删除。
- **新增组件规则**：覆盖 rest/hover/active/focus/disabled 全部交互态；通过 CSS 变量控制 variant；不使用内联 `style={{}}`（JS 计算值例外）；组件文件 ≤ 300 行、hook/service ≤ 200 行。
- **按钮规则**：禁止新增第三套按钮类名，禁止在 feature CSS 中重复定义按钮样式。
- **空态规则**：统一使用 `<EmptyState>`，Knowledge/Sidebar 列表不放装饰几何体；Right Rail 五卡通过可选 `visual` 槽恢复 token 着色的等距场景。
- **右键菜单**：全应用文本面使用自绘 `ContextMenu`，不走原生 `Menu.popup`，保证 Browser/Desktop parity。

### 设计原则（来自 `design-system.md`）
- 视觉定位：restrained、高密度、实色分层的精密工具（参照 VS Code / JetBrains / Linear）。
- 层次由 1px 边框 + 实色表面建立；阴影仅用于 popover/modal。
- 单一 accent 仅承担 focus/selected/primary CTA；状态色只表达状态。
- 信息密度优先于留白。
- 不提供减少动效设置，不读取系统减少动效偏好。
- 不提供 translucent sidebar。

## 5. 适用性说明

本仓库是 Electron + pnpm Workspace 的桌面应用工程，前端渲染进程使用 React + 纯 CSS Custom Properties 构建完整的设计系统与主题引擎，具备明确的 token 分层、运行时主题编译、质量门禁脚本与设计文档，完全符合 frontend_style 范畴。