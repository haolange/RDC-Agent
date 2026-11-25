# IPC

IPC 是 renderer 与 main 的 API 边界。

- `handlers.ts` 保留总注册入口。
- `shellHandlers.ts` 承接 dialog、window、app shell 能力。
- 通道较多的域模块把 handler 按子域写成返回 `IpcChannelTable`（`invokeRegistry.ts`）的函数，`register*Handlers` 只做一次性接线并逐条 `ipcMain.handle` 注册；每个 handler 仍在入口经 `parseIpcArgs` 校验。
- `channels.ts` 记录 handler/event channel 所属域，作为 preload、shared type、renderer fallback 的对照清单。

新增 IPC 时先登记域，再同步 `src/preload`、`src/shared/types/electron.ts` 和浏览器 fallback。
