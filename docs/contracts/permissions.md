# 权限与安全边界

> 产品不变量以 `DESIGN.md` 为准。失败分类见 [`failure-model.md`](failure-model.md)。本文描述 **Permission / Electron Sandbox / IPC / Browser Bridge / Secret / MCP trust / Shell** 稳定边界。

## Permission Mode

Composer 暴露：`Default`、`Auto-review`、`Full access`、`Custom(config.toml)`。主进程 `AgentPermissionPolicy` 为权威，结合 profile allowlist、permission mode、workspace root、readable/writable roots、command allow/deny、tool metadata、`CompiledPolicy`。

- `Default`：例行 workspace 只读可自动；外部文件、网络、变更、破坏性 shell、未知命令需审批。
- `Auto-review`：先执行确定性规则；已验证的低风险操作记录规则批准，其余可审操作提交一次独立、无工具的模型审核。没有有效批准不执行；不自动切人工或 Full access。
- `Full access`：显式信任本地文件与命令；仍受 primitive 硬约束（二进制/`.rdc`、realpath、灾难 shell、SSRF）。
- `Custom`：按配置根与命令列表。

Work Process 必须展示真实 `Requested approval` / `Approved` / `Denied` / `Auto-reviewed`，不得把策略暂停伪装成普通失败 shell。

Temporary 外部路径许可仅绑定当前 `ToolExecutionContext.temporaryAllowedPathRoots`。

当前 session 的 `{sessionPath}/attachments` 作为 scoped readable root 注入 `AgentPermissionPolicy.sessionAttachmentsRoot`。仅 `READ_ONLY_FILE_TOOLS`（`read_file` / `read_image` / `glob` / `grep`）自动可读；写工具、`code_interpreter` 与跨 session 附件目录不继承。依据是用户亲手附加 = 显式意图；`.rdc`、可执行文件与 SVG 不得进入该目录。

`read_file` 的显式 `mode: audit` 沿用该工具的冻结可用性与读取权限；`path` 和 `compareWith.path` 分别提取并审批，第一路径在工程内不自动授权第二路径。执行层对两者分别 realpath/根边界校验，且校验各自预期hash；不由模型脚本直接读磁盘，不增加新工具身份或向受限reviewer授予 `read_file`。审计只返回有界字节信息和整文件比较结果，不授予编辑前置读取资格。capture拒绝、8MiB输入上限和取消合同见 runtime-kernel。

canonical knowledge 读根（**U02 落地**）：`EffectiveRuntimePlan` 在 `prepareTurn` 冻结 `knowledgeReadRoots = [realpath(~/.rdc-agent/knowledge), realpath(<projectRoot>/.rdc-agent/knowledge)]`（仅存在且为真实目录；根自身 symlink/junction → 排除 + 诊断）。`AgentPermissionPolicy` **仅**对 `read_file` / `read_image` / `glob` / `grep` 把它们并入免审批读根。`write` / `edit` / `delete` / `shell` / `code_interpreter` 在策略层与执行层双重拒绝。sibling 越界（如 `~/.rdc-agent/memory`、`~/.rdc-agent/agents`）拒。写入 Knowledge 仍只经 `knowledge_*` + human review。见 `DESIGN.md` 裁决 G。

## Electron Sandbox（Phase 6）

- BrowserWindow：`sandbox: true`。
- Preload：仅 `contextBridge` + `ipcRenderer` 受控暴露。
- Permission request：deny-by-default。
- CSP（生产）：`script-src 'self'`（**无** `unsafe-inline`）；`style-src 'self'`（**无** `unsafe-inline`）；`style-src-attr 'none'`。动态样式经 constructable stylesheet（`useDynStyle`）注入，禁止依赖 inline style attributes。

## IPC Schema（Zod）

**全量** IPC handler 经 `parseIpcArgs`（含 settings / terminal / workflow / memory / conversation / project / capture / shell / rdc-runtime / trace / web 等）。非法 payload fail-closed。`approvalToken` 单次消费（`IpcApprovalTokenService`）。契约测试：`IpcPayloadGuard.test.ts`。Renderer 读取 Investigation 正文的唯一通道是 IPC `investigation:read({ sessionId, artifactId, expectedHash })`：分类 `read`；active project/session owner gate；内部唯一调用 `InvestigationArtifactService.readRecord`；只返回既有 max-bytes 内完整 record，超限 fail-closed；不接受 URI / 绝对路径 / generic artifact。见 `DESIGN.md` 裁决 B / E。**该 IPC 已落地**。T18 知识导入已证见 `DESIGN.md` T18 已证组；产品级 Browser QA 全矩阵见 U05 / [`docs/product/acceptance-ledger.md`](../product/acceptance-ledger.md)。

