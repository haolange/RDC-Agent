---
kind: logging_system
name: 运行期结构化日志系统（RuntimeLogService）
category: logging_system
scope:
    - '**'
source_files:
    - src/main/runtime/RuntimeLogService.ts
    - src/shared/types/runtimeLog.ts
    - src/main/runtime/secretRedaction.ts
    - src/main/browserAppBridge/rendererEventHub.ts
    - src/main/index.ts
    - src/main/captures/ReplayDeviceService.ts
    - src/main/conversation/ConversationRoutePreflight.ts
    - src/main/conversation/ConversationTurnAgentEventHandler.ts
    - src/main/conversation/ConversationTurnRunner.ts
---

## 1. 使用的系统与方案

本仓库没有引入第三方日志框架（如 winston、pino、bunyan、debug 等），而是实现了一个自研的**进程内结构化运行时日志服务** `RuntimeLogService`，位于 `src/main/runtime/RuntimeLogService.ts`。它通过 Electron 主进程事件总线将日志条目广播到渲染进程，供 UI 展示。

- **日志框架**：无外部依赖，纯 TypeScript 实现；跨进程通道使用 `rendererEventHub`（SSE 风格的事件发布）与 `BrowserWindow.webContents.send` 双路推送。
- **日志级别**：固定为 `info | success | warning | error`（`RuntimeLogSeverity`）。
- **结构化字段**：每条日志是一个 `RuntimeLogEntry`，包含 `id`、`timestamp`、`scope`、`namespace`、`severity`、`title`、`summary`、`detail?`、`sessionId?`、`projectId?`、`runId?`、`raw?`。
- **作用域/命名空间**：`scope` 限定为 `'app' | 'session'`，`namespace` 限定为 `'system' | 'agent' | 'tool' | 'device' | 'capture' | 'context' | 'llm'`，用于在 UI 中按模块过滤。

## 2. 关键文件与包

| 文件 | 职责 |
|---|---|
| `src/shared/types/runtimeLog.ts` | 定义 `RuntimeLogScope`、`RuntimeLogNamespace`、`RuntimeLogSeverity`、`RuntimeLogDetailLevel`、`RuntimeLogEntry` 共享类型 |
| `src/main/runtime/RuntimeLogService.ts` | 日志服务核心：入参校验、脱敏、截断、内存环形缓冲、广播 |
| `src/main/runtime/secretRedaction.ts` | 敏感信息脱敏工具（`redactCredentialLikeText`、`redactSecretsDeep`） |
| `src/main/browserAppBridge/rendererEventHub.ts` | 主进程→渲染进程事件分发（SSE + IPC） |
| `src/main/index.ts` | 应用启动时注册 `runtimeLogService.log` 作为全局错误/未捕获异常入口 |
| `src/main/captures/ReplayDeviceService.ts` | 设备回放场景下调用 `runtimeLogService.log` 记录运行日志 |
| `src/main/conversation/ConversationRoutePreflight.ts` | 对话路由预检查失败时写入 session 级日志 |
| `src/main/conversation/ConversationTurnAgentEventHandler.ts` | Agent 事件处理过程中写入日志 |
| `src/main/conversation/ConversationTurnRunner.ts` | 对话轮次执行过程中写入日志 |

## 3. 架构与约定

### 3.1 日志生命周期
1. 调用方构造 `RuntimeLogInput`（含 `scope`、`namespace`、`severity`、`title`、`summary`、可选 `detail`/`raw`、以及 `sessionId`/`projectId`/`runId` 上下文）。
2. `clampEntryFields` 对字段进行**敏感信息脱敏**（标题/摘要/详情走 `redactCredentialLikeText`，`raw` 走 `redactSecretsDeep`）。
3. 对 `title`（4KB）、`summary`（8KB）、`detail`（16KB）做 UTF-8 字节截断；`raw` 序列化后受 `MAX_ENTRY_BYTES = 64KB` 硬上限约束，超限时降级为 `{ truncated: true, preview }`。
4. 生成唯一 `id`（前缀 `rlog`）和 `timestamp`，放入两个内存数组：
   - `appEntries`：全局应用级日志，上限 `APP_LOG_LIMIT = 1000`。
   - `sessionEntries[sessionId]`：会话级日志，上限 `SESSION_LOG_LIMIT = 500`。
5. 通过 `rendererEventHub.emit('runtime:logAppended', entry)` 与 `BrowserWindow.webContents.send('runtime:logAppended', entry)` 双路广播给所有渲染窗口。
6. 提供 `list(scope, sessionId?)` 查询接口，供 IPC 或 UI 拉取历史。

### 3.2 安全与容量策略
- 所有日志字段在进入存储前强制脱敏，防止密钥、凭据泄露。
- 单条日志 JSON 总大小被限制在 64KB，超出则逐步丢弃 `detail` → `raw` → `summary` → `title`，确保不会撑爆内存或 IPC 消息。
- 日志仅保存在内存中，不持久化到磁盘（由独立的 Trace/Session 系统负责持久化）。UI 侧可据此决定是否落盘。

### 3.3 消费端模式
- 测试文件中通过 `vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }))` 替换实现，说明该服务是注入式单例，便于单元测试隔离。
- 渲染进程通过监听 `runtime:logAppended` 事件增量接收新日志，而非全量拉取。

## 4. 约定与约束

- **禁止直接写控制台**：尽管代码中仍存在大量 `console.log/warn/error/info`（例如 `MCPManager`、`MemoryStore`、`ReplayDeviceService`、`ConversationTurn*` 等），但业务逻辑应通过 `runtimeLogService.log` 输出结构化日志，以便 UI 展示与审计。`console.*` 目前仅出现在调试/兜底路径。
- **必须指定 scope 与 namespace**：所有 `runtimeLogService.log` 调用都应明确传入 `scope`（`'app' | 'session'`）和 `namespace`（`'system' | 'agent' | 'tool' | 'device' | 'capture' | 'context' | 'llm'`），以支持前端按模块过滤。
- **severity 默认 info**：未显式传入时默认为 `'info'`，错误路径应显式传入 `'error'` 或 `'warning'`。
- **raw 字段需可序列化**：如果 `JSON.stringify(raw)` 抛错，会被替换为 `{ truncated: true, reason: 'unserializable' }`，因此调用方不应传递循环引用对象。
- **会话级日志必须传 sessionId**：只有传入 `sessionId` 才会进入会话桶；否则仅进入全局桶。
- **日志不可持久化**：当前实现仅为内存缓存，如需长期保存应由上层 Trace/Session 子系统另行处理。

## 5. 现状评估

该日志系统已具备完整的结构化模型、脱敏、限流与跨进程广播能力，并被多个主进程模块（captures、conversation、index 启动流程）实际使用。但它尚未成为全仓库统一的日志出口——大量 `console.*` 仍散落在各模块中，且未见统一的日志级别开关或外部 sink（文件、远程收集）。因此，这是一个**部分落地、仍在演进中的内部运行时日志子系统**。