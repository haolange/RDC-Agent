---
kind: error_handling
name: RDC-Agent 错误处理体系：Provider 错误分类、流式协议校验与诊断透传
category: error_handling
scope:
    - '**'
source_files:
    - src/shared/types/providerErrors.ts
    - src/main/agent-runtime/providers/internal/http.ts
    - src/main/agent-runtime/providers/internal/errorClassifier.ts
    - src/main/agent-runtime/providers/internal/AssistantStreamBuilder.ts
    - src/main/agent-runtime/providers/AiSdkStreamingProvider.ts
    - src/main/agent-runtime/providers/ConfiguredRuntimeProvider.ts
    - src/main/agent-runtime/core/types.ts
---

## 1. 整体方案

RDC-Agent 的错误处理围绕 **LLM Provider 调用** 这一核心边界构建，采用「结构化错误类型 + 统一分类器 + 流式事件 + 诊断附件」的分层模式：

- **共享契约层** `src/shared/types/providerErrors.ts` 定义了跨进程可见的标准化错误模型 `ProviderErrorCode`（`provider_unknown | auth_unconfigured | auth_expired | auth_scope_denied | model_source | rate_limit | quota_exceeded | network | timeout | context_overflow | stream_protocol | aborted | unknown`）和 `ProviderErrorInfo`（含 `code / retryable / httpStatus / message / details`），以及用于附加到助手消息的 `AssistantMessageDiagnostic`。
- **运行时内部** 在 `src/main/agent-runtime/providers/internal/http.ts` 中定义了一组领域错误类：`ProviderStreamBufferError`、`ProviderTimeoutError`、`ProviderHttpError`、`ProviderEmptyStreamError`、`ProviderWireFailureError`，每个都携带 `providerApi` 等上下文字段，便于上层按来源区分。
- **纯函数分类器** `src/main/agent-runtime/providers/internal/errorClassifier.ts` 的 `classifyProviderError(error, httpStatus?)` 将任意未知错误归一化为 `ProviderErrorInfo`，规则包括：Abort 检测 → provider 不存在 → HTTP 状态码映射（401/403/429/5xx/404/400）→ 消息模式匹配（rate limit / network error / timeout / quota exceeded / context overflow / stream protocol）→ 兜底 `unknown`。同时提供 `isRetryableAssistantError(message)` 基于 `diagnostics` 判断是否可重试。
- **流式协议校验** 通过 `AssistantStreamBuilder`（`src/main/agent-runtime/providers/internal/AssistantStreamBuilder.ts`）维护 text / thinking / tool_call 三类 block 的生命周期，任何违反 start/delta/end 顺序、重复声明、通道冲突或终端后事件的行为都会抛出 `ProviderStreamProtocolError`（带 `PROVIDER_STREAM_CHANNEL_COLLISION`、`PROVIDER_STREAM_DELTA_BEFORE_START`、`PROVIDER_STREAM_DUPLICATE_BLOCK_START`、`PROVIDER_STREAM_BLOCK_CLOSED`、`PROVIDER_STREAM_EVENT_AFTER_TERMINAL` 等诊断码）。
- **IPC/渲染层** 不直接消费内部 Error 对象，而是通过 `EventStream<AssistantMessageEvent, AssistantMessage>` 推送 `{ type: 'error', error, message }` 事件，并在最终 `AssistantMessage` 上附带 `diagnostics?: AssistantMessageDiagnostic[]` 供 UI 展示。

## 2. 关键文件与位置

| 职责 | 文件路径 |
|---|---|
| 共享错误契约 | `src/shared/types/providerErrors.ts` |
| HTTP/流超时、SSE/JSON Lines 解析、Abort 组合 | `src/main/agent-runtime/providers/internal/http.ts` |
| 错误分类器（HTTP 状态 + 消息模式） | `src/main/agent-runtime/providers/internal/errorClassifier.ts` |
| 流式协议状态机与诊断码 | `src/main/agent-runtime/providers/internal/AssistantStreamBuilder.ts` |
| AI SDK 流式 Provider 适配（统一捕获并转 fail） | `src/main/agent-runtime/providers/AiSdkStreamingProvider.ts` |
| 配置化 Provider 路由与凭据失败回退 | `src/main/agent-runtime/providers/ConfiguredRuntimeProvider.ts` |
| 运行时消息/事件类型（含 StopReason、AgentEvent.error） | `src/main/agent-runtime/core/types.ts` |
| 会话/对话层对错误的消费（如 `conversationSendRejection`） | `src/main/conversation/conversationSendRejection.ts` |

