# IPC 通信机制

<cite>
**本文引用的文件**
- [src/main/ipc/handlers.ts](file://src/main/ipc/handlers.ts)
- [src/main/ipc/workbenchHandlers.ts](file://src/main/ipc/workbenchHandlers.ts)
- [src/main/ipc/invokeRegistry.ts](file://src/main/ipc/invokeRegistry.ts)
- [src/preload/index.ts](file://src/preload/index.ts)
- [src/preload/rendererTransport.ts](file://src/preload/rendererTransport.ts)
- [src/shared/renderer-api/channels.ts](file://src/shared/renderer-api/channels.ts)
- [src/shared/renderer-api/createRendererApi.ts](file://src/shared/renderer-api/createRendererApi.ts)
- [src/shared/renderer-api/transport.ts](file://src/shared/renderer-api/transport.ts)
- [src/main/ipc/conversationHandlers.ts](file://src/main/ipc/conversationHandlers.ts)
- [src/main/ipc/workflowHandlers.ts](file://src/main/ipc/workflowHandlers.ts)
- [src/renderer/app/bootstrap/useIpcEventBridge.ts](file://src/renderer/app/bootstrap/useIpcEventBridge.ts)
- [src/renderer/app/bootstrap/conversationSubscriptions.ts](file://src/renderer/app/bootstrap/conversationSubscriptions.ts)
- [src/renderer/app/bootstrap/sessionSubscriptions.ts](file://src/renderer/app/bootstrap/sessionSubscriptions.ts)
- [src/renderer/app/bootstrap/shellSubscriptions.ts](file://src/renderer/app/bootstrap/shellSubscriptions.ts)
- [src/renderer/app/bootstrap/captureSubscriptions.ts](file://src/renderer/app/bootstrap/captureSubscriptions.ts)
- [src/renderer/app/bootstrap/conversationEventBatcher.ts](file://src/renderer/app/bootstrap/conversationEventBatcher.ts)
- [src/main/conversation/DelegationTraceStore.ts](file://src/main/conversation/DelegationTraceStore.ts)
- [src/shared/types/delegationTrace.ts](file://src/shared/types/delegationTrace.ts)
- [src/renderer/features/transcript/useDelegationTrace.ts](file://src/renderer/features/transcript/useDelegationTrace.ts)
</cite>

## 更新摘要
**所做更改**
- 更新了前端事件处理架构，从单一 useIpcEventBridge 重构为模块化订阅系统
- 新增专用订阅模块：conversationSubscriptions、sessionSubscriptions、shellSubscriptions、captureSubscriptions
- 增强了事件批处理和性能优化机制
- 改进了错误处理和资源管理
- 提升了可测试性和维护性
- **新增** 委托追踪API支持：conversation.getDelegationTrace 和 conversation.getDelegationReceipt 方法，扩展了Electron API表面以支持委托追踪数据的获取

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本文件系统性解析 RDC-Agent 的 IPC 通信机制，覆盖主进程与渲染器之间的消息路由、类型安全、错误处理、处理器注册与管理、调用注册表（invokeRegistry）的动态加载与生命周期管理。文档提供从前端请求到后端处理的完整链路图，并给出性能优化与调试技巧，帮助读者快速理解与扩展该 IPC 体系。

**更新** 本次更新重点反映了 IPC 事件处理系统的重大架构重构，将原来的单一 useIpcEventBridge（350+行）拆分为多个专用订阅模块，显著提高了代码的可测试性和维护性。同时新增了委托追踪相关的API方法，扩展了Electron API表面以支持委托追踪数据的获取。

## 项目结构
IPC 相关代码主要分布在以下位置：
- 共享层：定义渲染器可使用的通道常量、传输接口与 API 构造器
- Preload 层：将 Electron ipcRenderer 封装为安全的 RendererApiTransport，并通过 contextBridge 暴露给渲染器
- 主进程：集中注册各业务域 IPC 处理器，维护全局上下文与广播能力，并提供 invoke 注册表以支持动态调用
- **新增** 前端事件处理：按业务领域拆分的专用订阅模块，提供细粒度的事件处理能力

```mermaid
graph TB
subgraph "渲染器"
R_API["createRendererApi<br/>构建类型化 API"]
R_EVT["事件订阅 on/off"]
R_BOOTSTRAP["useIpcEventBridge<br/>协调各订阅模块"]
end
subgraph "Preload"
P_TRANSPORT["createIpcRendererTransport<br/>封装 ipcRenderer"]
P_BRIDGE["contextBridge.exposeInMainWorld('electronAPI')"]
end
subgraph "主进程"
W_HANDLERS["workbenchHandlers<br/>注册各域处理器"]
INV_REG["invokeRegistry<br/>拦截 ipcMain.handle + 注册表"]
CHANS["channels.ts<br/>通道常量与类型"]
DELEG_STORE["DelegationTraceStore<br/>委托追踪存储"]
end
subgraph "前端订阅模块"
CONV_SUB["conversationSubscriptions<br/>对话事件处理"]
SESS_SUB["sessionSubscriptions<br/>会话状态管理"]
SHELL_SUB["shellSubscriptions<br/>Shell命令处理"]
CAPT_SUB["captureSubscriptions<br/>捕获设备管理"]
end
R_API --> P_TRANSPORT
P_BRIDGE --> R_API
P_TRANSPORT --> |ipcRenderer.invoke/on| W_HANDLERS
W_HANDLERS --> INV_REG
W_HANDLERS --> CHANS
W_HANDLERS --> DELEG_STORE
R_BOOTSTRAP --> CONV_SUB
R_BOOTSTRAP --> SESS_SUB
R_BOOTSTRAP --> SHELL_SUB
R_BOOTSTRAP --> CAPT_SUB
```

**图表来源**
- [src/shared/renderer-api/createRendererApi.ts:33-76](file://src/shared/renderer-api/createRendererApi.ts#L33-L76)
- [src/preload/rendererTransport.ts:9-44](file://src/preload/rendererTransport.ts#L9-L44)
- [src/preload/index.ts:8-15](file://src/preload/index.ts#L8-L15)
- [src/main/ipc/workbenchHandlers.ts:259-281](file://src/main/ipc/workbenchHandlers.ts#L259-L281)
- [src/main/ipc/invokeRegistry.ts:9-21](file://src/main/ipc/invokeRegistry.ts#L9-L21)
- [src/shared/renderer-api/channels.ts:1-244](file://src/shared/renderer-api/channels.ts#L1-L244)
- [src/renderer/app/bootstrap/useIpcEventBridge.ts:44-123](file://src/renderer/app/bootstrap/useIpcEventBridge.ts#L44-L123)

**章节来源**
- [src/main/ipc/handlers.ts:1-7](file://src/main/ipc/handlers.ts#L1-L7)
- [src/main/ipc/workbenchHandlers.ts:52-77](file://src/main/ipc/workbenchHandlers.ts#L52-L77)
- [src/main/ipc/invokeRegistry.ts:1-51](file://src/main/ipc/invokeRegistry.ts#L1-L51)
- [src/preload/index.ts:1-26](file://src/preload/index.ts#L1-L26)
- [src/preload/rendererTransport.ts:1-45](file://src/preload/rendererTransport.ts#L1-L45)
- [src/shared/renderer-api/channels.ts:1-244](file://src/shared/renderer-api/channels.ts#L1-L244)
- [src/shared/renderer-api/createRendererApi.ts:1-77](file://src/shared/renderer-api/createRendererApi.ts#L1-L77)
- [src/shared/renderer-api/transport.ts:1-12](file://src/shared/renderer-api/transport.ts#L1-L12)

## 核心组件
- 通道契约与类型安全
  - channels.ts 集中声明所有渲染器可调用的 invoke 通道和事件通道，并提供类型守卫函数，确保前后端通道一致且强类型。
- Preload 传输层
  - rendererTransport.ts 将 ipcRenderer 包装为 RendererApiTransport，统一 invoke 与 subscribe 语义，并在内部维护监听器映射，避免重复绑定与内存泄漏。
- 渲染器 API 构造
  - createRendererApi.ts 基于 transport 生成类型化的 electronAPI，按领域划分方法（如 conversation、workflow、settings 等），并对事件订阅进行白名单校验。
- 主进程处理器注册中心
  - workbenchHandlers.ts 负责初始化 IPC 状态、安装 invoke 注册表、桥接系统主题变化、以及按域批量注册 IPC 处理器，并在启动末尾执行"渲染器-主进程通道一致性断言"。
- 调用注册表（invokeRegistry）
  - invokeRegistry.ts 通过拦截 ipcMain.handle 收集所有已注册的 channel，提供运行时查询、断言与统一调用入口，保障"渲染器声明的通道在主进程均有实现"。
- **新增** 前端事件订阅模块
  - 按业务领域拆分的专用订阅模块，每个模块负责特定领域的事件处理，提高代码内聚性和可测试性。
- **新增** 委托追踪存储
  - DelegationTraceStore 提供委托执行的追踪数据持久化和读取功能，支持分页查询和收据文件管理。

**章节来源**
- [src/shared/renderer-api/channels.ts:1-244](file://src/shared/renderer-api/channels.ts#L1-L244)
- [src/preload/rendererTransport.ts:9-44](file://src/preload/rendererTransport.ts#L9-L44)
- [src/shared/renderer-api/createRendererApi.ts:33-76](file://src/shared/renderer-api/createRendererApi.ts#L33-L76)
- [src/main/ipc/workbenchHandlers.ts:259-281](file://src/main/ipc/workbenchHandlers.ts#L259-L281)
- [src/main/ipc/invokeRegistry.ts:9-51](file://src/main/ipc/invokeRegistry.ts#L9-L51)
- [src/renderer/app/bootstrap/conversationSubscriptions.ts:1-140](file://src/renderer/app/bootstrap/conversationSubscriptions.ts#L1-L140)
- [src/renderer/app/bootstrap/sessionSubscriptions.ts:1-167](file://src/renderer/app/bootstrap/sessionSubscriptions.ts#L1-L167)
- [src/renderer/app/bootstrap/shellSubscriptions.ts:1-48](file://src/renderer/app/bootstrap/shellSubscriptions.ts#L1-L48)
- [src/renderer/app/bootstrap/captureSubscriptions.ts:1-62](file://src/renderer/app/bootstrap/captureSubscriptions.ts#L1-L62)
- [src/main/conversation/DelegationTraceStore.ts:1-218](file://src/main/conversation/DelegationTraceStore.ts#L1-L218)

## 架构总览
下图展示从渲染器发起调用到主进程处理器执行的完整链路，包括参数校验、业务处理、结果返回与事件广播。

```mermaid
sequenceDiagram
participant R as "渲染器"
participant P as "Preload Transport"
participant M as "主进程 workbenchHandlers"
participant H as "具体处理器(如 conversationHandlers)"
participant S as "服务层(会话/工作流/存储等)"
R->>P : electronAPI.conversation.sendMessage(...)
P->>M : ipcRenderer.invoke("conversation : sendMessage")
M->>H : 路由至对应 handler
H->>H : parseIpcArgs(参数校验/大小限制)
H->>S : 执行业务逻辑
S-->>H : 返回结果或抛出异常
H-->>M : 标准化响应/错误
M-->>P : Promise 结果
P-->>R : 返回值或错误
Note over M,P : 必要时通过 broadcastToRenderer 推送事件
```

**图表来源**
- [src/preload/rendererTransport.ts:29-32](file://src/preload/rendererTransport.ts#L29-L32)
- [src/main/ipc/conversationHandlers.ts:43-78](file://src/main/ipc/conversationHandlers.ts#L43-L78)
- [src/main/ipc/workbenchHandlers.ts:79-87](file://src/main/ipc/workbenchHandlers.ts#L79-L87)

## 详细组件分析

### 处理器注册与管理（handlers.ts 与 workbenchHandlers.ts）
- handlers.ts 作为导出门面，仅转发 initializeIpcState、registerIPCHandlers、setMainWindow、stopAllActiveRuns 等关键入口，便于外部模块按需引入。
- workbenchHandlers.ts 是 IPC 组合根：
  - 初始化 IPC 状态：恢复当前 session/project/run，恢复中断运行，检测可恢复会话。
  - 安装 invoke 注册表：在首次注册时拦截 ipcMain.handle，建立本地 Map 记录所有已注册通道。
  - 按域批量注册处理器：conversation、workflow、project、session、device、shell、web、toolEvidence、trace、rdxRuntime 等。
  - 启动后断言：assertRendererIpcParity 检查渲染器声明的所有通道是否都在主进程有实现，缺失则抛错。
  - 主题桥接：监听 nativeTheme 更新并向渲染器广播 app:themeChanged。
  - 工具执行追踪：订阅 rdxCliInvokerService 的执行完成事件，写入日志与证据，并广播 tool:executionComplete。

```mermaid
flowchart TD
Start(["应用启动"]) --> InitState["initializeIpcState()<br/>恢复会话/项目/运行状态"]
InitState --> InstallReg["installIpcInvokeRegistry()<br/>拦截 ipcMain.handle"]
InstallReg --> RegisterDomains["按域注册处理器<br/>conversation/workflow/..."]
RegisterDomains --> ParityCheck["assertRendererIpcParity()<br/>通道一致性断言"]
ParityCheck --> ThemeBridge["nativeTheme.on('updated')<br/>广播 app:themeChanged"]
ThemeBridge --> Ready(["就绪"])
```

**图表来源**
- [src/main/ipc/workbenchHandlers.ts:52-77](file://src/main/ipc/workbenchHandlers.ts#L52-L77)
- [src/main/ipc/workbenchHandlers.ts:259-281](file://src/main/ipc/workbenchHandlers.ts#L259-L281)
- [src/main/ipc/invokeRegistry.ts:9-21](file://src/main/ipc/invokeRegistry.ts#L9-L21)

**章节来源**
- [src/main/ipc/handlers.ts:1-7](file://src/main/ipc/handlers.ts#L1-L7)
- [src/main/ipc/workbenchHandlers.ts:52-77](file://src/main/ipc/workbenchHandlers.ts#L52-L77)
- [src/main/ipc/workbenchHandlers.ts:259-281](file://src/main/ipc/workbenchHandlers.ts#L259-L281)

### 调用注册表（invokeRegistry）
- 动态加载：installIpcInvokeRegistry 在首次调用时替换 ipcMain.handle，使每次注册都同时写入本地 Map，形成"调用注册表"。
- 运行时查询：hasRegisteredIpcChannel 判断某通道是否已注册；invokeRegisteredIpcChannel 通过 Map 查找并调用处理器，自动构造 IpcMainInvokeEvent 的 sender。
- 生命周期与一致性：assertRendererIpcParity 在启动阶段对比 RENDERER_INVOKE_CHANNELS 与已注册通道集合，缺失即抛错，保证前后端契约一致。

```mermaid
classDiagram
class InvokeRegistry {
+installIpcInvokeRegistry() void
+invokeRegisteredIpcChannel(channel, args) Promise~unknown~
+hasRegisteredIpcChannel(channel) boolean
+assertRendererIpcParity() void
}
class ElectronIpcMain {
+handle(channel, listener) void
}
InvokeRegistry --> ElectronIpcMain : "拦截并增强 handle"
```

**图表来源**
- [src/main/ipc/invokeRegistry.ts:9-51](file://src/main/ipc/invokeRegistry.ts#L9-L51)

**章节来源**
- [src/main/ipc/invokeRegistry.ts:1-51](file://src/main/ipc/invokeRegistry.ts#L1-L51)

### 类型安全与参数校验
- 通道类型安全：channels.ts 使用 const 对象枚举所有通道，并通过类型推导生成 RendererInvokeChannel/RendererEventChannel，配合 isRendererInvokeChannel/isRendererEventChannel 做运行时白名单校验。
- 参数校验：各处理器统一使用 parseIpcArgs 对入参进行结构化校验，支持最大字节限制、字段补齐（padTo）等策略，失败时立即拒绝，避免进入业务层。
- 错误归一化：处理器捕获异常并转换为标准响应格式（如包含 success/error 字段），便于渲染器统一处理。

```mermaid
flowchart TD
A["收到原始参数 rawArgs"] --> B["parseIpcArgs(Schema, rawArgs, options)"]
B --> C{"校验通过?"}
C -- 否 --> E["返回标准化错误响应"]
C -- 是 --> D["调用业务服务"]
D --> F{"业务成功?"}
F -- 否 --> E
F -- 是 --> G["返回标准化成功响应"]
```

**图表来源**
- [src/main/ipc/conversationHandlers.ts:43-78](file://src/main/ipc/conversationHandlers.ts#L43-L78)
- [src/main/ipc/workflowHandlers.ts:21-33](file://src/main/ipc/workflowHandlers.ts#L21-L33)

**章节来源**
- [src/shared/renderer-api/channels.ts:220-244](file://src/shared/renderer-api/channels.ts#L220-244)
- [src/main/ipc/conversationHandlers.ts:43-78](file://src/main/ipc/conversationHandlers.ts#L43-L78)
- [src/main/ipc/workflowHandlers.ts:21-33](file://src/main/ipc/workflowHandlers.ts#L21-L33)

### 事件广播与双向通信
- 事件通道：channels.ts 定义渲染器可订阅的事件通道（如 workflow:runStatusChanged、tool:executionComplete、app:themeChanged）。
- 广播机制：workbenchHandlers.ts 提供 broadcastToRenderer，通过 rendererEventHub 与 BrowserWindow.webContents.send 向所有窗口广播事件。
- 典型场景：工具执行完成、运行状态变更、主题切换等，均通过事件通道通知渲染器刷新 UI。

```mermaid
sequenceDiagram
participant Svc as "服务/子系统"
participant WB as "workbenchHandlers"
participant Win as "BrowserWindow"
participant R as "渲染器"
Svc-->>WB : 触发事件(如 tool : executionComplete)
WB->>Win : webContents.send(channel, payload)
Win-->>R : 事件到达
R->>R : events.on(channel, callback)
```

**图表来源**
- [src/main/ipc/workbenchHandlers.ts:79-87](file://src/main/ipc/workbenchHandlers.ts#L79-L87)
- [src/main/ipc/workbenchHandlers.ts:190-237](file://src/main/ipc/workbenchHandlers.ts#L190-L237)
- [src/shared/renderer-api/channels.ts:178-218](file://src/shared/renderer-api/channels.ts#L178-L218)

**章节来源**
- [src/main/ipc/workbenchHandlers.ts:79-87](file://src/main/ipc/workbenchHandlers.ts#L79-L87)
- [src/main/ipc/workbenchHandlers.ts:190-237](file://src/main/ipc/workbenchHandlers.ts#L190-L237)
- [src/shared/renderer-api/channels.ts:178-218](file://src/shared/renderer-api/channels.ts#L178-L218)

### 前端事件处理架构重构

**更新** 前端事件处理系统经历了重大架构重构，从单一的 useIpcEventBridge（350+行）拆分为多个专用订阅模块，显著提高了代码的可测试性和维护性。

#### 模块化订阅架构
新的架构将事件处理逻辑按业务领域拆分为独立的订阅模块：

- **conversationSubscriptions.ts**：处理对话相关的实时事件，包括消息流、工具执行完成、代理事件等
- **sessionSubscriptions.ts**：管理会话状态变化，包括运行状态、使用情况、证据事件等
- **shellSubscriptions.ts**：处理 Shell 命令和系统级事件，如主题切换、窗口状态变化等
- **captureSubscriptions.ts**：管理捕获设备和上下文快照，处理设备状态变化和捕获状态更新

```mermaid
flowchart TD
useIpcEventBridge["useIpcEventBridge<br/>协调器"] --> convSub["conversationSubscriptions<br/>对话事件"]
useIpcEventBridge --> sessSub["sessionSubscriptions<br/>会话状态"]
useIpcEventBridge --> shellSub["shellSubscriptions<br/>Shell命令"]
useIpcEventBridge --> captSub["captureSubscriptions<br/>捕获设备"]
convSub --> convBatcher["conversationEventBatcher<br/>事件批处理"]
sessSub --> sessProjection["会话投影"]
shellSub --> systemEvents["系统事件"]
captSub --> deviceState["设备状态"]
```

**图表来源**
- [src/renderer/app/bootstrap/useIpcEventBridge.ts:44-123](file://src/renderer/app/bootstrap/useIpcEventBridge.ts#L44-L123)
- [src/renderer/app/bootstrap/conversationSubscriptions.ts:1-140](file://src/renderer/app/bootstrap/conversationSubscriptions.ts#L1-L140)
- [src/renderer/app/bootstrap/sessionSubscriptions.ts:1-167](file://src/renderer/app/bootstrap/sessionSubscriptions.ts#L1-L167)
- [src/renderer/app/bootstrap/shellSubscriptions.ts:1-48](file://src/renderer/app/bootstrap/shellSubscriptions.ts#L1-L48)
- [src/renderer/app/bootstrap/captureSubscriptions.ts:1-62](file://src/renderer/app/bootstrap/captureSubscriptions.ts#L1-L62)

#### 事件批处理优化
conversationEventBatcher 提供了高性能的事件批处理机制：

- 合并高频 message_patched 事件到单个动画帧
- 终端事件（message_completed/message_errored）立即刷新
- 防止内存泄漏，提供 dispose 方法清理资源

```mermaid
sequenceDiagram
participant FE as "前端"
participant Batch as "Event Batcher"
participant Store as "Store"
FE->>Batch : message_patched (多次)
Batch->>Batch : 合并到pending队列
Batch->>Batch : requestAnimationFrame
Batch->>Store : 批量应用更新
Store-->>Batch : 完成
Batch->>Batch : 清理pending队列
```

**图表来源**
- [src/renderer/app/bootstrap/conversationEventBatcher.ts:14-77](file://src/renderer/app/bootstrap/conversationEventBatcher.ts#L14-L77)

**章节来源**
- [src/renderer/app/bootstrap/useIpcEventBridge.ts:44-123](file://src/renderer/app/bootstrap/useIpcEventBridge.ts#L44-L123)
- [src/renderer/app/bootstrap/conversationSubscriptions.ts:1-140](file://src/renderer/app/bootstrap/conversationSubscriptions.ts#L1-L140)
- [src/renderer/app/bootstrap/sessionSubscriptions.ts:1-167](file://src/renderer/app/bootstrap/sessionSubscriptions.ts#L1-L167)
- [src/renderer/app/bootstrap/shellSubscriptions.ts:1-48](file://src/renderer/app/bootstrap/shellSubscriptions.ts#L1-L48)
- [src/renderer/app/bootstrap/captureSubscriptions.ts:1-62](file://src/renderer/app/bootstrap/captureSubscriptions.ts#L1-L62)
- [src/renderer/app/bootstrap/conversationEventBatcher.ts:1-77](file://src/renderer/app/bootstrap/conversationEventBatcher.ts#L1-L77)

### 委托追踪API支持

**新增** 系统新增了委托追踪相关的API方法，扩展了Electron API表面以支持委托追踪数据的获取。

#### 委托追踪API设计
新增了两个核心API方法：

- **conversation.getDelegationTrace**：获取委托执行的追踪步骤，支持分页查询
- **conversation.getDelegationReceipt**：获取委托执行的详细收据信息，支持大文本的分页读取

```mermaid
sequenceDiagram
participant FE as "前端"
participant API as "Renderer API"
participant MH as "main : conversationHandlers"
participant DTS as "DelegationTraceStore"
FE->>API : getDelegationTrace({sessionId, parentToolCallId, cursor, pageSize})
API->>MH : ipcRenderer.invoke("conversation : getDelegationTrace", request)
MH->>MH : parseIpcArgs(参数校验)
MH->>MH : 验证sessionId权限
MH->>DTS : read(sessionId, parentToolCallId, cursor, pageSize)
DTS-->>MH : DelegationTracePage
MH-->>API : 返回追踪数据
API-->>FE : 分页的委托执行步骤
```

**图表来源**
- [src/main/ipc/conversationHandlers.ts:122-130](file://src/main/ipc/conversationHandlers.ts#L122-L130)
- [src/main/conversation/DelegationTraceStore.ts:193-204](file://src/main/conversation/DelegationTraceStore.ts#L193-L204)

#### 委托追踪数据存储
DelegationTraceStore 实现了完整的委托追踪数据持久化机制：

- **文件存储**：使用JSONL格式存储追踪条目，支持增量追加
- **缓存机制**：维护解析后的追踪数据缓存，避免重复IO操作
- **收据管理**：将大型收据内容存储为独立文件，支持分页读取
- **权限控制**：严格的sessionId验证，确保数据安全

```mermaid
flowchart TD
Start(["委托开始"]) --> WriteStart["写入start条目"]
WriteStart --> TrackEvents["跟踪Agent事件"]
TrackEvents --> ToolStarted{"tool.started?"}
ToolStarted -- 是 --> WriteStep["写入step条目"]
ToolStarted -- 否 --> CheckFinish{"tool.completed/denied?"}
CheckFinish -- 是 --> WritePatch["写入patch条目"]
CheckFinish -- 否 --> CheckAssistant{"assistant.completed?"}
CheckAssistant -- 是 --> WriteMessage["写入message step"]
CheckAssistant -- 否 --> CheckDiagnostic{"diagnostic?"}
CheckDiagnostic -- 是 --> WriteDiag["写入diagnostic step"]
CheckDiagnostic -- 否 --> TrackEvents
WritePatch --> CheckLarge{"收据过大?"}
CheckLarge -- 是 --> SaveFile["保存收据文件"]
CheckLarge -- 否 --> InlineReceipt["内联收据"]
SaveFile --> TrackEvents
InlineReceipt --> TrackEvents
WriteMessage --> TrackEvents
WriteDiag --> TrackEvents
TrackEvents --> Finish{"委托结束"}
Finish --> WriteFinish["写入finish条目"]
WriteFinish --> End(["完成"])
```

**图表来源**
- [src/main/conversation/DelegationTraceStore.ts:140-192](file://src/main/conversation/DelegationTraceStore.ts#L140-L192)

#### 前端集成示例
前端通过 useDelegationTrace hook 集成委托追踪功能：

- **自动刷新**：监听 delegationChanged 事件，自动重新加载追踪数据
- **分页加载**：支持逐步加载更多步骤，提升用户体验
- **错误处理**：完善的错误处理和空状态处理

```mermaid
sequenceDiagram
participant Hook as "useDelegationTrace"
participant API as "Renderer API"
participant Store as "DelegationTraceStore"
Hook->>API : getDelegationTrace({sessionId, parentToolCallId, cursor : 0, pageSize : 40})
API->>Store : read(sessionId, parentToolCallId, 0, 40)
Store-->>API : DelegationTracePage
API-->>Hook : 返回追踪数据
Hook->>Hook : 设置state和visibleCount
Hook->>API : 监听delegationChanged事件
API-->>Hook : 事件通知
Hook->>API : getDelegationTrace({cursor : nextCursor, pageSize : 80})
API->>Store : read(sessionId, parentToolCallId, nextCursor, 80)
Store-->>API : 更多追踪数据
API-->>Hook : 返回扩展的追踪数据
```

**图表来源**
- [src/renderer/features/transcript/useDelegationTrace.ts:23-44](file://src/renderer/features/transcript/useDelegationTrace.ts#L23-L44)
- [src/main/conversation/DelegationTraceStore.ts:193-204](file://src/main/conversation/DelegationTraceStore.ts#L193-L204)

**章节来源**
- [src/main/ipc/conversationHandlers.ts:122-138](file://src/main/ipc/conversationHandlers.ts#L122-L138)
- [src/main/conversation/DelegationTraceStore.ts:1-218](file://src/main/conversation/DelegationTraceStore.ts#L1-L218)
- [src/shared/types/delegationTrace.ts:1-45](file://src/shared/types/delegationTrace.ts#L1-L45)
- [src/renderer/features/transcript/useDelegationTrace.ts:1-49](file://src/renderer/features/transcript/useDelegationTrace.ts#L1-L49)

### 前端调用示例流程（以对话发送为例）
```mermaid
sequenceDiagram
participant FE as "渲染器"
participant PT as "Preload Transport"
participant MH as "main : conversationHandlers"
participant CS as "ConversationService"
participant ST as "StorageAdapter"
FE->>PT : electronAPI.conversation.sendMessage(request)
PT->>MH : ipcRenderer.invoke("conversation : sendMessage", request)
MH->>MH : parseIpcArgs(校验/限流)
MH->>CS : sendMessage({ ...request, fallbacks })
CS-->>MH : result(turn, preparedContext)
MH->>ST : setCurrentSessionId(sessionId)
MH-->>PT : { status : "accepted", requestId, turn, preparedContext }
PT-->>FE : 返回结果
```

**图表来源**
- [src/preload/rendererTransport.ts:29-32](file://src/preload/rendererTransport.ts#L29-L32)
- [src/main/ipc/conversationHandlers.ts:43-78](file://src/main/ipc/conversationHandlers.ts#L43-L78)

**章节来源**
- [src/main/ipc/conversationHandlers.ts:43-78](file://src/main/ipc/conversationHandlers.ts#L43-L78)

### 工作流控制流程（resume/stop）
```mermaid
sequenceDiagram
participant FE as "渲染器"
participant PT as "Preload Transport"
participant WH as "main : workflowHandlers"
participant DR as "DebuggerRuntime"
participant SA as "StorageAdapter"
FE->>PT : electronAPI.workflow.resume(sessionId?)
PT->>WH : ipcRenderer.invoke("workflow : resume", sessionId?)
alt 提供 sessionId
WH->>SA : setCurrentSessionId(sessionId)
WH->>SA : getLatestRun(sessionId)
end
WH-->>PT : { success : true }
FE->>PT : electronAPI.workflow.stop(runId?)
PT->>WH : ipcRenderer.invoke("workflow : stop", runId?)
WH->>DR : stopRun(targetRunId)
WH-->>PT : { success : true/false, error? }
```

**图表来源**
- [src/main/ipc/workflowHandlers.ts:35-82](file://src/main/ipc/workflowHandlers.ts#L35-L82)

**章节来源**
- [src/main/ipc/workflowHandlers.ts:35-82](file://src/main/ipc/workflowHandlers.ts#L35-L82)

## 依赖关系分析
- 通道契约驱动：channels.ts 是所有通道的单一事实来源，渲染器 API 与主进程处理器均依赖其类型与常量。
- 注册表耦合：workbenchHandlers 依赖 invokeRegistry 提供的拦截与断言能力；invokeRegistry 依赖 channels 中的 RENDERER_INVOKE_CHANNELS 进行一致性检查。
- 传输解耦：preload 的 rendererTransport 仅依赖 Electron ipcRenderer，不感知业务通道，便于替换或测试。
- 处理器内聚：每个业务域处理器独立注册，职责清晰，通过 workbenchHandlers 统一装配。
- **新增** 前端模块解耦：各订阅模块独立管理特定领域的事件，通过 useIpcEventBridge 协调，降低耦合度。
- **新增** 委托追踪依赖：DelegationTraceStore 依赖 storageAdapter 进行文件操作，通过 workflowProjectionPublisher 广播状态变更。

```mermaid
graph LR
CH["channels.ts"] --> RA["createRendererApi.ts"]
CH --> IR["invokeRegistry.ts"]
RA --> RT["rendererTransport.ts"]
RT --> WH["workbenchHandlers.ts"]
WH --> IR
WH --> CH
WH --> H1["conversationHandlers.ts"]
WH --> H2["workflowHandlers.ts"]
RT --> EB["useIpcEventBridge.ts"]
EB --> CS["conversationSubscriptions.ts"]
EB --> SS["sessionSubscriptions.ts"]
EB --> SHS["shellSubscriptions.ts"]
EB --> CPS["captureSubscriptions.ts"]
H1 --> DTS["DelegationTraceStore.ts"]
DTS --> WP["WorkflowProjectionPublisher"]
```

**图表来源**
- [src/shared/renderer-api/channels.ts:1-244](file://src/shared/renderer-api/channels.ts#L1-L244)
- [src/shared/renderer-api/createRendererApi.ts:33-76](file://src/shared/renderer-api/createRendererApi.ts#L33-L76)
- [src/preload/rendererTransport.ts:9-44](file://src/preload/rendererTransport.ts#L9-L44)
- [src/main/ipc/workbenchHandlers.ts:259-281](file://src/main/ipc/workbenchHandlers.ts#L259-L281)
- [src/main/ipc/invokeRegistry.ts:9-51](file://src/main/ipc/invokeRegistry.ts#L9-L51)
- [src/main/ipc/conversationHandlers.ts:43-78](file://src/main/ipc/conversationHandlers.ts#L43-L78)
- [src/main/ipc/workflowHandlers.ts:21-33](file://src/main/ipc/workflowHandlers.ts#L21-L33)
- [src/renderer/app/bootstrap/useIpcEventBridge.ts:44-123](file://src/renderer/app/bootstrap/useIpcEventBridge.ts#L44-L123)
- [src/main/conversation/DelegationTraceStore.ts:1-218](file://src/main/conversation/DelegationTraceStore.ts#L1-L218)

**章节来源**
- [src/shared/renderer-api/channels.ts:1-244](file://src/shared/renderer-api/channels.ts#L1-L244)
- [src/main/ipc/workbenchHandlers.ts:259-281](file://src/main/ipc/workbenchHandlers.ts#L259-L281)
- [src/main/ipc/invokeRegistry.ts:9-51](file://src/main/ipc/invokeRegistry.ts#L9-L51)
- [src/renderer/app/bootstrap/useIpcEventBridge.ts:44-123](file://src/renderer/app/bootstrap/useIpcEventBridge.ts#L44-L123)

## 性能考虑
- 参数体积限制：parseIpcArgs 支持 maxBytes 限制，避免大载荷阻塞事件循环。建议对图片/附件类通道设置合理上限，并在前端分片上传。
- 事件去重与订阅管理：rendererTransport 维护监听器映射，避免重复绑定；建议在组件卸载时主动移除监听，防止内存泄漏。
- 批量操作与节流：对于高频事件（如 trace、日志），可在主进程侧合并或采样后再广播，减少渲染器压力。
- 异步与错误隔离：处理器内部 try/catch 包裹业务调用，失败时返回标准化错误，避免未捕获异常导致进程崩溃。
- 启动顺序：先安装 invoke 注册表再注册处理器，确保断言能覆盖全部通道；将耗时初始化（如恢复会话）放在 initializeIpcState 中，避免阻塞注册流程。
- **新增** 前端事件批处理：conversationEventBatcher 合并高频消息事件到动画帧，减少不必要的重渲染。
- **新增** 模块化资源管理：每个订阅模块独立管理自己的监听器和资源，提供更好的内存管理和测试支持。
- **新增** 委托追踪性能优化：DelegationTraceStore 使用文件追加模式和高性能缓存机制，支持大文件的分页读取。

## 故障排查指南
- 通道缺失报错
  - 现象：启动时报"Renderer IPC parity violation; missing handlers: ..."
  - 原因：渲染器声明了某通道，但主进程未注册对应处理器
  - 处理：在对应域处理器文件中注册该通道，或在 channels.ts 中移除未使用的通道
  - 参考
    - [src/main/ipc/invokeRegistry.ts:45-51](file://src/main/ipc/invokeRegistry.ts#L45-L51)
    - [src/main/ipc/workbenchHandlers.ts:259-281](file://src/main/ipc/workbenchHandlers.ts#L259-L281)

- 参数校验失败
  - 现象：调用立即返回错误，日志提示字段缺失或超限
  - 原因：parseIpcArgs 校验失败（字段类型不符、大小超限、padTo 不足）
  - 处理：修正前端传参，调整 Schema 或增大 maxBytes
  - 参考
    - [src/main/ipc/conversationHandlers.ts:43-78](file://src/main/ipc/conversationHandlers.ts#L43-L78)
    - [src/main/ipc/workflowHandlers.ts:21-33](file://src/main/ipc/workflowHandlers.ts#L21-L33)

- 事件未送达
  - 现象：渲染器 on(channel) 未触发
  - 排查：确认主进程是否调用 broadcastToRenderer；确认频道名与 channels.ts 一致；确认窗口未被销毁
  - 参考
    - [src/main/ipc/workbenchHandlers.ts:79-87](file://src/main/ipc/workbenchHandlers.ts#L79-L87)
    - [src/shared/renderer-api/channels.ts:178-218](file://src/shared/renderer-api/channels.ts#L178-L218)

- 主题切换无效
  - 现象：系统主题变更后渲染器未收到 app:themeChanged
  - 排查：确认 registerNativeThemeBridge 已执行；确认渲染器订阅了该事件
  - 参考
    - [src/main/ipc/workbenchHandlers.ts:248-257](file://src/main/ipc/workbenchHandlers.ts#L248-L257)

- **新增** 前端事件处理问题
  - 现象：某些事件未正确处理或内存泄漏
  - 排查：确认对应的订阅模块是否正确注册；检查 unsubscribe 函数是否正确调用；验证事件批处理器的 dispose 方法
  - 处理：确保每个订阅模块都有对应的清理逻辑；检查 useIpcEventBridge 的 useEffect 依赖数组
  - 参考
    - [src/renderer/app/bootstrap/useIpcEventBridge.ts:92-111](file://src/renderer/app/bootstrap/useIpcEventBridge.ts#L92-L111)
    - [src/renderer/app/bootstrap/conversationSubscriptions.ts:136-139](file://src/renderer/app/bootstrap/conversationSubscriptions.ts#L136-L139)

- **新增** 委托追踪API问题
  - 现象：getDelegationTrace 或 getDelegationReceipt 调用失败
  - 排查：确认sessionId权限验证；检查委托追踪文件是否存在；验证parentToolCallId和stepId的正确性
  - 处理：检查DelegationTraceStore的错误码；确认委托执行已正确开始和结束
  - 参考
    - [src/main/ipc/conversationHandlers.ts:122-138](file://src/main/ipc/conversationHandlers.ts#L122-L138)
    - [src/main/conversation/DelegationTraceStore.ts:193-216](file://src/main/conversation/DelegationTraceStore.ts#L193-L216)

**章节来源**
- [src/main/ipc/invokeRegistry.ts:45-51](file://src/main/ipc/invokeRegistry.ts#L45-L51)
- [src/main/ipc/workbenchHandlers.ts:248-257](file://src/main/ipc/workbenchHandlers.ts#L248-L257)
- [src/main/ipc/conversationHandlers.ts:43-78](file://src/main/ipc/conversationHandlers.ts#L43-L78)
- [src/main/ipc/workflowHandlers.ts:21-33](file://src/main/ipc/workflowHandlers.ts#L21-L33)
- [src/shared/renderer-api/channels.ts:178-218](file://src/shared/renderer-api/channels.ts#L178-L218)
- [src/renderer/app/bootstrap/useIpcEventBridge.ts:92-111](file://src/renderer/app/bootstrap/useIpcEventBridge.ts#L92-L111)
- [src/main/ipc/conversationHandlers.ts:122-138](file://src/main/ipc/conversationHandlers.ts#L122-L138)
- [src/main/conversation/DelegationTraceStore.ts:193-216](file://src/main/conversation/DelegationTraceStore.ts#L193-L216)

## 结论
该 IPC 体系通过"通道契约 + 预加载传输 + 主进程注册表 + 参数校验 + 事件广播"的组合，实现了高内聚、低耦合、类型安全且可扩展的前后端通信。invokeRegistry 提供了强大的运行时治理能力，确保前后端通道一致；workbenchHandlers 作为组合根，统一管理生命周期与广播；各域处理器职责清晰，易于维护与扩展。

**更新** 前端事件处理系统的重大重构进一步提升了代码质量，通过将单一的大文件拆分为多个专用订阅模块，显著提高了可测试性、可维护性和性能。新的模块化架构使得每个业务领域的事件处理逻辑更加内聚，便于单独测试和维护。同时，新增的委托追踪API为复杂的代理执行场景提供了完整的追踪和审计能力，支持大文件的分页读取和高效的缓存机制。遵循本文的性能与排障建议，可进一步提升稳定性与可观测性。

## 附录
- 常用通道分类（节选）
  - 应用外壳：app:getMeta、dialog:selectFiles、window:minimize 等
  - 对话：conversation:sendMessage、conversation:getHistory、conversation:getDelegationTrace、conversation:getDelegationReceipt 等
  - 工作流：workflow:getState、workflow:resume、workflow:stop 等
  - 知识/记忆/调查：knowledge:*、memory:*、investigation:*
  - 设备/会话/项目/运行：device:*、session:*、project:*、run:*
  - 运行时/追踪：runtimeLog:list、trace:*
- 事件通道（节选）
  - workflow:runStatusChanged、tool:executionComplete、app:themeChanged、llm:stream、conversation:delegationChanged 等
- **新增** 前端订阅模块职责
  - conversationSubscriptions：对话消息流、工具执行跟踪、代理事件处理
  - sessionSubscriptions：运行状态监控、使用情况统计、证据事件处理
  - shellSubscriptions：系统命令处理、主题切换、窗口状态管理
  - captureSubscriptions：设备状态同步、上下文快照管理、捕获状态更新
- **新增** 委托追踪API说明
  - getDelegationTrace：获取委托执行的步骤列表，支持分页查询
  - getDelegationReceipt：获取委托执行的详细收据，支持大文本分页读取
  - delegationChanged：委托状态变更事件，用于前端自动刷新