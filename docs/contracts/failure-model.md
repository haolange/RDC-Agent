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
| Browser Bridge 未 QA / 无 bearer / Origin / deny channel | Security | QA-only；fail-closed allowlist |
| `safeStorage` 不可用 / secret IPC 明文 | Security | 禁止明文存储与跨层暴露 |
| Project MCP 覆盖 user executable / 未 trust | Security | `needsRetrust` + `assertConnectAllowed` |
| IPC Zod 非法 payload / approvalToken 重放 | Security | **全量** handler `parseIpcArgs`；单次消费 token |
| Sandbox / permission deny-by-default | Security | Electron 面 |
| CSP 绕过（`style-src`/`script-src` unsafe-inline、style attr） | Security | 生产无 unsafe-inline；`style-src-attr 'none'`；动态样式走 `useDynStyle` |
| RDX context 无 session / lease 所有权不匹配 | Security | 仅 per-session lease；禁止 global mirror |
| 在途 turn 读可变 Settings / 未冻结 plan | Integrity | `EffectiveRuntimePlan` schemaVersion 2 完整冻结 |
| SSRF / private DNS（`web_fetch`/`web_search`） | Security | 每跳校验 + pin |
| Attachment SVG 脚本 / 超限媒体 | Security | 拒绝 |
| Policy 非法 / 弱于父级 | Security | `POLICY_INVALID` |
| Capture `ownerSessionId` 不匹配 | Security | 防跨 session 继承 |
| Deferred 未激活工具调用 | Security（授权面） | `TOOL_NOT_ACTIVATED` |
| Skill `allowedTools` 收窄 | Security（授权面） | `∩ skill ∩ runtime` |
| Capability `unknown` → text-only | Security（能力面） | 禁止猜测 native tools |
| Provider channel collision / 无 final_answer | Integrity | 终止 step + 诊断 |
| JSONL 坏行 diagnostics | Integrity | 不静默当成功；调用方 assert |
| 非法历史 `workTrace` → null | Integrity | 读边界丢弃 |
| Context 无法装入 → `CONTEXT_CANNOT_FIT` | Integrity | hard degrade 后仍失败则报错 |
| 配置文件单文件 invalid + diagnostics | Integrity | 逐文件隔离，不拖垮列表 |
| Provider stream buffer 超限 | Integrity | 8MiB fail-closed 截断会话步 |
| 用户 Stop / abortAndJoin | Availability | join producers；丢弃迟到 event |
| ProcessSupervisor timeout/abort | Availability | 杀进程树；registry 清空 |
| ShutdownCoordinator 限时 shutdown | Availability | 尽量排空后退出 |
| Provider 网络/配额类错误 | Availability | 按 ErrorRecovery 契约；不发明 entitlement |
| Headless instance.lock 冲突 | Security + Availability | 冲突 fail-closed 避免串 userData |

## 过度 fail-closed 的纠正原则

下列场景**不应**仅因“出错”就按 Security 永久拒绝（除非同时触及授权/秘密）：

1. **单条 JSONL 损坏**：Integrity — 报告 diagnostics，保留可读行；全文件不可读才抛文件级错误。
2. **单个 scoped 资源文件损坏**：Integrity — 该资源 `invalid`，其它资源继续列出。
3. **用户主动取消 turn**：Availability — abort-and-join 后允许下一 turn，不把 session 标为不可信。
4. **Mermaid/KaTeX 渲染失败**：Integrity/Availability（UI）— 该块 fail-closed 展示错误，不影响整条消息其它块。
5. **Reasoning `unknown`**：不是 Security 拒绝发送；UI 呈现与关档相同的 `Disabled` / `禁用`（灰掉不可调），控件不发明档位。

代码注释应使用 `// failure-class: security|integrity|availability` 标注意图（仅在边界函数处，避免噪声）。

## 相关测试

- Integrity 存储：`src/shared/utils/jsonl.test.ts`、`src/main/testing/contracts/storageFaultContract.test.ts`
- Availability 取消：`TurnCoordinator.test.ts`、`ProcessSupervisor.test.ts`、`cancellationContract.test.ts`
- Security 矩阵：`securityContract.test.ts`
