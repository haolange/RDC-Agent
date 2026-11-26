# Browser App Surface（debug-only）

Browser 与桌面 Electron 共用同一套 renderer、`ElectronAPI` 产品接口、main runtime、状态目录与权限语义。允许差异仅限 transport 和 Electron 原生窗口容器：

| 路径 | Transport | 鉴权 |
| --- | --- | --- |
| Desktop | `preload` → `ipcRenderer` → `ipcMain` | 进程内信任边界 |
| Browser | `BrowserAppBridge` → localhost HTTP/SSE → IPC handler registry | One-time `/qa` bootstrap → HttpOnly `rdcBridgeToken-<port>` cookie（同源 `/app`）；explicit Bearer for programmatic clients |

唯一入口：launcher 记录一次性 `GET /qa?qaBootstrap=...`，消费一次后签发 bridge cookie，并重定向到**同一 bridge origin** 上的干净 `/app`。

同一 loopback 主机上的多个 QA 实例用各自监听端口命名 Cookie。浏览器可同时保留这些认证记录，Bridge 只校验其自身端口对应的 Cookie。

- In `browser-dev`, Vite is reverse-proxied through the bridge（含 HMR WebSocket）；浏览器不得直接打开 Vite 端口，也不再经跨端口 challenge / `rdcBridgeOrigin` query。
- 仅未打包构建在 `RDC_AGENT_BROWSER_QA=1` 时启动该 surface，打包产物无论环境变量如何都不启动；请求的 `Host` 必须是 bridge 自身（否则 421）；bootstrap 缺失、重复或无效返回 401。
- JSON body 上限 1 MiB，唯一例外是 `conversation:stageAttachments`（经 `x-rdc-invoke-channel` 与 payload.channel 一致校验后上限 96 MiB），用于 Browser QA 的 bytes 拖放/粘贴/隐藏 file input。

## 单轨接口

- `browser-dev` 只将文档入口 `/app` / `/app/` 映射到 Vite 根；`/app/App.tsx` 等真实模块路径保持原样。Vite 开发期 CSS HMR 经 `src/renderer/platform/devStyles.ts` 写入 constructable stylesheet，保留 `style-src 'self'` 与 `style-src-attr 'none'`，不放宽为 inline 样式。

