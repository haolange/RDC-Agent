# Patterns

跨 feature 的复合展示模式入口。

本目录用于沉淀可复用的复合结构，例如空状态、状态条、用量指示器、命令面板、列表/分组模式。

边界（由 `pnpm run check:renderer-structure` 与 ESLint `no-restricted-imports` 强制）：

- 可以 import `ui`、`lib`、`hooks`、`services`、`stores`（**只读** store）。
- 不得 import `features`、`app`、`shell`、`platform`。
- 不得直接调用 `window.electronAPI` / `getElectronApi`，也不得写入业务 store。
