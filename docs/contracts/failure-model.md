# Fail-closed 三分类

> 权威裁决：`DESIGN.md` Architecture Principles §7。本文定义失败语义分类，并标注仓库内关键点。默认：**安全类必须 fail-closed**；完整性类允许 degrade-safe；可用性类应 recoverable。不得把可用性故障一律升级为安全 fail-closed，也不得把安全边界降级为“尽量继续”。

## 三类定义

### 1. Security fail-closed

威胁模型涉及：未授权访问、secret 泄漏、权限扩大、跨 session 污染、不可信 project 覆盖本机执行面、SSRF、任意代码执行。

行为：拒绝操作、拒绝启动、拒绝连接、返回结构化拒绝/诊断；**禁止**静默放行、明文降级、或“先跑起来再补权限”。

### 2. Integrity degrade-safe

威胁模型涉及：损坏记录、部分写入、schema 不匹配、通道冲突、上下文装不下。

行为：保留可验证子集、写 diagnostics、丢弃不可信块、或硬失败到用户可见诊断；**禁止**静默丢历史当真成功。可在明确边界内 degrade（例如 JSONL 坏行进 diagnostics、workTrace 非法置 null），但调用方必须 `assert` 或表面化。

### 3. Availability recoverable

威胁模型涉及：瞬时网络、provider 5xx、进程超时、用户取消、锁竞争。

行为：重试（若契约允许）、abort-and-join、释放 lease、恢复 Composer 快照、展示可恢复错误；**不应**因短暂不可用而永久锁死用户数据或误报为安全违规。

## 关键点分类标注

