---
kind: error_handling
name: RDC-Agent 错误处理体系：三分类失败模型与领域错误类型
category: error_handling
scope:
    - '**'
source_files:
    - docs/contracts/failure-model.md
    - src/main/agent-runtime/agent/ErrorRecovery.ts
    - src/main/agent-runtime/providers/internal/http.ts
    - src/main/investigation/investigationErrors.ts
    - src/main/knowledge/knowledgeErrors.ts
    - src/main/ipc/validation/IpcPayloadGuard.ts
    - src/shared/types/captureReplay.ts
    - src/shared/types/delegationCapsule.ts
---

## 1. 总体方案

仓库采用「文档驱动 + 领域 Error 类 + 统一恢复策略」的错误处理体系，核心依据是 `docs/contracts/failure-model.md` 定义的 **fail-closed 三分类**（Security / Integrity / Availability），并在代码中通过专用 Error 子类、常量 code 枚举和集中式恢复器实现。

- **安全类（Security）**：必须 fail-closed，禁止静默放行或降级（如 IPC Zod 校验失败、未授权访问、secret 明文）。
- **完整性类（Integrity）**：允许 degrade-safe，保留可验证子集并写 diagnostics，禁止静默丢历史当成功。
- **可用性类（Availability）**：应 recoverable，支持重试、abort-and-join、释放 lease，不得因短暂不可用永久锁死用户数据。

该分类在关键边界函数处通过注释 `// failure-class: security|integrity|availability` 标注意图（见 failure-model.md §7 及测试约定）。

## 2. 关键文件与包

| 文件 | 职责 |
|---|---|
| `docs/contracts/failure-model.md` | 权威失败分类契约，定义三类语义、Provider 诊断保真规则、Agent loop 约束 |
| `src/main/agent-runtime/agent/ErrorRecovery.ts` | LLM 调用错误分类与恢复策略（retry / switch_model / reactive_compact / abort），含 `AgentRecoveryAbortError` |
| `src/main/agent-runtime/providers/internal/http.ts` | Provider HTTP/SSE 层错误类型：`ProviderHttpError`、`ProviderWireFailureError`、`ProviderEmptyStreamError`、`ProviderTimeoutError`、`ProviderStreamBufferError` |
| `src/main/investigation/investigationErrors.ts` | Investigation 领域错误：`InvestigationError` + `INVESTIGATION_ERROR_CODES` 白名单 + `toInvestigationError` 归一化 |
| `src/main/knowledge/knowledgeErrors.ts` | Knowledge 领域错误族：`KnowledgeHumanConfirmationRequiredError`、`KnowledgeWritePathError` 等，每个带固定 `code` |
| `src/main/ipc/validation/IpcPayloadGuard.ts` | IPC 入参 Zod 校验中间件，强制 fail-closed，抛出 `IpcValidationError` |
| `src/shared/types/captureReplay.ts` | 跨进程共享的 `CaptureReplayError { code, message, retry }` 结构 |
| `src/shared/types/delegationCapsule.ts` | 共享常量 `DELEGATION_CAPSULE_ERROR` 用于跨进程错误码 |

## 3. 架构与约定

### 3.1 领域错误类模式
每个子系统维护自己的 Error 子类，统一携带 `code` 字符串常量，便于上层按 code 分支处理：
- `InvestigationError` 使用集中 `INVESTIGATION_ERROR_CODES` 白名单，并提供 `toInvestigationError` 将 ZodError / SessionArtifactError 归一化为统一类型；提供 `isInvestigationStoreDegraded` 判定降级态。
- `knowledgeErrors.ts` 中每个错误类自带固定 `code`（如 `KNOWLEDGE_HUMAN_CONFIRMATION_REQUIRED`、`KNOWLEDGE_WRITE_PATH_REJECTED`），构造时把 code 拼入 message。
- `ipc/validation/IpcPayloadGuard.ts` 的 `IpcValidationError` 同样带 `IPC_VALIDATION_ERROR` code。

