---
kind: logging_system
name: RDC-Agent 运行期日志系统（RuntimeLogService + Sentry）
category: logging_system
scope:
    - '**'
source_files:
    - src/shared/types/runtimeLog.ts
    - src/main/runtime/RuntimeLogService.ts
    - src/main/index.ts
    - src/renderer/app/bootstrap/shellSubscriptions.ts
    - src/renderer/features/terminal/TerminalDrawer/terminalFormatters.ts
    - src/renderer/stores/terminalStore.ts
    - src/main/telemetry/SentryService.ts
---

## 1. 使用的系统与框架

本仓库没有引入通用第三方日志库（如 winston、pino、bunyan、debug），而是实现了一套**自研的运行时结构化日志子系统**，核心位于 `src/main/runtime/RuntimeLogService.ts`。该服务将日志作为**内存中的结构化事件**收集，并通过 Electron IPC / Renderer Event Hub 广播到渲染进程，最终在 UI 的 Terminal Drawer 中呈现。

此外，错误追踪与崩溃上报通过独立的 `src/main/telemetry/SentryService.ts` 完成，基于 `@sentry/electron/main`，采用懒加载（`require`）方式避免未安装依赖时报错。

## 2. 关键文件

- `src/shared/types/runtimeLog.ts`：定义所有日志类型——`RuntimeLogScope`（`app | session`）、`RuntimeLogNamespace`（`system | agent | tool | device | capture | context | llm`）、`RuntimeLogSeverity`（`info | success | warning | error`）、`RuntimeLogDetailLevel`（`summary | verbose | raw`）以及 `RuntimeLogEntry` 结构体。
- `src/main/runtime/RuntimeLogService.ts`：单例 `runtimeLogService`，负责日志条目构建、字段截断、敏感信息脱敏、内存限流、IPC 广播。
- `src/main/index.ts`：应用启动时注册对 `runtime:logAppended` 事件的监听，把日志推入终端 store。
- `src/renderer/app/bootstrap/shellSubscriptions.ts`：订阅 `runtime:logAppended`，调用 `useTerminalStore.appendEntry`。
- `src/renderer/features/terminal/TerminalDrawer/*`：格式化、搜索、复制日志条目的渲染层逻辑。
- `src/main/telemetry/SentryService.ts`：Sentry 初始化与异常/消息上报。

## 3. 架构与约定

### 3.1 日志条目模型
每条日志是强类型的 `RuntimeLogEntry`，包含：
- 标识：`id`（前缀 `rlog` 的事件 ID）、`timestamp`（毫秒时间戳）
- 上下文：`scope`（`app` 或 `session`）、`namespace`（业务域）、`sessionId` / `projectId` / `runId`
- 内容：`severity`、`title`、`summary`、可选 `detail`、可选 `raw`（任意对象）

### 3.2 采集与存储
- 应用级日志保存在 `appEntries` 数组，会话级日志按 `sessionId` 分桶保存在 `Map<string, RuntimeLogEntry[]>`。
- 硬限流：应用日志上限 `APP_LOG_LIMIT = 1000`，会话日志上限 `SESSION_LOG_LIMIT = 500`，超出则丢弃最旧条目。
- 单条大小限制：`MAX_ENTRY_BYTES = 64 * 1024`（64KB）。`clampEntryFields` 会先对 `title`（4KB）、`summary`（8KB）、`detail`（16KB）做 UTF-8 字节截断，再根据剩余预算压缩 `raw`；若仍超限则逐步丢弃 `detail` → `raw` → `summary` → `title`，保证最终 JSON 序列化后不超过 64KB。

### 3.3 安全与脱敏
- `title` / `summary` / `detail` 经过 `redactCredentialLikeText` 处理。
- `raw` 字段通过 `redactSecretsDeep(raw, 'raw')` 递归深拷贝并脱敏。
- 不可序列化的 `raw` 会被替换为 `{ truncated: true, reason: 'unserializable' }`。

### 3.4 分发通道
- 内部广播：`rendererEventHub.emit('runtime:logAppended', entry)`。
- 跨窗口广播：遍历 `BrowserWindow.getAllWindows()`，向每个非销毁窗口的 `webContents.send('runtime:logAppended', entry)`。
- 渲染端通过 `shellSubscriptions.ts` 订阅该事件，写入 Zustand store（`terminalStore`）。

### 3.5 查询 API
- `list(scope, sessionId?)`：当 `scope === 'session'` 且提供 `sessionId` 时返回该会话日志；否则返回应用级日志。

### 3.6 错误追踪（Sentry）
- `SentryService` 通过 `init(config)` 懒加载 `@sentry/electron/main`，支持 `dsn`、`environment`、`release` 配置。
- `captureException` 附带 `extra.context`；`captureMessage` 支持 `info | warning | error` 级别。
- 未初始化或未安装 SDK 时降级为 `console.warn` / `console.error`，不抛错。

## 4. 约定与约束

| 约定 | 说明 | 依据 |
|---|---|---|
| 所有业务日志必须通过 `runtimeLogService.log(...)` 提交 | 禁止直接 `console.log` 输出业务日志；代码中仍有少量遗留 `console.*`（如 `MemoryStore`、`ConversationTurnRunner` 的错误路径），但新模块应使用 `RuntimeLogService` | `RuntimeLogService` 是唯一集中式入口，被 `captures`、`conversation`、`ipc`、`main/index` 多处引用 |
| 日志必须指定 `scope` 与 `namespace` | 类型强制，`scope` 限定 `app | session`，`namespace` 限定七种业务域 | `RuntimeLogScope` / `RuntimeLogNamespace` 联合类型 |
| 严重级别使用统一枚举 | `info | success | warning | error`，默认 `info` | `RuntimeLogSeverity` 类型定义 |
| 禁止在日志中泄露凭据 | 所有字符串字段与 `raw` 均经脱敏函数处理 | `clampEntryFields` 调用 `redactCredentialLikeText` 与 `redactSecretsDeep` |
| 单条日志不得超过 64KB | 超过则逐级裁剪并最终丢弃多余字段 | `MAX_ENTRY_BYTES` 常量及 `clampEntryField` 中的多重 guard |
| 会话日志需传入 `sessionId` | 未传 `sessionId` 的日志仅进入应用级列表 | `pushWithLimit` 仅在 `entry.sessionId` 存在时分桶 |
| 渲染端只消费 `runtime:logAppended` 事件 | 渲染进程不直接持有日志源，通过事件驱动追加 | `shellSubscriptions.ts` 中唯一订阅点 |
| Sentry 仅在已初始化时上报 | 未初始化时静默降级，不影响主流程 | `SentryService.captureException` / `captureMessage` 的守卫逻辑 |

## 5. 现状评估

- **适用性**：高。仓库有明确的日志类型定义、中心化服务、安全脱敏、内存限流、IPC 分发与 UI 展示链路，构成完整的结构化日志系统。
- **不足**：部分历史模块仍直接使用 `console.*` 输出调试/错误信息，尚未完全迁移至 `RuntimeLogService`；日志目前仅驻留内存（无持久化到文件或数据库），适合调试与实时查看，不适合长期审计归档。
- **扩展点**：可在 `RuntimeLogService.broadcast` 之后接入外部 sink（如文件落盘、远程日志服务），或在 `SentryService` 中关联 `sessionId` / `runId` 等上下文字段以增强可观测性。