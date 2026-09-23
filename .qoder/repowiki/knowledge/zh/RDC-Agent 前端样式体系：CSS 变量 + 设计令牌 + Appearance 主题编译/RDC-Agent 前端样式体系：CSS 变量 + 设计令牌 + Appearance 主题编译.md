---
kind: frontend_style
name: RDC-Agent 前端样式体系：CSS 变量 + 设计令牌 + Appearance 主题编译
category: frontend_style
scope:
    - '**'
source_files:
    - src/renderer/styles/design-system.css
    - src/renderer/styles/global.css
    - src/renderer/styles/global/base.css
    - src/renderer/styles/global/app-shell.css
    - src/shared/theme/index.ts
    - src/shared/theme/presets.ts
    - src/shared/theme/compiler.ts
    - scripts/check-design-tokens.mjs
    - scripts/check-appearance.mjs
    - src/renderer/ui/kit.css
    - patches/style-mod@4.1.3.patch
---

## 1. 系统/方法概述

RDC-Agent 的渲染层（Electron renderer）采用 **纯 CSS 自定义属性（CSS Custom Properties）+ 三层设计令牌（Design Tokens）+ 运行时 Appearance 主题编译器** 的前端风格体系，不依赖 Tailwind、Styled Components 等原子化或 CSS-in-JS 框架。构建工具链使用 Vite + electron-vite，样式通过 `src/renderer/styles/global.css` 统一导入，最终由 `shared/theme/compiler.ts` 在运行时将用户选择的 Appearance preset（如 rdc、dracula、github 等）编译为覆盖 `:root` 的 CSS 变量注入。

## 2. 关键文件与包

- **设计令牌定义**：`src/renderer/styles/design-system.css` —— 集中声明 primitive tokens（`--color-primary-*`、`--color-bg-*`、`--space-*`、`--radius-*`、`--text-*`、`--font-*`、`--shadow-*`、`--z-*`、`--control-*`）、semantic tokens（`--token-*`）以及组件级 token（`--btn-*`、`--input-*`、`--card-*`、`--modal-*`、`--badge-*`），并内置暗色/亮色两套默认值。
- **全局入口**：`src/renderer/styles/global.css` —— 仅做 `@import` 编排，引入 design-system、ui kit、base/app-shell/responsive/pointer-cursors。
- **应用壳样式**：`src/renderer/styles/global/base.css`、`app-shell.css` —— 定义 `html`、`body`、`.app-container`、三栏布局 `.app-body`、标题栏、侧边栏、主内容区、右侧面板等全局结构。
- **Appearance 主题系统**：`src/shared/theme/presets.ts`（预置目录 `THEME_PRESET_CATALOG`）、`compiler.ts`（`compileThemeChrome` 将 accent/surface/ink/contrast/fonts 编译成 `--color-accent-*`、`--color-bg-*`、`--color-text-*`、`--font-sans`、`--font-mono` 等变量）、`index.ts` 统一导出。
- **质量门禁脚本**：`scripts/check-design-tokens.mjs`（强制禁止硬编码 hex、px 间距/字号、primitive color var、`!important`、非 `var(--modal-backdrop-filter)` 的 backdrop-filter，并以 `scripts/fidelity/design-tokens-baseline.json` 做债务基线锁定）、`scripts/check-appearance.mjs`（校验 preset 清单、默认主题、颜色选择器、Select/Popover 行为、CSP 兼容的 constructable stylesheet 注入方式等）。
- **UI 组件库**：`src/renderer/ui/` 下的 Button、Checkbox、Switch、Input、Select、Popover、Panel、Dialog、ColorField、ColorPickerSurface 等，每个组件以 `.tsx` + `.css` 配对组织，并通过 `src/renderer/ui/kit.css` 聚合。
- **第三方补丁**：`patches/style-mod@4.1.3.patch` —— 对 style-mod 样式注入逻辑打补丁以适配运行环境。

## 3. 架构与约定

### 三层令牌架构
`design-system.css` 中明确注释了三层结构：**Primitive → Semantic (`--token-*`) → Component (`--btn-*`/`--input-*`/`--card-*`)**。规则要求：组件 CSS 优先引用 semantic token，不得直接使用 primitive `--color-*`；component token 必须引用 semantic token，而非 primitive。

