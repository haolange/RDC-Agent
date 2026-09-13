---
kind: frontend_style
name: RDC-Agent 设计系统：CSS 自定义属性 + 运行时主题编译的三层 Token 体系
category: frontend_style
scope:
    - '**'
source_files:
    - src/renderer/styles/design-system.css
    - src/renderer/styles/global.css
    - src/renderer/styles/global/base.css
    - src/renderer/styles/global/responsive.css
    - src/shared/theme/compiler.ts
    - src/shared/theme/color.ts
    - src/shared/theme/presets.ts
    - scripts/check-design-tokens.mjs
---

## 1. 采用的体系

RDC-Agent 的前端样式基于 **CSS Custom Properties（CSS 变量）+ 运行时主题编译器**，没有引入 Tailwind、Styled Components 等原子/样式-in-JS 框架。核心由三部分构成：

- **静态设计系统层**：`src/renderer/styles/design-system.css` 定义全部 CSS 变量，包括原语色板（`--color-primary-*`、`--color-accent-*`、`--color-bg-*`）、间距（`--space-*`）、圆角（`--radius-*`）、字体（`--font-sans`、`--font-mono`）、阴影、动画、z-index、布局常量以及组件级语义 token（`--token-*`、`--btn-*`、`--input-*`、`--card-*`、`--modal-*`、`--badge-*`）。该文件同时提供 `:root[data-resolved-theme='light']` 覆盖以支持明/暗主题。
- **运行时主题编译层**：`src/shared/theme/compiler.ts` 中的 `compileThemeChrome()` 根据用户选择的 Appearance preset（`src/shared/theme/presets.ts` 中的 `THEME_PRESET_CATALOG`，含 rdc / absolutely / ayu / catppuccin / dracula / everforest / github / gruvbox / linear 等），把 `accent`、`surface`、`ink`、`contrast` 等配置通过 `color.ts` 的 HSL/RGB 转换与调色算法，生成 `--color-accent-*`、`--color-bg-*`、`--color-text-*` 等 CSS 变量并注入到 `:root`。这使得同一份 CSS 可动态切换多套外观。
- **全局样式入口**：`src/renderer/styles/global.css` 仅做 `@import` 编排：先导入 `design-system.css` 和 `../ui/kit.css`，再导入 `global/base.css`、`app-shell.css`、`responsive.css`、`pointer-cursors.css`，作为渲染进程唯一的全局样式入口。

## 2. 关键文件

- `src/renderer/styles/design-system.css` — 设计系统主文件，定义原语、语义 token、组件 token、动画 keyframes 与通用工具类（`.glass`、`.glow-*`、`.ui-badge`、`.ui-icon-btn`、`.ui-avatar`、`.ui-skeleton` 等）。
- `src/renderer/styles/global.css` — 全局样式入口，负责按顺序引入各层样式。
- `src/renderer/styles/global/base.css` — 重置、`color-scheme`、`html/body` 基础排版、滚动条样式、`prefers-reduced-motion` 处理。
- `src/renderer/styles/global/responsive.css` — 基于 `max-width: 900px` / `720px` / `640px` 三个断点的响应式布局规则，只针对 `.app-body`、`.app-sidebar-left`、`.composer-shell` 等 shell 类名生效。
- `src/shared/theme/compiler.ts` — 将 Theme Chrome 配置编译为 CSS 变量字符串（`compiledChromeToInlineStyle`）。
- `src/shared/theme/color.ts` — Hex/RGB/HSL 互转、对比度调整、色板缩放（`scaleAccentPalette`、`scaleSurfacePalette`、`scaleInkPalette`）。
- `src/shared/theme/presets.ts` — 内置 Appearance preset 目录与默认值。
- `scripts/check-design-tokens.mjs` — 强制性的设计 token 合规门禁脚本。
- `docs/ui/design-system.md`（被门禁引用）— 文档化 token 使用约定。

## 3. 架构与约定

