# 权限与安全边界

> 产品不变量以 `ARCHITECTURE.md` 为准。失败分类见 [`failure-model.md`](failure-model.md)。本文描述 **Permission / Electron Sandbox / IPC / Browser Bridge / Secret / MCP trust / Shell** 稳定边界。

## Permission Mode

Composer 暴露：`Default`、`Auto-review`、`Full access`、`Custom`。主进程 `AgentPermissionPolicy` 为权威，结合 profile 天花板、permission mode、workspace root、tool metadata、`CompiledPolicy`。可读根、可写根、允许/拒绝命令前缀只在 Custom 生效，在 Settings 的 Custom 规则中编辑；保存等待主进程确认，不乐观生效。

- `Default`：例行 workspace 只读可自动；外部文件、网络、变更、破坏性 shell、未知命令需审批。没有打开项目时不存在 workspace，任何文件读取与 shell 都需审批。
- `Auto-review`：先由宿主准入。确定性规则与准入事实能定的按规则批准或拒绝，已批准计划的授权覆盖且事实全部成立的动作直接执行；其余提交一次独立、无工具的模型审核，模型无法判断时只弹一张绑定本次调用的人工批准卡。没有有效批准不执行；不切换到 Full access，也不改动权限模式（见「自动审查」）。
- `Full access`：显式信任本地文件与命令；仍受 primitive 硬约束（二进制/`.rdc`、realpath、灾难 shell、SSRF）。capture、Git 元数据、规范 Knowledge 与应用自有文件在任何挡位都不是写入目标；写入受保护的配置或凭据路径在 Full access 下仍需用户确认。
- `Custom`：在 Default 的审批规则之外，使用已确认的可读根、可写根和命令前缀。这些列表对 Default 与 Auto-review 无效；网络工具仍需审批。Full access 仍不能越过 profile 天花板。

工具按 observe / record / mutate / execute 分类（`src/shared/constants/toolAccess.ts`）；`read-only` = observe + record，`workspace-write` 再加 mutate，`full` 再加 execute；未知工具与 MCP 按 execute；Full access 权限模式不能抬高 profile 天花板；原生 `shell.rdc` 要求 `full`。

天花板只会收紧，不会被继承或覆盖放宽：

- **子代理**：子代理以 `min(委派回合冻结的天花板, 目标 profile 天花板)` 运行；同步、后台执行都在委派时取父回合 `EffectiveRuntimePlan.accessCeiling` 并随执行携带，缺少冻结计划的委派以 `SUBAGENT_PARENT_PLAN_REQUIRED` 拒绝。
- **项目 profile**：覆盖 user/builtin 同 id profile 时不得超过被覆盖者的天花板；项目新增的 profile 上限为 `workspace-write`。声明超出上限时按上限运行并给出 `AGENT_PROJECT_CEILING_NARROWED` 诊断。

工具在定义处声明效果（`AgentTool.effects`：读路径参数、写路径参数、glob 前缀参数、是否联网），`AgentPermissionPolicy` 只读这些声明，不按工具名推断。写路径在任何挡位先经 `fileOperationBoundary`（工程内目标经 realpath 且拒绝 symlink）；只读目标拒绝，受保护目标需审批。

应用自有文件对任何文件工具与 RDC 写入都只读，Full access 也不例外，因为写它们等于伪造历史或替自己扩权：

- 凭据目录：`<userData>/secrets/**` 与 `~/.rdc-agent/secrets/**`。
- 用户设置：`~/.rdc-agent/config.json`，只经 Settings 写入。
- 应用根下的 `*-trust.json`：只由授予信任的人写入。
- `<userData>/state/**`（审计日志、会话记录、trace 等）；唯一例外是 `sessions/**/artifacts/**`，那是工具产出运行制品的位置。

这条边界约束的是声明了路径效果的工具。Shell 在 Full access 下按命令信任执行，命令内部的重定向或子进程写盘不经路径检查，这是 Full access 的系统性局限；需要硬边界时使用 Default、Auto-review 或 Custom。

读取另有一条任何挡位都生效的硬边界：`<appStateRoot>/crash` 下的 minidump（进程内存快照，可能含解密后的 provider 密钥）与凭据目录（`<userData>/secrets`、`~/.rdc-agent/secrets`）不经任何 agent 文件工具读取、复制、移动、搜索或列出（`assertFileReadBoundary` / `fileReadProtection`，`FILE_READ_PROTECTED`）。比较用 realpath 拼写，路径中的符号链接另由 `safeResolvePath` 拒绝，目录遍历不跟随链接。Shell 不在这条边界内：Full access 下的命令仍能读取这些文件，这是同一系统性局限。未声明效果的工具按访问类别：observe / record 自动，mutate / execute 需审批。