## Browser Bridge（QA-only / debug-only）
- /qa is a QA bootstrap surface: the launcher logs a one-time qaBootstrap, which is consumed before minting the bridge cookie. It isolates browser origins; it is not authentication against a malicious local process.

- **定位**：Debug / QA 验收辅助面；**不进 release 包默认运行路径**。仅 `pnpm run start:agent-browser`（或 launcher `--mode browser|browser-dev`）在 `RDC_AGENT_BROWSER_QA=1` 时启动；桌面 `desktop` / 发布 exe **不得**默认打开 Bridge。
- 同产品 API、异传输：桌面 `preload → IPC` 与 Browser QA `BrowserAppBridge → HTTP/SSE` 共用 `src/shared/renderer-api` 的唯一 `ElectronAPI` 工厂、channel manifest 与 main handler registry；不是第二套 UI 或第二套能力面。
- Authoritative entry: use the complete http://127.0.0.1:<port>/qa?qaBootstrap=... URL printed by the launcher. It consumes a one-time bootstrap, mints an HttpOnly `rdcBridgeToken` cookie (`SameSite=Strict`, and `Secure` for HTTPS), and redirects to clean `/app` on the same bridge origin. In `browser-dev`, Vite is reverse-proxied through the bridge (including HMR WebSocket); bridge auth is never placed in a URL query and there is no cross-port challenge handshake.
- **鉴权**（`resolveProvidedBridgeToken`）：programmatic clients may use an explicit Bearer header（允许无 Origin）；browser navigation 与同源 fetch 使用 HttpOnly `rdcBridgeToken` cookie；事件流固定为 `POST /events`，不再使用原生 EventSource GET。Cookie 认证的 `/invoke`、`/events`、`/api/*` 要求 `Origin` 精确等于 bridge origin。Query `rdcBridgeToken|token` is never accepted. 截断/无凭证 → **401 JSON**（`Content-Type: application/json`），勿当「已打开 Workbench」。
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

## RDC Context Lease

- 仅 per-session lease：`setRdcRuntimeContextForSession` / `getRdcContextLease` / `assertRdcContextLeaseOwnership`。
- **禁止** RDC global mirror、`legacyGlobalMirror`、`getRdcRuntimeContext` 全局 API。
- 工具读上下文前必须校验 lease 所有权；空 `sessionId` fail-closed（不写任何全局镜像）。
- UI 无 session 摘要可经 `getMostRecentRdcContextLease`；工具路径仍须显式 `sessionId` + ownership assert。
- **Delegated lease**：parent 经 `grantDelegatedLease` 授予 child 一条 scoped、生命周期绑定的 delegated lease（`delegatedFrom`），使 `domainExtensions.rdc.requiresLease=true` 的 child 取得 parent RDC context 并串行；同一 parent 同时只允许一条 live delegated lease；无 parent lease 则 fail-closed，不得静默创建。child 完成/取消/抛错立即 `revokeDelegatedLease`，parent lease 不变。child lease 不可再转授。未请求 RDC 领域扩展 的 child **在 allowlist 层**就不能拿到 `rdc_context` / `rdc_probe`（`shell` 可保留，但不继承 parent lease）。禁止并发 RDC 双 owner。Mission 只读面走 `rdc_probe`，不得获得 generic shell。

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
- Settings 提供显式 trust 面板；Browser 与 Desktop 均通过相同 `rdc-runtime:trustMcp` handler 和主进程 trust 校验。

## Shell 分析

