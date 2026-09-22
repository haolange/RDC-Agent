---
kind: logging_system
name: RDC-Agent 运行期日志系统：RuntimeLogService + Sentry 双通道
category: logging_system
scope:
    - '**'
source_files:
    - src/main/runtime/RuntimeLogService.ts
    - src/shared/types/runtimeLog.ts
    - src/main/telemetry/SentryService.ts
    - src/main/browserAppBridge/rendererEventHub.ts
    - src/main/index.ts
    - src/main/ipc/captureDeviceHandlers.ts
    - src/main/ipc/knowledgeHandlers.ts
    - src/main/ipc/memoryHandlers.ts
    - src/main/ipc/planHandlers.ts
    - src/main/ipc/projectInputLifecycleHandlers.ts
    - src/main/ipc/settingsLlmHandlers.ts
    - src/main/ipc/workbenchHandlers.ts
    - src/main/captures/ReplayDeviceService.ts
    - src/main/sessions/OwnedRdcDaemonRegistry.ts
    - src/main/conversation/ConversationRoutePreflight.ts
    - src/main/conversation/ConversationTurnAgentEventHandler.ts
    - src/main/conversation/ConversationTurnRunner.ts
    - src/main/workflow/debugger/AgentOrchestrator.deps.ts
    - src/main/workflow/debugger/AgentTurnRunner.ts
    - src/main/workflow/debugger/McpConnectionCoordinator.ts
---

## 1. 使用的系统与框架

RDC-Agent 的日志体系由两个互补通道组成：
- **运行期结构化日志**：通过 `src/main/runtime/RuntimeLogService.ts` 中的 `RuntimeLogService` 实现，基于 Electron 主进程内存缓冲 + 事件广播，供 UI 实时消费。
- **崩溃与错误追踪**：通过 `src/main/telemetry/SentryService.ts` 中的 `SentryService` 封装 `@sentry/electron/main`，用于生产环境异常上报。

没有使用通用第三方日志库（如 winston、pino、bunyan），也没有在渲染进程或预加载脚本中直接写文件；所有业务模块统一通过单例 `runtimeLogService.log(...)` 写入。控制台输出仅用于开发阶段的环境探测与少量诊断（例如 `console.warn('[Sentry] @sentry/electron not installed; crash reporting disabled')`）。

## 2. 关键文件与包

| 路径 | 作用 |
|---|---|
| `src/main/runtime/RuntimeLogService.ts` | 日志服务核心：入参裁剪、敏感信息脱敏、大小限制、内存环形缓冲、跨窗口广播 |
| `src/shared/types/runtimeLog.ts` | 共享类型定义：`RuntimeLogScope`、`RuntimeLogNamespace`、`RuntimeLogSeverity`、`RuntimeLogEntry` |
| `src/main/browserAppBridge/rendererEventHub.ts` | 向渲染进程广播 `runtime:logAppended` 事件 |
| `src/main/index.ts` | Main 入口，初始化并注册大量 `runtimeLogService.log` 调用点 |
| `src/main/telemetry/SentryService.ts` | Sentry 崩溃报告封装，支持 `captureException` / `captureMessage` |
| `src/main/ipc/*Handlers.ts` | IPC 层各处理器（conversation/knowledge/memory/workbench/settingsLlm/captureDevice/plan/projectInputLifecycle）作为主要日志生产者 |
| `src/main/captures/ReplayDeviceService.ts`、`src/main/sessions/OwnedRdcDaemonRegistry.ts`、`src/main/conversation/*`、`src/main/workflow/debugger/*` 等 | 业务子系统通过注入 `runtimeLogService` 记录运行事件 |

## 3. 架构与约定

### 3.1 结构化日志条目模型
每条日志以 `RuntimeLogEntry` 形式产出，字段包括：
- 标识：`id`（`generateEventId('rlog')`）、`timestamp`（`nowMs()`）
- 分类维度：`scope`（`'app' | 'session'`）、`namespace`（`'system' | 'agent' | 'tool' | 'device' | 'capture' | 'context' | 'llm'`）、`severity`（`'info' | 'success' | 'warning' | 'error'`）
- 内容：`title`、`summary`、`detail?`、`raw?`
- 上下文：`sessionId?`、`projectId?`、`runId?`

