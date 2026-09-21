# UI

原子与分子级组件入口。视觉规范以 [`docs/ui/design-system.md`](../../../docs/ui/design-system.md) 为准。

## 组件

原子：`Button`、`IconButton`、`Icon`、`Switch`、`Checkbox`、`Kbd`、`Divider`、`Spinner`、`Toast`。

分子：`Pill`、`SectionHeader`、`Popover`、`Menu`、`Input`、`Textarea`、`SearchField`、`Select`、`ListRow`、`OverflowFade`、`Panel`、`EmptyState`、`InlineError`、`Tabs`、`ColorField`。

`Select` 是唯一单选下拉入口（`Select/index.tsx`），公开 `SelectProps` / `SelectOption`。

`Textarea` 转发原生 ref，`sizing="content"` 默认一至八行（`minRows` / `maxRows`），监听输入、值、字体、宽度与隐藏面板展开；`sizing="fill"` 由父级 flex/grid 分配空间。均禁止拖拽尺寸；动态测量通过 CSP 样式表，不写内联 style。`rows` 仅作为原生初始布局提示，内容模式以 `minRows` / `maxRows` 为准。

`SearchMultiSelect` 接收 `value` ID 数组、`options`、`onChange`、`unavailable` 原因映射及 loading/error/retry 状态；展示文案由调用方提供。组件不扫描资源、不调用 IPC、不静默删除失效引用；候选去重，新增选择保持原顺序。

`EmptyState` 提供 `layout="compact" | "fill"`，保留 visual 槽；填充模式由父容器传递剩余空间。

`OverflowFade` 保留完整单行 DOM 文本和 `title`，仅在实测溢出时添加线性渐隐；监听宽度、文本与字体加载变化，空字符串仍保留一行高度。`Tabs` 默认按内容宽度布局；仅在调用方明确传入 `fullWidth` 时占满容器并均分选项。

`ListRow` 继续统一 hover / focus / selected / disabled；领域组合可通过 `--ui-list-row-padding`、`--ui-list-row-gap` 与 `--ui-list-row-selected-border` 配置布局及选中边界，默认值保持自然单行列表表现，不受 CSS 加载顺序影响。Settings feature 的 `AgentListItem` 是其局部组合（两行单行文本、无底座小图标），不属于第二套公共列表体系；标题与描述、图标比例样式共置在该组件，不在共享 kit 留业务选择器。

`Button` 的 `loading` 会显示 Spinner，并设置 disabled / aria-busy。primary 默认中性实色底和 accent 描边/文字；领域控件可以通过 `--btn-primary-bg`、`--btn-primary-bg-hover`、`--btn-primary-text`、`--btn-primary-border` 显式覆盖。Composer Send 保留 agent-accent 实色底，文字使用 inverse、边框使用 agent accent；不依赖全局 primary 默认值。

控件高度落在 `--control-height-sm/md/lg`，圆角用 `--radius-*`，间距用 `--space-*`，颜色用 `--token-*`。动态定位走 `useDynStyle`。

## 边界

由 `pnpm run check:renderer-structure` 与 ESLint `no-restricted-imports` 强制：

- 只能 import `lib` 与 `@shared`。
- 不得 import `features`、`patterns`、`stores`、`services`、`hooks`、`platform`、`app`、`shell`。
- 不得直接调用 `window.electronAPI` / `getElectronApi`。

每个组件必须覆盖 rest / hover / active / focus-visible / disabled，variant 通过 CSS 变量控制，不使用内联 `style`，单文件不超过 300 行。
