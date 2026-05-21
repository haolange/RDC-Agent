# Preload API

本目录承接 `window.electronAPI` 的按域 builder。

约束：

- 公开 API 形状必须继续由 `src/shared/types/electron.ts` 约束。
- IPC channel 名保持兼容。
- 只在 preload 层使用 `ipcRenderer`，renderer 侧继续只调用 `window.electronAPI`。
