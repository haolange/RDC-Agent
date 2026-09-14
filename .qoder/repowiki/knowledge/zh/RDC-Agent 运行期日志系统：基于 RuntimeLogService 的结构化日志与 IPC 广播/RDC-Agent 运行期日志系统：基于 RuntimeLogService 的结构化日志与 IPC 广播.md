---
kind: logging_system
name: RDC-Agent 运行期日志系统：基于 RuntimeLogService 的结构化日志与 IPC 广播
category: logging_system
scope:
    - '**'
source_files:
    - src/shared/types/runtimeLog.ts
    - src/main/runtime/RuntimeLogService.ts
    - src/main/runtime/secretRedaction.ts
    - src/main/ipc/runtimeTerminalHandlers.ts
    - src/main/index.ts
    - src/renderer/app/bootstrap/useIpcEventBridge.ts
    - src/renderer/features/terminal/TerminalDrawer/terminalFormatters.ts
    - src/main/browserAppBridge/rendererEventHub.ts
---

## 1. 使用的系统与方案

仓库没有引入第三方日志框架（如 winston、pino、bunyan），而是实现了一个自研的 **RuntimeLogService**，位于 `src/main/runtime/RuntimeLogService.ts`。该服务以结构化日志条目（`RuntimeLogEntry`）为核心，通过 Electron 的 `BrowserWindow.webContents.send` 和 `rendererEventHub` 将日志实时广播到渲染进程，并在主进程内存中以有界队列形式持久化。

- 日志类型定义集中在共享层 `src/shared/types/runtimeLog.ts`，供 main/renderer 共用。
- 日志写入入口为单例 `runtimeLogService`，被多个 main 子系统通过依赖注入使用。
- 渲染端通过 IPC 事件 `runtime:logAppended` 接收日志并追加到终端抽屉（`TerminalDrawer`）中展示。

## 2. 关键文件与包

| 文件 | 作用 |
|---|---|
| `src/shared/types/runtimeLog.ts` | 定义 `RuntimeLogScope`、`RuntimeLogNamespace`、`RuntimeLogSeverity`、`RuntimeLogDetailLevel`、`RuntimeLogEntry` 等共享类型 |
| `src/main/runtime/RuntimeLogService.ts` | 核心日志服务：字段裁剪、敏感信息脱敏、大小限制、内存缓存、IPC 广播 |
| `src/main/index.ts` | 应用生命周期关键节点调用 `runtimeLogService.log` 记录启动/关闭等事件 |
| `src/main/ipc/runtimeTerminalHandlers.ts` | 暴露 `list(scope, sessionId)` 查询接口给渲染端 |
| `src/renderer/features/terminal/TerminalDrawer/terminalFormatters.ts` | 渲染端格式化 `raw` 字段用于 UI 展示 |
| `src/renderer/app/bootstrap/useIpcEventBridge.ts` | 订阅 `runtime:logAppended` 事件并将条目推入 store |
| `src/main/browserAppBridge/rendererEventHub.ts` | 跨窗口的事件总线，用于向所有 BrowserWindow 广播日志 |
| `src/main/runtime/secretRedaction.ts` | 提供 `redactCredentialLikeText`、`redactSecretsDeep` 进行敏感信息脱敏 |

## 3. 架构与设计约定

### 3.1 结构化日志模型
每条日志是一个 `RuntimeLogEntry`，包含以下字段：
- `id`: 通过 `generateEventId('rlog')` 生成的唯一标识
- `timestamp`: 毫秒时间戳（默认 `nowMs()`）
- `scope`: `'app' | 'session'`，区分应用级与会话级日志
- `namespace`: `'system' | 'agent' | 'tool' | 'device' | 'capture' | 'context' | 'llm'`，按子系统划分来源
- `severity`: `'info' | 'success' | 'warning' | 'error'`
- `title` / `summary` / `detail` / `raw`：分层描述，支持富文本与原始数据
- `sessionId` / `projectId` / `runId`：关联上下文标识

### 3.2 安全与容量控制
- **敏感信息脱敏**：写入前对 `title`、`summary`、`detail` 调用 `redactCredentialLikeText`，对 `raw` 对象调用 `redactSecretsDeep(raw, 'raw')` 递归脱敏。
- **UTF-8 字节截断**：`truncateUtf8` 保证 `title` ≤ 4KB、`summary` ≤ 8KB、`detail` ≤ 16KB；当整体 JSON 序列化超过 `MAX_ENTRY_BYTES = 64KB` 时，逐步回退压缩 `detail` → `raw.preview` → 丢弃 `detail`。
- **内存上限**：应用级日志数组上限 `APP_LOG_LIMIT = 1000`，会话级日志上限 `SESSION_LOG_LIMIT = 500`，超出后 FIFO 丢弃最早条目。

### 3.3 多进程广播机制
`RuntimeLogService.broadcast` 同时通过两条通道推送新日志：
1. `rendererEventHub.emit('runtime:logAppended', entry)` — 同进程内事件总线
2. `BrowserWindow.getAllWindows().forEach(win => win.webContents.send('runtime:logAppended', entry))` — 跨窗口 IPC 广播

渲染端在 `useIpcEventBridge.ts` 中监听该事件，将条目追加到 `useTerminalStore` 的 entries 列表，最终由 `TerminalDrawer` 组件渲染。

### 3.4 查询 API
通过 `runtimeLogService.list(scope, sessionId?)` 提供两种查询模式：
- `scope='app'`：返回应用级全局日志
- `scope='session'` + `sessionId`：返回指定会话的日志
渲染端通过 `ipc/runtimeterminalhandlers.ts` 暴露此能力。

## 4. 约定与约束

- **统一入口**：main 进程各模块应通过 `import { runtimeLogService } from '../runtime/RuntimeLogService'` 使用日志服务，而非直接 `console.log`。当前代码库中仍存在大量散落的 `console.log` / `console.warn` / `console.error`（例如 `MCPManager`、`MemoryStore`、`ReplayDeviceService`、`ConversationTurnRunner` 等），这些属于历史遗留或未迁移的调试输出，不属于正式日志体系。
- **命名空间规范**：日志 `namespace` 必须从预定义枚举中选择（`system`、`agent`、`tool`、`device`、`capture`、`context`、`llm`），不得随意新增字符串值。
- **严重级别语义**：`info` 表示常规信息，`success` 表示成功完成，`warning` 表示可恢复异常，`error` 表示失败路径。
- **会话隔离**：需要关联会话的日志必须传入 `sessionId`，否则仅进入应用级日志桶。
- **不可变快照**：`list()` 返回的是 `Array.from(...)` 的副本，避免外部修改内部状态。
- **无落盘策略**：当前日志仅驻留在主进程内存中，未实现持久化到文件或数据库；如需持久化需扩展 `RuntimeLogService`。
- **渲染端消费契约**：渲染端必须订阅 `runtime:logAppended` 事件，并通过 `formatRaw` 等工具函数格式化 `raw` 字段后再展示。

## 5. 现状评估

该日志系统是一个轻量级的、面向 Electron 主进程的运行时诊断通道，适合在开发/调试阶段查看 Agent 执行轨迹、设备捕获、会话流程等。它不替代生产环境的外部日志收集系统（如 Sentry，仓库中另有 `src/main/telemetry/SentryService.ts`）。对于需要长期存储或远端上报的日志，应结合其他遥测/审计机制。