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

当前 session 的 `{sessionPath}/attachments` 作为 scoped readable root 注入 `AgentPermissionPolicy.sessionAttachmentsRoot`。仅 `READ_ONLY_FILE_TOOLS`（`read_file` / `read_image` / `glob` / `grep`）自动可读；写工具、`code_interpreter` 与跨 session 附件目录不继承。依据是用户亲手附加 = 显式意图；`.rdc`、可执行文件与 SVG 不得进入该目录。

canonical knowledge 读根（**U02 落地**）：`EffectiveRuntimePlan` 在 `prepareTurn` 冻结 `knowledgeReadRoots = [realpath(~/.rdx/knowledge), realpath(<projectRoot>/.rdx/knowledge)]`（仅存在且为真实目录；根自身 symlink/junction → 排除 + 诊断）。`AgentPermissionPolicy` **仅**对 `read_file` / `read_image` / `glob` / `grep` 把它们并入免审批读根。`write` / `edit` / `delete` / `shell` / `code_interpreter` 在策略层与执行层双重拒绝。sibling 越界（如 `~/.rdx/memory`、`~/.rdx/agents`）拒。写入 Knowledge 仍只经 `knowledge_*` + human review。见 `DESIGN.md` 裁决 G。

## Electron Sandbox（Phase 6）

- BrowserWindow：`sandbox: true`。
- Preload：仅 `contextBridge` + `ipcRenderer` 受控暴露。
- Permission request：deny-by-default。
- CSP（生产）：`script-src 'self'`（**无** `unsafe-inline`）；`style-src 'self'`（**无** `unsafe-inline`）；`style-src-attr 'none'`。动态样式经 constructable stylesheet（`useDynStyle`）注入，禁止依赖 inline style attributes。

## IPC Schema（Zod）

**全量** IPC handler 经 `parseIpcArgs`（含 settings / terminal / workflow / memory / conversation / project / capture / shell / rdx-runtime / trace / web 等）。非法 payload fail-closed。`approvalToken` 单次消费（`IpcApprovalTokenService`）。契约测试：`IpcPayloadGuard.test.ts`。Renderer 读取 Investigation 正文的唯一通道是 IPC `investigation:read({ sessionId, artifactId, expectedHash })`：分类 `read`；active project/session owner gate；内部唯一调用 `InvestigationArtifactService.readRecord`；只返回既有 max-bytes 内完整 record，超限 fail-closed；不接受 URI / 绝对路径 / generic artifact。见 `DESIGN.md` 裁决 B / E。**该 IPC 已落地**。T18 ColdData 已证见 `DESIGN.md` T18 已证组；产品级 Browser QA 全矩阵见 U05 / [`docs/product/acceptance-ledger.md`](../product/acceptance-ledger.md)。

## Browser Bridge（QA-only / debug-only）
- /qa is a QA bootstrap surface: the launcher logs a one-time qaBootstrap, which is consumed before minting the bridge cookie. It isolates browser origins; it is not authentication against a malicious local process.