- Agent 命令工具 id 是 `shell`；解释器由 `ShellResolver` 解析（Settings 本机覆盖 → pwsh 7 → Windows PowerShell 5.1；POSIX `$SHELL`∈zsh/bash/sh/dash → zsh → bash → sh）。fish/csh/nu 等 fail-closed。全失败 `SHELL_UNAVAILABLE`。
- 灾难命令由 `shellHardDeny` 单独维护；文件/RDC 路由硬拒绝是独立规则，两者都先于权限模式求值。PowerShell 先统一 splitter（含 `&`）、折叠反引号、静态别名展开与最短唯一参数 bind，再匹配 `Remove-Item -Recurse -Force` 根路径（含 `$env:SystemDrive` / `\\?\C:\` / UNC 根 / hive 根）、`iwr|iex`（右端含 `bash`/`sh`/`pwsh`/`cmd`）、`-EncodedCommand`、嵌套 `powershell -Command` / `&` 调用运算符、launcher `-ExecutionPolicy Bypass`。cmd 覆盖 `rd /s /q`、`del /s /q`、`diskpart`、`shutdown /s`、`format`。POSIX 覆盖 `rm -rf /`、`dd if=`、`mkfs*`、`> /dev/sd|hd|nvme|xvd`、fork bomb、`chmod 777`；`sudo` 只在与这些灾难组合叠加时硬拒。allow 与 deny 都用词边界匹配。
- RDC / 通用 shell 经 `ShellInvocationService`；exitCode：`code ?? (signal ? 128+n : 1)`。
- `ShellCommandRiskAnalyzer`：结构分析 + denied 词边界与路径前缀；最高分档为 `high`，只做审批路由，没有 `critical` 档位。
- **风险分类器不是安全边界**；真正边界是 PermissionPolicy + `shellHardDeny` + 原生身份/路径等执行检查与操作系统权限。Electron renderer sandbox 不隔离主进程派生的普通 shell；不得宣称存在命令级 OS sandbox。
- shell.rdc 与 shell.command 互斥。严格合法的 search/describe/list 仅读冻结目录，按 low risk 审核；原生操作先复用执行边界验证 owning General、冻结 binding/catalog、lease、scope/effects、参数与路径。已验证的读取、测量、受控 artifact 写入及可恢复 replay 位置操作按 low risk；shader replacement 按 medium 进入独立审核，敏感配置路径按 high。未知效果、身份覆盖、非法参数或越权直接拒绝，不由审核模型补授权。实际执行再次验证，保留串行、取消、恢复及签名证据合同。
- 普通 shell 的例行/允许前缀必须覆盖每个静态简单子命令；一个 `git status` 不授权后续 `git reset --hard`。仓库脚本不因 typecheck/check 名称免审；动态展开、重定向、引用或无法确认的组合进入审核；灾难和文件/RDC 旁路硬拒绝优先。专用 Git 工具仍经原权限入口，shell 不增加 Git 权限。
- project 内普通 write_file/edit_file 可按 low risk 自动批准；执行层仍要求 realpath、无链接写入、文本大小及覆盖前同 session 成功读取。capture 输入、Git 元数据与 canonical knowledge 不作为通用写入目标；Agent/Skill/Hook/Policy/MCP/Memory、secret 与环境配置需要明确审核，不获得通用自动编辑许可。

### 独立权限审核

原生动作同时传递已经验证的冻结操作合同：说明、完整 input schema、路径参数及前置条件。审核据此解释参数的 before/after 身份语义，不从字段名称猜测；合同仅说明动作，不建立用户授权，也不替代实际执行校验。

审核复用冻结 RequestPlan、opaque credential、PromptPlan、Provider adapter 与请求快照；没有工具、Agent 身份、Task 或 RDC lease。输入包含当前精确动作、当前主进程控制与预算事实、真实 user 消息、经 hash 验证的已批准计划，以及当前隔离 slot 的有界工具观察。历史原生回执须先由主进程校验签名、hash 和归属，保留原 context/time；持久记录仅证明 bytes/schema/存在，不把其正文或 intent 自述升级为执行证明。敏感文件观察不进入审核，凭据型动作在发送前拒绝；模型的工具参数和授权自述均不是用户许可。父执行历史不泄露给隔离子执行。原生变更审核还直接取得同一冻结目录的完整能力摘要和其中已准入的 rollback 定义，复用目录查询的规范投影，不依赖历史正文是否仍在窗口内；这些只证明声明的能力边界和接口合同，不能证明当前状态、实际回滚成功或科学结论。

工具观察最多保留 16 种不同实际调用的最后结果，以工具名和实际调用参数区分；只有相同调用可替代旧观察，不把不同文件、审计选择器或目录目标合并。其中最多 8 条优先保留当前动作明确引用或实际参数键值相同的既有成功观察，再用最近观察填满；不读取其它执行历史或现场，不按领域判断重要性。参数只整理观察，不提供授权，也不将失败调用变成成功证明。实际调用参数、主进程身份、调用回执元数据分别有界传递，避免正文前缀挤掉身份；截断附原始长度与 hash。JSON 先结构化脱敏，受保护文件正文省略。文件审计的实际差异与原生结果正文随观察传递，不能仅有调用参数却声称已提供结果。该投影不推断前置条件、不重读现场、不赋予记录正文执行证明。

审核必须使用现有回执合同：签名 `evidence.kind` 只有 measurement、intervention、rollback；Experiment.executionEvidence 中的 baseline、variant、restored 是三个不同 measurement 回执的引用角色，不存在额外的 baseline kind 或工具 phase 参数。介入前核验当前实验、归属、采样条件及时间匹配的真实基线和来源/安全控制，不索取未来阶段回执；不能因为合法基线的 kind 为 measurement 就拒绝。该准入判断不追认未来执行，实验关闭仍由现有门禁检查五个不同引用、真实签名、时序、采样条件和 daemon/worker 身份。

每个待审批调用最多一次审核，30 秒上限；输入最多 32768 估算 tokens，并服从冻结模型的更紧输入预算及扣除1024输出预留后的窗口；输出最多1024 tokens。只接受终态、无工具的严格 approved/reason JSON。超限、缺路由、服务失败、非法响应、超时、取消或过期 generation 均拒绝，保留原因；不重试、不静默 fallback、不自动重启 Turn。明确 user policy floor 仍人工审批，deny 仍不可覆写。

请求尝试及实测 token 计入同 session/child 的既有 RequestSnapshot 用量；待审批工具在审核前已预留原预算，审核后重查原期限，不重置 Task、消费或批准历史。审核记录及工具结果均传递实际 rule/model/error/cancel 原因；模型批准只属于当前精确调用，不能授权后续命令或绕过执行验证。

审批事件和会话投影的可选reviewMethod只由主进程标记rule/model；errorCode只来自宿主确认的审核故障。模型仍只能返回approved/reason，理由中的代码文字不构成宿主故障。旧记录缺字段保持来源未知，不补造；不修改存储版本、风险分档、一次审核、policy floor或执行门禁。界面区分规则检查、独立审核和审核未完成，对本调用的审批拒绝/审核异常说明操作未执行；审批通过后的工具失败仍保留实际错因。模型思考强度与操作风险分别标注。

## Policy 编译

`.policy.yml` 损坏或非法 → `POLICY_INVALID` fail-closed。Project policy 只能收紧，不能放宽。Policy 优先级为 `built-in hard deny > user/project policy floor > Full access > tool metadata`；数值预算必须是非负整数，`0` 明确表示禁止任何对应执行（例如 `maxTurns: 0`、`maxWallTimeMs: 0` 返回 typed error），且该 floor 即使在 Full access 下仍生效。

Decision lattice 为 `allow < auto_review < ask_user < deny`。`approvalFloorByTool` 是该格上的下界：`user` 永远至少 `ask_user`，**不得**被 Permission Mode（含 Auto-review）降回 `auto_review`；`auto_review` 永远至少 `auto_review`。Mode 只影响 baseline，floor 与 baseline 取更严者。
- Runtime budget limits are frozen in the turn plan and enforced by one shared budget: `maxTurns`、`maxToolCalls`、`maxSubagents`、`maxChildDepth`、`maxWallTimeMs`；disabled policy files are filtered before merge. 根执行深度为 0；全部启用策略未声明 `maxChildDepth` 时默认 1，显式 0 禁止创建子代理，多个显式声明取最严格值。prepareTurn 按实际深度与继承预算冻结可见工具；深度或可创建子代理的预算耗尽时，模型声明、工具搜索和执行入口都排除新建 `subagent`，不移除既有 Task 的合法管理能力。同步、后台、重试与恢复沿用原深度和预算，不重新计数。

## 相关测试入口

- `src/main/browserAppBridge/bridgeSecurity.test.ts`
- `src/shared/renderer-api/createRendererApi.test.ts`
- `src/main/settings/SecretStorageService.test.ts`
- `src/main/settings/AgentRuntimeConfigService.test.ts`（MCP trust）
- `src/main/ipc/validation/IpcPayloadGuard.test.ts`
- `src/main/sessions/RdcRuntimeContextRegistry.test.ts`
- `src/main/agent-runtime/permissions/*`
- `src/main/testing/contracts/securityContract.test.ts`（矩阵入口）
- 门禁：`pnpm run check:orchestrator-facade`（禁止恢复 `legacyGlobalMirror` / `getRdcRuntimeContext`）


## 原生 RDC 执行证据

shell 的 command 与 rdc 互斥；ToolValidator oneOf/not 与执行入口双重检查。结构化模式仍进入 shell 的同一审批入口；low 分类须来自已验证的具体语义，不能仅凭工具名称或模型声称只读。General 之外即使 Full access 也拒绝；本机冻结配置、owning project/session lease、非 default context、非 delegated/offline child 同时成立才执行。模型不可传 capture/replay/context identity。操作权限按冻结 catalog 的 scope、effects、前置条件、参数和路径声明校验，不按命名空间授权。未知操作或影响 fail-closed；生命周期、remote、全局配置、窗口及销毁仍由应用专门入口管理。Skill 仅提供知识，不能扩权。

执行回执仅由主进程在真实原生成功调用后签名，key 在 safeStorage；模型提交的 result JSON、普通 shell 输出或 artifact hash 本身不具备 provenance。签名校验与 SessionArtifactResolver 所有权/hash 同时成立才可引用。实验关闭和新完成必须满足五阶段真实调用与同 replacement 的回滚；旧记录只保留可读性。详见 docs/architecture/rdc-runtime.md。

Skill 权限只在 prepareTurn 对预载集合取交集；skill_read 只读方法。RenderDoc 方法技能没有局部执行工具白名单；profile/policy/lease 仍强制授权。Knowledge Scout 仍只有四个 Knowledge 只读工具，文件补证属于调用方独立步骤。

## Capture 回放与足迹

`project:inputs:reference` 仅从正式 UI 登记一个外部 RDC，Browser 为 high-impact，需要 QA full access；它不授权原件写入或父目录读取。外部引用的移除 token 绑定来源类型、路径、内容 hash 和文件身份，移除只解除登记并释放绑定。Project Scope、普通文件工具和删除原件的权限不随引用扩大。

捕获操作使用显式 SessionScope，main 校验 session/project 与已登记输入。图片导出路径由 main 创建；原生返回必须匹配该精确路径，再读取图片并清理临时目录。renderer 仅收到验证后的图片，不接受任意文件路径。历史 API 校验 session/project 和 SHA-256 标识，不能越权访问其他项目。

`capture:applyReplayEvent`、`capture:refreshFrame` 为 mutation；历史读取为 read，历史清除为 high-impact。Project RDC 删除使用一次性 approvalToken；它与仅清理足迹不是同一操作。手动操作必须通过 Agent 生命周期锁和 owning native context 队列。

## 计划文件操作

plan:* 以当前查看 session + planId/revision/URI/hash 定位持久历史 tool call，由主进程解析创建 Agent 和实际 owning session；不以当前 session 配置补历史身份。导出路径由主进程原生保存对话框选定，保存到项目的路径由主进程固定计算。单次 approvalToken 绑定 action、viewer/owner、计划身份、URI/hash 和规范化目标，确认后复验；不接受 renderer 更换目标，不沿链接写入。取消不签发 token，写盘原子提交并验证，失败保留原文件。

## 专用工具路由与读取前置

文件路由表独立于灾难 shellHardDeny 表，均在权限模式和自定义允许前缀之前求值；Full access 不能绕过。有效工具集合有对应工具时，shell.command 文件读写/搜索返回 SHELL_FILE_TOOL_BYPASS，命令行 RDC 返回 RDC_VIA_COMMAND_DENIED。edit_file 和覆盖已有文件的 write_file 必须先在同一 session 成功 read_file 同一 realpath，否则 READ_BEFORE_EDIT_REQUIRED。已读状态跨 turn、仅内存持有，重启须重读；子 session 不继承。新建文件免先读。

Agent 只绑定同安装捆绑 python.exe 的绝对路径与 cli/run_cli.py；旧 bat 和 PowerShell 转发返回 RDC_BAT_REJECTED，不迁移、不 fallback。旧配置仍可打开修正，但不能执行。
