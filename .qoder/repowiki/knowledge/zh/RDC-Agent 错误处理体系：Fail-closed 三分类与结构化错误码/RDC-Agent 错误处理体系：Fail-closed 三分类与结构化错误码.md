---
kind: error_handling
name: RDC-Agent 错误处理体系：Fail-closed 三分类与结构化错误码
category: error_handling
scope:
    - '**'
source_files:
    - docs/contracts/failure-model.md
    - src/main/agent-runtime/providers/internal/http.ts
    - src/main/agent-runtime/agent/ErrorRecovery.ts
    - src/main/agent-runtime/agent/LoopProgressGuard.ts
    - src/main/agent-runtime/core/ToolValidator.ts
    - src/main/investigation/investigationErrors.ts
    - src/main/knowledge/knowledgeErrors.ts
    - src/shared/types/providerErrors.ts
    - src/main/conversation/workProcessDiagnosticPolicy.ts
---

## 1. 总体方法

仓库采用 **fail-closed 三分类** 的错误语义模型（Security / Integrity / Availability），由 `docs/contracts/failure-model.md` 作为权威契约，并在代码注释中以 `// failure-class: security|integrity|availability` 标注边界函数意图。该文档把每个关键失败点归入三类并规定行为：安全类必须 fail-closed；完整性类允许 degrade-safe；可用性类应 recoverable。

在实现层面，错误通过 **自定义 Error 子类 + 字符串 code + 结构化字段** 的方式定义、传播和呈现，没有使用统一的异常基类或全局中间件框架。不同子系统各自维护自己的错误类型集合，但共享以下约定：
- 所有业务错误都继承自原生 `Error`，并通过 `name`、`code`、可选的 `details`/`cause` 携带诊断信息。
- 可恢复错误（如网络、超时、provider 5xx）通过 `ErrorRecovery` 统一分类为 `rate_limit / overloaded / prompt_too_long / max_tokens / auth_error / network_error / server_error / empty_stream / stream_protocol / unknown`，再决策 retry / switch_model / reactive_compact / abort。
- 不可恢复错误直接抛出对应 Error 子类，调用方按 code 分支处理。

## 2. 关键文件与包

- **Provider HTTP 层错误**：`src/main/agent-runtime/providers/internal/http.ts` 定义了 `ProviderHttpError`、`ProviderWireFailureError`、`ProviderEmptyStreamError`、`ProviderTimeoutError`、`ProviderStreamBufferError`，以及 `createResponsesStreamFailure`、`ensureOk`、`parseSSE`、`parseJsonLines`、`composeAbortSignals` 等流式读取工具。这些错误是 LLM provider 调用的唯一出口，向上游暴露 `status`、`bodyText`、`wireCode`、`phase`、`maxBufferBytes` 等结构化字段。
- **错误恢复策略**：`src/main/agent-runtime/agent/ErrorRecovery.ts` 提供 `ErrorRecovery` 类，集中实现 `classifyError`、`decide`、`getRetryDelay`、`createAbortError`、`redactRecoverySnippet`。它通过 `AgentRecoveryAbortError` 封装最终中止原因，保留 `cause` 链、`category`、`attempts`、`maxAttempts`、`lastStatus`、脱敏后的 `bodySnippet` 和 `streamCode`。
- **Agent 循环保护**：`src/main/agent-runtime/agent/LoopProgressGuard.ts` 定义 `AgentLoopTerminationError`（code 为 `AGENT_NO_PROGRESS` / `AGENT_MAX_TURNS_EXCEEDED`），用于检测连续三轮相同工具结果导致的死循环，并注入 `<runtime_no_progress>` 指导。
- **工具参数校验**：`src/main/agent-runtime/core/ToolValidator.ts` 实现轻量 JSON Schema 子集验证器，所有校验失败抛出 `ToolValidationError`，包含 `path`、`toolName`，并对 schema 深度、节点数、数组长度、对象键数施加硬上限，未知关键字 fail-closed。
- **领域错误类型**：
  - `src/main/investigation/investigationErrors.ts`：`InvestigationError` + `INVESTIGATION_ERROR_CODES` 常量数组，提供 `toInvestigationError` 将 ZodError / SessionArtifactError 归一化。
  - `src/main/knowledge/knowledgeErrors.ts`：`KnowledgeHumanConfirmationRequiredError`、`KnowledgeCandidateRequiresIntentError`、`KnowledgeLifecycleError`、`KnowledgeRevisionConflictError`、`KnowledgeWritePathError`、`KnowledgeWriteIntegrityError`、`KnowledgeApprovalTokenInvalidError`。
  - `src/shared/types/providerErrors.ts`：跨进程共享的 `ProviderErrorCode` 联合类型与 `ProviderErrorInfo`、`AssistantMessageDiagnostic` 接口。