| 点 | 分类 | 说明 |
| --- | --- | --- |
| Browser Bridge 未 QA / 无 bearer / Origin / 未知或未注册 channel | Security | debug-only；canonical renderer manifest + handler registry fail-closed |
| `safeStorage` 不可用 / secret IPC 明文 | Security | 禁止明文存储与跨层暴露 |
| Project MCP 覆盖 user executable / 未 trust | Security | `needsRetrust` + `assertConnectAllowed` |
| IPC Zod 非法 payload / approvalToken 重放 | Security | **全量** handler `parseIpcArgs`；单次消费 token |
| Sandbox / permission deny-by-default | Security | Electron 面 |
| CSP 绕过（`style-src`/`script-src` unsafe-inline、style attr） | Security | 生产无 unsafe-inline；`style-src-attr 'none'`；动态样式走 `useDynStyle` |
| RDX context 无 session / lease 所有权不匹配 | Security | 仅 per-session lease；禁止 global mirror |
| 在途 turn 读可变 Settings / 未冻结 plan | Integrity | `EffectiveRuntimePlan` schemaVersion 3 完整冻结 |
| SSRF / private DNS（`web_fetch`/`web_search`） | Security | 每跳校验 + pin |
| Attachment SVG 脚本 / 超限媒体 | Security | `ATTACHMENT_MEDIA_UNSUPPORTED` |
| 附件数量/体积超限 | Security | `ATTACHMENT_LIMIT_EXCEEDED`；`retryable: false` |
| 附件路径缺失 | Integrity | `ATTACHMENT_NOT_FOUND`；`retryable: false` |
| 附件 manifest / magic 不匹配 | Integrity | `ATTACHMENT_INVALID`；`retryable: false` |
| Composer 附加 `.rdc` | Security | `ATTACHMENT_CAPTURE_USE_PROJECT_IMPORT`；引导 Project 右栏 Import |
| Composer 附加可执行文件 | Security | `ATTACHMENT_EXECUTABLE_DENIED` |
| 附件预览跨 session / path escape | Security | `IMAGE_PREVIEW_SESSION_DENIED` / `IMAGE_PREVIEW_NOT_FOUND` |
| 当前模型无 native vision | Integrity | `VISION_INPUT_UNSUPPORTED`；Composer 图片卡前置警告 |
| PDF 无文本层（扫描件） | Integrity | 诊断行，不静默空 inline |
| Policy 非法 / 弱于父级 | Security | `POLICY_INVALID` |
| Capture `ownerSessionId` 不匹配 | Security | 防跨 session 继承 |
| Deferred 未激活工具调用 | Security（授权面） | `TOOL_NOT_ACTIVATED` |
| Skill `allowedTools` 收窄 | Security（授权面） | `∩ skill ∩ runtime` |
| Capability `unknown` → text-only | Security（能力面） | 禁止猜测 native tools |
| Provider channel collision / 无 final_answer | Integrity | 终止 step + 诊断 |
| `PROVIDER_STREAM_*` 协议违规 | Integrity | 不重试；`CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION`；不得误报账号/额度 |
| Agent 连续三轮相同工具结果 | Integrity | `AGENT_NO_PROGRESS` → `CONVERSATION_AGENT_LOOP_STALLED`；不得误报 Provider failure |
| Agent 达到 maxTurns 仍要求 continuation | Integrity | `AGENT_MAX_TURNS_EXCEEDED` → `CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED`；不得静默完成 |
| JSONL 坏行 diagnostics | Integrity | 不静默当成功；调用方 assert |
| Storage schema 损坏 | Integrity | quarantine + `STORAGE_CORRUPT` |
| Storage 未知更高 schemaVersion | Integrity | `STORAGE_SCHEMA_UNSUPPORTED`，不 quarantine |
| Memory 跨进程锁超时 | Availability | `.memory.lock` / `.registry.lock` 活 pid 永不抢锁；死 pid 或损坏锁回收；超时 `MEMORY_LOCK_TIMEOUT` / `PROJECT_REGISTRY_LOCK_TIMEOUT` |
| Session attachments.json | Integrity | 现写 `{ schemaVersion, attachments }`；缺版本纯数组仍 Zod 校验；未知更高 `schemaVersion` 不 quarantine |
| Session shell-state.json | Integrity | 现写 `{ schemaVersion: '1', state: { cwd } }`；只存 cwd 不存 env；缺版本 / 损坏 quarantine 或 `STORAGE_SCHEMA`；未知更高 `schemaVersion` 不 quarantine |
| 非法历史 `workTrace` → null | Integrity | 读边界丢弃 |
| Context 无法装入 → `CONTEXT_CANNOT_FIT` | Integrity | hard degrade 后仍失败则报错 |
| 配置文件单文件 invalid + diagnostics | Integrity | 逐文件隔离，不拖垮列表 |
| Provider stream buffer 超限 | Integrity | 8MiB fail-closed 截断会话步 |
| 用户 Stop / abortAndJoin | Availability | join producers；丢弃迟到 event |
| ProcessSupervisor timeout/abort | Availability | terminate process tree; settle only after observed close/error; retain `unconfirmed_orphan` in registry for diagnostics |
| ShutdownCoordinator 限时 shutdown | Availability | 尽量排空后退出；`release_owned_runtimes` 失败必须记错误并保留归属记录，不得假装 daemon 已停 |
| Provider 网络/配额类错误 | Availability | 按 ErrorRecovery 契约；不发明 entitlement；429 与明确 `quota_exceeded` 的 402 只记录短期 quota |
| Provider 空流 / wire 失败 / 恢复 abort | Availability | 见下文「provider 失败诊断保真」；空流不得合成 HTTP 502；最终 Work Process 只展示一条诊断 |
| Headless instance.lock 冲突 | Security + Availability | 冲突 fail-closed 避免串 userData |

## provider 失败诊断保真

Provider 请求失败须保留 cause 链与用户可区分诊断，不得把空流冒充真实 5xx，也不得把 Agent loop 停滞误报为 Provider failure。

### 错误类型（`providers/internal/http.ts`）

| 类型 | code / 形态 | 语义 |
| --- | --- | --- |
| `ProviderEmptyStreamError` | `PROVIDER_STREAM_EMPTY` | 流结束但无 assistant 正文或 structured tool call；**禁止**合成 HTTP 502 |
| `ProviderWireFailureError` | wire failure | OpenAI/Azure Responses SSE `error` / `response.failed` 无 400–599 status 时；有 status 则 `ProviderHttpError` |
| `ProviderHttpError` | HTTP status | 真实 4xx/5xx；`createResponsesStreamFailure` 仅在 wire 带明确 status 时使用 |