Browser QA 代答 `conversation:answerPlanReview`、`conversation:answerToolApproval`、`conversation:answerUserInput` 属于 high-impact，只在 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1` 时放行。桌面 IPC 不受该环境变量限制。

### 在途权限切换

挡位 mode 是主进程确认的全局授权事实，覆盖所有活动会话及前后台子 Agent。Settings 成功持久化后同步发布新的 mode/revision，再确认切换成功；同值不递增，保存失败不生效。读取/写入根、命令规则、工具目录、Profile/Skill 交集、CompiledPolicy、预算、Provider 路由及 RDC 身份仍在 prepareTurn 冻结。切到 Custom 使用本轮冻结规则，规则修改在新轮生效。

每个工具在审批、前置 Hook、项目锁及全局不安全锁等待后同步复核版本、消费许可并记录准入；这段提交不得包含 await 或可重入扩展。模型生成、scheduler 派发或排队不等于准入。锁内发现旧许可须先释放资源，再按最新版本重授权；不能持锁等待人工或模型审核。一次调用只保留一次预算和前置 Hook，不因重授权重复执行。并行工具逐调用准入，子 Agent 调度本身不持资源锁，子工具自行检查最新挡位和自身冻结限制。

切挡取消旧 pending 审批/审核，记录 cancelled 和 PERMISSION_MODE_CHANGED；原工具调用身份不变，每次新请求使用唯一审批身份。旧回答和迟到审核不能执行。已批准的历史事件保持不变，但未消费的旧版本许可失效；用户拒绝、审核拒绝和失败保持终态，不因切挡复活。审批与切挡竞争以主进程先合法结算的结果为准。同一 revision 内只有一次有效审核；非切挡原因的失败不自动重试、改人工或提权，已发生审核用量照实记录。

已准入操作继续，包括 tool.execute 内部后续 await、长命令和后台进程。切挡不自动终止，也不撤销已有副作用；Stop/task_stop、会话删除及退出继续走 cancel/join 和进程退出回执。计划批准、ask_user、Knowledge/Memory 专门确认和安全 IPC token 不随挡位自动代答。Full access 不能突破硬拒绝、policy/user floor、Capsule/Profile/Skill、预算或 owning lease。

模型每次实际 Provider 请求前读取主进程权限事实；静态 PromptPlan 不保存易过时的当前挡位，模型流不中断。动态上下文不授权工具，最终执行准入仍为权威。

Work Process 必须展示真实 `Requested approval` / `Approved` / `Denied` / `Auto-reviewed`，不得把策略暂停伪装成普通失败 shell。

Temporary 外部路径许可仅绑定当前 `ToolExecutionContext.temporaryAllowedPathRoots`。

当前 session 的 `{sessionPath}/attachments` 作为 scoped readable root 注入 `AgentPermissionPolicy.sessionAttachmentsRoot`。仅声明读效果且不写的工具（`read_file` / `read_image` / `glob` / `grep`）自动可读；写工具、`code_interpreter` 与跨 session 附件目录不继承。依据是用户亲手附加 = 显式意图；`.rdc`、可执行文件与 SVG 不得进入该目录。

`read_file` 的显式 `mode: audit` 沿用该工具的冻结可用性与读取权限；`path` 和 `compareWith.path` 分别提取并审批，第一路径在工程内不自动授权第二路径。执行层对两者分别 realpath/根边界校验，且校验各自预期hash；不由模型脚本直接读磁盘，不增加新工具身份或向受限reviewer授予 `read_file`。审计只返回有界字节信息和整文件比较结果，不授予编辑前置读取资格。capture拒绝、8MiB输入上限和取消合同见 runtime-kernel。

canonical knowledge 读根：`EffectiveRuntimePlan` 在 `prepareTurn` 冻结 `knowledgeReadRoots = [realpath(~/.rdc-agent/knowledge), realpath(<projectRoot>/.rdc-agent/knowledge)]`（仅存在且为真实目录；根自身 symlink/junction → 排除 + 诊断）。

- `AgentPermissionPolicy` **仅**对 spec 声明 `knowledgeRoots: 'read-access'` 的工具（内置为 `read_file` / `read_image` / `glob` / `grep`）把它们并入免审批读根。
- `write` / `edit` / `delete` / `shell` / `code_interpreter` 在策略层与执行层双重拒绝。
- sibling 越界（如 `~/.rdc-agent/memory`、`~/.rdc-agent/agents`）拒。
- 写入 Knowledge 仍只经 `knowledge_*` + human review。
- 见 `ARCHITECTURE.md` 裁决 G。

### 权限特征来自工具 spec

权限层不按工具名分支，只读被评估工具自己声明的 `AgentTool.spec`（特征表见 runtime-kernel 契约「工具行为」），与执行器同一来源：

| spec 特征 | 权限层的用法 |
|---|---|
| `shellCommand` | 该参数的命令文本先过灾难硬拒绝与文件工具绕行检查（任何模式都先于权限求值），再按自定义拒绝/允许前缀、风险分析、工作区外路径与例行命令集分级；内置只有 `shell` 声明 |
| `capture.nativeOperation` | 原生 RDC 操作（`shell.rdc`）交给注册的 RDC 操作策略判定，再取 policy 审批下限 |
| `capture.replayLifecycle` | 改变 owning 回放的步骤（`rdc_probe` 的 `capture_select` / `capture_restore` / `capture_recover`）要求 `full` 天花板，按模式审批；自动审查时由准入事实判定，已批准计划的 `captureScope` 即其授权，回放此刻能否改变读获批 capture 控制器的 `readiness()` |
| `knowledgeRoots: 'read-access'` | 冻结的 Knowledge 读根并入本次调用的免审批读根 |

自动审查先按被审工具的 spec 交给领域适配器计算准入事实；送审时把待审动作（工具名、参数、原因、操作事实与准入事实）原样发给审核模型，spec 本身不发送。工具访问分类（`src/shared/constants/toolAccess.ts`）与 policy 的工具名单仍按名称，它们是按名称声明的配置而非工具行为。

## Electron Sandbox

- BrowserWindow：`sandbox: true`。
- Preload：只经 `contextBridge` 暴露 `rdcIpc`（`invoke` / `subscribe`，逐次核对通道在 canonical manifest 内）与 `rdcDesktop.getPathForFile`；类型化的 `ElectronAPI` 在 renderer 内由 `createRendererApi` 构造。
- Permission request：deny-by-default。
- 导航：窗口只加载应用入口（开发服务器按 origin，打包按精确入口文件）；其它链接、重定向与拖入窗口的本地页面一律拒绝，不附加 webview。
- IPC：每次 invoke 先核对发送方文档是应用入口，否则 `IPC_SENDER_REJECTED`；Browser QA 桥独立认证后直接调用已登记的处理器。处理器失败统一以错误结果返回（code、params、分类、脱敏后的技术文本），见 `failure-model.md`「错误契约」。
- 外部链接：账号与登录页只经 https 打开（`EXTERNAL_URL_REJECTED`）。
- **出网**：主进程取公网内容只有一个入口 `src/main/runtime/net/publicEgress.ts` 的 `fetchPublic`，`web_fetch`、`web_search`、`web:fetchImage` 与 favicon 都经它。每一跳（含重定向）先校验协议与主机，再解析 DNS 并把连接 pin 到已校验的地址；任一解析地址落在非公网段就拒绝，请求不发出；不带 cookie，接收阶段即限制字节数。非公网判定是一张表（`publicAddress.ts`）：
  - IPv4：`0/8`、`10/8`、`100.64/10`、`127/8`、`169.254/16`、`172.16/12`、`192.0.0/24`、`192.0.2/24`、`192.88.99/24`、`192.168/16`、`198.18/15`、`198.51.100/24`、`203.0.113/24`、`224/4`、`240/4`。
  - IPv6：只有 `2000::/3` 是公网，其中再排除 `2001:db8::/32` 与 `3fff::/20`；`::ffff:0:0/96`、`::/96`、`64:ff9b::/96`、`2002::/16` 按内嵌的 IPv4 地址判定。
  - Provider、OAuth 与 MCP 的 HTTP 端点由用户配置，可以是本机服务，不经这条公网通道。
- **Shell routine**：只有静态简单命令（无引号、变量、子 shell、重定向）且每个参数都留在工作区内时，才按 routine 自动放行。工作区外的绝对路径、盘符根或盘符相对路径（`D:`、`D:/`）、UNC（`//host/share`）、`~`、`..`、PowerShell provider 驱动器（`Env:`、`HKLM:` 等）逐个 token 判定，任何一个出界就改为审批；命令里另外出现工作区路径不能抵消。
- CSP（生产）：`script-src 'self'`（**无** `unsafe-inline`）；`style-src 'self'`（**无** `unsafe-inline`）；`style-src-attr 'none'`；`img-src 'self' data: blob:` 不放行远程主机，回答里的远程图片由主进程 `web:fetchImage` 代取（仅 https 公网地址、≤5MB、按内容嗅探、不带 cookie）。
  - `web:fetchImage` 先过 active-session 门；`intent: 'auto'` 只放行在本会话非模型来源（用户消息、`web_fetch` / `web_search` / knowledge 工具结果）里出现过的 URL，其余 URL 不发请求、渲染为占位，用户点击后以 `intent: 'click'` 代取，取之前先写 `network` 审计记录（主机与 URL 指纹，写失败即不取）；`connect-src 'self'`；`media-src 'self' blob:` 只播放 `conversation:resolveMedia` 解析出的会话产物、附件与项目内视频。
  - 动态样式经 constructable stylesheet（`useDynStyle`）注入，禁止依赖 inline style attributes。
  - 开发态 CSP（放行 Vite 开发服务器与 `unsafe-eval`）只在未打包的源码运行且 `NODE_ENV=development` 时使用；打包版无论环境变量如何都用生产 CSP（`src/main/runtime/developmentRun.ts`）。