- **Work Process 诊断过滤**：`src/main/conversation/workProcessDiagnosticPolicy.ts` 的 `shouldProjectDiagnosticToWorkProcess` 决定哪些 diagnostic 进入用户可见的 Work Process（过滤 `error_recovery_*`、`MODEL_THINKING_STARTED/COMPLETED`）。
- **IPC 层**：`src/main/ipc/` 下的 handler 文件通过 `runContextUsageBoundary.ts` 包装调用，捕获异常后以结构化错误返回渲染端。

## 3. 架构与约定

### 3.1 错误分类与重试矩阵

`ErrorRecovery.decide` 对错误进行优先级排序：`stopReason === 'length'` → rate_limit → overloaded → prompt_too_long → max_tokens → auth_error → empty_stream → network/server_error → stream_protocol → unknown。每种分类有明确的默认重试次数：`empty_stream` 最多 1 次，其余网络/服务器错误默认 3 次，overloaded 连续 3 次触发 `switch_model`。

### 3.2 Provider 错误保真

`http.ts` 中 `createResponsesStreamFailure` 严格区分真实 HTTP 状态（走 `ProviderHttpError`）与 wire 协议错误（走 `ProviderWireFailureError`），禁止把空流冒充 502。`ErrorRecovery` 据此映射到 `server_error` / `stream_protocol` / `empty_stream`，并由 `workProcessDiagnosticPolicy` 阻止内部 recovery chatter 泄露到 Work Process。

### 3.3 安全面 Fail-closed

- 工具参数校验：`ToolValidator` 对未知 schema 关键字、未声明字段、过深递归、过大数组/对象一律抛错，不静默降级。
- 附件/路径/执行：`failure-model.md` 明确附件脚本、可执行文件、SSRF、MCP 覆盖 user executable 等场景必须 fail-closed。
- IPC/Zod：handler 全量 `parseIpcArgs`，approvalToken 单次消费。

### 3.4 完整性 Degrade-Safe

- JSONL 坏行：记录 diagnostics 但不静默当成功；调用方 assert。
- Storage schema 损坏：quarantine + `STORAGE_CORRUPT`；未知更高 `schemaVersion` 不 quarantine。
- 历史 `workTrace` 非法置 null，读边界丢弃。

### 3.5 可用性 Recoverable

- 锁超时：`.memory.lock` / `.registry.lock` 活 pid 永不抢锁，死 pid 回收；超时抛 `MEMORY_LOCK_TIMEOUT` / `PROJECT_REGISTRY_LOCK_TIMEOUT`。
- ShutdownCoordinator 限时 shutdown，尽量排空后退出。
- Provider 网络/配额错误：按 `ErrorRecovery` 契约重试，不发明 entitlement。

## 4. 约束与规则

- **强制规则**（来自契约与实现）：
  - `AgentRecoveryAbortError` 必须经 `createAbortError` 构造，始终携带 `cause` + `category` / `attempts` / `maxAttempts` / `lastStatus?` / `bodySnippet`（脱敏 ≤300）；禁止裸 `new Error('[Recovery abort]')`。
  - Provider 请求失败须保留 cause 链与用户可区分诊断，不得把空流冒充真实 5xx，也不得把 Agent loop 停滞误报为 Provider failure。
  - ToolValidator 对未知 schema 关键字、未声明字段、过深递归一律 fail-closed。
  - `shouldProjectDiagnosticToWorkProcess` 过滤 `error_recovery_*` 与 thinking beacons，仅展示用户可见的 fail-closed diagnostic。
  - 安全类错误必须 fail-closed；完整性类允许 degrade-safe；可用性类应 recoverable——不得把可用性故障升级为安全 fail-closed，也不得把安全边界降级为“尽量继续”。
- **约定性模式**（广泛观察到的实践）：
  - 每个领域模块维护自己的 `*Errors.ts`，集中导出错误类型与 code 常量数组。
  - 错误通过 `instanceof` 与 `error.code` 双重判断进行分支处理。
  - 外部 SDK 错误通过 `findProviderHttpError` / `findProviderWireFailureError` 沿 `cause` 链查找后再分类。
  - 测试用例通过给 error 附加 `code` 字段模拟 provider 协议错误（见 `ErrorRecovery.test.ts`）。

## 5. 适用性说明

本仓库不存在全局异常中间件或单一错误基类，而是围绕 `failure-model.md` 契约在各子系统内建立结构化的错误类型、分类与恢复策略。该体系在 agent-runtime、conversation、investigation、knowledge、providers 等多个模块中一致出现，属于仓库级已落地的错误处理系统。