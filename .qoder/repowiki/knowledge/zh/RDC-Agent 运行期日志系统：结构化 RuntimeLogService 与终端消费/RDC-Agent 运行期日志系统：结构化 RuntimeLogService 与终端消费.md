---
kind: logging_system
name: RDC-Agent 运行期日志系统：结构化 RuntimeLogService 与终端消费
category: logging_system
scope:
    - '**'
source_files:
    - src/main/runtime/RuntimeLogService.ts
    - src/shared/types/runtimeLog.ts
    - src/main/ipc/runtimeTerminalHandlers.ts
    - src/renderer/stores/terminalStore.ts
    - src/shared/types/electron.ts
    - src/main/index.ts
    - src/main/conversation/ConversationTurnRunner.ts
    - src/main/conversation/ConversationRoutePreflight.ts
    - src/main/workflow/debugger/AgentOrchestrator.ts
    - src/main/captures/ReplayDeviceService.ts
---

## 1. 使用的系统与架构

本仓库没有引入第三方日志框架（如 winston、pino、bunyan），而是基于 Electron 主进程内自实现的 `RuntimeLogService`，配合共享类型定义与 IPC/事件通道，将结构化日志推送到渲染进程 UI 的“终端”面板。

核心组件：
- `src/shared/types/runtimeLog.ts`：集中声明日志类型——作用域 `RuntimeLogScope = 'app' | 'session'`、命名空间 `RuntimeLogNamespace = 'system' | 'agent' | 'tool' | 'device' | 'capture' | 'context' | 'llm'`、严重级别 `RuntimeLogSeverity = 'info' | 'success' | 'warning' | 'error'`，以及条目结构 `RuntimeLogEntry`（含 id、timestamp、scope、namespace、severity、title、summary、detail、sessionId、projectId、runId、raw）。
- `src/main/runtime/RuntimeLogService.ts`：唯一日志写入入口。单例导出 `runtimeLogService`，提供 `log(input)` 写入和 `list(scope, sessionId?)` 查询。
- `src/main/ipc/runtimeTerminalHandlers.ts`：通过 `ipcMain.handle('runtimeLog:list', ...)` 暴露只读查询接口，供渲染进程拉取历史日志。
- `src/renderer/stores/terminalStore.ts`：Zustand store 维护日志视图状态（scopeFilter、namespaceFilter、severityFilter、density、query、followOutput），并通过 `window.electronAPI.runtimeLog.list` 拉取数据，同时订阅 `runtime:logAppended` 事件追加新条目。

## 2. 关键文件

- `src/main/runtime/RuntimeLogService.ts`：日志服务实现，包含内存缓冲、大小裁剪、敏感信息脱敏、事件广播。
- `src/shared/types/runtimeLog.ts`：跨进程共享的日志类型契约。
- `src/main/ipc/runtimeTerminalHandlers.ts`：IPC 处理器，注册 `runtimeLog:list` 查询。
- `src/renderer/stores/terminalStore.ts`：渲染端终端 store，负责过滤、分页、跟随输出。
- `src/shared/types/electron.ts`：在 Electron API 类型中扩展 `runtimeLog.list` 方法签名。
- `src/main/index.ts`：应用启动时调用 `runtimeLogService.log` 记录应用生命周期事件。
- `src/main/conversation/ConversationTurnRunner.ts`、`src/main/conversation/ConversationRoutePreflight.ts`、`src/main/workflow/debugger/AgentOrchestrator.ts`、`src/main/captures/ReplayDeviceService.ts`、`src/main/ipc/*Handlers.ts` 等：主要业务模块调用 `runtimeLogService.log` 记录运行期事件。

## 3. 架构与约定