### 3.2 Provider 网络错误分层
`providers/internal/http.ts` 将外部异常细分为四类，严格区分真实 HTTP 状态与 wire 协议错误：
- `ProviderHttpError`：真实 4xx/5xx，携带 `status`、`providerApi`、可选 `bodyText`。
- `ProviderWireFailureError`：OpenAI/Azure Responses SSE `error`/`response.failed` 且无明确 status 时，携带 `wireCode`、`bodyText`。
- `ProviderEmptyStreamError`：流结束但无 assistant 正文或 structured tool call，`code = 'PROVIDER_STREAM_EMPTY'`，**禁止合成 HTTP 502**。
- `ProviderTimeoutError` / `ProviderStreamBufferError`：超时与缓冲超限（默认 8MiB fail-closed）。

`createResponsesStreamFailure` 根据是否含显式 status 决定返回 `ProviderHttpError` 还是 `ProviderWireFailureError`，保证诊断保真。

### 3.3 错误恢复策略集中化
`ErrorRecovery` 是纯逻辑模块，不直接执行重试，只输出 `RecoveryAction`：
- 分类维度：`rate_limit`、`overloaded`、`prompt_too_long`、`max_tokens`、`auth_error`、`network_error`、`server_error`、`empty_stream`、`stream_protocol`、`unknown`。
- 动作：`retry`（指数退避 + 抖动）、`reactive_compact`、`switch_model`（连续过载阈值后切换 fallbackModel）、`continue_prompt`、`abort`。
- 上限：`empty_stream` 最多重试 1 次，`server_error`/`network_error`/`rate_limit` 最多 `maxRetries`（默认 3），`overloaded` 达到阈值后尝试切换模型。
- 中止错误：必须经 `createAbortError` 构造 `AgentRecoveryAbortError`，始终携带 `cause` 链、`category`、`attempts`、`maxAttempts`、`lastStatus`、脱敏后的 `bodySnippet`（≤300 字符，自动去除 Bearer/token）。

`AgentLoop` 通过 `error_recovery_${action.type}` 事件码上报恢复决策，最终失败以一条 diagnostic 呈现，`error_recovery_*` 本身不进 Work Process。

### 3.4 IPC 安全边界
所有 IPC handler 必须通过 `parseIpcArgs(schema, args)` 校验参数，默认限制 256 KiB JSON 序列化大小，Zod 校验失败抛 `IpcValidationError`（fail-closed）。提供 `ipcString`、`ipcId`、`ipcStringArray` 等预置 schema 构建器，对路径穿越字符做正则过滤。

### 3.5 跨进程错误传播
共享类型位于 `src/shared/types/`，如 `CaptureReplayError` 包含 `{ code, message, retry }`，`DELEGATION_CAPSULE_ERROR` 作为跨进程错误码常量。主进程错误通过 IPC 映射为渲染端可见的诊断消息，由 `ConversationTurnDiagnostic` 按 cause 分类生成 `userMessage`（auth/quota-rate/overloaded/real 5xx/empty_stream/network）与固定格式 `technicalMessage`。

## 4. 约定与约束

- **禁止裸 `new Error('[Recovery abort]')`**：必须经 `ErrorRecovery.createAbortError` 构造，否则无法携带 cause/category/attempts。
- **禁止把 provider error 事件 remap 为 `message_end`**：`AgentLoop` 不得混淆错误与正常完成。
- **空流不得冒充 HTTP 502**：`ProviderEmptyStreamError` 保持独立语义。
- **IPC 必须 fail-closed**：任何未通过 Zod 校验的 payload 立即拒绝，不允许静默忽略。
- **存储损坏走 quarantine + `STORAGE_CORRUPT`**：单条 JSONL 损坏仅报告 diagnostics，全文件不可读才抛文件级错误。
- **Provider 配额错误（429 与明确 quota_exceeded 的 402）只记录短期 quota**，不得发明 entitlement 错误。
- **User Stop / abortAndJoin 属于 Availability**：join producers 后丢弃迟到 event，不把 session 标为不可信。
- **代码注释应使用 `// failure-class: security|integrity|availability`** 标注意图（仅在边界函数处）。
- **测试覆盖**：`ErrorRecovery.test.ts`、`ConversationTurnDiagnostic.test.ts`、`providers/internal/http.test.ts`、`securityContract.test.ts`、`storageFaultContract.test.ts` 等构成契约验证矩阵。

## 5. 适用性说明

本仓库存在完整、成体系的错误处理机制：明确的失败分类契约、多领域 Error 子类、集中式 ErrorRecovery、IPC 安全中间件、Provider 网络错误分层以及跨进程共享错误类型，因此该类别完全适用。