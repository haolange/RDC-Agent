---
kind: frontend_style
name: RDC-Agent 设计系统与主题体系（CSS 变量 + ThemeChromeCompiler）
category: frontend_style
scope:
    - '**'
source_files:
    - src/renderer/styles/design-system.css
    - src/renderer/styles/global.css
    - src/renderer/ui/kit.css
    - src/shared/theme/compiler.ts
    - src/shared/theme/presets.ts
    - src/shared/theme/composeAccent.ts
    - src/shared/theme/rdxThemeV1.ts
    - src/shared/theme/color.ts
    - src/shared/theme/uiPreferences.ts
    - docs/ui/design-system.md
    - designs/rdc-agent-design-system/readme.md
    - scripts/check-design-tokens.mjs
    - scripts/check-appearance.mjs
    - scripts/check-renderer-structure.mjs
---

## 1. 采用的系统与方法

RDC-Agent 的视觉风格基于 **CSS Custom Properties（CSS 变量）** 的设计令牌体系，配合运行时主题编译器 `ThemeChromeCompiler`，实现 Light/Dark 与多预设主题的动态切换。前端不依赖 Tailwind、Styled Components 等原子/样式-in-JS 方案，而是以一份权威 CSS 文件集中声明 primitive token，再通过语义层暴露给组件使用。

- 唯一全局入口：`src/renderer/main.tsx` → `styles/global.css` → `design-system.css`，再导入 `ui/kit.css`（聚合 Button、Input、Popover、Tabs、EmptyState 等分子组件样式）以及 `global/base.css`、`app-shell.css`、`responsive.css`、`pointer-cursors.css`。
- 主题编译：`src/shared/theme/compiler.ts` 的 `compileThemeChrome` 将用户配置的 `ThemeChromeConfig`（accent/surface/ink/fonts/contrast）转换为覆盖 `:root` 的 CSS 变量补丁；预设目录在 `presets.ts`，默认 RDC 主题，并内置 Absolutely、Ayu、Catppuccin、Dracula、Everforest、GitHub、Gruvbox、Linear 等。
- 双体系颜色：全局 Appearance chrome 驱动 Shell / Settings / Transcript / 全局 CTA；Composer 第二套由当前 agent `.agent.md` 的 `accent` 派生 `--composer-mode-accent` 与 `--composer-effort-*`，Light/Dark 仅调制亮度，不替换色相来源。
- CSP 约束：生产环境 `style-src 'self'` + `style-src-attr 'none'`，禁止 `<style>` 文本注入与 `element.style` 内联样式；动态样式必须通过 constructable stylesheet（`adoptedStyleSheets` / `useDynStyle` / `assignDynStyle`）注入。

## 2. 关键文件与包

| 路径 | 作用 |
|------|------|
| `src/renderer/styles/design-system.css` | Primitive token（颜色、字号、间距、圆角、阴影、z-index、动效）与 Semantic Token Layer 的唯一真值 |
| `src/renderer/styles/global.css` | 全局 CSS 入口，按顺序 import design-system、kit、base/app-shell/responsive/pointer-cursors |
| `src/renderer/ui/kit.css` | 分子组件样式聚合（Button、IconButton、Input、SearchField、Checkbox、Kbd、Divider、Pill、SectionHeader、Popover、Menu、ListRow、Panel、EmptyState、InlineError、Tabs、Toast、Spinner、Icon、Switch） |
| `src/shared/theme/compiler.ts` | `compileThemeChrome`：把配置编译为 `:root` CSS 变量补丁 |
| `src/shared/theme/presets.ts` | `THEME_PRESET_CATALOG` 预设清单与 `createDefaultChromeThemes` |
| `src/shared/theme/composeAccent.ts` | Composer 运行态 accent 派生逻辑 |
| `src/shared/theme/rdxThemeV1.ts` | 主题分享格式 `rdx-theme-v1:` 解析/序列化 |
| `src/shared/theme/color.ts` | RGB/HSL/hex 转换、对比度配对、调色板缩放 |
| `src/shared/theme/uiPreferences.ts` | UI 偏好（字体、字号等）持久化 |
| `docs/ui/design-system.md` | 设计系统规范文档，定义刻度、状态类、按钮规则、空态、模态尺寸、窄屏 Workbench、组件清单、门禁校验命令 |
| `scripts/check-design-tokens.mjs`、`scripts/check-appearance.mjs`、`scripts/check-renderer-structure.mjs` | 自动门禁脚本，强制 token 合规、Appearance 一致性、渲染层结构契约 |
| `designs/rdc-agent-design-system/Design System Preview.html` | 只读预览页，直接引用运行时 `design-system.css` 与 `ui/kit.css` |

