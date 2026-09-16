---
kind: error_handling
name: RDC-Agent 错误处理体系：Fail-closed 三分类 + 领域错误类型 + ErrorRecovery 恢复策略
category: error_handling
scope:
    - '**'
source_files:
    - docs/contracts/failure-model.md
    - src/main/agent-runtime/providers/internal/http.ts
    - src/main/agent-runtime/providers/internal/AssistantStreamBuilder.ts
    - src/main/agent-runtime/agent/ErrorRecovery.ts
    - src/shared/types/providerErrors.ts
    - src/main/ipc/validation/IpcPayloadGuard.ts
    - src/main/investigation/investigationErrors.ts
    - src/main/knowledge/knowledgeErrors.ts
    - src/main/agent-runtime/agent/AgentLoop.ts
---

## 1. 总体方法

仓库采用「文档契约 + 领域错误类 + 统一恢复器」的组合方式，而非单一框架。核心设计由 `docs/contracts/failure-model.md` 权威定义：**失败必须按 Security / Integrity / Availability 三类分别 fail-closed、degrade-safe、recoverable**，并禁止把可用性故障一律升级为安全拒绝、也不得把安全边界降级为“尽量继续”。代码注释约定使用 `// failure-class: security|integrity|availability` 标注意图（仅边界函数）。

## 2. 关键文件与包

- **失败模型契约**：`docs/contracts/failure-model.md`（权威分类表、provider 失败诊断保真规则、过度 fail-closed 纠正原则）
- **Provider HTTP 层错误**：`src/main/agent-runtime/providers/internal/http.ts` — 定义 `ProviderHttpError`、`ProviderTimeoutError`、`ProviderStreamBufferError`、`ProviderEmptyStreamError`、`ProviderWireFailureError`，并提供 `createResponsesStreamFailure`、`ensureOk`、`parseSSE`/`parseJsonLines` 等带超时/缓冲上限的流解析工具
- **流协议错误**：`src/main/agent-runtime/providers/internal/AssistantStreamBuilder.ts` — `ProviderStreamProtocolError`（含 `PROVIDER_STREAM_*` 诊断码），用于捕获通道碰撞、delta 早于 start、重复 block 等协议违规
- **恢复策略**：`src/main/agent-runtime/agent/ErrorRecovery.ts` — `ErrorRecovery` 类负责错误分类 (`classifyError`)、动作决策 (`decide`: retry / reactive_compact / switch_model / continue_prompt / abort)、指数退避 (`getRetryDelay`)、以及构造 `AgentRecoveryAbortError`（携带 `cause`、`category`、`attempts`、`maxAttempts`、`lastStatus`、脱敏 `bodySnippet`）
- **共享 Provider 错误类型**：`src/shared/types/providerErrors.ts` — `ProviderErrorCode` 联合类型、`ProviderErrorInfo`、`AssistantMessageDiagnostic`（随 AssistantMessage 投影到渲染层）
- **IPC 校验中间件**：`src/main/ipc/validation/IpcPayloadGuard.ts` — `IpcValidationError` + `parseIpcArgs`（Zod + JSON 字节数限制 + padTo），所有 IPC handler 必须通过它入参（fail-closed）
- **领域错误集合**：`src/main/investigation/investigationErrors.ts`（`InvestigationError` + 常量码）、`src/main/knowledge/knowledgeErrors.ts`（知识子系统多个专用错误）、`src/main/captures/adbServerClient.ts`、`src/main/runtime/ShellResolver.ts`、`src/main/sessions/storageSchema.ts`、`src/main/settings/ModelsOverrideService.ts` 等各自模块的错误类
- **Agent 循环集成点**：`src/main/agent-runtime/agent/AgentLoop.ts` 通过 `ErrorRecovery.createAbortError` 产出最终中止错误；`ConversationTurnDiagnostic` 将 provider 失败映射为用户/技术消息

## 3. 架构与约定

### 3.1 错误类型分层

