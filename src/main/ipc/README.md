# IPC

IPC 是 renderer 与 main 的 API 边界。

- `handlers.ts` 保留总注册入口。
- `shellHandlers.ts` 承接 dialog、window、app shell 能力。
- 通道较多的域模块把 handler 按子域写成返回 `IpcChannelTable`（`invokeRegistry.ts`）的函数，`register*Handlers` 只做一次性接线并逐条 `ipcMain.handle` 注册；每个 handler 仍在入口经 `parseIpcArgs` 校验。`IpcChannelTable` 的键由通道表派生，表外的通道名编译失败。
- `src/shared/renderer-api/channels.ts` 是唯一通道表：每个 invoke channel 一行，同时声明名字与 Browser QA capability；event channel 是同文件的一份清单。preload 白名单、`assertRendererIpcParity` 与 Browser QA bridge 都从这张表取数。

新增 IPC 时先在通道表登记一行（名字 + capability），再同步 main handler、`src/shared/types/electron.ts` 与 `src/shared/renderer-api` 的工厂。
