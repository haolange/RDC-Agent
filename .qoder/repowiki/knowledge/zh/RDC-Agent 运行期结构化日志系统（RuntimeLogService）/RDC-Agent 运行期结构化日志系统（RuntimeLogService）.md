---
kind: logging_system
name: RDC-Agent 运行期结构化日志系统（RuntimeLogService）
category: logging_system
scope:
    - '**'
source_files:
    - src/main/runtime/RuntimeLogService.ts
    - src/shared/types/runtimeLog.ts
    - src/main/browserAppBridge/rendererEventHub.ts
    - src/main/index.ts
    - src/main/conversation/ConversationTurnRunner.ts
    - src/main/captures/ReplayDeviceService.ts
    - src/main/ipc/captureDeviceHandlers.ts
---

## 1. 使用的系统与框架

RDC-Agent 没有引入第三方日志库，而是基于 Electron 主进程内置能力自建了一个**内存缓冲 + 事件广播**的结构化运行期日志系统。核心由 `src/main/runtime/RuntimeLogService.ts` 提供，类型定义集中在 `src/shared/types/runtimeLog.ts`，通过 `rendererEventHub`（SSE 事件流）和 `BrowserWindow.webContents.send` 将日志实时推送给渲染进程。

## 2. 关键文件与位置

- `src/main/runtime/RuntimeLogService.ts`：日志服务实现，维护应用级与会话级两条环形缓冲区，负责字段裁剪、敏感信息脱敏、大小限制与广播。
- `src/shared/types/runtimeLog.ts`：共享类型，定义 `RuntimeLogScope`（`app` | `session`）、`RuntimeLogNamespace`（`system` | `agent` | `tool` | `device` | `capture` | `context` | `llm`）、`RuntimeSeverity`（`info` | `success` | `warning` | `error`）以及 `RuntimeLogEntry` 结构。
- `src/main/browserAppBridge/rendererEventHub.ts`：基于 Server-Sent Events 的轻量事件总线，用于向所有已连接客户端广播 `runtime:logAppended`。
- `src/main/index.ts`：在应用生命周期中多处调用 `runtimeLogService.log` 记录启动、打开文件等系统事件；同时监听 `console-message` / `did-fail-load` / `render-process-gone` 把渲染进程控制台输出转发到主进程 `console`。
- 各业务模块（如 `conversation/ConversationTurnRunner.ts`、`captures/ReplayDeviceService.ts`、`ipc/captureDeviceHandlers.ts` 等）通过导入单例 `runtimeLogService` 写入日志。

## 3. 架构与约定

### 3.1 数据结构与字段约束
每条日志为 `RuntimeLogEntry`，包含：
- 标识：`id`（前缀 `rlog` 的事件 ID）、`timestamp`（毫秒时间戳）
- 分类：`scope`（`app` 应用级或 `session` 会话级）、`namespace`（`system`/`agent`/`tool`/`device`/`capture`/`context`/`llm`）、`severity`（`info`/`success`/`warning`/`error`）
- 内容：`title`（≤4 KiB UTF-8）、`summary`（≤8 KiB）、`detail`（≤16 KiB）、`raw`（任意对象，JSON 序列化后受总条目上限约束）
- 关联：`sessionId`、`projectId`、`runId`

### 3.2 安全与容量保护
- **敏感信息脱敏**：`title`/`summary`/`detail` 经 `redactCredentialLikeText` 处理，`raw` 经 `redactSecretsDeep` 深度递归脱敏。
- **硬编码大小上限**：单条日志 JSON 字节数不超过 `MAX_ENTRY_BYTES = 64 KiB`；超出时优先截断 `detail`，再回退到 `raw.preview`，极端情况下丢弃 `detail` 并压缩 `summary`/`title`。
- **内存限制**：应用级日志数组上限 `APP_LOG_LIMIT = 1000`，每个会话级日志桶上限 `SESSION_LOG_LIMIT = 500`，超出时按 FIFO 丢弃最旧条目。

### 3.3 路由与投递
- 写入后先存入对应内存桶，再通过 `broadcast` 双路投递：
  1. `rendererEventHub.emit('runtime:logAppended', entry)` —— SSE 推送给所有已连接客户端。
  2. `BrowserWindow.getAllWindows().forEach(win => win.webContents.send('runtime:logAppended', entry))` —— 直接 IPC 推送到所有 Electron 窗口。
- 提供 `list(scope, sessionId?)` 查询接口，供 UI 拉取历史。

### 3.4 渲染进程控制台日志
主进程对渲染进程的 `console` 输出不做结构化入库，仅通过 `webContents.on('console-message')` 转发到主进程 `console`，并在加载失败/渲染进程崩溃时打印结构化错误，便于开发调试。

## 4. 约定与约束

- **统一入口**：主进程内所有运行期日志必须通过 `runtimeLogService.log({ scope, namespace, severity, title, summary, detail?, raw?, sessionId?, projectId?, runId? })` 写入，禁止直接使用 `console.*` 作为业务日志通道。
- **命名空间选择**：日志应标注来源域——系统级用 `system`，Agent 行为用 `agent`，工具执行用 `tool`，设备/捕获相关用 `device`/`capture`，上下文与 LLM 交互分别用 `context`/`llm`。
- **严重级别**：默认 `info`；成功完成用 `success`，异常或警告用 `warning`/`error`。
- **作用域**：跨会话的全局事件用 `app`，绑定到具体会话的用 `session` 并传入 `sessionId`。
- **原始数据**：`raw` 可携带任意对象，但会被强制 JSON 序列化并参与 64 KiB 上限计算；不可序列化的对象会被替换为 `{ truncated: true, reason: 'unserializable' }`。
- **无持久化**：当前实现仅保留内存中的最近 N 条日志，重启即丢失；如需长期归档需扩展 `list` 后端或对接外部 sink。
- **测试覆盖**：`RuntimeLogService` 未提供独立单元测试文件，但其他模块（如 `ConversationRoutePreflight.test.ts`）通过 `vi.mocked(runtimeLogService.log)` 验证其被调用，间接保证 API 契约稳定。

## 5. 现状评估

该日志系统是 RDC-Agent 主进程内唯一正式的运行时日志机制，具备结构化字段、敏感信息脱敏、大小/数量双重限流和实时广播能力；但它目前仅驻留内存、不落地磁盘，也不支持按级别过滤或外部 sink 接入。对于需要持久化、聚合或告警的场景，应在现有 `RuntimeLogService` 基础上扩展持久化层或桥接到外部日志服务。