### ErrorRecovery 分类与重试

| category | 行为 |
| --- | --- |
| `empty_stream` | 最多重试 **1** 次后 abort；**不**归入 `server_error` |
| `server_error` | 真实 HTTP 5xx；最多 **3** 次重试 |
| `overloaded` | HTTP **503/529**，或文案含 `at capacity` / `high demand` / `overloaded` / `service unavailable`；现有 `switch_model` 路径 |
| `auth_error` | **401/403**；立即 abort |
| `stream_protocol` | `PROVIDER_STREAM_*` 协议违规；不重试 |

`AgentRecoveryAbortError` 必须经 `createAbortError` 构造，始终携带 `cause` + `category` / `attempts` / `maxAttempts` / `lastStatus?` / `bodySnippet`（脱敏 ≤300）；禁止裸 `new Error('[Recovery abort]')`。

### Turn 失败诊断（`createTurnFailedDiagnostic`）

- 对外 code 仍为 `CONVERSATION_LLM_REQUEST_FAILED`。
- `userMessage` 按 cause 分类：**auth** / **quota-rate** / **overloaded** / **real 5xx** / **empty_stream** / **network**。
- `technicalMessage` 固定：`provider HTTP <status\|n/a> · attempts <n>/<max> · <snippet>`（经 `redactTechnicalMessage` / `redactRecoverySnippet`）。

### Agent loop 与 Work Process 投影

- `AgentLoop` 不得把 provider `error` 事件 remap 为 `message_end`。
- `AgentTurnRunner` 在 `stopReason === 'error'` 时跳过 `empty_response_without_tool_call`。
- `error_recovery_*` 不进 Work Process；最终失败为 **一条** diagnostic（含 `technicalMessage`）。

## 过度 fail-closed 的纠正原则

下列场景**不应**仅因“出错”就按 Security 永久拒绝（除非同时触及授权/秘密）：

1. **单条 JSONL 损坏**：Integrity — 报告 diagnostics，保留可读行；全文件不可读才抛文件级错误。
2. **单个 scoped 资源文件损坏**：Integrity — 该资源 `invalid`，其它资源继续列出。
3. **用户主动取消 turn**：Availability — abort-and-join 后允许下一 turn，不把 session 标为不可信。
4. **Mermaid/KaTeX 渲染失败**：Integrity/Availability（UI）— 该块 fail-closed 展示错误，不影响整条消息其它块。
5. **Reasoning `unknown`**：不是 Security 拒绝发送；UI 呈现与关档相同的 `Disabled` / `禁用`（灰掉不可调），控件不发明档位。

代码注释应使用 `// failure-class: security|integrity|availability` 标注意图（仅在边界函数处，避免噪声）。

## 相关测试

- Provider 失败保真：`ErrorRecovery.test.ts`、`ConversationTurnDiagnostic.test.ts`、`providers/internal/http.test.ts`、`OpenAIResponsesProvider.test.ts`、`AgentLoop.recoveryDiagnostic.test.ts`
- Integrity 存储：`src/shared/utils/jsonl.test.ts`、`src/main/testing/contracts/storageFaultContract.test.ts`
- Availability 取消：`TurnCoordinator.test.ts`、`ProcessSupervisor.test.ts`、`cancellationContract.test.ts`
- Security 矩阵：`securityContract.test.ts`

## Capture 分阶段失败

Open 失败、图片获取失败、设备显示不支持、Close 未确认分别投影。native context 已打开而图片失败时保留 lease，重试只请求图片。无颜色输出不可复用上一事件图片。关闭和半开恢复失败保留 context/设备占用，必须显式关闭确认；不以清空 UI 模拟释放。历史写失败或达到配额后明确未保存，已有历史保持不变。Remote `unsupported` 是能力边界，不能投影显示成功。