### 三层 Token 架构
设计系统明确采用三层结构（见 design-system.css 注释）：
1. **Primitive（原语）**：`--color-*`、`--space-*`、`--radius-*`、`--text-*`、`--font-*` 等底层变量。
2. **Semantic（语义）**：`--token-*` 命名意图的别名（如 `--token-bg-app`、`--token-text-heading`、`--token-status-*`、`--token-accent-primary`、`--token-effort-*`、`--token-context-*`）。
3. **Component（组件）**：`--btn-*`、`--input-*`、`--card-*`、`--modal-*`、`--badge-*` 等组件级变量。

### 主题切换机制
- 默认暗色主题在 `:root` 中声明；浅色主题通过 `:root[data-resolved-theme='light']` 覆盖对应变量。
- 字体缩放通过 `data-font-scale='small'|'large'` 覆盖 `--text-*` 字号。
- 运行时 Appearance 通过 `compileThemeChrome()` 计算出的 CSS 变量直接覆盖 `--color-*` 原语，从而让所有依赖这些原语的 semantic/component token 自动适配新主题。

### 响应式策略
- 仅使用 `@media (max-width: ...)` 断点，不依赖 JS 媒体查询监听。
- 断点集中在 900px（收起右侧面板、隐藏标题栏中心区域）、720px（折叠侧边栏）、640px（压缩 composer 输入区）。
- 通过 CSS 变量（如 `--left-resize-handle-width`、`--right-panel-width`、`--workbench-rail-max-width`）配合 grid 布局实现可调节面板宽度。

### 无障碍与动效
- `base.css` 中通过 `html[data-reduce-motion='on']` 与 `prefers-reduced-motion: reduce` 双重开关禁用动画与过渡。
- `design-system.css` 对 `.active-signal-text.is-active` 等动效也做了 `prefers-reduced-motion` 降级。

## 4. 约定与约束（由门禁强制）

`scripts/check-design-tokens.mjs` 对 `src/renderer` 下所有 `.css` 执行正则扫描，并通过 `applyDebtRatchet` 与 `scripts/fidelity/design-tokens-baseline.json` 进行债务基线比对，新增违规必须同步更新基线或减少债务。当前规则如下：

| 规则 | 行为 | 豁免 |
|---|---|---|
| 禁止直接使用原语变量 `var(--color-*)` | 组件/feature/shell 的 CSS 必须使用 `--token-*`、`--text-*`、`--space-*`、`--radius-*`、`--control-*`、组件变量 | `design-system.css` 本身可引用原语 |
| 禁止硬编码十六进制颜色 | 必须走 token | 同上 |
| 禁止硬编码 px 字号 | 必须用 `var(--text-*)` | 同上 |
| 禁止硬编码 px 间距 | gap/padding/margin 等必须用 `var(--space-*)` | 同上 |
| 禁止硬编码 px 圆角 | 必须用 `var(--radius-*)` 或组件半径变量 | 同上 |
| 禁止 `!important` | 组件 CSS 中不允许 | `styles/global/base.css` 是唯一的例外（用于 reduced-motion） |
| 禁止 `backdrop-filter: blur` | 设计系统规定“克制 chrome 不使用毛玻璃”，统一用纯色表面 | 无豁免 |

此外，`design-system.css` 内注释明确要求：**组件 CSS 优先使用语义 token，不要使用十六进制字面量，组件 token 必须引用语义 token 而非原语**。这些约定由 lint 脚本强制执行，不是软建议。

## 5. 总结

RDC-Agent 的样式体系是一个**自研的 CSS 变量设计系统**：以 `design-system.css` 为单一事实源，通过 `shared/theme/compiler.ts` 在运行时将用户选择的 Appearance preset 编译为 CSS 变量注入 `:root`，再由组件 CSS 消费语义 token。所有视觉一致性由 `check-design-tokens.mjs` 这一质量门禁保障，确保组件层不泄露原语、不出现硬编码颜色/尺寸，从而实现主题可替换、视觉一致且可审计的桌面应用 UI。