- **定位**：Debug / QA 验收辅助面；**不进 release 包默认运行路径**。仅 `pnpm run start:agent-browser`（或 launcher `--mode browser|browser-dev`）在 `RDC_AGENT_BROWSER_QA=1` 时启动；桌面 `desktop` / 发布 exe **不得**默认打开 Bridge。
- 同产品 API、异传输：桌面 `preload → IPC` 与 Browser QA `BrowserAppBridge → HTTP/SSE` 共用 `src/shared/renderer-api` 的唯一 `ElectronAPI` 工厂、channel manifest 与 main handler registry；不是第二套 UI 或第二套能力面。
- Authoritative entry: use the complete http://127.0.0.1:<port>/qa?qaBootstrap=... URL printed by the launcher. It consumes a one-time bootstrap, mints an HttpOnly `rdcBridgeToken` cookie (`SameSite=Strict`, and `Secure` for HTTPS), and redirects to clean `/app` on the same bridge origin. In `browser-dev`, Vite is reverse-proxied through the bridge (including HMR WebSocket); bridge auth is never placed in a URL query and there is no cross-port challenge handshake.
- **鉴权**（`resolveProvidedBridgeToken`）：programmatic clients may use an explicit Bearer header（允许无 Origin）；browser navigation and EventSource use the HttpOnly `rdcBridgeToken` cookie。Cookie 认证的 `/invoke`/`/api/*` 要求 `Origin` 精确等于 bridge origin。Query `rdcBridgeToken|token` is never accepted. 截断/无凭证 → **401 JSON**（`Content-Type: application/json`），勿当「已打开 Workbench」。
- Channel capability（`src/shared/renderer-api/channelCapabilities.ts` + `pnpm run check:browser-capability`）：闭合 `Record<RendererInvokeChannel, BridgeChannelCapability>`，每个 invoke channel 恰好一类 — `read`/`mutation` 默认允许；`high-impact` 需 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`；`desktop-only`（window chrome 等）永拒。未知 channel 运行时 fail-closed。`dialog:*` / `app:copyText` / `app:openPath` 属 mutation（Browser QA 加项目/选文件需要）。`app:readClipboardText` 属 `read`，只在可编辑右键菜单判定粘贴 disabled 时读取一次。
- Cookie 认证的 `/invoke`、`/events`、`/api/*` 要求 `Origin` 精确等于 bridge origin。`browser-dev` 反代 Vite 时剥离 `cookie` / `authorization` / `proxy-authorization` / `x-rdc-*`。
- 精确 Origin allowlist（仅 bridge origin）；仅 canonical renderer channel 且存在已注册 handler 时可调用。未知 channel、内部 channel、未注册 handler 与不存在的明文 `settings:getProviderSecret` → 403。
- **完整产品面 parity**：Settings、Models Override、Runtime Log、Memory、Command、Tool Approval、MCP 状态、Hook/MCP trust/revoke/test 等 preload 已公开能力在 Browser 中走同一 main-owned Zod、PermissionPolicy、单次 approval token、MCP trust 与 `safeStorage` 边界；Browser 不保留拒绝桩或专用禁用 UI。完整矩阵见 [`docs/architecture/browser-qa-surface.md`](../architecture/browser-qa-surface.md)。
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
- **Delegated lease**：parent 经 `grantDelegatedLease` 授予 child 一条 scoped、生命周期绑定的 delegated lease（`delegatedFrom`），使 `domainExtensions.rdx.requiresLease=true` 的 child 取得 parent RDX context 并串行；同一 parent 同时只允许一条 live delegated lease；无 parent lease 则 fail-closed，不得静默创建。child 完成/取消/抛错立即 `revokeDelegatedLease`，parent lease 不变。child lease 不可再转授。未请求 RDX 领域扩展 的 child **在 allowlist 层**就不能拿到 `rdx_context` / `rdx_probe`（`shell` 可保留，但不继承 parent lease）。禁止并发 RDX 双 owner。Mission 只读面走 `rdx_probe`，不得获得 generic shell。

## Hook Trust

- Hook trust fingerprint = parsed definition + 所有 resolved 脚本/参数文件 bytes + canonical realpath + scope/provenance + PATH 解析后的 executable identity。任一变化 → `needsRetrust`。
- builtin 默认信任且内容变化必须随仓库发布；user/project 必须显式 trust。
- 旧仅-YAML-hash trust 在首次加载时失效并要求 retrust（不静默沿用）。
- 12 canonical events 保持单一 `HookEngine` 路径。见 `DESIGN.md` 裁决 K。
- **当前态**：上述条款已由 `HookEngine` + `hook-trust.json` schemaVersion 2 落地；信任匹配只认 `trustFingerprint`，不再接受 YAML-only `sourceHash`。

## MCP Trust

- Project MCP 与 user 同 ID 时，不可覆盖 user 的 `command` / `args` / `url` / `env`。
- 可执行指纹变化 → `needsRetrust`；连接前 `assertConnectAllowed`。
- MCP 连接池按 `realpath(projectRoot) + projectId + descriptorHash` 分组；失败缓存指数退避（retryable→permanent）；orphan process quarantine 至 supervised.exit。Transport 仅 `stdio` / `streamable-http`；`sse` → `MCP_TRANSPORT_UNSUPPORTED`。
- Settings 提供显式 trust 面板；Browser 与 Desktop 均通过相同 `rdx-runtime:trustMcp` handler 和主进程 trust 校验。

## Shell 分析

- Agent 命令工具 id 是 `shell`；解释器由 `ShellResolver` 解析（Settings 本机覆盖 → pwsh 7 → Windows PowerShell 5.1；POSIX `$SHELL`∈zsh/bash/sh/dash → zsh → bash → sh）。fish/csh/nu 等 fail-closed。全失败 `SHELL_UNAVAILABLE`。
- 硬拒绝是**唯一**灾难 enforcement 表（`shellHardDeny`）。PowerShell 先统一 splitter（含 `&`）、折叠反引号、静态别名展开与最短唯一参数 bind，再匹配 `Remove-Item -Recurse -Force` 根路径（含 `$env:SystemDrive` / `\\?\C:\` / UNC 根 / hive 根）、`iwr|iex`（右端含 `bash`/`sh`/`pwsh`/`cmd`）、`-EncodedCommand`、嵌套 `powershell -Command` / `&` 调用运算符、launcher `-ExecutionPolicy Bypass`。cmd 覆盖 `rd /s /q`、`del /s /q`、`diskpart`、`shutdown /s`、`format`。POSIX 覆盖 `rm -rf /`、`dd if=`、`mkfs*`、`> /dev/sd|hd|nvme|xvd`、fork bomb、`chmod 777`；`sudo` 只在与这些灾难组合叠加时硬拒。allow 与 deny 都用词边界匹配。
- RDX / 通用 shell 经 `ShellInvocationService`；exitCode：`code ?? (signal ? 128+n : 1)`。
- `ShellCommandRiskAnalyzer`：结构分析 + denied 词边界与路径前缀；最高分档为 `high`，只做审批路由，没有 `critical` 档位。
- **风险分类器不是安全边界**；真正边界是 PermissionPolicy + `shellHardDeny` + sandbox/OS。

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


## 原生 RDX 执行证据

shell 的 command 与 rdx 互斥；ToolValidator oneOf/not 与执行入口双重检查。结构化模式仍是 shell 审批，不属于只读自动许可。General 之外即使 Full access 也拒绝；本机冻结配置、owning project/session lease、非 default context、非 delegated/offline child 同时成立才执行。模型不可传 replay/context identity。

执行回执仅由主进程在真实原生成功调用后签名，key 在 safeStorage；模型提交的 result JSON、普通 shell 输出或 artifact hash 本身不具备 provenance。签名校验与 SessionArtifactResolver 所有权/hash 同时成立才可引用。实验关闭和新完成必须满足五阶段真实调用与同 replacement 的回滚；旧记录只保留可读性。详见 docs/architecture/rdx-runtime.md。

Skill 权限只在 prepareTurn 对预载集合取交集；skill_read 只读方法。RenderDoc 方法技能没有局部执行工具白名单；profile/policy/lease 仍强制授权。Knowledge Scout 仍只有四个 Knowledge 只读工具，文件补证属于调用方独立步骤。
