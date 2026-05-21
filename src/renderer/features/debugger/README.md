# Debugger Feature

Debugger 业务 UI 入口。

当前主要 UI 仍位于 `App.tsx`、`pages/Debugger` 和 `components/*`。后续从 `App.tsx` 拆分时，优先把 Debugger 业务 glue 迁移到本目录，并保持 DOM、CSS class 和 E2E test id 兼容。