### 3.1 写入路径
调用方统一通过 `runtimeLogService.log({ scope, namespace, severity?, title, summary, detail?, sessionId?, projectId?, runId?, raw?, timestamp? })` 写入。服务内部执行以下固定流水线：
1. **敏感信息脱敏**：对 `title`、`summary`、`detail` 调用 `redactCredentialLikeText`；对 `raw` 字段调用 `redactSecretsDeep(raw, 'raw')`。
2. **UTF-8 字节截断**：使用 `truncateUtf8` 限制各字段 UTF-8 字节数（title ≤ 4KB、summary ≤ 8KB、detail ≤ 16KB）。
3. **单条硬上限**：每条 `RuntimeLogEntry` 序列化后不超过 `MAX_ENTRY_BYTES = 64 * 1024` 字节；超出时优先丢弃 `detail`，再回退到压缩 `raw` 为 `{ truncated: true, preview }`，极端情况下仅保留标题摘要。
4. **内存缓冲**：按 `scope` 分别维护 `appEntries`（上限 `APP_LOG_LIMIT = 1000`）和每个 `sessionId` 对应的 `sessionEntries`（上限 `SESSION_LOG_LIMIT = 500`），溢出时 FIFO 丢弃最旧条目。
5. **广播**：通过 `rendererEventHub.emit('runtime:logAppended', entry)` 与 `BrowserWindow.webContents.send('runtime:logAppended', entry)` 推送给所有渲染窗口。

### 3.2 读取路径
- 渲染端通过 `useTerminalStore.refreshEntries()` 调用 `electronAPI.runtimeLog.list({ scope, sessionId? })`，由 `runtimeTerminalHandlers` 转发到 `runtimeLogService.list`。
- 实时增量通过监听 `runtime:logAppended` 事件，由 `terminalStore.appendEntry` 按当前过滤器决定是否追加。

### 3.3 作用域与过滤
- `scope = 'app'`：全局应用级日志。
- `scope = 'session'`：需附带 `sessionId`，用于隔离会话日志。
- 渲染端支持更细粒度过滤：`scopeFilter ∈ {'current-session','current-run','app','all-sessions'}`，结合 `namespaceFilter`、`severityFilter`、`query` 进行客户端筛选。

### 3.4 命名空间与严重级别
- `namespace` 限定领域：`system`、`agent`、`tool`、`device`、`capture`、`context`、`llm`。
- `severity` 限定严重性：`info`、`success`、`warning`、`error`；未指定时默认 `'info'`。

## 4. 约定与约束

- **统一入口**：所有运行期日志必须通过 `runtimeLogService.log` 写入，禁止直接 `console.*` 作为用户可见日志；但代码中仍存在多处 `console.warn/error/log` 用于调试或异常兜底（例如 `MemoryStore`、`TraceProjectionRefreshService`、`ConversationTurnRunner` 等），这些不属于结构化日志体系。
- **字段语义**：`title` 是短标题，`summary` 是摘要，`detail` 是可选详情，`raw` 是原始负载；三者均受脱敏与字节上限保护。
- **安全约束**：`raw` 字段在序列化前强制走 `redactSecretsDeep`，不可绕过；任意字段超过 `MAX_ENTRY_BYTES` 会被主动裁剪，防止内存膨胀。
- **持久化策略**：日志仅驻留内存（`appEntries` + `sessionEntries` Map），不写盘；因此适合运行时诊断，不适合长期归档。
- **IPC 边界**：渲染端只能通过 `runtimeLog:list` 查询，不能写入；写入权限严格保留在主进程。
- **类型契约**：日志类型集中在 `@shared/types/runtimeLog`，主进程与渲染进程共享同一份类型定义，避免双方结构不一致。

## 5. 现状评估

该日志系统是**轻量级、内存型、结构化**的运行期诊断通道，面向 RDC-Agent 桌面应用的“终端”面板。它不是通用应用日志框架，也不承担错误上报（错误上报由 `src/main/telemetry/SentryService.ts` 独立处理）。对于需要落盘、分级路由、异步 sink 的企业级日志需求，当前实现尚未覆盖。