### 主题切换机制
- 预设主题定义在 `presets.ts` 的 `THEME_PRESET_CATALOG`，包含 rdc、absolutely、ayu、catppuccin、dracula、everforest、github、gruvbox、linear 等。
- 运行时通过 `compileThemeChrome(chrome, variant)` 生成一组 CSS 变量键值对，再以 constructable stylesheet（`adoptedStyleSheets` + `replaceSync`）注入到 `:root`，覆盖 primitive 色彩与字体。
- 亮/暗模式通过 `data-resolved-theme='light'` 选择器覆盖 `design-system.css` 中的默认暗色值；`base.css` 同时切换 `color-scheme`。
- 字体缩放通过 `data-font-scale='small'|'large'` 覆盖 `--text-*` 字号。

### 布局与响应式
- 应用主体采用固定三栏 grid：`left-sidebar | left-handle | main | right-handle | right-panel`，宽度由 CSS 变量 `--left-sidebar-width`、`--right-panel-width`、`--left-resize-handle-width`、`--right-resize-handle-width` 控制。
- 响应式通过 `@container` 和 `@media (max-width: 640px)` 调整 modal inset、context breakdown 列数等。

### 视觉规范
- 阴影采用 macOS 风格双层 soft elevation（ambient + key light），并通过 `--highlight-edge` 实现玻璃感顶部高光。
- 控件尺寸统一走 `--control-height-sm/md/lg` 与 `--control-radius`。
- 滚动条、选中态、focus ring 全部基于 token 定制。

## 4. 约定与约束（含强制规则）

以下规则由 `check-design-tokens.mjs`、`check-appearance.mjs` 及代码注释显式声明并通过 CI 门禁执行：

1. **禁止硬编码颜色**：除 `design-system.css`（令牌定义层）外，所有 renderer CSS 不得使用 `#[0-9a-fA-F]{3,8}` 十六进制字面量，必须引用 `--token-*`。
2. **禁止直接引用 primitive color var**：feature/ui/patterns/shell 的 CSS 不得使用 `var(--color-*)`，须通过语义化的 `--token-*` 访问。
3. **间距/字号/圆角必须用 token**：禁止 `font-size: Xpx`、`padding/margin/gap: Xpx`、`border-radius: Xpx`，应使用 `--text-*`、`--space-*`、`--radius-*` 或组件 radius var。
4. **禁用 `!important`**：组件 CSS 中不允许出现 `!important`。
5. **backdrop-filter 限制**：仅允许 `backdrop-filter: var(--modal-backdrop-filter)`，其他 blur 必须留在 token 定义层。
6. **Appearance 注入方式**：必须使用 constructable stylesheet（`adoptedStyleSheets` + `replaceSync`），禁止创建 `<style>` 文本节点或使用 inline style 设置 `colorScheme`，以兼容 CSP `style-src`。
7. **Preset 清单锁定**：`THEME_PRESET_CATALOG` 必须严格匹配 `['rdc','absolutely','ayu','catppuccin','dracula','everforest','github','gruvbox','linear']`，新增主题需同步更新。
8. **Checkbox 视觉契约**：checkbox 保持 outline + ink 勾选，不得使用 `--token-accent-primary` 作为 checked 背景；CheckPill 必须复用 checkbox token。
9. **Select/Popover 表面**：下拉菜单必须使用实心 shell 表面（`--token-bg-shell`），不得使用 backdrop blur。
10. **颜色选择器可访问性**：ColorPickerSurface 的平面与色相轨道必须暴露 `role="slider"` 与键盘可达事件。
11. **令牌债务基线**：`check-design-tokens` 的输出与 `scripts/fidelity/design-tokens-baseline.json` 绑定，债务只能减少，减少时必须同 PR 更新基线。
12. **文档契约**：`AGENTS.md`、`DESIGN.md`、`docs/ui/design-system.md`、`docs/ui/workbench-and-transcript.md` 必须包含 Appearance / chromeThemes / rdc-theme-v1 / CSP style-src 相关说明，否则门禁失败。

这些规则共同保证了 RDC-Agent 渲染层的视觉一致性、可主题化能力与长期可维护性。