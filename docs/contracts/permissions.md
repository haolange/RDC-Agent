# 权限与安全边界

> 产品不变量以 `DESIGN.md` 为准。失败分类见 [`failure-model.md`](failure-model.md)。本文描述 **Permission / Electron Sandbox / IPC / Browser Bridge / Secret / MCP trust / Shell** 稳定边界。

## Permission Mode

Composer 暴露：`Default`、`Auto-review`、`Full access`、`Custom(config.toml)`。主进程 `AgentPermissionPolicy` 为权威，结合 profile allowlist、permission mode、workspace root、readable/writable roots、command allow/deny、tool metadata、`CompiledPolicy`。

- `Default`：例行 workspace 只读可自动；外部文件、网络、变更、破坏性 shell、未知命令需审批。
- `Auto-review`：记录 reviewer 决策后继续。
- `Full access`：显式信任本地文件与命令；仍受 primitive 硬约束（二进制/`.rdc`、realpath、灾难 shell、SSRF）。
- `Custom`：按配置根与命令列表。

Work Process 必须展示真实 `Requested approval` / `Approved` / `Denied` / `Auto-reviewed`，不得把策略暂停伪装成普通失败 shell。

Temporary 外部路径许可仅绑定当前 `ToolExecutionContext.temporaryAllowedPathRoots`。

## Electron Sandbox（Phase 6）

- BrowserWindow：`sandbox: true`。
- Preload：仅 `contextBridge` + `ipcRenderer` 受控暴露。
- Permission request：deny-by-default。
- CSP：`script-src` 去掉 `unsafe-inline`；`style-src` 因 React style attributes 仍保留 `unsafe-inline`（partial，见升级计划 6.1 备注）。Nonce 不适用于动态 style attr。

## IPC Schema（Zod）

敏感通道经 `parseIpcArgs` 中间件（settings / terminal / workflow / memory 等）。非法 payload fail-closed。`approvalToken` 单次消费（`IpcApprovalTokenService`）。契约测试：`IpcPayloadGuard.test.ts`。

## Browser Bridge（QA-only）

- 仅当 `RDC_AGENT_BROWSER_QA=1` 启动 Bridge。
- 256-bit bearer；全路径鉴权；精确 Origin；channel allowlist fail-closed。
- 拒绝 terminal 写、secret 读写、memory、mcp 状态、command execute、approval、settings 变更、MCP trust 等危险通道。
- Headless userData 默认 `qa-<runId>`；`instance.lock`；冲突实例 fail-closed。
- 实现：`src/main/browserAppBridge/bridgeSecurity.ts`。

## Secret Isolation

- `safeStorage` 不可用 → fail-closed（不得明文落盘）。
- 对外查询仅 `{ hasSecret, maskedPreview? }`；不得返回明文。
- 损坏条目 quarantine；文件权限 0600/ACL。
- Credential 仅进入主进程 opaque lease，不进 manifest / Route / RequestPlan / IPC / Trace。

## MCP Trust

- Project MCP 与 user 同 ID 时，不可覆盖 user 的 `command` / `args` / `url` / `env`。
- 可执行指纹变化 → `needsRetrust`；连接前 `assertConnectAllowed`。
- Settings 提供显式 trust 面板；`rdx-runtime:trustMcp` 不在 Bridge allowlist。
- MCP 连接池按 project 分组（`projectRoot + descriptorHash`）；仅 eviction 失配连接。

## Shell 与 Bash 分析

- RDX / 通用 shell 经 `ShellInvocationService`；exitCode：`code ?? (signal ? 128+n : 1)`。
- `BashAstAnalyzer`：结构分析 + denied 词边界与路径前缀。
- **风险分类器不是安全边界**；真正边界是 PermissionPolicy deny + 硬编码灾难模式 + sandbox/OS。

## Policy 编译

`.policy.yml` 损坏或非法 → `POLICY_INVALID` fail-closed。Project policy 只能收紧，不能放宽。

## 相关测试入口

- `src/main/browserAppBridge/bridgeSecurity.test.ts`
- `src/main/settings/SecretStorageService.test.ts`
- `src/main/settings/AgentRuntimeConfigService.test.ts`（MCP trust）
- `src/main/ipc/validation/IpcPayloadGuard.test.ts`
- `src/main/agent-runtime/permissions/*`
- `src/main/testing/contracts/securityContract.test.ts`（矩阵入口）
