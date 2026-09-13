---
kind: logging_system
name: RDC-Agent 运行期日志与错误追踪系统
category: logging_system
scope:
    - '**'
source_files:
    - src/main/runtime/RuntimeLogService.ts
    - src/shared/types/runtimeLog.ts
    - src/main/telemetry/SentryService.ts
    - src/main/index.ts
    - src/main/captures/ReplayDeviceService.ts
    - src/main/conversation/ConversationRoutePreflight.ts
    - src/main/conversation/ConversationTurnAgentEventHandler.ts
    - src/main/conversation/ConversationTurnRunner.ts
    - src/main/ipc/captureDeviceHandlers.ts
---

## 1. 使用的系统与框架

本仓库没有引入通用的 Node.js 日志库（如 winston、pino、bunyan、log4js 等），而是实现了一套**自研的运行时结构化日志服务** `RuntimeLogService`，并辅以 **Sentry** 作为崩溃报告与错误追踪通道。

- 结构化日志：通过 `src/main/runtime/RuntimeLogService.ts` 提供，所有日志以 `RuntimeLogEntry` 结构体形式记录，包含 `id`、`timestamp`、`scope`、`namespace`、`severity`、`title`、`summary`、`detail`、`sessionId`、`projectId`、`runId`、`raw` 等字段。
- 日志级别：由 `RuntimeLogSeverity = 'info' | 'success' | 'warning' | 'error'` 定义，默认值为 `'info'`。
- 日志作用域：`RuntimeLogScope = 'app' | 'session'`，区分应用级与会话级日志。
- 命名空间：`RuntimeLogNamespace = 'system' | 'agent' | 'tool' | 'device' | 'capture' | 'context' | 'llm'`，用于按子系统分类。
- 错误上报：`src/main/telemetry/SentryService.ts` 封装 `@sentry/electron/main`，提供 `init`、`captureException`、`captureMessage` 三个方法，未安装时静默降级为 `console.warn` / `console.error`。

## 2. 关键文件

- `src/shared/types/runtimeLog.ts`：共享的类型定义（`RuntimeLogEntry`、`RuntimeLogScope`、`RuntimeLogNamespace`、`RuntimeLogSeverity`）。
- `src/main/runtime/RuntimeLogService.ts`：核心日志服务，负责入参清洗、敏感信息脱敏、大小限制、内存缓存、广播到渲染进程。
- `src/main/telemetry/SentryService.ts`：Sentry 错误追踪封装，单例导出 `sentryService`。
- `src/main/index.ts`：主进程入口，启动时调用 `runtimeLogService.log` 记录应用生命周期事件。
- `src/main/captures/ReplayDeviceService.ts`、`src/main/conversation/ConversationRoutePreflight.ts`、`src/main/conversation/ConversationTurnAgentEventHandler.ts`、`src/main/conversation/ConversationTurnRunner.ts`、`src/main/ipc/captureDeviceHandlers.ts` 等模块均通过 `import { runtimeLogService } from '../runtime/RuntimeLogService'` 使用统一日志接口。

## 3. 架构与约定

### 3.1 日志写入流程

1. 调用方构造 `RuntimeLogInput`（含 `scope`、`namespace`、`severity?`、`title`、`summary`、`detail?`、`sessionId?`、`projectId?`、`runId?`、`raw?`、`timestamp?`）。
2. `RuntimeLogService.log` 调用 `clampEntryFields` 对字段进行脱敏与截断：
   - 使用 `secretRedaction.redactCredentialLikeText` 脱敏 `title`、`summary`、`detail`；
   - 使用 `secretRedaction.redactSecretsDeep(raw, 'raw')` 递归脱敏 `raw`；
   - 按 UTF-8 字节长度截断：`title ≤ 4 KiB`、`summary ≤ 8 KiB`、`detail ≤ 16 KiB`；
   - 整条条目硬上限 `MAX_ENTRY_BYTES = 64 KiB`，超出时逐步丢弃 `detail` → `raw.preview` → `raw` → `summary` → `title`。
3. 生成唯一 `id`（前缀 `rlog`）与 `timestamp`（`nowMs()`）。
4. 将条目推入两个内存队列：
   - 应用级队列 `appEntries`，上限 `APP_LOG_LIMIT = 1000`；
   - 会话级队列 `sessionEntries.get(sessionId)`，上限 `SESSION_LOG_LIMIT = 500`。
5. 通过 `rendererEventHub.emit('runtime:logAppended', entry)` 和 `BrowserWindow.webContents.send('runtime:logAppended', entry)` 广播到所有渲染进程。

### 3.2 查询接口

- `list('app')`：返回应用级日志副本。
- `list('session', sessionId)`：返回指定会话的日志副本。

### 3.3 错误追踪

`SentryService` 采用懒初始化 + 可选依赖模式：
- `init({ dsn, environment?, release? })` 仅调用一次；若 `@sentry/electron` 未安装则捕获异常并通过 `console.warn` 提示。
- `captureException(error, context?)` 在未初始化时退化为 `console.error('[Sentry]', error.message, context)`。
- `captureMessage(message, level)` 支持 `'info' | 'warning' | 'error'` 三级。

### 3.4 消费端

渲染进程通过 Electron IPC 订阅 `runtime:logAppended` 事件接收实时日志；测试中通过 `vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }))` 替换该服务以隔离副作用。

## 4. 约定与约束

| 规则 | 来源/证据 |
|---|---|
| 所有运行期日志必须通过 `runtimeLogService.log(...)` 提交，禁止直接 `console.*` 输出业务日志 | 各模块统一 import `runtimeLogService` 并使用其 `log` 方法 |
| 日志条目必须声明 `scope`、`namespace`，`severity` 默认 `'info'` | `RuntimeLogService.log` 强制赋值 `severity ?? 'info'` |
| 标题、摘要、详情、原始数据在写入前必须经过敏感信息脱敏 | `clampEntryFields` 调用 `redactCredentialLikeText` 与 `redactSecretsDeep` |
| 单条日志 JSON 序列化后不得超过 64 KiB，否则自动裁剪或丢弃 detail/raw | `MAX_ENTRY_BYTES` 常量及多次 `measure() > MAX_ENTRY_BYTES` 回退逻辑 |
| 应用级日志最多保留最近 1000 条，会话级日志最多保留最近 500 条 | `APP_LOG_LIMIT`、`SESSION_LOG_LIMIT` 常量及 `pushWithLimit` 实现 |
| 日志通过事件总线与 IPC 同时广播给渲染进程，供 UI 实时展示 | `broadcast` 同时调用 `rendererEventHub.emit` 与 `BrowserWindow.webContents.send` |
| Sentry 仅在已 `init` 后上报，未安装 SDK 时静默降级 | `initialized` 标志位与 try/catch 包裹的 `require('@sentry/electron/main')` |
| 环境标识来自 `config.environment ?? process.env.NODE_ENV ?? 'production'` | `SentryService.init` 中的默认值推导 |

## 5. 总结

该仓库的日志系统是一个**轻量级、内存驻留、结构化、带敏感信息脱敏与大小限制**的自研方案，聚焦于 Electron 主进程的运行期可观测性，并通过 IPC 推送至渲染端。错误追踪通过独立的 `SentryService` 插件化接入，与结构化日志解耦。整体设计强调安全（脱敏）、资源可控（固定上限 + 字节截断）与可观测性（结构化字段 + 实时广播）。