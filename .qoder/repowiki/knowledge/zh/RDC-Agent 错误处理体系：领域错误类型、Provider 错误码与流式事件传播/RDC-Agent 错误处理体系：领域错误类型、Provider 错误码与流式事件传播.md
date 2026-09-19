---
kind: error_handling
name: RDC-Agent 错误处理体系：领域错误类型、Provider 错误码与流式事件传播
category: error_handling
scope:
    - '**'
source_files:
    - src/shared/types/providerErrors.ts
    - src/main/agent-runtime/providers/internal/http.ts
    - src/main/agent-runtime/core/EventStream.ts
    - src/main/agent-runtime/core/types.ts
    - src/main/agent-runtime/tools/primitives/_shared.ts
    - src/main/agent-runtime/providers/AiSdkStreamingProvider.ts
---

## 1. 整体方案

RDC-Agent 在 Electron 主进程（`src/main/agent-runtime`）中采用 **结构化 Error 类 + 统一错误码 + 流式事件传播** 的组合方式，覆盖 LLM Provider 调用、工具执行、IPC 与文件 I/O 等场景。核心思想是：
- 所有可分类的错误都通过 `extends Error` 的领域错误类表达，并携带语义字段（如 `providerApi`、`status`、`phase`、`code`）。
- 跨进程/跨模块边界使用共享的 `ProviderErrorCode` 字符串字面量联合类型进行错误分类。
- 长生命周期异步流程（尤其是 Provider 流式生成）通过自实现的 `EventStream` 以 `error` / `done` / `abort` 事件传播异常，而不是直接 throw Promise rejection。
- 工具层对输入做 fail-closed 校验，越界或危险操作直接抛错，由上层转为工具结果中的 `isError: true`。

该仓库没有发现全局中间件式的错误拦截器；错误处理分散在各层，但遵循一致的命名与结构约定。

## 2. 关键文件与包

| 文件 | 职责 |
|---|---|
| `src/shared/types/providerErrors.ts` | 定义 `ProviderErrorCode` 联合类型与 `ProviderErrorInfo`、`AssistantMessageDiagnostic` 等共享错误契约 |
| `src/main/agent-runtime/providers/internal/http.ts` | 定义 `ProviderTimeoutError`、`ProviderHttpError`、`ProviderEmptyStreamError`、`ProviderWireFailureError`、`ProviderStreamBufferError`，并提供 `normalizeError`、`createResponsesStreamFailure`、`composeAbortSignals`、`ensureOk`、SSE/JSON Lines 解析超时控制 |
| `src/main/agent-runtime/core/EventStream.ts` | 通用异步事件流，提供 `push` / `complete` / `error` / `abort` 与 `map/filter/tap` 链式转换，错误通过 `error(err)` 注入 |
| `src/main/agent-runtime/core/types.ts` | 定义 `StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | 'refusal'`，以及 `AssistantMessageEvent` 中的 `{ type: 'error'; error: Error }` 与 Agent 级 `AgentEvent` 中的 `{ type: 'error'; error: Error; aborted?: boolean }` |
| `src/main/agent-runtime/tools/primitives/_shared.ts` | 工具安全原语：路径越界、符号链接拒绝、文件大小上限、二进制检测、原子写入等，全部通过抛错实现 fail-closed |
| `src/main/agent-runtime/providers/AiSdkStreamingProvider.ts` | 将底层 provider 的异常经 `normalizeError` 归一化后，通过 `AssistantStreamBuilder.fail(..., 'aborted' | 'error')` 推入流 |

## 3. 架构与约定

### 3.1 Provider 层错误模型

- 所有网络/流式错误集中在 `providers/internal/http.ts` 中以 `extends Error` 的子类表达：
  - `ProviderTimeoutError`：带 `phase: 'first-byte' | 'idle' | 'total'`、`timeoutMs`、`providerApi`。
  - `ProviderHttpError`：带 `status`、`bodyText`、`providerApi`。
  - `ProviderEmptyStreamError`：固定 `code = 'PROVIDER_STREAM_EMPTY'`，用于 SSE/JSON Lines 流结束但未产出 assistant 内容。
  - `ProviderWireFailureError`：保留上游 wire 层的 `code`、`bodyText`，用于非 HTTP 协议失败。
  - `ProviderStreamBufferError`：流缓冲超过 `maxBufferBytes` 时抛出，防止内存膨胀。
- `ensureOk(response)` 把非 `response.ok` 统一转换为 `ProviderHttpError`，并尝试从 HTML 响应中提取 `<title>` 片段作为可读消息。
- `createResponsesStreamFailure(errorRecord, eventRecord, fallbackMessage)` 从 Responses SSE 的 `error` / `response.failed` 事件中抽取 `message`、`status`、`code`，有 HTTP 状态则返回 `ProviderHttpError`，否则返回 `ProviderWireFailureError`。
- `composeAbortSignals` 组合外部 `AbortSignal` 与内部信号，并在 `requestTimeoutMs` 到期时主动 abort 并抛出 `ProviderTimeoutError`。
- `normalizeError` 保证下游只收到 `Error` 实例。

