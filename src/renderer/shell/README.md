# Renderer Shell

布局与窗口 chrome：`AppShell`、`TitleBar`、`ResizeHandle`、`UserMenu`。实际工作台编排位于 `src/renderer/app/WorkbenchShell.tsx`。

`ResizeHandle` 是左右 docked 栏的唯一拖拽入口：CSS 共置并由组件导入，工作台壳不得再手写 `panel-resize-handle`。drawer / 自动收起时不挂载该组件。

应用编排与 bootstrap 在 `src/renderer/app/`；领域状态在 `src/renderer/stores/`；会话/时间线工具在 `src/renderer/services/`。终端抽屉在 `src/renderer/features/terminal/`。

`main.tsx` 直接挂载 `./app/App`，不再经过根目录 `App.tsx` re-export。
