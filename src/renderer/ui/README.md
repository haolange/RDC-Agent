# UI

原子与分子级组件入口。视觉规范以 [`docs/ui/design-system.md`](../../../docs/ui/design-system.md) 为准。

## 组件

原子：`Button`、`IconButton`、`Icon`、`Switch`、`Checkbox`、`Kbd`、`Divider`、`Spinner`、`Toast`。

分子：`Pill`、`SectionHeader`、`Popover`、`Menu`、`Input`、`Textarea`、`SearchField`、`Select`、`ListRow`、`Panel`、`EmptyState`、`InlineError`、`Tabs`、`ColorField`。

`Select` 是 `DropdownSelect` 的稳定别名。`ResourceEmptyState` 是 `EmptyState` 的兼容别名，不再带插画。

控件高度落在 `--control-height-sm/md/lg`，圆角用 `--radius-*`，间距用 `--space-*`，颜色用 `--token-*`。动态定位走 `useDynStyle`。

## 边界

由 `pnpm run check:renderer-structure` 与 ESLint `no-restricted-imports` 强制：

- 只能 import `lib` 与 `@shared`。
- 不得 import `features`、`patterns`、`stores`、`services`、`hooks`、`platform`、`app`、`shell`。
- 不得直接调用 `window.electronAPI` / `getElectronApi`。

每个组件必须覆盖 rest / hover / active / focus-visible / disabled，variant 通过 CSS 变量控制，不使用内联 `style`，单文件不超过 300 行。
