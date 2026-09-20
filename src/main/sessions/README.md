# Sessions

Project、Session、Run、Capture 元数据的领域入口。

当前实现仍集中在 `RdcSessionService`、`StorageAdapter`、`RunScopedStore` 和相关 IPC handlers。本目录用于承接后续按 project/session/run/capture 持久化边界拆分的代码。

跨层契约优先从 `src/shared/types/session.ts` 读取。