## IPC Schema（Zod）

**全量** IPC handler 经 `parseIpcArgs`（含 settings / terminal / workflow / memory / conversation / project / capture / shell / rdc-runtime / trace / web 等）。

- 非法 payload fail-closed。
- `approvalToken` 单次消费（`IpcApprovalTokenService`）。
- 契约测试：`IpcPayloadGuard.test.ts`。
- Renderer 读取 Investigation 正文的唯一通道是 IPC `investigation:read({ sessionId, artifactId, expectedHash })`：分类 `read`；active project/session owner gate；内部唯一调用 `InvestigationArtifactService.readRecord`；只返回既有 max-bytes 内完整 record，超限 fail-closed；不接受 URI / 绝对路径 / generic artifact。
- 见 `ARCHITECTURE.md` 裁决 B / E。
- 产品级 Browser QA 的现场证据见 [`docs/product/acceptance-ledger.md`](../product/acceptance-ledger.md)。

## Browser Bridge（QA-only / debug-only）
- /qa is a QA bootstrap surface: the launcher logs a one-time qaBootstrap, which is consumed before minting the bridge cookie. It isolates browser origins; it is not authentication against a malicious local process.

- **定位**：Debug / QA 验收辅助面；**不进 release 包默认运行路径**。仅 `pnpm run start:agent-browser`（或 launcher `--mode browser|browser-dev`）在 `RDC_AGENT_BROWSER_QA=1` 时启动；桌面 `desktop` / 发布 exe **不得**默认打开 Bridge。
- 同产品 API、异传输：桌面 `preload → IPC` 与 Browser QA `BrowserAppBridge → HTTP/SSE` 共用 `src/shared/renderer-api` 的唯一 `ElectronAPI` 工厂、channel manifest 与 main handler registry；不是第二套 UI 或第二套能力面。
- Authoritative entry uses the complete http://127.0.0.1:<port>/qa?qaBootstrap=... URL printed by the launcher. It consumes a one-time bootstrap, mints an HttpOnly `rdcBridgeToken-<port>` cookie (`SameSite=Strict`, and `Secure` for HTTPS), and redirects to clean `/app` on the same bridge origin. In `browser-dev`, Vite is reverse-proxied through the bridge (including HMR WebSocket). The bridge accepts no bearer credentials from URL queries.
- **鉴权**（`requireBridgeAuth`）：programmatic clients may use an explicit Bearer header（允许无 Origin）。Browser navigation 与同源 fetch 使用当前端口对应的 HttpOnly Cookie。事件流固定为 `POST /events`。Cookie 认证的 `/invoke`、`/events`、`/api/*` 要求 `Origin` 精确等于 bridge origin。缺少或无效凭证返回 **401 JSON**（`Content-Type: application/json`）。
- Channel capability（`src/shared/renderer-api/channels.ts` 的 `RENDERER_INVOKE_CHANNEL_TABLE` + `pnpm run check:browser-capability`）：通道表每行同时声明 invoke channel 名与 capability，`RendererInvokeChannel` 由表派生，每个 invoke channel 恰好一类 — `read`/`mutation` 默认允许；`high-impact` 需 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`；`desktop-only`（window chrome 等）永拒。
  - 未知 channel 运行时 fail-closed。
  - `dialog:*` / `app:copyText` / `app:openPath` 属 mutation（Browser QA 加项目/选文件需要）。
  - `app:readClipboardText` 属 `read`，只在可编辑右键菜单判定粘贴 disabled 时读取一次。
- Cookie 认证的 `/invoke`、`/events`、`/api/*` 要求 `Origin` 精确等于 bridge origin。`browser-dev` 反代 Vite 时剥离 `cookie` / `authorization` / `proxy-authorization` / `x-rdc-*`。
- 精确 Origin allowlist（仅 bridge origin）；仅 canonical renderer channel 且存在已注册 handler 时可调用。未知 channel、内部 channel、未注册 handler 与不存在的明文 `settings:getProviderSecret` → 403。
- **完整产品面 parity**：Settings、Models Override、Runtime Log、Memory、Command、Tool Approval、MCP 状态、Hook/MCP trust/revoke/test 等 preload 已公开能力在 Browser 中走同一 main-owned Zod、PermissionPolicy、单次 approval token、MCP trust 与 `safeStorage` 边界；Browser 不保留拒绝桩或专用禁用 UI。完整矩阵见 [`docs/architecture/browser-qa-surface.md`](../architecture/browser-qa-surface.md)。
- Browser QA / Browser-dev 默认使用经过路径校验的 disposable `os.tmpdir()/rdc-agent/qa-*` userData，并在退出时清理；显式 `RDC_AGENT_USER_DATA` 或 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 才使用 canonical userData。`instance.lock` 冲突 fail-closed，禁止静默切换到空配置。
- Smoke：`pnpm run smoke:agent-browser`（假定 bridge 已起或脚本拉起；**不**并入默认 release pack）。
- 实现：`src/main/browserAppBridge/bridgeSecurity.ts`、`BrowserAppBridgeServer.ts`；测试：`bridgeSecurity.test.ts`、`BrowserAppBridgeServer.contract.test.ts`。

## Secret Isolation

- `safeStorage` 不可用 → fail-closed（不得明文落盘）。Linux 上没有系统钥匙环时的 `basic_text` 后端（以及尚未选定的 `unknown`）视为不可用，见 [`../architecture/host-platform.md`](../architecture/host-platform.md)。
- 对外查询仅 `{ hasSecret, maskedPreview? }`；不得返回明文。
- 损坏的凭据文件每次读都报 `STORAGE_CORRUPT`（不读成空，凭据不会被静默丢弃）；文件以 0600 原子写入，Windows 另加 ACL。
- Credential 仅进入主进程 opaque lease，不进 manifest / Route / RequestPlan / IPC / Trace。
- 落盘与可见投影统一走 `src/main/runtime/secretRedaction.ts`：凭据类字段名（api key、authorization、password、secret、private key、cookie、各类 `*_token` 与 `token`）整值替换；文本中识别 Bearer、`sk-`/`sk-ant-`/`xai-`/Slack `xox?-`、GitHub `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/`github_pat_`、AWS `AKIA`/`ASIA`、Google `AIza`、JWT 与 PEM 私钥块。工作过程里任何工具的 `argsPreview` 都经 `redactedArgumentsPreview`，主回合与子代理不分两条路径。

## 主进程确认与审计

- **主进程确认**：知识写入/提升/导入、记忆写入/删除、计划写入/导出、hook / MCP / 项目 Agent 的 trust，都由主进程原生对话框确认（`src/main/window/mainConfirmation.ts`，默认按钮为取消）；renderer 请求本身不构成批准，没有聚焦窗口时一律不确认。唯一例外是未打包 Browser QA 显式 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1` 且无窗口，自动确认并写运行日志；判定只在 `src/main/runtime/browserQaRun.ts` 的 `isBrowserQaFullAccessRun`，打包构建（`app.isPackaged`）不论环境变量如何都不自动确认。项目输入删除确认（`src/main/ipc/projectInputLifecycleHandlers.ts`）使用同一判定。取消 trust 返回未变化的状态。
- **审计日志**：`<userData>/state/audit.jsonl` 只追加、不改写、不裁剪，每行带 `at` 与 `origin`（`desktop` / `browser-qa` / `runtime`）。参数只记指纹不记内容。记录内容：
  - 每次 high-impact IPC 调用：执行前一条 `outcome: requested`，执行后一条 `ok` 或 `error`（带错误码）。
  - 每个工具决定：策略放行与拒绝、用户批准与拒绝、自动审查结论，含工具名、调用 id、参数 sha256、风险。
  - 权限设置的前后值。
- **先记录后生效（fail-closed）**：决定记录写入失败时抛 `AUDIT_WRITE_FAILED`，它描述的动作不发生——IPC handler 不执行，工具不执行，用户的批准不生效（审批保持待答），自动审查按拒绝结算，权限设置不写盘。IPC 的结果记录写在动作之后，此时动作已经发生，写失败只报 stderr，不把成功的调用改报为失败。

## RDC Context Lease

- 仅 per-session lease：`setRdcRuntimeContextForSession` / `getRdcContextLease` / `assertRdcContextLeaseOwnership`。
- **禁止** RDC global mirror、`legacyGlobalMirror`、`getRdcRuntimeContext` 全局 API。
- 工具读上下文前必须校验 lease 所有权；空 `sessionId` fail-closed（不写任何全局镜像）。
- UI 无 session 摘要可经 `getMostRecentRdcContextLease`；工具路径仍须显式 `sessionId` + ownership assert。
- **Delegated lease**：parent 经 `grantDelegatedLease` 授予 child 一条 scoped、生命周期绑定的 delegated lease（`delegatedFrom`），使 `domainExtensions.rdc.requiresLease=true` 的 child 取得 parent RDC context 并串行；同一 parent 同时只允许一条 live delegated lease；无 parent lease 则 fail-closed，不得静默创建。
  - child 结束后须携带实际停止证明调用 `revokeDelegatedLease`；缺证明或存在 quarantine 时隔离 parent lease。
  - child lease 不可再转授。
  - 未请求 RDC 领域扩展的 child **在 allowlist 层**不能拿到 `rdc_probe`（`runtime_context` 保留但不返回 rdc 载荷；`shell` 可保留，但 `shell.rdc` 在执行入口拒绝，且不继承 parent lease）。
  - 禁止并发 RDC 双 owner。
  - Mission 只读面走 `rdc_probe`，不得获得 generic shell。

## Hook Trust

- Hook trust fingerprint = parsed definition + 所有 resolved 脚本/参数文件 bytes + canonical realpath + scope/provenance + PATH 解析后的 executable identity。任一变化 → `needsRetrust`。
- builtin 默认信任且内容变化必须随仓库发布，其指纹只是 `builtin:<sourceHash>`，不哈希它启动的运行时（即应用自身的 Electron 可执行文件）；user/project 必须显式 trust。
- 12 canonical events 保持单一 `HookEngine` 路径。见 `ARCHITECTURE.md` 裁决 K。
- 信任记录存于 `hook-trust.json`，与 MCP、Agent 信任共用 `TrustStore`（`{ records }`，不带格式版本），匹配只认 `trustFingerprint`；损坏或其他格式写下的文件作为无效 hook 文件上报，重新 trust 后覆盖。

## Project Agent Trust

- 随项目到来（clone、pull、解压）的 `.rdc-agent/agents/*.agent.md` 在信任前不加载，同 id 的 user/builtin profile 照常生效；Settings → 智能体的诊断给出 `AGENT_PROJECT_UNTRUSTED`，用户查看完整文件后信任。
- 信任绑定 `realpath(projectRoot) + agentId + 文件 bytes`（`agent-trust.json`）；在 Settings 之外改动文件即失效。用户通过 Settings 保存、导入或写入的项目 profile 按写入的 bytes 自动信任；删除时撤销。
- `settings:trustProjectAgent` 只接受主进程当前快照里确有该诊断的文件，并核对用户查看时的 `sourceHash`；文件在查看后变化 → `AGENT_OVERRIDE_CHANGED`。

## MCP Trust

- Project MCP 与 user 同 ID 时，不可覆盖 user 的 `command` / `args` / `url` / `env`。
- Project MCP trust fingerprint 与 hook 同构：descriptor + 声明文件 realpath + PATH 解析后的 executable identity + 参数所指文件的 bytes（相对参数按项目真实路径解析）。任一变化 → `needsRetrust`；`assertConnectAllowed` 在连接时重新计算，不信任设置快照。记录存于 `mcp-trust.json`，形状不符读作无信任。
- MCP 连接池按 `realpath(projectRoot) + projectId + descriptorHash` 分组；失败缓存指数退避（retryable→permanent）；orphan process quarantine 至 supervised.exit。Transport 仅 `stdio` / `streamable-http`；`sse` → `MCP_TRANSPORT_UNSUPPORTED`。
- Settings 提供显式 trust 面板；Browser 与 Desktop 均通过相同 `rdc-runtime:trustMcp` handler 和主进程 trust 校验。信任对话框列出定义文件、连接方式、完整命令与参数、连接地址和传入的环境变量名（不显示变量值），用户看到的就是将要运行的东西。
- **路径归属**：`rdc-runtime:*` 收到的 `projectRoot` 必须是已登记的项目根，否则以 `PROJECT_ROOT_UNKNOWN` 拒绝，主进程不在任意目录下读取、建脚手架或授予信任。需要文件路径的写出与导入由主进程自己弹对话框取得：`knowledge:export` 弹保存对话框，`rdc-runtime:import` 弹打开对话框（按资源类型过滤扩展名），renderer 只提出请求，不提供路径；取消时返回 `null`。

## Shell 分析

- Agent 命令工具 id 是 `shell`；解释器由 `ShellResolver` 解析（Settings 本机覆盖 → pwsh 7 → Windows PowerShell 5.1；POSIX `$SHELL`∈zsh/bash/sh/dash → zsh → bash → sh）。fish/csh/nu 等 fail-closed。全失败 `SHELL_UNAVAILABLE`。
- 灾难命令由 `shellHardDeny` 单独维护；文件/RDC 路由硬拒绝是独立规则，两者都先于权限模式求值。
  - PowerShell 先统一 splitter（含 `&`）、折叠反引号、静态别名展开与最短唯一参数 bind，再匹配 `Remove-Item -Recurse -Force` 根路径（含 `$env:SystemDrive` / `\\?\C:\` / UNC 根 / hive 根）、`iwr|iex`（右端含 `bash`/`sh`/`pwsh`/`cmd`）、`-EncodedCommand`、嵌套 `powershell -Command` / `&` 调用运算符、launcher `-ExecutionPolicy Bypass`。
  - cmd 覆盖 `rd /s /q`、`del /s /q`、`diskpart`、`shutdown /s`、`format`。
  - POSIX 覆盖 `rm -rf /`、`dd if=`、`mkfs*`、`> /dev/sd|hd|nvme|xvd`、fork bomb、`chmod 777`；`sudo` 只在与这些灾难组合叠加时硬拒。
  - allow 与 deny 都用词边界匹配。
- RDC / 通用 shell 经 `ShellInvocationService`；exitCode：`code ?? (signal ? 128+n : 1)`。
- `ShellCommandRiskAnalyzer`：结构分析 + denied 词边界与路径前缀；最高分档为 `high`，只做审批路由，没有 `critical` 档位。
- **风险分类器不是安全边界**；真正边界是 PermissionPolicy + `shellHardDeny` + 原生身份/路径等执行检查与操作系统权限。Electron renderer sandbox 不隔离主进程派生的普通 shell；不得宣称存在命令级 OS sandbox。
- shell.rdc 与 shell.command 互斥。
  - 严格合法的 search/describe/list 仅读冻结目录，按 low risk 审核；原生操作先复用执行边界验证 owning root 的 full 天花板 profile、冻结 binding/catalog、lease、scope/effects、参数与路径。
  - 已验证的读取、测量、受控 artifact 写入及可恢复 replay 位置操作按 low risk；shader replacement 等可逆干预按 medium 进入准入（见「自动审查」），敏感配置路径按 high。
  - 未知效果、身份覆盖、非法参数或越权直接拒绝，不由审核模型补授权。
  - 实际执行再次验证，保留串行、取消、恢复及签名证据合同。
- 普通 shell 的例行/允许前缀必须覆盖每个静态简单子命令；用户允许 `git status` 不授权后续 `git reset --hard`。
  - shell 里的 git 不属于例行命令：仓库配置可以指定 git 运行的程序。
  - 仓库脚本不因 typecheck/check 名称免审；动态展开、重定向、引用或无法确认的组合进入审核；灾难和文件/RDC 旁路硬拒绝优先。
  - 专用 Git 工具以命令行配置覆盖 fsmonitor、hooks、外部 diff 与 sshCommand，仓库本地配置声明可执行程序（fsmonitor、hooksPath、textconv、filter、include 等）时拒绝执行；shell 不增加 Git 权限。
- project 内普通 write_file/edit_file 可按 low risk 自动批准；执行层仍要求 realpath、无链接写入、文本大小及覆盖前同 session 成功读取。capture 输入、Git 元数据与 canonical knowledge 不作为通用写入目标；Agent/Skill/Hook/Policy/MCP/Memory、secret 与环境配置需要明确审核，不获得通用自动编辑许可。

### 自动审查

准入决定发生在人在场的时候：用户批准计划时，就决定了调查和其中的干预要不要做。之后每次动作只做宿主的确定性检查，模型只处理检查覆盖不到的语义余量，上下文小而稳定。

| 关口 | 回答的问题 | 依据 |
|---|---|---|
| 计划批准（人） | 这次调查和其中的干预要不要做 | 计划正文与授权清单 |
| 准入（规则为主，模型处理余量） | 这个具体动作是否在已批准授权内且可逆 | 宿主核验的结构化事实（文本） |
| 独立审查员 | 证据是否支撑结论 | 原始证据，含图像 |

**决定链**（`src/main/agent-runtime/permissions/PermissionAdmission.ts`）只在决策为 `auto_review` 时运行，决策格与 floor 不变：

1. 本回合同一动作（工具名与参数 sha256）此前被拒且事实未变，或曾被人工拒绝：按规则拒绝，不再送审。
2. 没有领域适配器认得的动作：已验证的低风险动作按规则批准，其余送模型。
3. 任一事实不成立：按规则拒绝，并指名不成立的检查项。宿主核实不了的事实也算不成立，因为只看文本的模型同样核实不了宿主状态，所以这类事实从不送模型。
4. 授权覆盖且全部事实成立：按规则批准。
5. 授权未覆盖的动作送模型判断语义余量，事实随动作一起提交。

检查项是封闭枚举（`src/shared/constants/admissionChecks.ts`），每项带补救方：`agent` 是 Agent 能补上的事实，`host-or-user` 是宿主或用户的前置条件。拒绝以结构化工具结果返回：`AUTO_REVIEW_DENIED`、每个检查项及其补救方、出口（人工批准或调整权限模式）。

| 检查项 | 含义 | 补救方 |
|---|---|---|
| `authorized` | 计划授权该动作 | host-or-user |
| `target-matches` | 目标与授权一致 | host-or-user |
| `effects-bounded` | 效果在授权范围内 | host-or-user |
| `identity-current` | 现场身份有效、独占 owning 回放 | host-or-user |
| `baseline-recorded` | 基线有效 | agent |
| `source-bound` | 修改绑定所替换的源 | agent |
| `rollback-available` | 冻结目录可以回滚 | host-or-user |
| `prior-reverted` | 上一次批准的修改已撤回 | agent |
| `instances-remaining` | 仍有授权次数 | host-or-user |

**领域适配器**由 RDC 模块在启动时注册（`src/main/rdc/rdcAdmission.ts`），领域词汇只出现在适配器里：

- 回放生命周期：
  - 已批准计划的 `captureScope` 就是授权；`capture_select` 的输入还须在范围内。
  - 回放此刻能否改变，读获批 capture 控制器的 `readiness()`，与执行层和 Capture 面板读的是同一个答案：lease 被隔离时只放行 `capture_recover`，其余一律按规则拒绝。
  - 只有获批 General 的 owning 回合在 `full` 天花板下才能改变回放。
  - 回到签名原位的 `capture_restore` 风险为 low。实际恢复准入仍由执行时的 `classifyRecovery` 判定。
  - 没有获批计划或 capture 控制器时按规则拒绝。
- 可逆干预（如 shader 替换）：
  - 本回合独占 owning 回放；同一 experimentId 在当前回放上有已签名的基线测量；操作合同声明源 hash 参数时，修改须绑定所替换源的 hash；冻结目录有可用回滚覆盖该效果。
  - 授权项覆盖时，另查效果不超出授权、批准之后已签名的干预回执数低于上限，以及 `rollback-before-next` 下上一次修改已撤回。
  - 没有授权项、或授权项针对另一个目标的同一操作，记为授权未覆盖并送模型判断：计划不可能事先知道调查会落到哪一个 draw。
- 带受保护路径输入的原生操作不由适配器判定，按原审核路径处理。

**计划授权清单**：`plan_artifact.authorizations` 逐项声明冻结目录中的 intervention 操作、目标（`eventId`／`stage`／`shaderId`，各须等于动作参数）、效果类别、可逆性要求（`rollback-available` 或 `rollback-before-next`）和授权次数上限（1–16；是被授权的效果实例数，不是阶段配额）。

- 计划门逐项核对它不超过静态策略：每个声明的执行目标都是 `full` 天花板；policy 不拒绝原生操作，也不对其设 user floor；操作在冻结目录中、是 replay 范围的 intervention 且能力可用；授权的效果覆盖它的全部非例行效果；有可用回滚；目标字段是该操作的合法参数；计划同时声明 `captureScope`。任一不满足即以 `PLAN_AUTHORIZATION_INVALID` 拒绝整份计划并说明原因。
- 授权项写入宿主生成的调查合同附录，随计划 hash 冻结；修订计划会清除 offer，授权随之失效。计数由宿主从持久的签名回执推导。
- 授权只收窄自动审查可以直接放行的范围，不抬高 profile 天花板、policy、权限模式或工具元数据；Default 下仍逐次询问。计划门与计划阅读器用人话列出授权项，目录名与标识不上界面。

**模型审核**（`src/main/agent-runtime/permissions/PermissionReviewRuntime.ts`）是一次独立、无工具的请求，没有 Agent 身份、Task 或 RDC lease。

- 规则只判断动作与已批准授权一致且可逆：已批准计划的前提采信，不重新验证；输入只有文本和截断摘录，不得因看不到图像或完整反汇编而拒绝；宿主事实是权威。
- 判决是严格封闭的 `{ verdict: allow | deny | undecidable, failedChecks, reason }`：allow 不列检查项，deny 与 undecidable 至少列一项；reason 写给用户，不含 ID、哈希或 URI。界面以本地化的检查项呈现拒绝，模型原文只进原始回执。
- 原生动作同时传递已验证的冻结操作合同（说明、完整 input schema、路径参数及前置条件），审核据此解释参数语义，不从字段名猜测；合同不建立用户授权，也不替代执行校验。

**无法判断**：判决为 `undecidable` 时弹一张人工批准卡，说明审核无法确认的检查项，绑定本次调用、单次有效。人工拒绝即终局，同一动作在本回合不再送审，也不再弹卡。任何情形都不切换到 Full access，也不改动权限模式。审计分两阶段：自动审查记录 `verdict: undecidable`，人工决定记录 `escalatedFrom: auto-review`。

**审核模型与路由**：模型取 Settings → Agents 的「自动审查模型」（`agentModels.review`），逐字段回落到默认模型，见 [`../product/agent-manifest-models.md`](../product/agent-manifest-models.md)。路由、RequestPlan 与推理合同在 prepareTurn 随回合冻结（`src/main/agent-runtime/permissions/PermissionReviewRoute.ts`）；每次审核按该路由的 provider 单独租用凭据并在请求结束后释放，与回合同一 provider 时复用回合凭据。路由不可用或凭据租用失败以 `PERMISSION_REVIEW_ROUTE_UNAVAILABLE` 拒绝，从不回落到回合模型。

**输入与缓存**：稳定前缀在前，即规则段和授权段（真实 user 消息、经 hash 核验的已批准计划及其授权清单）；单个动作的载荷在后（待审动作、操作事实与准入事实、当前隔离 slot 的有界工具观察）。同一计划下不同动作的前缀逐字节相同；审核以独立的缓存亲和（`<session>#permission-review`）写入 prompt cache，不触及对话缓存。

- 历史原生回执须先由主进程校验签名、hash 和归属，保留原 context/time；持久记录仅证明 bytes/schema/存在，不把其正文或 intent 自述升级为执行证明。
- 敏感文件观察不进入审核，凭据型动作在发送前拒绝；模型的工具参数和授权自述均不是用户许可。
- 父执行历史不泄露给隔离子执行。

工具观察最多保留 16 种不同实际调用的最后结果，以工具名和实际调用参数区分；只有相同调用可替代旧观察，不把不同文件、审计选择器或目录目标合并。

- 其中最多 8 条优先保留当前动作明确引用或实际参数键值相同的既有成功观察，再用最近观察填满；不读取其它执行历史或现场，不按领域判断重要性。
- 参数只整理观察，不提供授权，也不将失败调用变成成功证明。
- 实际调用参数、主进程身份、调用回执元数据分别有界传递，避免正文前缀挤掉身份；截断附原始长度与 hash。
- JSON 先结构化脱敏，受保护文件正文省略。
- 文件审计的实际差异与原生结果正文随观察传递，不能仅有调用参数却声称已提供结果。
- 该投影不推断前置条件、不重读现场、不赋予记录正文执行证明。

待审命令字面引用的文件，其同执行槽成功 `read_file` 观察优先保留并以 8192 字符为正文上限；超限仍明确截断，受保护路径与凭据脱敏规则不变。读取是历史观察，不证明文件当前字节，也不构成执行授权。

每个待审批调用最多一次模型审核，30 秒上限；输入最多 32768 估算 tokens，并服从审核路由的更紧输入预算及扣除 1024 输出预留后的窗口；输出最多 1024 tokens。超限、缺路由、服务失败、非法响应、超时、取消或过期 generation 均拒绝并保留原因；不重试、不静默 fallback、不自动重启 Turn。明确的 user policy floor 仍人工审批，deny 仍不可覆写。

请求尝试及实测 token 计入同 session/child 的既有 RequestSnapshot 用量；待审批工具在审核前已预留原预算，审核后重查原期限，不重置 Task、消费或批准历史。审核记录及工具结果均传递实际 rule/model/error/cancel 原因；模型批准只属于当前精确调用，不能授权后续命令或绕过执行验证。

审批事件与会话投影的可选 `reviewMethod`（rule／model）、`verdict`、`failedChecks` 与 `escalatedFrom` 只由主进程标记；`errorCode` 只来自宿主确认的审核故障，理由中的代码文字不构成宿主故障，缺字段时不补造来源。界面区分规则检查、独立审核、审核未完成与转交人工；对本调用的拒绝或审核异常说明操作未执行，审批通过后的工具失败仍保留实际错因。模型思考强度与操作风险分别标注。

## Policy 编译

`.policy.yml` 损坏或非法 → `POLICY_INVALID` fail-closed。Project policy 只能收紧，不能放宽。Policy 优先级为 `built-in hard deny > user/project policy floor > Full access > tool metadata`；数值预算必须是非负整数，`0` 明确表示禁止任何对应执行（例如 `maxTurns: 0`、`maxWallTimeMs: 0` 返回 typed error），且该 floor 即使在 Full access 下仍生效。

Decision lattice 为 `allow < auto_review < ask_user < deny`。`approvalFloorByTool` 是该格上的下界：`user` 永远至少 `ask_user`，**不得**被 Permission Mode（含 Auto-review）降回 `auto_review`；`auto_review` 永远至少 `auto_review`。Mode 只影响 baseline，floor 与 baseline 取更严者。
- Runtime budget limits are frozen in the turn plan and enforced by one shared budget: `maxTurns`、`maxToolCalls`、`maxSubagents`、`maxChildDepth`、`maxWallTimeMs`；disabled policy files are filtered before merge. 根执行深度为 0；全部启用策略未声明 `maxChildDepth` 时默认 1，显式 0 禁止创建子代理，多个显式声明取最严格值。
  - prepareTurn 按实际深度与继承预算冻结可见工具；深度或可创建子代理的预算耗尽时，模型声明、工具搜索和执行入口都排除新建 `subagent`，不移除既有 Task 的合法管理能力。
  - 同步、后台、重试与恢复沿用原深度和预算，不重新计数。

## 相关测试入口

- `src/main/browserAppBridge/bridgeSecurity.test.ts`
- `src/shared/renderer-api/createRendererApi.test.ts`
- `src/main/settings/settings-core/SecretStorageService.test.ts`
- `src/main/runtime/secretRedaction.test.ts`、`src/main/runtime/AuditLog.test.ts`、`src/main/window/mainConfirmation.test.ts`
- `src/main/settings/agent-manifests/AgentRuntimeConfigService.test.ts`（MCP trust）
- `src/main/settings/agent-manifests/AgentManifestService.effectiveCommit.test.ts`（项目 Agent trust 与天花板收紧）
- `src/main/agent-runtime/orchestration/SubagentRunner.test.ts`（子代理天花板取交集）
- `src/main/ipc/validation/IpcPayloadGuard.test.ts`
- `src/main/rdc/RdcRuntimeContextRegistry.test.ts`
- `src/main/agent-runtime/permissions/*`
- `src/main/testing/contracts/securityContract.test.ts`（矩阵入口）
- 门禁：`pnpm run check:legacy-residue`（禁止恢复 `legacyGlobalMirror` / `getRdcRuntimeContext`）


## 原生 RDC 执行证据

shell 的 command 与 rdc 互斥；ToolValidator oneOf/not 与执行入口双重检查。

- 结构化模式仍进入 shell 的同一审批入口；low 分类须来自已验证的具体语义，不能仅凭工具名称或模型声称只读。
- 原生 RDC 执行要求 owning root turn 的 `full` 天花板 profile（内置为 General），Full access 权限模式不能抬高天花板，天花板不足即拒绝；仅 `capture_select` / `capture_restore` / `capture_recover` 另要求 agentId 为 general；本机冻结配置、owning project/session lease、非 default context、非 delegated/offline child 同时成立才执行。
- 模型不可传 capture/replay/context identity。
- 操作权限按冻结 catalog 的 scope、effects、前置条件、参数和路径声明校验，不按命名空间授权。
- 未知操作或影响 fail-closed；生命周期、remote、全局配置、窗口及销毁仍由应用专门入口管理。
- 回放生命周期自动审查接收主进程定义的操作目标和效果；当前权限模式、审批下限及执行时的归属检查仍然适用。
- Skill 仅提供知识，不能扩权。

执行回执仅由主进程在真实原生成功调用后签名，key 在 safeStorage；模型提交的 result JSON、普通 shell 输出或 artifact hash 本身不具备 provenance。签名校验与 SessionArtifactResolver 所有权/hash 同时成立才可引用。实验关闭和新完成必须满足五阶段真实调用与同 replacement 的回滚；每份回执都带 daemon／worker 进程身份。详见 docs/architecture/rdc-runtime.md。

Skill 权限只在 prepareTurn 对预载集合取交集；skill_read 只读方法。RenderDoc 方法技能没有局部执行工具白名单；profile/policy/lease 仍强制授权。Knowledge Scout 仍只有四个 Knowledge 只读工具，文件补证属于调用方独立步骤。

## Capture 回放与足迹

`project:inputs:reference` 仅从正式 UI 登记一个外部 RDC，Browser 为 high-impact，需要 QA full access；它不授权原件写入或父目录读取。外部引用的移除 token 绑定来源类型、路径、内容 hash 和文件身份，移除只解除登记并释放绑定。Project Scope、普通文件工具和删除原件的权限不随引用扩大。

捕获操作使用显式 SessionScope，main 校验 session/project 与已登记输入。图片导出路径由 main 创建；原生返回必须匹配该精确路径，再读取图片并清理临时目录。renderer 仅收到验证后的图片，不接受任意文件路径。历史 API 校验 session/project 和 SHA-256 标识，不能越权访问其他项目。

`capture:applyReplayEvent`、`capture:refreshFrame` 为 mutation；历史读取为 read，历史清除为 high-impact。Project RDC 删除使用一次性 approvalToken；它与仅清理足迹不是同一操作。手动操作必须通过 Agent 生命周期锁和 owning native context 队列。

## 计划文件操作

plan:* 以当前查看 session + planId/revision/URI/hash 定位持久历史 tool call，由主进程解析创建 Agent 和实际 owning session；不以当前 session 配置补历史身份。导出路径由主进程原生保存对话框选定，保存到项目的路径由主进程固定计算。单次 approvalToken 绑定 action、viewer/owner、计划身份、URI/hash 和规范化目标，确认后复验；不接受 renderer 更换目标，不沿链接写入。取消不签发 token，写盘原子提交并验证，失败保留原文件。

## 专用工具路由与读取前置

文件路由表独立于灾难 shellHardDeny 表，均在权限模式和自定义允许前缀之前求值；Full access 不能绕过。有效工具集合有对应工具时，shell.command 文件读写/搜索返回 SHELL_FILE_TOOL_BYPASS，命令行 RDC 返回 RDC_VIA_COMMAND_DENIED。edit_file 和覆盖已有文件的 write_file 必须先在同一 session 成功 read_file 同一 realpath，否则 READ_BEFORE_EDIT_REQUIRED。已读状态跨 turn、仅内存持有，重启须重读；子 session 不继承。新建文件免先读。

Agent 只绑定同安装捆绑 Python（按宿主布局，见 docs/architecture/host-platform.md）的绝对路径与 cli/run_cli.py；旧 bat 和 PowerShell 转发返回 RDC_BAT_REJECTED，不迁移、不 fallback。旧配置仍可打开修正，但不能执行。


### 自动审查展示

自动审查以主进程 reviewer=auto_review 识别，只在 Work Process 展示规则/独立审核及真实结论，不是人工待回答请求。审核无法判断时转交的人工批准带 `escalatedFrom`：Work Process 显示「自动审查无法判断 · 询问你」，Composer 的批准卡说明审核无法确认的检查项。Composer 只提供真实人工请求的批准入口，混合请求分别结算，不改变人工 policy floor。审核来源不从命令文本、风险或 ID 格式推测。

## 会话 Remote 自动准备

设备选择是会话 rd.remote.connect 自动准备的明确入口，包含替换所选设备上目标 RenderDoc 辅助包的授权：必要时覆盖、降级、卸载重装及辅助包自身数据清除，无额外桌面修复确认。

- Tools 每次变更前核对设备、包和同安装 APK 身份；设备独占、未知归属、busy、Agent/恢复/原生进程锁与冻结 CLI/catalog 边界不变。
- 手机系统授权由用户完成。
- renderer 不能提交任意 adb 参数或绕过主进程准入。
- 已有 Capture 切换设备仍由主进程发出绑定 scope、generation 和目标的一次性关闭确认，取消或关闭撤销未使用 token。

安装回执缺失或矛盾时，Tools 在同一次连接预算内串行只读核验，只有设备安装结束且目标包身份确认后才继续启动与握手；无活动安装会话本身不证明安装成功。

- 预算耗尽仍未确认的安装不能通过取消、context 释放或更换目标清除。
- 用户统一“重试连接”复用同设备准备入口，经原冻结 CLI/catalog 和目标 APK 证据先执行只读 rd.remote.inspect_installation；pending/unknown 保留占用，clear 才进入 Tools 自动准备。
- 只读检查不安装、停止服务或放弃 PM session，不存在独立面向用户的核验操作或旧修复 token。
