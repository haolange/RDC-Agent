---
kind: error_handling
name: RDC-Agent 错误处理体系：分层领域错误、Provider 失败分类与 fail-closed 契约
category: error_handling
scope:
    - '**'
source_files:
    - docs/contracts/failure-model.md
    - src/shared/types/providerErrors.ts
    - src/shared/types/sessionArtifact.ts
    - src/shared/types/runtimeLog.ts
    - src/main/agent-runtime/providers/internal/http.ts
    - src/main/agent-runtime/providers/OpenAICompatibleProvider.ts
    - src/main/investigation/investigationErrors.ts
    - src/main/knowledge/knowledgeErrors.ts
    - src/main/ipc/workbenchHandlers.ts
    - src/main/agent-runtime/core/types.ts
---

## 1. 总体方法

仓库采用「领域错误类型 + 共享错误码枚举 + 失败分类契约」三层结构，将错误分为 Security（fail-closed）、Integrity（degrade-safe）和 Availability（recoverable）三类，并通过文档 `docs/contracts/failure-model.md` 作为权威裁决约束各模块的抛错与降级策略。所有跨进程（IPC / Renderer / Agent Runtime）边界均使用结构化错误信息而非裸字符串。

## 2. 核心文件与包

- **共享错误模型**
  - `src/shared/types/providerErrors.ts`：定义 `ProviderErrorCode`（如 `auth_expired`、`rate_limit`、`context_overflow`、`stream_protocol`、`aborted` 等）与 `ProviderErrorInfo`、`AssistantMessageDiagnostic`，是 LLM Provider 层对外暴露的统一错误形态。
  - `src/shared/types/sessionArtifact.ts`：定义 `SESSION_ARTIFACT_ERROR_CODES` 常量数组及 `SessionArtifactError` 类，用于 session artifact 读写路径的安全校验（URI 解析、MIME 白名单、配额、符号链接拒绝等）。
  - `src/shared/types/runtimeLog.ts`：定义 `RuntimeLogSeverity`（`info | success | warning | error`）与 `RuntimeLogEntry`，作为运行时日志/诊断的通用载体。

- **Agent Runtime Provider 网络层**
  - `src/main/agent-runtime/providers/internal/http.ts`：集中定义 `ProviderHttpError`、`ProviderTimeoutError`、`ProviderStreamBufferError`、`ProviderEmptyStreamError`、`ProviderWireFailureError` 以及 `ensureOk`、`parseSSE`、`parseJsonLines`、`composeAbortSignals`、`normalizeError`、`createResponsesStreamFailure` 等工具；所有 HTTP/SSE 异常都归一化为这些类型。
  - `src/main/agent-runtime/providers/OpenAICompatibleProvider.ts`、`AnthropicProvider.ts`、`GeminiProvider.ts`、`OllamaProvider.ts` 等具体 Provider 通过 `EventStream` + `AssistantStreamBuilder` 消费上述工具，并在流结束无输出时抛出 `ProviderEmptyStreamError`。

- **领域错误（按子系统隔离）**
  - `src/main/investigation/investigationErrors.ts`：`INVESTIGATION_ERROR_CODES` 常量数组 + `InvestigationError` 类 + `toInvestigationError` 转换器（把 `ZodError`、`SessionArtifactError` 等统一收敛为 Investigation 领域错误）+ `isInvestigationStoreDegraded` 退化判断。
  - `src/main/knowledge/knowledgeErrors.ts`：一组细粒度 `Knowledge*Error`（`KnowledgeHumanConfirmationRequiredError`、`KnowledgeCandidateRequiresIntentError`、`KnowledgeLifecycleError`、`KnowledgeRevisionConflictError`、`KnowledgeWritePathError`、`KnowledgeWriteIntegrityError`、`KnowledgeApprovalTokenInvalidError`、`KnowledgeDraftMigrationConflictError`），每个都有固定 `code` 常量，用于权限、意图、并发冲突与完整性校验。

- **IPC 与主进程入口**
  - `src/main/ipc/workbenchHandlers.ts`：在初始化阶段对存储读取做 try/catch 并降级为 null，体现 availability 错误的“尽量继续”策略。
  - `src/main/ipc/handlers.ts`：仅导出 IPC 注册入口，错误处理下沉到各 handler 子模块。

- **契约文档**
  - `docs/contracts/failure-model.md`：明确三类失败语义、Provider 错误分类（empty_stream / server_error / overloaded / auth_error / stream_protocol）、重试上限、Turn 失败诊断格式，以及“不得把空流冒充真实 5xx”“不得把 Agent loop 停滞误报为 Provider failure”等硬性约束。

## 3. 架构与约定