### 3.2 错误码与诊断信息

- `src/shared/types/providerErrors.ts` 定义了 `ProviderErrorCode` 联合类型，包括 `auth_unconfigured`、`auth_expired`、`auth_scope_denied`、`model_source`、`request_rejected`、`rate_limit`、`quota_exceeded`、`network`、`timeout`、`context_overflow`、`stream_protocol`、`aborted`、`unknown` 等，供上层按码分类重试或提示。
- `AssistantMessageDiagnostic` 允许在失败的 `AssistantMessage` 上附加结构化诊断条目（`type`、`timestamp`、`error.name/message/stack/code`、`details`），以便渲染层展示技术细节。

### 3.3 流式错误传播

- `EventStream<T, R>` 是 agent-runtime 的核心异步抽象：生产者通过 `push(event)` 推送事件，通过 `complete(result)` 正常结束，通过 `error(err)` 注入错误，通过 `abort()` 发出中止。
- `AssistantMessageEvent` 包含 `{ type: 'error'; error: Error; message: AssistantMessage }`，以及 `done` 事件中的 `reason: StopReason`，其中 `'error'` 和 `'aborted'` 区分普通异常与用户取消。
- `AiSdkStreamingProvider.run` 中捕获底层 stream 异常后，调用 `builder.fail(normalizeError(error), composed.signal.aborted ? 'aborted' : 'error')`，从而把错误映射为统一的 stop reason。

### 3.4 工具层错误策略

- 工具安全原语位于 `tools/primitives/_shared.ts`，采用 **fail-closed** 原则：任何路径逃逸、符号链接、过大文件、二进制误读、敏感目录删除都会直接 `throw new Error(...)`，错误消息中包含语义前缀（如 `MUTATION_REQUIRES_PROJECT`、`SYMLINK_PATH_REJECTED`、`WRITE_PARENT_ESCAPE`、`Refusing to delete path under .git`）。
- 写文件使用临时文件 + fsync + 原子 rename（Windows 下用 `.bak.tmp` 回退），避免竞态导致的数据丢失。
- 文本读取通过 `assertTextReadable` 检查扩展名、文件大小、NUL 字节、RenderDoc magic (`RDOC`)、高控制字符比例等，拒绝二进制文件。

### 3.5 IPC 与上层消费

- 错误最终通过 `AgentEvent` 的 `{ type: 'error'; error: Error; aborted?: boolean }` 与 `AssistantMessageEvent` 的 `error` 事件向上传播，由 conversation / trace / right-rail 等子系统消费并投影到 UI。
- 未发现全局 try/catch 中间件；各子模块（conversation、trace、ipc handlers）各自 catch 并转换为对应的诊断事件。

## 4. 约定与约束

- **所有领域错误必须继承 `Error`**：`ProviderTimeoutError`、`ProviderHttpError`、`ProviderEmptyStreamError`、`ProviderWireFailureError`、`ProviderStreamBufferError` 均如此，且设置 `name` 字段便于 `instanceof` 判断。
- **错误必须携带 `providerApi`**：所有 provider 层错误构造函数都要求第一个参数为 API 标识，便于日志定位具体后端。
- **流式接口禁止直接 throw**：`EventStream` 的 `error()` 是唯一注入异常的方式，消费者通过 `for await` 或 `result()` 获取；`pipeTo` 内部会把异常包装为 `Error(String(err))` 再传给下游。
- **取消与超时统一走 AbortSignal**：`composeAbortSignals` 负责合并外部 signal 与请求超时，超时产生 `ProviderTimeoutError`，取消产生 `AbortError`（`name === 'AbortError'`）。
- **工具输入必须显式校验**：`requireMutationWorkspaceRoot`、`safeResolvePath`、`assertTextReadable`、`assertFileSizeCap`、`assertNotSensitiveDeletePath` 等函数承担输入合法性检查，越界即抛错。
- **错误码集中管理**：`ProviderErrorCode` 是单一来源的字符串字面量联合类型，新增错误码需在此声明。
- **诊断信息不泄露敏感数据**：`serializeWireErrorBody` 截断至 500 字节，HTML 响应仅取 `<title>` 片段。

## 5. 未发现的模式

- 未发现 `panic/recover` 风格的顶层 recover 机制（Node.js 中也不适用）。
- 未发现全局错误上报中间件；遥测相关代码位于 `src/main/telemetry/SentryService.ts`，但本分析聚焦于错误定义与传播，未深入其集成细节。
- 未发现统一的错误码枚举常量对象；错误码以 TypeScript 字符串字面量联合类型表达。