## 3. 架构与约定

### 3.1 错误传播路径

1. **底层 I/O**：`parseSSE` / `parseJsonLines` / `ensureOk` 在读取超时、缓冲溢出、非 2xx 响应时抛出 `ProviderTimeoutError` / `ProviderStreamBufferError` / `ProviderHttpError`。
2. **Provider 适配层**：`AiSdkStreamingProvider.run` 用 try/catch 包裹 `streamText` 调用，捕获后调用 `builder.fail(normalizeError(error), composed.signal.aborted ? 'aborted' : 'error')`，将异常转为流式 `done('error'|'aborted')` 与 `error` 事件。
3. **流式协议层**：`AssistantStreamBuilder.fail` 先推 `type: 'error'` 事件再调用 `stream.error(error)`，保证消费者既能收到结构化消息也能收到传统 Error。
4. **上层消费**：调用方（如 `ConfiguredRuntimeProvider.stream`）通过 `missingProviderStream` 把同步构造的 Error 以 `queueMicrotask` 方式注入 EventStream；更高层的对话循环根据 `stopReason === 'error'` 且 `diagnostics` 中分类为 `retryable` 来决定重试或上报。

### 3.2 错误分类策略

`classifyProviderError` 是纯函数，无副作用，优先级固定：Abort → provider_unknown → HTTP status → 消息模式 → stream_protocol → unknown。其中：
- 429 → `rate_limit`（可重试）
- 500/502/503/504 → `network`（可重试）
- 401/403 → 根据消息内容区分 `auth_unconfigured` / `auth_scope_denied` / `auth_expired`
- 404 → `model_source`
- 400 + context 相关 → `context_overflow`
- 包含 `rate limit` / `network error` / `timeout` / `quota exceeded` / `stream ended without message_stop` 等关键词 → 对应语义类别

### 3.3 流式协议约束

`AssistantStreamBuilder` 强制每个 `ProviderOutputRef` 对应的块必须遵循 `start → delta* → end` 顺序，且同一 `contentIndex` 只能被一个 source 占用。违反时抛出 `ProviderStreamProtocolError`，其 `code` 字段作为诊断码向上暴露，使 UI 能区分“协议违规”和“网络错误”。

### 3.4 诊断透传

`AssistantMessage` 上的 `diagnostics?: AssistantMessageDiagnostic[]` 允许在失败时附加原始错误信息（`name / message / stack / code`）及 `details`，由上层在 IPC 投影前过滤敏感字段，确保渲染层只看到安全摘要。

## 4. 约定与约束

- **禁止向 IPC/渲染层直接传递内部 Error 对象**：`core/types.ts` 注释明确声明 “Renderer and IPC surfaces must receive explicit shared projections, never these objects directly”，所有跨进程错误必须经 `AssistantMessageDiagnostic` 或 `ProviderErrorInfo` 序列化。
- **所有 Provider 流必须经 `AssistantStreamBuilder` 封装**：任何 `AiSdkStreamingProvider` 子类或其他自定义 Provider 都必须通过 builder 的 `start*/append*/end*` 方法推进状态，不得直接向 `EventStream` push 原始事件，否则会被协议校验拦截。
- **超时与 Abort 统一通过 `composeAbortSignals` 管理**：请求级、首字节、空闲超时分别使用 `ProviderTimeoutError` 标记 phase（`first-byte` / `idle` / `total`），并由 `readWithTimeout` 在 finally 中释放 reader。
- **重试决策集中在分类器**：是否可重试不依赖具体错误类型，而由 `classifyProviderError` 返回的 `retryable` 字段决定，上层通过 `isRetryableAssistantError` 基于 `diagnostics` 做判定。
- **空流保护**：`ProviderEmptyStreamError`（`code = 'PROVIDER_STREAM_EMPTY'`）用于标识 SSE/JSON Lines 流结束但未产出 assistant 输出或工具调用的异常情况，配合 `isProviderEmptyStreamError` 守卫进行识别。
- **凭据/认证失败走专用路径**：`ConfiguredRuntimeProvider` 对 Bedrock、OAuth 等场景使用 `streamWithUnauthorizedRefresh` 包装，捕获 401/403 后触发 `providerAccountAuthService.forceRefreshRuntimeCredentials` 并重试，而非简单抛错。

该体系将外部 LLM 服务的不可靠性（网络抖动、限流、鉴权过期、流协议不一致）收敛为统一的 `ProviderErrorInfo` 分类，并通过流式协议校验与诊断附件保障调试与用户可见性。