- `src/shared/renderer-api/` 是唯一 `ElectronAPI` 工厂与 channel manifest；Desktop 和 Browser 各自只实现 transport，工厂都在 renderer 里调用（`src/renderer/platform/rendererApi.ts`）。处理器失败时 `/invoke` 返回 `{ success: false, error, appError }`（`INTERNAL_ERROR` 为 500，其余 422），客户端还原为与桌面相同的错误结果，由工厂抛成 `RendererIpcError`。
- manifest 中的全部 invoke channel 必须存在 main handler；启动时 `assertRendererIpcParity` fail-closed 校验。
- Browser bridge 仅接受 canonical manifest 中且已登记 capability 并已注册的 channel。未知、内部、未注册 channel 与不存在的明文 `settings:getProviderSecret` 返回 403。capability 映射是闭合 Record，禁止默认 `mutation` fallback。`conversation:answerPlanReview`、`conversation:answerToolApproval`、`conversation:answerUserInput` 是 `high-impact`：代答审批的 Browser QA 必须设置 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`。
- `conversation:accessAttachment` 包含用户触发的宿主打开与定位，登记为 `mutation`。Browser QA 和 Electron 都按待发所有者或已发送会话解析原件。
- 事件流采用携带 cookie 的同源 `POST /events` fetch，保留 SSE 帧格式；不依赖原生 EventSource GET 的 Origin 行为。断流只重接同一事件流，不轮询应用状态；401/403 停止重连，最后订阅移除后 abort，迟到帧不得派发。
- Cookie 认证的 `/invoke`、`/events`、`/api/*` 必须带精确 Origin。`browser-dev` 同源反代 Vite 时不得把 cookie / authorization / `x-rdc-*` 转给上游。
- Secret 只可提交给主进程；renderer 只读取 `{ hasSecret, maskedPreview? }`，不得获得明文。
- Capture 当前图像读取 channel 在 Browser JSON transport 中严格解析 Node Buffer 的 `{ type: 'Buffer', data: byte[] }`，还原为 `Uint8Array`；非法字节拒绝。Desktop 仍使用原有字节返回类型，组件不感知 transport 差异。

## 产品能力矩阵

| 能力 | Desktop | Browser |
| --- | --- | --- |
| Workbench / Project / Session / Run | ✅ | ✅ |
| Conversation / Stop / Rewrite / Tool Approval | ✅ | ✅ |
| Work Process / Trace / Workflow / Context Usage | ✅ | ✅ |
| Settings / Language / Appearance / Models Override | ✅ | ✅ |
| Provider connect / secret status / secret submission | ✅ | ✅ |
| Agents / Skills / MCP / Hooks / Policy | ✅ | ✅ |
| Capture / Context / Device / Knowledge | ✅ | ✅ |
| Runtime Log / Command Execute | ✅ | ✅ |
| Memory approval / write / delete | ✅ | ✅ |
| Hook/MCP trust / revoke / test | ✅ | ✅ |
| Electron 原生窗口 chrome | ✅ | 浏览器标签页容器 |

上述 Browser 能力仍受 main-owned Zod、PermissionPolicy、approval token、MCP trust、`safeStorage`、session ownership 与 shell policy 约束；parity 不等于绕过权限。`command:execute`、`settings:patch`、`rdc-runtime:trustMcp`、`rdc-runtime:revokeMcp` 仅在 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1` 时开放，否则 fail-closed。

隔离 QA 若经用户授权复制加密 Provider 凭据，须连同同源 Electron `Local State` 一起复制，否则 `safeStorage` 无法解密；可用性以真实模型请求确认，结束后清除隔离副本，不触碰原件。

## 状态与实例

Browser QA / Browser-dev 在未显式指定 `RDC_AGENT_USER_DATA` 且未设置 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 时默认使用经过校验的临时 `os.tmpdir()/rdc-agent/qa-*` userData，并在 `will-quit` 清理；显式路径或 canonical 开关才会共享真实数据。

- disposable 实例不启动本地 crash reporter，也不保留 minidump；显式 userData 的实例与桌面一样把 minidump 写到 `<appStateRoot>/crash`。
- 进入该 disposable 分支时，主进程在读取任何路径之前调用 `appPathService.isolateUserRdcRoot()`，把用户资源根指到同一目录下的 `.rdc-agent`，使 provider 配置与 `userData/secrets` 落在同一隔离边界，不读写真实 `~/.rdc-agent`。
- 只有显式 `RDC_AGENT_USER_DATA` 或 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 才落真实 `~/.rdc-agent`。
- 两种载体不得同时占用同一目录；`instance.lock` 冲突应明确失败。
- 涉及真实本机数据的验收必须显式指定 userData。
- 设置文件损坏、不可读或不符合当前 schema 时，启动提示点名 `config.json` 和应用数据目录。启动期间读取本地数据文件失败也提示具体文件和数据目录。Desktop 显示原生错误框，headless 把同样的内容写到 stderr。二者都以非零状态退出。

`instance.lock` 回收不能只凭 PID 存活判断 owner：锁记录 owner 的进程身份（pid 与 birth，见 [`host-platform.md`](host-platform.md)），只有身份证明已退出（pid 不存在或 birth 不同，即 PID 被复用）才回收；身份不可读或未记录 birth 的活 pid 保持拒绝，也不向该进程发送终止信号。

## 验证

- Ask 专项可用 `qa:ask` 经 Composer 发出双题请求。Working 展开后同时显示两题，Composer 完成选择和自由输入后核对两条回答都进入原卡。

- 外观对照须匹配主题预设、字号、语言、Composer Markdown 开关及当前 Agent；disposable 默认偏好不能代表正常用户配置。需要复现正常外观时，仅将 appearance 字段复制到自有隔离配置，记录来源与差异，不复制凭据或会话，也不改变产品默认值。普通输入与 Markdown 编辑/预览是同一 Composer 的现有设置，不是 Browser/Desktop 分叉；原生窗口缩放仍需单独验收。
- 契约：`createRendererApi.test.ts`、`bridgeSecurity.test.ts`、`BrowserAppBridgeServer.contract.test.ts`
- Smoke：`pnpm run smoke:agent-browser`
- 手动：运行 `start:agent-browser`，从最新日志复制完整的一次性 `/qa?qaBootstrap=...` URL，核对真实 Settings / Project / Session / usage、语言持久化与 parity；高风险 channel 分别在未设置与设置 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1` 时检查；仅在获授权的真实数据流程中显式使用 canonical userData。
- 对话走查：`node scripts/qa-ollama-stub.mjs [端口]` 在本机起一个确定性的 Ollama 协议桩（`/api/tags`、`/api/show`、`/api/chat` NDJSON），无需凭据或模型即可在 disposable 实例里连接内置「Ollama」供应商。
  - 默认回合是流式思考、一次 `glob` 调用与最终答复；用户消息含 `qa:loops`（多轮，含任务创建与更新）、`qa:long`（五轮并行工具调用加长答复，触发窗口化与滚动）或 `qa:plan`（Mission Agent 提交计划进入计划门）时走对应剧本。
  - 批准后的执行回合按真实契约以 `turn_complete` 声明 blocked（工作区没有 capture），运行时的跟进提示（以 `# ` 开头）延续当前剧本而不是重开。
  - 它只是 QA 工具，不进打包产物，也不代表真实模型的质量。
- 运行态走查：桩启动后，用 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1 TMPDIR=/dev/shm` 启动 disposable 实例，再运行 `node scripts/qa-walkthrough.mjs <日志> <截图目录> [--capture <file.rdc>]`。
  - 它经真实设置连接桩、经真实 Composer 依次发送 `qa:loops` / `qa:long` / `qa:markdown` / `qa:subagent` / `qa:plan` 剧本，按状态截图（首页、知识中心（经粘贴导入两张案例卡后再截列表与阅读）、模型服务、智能体、工具、钩子、常规、外观、Effort 与模型面板、运行中与完成的工作过程、任务、上下文用量、正文排版、子代理、计划门、阅读器、交接、浅色、英文、伪本地化、命令面板、720px），并断言滚轮能把消息列表向上滚动。
  - 每张非伪本地化截图都扫描默认画面的可见文字：出现 `session://`、12 位以上的十六进制哈希或 `HTTP 4xx/5xx` 即记为失败（用户与模型内容、展开的技术层、诊断与运行记录不扫描）。
  - 任何一步失败即非零退出。
  - 设 `QA_VIDEO_DIR` 时整段走查录成视频，截图日志带相对时间，便于剪出动效片段。
  - 截图目录放在仓库外，只留验收需要的一组。
- 结果评测：`node scripts/eval-investigation.mjs --print-prompt` 给出 `scripts/evals/vkcube-lavapipe.json` 的评测请求。该请求要求执行指定的回放查询、发布带原始证据引用的就绪报告，并逐题作答。默认用例基于 RDC-Tool 的 `vkcube_lavapipe.rdc`，答案来自真实回放。
  - 在应用里用任一模型完成这次调查后，`node scripts/eval-investigation.mjs <会话目录>` 从三方面判分，任一项不过即失败：
    - 答案：按会话最后的答复与 InvestigationReport 记录逐题判分。
    - 工具调用：套件的 `requiredToolCalls`（工具名加必须包含的参数）都要在 `session-context.jsonl` 里出现，且结果不是错误。
    - 证据：报告结论回指的每条 observed 源 Claim 都引用了会话里实际记录的 Evidence（与 `S-EVIDENCE-01` 一致），每条 Evidence 的 artifactRef 都能解析到会话制品且 hash 一致。
  - `--faux` 用脚本化 provider 驱动一次真实的调查回合：agent loop、产品的 `rdc_probe`（原生结果来自套件 `faux.replay` 的录制回放，代替 RDC-Tool CLI）、工具结果制品化与证据固定、调查工具写 Evidence / Claim / Report，最后经终态追加写出会话，再用同一套判分。脚本化模型只从收到的工具结果推出答案。它是受控 fixture，不代替真实模型或真实回放的证据。
  - CI `build` 运行 `--self-test`（判分自检）与 `--faux`；真实模型的评测手动运行，需要模型与可回放的 capture。
- 可读性：`RDC_AGENT_BROWSER_QA_FULL_ACCESS=1` 启动一个 disposable 实例（切换外观需要写设置），把日志路径交给 `node scripts/qa-readability.mjs <日志> [截图目录]`。
  - 它用这次的一次性 URL 进入，在 Settings › Appearance 切换深色/浅色并断言主题确实生效（未开放写设置时直接失败，不把深色结果记成浅色），对首页、设置与 720px 窄屏逐一检查可见文字小于 12px、文字对比度低于 WCAG AA（正文 4.5:1、大字 3:1）与水平溢出，有问题即非零退出。
  - 两个脚本共用 `scripts/qa-browser-shared.mjs`。
  - Playwright 来自 QA 环境；CI 只执行静态的一半（`check:design-tokens` 的排版角色规则）。
  - 打印日志时遮去 `qaBootstrap` 令牌。

## 原生交互性能观察

真实 `/app?qaPerformance=1` 安装 `InteractionPerformanceProbe`；普通入口不安装监听器或观察器。默认统计 Composer 模型入口、模型选择按钮及 Fast/Max/Effort 控件；增加 `qaPerformanceScope=transcript` 时统计真实消息列表内按钮与 summary；`qaPerformanceScope=devices` 统计正式 Remote 入口及菜单内按钮。`qaPerformanceWindowMs` 可指定 1–300000 ms 固定观察区间，用于没有点击的流式期间收集页面 Long Task。到期和 pagehide 会 drain 并释放观察器、监听器与计时器。

根元素 `data-rdc-qa-performance` 提供范围、实际区间、原生支持标志、观察条目数和汇总。

- `pointerToPaintP95Ms` 是基于原生 Event Timing、对未观察点击按 16 ms 补值的估算；必须同时记录 `eventTimingObservedCount` 与 `interactionCount`，不能将缺失 target 或尚未送达的条目视作已测得低延迟。
- Long Task 属于页面整体，按与区间相交计入完整任务时长，不能宣称全由 Transcript 引起。
- 前后比较须使用相同探针、内容、视口、外观、观察区间和动作；工具调用耗时与 RAF 不作为替代指标。

## Capture Replay QA

capture:getReplayState/getReplaySelection/readLivePreview 为只读面；applyReplayEvent/refreshFrame 为 mutation，复用共享 channel capability 表。人工与 Agent 共用同一实际 EID 回放轨道；不提供独立足迹浏览、播放或清空 IPC。状态事件为 capture:replayChanged，包含完整 scope/generation/revision，不含像素。QA 应覆盖跨 session 迟到结果、运行锁、非空回放与 RDC 归零原空态。真实 Android 显示验收必须来自设备屏幕与原生回执，不以 Browser 图片或 local export 代替。


## 右栏紧凑浏览验收

investigation:list 是只读能力，与Desktop共享factory/manifest/handler、active project/session校验和50项游标分页。验收必须覆盖摘要五项限制、超过50项的完整浏览、嵌套预览、ID复制、顶层Escape及焦点恢复、切session迟到隔离。QA项目/userData以外部临时脚本按当前存储格式或正式Bridge注入，不新增renderer demo、产品内固定数据或特殊授权路径；无模型/RDC调用的视觉fixture单独标识。


`llm:cancelProviderAccountLogin` 属 mutation，仅释放待登录的自有监听器，不撤销既有账号。Grok 浏览器回调是 main 独立 loopback listener，不借用 QA bridge，也不将令牌返回 renderer。带真实凭据的隔离 QA 使用同源加密凭据与 Local State 的自有副本；原始文件不修改，验收后清理副本。API/订阅目录、少量推理和 Browser UI 的证据分开记录。
