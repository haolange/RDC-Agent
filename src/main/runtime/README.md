# Runtime

运行期状态入口，覆盖 Activity log、terminal、运行状态广播和应用级运行数据。

当前实现入口包括 `RuntimeLogService` 与 `TerminalSessionService`。新增运行期状态时，需要同步检查 IPC event、preload event channel 与 renderer 订阅。