## 3. 架构与约定

### 令牌分层
- **Primitive 层**：`design-system.css` 中 `:root` 下的 `--color-*`、`--space-*`、`--text-*`、`--radius-*`、`--duration-*`、`--z-*`、`--ease-*` 等原始变量。
- **Semantic 层**：同一文件中定义的 `--token-bg-app`、`--token-text-body`、`--token-border-focus`、`--transcript-card-radius` 等语义别名，供组件 CSS 引用。
- **运行时主题层**：`compileThemeChrome` 输出 `--color-accent-*`、`--color-bg-*`、`--color-text-*`、`--font-sans`、`--font-mono` 等覆盖变量，支持 Light/Dark 与自定义 preset。

### 刻度与排版
- 控件高度统一三档：`--control-height-sm/md/lg` = 28 / 32 / 36 px。
- 圆角四档：`--radius-sm/md/lg/xl/full` = 4 / 6 / 8 / 12 / 9999 px。
- 间距基线 4px，禁止奇数像素。
- 字号仅允许 `--text-xs/sm/base/lg/xl/...`，禁止 px 字面量。
- 行高两档：`--leading-tight/normal`。
- 动效时长三档：120 / 180 / 240ms，统一 `--ease-standard`。

### 组件与状态命名
- 交互状态类一律 `is-*`（如 `is-active`、`is-selected`、`is-running`、`is-disabled`、`is-error`），禁止裸 `.active` / `.current`。
- 任何 `:hover` 可交互选择器必须同时定义 `:focus-visible`；焦点环统一 `--token-border-focus`，禁止无替代的 `outline: none`。
- 按钮系统唯一：`.button` 基类 + `.button-primary/secondary/ghost/danger`，React 层通过 `<Button variant="..." size="...">` 消费。

### 双体系颜色策略
- 全局 Appearance chrome 控制 Shell / Settings / Transcript / 全局 CTA / focus ring。
- Composer 第二体系由 agent `.agent.md` 的 `accent` 派生 `--composer-mode-accent` 与 `--composer-effort-*`，用于边框、send 按钮、Effort/Max 滑条、Max 字色、2x/Fast pill 等。
- 状态色（success/warning/error/info）仅表达语义状态，不得挪作装饰。

### 响应式与布局
- 窄屏 Workbench：`<=720px` 时主内容轨道全宽，Composer Footer 始终单行、控件高 28px；Agent/Permission/Effort/Usage/Model 菜单锚定到 Composer 上方并完整位于 viewport 内。
- 模态尺寸：Settings/Knowledge 约 `min(92vw, 1920px) × min(90vh, 1240px)`，960px 堆叠，640px 全屏。

## 4. 约定与约束（含门禁）

| 约定 | 说明 | 执行方式 |
|------|------|----------|
| 组件 CSS 只能引用 `--token-*`，禁止直接使用 primitive `--color-bg-3`、`rgb(var(--color-accent-500))` 等 | 防止主题切换失效 | `check:design-tokens` 扫描 |
| 禁止 hex 字面量、px 字号/间距/圆角、`!important`、`backdrop-blur` | 保持令牌一致 | `check:design-tokens` 扫描 |
| 新增颜色必须先添加到 `--token-*` 或 chrome 编译层 | 避免游离色 | 文档约束 + 审查 |
| 所有新组件必须覆盖 rest/hover/active/focus/disabled，并通过 CSS 变量控制 variant | 保证交互一致性 | `src/renderer/ui` 已落地，B2 清零 |
| 禁止 feature 内再造第二套弹层/空态/输入 | 复用 `TaskDialog`、`EmptyState`、`Input` 等 | `check:renderer-structure` + 代码审查 |
| 动态样式必须走 constructable stylesheet（CSP 限制） | 生产安全 | 文档约束 + `useDynStyle` |
| 主题分享格式限定 `rdx-theme-v1:`，拒绝 `codex-theme-v1:` | 兼容现有设置迁移 | 代码约束 |
| 退役目录 `pages/`、`styles/base/`、`styles/tokens/*` 不得恢复 | 保持渲染层收敛 | `check:renderer-structure` 棘轮锁定 |
| 验收命令：`pnpm run check:design-tokens`、`check:appearance`、`check:renderer-structure`、`typecheck` | 提交前质量门禁 | CI/本地脚本 |

该体系的核心思想是：**单一真值源（`design-system.css`）+ 运行时主题编译（`ThemeChromeCompiler`）+ 自动化门禁（`check:*` 脚本）**，确保跨 Shell、Settings、Transcript、Composer、Right Rail 的视觉一致性。