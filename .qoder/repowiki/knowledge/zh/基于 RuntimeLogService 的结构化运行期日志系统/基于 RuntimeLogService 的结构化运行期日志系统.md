---
kind: logging_system
name: 基于 RuntimeLogService 的结构化运行期日志系统
category: logging_system
scope:
    - '**'
source_files:
    - src/main/runtime/RuntimeLogService.ts
    - src/shared/types/runtimeLog.ts
    - src/main/browserAppBridge/rendererEventHub.ts
    - src/main/index.ts
    - src/main/conversation/ConversationRoutePreflight.ts
    - src/main/captures/ReplayDeviceService.ts
    - src/main/conversation/ConversationTurnAgentEventHandler.ts
    - src/main/conversation/ConversationTurnRunner.ts
    - src/main/runtime/secretRedaction.ts
---

## 1. 使用的系统与框架

RDC-Agent 没有引入第三方日志库（如 winston、pino、bunyan），而是实现了一个自研的**结构化运行期日志服务** `RuntimeLogService`，位于 `src/main/runtime/RuntimeLogService.ts`。该服务以内存为存储后端，通过 Electron IPC 与 SSE（Server-Sent Events）将日志事件实时推送到渲染进程。

- **日志框架**：自研 `RuntimeLogService`，无外部依赖。
- **传输通道**：
  - 进程内广播：通过 `rendererEventHub.emit('runtime:logAppended', entry)` 经 SSE 推送给所有已连接客户端。
  - 窗口级广播：遍历 `BrowserWindow.getAllWindows()` 调用 `webContents.send('runtime:logAppended', entry)`。
- **渲染进程消费**：渲染侧通过 `rendererEventHub.connect(...)` 建立 SSE 订阅，监听 `runtime:logAppended` 事件。

## 2. 关键文件与包

| 文件 | 作用 |
|---|---|
| `src/main/runtime/RuntimeLogService.ts` | 日志服务核心：入参校验、字段截断、敏感信息脱敏、内存队列、SSE/IPC 广播 |
| `src/shared/types/runtimeLog.ts` | 共享类型定义：`RuntimeLogScope`、`RuntimeLogNamespace`、`RuntimeLogSeverity`、`RuntimeLogEntry` |
| `src/main/browserAppBridge/rendererEventHub.ts` | 跨进程事件中心，维护 SSE 客户端集合并广播事件 |
| `src/main/index.ts` | 应用入口，多处调用 `runtimeLogService.log` 记录应用生命周期事件 |
| `src/main/conversation/ConversationRoutePreflight.ts` | LLM 诊断日志记录点（`recordLlmDiagnostic`） |
| `src/main/captures/ReplayDeviceService.ts` | 设备状态变更日志记录点 |
| `src/main/conversation/ConversationTurnAgentEventHandler.ts` | Agent 事件处理中的日志记录 |
| `src/main/conversation/ConversationTurnRunner.ts` | Turn 执行过程中的日志记录 |
| `src/main/runtime/secretRedaction.ts` | 敏感字段脱敏工具（被日志服务复用） |

## 3. 架构与约定

### 3.1 结构化日志条目模型

每条日志是强类型的 `RuntimeLogEntry`，包含以下字段：

- **标识与时间**：`id`（由 `generateEventId('rlog')` 生成）、`timestamp`（毫秒时间戳）。
- **分类维度**：
  - `scope`: `'app' | 'session'` —— 区分应用级与会话级日志。
  - `namespace`: `'system' | 'agent' | 'tool' | 'device' | 'capture' | 'context' | 'llm'` —— 按子系统划分来源。
  - `severity`: `'info' | 'success' | 'warning' | 'error'` —— 四级严重度。
- **人类可读内容**：`title`、`summary`、可选 `detail`。
- **上下文关联**：`sessionId`、`projectId`、`runId` —— 用于会话/项目/运行维度的过滤与聚合。
- **原始数据**：`raw?: unknown` —— 承载结构化元数据（如 `code`、`agentId`、`providerId`、`modelId` 等）。

### 3.2 安全与容量约束

