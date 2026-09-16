---
kind: error_handling
name: RDC-Agent 错误处理体系：Fail-closed 三分类 + 领域错误类型 + Provider 恢复策略
category: error_handling
scope:
    - '**'
source_files:
    - docs/contracts/failure-model.md
    - src/shared/types/providerErrors.ts
    - src/main/agent-runtime/agent/ErrorRecovery.ts
    - src/main/agent-runtime/providers/internal/http.ts
    - src/main/investigation/investigationErrors.ts
    - src/main/knowledge/knowledgeErrors.ts
    - src/main/settings/providerConnectionErrors.ts
    - src/main/conversation/workProcessDiagnosticPolicy.ts
    - src/renderer/lib/serviceErrorMessage.ts
    - src/main/ipc/validation/IpcPayloadGuard.ts
    - src/main/runtime/ShellResolver.ts
    - src/main/sessions/storageSchema.ts
    - src/main/captures/adbServerClient.ts
---

## 1. 总体方法

仓库采用 **结构化错误类型 + 领域错误码 + 可恢复性分类** 的组合方式，而非统一异常基类或全局错误中间件。核心设计约束来自 `docs/contracts/failure-model.md` 的「Fail-closed 三分类」权威裁决：
- **Security fail-closed**：威胁面（未授权、secret 泄漏、权限扩大、SSRF、任意代码执行等）必须拒绝操作/连接/启动，禁止静默放行。
- **Integrity degrade-safe**：损坏记录、schema 不匹配等应保留可验证子集、写 diagnostics，禁止静默丢历史当成功。
- **Availability recoverable**：瞬时网络、provider 5xx、超时、取消等应重试/abort-and-join/释放 lease，不应永久锁死用户数据。

该文档还规定边界函数注释使用 `// failure-class: security|integrity|availability` 标注意图，作为约定式约束。

## 2. 关键文件与包

### 共享契约层
- `src/shared/types/providerErrors.ts`：定义 LLM HAL 错误模型 `ProviderErrorCode`（`auth_unconfigured` / `rate_limit` / `quota_exceeded` / `network` / `timeout` / `context_overflow` / `stream_protocol` / `aborted` 等）、`ProviderErrorInfo` 以及 `AssistantMessageDiagnostic`，是跨进程共享的错误数据结构。

### Agent Runtime 错误恢复
- `src/main/agent-runtime/agent/ErrorRecovery.ts`：集中实现 `ErrorCategory`（`rate_limit` / `overloaded` / `prompt_too_long` / `max_tokens` / `auth_error` / `network_error` / `server_error` / `empty_stream` / `stream_protocol` / `unknown`），通过 `classifyError` → `decide` 输出 `Retry` / `reactive_compact` / `switch_model` / `continue_prompt` / `Abort` 动作；`AgentRecoveryAbortError` 强制携带 `cause`、`category`、`attempts`、`maxAttempts`、`lastStatus`、脱敏后的 `bodySnippet`（≤300 字符，经 `redactRecoverySnippet` 过滤 Bearer/token）。`getMaxAttempts` 对 `empty_stream` 给 2 次尝试，`network_error/server_error/rate_limit` 给 `maxRetries+1`，其余仅 1 次。
- `src/main/agent-runtime/providers/internal/http.ts`：Provider 网络层错误类型——`ProviderStreamBufferError`（8 MiB fail-closed 截断）、`ProviderTimeoutError`（分 first-byte/idle/total 阶段）、`ProviderHttpError`（真实 HTTP 4xx/5xx）、`ProviderEmptyStreamError`（code=`PROVIDER_STREAM_EMPTY`）、`ProviderWireFailureError`（SSE `error`/`response.failed` 无 status 时）。`createResponsesStreamFailure` 仅在显式 status 时返回 `ProviderHttpError`，否则返回 `ProviderWireFailureError`，禁止把空流冒充 502。

### 领域错误类型
- `src/main/investigation/investigationErrors.ts`：`InvestigationError` + `INVESTIGATION_ERROR_CODES` 常量数组 + `toInvestigationError` 将 ZodError/SessionArtifactError 归一化，`isInvestigationStoreDegraded` 判定降级态。
- `src/main/knowledge/knowledgeErrors.ts`：按知识子系统划分的专用错误（`KnowledgeHumanConfirmationRequiredError` / `KnowledgeCandidateRequiresIntentError` / `KnowledgeLifecycleError` / `KnowledgeRevisionConflictError` / `KnowledgeWritePathError` / `KnowledgeWriteIntegrityError` / `KnowledgeApprovalTokenInvalidError`），每个都有固定 `code` 和语义化 message。
- `src/main/settings/providerConnectionErrors.ts`：`ProviderConnectionError` + `parseProviderError` 将 DOMException AbortError 映射为中文提示。
- `src/main/runtime/ShellResolver.ts`：`ShellUnavailableError` 表示系统 shell 不可用。
- `src/main/sessions/storageSchema.ts`：`StorageSchemaError` 用于存储 schema 不兼容。
- `src/main/captures/adbServerClient.ts`：`AdbServerUnreachableError` / `AdbServerProtocolError`。
- `src/main/ipc/validation/IpcPayloadGuard.ts`：`IpcValidationError` 用于 IPC payload 校验失败。

