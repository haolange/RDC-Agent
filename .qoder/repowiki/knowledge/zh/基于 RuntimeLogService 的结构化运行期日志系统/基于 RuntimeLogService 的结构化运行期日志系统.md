---
kind: logging_system
name: 基于 RuntimeLogService 的结构化运行期日志系统
category: logging_system
scope:
    - '**'
source_files:
    - src/main/runtime/RuntimeLogService.ts
    - src/shared/types/runtimeLog.ts
    - src/main/index.ts
    - src/main/captures/ReplayDeviceService.ts
    - src/main/conversation/ConversationRoutePreflight.ts
    - src/main/conversation/ConversationTurnRunner.ts
    - src/main/ipc/captureDeviceHandlers.ts
    - src/main/ipc/knowledgeHandlers.ts
    - src/main/ipc/memoryHandlers.ts
    - src/main/ipc/planHandlers.ts
    - src/main/ipc/projectInputLifecycleHandlers.ts
    - src/main/ipc/settingsLlmHandlers.ts
    - src/main/ipc/workbenchHandlers.ts
    - src/main/sessions/RdxSessionRuntime.ts
    - src/main/settings/oauth/grokAccountOAuth.ts
    - src/main/workflow/debugger/AgentOrchestrator.ts
    - src/main/browserAppBridge/rendererEventHub.ts
---

## 1. 使用的系统与方案

RDC-Agent 未引入第三方日志框架（如 winston、pino、bunyan），而是自实现了一个轻量级的结构化运行期日志服务 `RuntimeLogService`，位于 `src/main/runtime/RuntimeLogService.ts`。日志以结构化的 `RuntimeLogEntry` 对象形式在 Electron main 进程内维护，并通过 IPC / RendererEventHub 实时广播到渲染进程进行展示。

- **日志框架**：无外部依赖，纯 TypeScript 实现。
- **日志级别**：`info | success | warning | error`（见 `src/shared/types/runtimeLog.ts`）。
- **作用域与命名空间**：通过 `scope: 'app' | 'session'` 和 `namespace: 'system' | 'agent' | 'tool' | 'device' | 'capture' | 'context' | 'llm'` 两个维度对日志进行分类。
- **输出目标**：内存环形缓冲区 + 渲染进程 UI（通过 `rendererEventHub.emit('runtime:logAppended', entry)` 及 `BrowserWindow.webContents.send('runtime:logAppended', entry)` 推送）。

## 2. 关键文件与包

| 文件 | 职责 |
|---|---|
| `src/main/runtime/RuntimeLogService.ts` | 日志服务核心：构造条目、字段裁剪/截断、敏感信息脱敏、内存缓存、广播 |
| `src/shared/types/runtimeLog.ts` | 跨进程共享的日志类型定义（`RuntimeLogScope` / `Namespace` / `Severity` / `DetailLevel` / `RuntimeLogEntry`） |
| `src/main/index.ts` | 应用入口，多处调用 `runtimeLogService.log` 记录启动、打开文件等生命周期事件 |
| `src/main/captures/ReplayDeviceService.ts` | 设备回放场景下的日志埋点示例 |
| `src/main/conversation/*.ts` | 会话流程中的路由预检、Turn 执行等关键路径日志 |
| `src/main/ipc/*Handlers.ts` | IPC 处理器中针对 capture/knowledge/memory/plan/workbench 等操作的日志记录 |
| `src/main/sessions/RdxSessionRuntime.ts` | 会话级日志（`scope: 'session'`） |
| `src/main/settings/oauth/grokAccountOAuth.ts` | OAuth 流程中的认证相关日志 |
| `src/main/workflow/debugger/AgentOrchestrator.ts` | Agent 编排过程中的调试日志 |
| `src/main/browserAppBridge/rendererEventHub.ts` | 向渲染进程广播日志事件的通道 |

## 3. 架构与约定

### 3.1 单例服务 + 内存缓冲
`RuntimeLogService` 以模块级单例 `runtimeLogService` 暴露，内部维护：
- `appEntries: RuntimeLogEntry[]`：应用级日志，上限 `APP_LOG_LIMIT = 1000`；
- `sessionEntries: Map<sessionId, RuntimeLogEntry[]>`：按 session 分桶的会话级日志，上限 `SESSION_LOG_LIMIT = 500`。
超出限制时采用 FIFO 丢弃（`pushWithLimit` 使用 `splice(0, length - limit)`）。

### 3.2 结构化字段模型
每条日志必须包含：
- `id`：通过 `generateEventId('rlog')` 生成；
- `timestamp`：默认 `nowMs()`；
- `scope` / `namespace` / `severity`：分类三要素；
- `title` / `summary` / `detail`：面向人类阅读的三段式文本；
- `sessionId` / `projectId` / `runId`：可选关联上下文；
- `raw`：原始数据，可被深度脱敏后序列化。

### 3.3 安全与体积约束
- **敏感信息脱敏**：`title` / `summary` / `detail` 经 `redactCredentialLikeText` 处理；`raw` 经 `redactSecretsDeep(raw, 'raw')` 递归脱敏。
- **字段截断**：`title` ≤ 4KB、`summary` ≤ 8KB、`detail` ≤ 16KB，均按 UTF-8 字节数截断并追加 `…[truncated]`。
- **单条硬上限**：`MAX_ENTRY_BYTES = 64 * 1024`（64KB）。若 JSON 序列化后仍超限，会逐步回退：先截断 `detail`，再替换 `raw` 为 `{ truncated: true }`，最后进一步压缩 `summary` / `title`。

### 3.4 渲染进程投递
日志通过两条通道同步到渲染端：
1. `rendererEventHub.emit('runtime:logAppended', entry)` —— 事件总线方式；
2. 遍历所有 `BrowserWindow`，调用 `webContents.send('runtime:logAppended', entry)` —— 直接 IPC 推送。

### 3.5 消费方约定
各子系统统一通过 `import { runtimeLogService } from '../runtime/RuntimeLogService'` 获取实例，并以完整字面量调用 `log({ scope, namespace, severity, title, summary, ... })`。测试中通过 `vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }))` 进行替换。

## 4. 约定与约束

- **禁止直接使用 console 作为业务日志**：main 进程中业务日志统一走 `runtimeLogService.log`；仅 Electron 自身事件（如 `console-message`、`did-fail-load`、`render-process-gone`）仍用 `console.log/error` 打印到 Node 控制台。
- **日志必须带 scope 与 namespace**：所有调用处均显式传入这两个字段，用于前端筛选与聚合。
- **raw 字段需可序列化**：`clampEntryFields` 会尝试 `JSON.stringify(raw)`，失败时替换为 `{ truncated: true, reason: 'unserializable' }`。
- **不持久化到磁盘**：当前实现仅为内存缓冲 + 实时广播，没有落盘或远程上报逻辑（遥测由独立的 `telemetry/SentryService.ts` 负责）。
- **测试隔离**：单元测试通过 mock `runtimeLogService` 避免真实日志写入，验证日志是否按预期产生。