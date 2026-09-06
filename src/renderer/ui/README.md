# UI

纯基础控件入口（原子与分子级组件）。

本目录用于沉淀无业务副作用、可复用的基础控件。视觉规范以 [`docs/ui/design-system.md`](../../../docs/ui/design-system.md) 为准：控件高度落在 `--control-height-sm/md/lg`，圆角用 `--radius-*`，间距用 `--space-*`，颜色用 `--token-*`。

边界（由 `pnpm run check:renderer-structure` 与 ESLint `no-restricted-imports` 强制）：

- 只能 import `lib` 与 `@shared`。
- 不得 import `features`、`patterns`、`stores`、`services`、`hooks`、`platform`、`app`、`shell`。
- 不得直接调用 `window.electronAPI` / `getElectronApi`。需要数据的复合组件属于 `patterns/`，不属于本目录。

每个组件必须覆盖 rest / hover / active / focus-visible / disabled 全部交互态，variant 通过 CSS 变量控制，不使用内联 `style`，单文件不超过 300 行。
