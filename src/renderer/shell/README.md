# Renderer Shell

布局与窗口 chrome：`AppShell`、`TitleBar`、`PanelZone`、`ResizeHandle`、`UserMenu` 等。实际工作台编排位于 `src/renderer/app/WorkbenchShell.tsx`。

应用编排与 bootstrap 在 `src/renderer/app/`；领域状态在 `src/renderer/stores/`；会话/时间线工具在 `src/renderer/services/`。

`main.tsx` 直接挂载 `./app/App`，不再经过根目录 `App.tsx` re-export。