| 层次 | 职责 | 示例 |
|---|---|---|
| I/O 层 | 网络/流/协议原始异常 | `ProviderHttpError`、`ProviderTimeoutError`、`ProviderStreamBufferError`、`ProviderStreamProtocolError` |
| 恢复层 | 分类 → 重试/切换模型/压缩/中止 | `ErrorRecovery.classifyError`、`decide` |
| 领域层 | 业务语义错误，带稳定 code | `InvestigationError`、`Knowledge*Error`、`IpcValidationError` |
| 共享契约 | 跨进程/渲染可见的错误码 | `ProviderErrorCode`、`AssistantMessageDiagnostic` |

### 3.2 错误传播链

- 底层抛出具体 `Error` 子类；上层用 `instanceof` 或 `isXxxError` 守卫识别
- `ErrorRecovery` 通过遍历 `error.cause` 链查找 `ProviderHttpError` / `ProviderWireFailureError`（`findProviderHttpError` / `findProviderWireFailureError`）
- 最终中止统一包装为 `AgentRecoveryAbortError`，其 `code` 根据 category 映射为 `PROVIDER_STREAM_PROTOCOL_VIOLATION` / `PROVIDER_STREAM_EMPTY` / `AGENT_RECOVERY_ABORTED`
- 用户可见诊断走 `AssistantMessageDiagnostic` 或 `diagnostic` 事件（`technicalMessage` 经 `redactTechnicalMessage` / `redactRecoverySnippet` 脱敏）

### 3.3 恢复策略（ErrorRecovery）

- 默认最大重试 3 次，`empty_stream` 仅 1 次
- 过载连续 3 次触发 `switch_model`（需配置 fallbackModel）
- prompt_too_long 先尝试 `reactive_compact`，再 `continue_prompt`，最后 abort
- 指数退避：`base = 1000 * 2^attempt` + 0–500ms jitter
- `auth_error`、`stream_protocol` 直接 abort，不重试

### 3.4 IPC 安全边界

`IpcPayloadGuard.parseIpcArgs` 强制所有 IPC 参数经 Zod schema 校验，且 JSON 序列化后默认 ≤256 KiB；违反即抛 `IpcValidationError`（fail-closed）。提供 `ipcString`、`ipcId`、`ipcStringArray` 等复用 schema 构建器。

### 3.5 领域错误模式

每个子系统集中导出错误类 + 常量码数组（如 `INVESTIGATION_ERROR_CODES`），并提供 `toXxxError(error)` 归一化函数，把第三方错误（Zod、SessionArtifactError 等）转换为领域错误，便于上层统一处理。

## 4. 约定与约束

- **Security 面必须 fail-closed**：未授权访问、secret 泄漏、权限扩大、SSRF、CSP 绕过、MCP 覆盖可执行文件等均拒绝操作，禁止静默放行
- **Integrity 面 degrade-safe**：JSONL 坏行保留可读部分并写 diagnostics；存储损坏 quarantine 但不拖垮列表；非法 `workTrace` 读边界丢弃为 null
- **Availability 面 recoverable**：瞬时网络、provider 5xx、锁竞争应重试/abort-and-join；用户取消 turn 后允许下一 turn，不把 session 标为不可信
- **Provider 失败诊断保真**：空流不得冒充真实 5xx；`AgentLoop` 不得把 provider `error` 事件 remap 为 `message_end`；最终 Work Process 只展示一条 diagnostic
- **禁止裸 `new Error('[Recovery abort]')`**：中止必须经 `ErrorRecovery.createAbortError`，始终携带 `cause` 链与结构化字段
- **代码注释约定**：边界函数处用 `// failure-class: security|integrity|availability` 标注意图
- **IPC 入参必须 `parseIpcArgs`**：这是强制的安全契约，违反即视为安全缺陷
- **流缓冲上限**：SSE/JSON Lines 解析默认 8 MiB 截断，超限抛 `ProviderStreamBufferError`（fail-closed）
- **脱敏**：recovery snippet 中 Bearer token、api_key、access_token、refresh_token、secret 会被 `redactRecoverySnippet` 替换为 `[redacted]`，长度 ≤300