调用方只需传入 `scope`、`namespace`、`title`、`summary`，可选填 `severity`、`detail`、`raw`、`sessionId`、`projectId`、`runId`、`timestamp`。

### 3.2 安全与容量约束（强制）
- **敏感信息脱敏**：`title`/`summary`/`detail` 经过 `redactCredentialLikeText` 处理；`raw` 通过 `redactSecretsDeep(raw, 'raw')` 深度递归脱敏。
- **UTF-8 字节上限**：单条日志总大小硬限制为 `MAX_ENTRY_BYTES = 64 * 1024`（64KB）。`clampEntryFields` 按顺序截断：先截 `title`（4KB）、`summary`（8KB）、`detail`（16KB），再对 `raw` 做 JSON 序列化预算分配，超出则替换为 `{ truncated: true, preview: ... }`；最终仍超限则丢弃 `detail`、进一步压缩 `summary`/`title`。
- **内存容量限制**：应用级日志数组 `appEntries` 最多保留 `APP_LOG_LIMIT = 1000` 条；每个 `sessionId` 对应的会话日志桶最多保留 `SESSION_LOG_LIMIT = 500` 条，超出时从队首淘汰。

### 3.3 存储与投递
- 日志不持久化到磁盘，仅保存在主进程内存中（`appEntries` + `Map<sessionId, RuntimeLogEntry[]>`）。
- 新增日志后通过 `rendererEventHub.emit('runtime:logAppended', entry)` 和 `BrowserWindow.getAllWindows().forEach(win => win.webContents.send('runtime:logAppended', entry))` 同时推送给所有渲染窗口。
- 提供 `list(scope, sessionId?)` 接口供 IPC 查询历史日志。

### 3.4 崩溃上报通道
`SentryService` 是独立于运行期日志的通道：
- 懒初始化：`init(config)` 仅在首次调用时加载 `@sentry/electron/main`，未安装时静默降级为 `console.warn`。
- 提供 `captureException(error, context?)` 与 `captureMessage(message, level)` 两个方法，均包裹 try/catch 防止上报失败影响主流程。
- 通过 `environment`（默认 `process.env.NODE_ENV ?? 'production'`）和 `release` 区分环境。

## 4. 约定与约束

- **唯一写入入口**：所有业务模块必须通过 `import { runtimeLogService } from '../runtime/RuntimeLogService'` 并使用 `runtimeLogService.log({...})` 写入日志，禁止直接使用 `console.*` 作为业务日志。
- **命名空间规范**：`namespace` 限定为 `system | agent | tool | device | capture | context | llm` 七个枚举值，调用方需据此归类来源。
- **严重级别语义**：`severity` 默认 `'info'`，业务应显式标注 `'warning' | 'error'` 用于区分故障等级。
- **会话关联**：当需要关联某次会话时，必须传入 `sessionId`，否则日志仅进入全局 `app` 桶，不会进入会话视图。
- **原始数据必须可序列化**：`raw` 会尝试 `JSON.stringify`，若抛出异常会被替换为 `{ truncated: true, reason: 'unserializable' }`，因此不应传入循环引用对象。
- **IPC 查询边界**：`list('session', undefined)` 返回空数组；只有显式传入 `sessionId` 才能获取会话日志。
- **Sentry 降级策略**：未初始化或未安装 SDK 时，`captureException`/`captureMessage` 不抛错、不影响主流程，属于预期行为。

## 5. 适用性判断

本仓库存在完整、集中且被广泛使用的日志系统（`RuntimeLogService` + `SentryService`），覆盖主进程几乎所有业务模块，具备结构化字段、安全脱敏、容量限制、多通道投递等特征，因此该类别完全适用。
