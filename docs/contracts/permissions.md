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
- CSP（生产）：`script-src 'self'`（**无** `unsafe-inline`）；`style-src 'self'`（**无** `unsafe-inline`）；`style-src-attr 'none'`。动态样式经 constructable stylesheet（`useDynStyle`）注入，禁止依赖 inline style attributes。

## IPC Schema（Zod）

**全量** IPC handler 经 `parseIpcArgs`（含 settings / terminal / workflow / memory / conversation / project / capture / shell / rdx-runtime / trace / web 等）。非法 payload fail-closed。`approvalToken` 单次消费（`IpcApprovalTokenService`）。契约测试：`IpcPayloadGuard.test.ts`。

## Browser Bridge（QA-only / debug-only）
- /qa is a QA bootstrap surface: the launcher logs a one-time qaBootstrap, which is consumed before minting the bridge cookie. It isolates browser origins; it is not authentication against a malicious local process.

- **定位**：Debug / QA 验收辅助面；**不进 release 包默认运行路径**。仅 `pnpm run start:agent-browser`（或 launcher `--mode browser|browser-dev`）在 `RDC_AGENT_BROWSER_QA=1` 时启动；桌面 `desktop` / 发布 exe **不得**默认打开 Bridge。
- 同产品 API、异传输：桌面 `preload → IPC` 与 Browser QA `BrowserAppBridge → HTTP/SSE` 共用 `src/shared/renderer-api` 的唯一 `ElectronAPI` 工厂、channel manifest 与 main handler registry；不是第二套 UI 或第二套能力面。
- Authoritative entry: use the complete http://127.0.0.1:<port>/qa?qaBootstrap=... URL printed by the launcher. It consumes a one-time bootstrap, mints an HttpOnly `rdcBridgeToken` cookie (`SameSite=Strict`, and `Secure` for HTTPS), and redirects to clean `/app` on the same bridge origin. In `browser-dev`, Vite is reverse-proxied through the bridge (including HMR WebSocket); bridge auth is never placed in a URL query and there is no cross-port challenge handshake.
- **鉴权**（`resolveProvidedBridgeToken`）：programmatic clients may use an explicit Bearer header（允许无 Origin）；browser navigation and EventSource use the HttpOnly `rdcBridgeToken` cookie。Cookie 认证的 `/invoke`/`/api/*` 要求 `Origin` 精确等于 bridge origin。Query `rdcBridgeToken|token` is never accepted. 截断/无凭证 → **401 JSON**（`Content-Type: application/json`），勿当「已打开 Workbench」。
- Channel capability（`src/shared/renderer-api/channelCapabilities.ts` + `pnpm run check:browser-capability`）：闭合 `Record<RendererInvokeChannel, BridgeChannelCapability>`，每个 invoke channel 恰好一类 — `read`/`mutation` 默认允许；`high-impact` 需 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`；`desktop-only`（window chrome 等）永拒。未知 channel 运行时 fail-closed。`dialog:*` / `app:copyText` / `app:openPath` 属 mutation（Browser QA 加项目/选文件需要）。
- Cookie 认证的 `/invoke`、`/events`、`/api/*` 要求 `Origin` 精确等于 bridge origin。`browser-dev` 反代 Vite 时剥离 `cookie` / `authorization` / `proxy-authorization` / `x-rdc-*`。
- 精确 Origin allowlist（仅 bridge origin）；仅 canonical renderer channel 且存在已注册 handler 时可调用。未知 channel、内部 channel、未注册 handler 与不存在的明文 `settings:getProviderSecret` → 403。
- **完整产品面 parity**：Settings、Models Override、Terminal、Memory、Command、Tool Approval、MCP 状态、Hook/MCP trust/revoke/test 等 preload 已公开能力在 Browser 中走同一 main-owned Zod、PermissionPolicy、单次 approval token、MCP trust 与 `safeStorage` 边界；Browser 不保留拒绝桩或专用禁用 UI。完整矩阵见 [`docs/architecture/browser-qa-surface.md`](../architecture/browser-qa-surface.md)。
- Browser QA / Browser-dev 默认使用经过路径校验的 disposable `os.tmpdir()/rdc-agent/qa-*` userData，并在退出时清理；显式 `RDC_AGENT_USER_DATA` 或 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 才使用 canonical userData。`instance.lock` 冲突 fail-closed，禁止静默切换到空配置。
- Smoke：`pnpm run smoke:agent-browser`（假定 bridge 已起或脚本拉起；**不**并入默认 release pack）。
- 实现：`src/main/browserAppBridge/bridgeSecurity.ts`、`BrowserAppBridgeServer.ts`；测试：`bridgeSecurity.test.ts`、`BrowserAppBridgeServer.contract.test.ts`。

## Secret Isolation

- `safeStorage` 不可用 → fail-closed（不得明文落盘）。
- 对外查询仅 `{ hasSecret, maskedPreview? }`；不得返回明文。
- 损坏条目 quarantine；文件权限 0600/ACL。
- Credential 仅进入主进程 opaque lease，不进 manifest / Route / RequestPlan / IPC / Trace。

## RDX Context Lease

- 仅 per-session lease：`setRdxRuntimeContextForSession` / `getRdxContextLease` / `assertRdxContextLeaseOwnership`。
- **禁止** RDX global mirror、`legacyGlobalMirror`、`getRdxRuntimeContext` 全局 API。
- 工具读上下文前必须校验 lease 所有权；空 `sessionId` fail-closed（不写任何全局镜像）。
- UI 无 session 摘要可经 `getMostRecentRdxContextLease`；工具路径仍须显式 `sessionId` + ownership assert。

## MCP Trust

- Project MCP 与 user 同 ID 时，不可覆盖 user 的 `command` / `args` / `url` / `env`。
- 可执行指纹变化 → `needsRetrust`；连接前 `assertConnectAllowed`。
- MCP 连接池按 `realpath(projectRoot) + projectId + descriptorHash` 分组；失败缓存指数退避（retryable→permanent）；orphan process quarantine 至 supervised.exit。Transport 仅 `stdio` / `streamable-http`；`sse` → `MCP_TRANSPORT_UNSUPPORTED`。
- Settings 提供显式 trust 面板；Browser 与 Desktop 均通过相同 `rdx-runtime:trustMcp` handler 和主进程 trust 校验。

## Shell 与 Bash 分析

- RDX / 通用 shell 经 `ShellInvocationService`；exitCode：`code ?? (signal ? 128+n : 1)`。
- `BashAstAnalyzer`：结构分析 + denied 词边界与路径前缀。
- **风险分类器不是安全边界**；真正边界是 PermissionPolicy deny + 硬编码灾难模式 + sandbox/OS。

## Policy 编译

`.policy.yml` 损坏或非法 → `POLICY_INVALID` fail-closed。Project policy 只能收紧，不能放宽。Policy 优先级为 `built-in hard deny > user/project policy floor > Full access > tool metadata`；数值预算必须是非负整数，`0` 明确表示禁止任何对应执行（例如 `maxTurns: 0`、`maxWallTimeMs: 0` 返回 typed error），且该 floor 即使在 Full access 下仍生效。

Decision lattice 为 `allow < auto_review < ask_user < deny`。`approvalFloorByTool` 是该格上的下界：`user` 永远至少 `ask_user`，**不得**被 Permission Mode（含 Auto-review）降回 `auto_review`；`auto_review` 永远至少 `auto_review`。Mode 只影响 baseline，floor 与 baseline 取更严者。
- Runtime budget limits are frozen in the turn plan and enforced by one shared budget: `maxTurns`、`maxToolCalls`、`maxSubagents`、`maxChildDepth`、`maxWallTimeMs`；disabled policy files are filtered before merge.

## 相关测试入口

- `src/main/browserAppBridge/bridgeSecurity.test.ts`
- `src/shared/renderer-api/createRendererApi.test.ts`
- `src/main/settings/SecretStorageService.test.ts`
- `src/main/settings/AgentRuntimeConfigService.test.ts`（MCP trust）
- `src/main/ipc/validation/IpcPayloadGuard.test.ts`
- `src/main/sessions/RdxRuntimeContextRegistry.test.ts`
- `src/main/agent-runtime/permissions/*`
- `src/main/testing/contracts/securityContract.test.ts`（矩阵入口）
- 门禁：`pnpm run check:orchestrator-facade`（禁止恢复 `legacyGlobalMirror` / `getRdxRuntimeContext`）
