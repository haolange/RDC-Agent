# Sessions

Project、Session、Run、Capture 元数据的领域入口。

每类文件由拥有它的 store 读写：`ProjectWorkspaceStore`（项目 registry 与选择）、`SessionRecordStore`（session 与 run 记录）、`ConversationHistoryStore`（对话历史、分支与附件）、`SessionContextStore`（usage、shell 状态与 context journal）。`sessionStores.ts` 是存储的组合根：创建共享的 `StorageIo` 与各 store，一次性接好它们之间的窄接口；调用方直接 import 拥有数据的那个 store，不经转发层。

跨层契约优先从 `src/shared/types/session.ts` 读取。