### 诊断投影与 UI 呈现
- `src/main/conversation/workProcessDiagnosticPolicy.ts`：Work Process 叙事层只暴露 fail-closed 诊断，过滤 `MODEL_THINKING_STARTED/COMPLETED` 与 `error_recovery_*` 内部噪音。
- `src/renderer/lib/serviceErrorMessage.ts`：渲染层统一的错误消息提取器，优先取 `message`，其次 `code`，最后 `String(error)`。

## 3. 架构与约定

1. **错误类型分层**：底层网络/Provider 错误（`http.ts`）→ Agent 恢复层（`ErrorRecovery.ts`）→ 领域错误（`investigationErrors.ts`、`knowledgeErrors.ts`）→ 共享契约（`providerErrors.ts`）→ UI 展示（`serviceErrorMessage.ts`）。每层只做必要转换，不吞掉 cause 链。
2. **错误码枚举化**：领域错误通过 `as const` 字符串数组（如 `INVESTIGATION_ERROR_CODES`）或固定 `code` 字段声明，便于类型推断与测试断言。
3. **恢复策略集中化**：所有 LLM 调用异常先经 `ErrorRecovery.classifyError` 分类，再按优先级（rate_limit → overloaded → prompt_too_long → max_tokens → auth_error → network_error → server_error）决定 retry/compact/switch_model/abort，避免散落 if-else。
4. **安全脱敏**：`redactRecoverySnippet` 在构造 `AgentRecoveryAbortError` 时自动剥离 Bearer token、api_key、access_token、refresh_token、secret 等敏感片段，并截断至 300 字符。
5. **IPC 输入校验**：所有 handler 入口使用 `parseIpcArgs`（Zod 校验），非法 payload 抛出 `IpcValidationError`，属于 Security fail-closed 点。
6. **工作进程投影隔离**：`shouldProjectDiagnosticToWorkProcess` 确保自动恢复过程（`error_recovery_*`）和 thinking beacon 不出现在用户可见的 Work Process 中，仅最终 diagnostic 可见。
7. **Provider 失败保真**：禁止把空流合成 HTTP 502；`AgentLoop` 不得把 provider `error` 事件 remap 为 `message_end`；`AgentTurnRunner` 在 `stopReason === 'error'` 时跳过 `empty_response_without_tool_call` 路径。

## 4. 约定与约束

- **fail-closed 三分类**（`docs/contracts/failure-model.md`）是权威规则：安全类必须 fail-closed；完整性类允许 degrade-safe；可用性类应 recoverable。不得把可用性故障一律升级为安全 fail-closed，也不得把安全边界降级为“尽量继续”。
- **错误注释约定**：边界函数处使用 `// failure-class: security|integrity|availability` 标注意图。
- **错误构造约束**：`AgentRecoveryAbortError` 必须经 `createAbortError` 构造，始终携带 `cause` + `category` / `attempts` / `maxAttempts` / `lastStatus?` / `bodySnippet`（脱敏 ≤300）；禁止裸 `new Error('[Recovery abort]')`。
- **Provider 错误分类**：`empty_stream` 最多重试 1 次后 abort，不归入 `server_error`；`auth_error`（401/403）立即 abort；`stream_protocol` 不重试；`overloaded`（503/529 或文案含 at capacity/high demand/overloaded/service unavailable）走 `switch_model` 路径。
- **Work Process 诊断过滤**：`error_recovery_*` 与 thinking 相关 code 不投影到用户界面。
- **IPC 全量校验**：handler 入口必须 `parseIpcArgs`，approvalToken 单次消费，防止重放。
- **存储降级检测**：`isInvestigationStoreDegraded` 统一识别 `DEGRADED` / `INDEX_CORRUPT` / `INDEX_MISSING` 三类降级状态。
- **附件/捕获失败分阶段**：Open 失败、图片获取失败、设备显示不支持、Close 未确认分别投影；Remote `unsupported` 是能力边界不能投影为成功。

该体系没有使用 try/catch 中间件或全局 unhandled rejection 处理器来统一拦截错误，而是通过明确的错误类型、错误码和恢复策略模块在各层边界显式处理，配合文档化的 fail-closed 分类保证一致行为。