### 3.1 错误类型设计
- 每个领域维护自己的 `XxxError extends Error` 子类，并附带只读 `code` 字段（字符串常量），便于上层 switch 或 UI 展示。
- 错误消息统一遵循 `CODE: message` 格式（例如 `ARTIFACT_URI_INVALID: URI is empty.`、`KNOWLEDGE_REVISION_CONFLICT: ...`），保证机器可读性。
- 跨领域转换通过专用函数完成，如 `toInvestigationError` 把 `ZodError`、`SessionArtifactError` 映射为 `InvestigationError`，避免污染调用方逻辑。

### 3.2 Provider 层错误分类
- `ProviderHttpError`：真实 HTTP 4xx/5xx，携带 `status`、`providerApi`、可选 `bodyText`。
- `ProviderWireFailureError`：SSE `error`/`response.failed` 事件但无 400–599 status，保留 wire-level `code` 与脱敏 body。
- `ProviderEmptyStreamError`：流结束但未产出 assistant 正文或 structured tool call，标记 `PROVIDER_STREAM_EMPTY`，禁止合成 502。
- `ProviderTimeoutError`：分 `first-byte` / `idle` / `total` 三阶段超时，携带 `timeoutMs`。
- `ProviderStreamBufferError`：SSE/JSONL 缓冲超过 8MiB 硬截断，属于 Integrity fail-closed。

### 3.3 失败分类契约（Security / Integrity / Availability）
- **Security**：未授权访问、secret 泄漏、SSRF、路径逃逸、approvalToken 重放等必须 fail-closed，禁止静默放行。
- **Integrity**：损坏记录、schema 不匹配、上下文装不下等可 degrade-safe，保留可信子集并写 diagnostics，禁止静默当成功。
- **Availability**：瞬时网络、provider 5xx、用户取消、锁竞争等应 recoverable，允许重试或 abort-and-join，不应永久锁死数据。

### 3.4 流式错误传播
- 通过 `EventStream<AssistantMessageEvent, AssistantMessage>` 与 `AssistantMessageEvent` 联合类型中的 `{ type: 'error'; error; message }` 事件传递底层异常。
- `AssistantMessage` 上附加 `diagnostics?: AssistantMessageDiagnostic[]`，把 provider 错误以结构化条目挂到消息上，供 UI 与追踪系统消费。
- `StopReason` 包含 `'error'` 与 `'aborted'`，区分业务错误与用户取消。

### 3.5 重试与恢复
- 依据 `failure-model.md` 的分类：`empty_stream` 最多重试 1 次后 abort；`server_error` 最多 3 次；`overloaded`（503/529 或文案含 at capacity/high demand/overloaded/service unavailable）走 `switch_model` 路径；`auth_error`（401/403）立即 abort；`stream_protocol` 不重试。
- 恢复中止需经 `createAbortError` 构造 `AgentRecoveryAbortError`，携带 `cause`、`category`、`attempts`、`maxAttempts`、`lastStatus?`、`bodySnippet`（脱敏 ≤300）。

## 4. 约定与约束

- **禁止裸 throw**：所有已知错误必须封装为领域错误类或 Provider 错误类，再向上抛出；未知错误用 `normalizeError` 转为 `Error`。
- **禁止静默吞错**：availability 错误可 catch 并降级（如 IPC 初始化失败置 null），但 security/integrity 错误必须显式拒绝或上报。
- **错误码闭集**：各领域的错误码均以 `as const` 数组声明（如 `INVESTIGATION_ERROR_CODES`、`SESSION_ARTIFACT_ERROR_CODES`），新增错误必须加入数组，否则 TypeScript 编译期报错。
- **诊断保真**：Provider 失败必须保留 cause 链与用户可区分诊断，不得把空流冒充真实 5xx，不得把 Agent loop 停滞误报为 Provider failure。
- **代码注释标注**：边界函数处应使用 `// failure-class: security|integrity|availability` 标注意图，便于审计与自动化检查。
- **IPC 安全**：所有 handler 入参经 Zod 校验，非法 payload 视为 security 失败；approvalToken 单次消费防重放。
- **资源限制**：session artifact 对 MIME、大小、配额、路径逃逸严格校验，违反即抛 `SessionArtifactError`；SSE 缓冲超限 8MiB 直接 fail-closed。

## 5. 关键文件清单

- `docs/contracts/failure-model.md`
- `src/shared/types/providerErrors.ts`
- `src/shared/types/sessionArtifact.ts`
- `src/shared/types/runtimeLog.ts`
- `src/main/agent-runtime/providers/internal/http.ts`
- `src/main/agent-runtime/providers/OpenAICompatibleProvider.ts`
- `src/main/investigation/investigationErrors.ts`
- `src/main/knowledge/knowledgeErrors.ts`
- `src/main/ipc/workbenchHandlers.ts`
- `src/main/agent-runtime/core/types.ts`