- **敏感信息脱敏**：写入前对 `title`、`summary`、`detail` 调用 `redactCredentialLikeText`；对 `raw` 对象调用 `redactSecretsDeep(raw, 'raw')` 递归脱敏。
- **单条日志大小硬限制**：`MAX_ENTRY_BYTES = 64 * 1024`（64KB）。超出时依次回退：先截断 `raw` JSON 为 `{ truncated: true, preview: ... }`，再压缩 `detail`，最后丢弃 `detail` 并大幅缩减 `title`/`summary`。
- **UTF-8 字节级截断**：使用 `Buffer.from(text).subarray` 配合 UTF-8 多字节边界探测，避免产生非法字符。
- **内存上限**：应用级日志最多保留 `APP_LOG_LIMIT = 1000` 条；会话级日志每个 session 最多 `SESSION_LOG_LIMIT = 500` 条，超出从队首淘汰。

### 3.3 路由与分发

- 所有日志统一进入 `RuntimeLogService.log(input)`，内部根据 `scope` 决定写入 `appEntries` 或对应 `sessionId` 的 `sessionEntries` 桶。
- 写入后同步触发 `broadcast(entry)`：通过 `rendererEventHub` 的 SSE 通道 + 所有 `BrowserWindow.webContents.send` 双路推送。
- 渲染进程通过 `rendererEventHub.connect(response)` 建立 SSE 长连接，服务端每 15 秒发送心跳 `:\n\n` 保持连接存活。

### 3.4 调用方约定

各模块通过注入全局单例 `runtimeLogService` 调用 `log({ scope, namespace, severity, title, summary, detail?, sessionId?, projectId?, runId?, raw? })`。典型用法：

- 应用启动/打开文件：`scope='app'`, `namespace='system'`。
- LLM 诊断：`scope` 依据是否处于会话动态选择，`namespace='llm'`，`raw` 携带 `code`/`agentId`/`providerId`/`modelId`/`adapterId`。
- 设备状态变化：`scope='app'`, `namespace='device'`，`severity` 随 `status` 在 `success/warning/info` 间切换。

## 4. 约定与约束

| 规则 | 说明 | 来源 |
|---|---|---|
| 禁止直接 `console.log` 输出业务日志 | 业务日志必须走 `runtimeLogService.log`，控制台仅用于 Electron 渲染进程异常捕获（如 `console-message`、`did-fail-load`、`render-process-gone`） | `src/main/index.ts` 中仅对渲染进程崩溃事件使用 `console.error/console.log` |
| 日志字段必须遵循 `RuntimeLogEntry` 类型 | 所有字段受 TypeScript 类型约束，新增字段需先在 `@shared/types/runtimeLog.ts` 声明 | `src/shared/types/runtimeLog.ts` |
| 日志内容必须脱敏 | 标题、摘要、详情、原始数据均经过 `redactCredentialLikeText` / `redactSecretsDeep` 处理 | `RuntimeLogService.clampEntryFields` |
| 单条日志不超过 64KB | 超过则自动截断并标记 `truncated: true` | `MAX_ENTRY_BYTES` 常量及截断逻辑 |
| 应用日志最多 1000 条、会话日志最多 500 条 | 超出部分从队首删除 | `APP_LOG_LIMIT` / `SESSION_LOG_LIMIT` |
| 日志按 `scope` 分离存储 | `app` 日志全局可见，`session` 日志按 `sessionId` 隔离查询 | `list(scope, sessionId?)` 方法 |
| 日志通过 SSE + IPC 双通道推送 | 保证渲染进程与多窗口同时收到 | `RuntimeLogService.broadcast` |
| `severity` 取值限定为 `info/success/warning/error` | 不允许自定义级别字符串 | `RuntimeLogSeverity` 联合类型 |
| `namespace` 限定为 `system/agent/tool/device/capture/context/llm` | 新增命名空间需在类型中扩展 | `RuntimeLogNamespace` 联合类型 |

## 5. 未覆盖范围

- 无持久化日志文件、无远程日志收集（如 Sentry 仅用于错误上报，见 `src/main/telemetry/SentryService.ts`，与运行期日志分离）。
- 无日志级别开关配置（当前所有 `info` 及以上级别均推送至前端）。
- 无结构化日志格式导出（如 JSON Lines、GELF），仅以内存数组形式供 UI 展示。
