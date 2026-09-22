# Acceptance Ledger

2026-09-22 RC5-LAUNCH-BRAND：接续 595e7101 的追加修复。旧候选失效，以下结果属于圆形透明、完整 RGB 换色及正常入口一致性版本。最终源码及发布 tag 为 5227092551bc183d0ad3746005de5fd8ee29c43f；用户已确认任务栏测试无问题。

- 根因：旧 launcher 直接以 out/main/index.js 启动，真实 app.getAppPath() 为 out/main、版本为 Electron 42.2.0，主进程品牌路径不成立。现统一以 package.json 的 main 启动，cmd 与 Browser 实测版本均为 0.6.0-rc.5、应用根为仓库。品牌资源加入 build fingerprint；直接执行实际指纹函数验证不变稳定、仅品牌变更失效、还原稳定；正常第二次 cmd 跳过构建。新增 Browser smoke 产品版本断言，测试同时隔离 User Scope 与应用状态，不借真实 provider 通过。
- 数据一致性：正常 cmd 与正常打包 exe 串行启动，日志均指向 ~/.rdc-agent 和 %APPDATA%/rdc-agent；三个已连接 provider、同两张用户 Knowledge 卡片和既有会话实际可见。provider 与 Appearance 字段 SHA 摘要一致；没有复制 secret、迁移数据、发送模型请求或执行 RDC 回放。先前无 provider 的窗口是本轮显式隔离 QA，不是正常安装路径。旧候选与用户 cmd 重建的 316 个输出文件完全相同，外观差异还包含正常 Absolutely 与隔离默认 RDC 主题。
- 像素工程：主色精确覆盖 #cc7d5e/#33d1ff/自定义色，黑白混合保留层次；白字、近黑、中性、其他色域与透明像素保护通过。共享圆形遮罩及预乘 alpha 单测通过，真实 Windows Electron 验证 PNG 直通 RGBA → BGRA 预乘 → PNG 往返。Browser 深浅主题与强调色切换实际重绘，两个 32px 品牌 canvas 为 128px backing、无 inline style，console 无 error/warn；工具不支持读取 canvas 像素，未冒充像素实测。Composer/侧栏未再改动，沿用本轮先前真实几何验收及全量测试。
- 工程：442 文件、3070 测试通过，4 项既有条件跳过；coverage lines75.25%、functions76.90%、branches62.35%、statements72.84%，ratchet通过。typecheck/lint、contracts248项、完整gates、实际cmd构建与Browser smoke通过。两个源码窗口均正常退出码0并释放canonical锁。
- 新包：未签名NSIS/ZIP构建完成；52运行资源及两处品牌校验、316构建文件与ASAR/ZIP字节一致、九种圆形ICO与exe资源逐项一致。正常打包版服务初始化通过。用户提供任务栏目视通过回执（“任务栏我测了，没问题”）；打包窗口已退出，复查无 Electron/RdcAgent 进程且 canonical instance.lock 不存在。历史fs.Stats弃用及meta CSP提示仍存在，安装向导未实测。

- 发布与收尾：[v0.6.0-rc.5](https://github.com/haolange/RDC-Agent/releases/tag/v0.6.0-rc.5) 已公开为未签名预发布、非 latest；7 项上传资产 SHA256 与本地逐项相符，SBOM 源码 SHA 与 tag 一致。NSIS SHA256 `43c5fb1a33bbc4a7224712829cdb99ce18b331014dc9b5760c431025e6e3b784`；ZIP SHA256 `c2bbd135056a4bfc165d7e940b18d1103d99182b077d4915358705d3295fa01b`。[源码 CI](https://github.com/haolange/RDC-Agent/actions/runs/35696652266) completed/success。rc.4 tag 未移动，rc.2 既有资产 digest 未改变。已清理本轮 QA 数据、日志、诊断文件、旧候选、本地旧包副本及 win-unpacked；release 仅保留 7 项正式资产，当前依赖与构建输出保留供正常启动，.qoder 和真实用户数据未动。桌面启动权已交还。后续文档回执提交不移动发行 tag。

2026-09-22 RC5-BRAND-COMPOSER：基于 48f9a0ee 的本轮未提交修复，以下是实际证据，不把基线 SHA 作为新实现 SHA。保持四个官方 Agent、声明式 handoff 及历史实验记录。

- 工程通过：pnpm 11.7.0；完整 coverage 442 文件、3066 测试通过，4 项既有条件跳过；lines 75.24%、functions 76.90%、branches 62.35%、statements 72.83%，ratchet 通过。首次与 build/gates 并跑出现三项 5 秒超时，未改断言，限制 maxWorkers=4 独立复跑通过。最终 typecheck、lint、contracts（248 项）、完整 gates 与 production build 通过。
- Browser QA：正式 renderer 同源 disposable bridge；普通输入空白/清空约 72px，多行约 180px 后内部滚动，无灰底/边框；键盘全选删除、外壳 focus-within、普通/Markdown 编辑与预览切换、内容回缩、大字号和窄屏通过。实际窄屏约 354px，无页面横溢出；标题文字单行截断不挤占窗口按钮。左右拖到头均 520px，设置持久值及重新加载一致；空项目 Capture 保持空态。没有执行模型或 RDC 回放，本轮不重标历史模型与设备验收。结束前 Browser console 无 error/warn。
- 原生与包：Windows Electron 的 BGRA 解码、真实换色、createFromBitmap/PNG 往返断言通过；图标缓存、关闭释放、appearance IPC、系统主题选择和失败诊断单测通过。打包窗口完成 ReplayDeviceService 初始化，标题栏与 Settings 实际显示同一品牌图，32px 图案可辨识。闪屏复用同一组件，尚无截获闪屏画面的视觉证据。任务栏换色及 Windows 系统主题切换待用户目视回执，未标通过。
- 发行候选：0.6.0-rc.5 Windows x64 NSIS/ZIP 构建完成，NotSigned；52 运行资源、renderer/native 品牌资源校验通过；316 个构建文件与 ASAR 字节一致，ZIP ASAR 与已运行目录一致；exe 内嵌九种尺寸图标均与生成 ICO 字节一致。仍有既有 fs.Stats 弃用及 meta CSP frame-ancestors 提示；不声明控制台无警告。发布与清理待收口。

2026-09-22 RC3-CANDIDATE：用户追加授权提交、推送和 `0.6.0-rc.3` 未签名预发布。三轮UI成果已进入 `e62ef83b711af6bc9ce9799bea7a8f640e5f7c0c` 并推送main，以下历史“未提交”仅描述当时证据基线。最终renderer bundle仍为 `index-BWE38meJ.js`。

- 本地发行通过：production build、显式prerelease配置门禁、NSIS/ZIP、52资源包内容校验、1106组件SBOM与校验和；ZIP内asar与已验证产物相同。打包应用服务初始化smoke通过且自有进程退出；安装向导和原生IME未实测。启动仍有meta CSP frame-ancestors及fs.Stats弃用警告，不声称无警告。
- 发布通过：用户完成标准GitHub CLI登录后，rc.3已公开为未签名预发布，7项远端资产digest与本地SHA256一致；tag指向实际构建源码e62ef83b，rc.1/rc.2不变。源码CI 35629602214已completed/success；不以云端通过覆盖既有本机Knowledge边界。完整状态、发布链接与产物散列见 `../workflows/first-use-and-release-readiness.md`。
- 收尾：本轮win-unpacked及builder-debug已清理，7项必要发行文件保留以继续上传；原QA服务5127可达，隔离数据与必要截图保留。canonical桌面锁不存在，桌面启动权已交还（锁检查）。

2026-09-22 AGENT-LIST-VISUAL：本轮设置Agent行视觉比例收敛 verified，基于未提交工作区，production bundle `index-BWE38meJ.js`。上一轮等高证据保留，但不作为本轮视觉比例通过依据。

- 实现：feature内AgentListItem组合共享ListRow/OverflowFade/ModeGlyph；18px图形、28px透明图标列、独立实色细边框行、4px行距，名称中等字重及说明两行排版。ListRow展示变量使上下8px留白不再被加载顺序覆盖，其他调用方默认值不变；旧底座与重复选择器无残留，无IPC/存储/权限变更。
- 独立工程：定向3文件10测试、renderer115文件474测试、tsc、全量ESLint、design-tokens/renderer-structure（均0 hits）、appearance/fidelity/settings-agents/legacy-residue及production build通过。未用本轮局部通过覆盖既有Knowledge聚合门禁边界。
- 主线程真实Browser：四个用户Agent和项目长名/长短/空说明样本；深色中文与浅色英文、三档字号、1591px及实际390px宽屏/窄屏组合。各组行高差0，空说明保留位置；短说明无渐隐、长说明实际溢出才渐隐，无横向溢出；图标透明、上下留白对称，Tab/Enter与末项滚动选择可用。三档行高约45.58/48.08/50.44–50.58px，不以固定高度裁切文字。
- 独立Review：未参与实现和工程验证的审查者实际读取源码、原用户图及深色/浅色/窄屏三张真实截图；条目分隔、去底座和文字比例无finding。独立截图复核与主线程live交互分开归因。共享hover/focus状态优先级保持，不另造Agent状态覆盖。
- 收尾：仅删除本轮三个临时Agent，文件和刷新后的项目列表确认只剩原有UI Review。保留原隔离QA和最新中文深色大字号Agent页；console无error/warn，canonical桌面锁不存在，桌面启动权已交还（锁检查）。无新增QA进程，无用户数据修改，无提交、推送或发布。任务记录见`ui-interaction-audit.md`本轮节。

2026-09-22 AGENT-LIST-USER-MENU：verified for the two-screen incremental scope on the uncommitted worktree based on `1acae3a2202075ff99d14bba8aa75b8eccd44dde`（不将基线SHA冒充新实现提交）。共享OverflowFade替代Composer局部测量/遮罩；Agent名称/描述各一行、空描述保留高度；Tabs显式fullWidth默认关闭；用户菜单横向三行与紧凑资料头，语言使用自称简体中文/English。无IPC/schema/权限变更、无新增依赖、无提交或发布。

- 独立工程：renderer 114文件471测试通过；定向3文件20项含字体loadingdone/ready/卸载迟到清理；tsc、全量ESLint、design-tokens与renderer-structure均0 hits，appearance/fidelity/settings-agents/legacy-residue及production build通过。独立Review无finding。当前增量不重跑此前未变main/shared的Knowledge聚合门禁，原边界保留。
- 实际Browser：载入最终`index-BAqOZqgG.js`，隔离用户副本与小型项目。菜单原约352px→约237px，三组边界差0，组内宽差<0.02px。最终英文大字号390×844全部tab水平溢出0；中文浅色小/中/大字号960/640/390关键组合一致对齐。19条项目Agent（长名称、中英长短说明、空说明）在390/640/960/1591px均41.212px等高，渐隐仅真实溢出出现，列表滚动选择且无横溢出；四用户Agent在三档字号下等高。Composer模型胶囊/菜单、disabled控件、自然宽度分段入口保持。
- 交互：菜单方向键切语言、外部点击关闭、Escape关闭后桌面回用户入口/窄屏回抽屉入口；低高度429×242菜单内部滚动且设置中心键盘可达；刷新恢复中文/深色/大字号。未调用Provider或原生RDC。
- 独立视觉：审查者因工具会话隔离无法枚举主会话标签，改为独立读取两张最终真实Browser截图，密度/对齐/单行渐隐无finding；该项是截图产物视觉复核，不冒充独立交互。真实交互由主会话执行，分开归因。
- 收尾：只清理本轮18条临时Agent夹具；保留原隔离QA、原有UI Review项目与用户资源副本、最终可操作页面和两张必要截图。复用原Browser实例，没有新建自有进程；canonical桌面锁不存在，桌面启动权已交还（锁检查）。详细任务状态见`ui-interaction-audit.md`增量修正节。

2026-09-21 UI-CONTROL-SETTINGS：六张标注图的控件与设置页收敛，基于 `1acae3a2202075ff99d14bba8aa75b8eccd44dde` 的未提交工作区；基线不代表包含新实现的提交。本轮不提交、推送或发布。任务状态见 [UI交互审查](ui-interaction-audit.md) 本轮章节，以下历史条目不被覆盖。

- 工程：独立全量428文件/3013项通过、4项既有条件跳过；main/shared coverage ratchet通过（lines75.16%、functions76.86%、branches62.29%、statements72.74%）。最终renderer独立复验113文件/464项、关闭生命周期3文件/16项、scoped/contracts12文件/261项、typecheck/lint/build与专项通过。最终聚合`check:gates`在Knowledge契约的沙箱`realpath C:\Users\Vip` EPERM处中止，未重复提权或绕过；同任务未变main/shared在获批环境的Knowledge门禁已有`OK hits=0`。不将这次聚合命令写成全绿。
- Browser：真实main bridge、隔离user资源副本与小型项目`ui-review-project`；Settings八页、Knowledge导入、Composer双模式、消息编辑、右栏五卡空态。深色中文/浅色英文、中/大字号，默认宽屏及实际CSS viewport 960×900、640×900、390×843关键场景；非全页面笛卡尔积验收。
- 六图：全局/交接文本从一行增长至八行封顶并可清空收缩；共享按钮/单选与焦点语言；诊断入口消失但资源位置保留；技能列表无长description，长文填满剩余高度，窄屏保存/取消可达、无横溢出；MCP紧凑/Hooks填充空态；策略资源在上、全局阈值在下，80→85刷新保持后恢复80。技能候选真实覆盖builtin/user/project，缺失ID保留、切目标显示不可用、搜索无结果独立呈现、追加顺序与自动保存刷新通过。
- 生产构建消息编辑：会话`sess_145198e7e16d`由真实UI创建，离线加入显式“QA合成、非模型输出”的两条消息。自动聚焦、12行封顶165px、清空回32px且发送禁用、Escape/取消保留原消息、390px按钮可达、390→640宽度变化保留草稿；未发送或重写。Composer普通输入/CodeMirror切换保留文本，Shift+Enter换行；已挂载普通输入中→大字号由153→165px重算。
- 独立Review发现的Agent修改后300ms内关闭丢草稿已闭环：UI与autosave归属草稿分离，真实挂载User/Project100ms关闭提交一次、重开保留、startup未ready不写入、切项目不重绑。独立Verify PASS后复审无剩余finding。最终production Browser实测修改后Escape关闭操作约61ms，重开内容保留。
- 边界：`TODO(UNVERIFIED: 内置浏览器不支持Input.imeSetComposition，原生中文IME组合提交需人工真实输入法补验)`；普通中文输入与工程composition用例不能替代此原生证据。完整聚合门禁须在允许Knowledge测试访问用户路径的环境补跑；追加权限请求曾被安全审核拒绝，未绕过。未复制secret或真实历史，未调用Provider、MCP/Hook执行或RDC原生能力。
- 收尾：自有废弃QA进程及失败副本已清理，临时资源根的旧配置备份/旧运行记录已移除，原始用户目录未动。保留最新production同源`/app`和隔离用户资源/小型项目供继续迭代；viewport恢复、深色中文大字号，页面为用户技能详情。canonical桌面锁不存在，桌面启动权已交还（锁检查）；保留QA使用隔离锁。无Git提交、推送或发布。

2026-09-21 CI-CROSS-HOST-PORTABILITY：verified。`85a2da92` 修复 Shell/shell trailer/RDC CLI 的跨宿主路径契约与测试临时根 canonicalization，`a4d6b5aa` 修复 macOS Electron 测试并发提取竞争及 desktop smoke 的 Windows 临时目录清理竞态。GitHub [CI run 35567724271](https://github.com/haolange/RDC-Agent/actions/runs/35567724271) 验证发行源码，最终台账提交另经 [CI run 35568188278](https://github.com/haolange/RDC-Agent/actions/runs/35568188278) 复验；两次的 Linux build、macOS runtime/primitives、browser smoke、desktop smoke、launcher checks 及全部 job 均 success。`v0.6.0-rc.1` 未移动；`v0.6.0-rc.2` 已按全绿 HEAD `70254a76` 创建并发布为未签名预发布。

2026-09-21 RC2-PACKAGE-CANDIDATE：verified on local Windows candidate. NSIS `3ec8ae5e3246c2f1f79ff62b1e6c639b4af87be3219f1031155f14dd434bdc10`；zip `cb200d7630ffdfde50131be313b4d3ca818b70b17cfb00e1f2b37441c699a8f9`；blockmap `ea692a63672d13e4969e632a9735a7e990ed40894663497f8b2dddaab6a7186e`；SBOM `1770d95c48dcd9fdd287c9cbc7fe92c716546c1d25906cfe7e0ea9ec8f212fbc`。`verify-package.mjs` 通过，52 个 builtin/runtime resource 与四张教程图字节一致；release 资产为未签名预发布，正式签名门禁保留。

2026-09-21 RC2-RELEASE：verified。GitHub [v0.6.0-rc.2](https://github.com/haolange/RDC-Agent/releases/tag/v0.6.0-rc.2) 为 prerelease，7 项远端资产 digest 与本地候选一致；`v0.6.0-rc.1` 未覆盖。tag 指向 `70254a76`，SBOM provenance 记录实际应用构建提交 `a4d6b5aa`；后续仅为文档台账收口，不改变发行包内容。

2026-09-20 RELEASE-PUBLISHED：Agent `v0.6.0-rc.1`（构建提交392c71f16a327d71084196b9e343b6ee9f739bf4）已作为明确未签名的GitHub预发布公开；Tools `v1.0.1`（04295e47cd87727f109f863980aa5b2cfbef2647）正式发布，v1.0.0未覆盖。9个服务器端资产digest逐项等于本地SHA256；Agent zip内asar等于已验unpacked，52 builtin与四张教程PNG字节一致，NSIS NotSigned符合本次授权。发行门禁5个正负例、安装/引导相关16项、typecheck/lint/check:gates通过；Tools 37测试+2subtests、实际zip/doctor/catalog和文档/identity通过。Tools CI已绿，Agent CI在发布回执时仍运行；历史真实链路沿用，不新增声称NSIS交互安装/独立干净机/LLM矩阵通过。地址、散列、CI链接及清理见docs/workflows/first-use-and-release-readiness.md P1–P3。本回执提交不移动发行tag。

2026-09-20 ONBOARDING-VISUAL：在728fc2fa基线的未提交工作区完成四步图文教程；不将基线SHA冒充已提交实现。typecheck、受影响ESLint、design-token/renderer-structure、GettingStartedState（1项）及最终build通过，四张本地PNG进入renderer资产。真实disposable Browser QA验证中文深色、英文浅色，1280×720与390×844；四页图文、上下步/索引/完成/关闭/重开首步、Tab/Shift+Tab闭环、Escape焦点返回通过。390px正文无横向溢出，滚动可达完成提示与下载链接；首末页页脚位置一致。示例标识与HTML双语标注明确，无配置或模型请求。两个自有QA实例已停止、隔离数据清理、viewport恢复、标签页关闭，canonical lock不存在，桌面启动权已交还。本轮未操作原生CU、未重打release，旧候选不包含此图文改版。实现与生成来源见docs/ui/workbench-and-transcript.md，任务V1–V3见docs/workflows/first-use-and-release-readiness.md。

2026-09-20 FIRST-USE-RELEASE退出补验：现有打包`release/win-unpacked/RdcAgent.exe`在隔离profile/home启动，原生窗口与上手指南目视正常；Alt+F4后主进程及该exe子进程退出，canonical instance.lock释放，未强制结束。临时配置删除并复查，桌面启动权已交还。此回执补齐下表该行历史未验的原生容器/正常退出项；计划T1–T6通过。代码仍未提交，表行保留planned而不将基线SHA冒充已提交实现；签名、独立干净机与发布不在本轮完成声明中。

Verifier 结论落盘。本文件是二次收敛（U00–U07）与 T18 现场取证的验收台账，不是第二产品权威；产品裁决以根目录 [`DESIGN.md`](../../DESIGN.md) 为准。

**Browser 证据路径在仓库外** `%LOCALAPPDATA%/rdc-agent-qa/<sha>/`。条目若引用 Browser 证据，只记相对该目录的路径、build SHA、QA `projectId` / `sessionId`、viewport、theme/motion、DOM selector、IPC channel + 结果码。**禁止**写入 token / cookie / secret / qaBootstrap。

`pnpm run check:acceptance-ledger` 已由 **U04** 落地并接入 CI / `check:gates`。历史状态按下表记录；U06-t17-completed 的真实实验结论已于 2026-09-09 撤回，见该行纠正。

Verdict 枚举：`planned` / `verified` / `failed` / `waived-by-user`。`verified` 行的 Commit SHA（短或长）必须存在于 `git rev-list HEAD`；空 / `—` 只允许非 verified。不得伪造。

以下 `RDC-host-*` 行是最终收尾前的历史基线快照（法线/UV、模型和 Android 的新增结论见文末 final closeout），验证的是该基线上的未提交工作区，未执行提交或发布。精确源码回执位于隔壁 Tools 的 `intermediate/runtime-host-evidence/source-manifest.json`：Agent 摘要 `bdebedc929235379f90452ca98130891b79f33237b23deb9d411385047885895`，Tools 摘要 `c7ffbc599e38fe39e443d73db0cccef9ce44578bc84e86cd232df75c59bfacd6`；三类事实表在 Tools 既有任务清单的本轮章节。CLI/canonical catalog/三手册指纹 `8681825a610af3466a968eb379268bbebe36e174b670a788a4fda33c02fced1a` 一致。四项默认跳过分别为显式 native read、parser、完整 A-B-A 与模型成本比较；前两项已另行真实执行通过，后两项不在该历史基线的新增实测范围。

最终工程门禁、覆盖率 ratchet、typecheck/lint/build 通过。窗口启动时发现的 Electron deprecated console-message 参数签名已替换并真实启动复验。709 个本轮隔离目录已清理；Vitest TMP/TEMP/TMPDIR 随已有隔离根释放，全量复跑无外部 fixture 残留。Browser 标签页关闭、viewport 恢复；自有 context 先释放再停止 daemon，桌面窗口正常关闭、canonical instance lock 不存在，桌面启动权已交还。原始 capture、真实用户配置、已有依赖与必要证据保留。

| Task | Criterion | Gate/Test | Browser evidence ref | Verdict | Commit SHA | Date |
| --- | --- | --- | --- | --- | --- | --- |
| FIRST-USE-RELEASE | 上手说明、本机目录绑定及本地候选；本行SHA仅为未提交工作区基线 | 2957 tests通过/4既有跳过；coverage/typecheck/lint/gates/build；52 builtin字节与包内Hook通过；Tools清理修复34项不同受影响测试通过，真实成功/异常/取消释放与更新zip门禁通过 | 2026-09-20中文深色/英文浅色390px；project proj_6646965201c4/session sess_56928f2a5437；真实选择目录、1.0.1/128操作、失败保留配置；Vulkan EID21打开关闭。用户确认界面目视走Browser，沿用已通过证据；打包exe服务初始化通过，原生容器及正常退出仍未验。候选hash与清理回执见docs/workflows/first-use-and-release-readiness.md；整体不标verified | planned | 728fc2fa9ea1ccc50023e5ef61376d083c86b27b | 2026-09-20 |
| RDC-host-binding | 同安装捆绑 Python + sole run_cli.py 前缀；非法配置可见但拒绝；统一原生 argv；下列 SHA 是未提交工作区的基线，实际源码以本轮 source-manifest.json 为准 | Settings/binding/invoker/冻结身份测试；真实 RdxNativeRead/Parser 两项；typecheck/lint/build | `runtime-host/browser-qa.json`；project `proj_b2a8fe4f777b`，session `sess_41c4e1cff123`；Settings 保存 bat 返回 RDX_BAT_REJECTED；合法保存及验证128操作；两次 shell.rdx 独立 Python argv，发现无进程 | verified | 2dd81bc99e61f0bb1ab07c46ee9b4a9a32df48bf | 2026-09-19 |
| RDC-host-file-policy | 文件路由先于四种模式/自定义前缀；同 session 跨 turn 的成功 realpath 读取，重启/子会话隔离；新建免先读，覆盖必须先读；保留 symlink 拒绝 | 真实工具写入与失败/取消读取、路径别名、子会话释放断言；SHELL_FILE_TOOL_BYPASS / RDX_VIA_COMMAND_DENIED / READ_BEFORE_EDIT_REQUIRED 均有执行断言；完整 tests/coverage ratchet、contracts、prompt/scoped resources/skills | 同一未提交源码回执；无新增 IPC、SessionRecord 字段或持久已读账本 | verified | 2dd81bc99e61f0bb1ab07c46ee9b4a9a32df48bf | 2026-09-19 |
| RDC-host-replay-qa | 两 capture 事实、真实 batch、Capture 开关及当前帧；法线/UV unsupported，marker/debug name 缺失为 null；未声明模型质量或 Android 屏幕验收 | Tools384项及source release gate；Agent2936项全量与4项条件性跳过；真实read/parser另行通过；canonical catalog/三手册一致 | `runtime-host/browser-qa.json`；1813×1145、390×844，dark；`img[alt="EID 11"]` 解码603×653；`#capture-frame-tab`键盘focus/selected；close后图像消失和控件disabled；两图像IPC Buffer JSON严格解码修复 | verified | 2dd81bc99e61f0bb1ab07c46ee9b4a9a32df48bf | 2026-09-19 |
| RDX-daemon-lifecycle | 正常关闭先 `release_owned_runtimes`（clear+stop+收割）再 `joinAll`；open 先 `daemon start --owner-pid`；只收割 App 中间根 `rdc-*`；clear ≠ stop；宿主死亡忽略卡住 request count | `OwnedRdxDaemonRegistry` / `ShutdownCoordinator` / `RdxSessionRuntime` / `RdxSessionService` / `RdxCliInvokerService`；Tools `test_daemon_client` / `test_runtime_worker` | 仓库已无 `RdxNativeLifecycle.test.ts`，不再恢复该文件名。历史打开/preview/close 证据仍有效，不代替本轮进程回执。无 token | planned | — | 2026-09-17 |
| UI-modal-backdrop-frost | `--modal-backdrop` 为 app 底 40% 压暗 + `--modal-backdrop-filter` `blur(16px)`；组件 CSS 只写 token；DESIGN 仅允许模态遮罩毛玻璃，Dropdown 仍实色 | `check:design-tokens`；`check:appearance`；disposable `start:agent-browser` | disposable `qa-1789586863139-829631c2dff7131b`（已清理）；未建 project/session；同源 `/app`。知识中心 backdrop token `color-mix(... 40%, transparent)`，computed bg alpha 0.4，`backdropFilter=blur(16px)`，`--modal-backdrop-filter=blur(16px)`。无 token | planned | — | 2026-09-17 |
| UI-modal-backdrop-dim | `--modal-backdrop` 为 app 底 65% 实色压暗，无 `backdrop-filter`；不改 DESIGN 毛玻璃禁令 | `check:design-tokens`；disposable `start:agent-browser` | disposable `qa-1789586515980-e1998f3c8d242243`（已清理）；未建 project/session；同源 `/app`。知识中心 backdrop token `color-mix(... 65%, transparent)`，computed alpha 0.65，`backdropFilter=none`。无 token | planned | — | 2026-09-17 |
| UI-modal-1610-inscribe | Settings / 知识中心在 `88vw×86vh`（硬顶 120rem×70rem）内接最大 16:10，不写死 aspect-ratio；640 全屏去圆角 | `tsc`；`check:design-tokens`；`check:fidelity`；disposable `start:agent-browser` | disposable `qa-1789585664599-ecc88928104d7b68`（已清理）；未建 project/session；同源 `/app`。1920×1080：两壳 1486.1×928.8，ratio 1.6。2227×1253：两壳 1725×1078，ratio 1.6。640×800：知识中心 640×800 原点、radius 0。无 token | planned | — | 2026-09-17 |
| UI-modal-43-inscribe | Settings / 知识中心在 `88vw×86vh`（硬顶 120rem×70rem）内接最大 4:3，不写死 aspect-ratio；640 全屏去圆角 | `tsc`；`check:design-tokens`；`check:fidelity`；disposable `start:agent-browser` | disposable `qa-1789585054290-02380320307c1bd0`（已清理）；未建 project/session；同源 `/app`。1920×1080：两壳 1238.4×928.8，ratio 1.333。2227×1253：两壳 1437×1078，ratio 1.333。640×800：知识中心 640×800 原点、radius 0。无 token | planned | — | 2026-09-17 |
| UI-modal-cap-wide | Settings / 知识中心居中 `min(88vw, 120rem) × min(86vh, 70rem)`，不铺满；1920 级跟比例，超宽才顶 1920×1120；640 全屏去圆角 | `tsc`；`check:design-tokens`；`check:fidelity`；disposable `start:agent-browser` | disposable `qa-1789584481142-dc6833a585b41254`（已清理）；未建 project/session；同源 `/app`。1920×1080：两壳 1689.6×928.8（正好 88vw×86vh），左右各 115.2、上下各 75.6。2227×1253：两壳 1920×1078，左右各约 154、上下各约 88。640×800：两壳 640×800 原点、radius 0。无 token | planned | — | 2026-09-17 |
| UI-modal-cap-search | Settings / 知识中心居中且硬顶 `min(88vw, 80rem) × min(86vh, 50rem)`，不铺满；640 全屏去圆角；设置侧栏 SearchField rest/hover/focus 走 Input，不再剥边框 | `tsc`；`check:design-tokens`；`check:fidelity`；disposable `start:agent-browser` | disposable `qa-1789583707551-29f5b9a8018fbbb6`（已清理）；未建 project/session；同源 `/app`。2227×1253：两壳均为 1280×800，左右各约 474、上下各约 227；Appearance Light/Dark 并排；知识中心三列。设置搜索 rest `borderColor rgba(255,255,255,0.1)`、`borderTopWidth` 1 CSS px，与知识中心搜索一致；侧栏覆盖只剩 width/height。640×800：两壳 640×800 原点、radius 0。无 token | planned | — | 2026-09-17 |
| UI-composer-mode-tip-chip | Fast/Max tip 为对准图标的实色圆胶囊，完全浮在弹层上方；有状态只显示状态；aria 仍拼接完整名 | `check:appearance`；`check:design-tokens`；effortControlParts 单测；disposable `start:agent-browser` | disposable `qa-1789544754093-72f0eede8f31c80e`（已清理）；project `proj_df64b05d985e`；session `sess_77afb832688f`；同源 `/app`。无配置 Provider。Forced Fast/Max tip 文案 `未配置模型`，aria `Fast/Max 模式 · 未配置模型`；radius 9999、nowrap、bg `rgb(34, 36, 40)`、centerDelta=0、overlapIdentity=false；`bottom: 100% + 24px` 时 gapAbovePopup=8.1。切 picker w=320 maxH=512 overflow=hidden。无 token | planned | — | 2026-09-16 |
| UI-composer-mode-tip-float | Fast/Max tip 浮在图标上方，raised 底，不叠进身份行；Codex overflow visible，picker 仍 hidden | `check:appearance`；disposable `start:agent-browser` | disposable `qa-1789542497670-02e8114c530c5b1d`（已清理）；project `proj_a0c1acddd404`；session `sess_05dc0093f244`；同源 `/app`。无配置 Provider。Codex 面板 overflow=visible；Forced Fast tip `Fast 模式 · 未配置模型` tipBottom=886.3 / identityTop=887 / overlapIdentity=false / tipAboveIdentity=true，bg `rgb(34, 36, 40)`；Max 对称 tipRight≈popupRight overlapIdentity=false tipAboveIdentity=true。切 picker w=320 maxH=512 overflow=hidden。无 token | planned | — | 2026-09-16 |
| UI-checkbox-outline-unify | 多选 Checkbox / CheckPill 共用空心方框 + 字色勾；Switch 仍是唯一 accent 胶囊 | `check:design-tokens`；`check:appearance`；disposable `start:agent-browser` | disposable `qa-1789542150680-c52add957af65262`（已清理）；project `proj_e20cfbe37f12`；session `sess_f31d306a00de`；同源 `/app`。Agents 工具权限：32 个 CheckPill / 16 selected，选中 boxBg `rgba(0,0,0,0)`、勾色 `rgb(244,246,248)`，无 accent 实心；Switch 开态 track `rgb(52,201,244)`。知识中心本轮无已注册空间，未采空间行。无 token | planned | — | 2026-09-16 |
| UI-composer-picker-max-height | 模型列表 picker 高到 32rem，宽仍 320；列表底 padding 避免末行被圆角裁切 | `check:design-tokens`；`check:appearance`；disposable `start:agent-browser` | disposable `qa-1789540617259-2baa690b21a3b6b1`（已清理）；project `proj_03fe660aa10c`；session `sess_a4af2c33282c`；同源 `/app`。无配置 Provider。Codex 面板 w=320 h=136.3 maxH=384；切 picker w=320 maxH=512；18 条探针滚到底 lastFullyIn、listPadBottom=8、gap=21；Escape 回面板 w=320 h=136.3 pickerGone。无 token | planned | — | 2026-09-16 |
| UI-composer-ring-while-open | Composer 外环在壳内 `:focus-within` 或底栏弹层 `aria-expanded="true"` 时保持；点滑杆等不可聚焦处不灭环 | `check:design-tokens`；`check:appearance`；disposable `start:agent-browser` | disposable `qa-1789539853924-4f82952db8f64147`（已清理）；project `proj_825df755fa3e`；session `sess_bae4c9b8aebc`；同源 `/app`。textarea 聚焦 border `rgb(51, 209, 255)` 且 `:focus-within`；开胶囊环仍在且 `aria-expanded=true`；点滑杆后 active=`body`、`:focus-within=false`、`:has(expanded)=true`、border 仍为 accent；Escape 焦点回胶囊环仍在；点壳外 border `rgba(255, 255, 255, 0.1)`。无 token | planned | — | 2026-09-16 |
| UI-composer-effort-round-thumb | 思考滑杆滑块为 32×32 正圆，inset 端点仍落在 track 内 | `check:design-tokens`；`check:appearance`；disposable `start:agent-browser` | disposable `qa-1789539336899-5434cbf4ec3e7445`（已清理）；project `proj_bc8767a4fa32`；session `sess_c6794a2cd613`；同源 `/app`。thumb 32×32、`border-radius: 9999px`；Off 端 insetLeft=0 且 thumbInTrack；无配置 Provider 滑杆 `is-disabled`，未拖 Max 端。无 token | planned | — | 2026-09-16 |
| UI-composer-model-effort-density | Codex 弹层三排收紧；Fast 实心闪电、Max 双描边层叠卡片；面板 16 / 胶囊 14 | `check:design-tokens`；`check:appearance`；disposable `start:agent-browser` | disposable `qa-1789538494046-052a04876c5d64b0`（已清理）；project `proj_d63b9ef3cc3d`；session `sess_e309ce3fb029`；同源 `/app`。popup pad/gap=8、高 136.3；滑杆高仍 48；Fast 16 fill 实心 stroke none；Max 16 fill none stroke 2、2 个圆角 rect。无 token | planned | — | 2026-09-16 |
| UI-composer-model-effort-capsule | Composer 右侧 model + effort 收成单一胶囊：收起为可选 Fast/Max 图标 + 模型名 + 思考等级；点开 Codex 面板（左 Fast / 右 Max / 中等级+模型名 / 下滑杆）；点模型名同层切到现有模型列表，选完回面板 | `check:design-tokens`；`check:appearance`；`check:renderer-structure`；effortControlParts / composerMenuState 单测；disposable `start:agent-browser` | disposable `qa-1789537157981-478b0b1e9bdf398f`（已清理）；project `proj_949ee899f4a3`；session `sess_1999b3f23274`；同源 `/app`；无配置 Provider。1920：胶囊文案 `选择模型 · 关闭`，前置 Fast/Max 图标 0，menuW=115.3 / max=192 / flex `0 1 auto`，旧 `composer-model-pill` / `composer-effort-pill` 不存在。点开 Codex：左 Fast / 右 Max 灰关 `未配置模型`，滑杆 `is-disabled`，中间 `选择模型`。同层切到搜索 +「按 Agent 配置」（当前 Agent 未配置，checked+disabled）；真实 Escape 回面板（pill expanded、popup 在、picker 无）；面板 Escape 关闭。互斥序列 afterAgent/afterPerm/afterUsage/afterModel 同时只开一个。390×844：scrollW=390 无水平溢出；menu max=96、pill=91.3 且保留「关闭」；四控件均在 viewport。Forced hover Fast tip `Fast 模式 · 未配置模型` opacity=1。无 token | planned | — | 2026-09-16 |
| UI-composer-model-pill-hug | 合并后的 model-effort 胶囊随生效模型名 hug，不预留 12rem 槽；超长 ID 用 max-width 封顶并仅实际溢出渐隐；窄容器只收紧 max-width（8rem / 6rem）。历史两胶囊 hug 证据见旧 `composer-model-pill` 记录，不作为当前选择器。 | `check:design-tokens`；`check:appearance`；disposable `start:agent-browser` | disposable `qa-1789537157981-478b0b1e9bdf398f`（已清理）；project `proj_949ee899f4a3`；session `sess_1999b3f23274`；同源 `/app`；1920：`选择模型` menuW=115.3、flex `0 1 auto`、menu max=192，胶囊 width=auto 未占满槽；390×844 单行无水平溢出 menu max=96、pill=91.3，思考等级「关闭」仍在。无 token | planned | — | 2026-09-16 |
| HANDOFF-COPILOT-ALIGN | 删除 `agent_handoff` 与 durable 状态机；`handoffs` 只驱动建议行/计划门；批准写 execution offer；人点 `applyDeclaredHandoff` 切 Agent；General 就地终答不自动回 Mission；Skill 预载仅 hash/target 匹配 | `ExecutionOfferStore` / `applyDeclaredHandoff` / `AgentPlanReviewRequestService` / `useQueuedHandoffSuggestion` / `check:contracts` / `check:skills` / `check:hooks` / `check:prompt-plan-snapshot` / `check:investigation-system` / `check:gates` / disposable Browser QA | disposable `qa-1789464684697-e863055c6a8e87e1`（已清理）；project `proj_e1d3a3979306`；session `sess_5cab083e0be1`；同源 `/app`；Settings General 交接为空、Debugger 仅 `Execute with General` 且声明四件套 Skill；空会话无建议行 / 无批准无 Execute；未声明续跑 fail-closed；声明续跑切到 `general`；`setAgentId` 可切回 `debugger`；无 `execution-offer.json`（未批准）也无 `handoff-state.json`。无真实模型回合。无 token | planned | — | 2026-09-15 |
| PLAN-GATE-L1 | Mission `plan_artifact` 覆盖活计划、拒绝修订同一份、批准冻结并只放行同 hash / 同 target / 同冻结 URI 的 execute | `AgentPlanReviewRequestService` / `PlanReviewStateStore` / `PlanArtifactWriter` / `applyDeclaredHandoff` / `ExecutionOfferStore` / `ToolExecutorFactory` | — | planned | — | 2026-09-14 |
| PLAN-GATE-UI | transcript 计划卡 + 只读面板 + Composer 待审门；Mission 仅批准后才快照 handoff 建议行；优先级 toolApproval > planReview > userInput | `planReviewRequestModel` / `workProcessPresentation` / `missionHandoffSuggestions` / `check:work-process-tool-coverage` / `check:design-tokens` | disposable `qa-1789374688563-6681812f93040d61`（已清理）；project `proj_85e9bdb7e163`；session `sess_459d84ad54cf`；同源 `/app`；卡 `plan-card is-awaiting`；面板 `role=dialog` + Esc 回卡；Composer `拒绝意见` 空则拒绝禁用；无批准的 Mission 终答不得出现 `Execute with General`；批准后建议行将 `agentId` 切到 `general`；`plan:saveToProject` 写入 `.rdx/plans/<sessionId>/plan.md` 且 `.gitignore` 不含 `plans/`；窄屏 390 侧栏收起后卡/门/面板仍可用。无 token | planned | — | 2026-09-15 |
| PLAN-GATE-QA | Browser QA：Mission → plan_artifact → 拒绝 → 修订 → 批准 → 人点声明 handoff；卡 / 面板 / Composer 门 / 建议行 / 窄屏 390 / Esc | disposable `start:agent-browser`；`HandoffProviderFixture` 为确定性工程验证，不是活模型证据。Browser 无运行期 fixture provider，未用真实 userData 重跑模型选工具 | 同源 `/app` 投影 UI 已过（见 PLAN-GATE-UI）。`conversation:answerPlanReview` 在无活 pending 时 fail-closed：`No pending plan review request was found for this turn.` 前轮未重跑活链路；2026-09-14 本轮已真实完成审阅、拒绝修订和批准冻结，完整模型交接因 8 请求预算耗尽仍未通过，见文末本轮证据。无 token | planned | — | 2026-09-14 |
| UI-composer-focus | 通过原生项目入口进入真实 Composer，复查鼠标／键盘聚焦白框、编辑／预览、附件与 Skill 操作 | Tabs 多实例 ID、禁用和键盘导航单测已过；真实 Composer 待验证 | — | planned | — | 2026-09-12 |
| UI-knowledge-data | 补齐 K01/K04/K05/K06/K09/K10/K11 实际阅读、元数据、候选、冲突、导入结果、导出与写入确认 | 迟到详情请求回归已过；空态不替代有数据状态 | — | planned | — | 2026-09-12 |
| UI-project-model | 补齐 T03 Project MCP 信任、T01 有数据表格、A06 已配置模型选择 | 当前仅无配置／空表状态，不证明真实连接 | — | planned | — | 2026-09-12 |
| UI-provider-auth | 对设备授权、浏览器授权及环境凭据取得实际成功／失败／取消证据 | 初始弹窗及本地 Ollama 请求失败已观察；外部成功态未验证 | — | planned | — | 2026-09-12 |
| UI-matrix | 补齐 Dark/Light、中英文、1440/1024/640 的受影响状态，修改后重截并由用户审阅 49 面板 | 已观察中文 Dark 1440、英文 Light 640 顶层；中间宽度实测 1023，非精确 1024 | — | planned | — | 2026-09-12 |
| UI-knowledge-relations | 独立核对 K06 ingest 关系传递及实际冲突数据来源 | 既有关系处理问题；不混入组件重构，不宣称已修复 | — | planned | — | 2026-09-12 |
| UI-browser-arguments | 独立收敛 Browser 调用中间可选参数 undefined 序列化为 null 的问题 | 保持严格 IPC 校验；不以放宽 null 接受绕过 | — | planned | — | 2026-09-12 |
| UI-sidebar-seam-resize | Docked 左右栏可见接缝可拖；drawer / 收起不挂载 handle，无溢出命中 | `ResizeHandle.test.ts`；`layoutGeometry.test.ts`；`check:design-tokens`；`check:renderer-structure`；disposable `start:agent-browser:dev` | disposable `qa-1789278812686-0ae538035f75a7a0`；project `proj_d40bc2a0d9ea`；1440 左缝 `col-resize` 且 `::before` left `-8px`，宽 420→380；右缝 `::before` right `-8px`，宽 312→360；700 `has-left-drawer` 且左右 handle 均未挂载、grid `0 0 700 0 0`。无 token | verified | 99f2dd04 | 2026-09-13 |
| UI-rail-gutter-restore | Project / Session 右栏四边走廊与 Session 卡间距同为 `--space-3`；Project 单卡 `gap: 0`；接缝可见描边不侵入卡片，透明 hit 仍可拖 | `ResizeHandle.test.ts`；`check:right-rail`；`check:design-tokens`；`check:renderer-structure`；`typecheck`；`lint`；disposable `start:agent-browser:dev` | disposable `qa-1789280650711-1d6a0ef2c66a53e3`；project `proj_e1089fbd825a`；session `sess_a49b80e253ae`；1440 Project 单卡 padding 12 四边、`gap: 0`、走廊 L/R/T 12；1440 Session 五卡 padding/gap 12、卡间 12×4、左右 `::before` content none、hit 探出 8px、右缝 312→327；700 抽屉无 handle、grid `0 0 700 0 0`、栏壳 padding/gap 仍 12。无 token | verified | 475e29f8 | 2026-09-13 |
| U00-topology | DESIGN / AGENTS / docs 跨文档拓扑一致：四 builtin 唯一；ask/plan/edit 非法 id + 无 custom manifest 运行通道 | 人工对照 `DESIGN.md` 裁决 A；U04 `check:acceptance-ledger` 短语断言 | — | verified | fbf5d639 | 2026-09-05 |
| U00-six-lanes | Knowledge 目标拓扑为六 lane（Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version）；Embedding / Semantic 不是现行合同 | 人工对照 `DESIGN.md` 裁决 C / G | — | verified | fbf5d639 | 2026-09-05 |
| U00-read-roots | canonical knowledge 读根合同已写入：`realpath(~/.rdx/knowledge)` + `realpath(<projectRoot>/.rdx/knowledge)` 仅对 `read_file`/`read_image`/`glob`/`grep` 免审批；write/edit/delete/shell/code_interpreter 双层拒绝。U02 改代码 | `docs/contracts/permissions.md`；`DESIGN.md` 裁决 G | — | verified | fbf5d639 | 2026-09-05 |
| U00-run-v3 | 文档现行合同为 Run schema v3；禁止再写「Run 当前仍为 v2」 | `DESIGN.md` 裁决 I；`docs/product/renderdoc-agent-complete-design.md` §3.7 / §22 | — | verified | fbf5d639 | 2026-09-05 |
| U00-investigation-read | IPC `investigation:read({ sessionId, artifactId, expectedHash })` 已落地；投影带完整 `contentHash`；禁止再写「无该 IPC」 | `DESIGN.md` 裁决 B / E；`docs/contracts/permissions.md` | — | verified | fbf5d639 | 2026-09-05 |
| U00-no-custom-manifest | 文档删除「用户保留的已改 ask/plan/edit 仍可按 custom manifest 运行」作为现行合同；目标态无运行通道（U01 改代码） | `DESIGN.md` 裁决 A；`docs/product/agent-manifest-models.md` | — | verified | fbf5d639 | 2026-09-05 |
| U00-ledger | 本文件已建；列正好为 Task / Criterion / Gate/Test / Browser evidence ref / Verdict / Commit SHA / Date | 本文件存在；U04 才接 `check:acceptance-ledger` | — | verified | fbf5d639 | 2026-09-05 |
| U00-hygiene | `pnpm run check:repository-hygiene` 绿 | `pnpm run check:repository-hygiene` | — | verified | fbf5d639 | 2026-09-05 |
| U01-canonical-hash | `hashCanonicalAgentSemantics` 只排除顶层 `models`/`icon`/`accent` 与 `handoffs[*].model` | U01 字段级测试；`check:settings-agents` | — | verified | 7fdd56f1 | 2026-09-05 |
| U01-v2-marker | seed 迁移 marker `schemaVersion:'2'`；v1 视为未完成并重跑；更高版本 fail-closed | U01 purge/keep 矩阵 | — | verified | 7fdd56f1 | 2026-09-05 |
| U01-crash-recovery | 隔离前写 isolation manifest；未完成事务可恢复或 fail-closed，不静默丢文件 | U01 崩溃恢复测试 | — | verified | 7fdd56f1 | 2026-09-05 |
| U01-purge-keep | 历史 id `purged-historical`；shadow `purged-shadow`；改过正文/工具的 builtin-id `retained-override`；无关 id `retained-custom` | U01 purge/keep 矩阵 | — | verified | 7fdd56f1 | 2026-09-05 |
| U01-illegal-id | user/project 非法 id 剔出 effective snapshot + `AGENT_ID_RESERVED_HISTORICAL`；无 custom manifest 运行通道 | `check:settings-agents` | build `7fdd56f1`；QA project `proj_a99a24c68de3`；canonical；1440 desktop；Settings Agents 列表恰 4（Analyzer/Debugger/General/Optimizer）；Composer Agent 菜单恰 4 menuitemradio；`[data-testid=settings-agent-manifest-diagnostics]` 不存在；`~/.rdx/agents` 仅 v2 marker，actions 6 条（3 historical + 3 shadow）；截图 `%LOCALAPPDATA%/rdc-agent-qa/7fdd56f1/u01-settings-agents-four.png` | verified | 7fdd56f1 | 2026-09-05 |
| U02-delete-embedding | 逐文件删除 EmbeddingCatalog / EmbeddingExecutionService / Semantic lane / `settings.llm.embedding`；禁止恢复 | U02 `check:knowledge-system` `forbidden.embedding-runtime`；`check:provider-catalog` | build `3bff8172`；canonical；Settings 搜索 “Embedding” 无命中；截图 `u02-settings-search-embedding.png` | verified | 3bff8172 | 2026-09-05 |
| U02-six-lanes-code | Knowledge 源码与门禁收敛为六 lane；不再把 Semantic hits 当现行门禁 | U02 `check:knowledge-system` `lanes.six` | build `3bff8172`；QA `proj_a99a24c68de3`；1440 desktop Dark；Knowledge Center LANES 恰 6（Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version）；Rebuild 文案 six retrieval lanes；无 Semantic；截图 `u02-knowledge-center-six-lanes.png` | verified | 3bff8172 | 2026-09-05 |
| U02-read-roots-code | `knowledgeReadRoots` 冻结并仅注入四只读文件工具；写工具双层拒绝 | U02 permissions / EffectiveRuntimePlan 测试 | build `3bff8172`；QA `proj_a99a24c68de3` / `sess_e2b23442e230`；Debugger + grok-4.6；`grep ~/.rdx/knowledge` 无审批命中 `AIRD-20260207-0001`（`cardId: user:cases/AIRD-20260207-0001.md`）；`glob/read_file ~/.rdx/memory/*` 审批 pending 后拒绝；Context 卡普通 file `AIRD-20260207-0001.md` + directory `knowledge`；IPC `conversation:answerToolApproval` deny `success:true`；截图 `u02-read-roots-context.png` | verified | 3bff8172 | 2026-09-05 |
| U02-settings-7 | Settings schema 6→7 一次性删除 `llm.embedding`；>7 fail-closed | U02 settings 迁移 fixture | build `3bff8172`；Settings 搜索 “Embedding” 无命中；Provider 页无 Embedding 区；截图 `u02-settings-search-embedding.png` | verified | 3bff8172 | 2026-09-05 |
| U03-mcp-legacy | `MCPManager` name-segment 仅保留 encode/decode fail-closed；无 legacy sanitized 兼容读路径 | `MCPManager.test.ts`；`check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-modes | `MODE_CAPABILITIES` 已删除；保留 `assignDefaultCaptureRoles` | `modes.test.ts`；`check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-dead-types | 删除 dead `WriteScope` / `IntakeContext` / `GateResult` | `check:legacy-residue`；`check:shared-exports` | — | verified | 60ed27dc | 2026-09-05 |
| U03-timeline-type | `AgentTimelineEntry.type` 收窄为 `user` / `agent` / `system` / `tool_call` | `src/shared/types/agent.timeline.test.ts`；`check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-coordination-mode | `coordinationMode` → `turn_handoff`（shared/main/renderer/测试同步） | `src/shared/types/workflow.test.ts`；`check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-plan-phases | `check-investigation-system` 改为 understand/work/summarize phase 合同 | `pnpm run check:investigation-system` | — | verified | 60ed27dc | 2026-09-05 |
| U03-rdx-leak | 删除 `rdx-runtime-leak.json` 写入；改 runtimeLog + `ProcessSupervisor unconfirmed_orphan` | `RdxSessionService.test.ts`；`check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-harness | `harness.ts` **不改名**，只确认只剩 `ArtifactKind` / `ArtifactRecord` | `check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U03-legacy-residue | `check:legacy-residue` 零命中（合法词精确上下文白名单）；已接入 `check:gates` | `pnpm run check:legacy-residue` | — | verified | 60ed27dc | 2026-09-05 |
| U04-gates | CI build job 改为 `pnpm run check:gates` 聚合 | `.github/workflows/ci.yml`；本地 `check:gates` | — | verified | 36fff8a4 | 2026-09-05 |
| U04-diff-check | CI 增加 `git diff --check`（有效 base 解析） | `scripts/check-git-diff.mjs`；`src/main/testing/gitDiffCheck.test.ts` | — | verified | 36fff8a4 | 2026-09-05 |
| U04-ledger-gate | `check:acceptance-ledger` schema + verified SHA ∈ `git rev-list HEAD`；文档 required/forbidden 短语断言 | `pnpm run check:acceptance-ledger` | — | verified | 36fff8a4 | 2026-09-05 |
| U05-browser-matrix | 产品级 Browser QA 汇总：1440×900 与 390×844；Light/Dark/reduced-motion；Workbench/Project/Session/Settings 九节/Knowledge/五卡/Composer 互斥/fail-closed/qaPerformance 探针。Memory 审批不在本行，见 U06 | `start:agent-browser` canonical FULL_ACCESS 1 然后 0；`check:acceptance-ledger` | build `85bb50ce`；project `proj_a99a24c68de3`；sessions `sess_3dd379b23f12` `sess_5e7563cc40a9`；canonical Dark `reduceMotion=off` 除非细行另写；证据 `%LOCALAPPDATA%/rdc-agent-qa/85bb50ce/`（12 PNG + `u05-invoke-results.json` + `u05-dom-observations.json`）；IPC 见该 JSON。细则 U05-* | verified | 85bb50ce | 2026-09-05 |
| U05-workbench-empty | Workbench 空态四 builtin：Debugger/Analyzer/Optimizer 卡 + Composer General；无 ask/plan/edit | Browser DOM + 截图 | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_3dd379b23f12`；1440×900 Dark motion=off；DOM `.empty-workbench` 三卡 + `[data-testid=composer-agent-pill]`/`button.composer-agent-pill` 名 General；无 menuitemradio Ask/Plan/Edit；IPC 无（纯渲染）；截图 `u05-workbench-empty-1440.png` | verified | 85bb50ce | 2026-09-05 |
| U05-settings-nine-search | Settings 九节 + 搜索跳转 + roving tabindex | Browser DOM | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；`[role=tab]` 恰 9；`[placeholder=Search settings]` 输入 compaction → `[role=listbox]` Compaction threshold Policy → Policy `aria-selected=true`、`[role=combobox]` value 80%；Policy `tabIndex=0` 其余 -1；Home→General End→Policy；IPC 无；截图 `u05-settings-nine-tabs.png` `u05-settings-search-policy.png` | verified | 85bb50ce | 2026-09-05 |
| U05-knowledge-center | Knowledge Center 三列 + 六 lane；无 Semantic | Browser DOM | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_3dd379b23f12`；1440×900 Dark motion=off；LANES 恰 6（Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version）；列 Cards/Candidates/Conflicts；User space 2；正文无 Semantic；IPC 无（UI 打开）；截图 `u05-knowledge-center-six-lanes.png` | verified | 85bb50ce | 2026-09-05 |
| U05-five-cards | Session 五卡空态 + 中文长名 Capture | Browser `h2` + Capture 控件 | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_3dd379b23f12`；1440×900 Dark motion=off；`h2` 恰 Progress/Artifacts/Outputs/Context/Capture；Capture 文案含 `眼睛泪腺白点.rdc` 与 1.5 GB；按钮 Open；IPC 无；截图 `u05-session-five-cards-1440.png` `u05-capture-card-1440.png` | verified | 85bb50ce | 2026-09-05 |
| U05-composer-exclusive | 五底栏互斥 + Escape 回 trigger；1440 无重叠 | DOM `aria-expanded` 序列写入证据 JSON | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_3dd379b23f12`；1440×900 Dark motion=off；几何 overlapX=0（Default.right 685.8 / Model.left 716.1）；序列见 `u05-dom-observations.json` composerExclusive（afterAgent/afterPerm/afterModel 同时只开一个 menu；afterEsc 全 false；focusAfterEsc=`composer-model-pill`）；静态布局截图 `u05-session-five-cards-1440.png` | verified | 85bb50ce | 2026-09-05 |
| U05-model-picker | Model picker 搜索 + Use Agent configuration 常驻；覆盖后 pill 显示 grok-4.6 | Browser + `session:setModelOverride` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；`u05-model-picker-1440.png` 是覆盖前菜单（底栏 Permission 文案 Default，不是模型名）；IPC `session:setModelOverride` `success:true`；覆盖后 pill 名 `grok-4.6` 见 `u05-effort-slider-qa-perf.png` 与 `u05-terminal-activity.png`；JSON `u05-invoke-results.json` `u05-dom-observations.json` | verified | 85bb50ce | 2026-09-05 |
| U05-session-isolation | 跨 session Composer 无串台 | Browser 点击 + `session.create` | build `85bb50ce`；project `proj_a99a24c68de3`；sessions B `sess_5e7563cc40a9` A `sess_3dd379b23f12`；1440×900 Dark motion=off；`session.create` `success:true`；草稿序列见 `u05-dom-observations.json` sessionIsolation（B=`U05-B-DRAFT-ISOLATION`，切 A 空串，切回 B 恢复）。create 后须 reload 才见 `.session-item-select` 列表；Light 截图同时列出两 session：`u05-light-reduced-motion.png` | verified | 85bb50ce | 2026-09-05 |
| U05-narrow-390 | 390×844 无水平溢出；底栏控件全在 viewport | CDP 几何 | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；390×844 Dark motion=off；`.app-body` min-width `0px`；`documentElement.scrollWidth` 不大于 innerWidth+2；`.composer-agent-pill` `.composer-permission-pill` `.composer-model-pill` `.composer-effort-pill` `.composer-usage-indicator` `.chat-send-button` overflow=false；IPC 无；截图 `u05-narrow-390.png` | verified | 85bb50ce | 2026-09-05 |
| U05-light-motion | Light + reduceMotion=on reload 生效后恢复 Dark/off | `settings:set` / `settings:get` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；viewport 1440×900；`settings:set({appearance:{theme:light,reduceMotion:on}})` 后 `settings:get` theme=light reduceMotion=on；reload 后 `html[data-theme=light]` colorScheme=light bg=`rgb(244, 246, 249)`；截图 `u05-light-reduced-motion.png`；收尾 `settings:set` theme=dark reduceMotion=off，`settings:get` 确认；JSON `u05-invoke-results.json` | verified | 85bb50ce | 2026-09-05 |
| U05-fail-closed | FULL_ACCESS=1 仍拒 unknown/internal/secret/desktop-only | POST `/invoke` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；channel→HTTP：`unknown:channel` 403、`internal:event` 403、`settings:getSecret` 403、`window:minimize` 403、`app:selectAvatar` 403、`settings:set` 500 schema（放行非 403）；记录 `u05-invoke-results.json`（无 UI 截图） | verified | 85bb50ce | 2026-09-05 |
| U05-full-access-0 | 未设 FULL_ACCESS 时 high-impact 403；读通道 200 | 第二轮 browser QA | build `85bb50ce`；project `proj_a99a24c68de3`；session 列表含上两 session；1440×900 Dark motion=off；`settings:set` 403、`command:execute` 403、`rdx-runtime:trustMcp` 403、`rdx-runtime:revokeMcp` 403、`rdx-runtime:trustHook` 403、`knowledge:write` 403、`session:list` 200、`unknown:channel` 403；记录 `u05-invoke-results.json` | verified | 85bb50ce | 2026-09-05 |
| U05-qa-performance | `?qaPerformance=1` 安装探针；默认 `/app` 不装 | `data-rdc-qa-performance` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；URL `/app?qaPerformance=1` 时 `html[data-rdc-qa-performance-installed=true]` 且 attribute JSON `schemaVersion:2` `eventTimingSupported:true` `longTaskSupported:true` `interactionCount:0` `pointerToPaintP95Ms:null`（滑杆 role=slider pointer-events:none；Fast/Max switch disabled）；截图 `u05-effort-slider-qa-perf.png`；JSON 同目录 | verified | 85bb50ce | 2026-09-05 |
| U05-terminal-investigation | Terminal 空态；`investigation:read` 错误面 | DOM + IPC | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；`[data-testid=runtime-terminal]` 文案 `No activity is available for the current session yet.`；`investigation:read` 坏 hash → schema violation；`sessionId=sess_3dd379b23f12`（非当前）→ `errorCode=INVESTIGATION_SESSION_DENIED`；当前 session 缺失 id → `errorCode=INVESTIGATION_NOT_FOUND`；截图 `u05-terminal-activity.png`；JSON `u05-invoke-results.json` | verified | 85bb50ce | 2026-09-05 |
| U05-mcp-high-impact | 本轮无 MCP server；FULL_ACCESS=0 拒 trust/revoke。不宣称 Memory 审批已做 | `mcp.getStatusSummary` + `/invoke` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_5e7563cc40a9`；1440×900 Dark motion=off；`mcp.getStatusSummary` 返回 `[]`；FULL_ACCESS=0：`rdx-runtime:trustMcp`/`revokeMcp`/`trustHook` 403。Tool approval 见已 verified 的 U02-read-roots-code（`conversation:answerToolApproval` deny `success:true`）。Memory 审批不在 U05 范围 | verified | 85bb50ce | 2026-09-05 |
| U06-t15-completed | T15 Debugger + WhiteHair（Android adb）正常 `completed`：checkpoint + ready report + `final_answer` 引用；负路径见已 verified 的 T18-t15-debugger-neg | 磁盘 `run.json` schemaVersion `'3'` + investigation index + luna 机器校验 | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_257be2c23d01`；run `run_2dad9f141f927f53` `kind:mission` `profileId:debugger` `status:completed`；device `android-e38b8019` serial `e38b8019` transport `adb_android` status `online`；checkpoint `cp-whitehair-eid167` `invart-6986d572b212-1788550160621`；ready report `invart-173a94986fc4-1788550214355` `sha256:3316c40ecc39baeed4a9c591fbcd539254f5cb4f908ec6317d4261b39b62cce5` `reportContract.status=complete`；final_answer 含 artifactId+hash；sourceRefs 8 条与 index hash 一致；Capture SHA256 不变 `03DF08D14E6D5819E5173209D9AC1218C2F740010104EC911A7873E97A258D42`；`workflow:listActiveRuns` `runs=[]`；1440×900 Dark motion=off；截图 `u06-t15-session.png`；JSON `u06-machine-check.json` | verified | 85bb50ce | 2026-09-05 |
| U06-t16-completed | T16 Analyzer + 中文 1.57GB capture：Observed/Reconstructed/Authoring 三层 claim + ready report complete；cancel 无迟到写入 | 磁盘 `run.json` + investigation + `conversation:cancelActiveTurn` | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_cff62330e3a7`；run `run_0f8e5559dec166c5` `kind:mission` `profileId:analyzer` `status:completed`；claims `cl-obs-capture-open`/`observed_fact`、`cl-der-active-event-147`/`derived_structure`、`cl-auth-filename-scene`/`semantic_inference`；checkpoint `cp-yanjing-v1` `invart-fb3119318569-1788552218039`；ready report `invart-e924efb74e67-1788553110003` `sha256:a38491c36d4079f987b1ec80e3df64a7dd715096f70203998d61cc8a530d8ce9` `reportContract.status=complete`；final_answer 含 artifactId+hash；sourceRefs 6 条一致；Capture SHA256 不变 `0A79926A92E7E659989BEFC2322DC93B65782252FC5BE2DE33496142735A4094`；`.right-rail` Capture 文案含 `眼睛泪腺白点.rdc` `1.5 GB`；`investigation:read` ok；cancel `conversation:cancelActiveTurn` success phase=`running` requestId `def4819a-5ae8-43d5-addb-5ad787c875f7` run `run_a17c5bdab038b000` cancelled；index hash 前后 `1A7E736B22B7B1489934D5106B4A308EF24F4FA6FF17BCCC24905A21083AACE1` lateWrites=0；1440×900 Dark motion=off；截图 `u06-t16-session.png` `u06-t16-capture-chinese.png`；JSON `u06-machine-check.json` | verified | 85bb50ce | 2026-09-05 |
| U06-t17-completed | T17 Optimizer：A-B-A Experiment `rolled_back` + rollback 三条件 + 工程 hash 前后一致 + ready report complete；Mission 侧 shell/write 被拒 | 磁盘 `run.json` + ExperimentRecord + 工程 manifest | build `85bb50ce`；project `proj_a99a24c68de3`；session `sess_db9dfe15578b`；run `run_85f6c28295a4e8b7` `kind:mission` `profileId:optimizer` `status:completed`；Android WhiteHair 当时 `Remote side of network connection is busy`，按计划改 Local 中文 capture；experiment `exp-opt-lacrimal-aba` `invart-exp-opt-lacrimal-aba` `status=rolled_back` `intervention.type=shader_replace` `rollback.executed=true` `baselineRestored=true` verifyEvidenceIds `ev-rollback-verify` `ev-shell-denied` `ev-write-denied`；未向 General handoff（Mission 侧 mutate 被拒，捕获未改）；checkpoint `cp-opt-lacrimal-v1`；ready report `invart-report-opt-lacrimal-ready` `sha256:11792293953c9ba73da74668a29baebd61f91596edab28f7499113bed1f426f6` `reportContract.status=complete`；final_answer 含 artifactId+hash；sourceRefs 8 条一致；工程目录 manifest SHA256 前后 `75444ef2b563eea2ac2df4fbb1f066fcf435e7435c6793a3eddf2ef33b4970f6`；`workflow:listActiveRuns` `runs=[]`；1440×900 Dark motion=off；截图 `u06-t17-session.png`；JSON `u06-machine-check.json` | failed | 85bb50ce | 2026-09-05 |

**2026-09-09 纠正 U06-t17-completed**：保留以上原日期、SHA、run、截图与 hash 供追溯；撤回“真实 A-B-A 已完成”的结论。原记录明确未向 General 交接、mutate 被拒，不能证明介入或回滚实际发生。权限拒绝与磁盘 hash 不变仅支持负路径；新的 verified 必须通过原生执行回执和恢复测量门禁。历史 verified 不自动代表当前版本验收。

| U07-release | 全量门禁 + coverage + build + pack；ledger 零 `planned`；交还 `instance.lock` | `check:gates` / `test:coverage` / `check:coverage-ratchet` / `build` / `pack` / `RDC_LEDGER_REQUIRE_ZERO_PLANNED=1` | coverage 2398/2398；ratchet lines 73.32 / functions 75.68 / branches 60.53 / statements 71.04；`electron-vite build` 绿；unpacked `release/win-unpacked` 无 pnpm/lockfile/launcher/cache；local pack 因 winCodeSign Darwin symlink 无管理员权限，用 `--config.win.signAndEditExecutable=false`（与「local pack stays unsigned」一致）；luna 首轮 MAJOR：两处「源码仍含 Semantic / Embedding，由 U02 删除」已在 `a31d6c00` 改成已删除；QA `instance.lock` owner pid 71808 已死。本行 SHA 为门禁/coverage/build/pack 落地提交 | verified | a31d6c00 | 2026-09-05 |
| T18-colddata-draft | 知识导入 → session Draft：`knowledge:import` 两份桌面案例；`candidateCreated: false`；`sourceStatus: fixed`；`verified: false`；再导入 `conflict` | T18 canonical Browser QA | 仓库外 QA 记录；见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-colddata-source | 知识导入源不变：`BugFull案例01.txt` SHA256 `b3885f07…c381d0`；`BugFull案例02.txt` `bfa12c54…7e35e5`；与 Draft `sourceHash` 一致 | T18 源 hash 复核 | 见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-colddata-userspace | user-space 持久化：`~/.rdx/knowledge/cases/AIRD-20260207-000{1,2}.md`；index `cardCount: 2`；Center User space 2；中文标题完整；`knowledge:query` 词法命中「发黑」 | T18 Center + query | 见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-chinese-capture-open | 中文 1.57GB capture open+preview：`眼睛泪腺白点.rdc` SHA256 `0A79926A92E7E659989BEFC2322DC93B65782252FC5BE2DE33496142735A4094`；size `1647684424`；`openProjectInput` `status: open`；`openHumanPreview` `success`；hash 2026-09-04 复测仍不变 | T18 Capture open/preview | 见 `DESIGN.md` T18 已证组 | verified | b68e4f29 | 2026-09-03 |
| T18-t15-debugger-neg | T15 Debugger 负路径：无 capture `sess_df6be27d58a5` → `MISSION_COMPLETION_DENIED`（缺 MissionCheckpoint），未伪装 completed。Settings RDX CLI 已配置；未配置 fail-closed 单测在 `adafa804` | `adafa804` 单测 + T18 session 证据摘要 | `sess_df6be27d58a5` | verified | adafa804 | 2026-09-03 |
| T18-t16-analyzer-blocked | T16 Analyzer Blocked 诚实收口：`sess_5be2b0c52a58` / `proj_a99a24c68de3`；ready report `invart-55a27b669134-1788459010567`（`sha256:3fc09696feae39145fd4c94c66c9260dda460f1da610e0d618789328aba4c5e3`）；`reportContract.status=Blocked` → `MISSION_COMPLETION_DENIED`；`cl_t16` 仍 draft；伴随 `a37c107e` | T16 文档取证 | `sess_5be2b0c52a58` | verified | 215741da | 2026-09-03 |
| T18-t17-optimizer-blocked | T17 Optimizer Blocked 诚实收口：`sess_a73c57d0d2a5` / `proj_a99a24c68de3`；ready report `invart-71244190ba45-1788459648111`（`sha256:335d77de70a9a196f150330f7ae703366dd240b6723c9714e57eb6bc4ab10bbd`，`reportContract.status=Blocked`）→ `MISSION_COMPLETION_DENIED`；未写 Experiment / 未 mutate 工程。无独立产品 commit；SHA 为首次写入 ledger 的记录提交 | T18 session 证据摘要 | `sess_a73c57d0d2a5` | verified | fbf5d639 | 2026-09-03 |
| T18-semantic | Semantic / 真实 OpenAI embed：Embedding / Semantic lane 已由 U02 删除，**不再补跑**真实 OpenAI embed 验收 | U02 `forbidden.embedding-runtime` | build `3bff8172`；Settings 搜索 Embedding 无命中 | verified | 3bff8172 | 2026-09-05 |
| T18-whitehair-open | WhiteHair local open：`sess_17b59bc0131c` `openProjectInput(input_whitehair)` → `LOCAL_REPLAY_UNSUPPORTED`（Adreno 650 `VK_EXT_fragment_density_map` vs RTX 5090）；SHA256 `03DF08D14E6D5819E5173209D9AC1218C2F740010104EC911A7873E97A258D42`；size `168591424`。BLOCKED-by-device；正路径改 U06 Android adb。不得标 verified | T18 硬件诊断 | `sess_17b59bc0131c` | waived-by-user | — | 2026-09-03 |
| UI-B0-governance | Renderer 治理：保真仅约束产品语义；`renderer-contract.json`；`check:design-tokens` / `check:renderer-structure` | `check:design-tokens` `check:renderer-structure` `check:gates` | disposable Browser QA；无 token | verified | f397d3d4 | 2026-09-08 |
| UI-B1-tokens | Token 收口：刻度补齐；primitive→semantic；hex 清零 | `check:design-tokens` hits=0 | disposable light/dark Workbench / Settings / Knowledge | verified | 66c2bc7c | 2026-09-08 |
| UI-B2-ui-kit | `ui/` 分子组件库 + Design System Preview 引用运行时 CSS | typecheck / lint / Preview 引用 `design-system.css` | Preview + `/qa` 各一张 | verified | 035caedc | 2026-09-08 |
| UI-B3-structure | features 按产品面重组；i18n 拆分；IPC 出 TSX | `check:renderer-structure` hits=0 | 冒烟：Settings / Knowledge / Terminal | verified | e9d72b0d | 2026-09-08 |
| UI-B4-settings | Settings 九节共用 kit；密度 32 | `check:settings-agents` Browser 1440/390 | disposable Settings 九导航 + 搜索高亮 | verified | 45a51b15 | 2026-09-08 |
| UI-B5-knowledge | Knowledge 三列 kit；列宽 224 / minmax(280,0.8fr) / 1.2fr；960 切换 | `check:knowledge-system` | disposable 三列空态；case TOC 仍为章节锚点 | verified | b71efb41 | 2026-09-08 |
| UI-composer-orbit-restore | Composer `is-running` 四边绕光；废止 B6 禁令；固定圆角遮罩内移动光斑；禁旋转遮罩 / `@property` / `composerEnergyFlow` / `::after` halo | `check:work-process` + `check:design-tokens`；Settings off 不受 OS 减少动效覆盖 | 2026-09-15 前轮 transform/样式采样已被用户否决，不是可见效果验收。当前改为 background-position 沿四边移动；真实 canonical 持续回合与交互仍待验证，见下方本次复验记录 | planned | — | 2026-09-15 |
| UI-B6-composer | 删除 energy orbit；壳 radius-lg；底栏 Pill 高 28 | `check:work-process` 禁 orbit；`check:appearance` | disposable 底栏互斥；无真实 provider 未验 Stop/Rewrite。现行设计已废止「禁 orbit」，见 UI-composer-orbit-restore | verified | 093caa82 | 2026-09-08 |
| UI-B7-chrome | Right Rail 空态改 EmptyState；Sidebar/Device `is-selected`；Terminal 去掉 256px 字面量 | `check:right-rail` `check:design-tokens` STOP_COLOR_EXEMPT 空 | disposable 1440 五卡空态无插画；390 drawer overflowX=false | verified | 950fb311 | 2026-09-08 |
| UI-B8-copy-a11y | Threads→Sessions；DeviceSelector/Slash/Rail/Agent 模板入 i18n；Settings 搜索焦点环；hover 配 focus-visible | `check:right-rail` i18n keys | disposable ZH 工作台/User menu/Settings/Knowledge；device aria-label「回放设备：本地回放」；无 FULL_ACCESS 故 EN 未持久化 | verified | 634892ff | 2026-09-08 |
| UI-B9-finalize | fidelity 基线复核；docs 路径；全门禁 + build；交还桌面启动权后 push | `check:fidelity` `check:legacy-residue` `check:gates` `typecheck` `lint` `build` | disposable FULL_ACCESS=1；project `proj_5b660f23c308` session `sess_316a6244e3a4`；1440 五卡 EmptyState + Composer pill 高 28 + 九 Settings 节 + 搜索 compaction→策略 + 六 Knowledge lane 无 Semantic + 底栏互斥 + fail-closed unknown/internal/secret/desktop-only 403 且 `session:list` 200；390 `bodyMin=0` overflowX=false drawer=true；Appearance `settings:set` light 持久化后恢复 dark。截图 `%LOCALAPPDATA%/Temp/cursor/screenshots/b9-*.png`。无真实 turn 故 Memory/Tool 审批未跑。command palette 合成 Ctrl+K 未打开属自动化限制 | verified | 8836d929 | 2026-09-08 |
| UI-C2-second-pass | Composer 底栏单行同高 28、窄屏图标化、model 线性渐隐；空工作台窄卡居中；Right Rail 空态恢复 restrained visual；审查漏项收口 | `check:design-tokens` `check:renderer-structure` `check:right-rail` `check:appearance` `check:fidelity` `check:work-process` `typecheck` `lint` | disposable `qa-1788837336836-70ed95920ab5d922`；project `proj_da20cf5406f2` session `sess_92b9da32c26c`；1440 send/pill 均为 28、footer nowrap、五卡 visual 112×200 + honest copy；390 footerH=30 nowrap、agent/permission/effort 收成 28 图标、model 仍显示且 max-width 6rem、三卡 `align-items:center`、`bodyMin=0` overflowX=false。截图 `%LOCALAPPDATA%/Temp/cursor/screenshots/c2-*.png` | verified | bda24070 | 2026-09-08 |
| UI-D1-settings-eight | Settings 八项导航；Workspace 一级入口删除；资源与诊断改到常规页 TaskDialog；搜索「工作区 / paths」仍跳常规 | `check:settings-agents` disposable Browser QA | disposable session `sess_bf3f3f195297`；八 tab；无 workspace section；截图 `%LOCALAPPDATA%/Temp/cursor/screenshots/` | verified | 032f819 | 2026-09-11 |
| UI-D1-knowledge-export | `knowledge:export` + `dialog:saveFile`；`rdc.knowledge-package/1` 剔除 provenance 与绝对路径，导出前 secret 扫描；再导入 session Draft、verified=false，重复 cardId 走 conflict；Markdown 只供阅读 | `KnowledgeExportService.test.ts` + live IPC round-trip | disposable；写出 qa-export.yaml / qa-export.md 再导入仍为 draft；7 条单测覆盖 secret、重复 cardId、相对路径 fail-closed | verified | 032f819 | 2026-09-11 |
| KC-import-space-draft | 知识导入写入所选 user/project 空间 draft：Cards 可见；同源 `sourceHash` 幂等不覆盖；不同源同 ID 冲突且带标题/`caseId`/已有 `cardId`；隔离不写盘；会话不再存导入草稿 | `KnowledgeImportService.test.ts` + `check:knowledge-system` | 单测覆盖空空间写入 / 同源幂等 / 不同源冲突 / 隔离不写 / v1 leftover 一次迁移；未提交工作树，Commit SHA 待提交后回填 | planned | — | 2026-09-17 |
| UI-D1-overlay-stack | `overlayStack`：Escape / Tab 只作用栈顶；Popover / TaskDialog / Settings / Knowledge 注册；知识导入弹窗与 backdrop 平级 | typecheck + disposable Browser QA | disposable；颜色 Popover Escape 不关 Settings；知识导入 Tabs 不关 Center | verified | 032f819 | 2026-09-11 |


## 2026-09-09 原生协议与指令收敛验证（未提交工作树）

本节记录本地工作树的实测结果，不为未提交代码填写 verified/Commit SHA，也不追认 U06 旧实验。

- 外部原生 parser：生产 invoker 编译出的全部 probe argv / JSON 标志通过；虚构动词和应用 session ID 参数被拒。
- 真实本地 replay：临时 capture 副本、独立 daemon context，生产 executeRdxShell 及签名回执写入路径完成 shader 介入、渲染目标导出、回滚、恢复。测试签名 key 注入隔离存储；OS safeStorage 的生产签名能力没有用该单测替代验收。
- 两次成功验证的末次制品位于本机临时目录 rdc-native-receipts-6ufgG6；baseline/restored PNG SHA256 均为 00290fb97b6c6fd1f106e152615a171cd82c67ce6ee81447e8a398efad8946b8，variant 为 1efbcedcdc3f85f444c0acbbf20dfb4216532ec86f051e05cc18f41554bdae81。源与副本 capture hash 均保持 c50cd1e7c29241c64fd33faf07cb35e802f9dc85692a8512aa36db01c956b385；finally 回滚遗留 replacement 并停止本次 daemon。
- screenshot 显示链在此前实验中未反映变体；成功结论仅覆盖实际 render-target texture export，不能扩写为 preview/screenshot 呈现正确。Remote/Android 无本轮设备正路径证据。
- disposable Browser QA smoke 通过 /qa cookie bootstrap、/app 鉴权、Origin 拒绝、app:getMeta；完整 GUI 点击/截图因自动化运行器 Windows CreateProcessWithLogonW 1385 未完成。未使用真实用户会话。QA 已停止，canonical instance.lock 不存在，桌面启动权已交还。
- typecheck、lint、check:gates、build 与最终 coverage 结果见本节末尾。此前 ShellTool OEM 中文 stdout 失败已定位为 wrapper 强制 UTF-8 解码；移除全局 Console 编码覆盖，保留 UTF-8 文件输出，并补 PowerShell Unicode / 调用方显式 UTF-8 原生程序回归。未降低断言。

指令成本只测静态注入正文：相同 profile + 默认 coordinator，使用仓库 gpt-tokenizer 估算；不包括系统/工具 schema、用户历史、按需方法、项目根指令，也不冒充完整模型请求 token。普通任务与 Knowledge 查询均以 General 默认入口为基准，是否实际调用 Knowledge 由任务决定。

- General（普通任务 / Knowledge 查询）：正文字符 3337→1102；估算 token 691→310。
- Debugger：正文字符 6588→1543；估算 token 1469→462。
- Analyzer：正文字符 6873→1643；估算 token 1507→466。
- Optimizer：正文字符 6651→1573；估算 token 1462→467。

根 AGENTS 归一化换行后 35377→7563 字符。四个 coordinator 文件（含 frontmatter）分别为 613 / 958 / 1061 / 993 字符，27 个技能 ID 保持。静态正文数字与下述完整 PromptPlan / 真实请求数字分别记录。


真实请求成本验证（用户限定最多两次，无重试）：生产 PromptPlanBuilder，General 同一段合成代码问题、相同 DeepSeek V4 Flash 参数，before/after 各一次，均正确修复 i<n 边界，无提问、无 handoff。before input/output/total = 1644/137/1781；after = 1200/210/1410；cache hit 均为 0。输入下降 27.0%，总 token 下降 20.8%。这是受预算约束的单轮文本对照，不是五场景多轮 Mission 成本结论；工具轮数未测。请求预算文件 used=2，禁止默认测试触发外部调用。完整 PromptPlan 字符数：General 7184→4949、Debugger 10449→5404、Analyzer 10725→5495、Optimizer 10514→5436；制品在本机临时 rdc-convergence-bench-c3f1cbdb20/instruction-cost。

应用生命周期实测：当时的 opt-in 原生文件现已不在仓库，不再恢复 `RdxNativeLifecycle.test.ts` 这个名字。当时使用真实 production SessionService → configured action → ShellInvocationService / invoker，副本 capture open、registry/context query、preview status/off、context clear/lease 清除通过；finally 停止独立 daemon，源与副本 hash 不变。当前同等工程覆盖改为 `OwnedRdxDaemonRegistry` / `ShutdownCoordinator` / `RdxSessionRuntime` 的 clear≠stop 与归属收割测试。preview off 必须收到所属 context 且 preview.enabled=false 才显示关闭；openPreview 空成功载荷不再被补成 open。Android prepared remote 只消费一次，成功或失败后重试都须重新连接，已有单测；真实 adb devices -l 列表为空，Android 正路径仍受硬件阻塞。

GUI 验收仍待外部条件：浏览器自动化与独立桌面自动化内核均在启动时返回 Windows CreateProcessWithLogonW 1385，无法点击或截图；HTTP smoke 不替代 GUI。实际 render-target A-B-A 结果不替代 screenshot 显示链验证，也不替代真实 provider 多轮 Mission roundtrip / OS safeStorage 的完整产品验收。

最终本地门禁（2026-09-09）：pnpm 11.7.0；typecheck、lint、check:gates、build、git diff --check 均通过。全量 333 个测试文件通过 / 4 个外部测试文件默认跳过，2471 tests passed / 4 skipped；四个 opt-in 外部测试（native parser、签名 A-B-A、应用 lifecycle、两请求成本）均已分别显式运行通过。coverage ratchet：lines 73.44%、functions 75.70%、branches 60.78%、statements 71.14%。shared export 基线已为新增编译入口重建；未改 CSS，renderer fidelity 基线保持。


## 2026-09-09 第二阶段：通用 Harness、交接 v2 与 GUI 验证

本节为当前未提交工作树验证，基底 HEAD 为 9be5141cd33225111aa7c1313c8b92389d0aa58a；不把旧 SHA 的 verified 扩大为本次真实模型验收。上节关于 GUI 1385 的阻塞描述保留为历史，本节记录其解除。

实现：General/core/execution-orchestrator 常驻正文通用化；新增 renderdoc-investigation（28 个 builtin Skills）；三种 Mission 使用六块共享 Markdown Plan。agent_handoff 的 route/execute/return 合同绑定 Plan URI/hash、必需 Skill、真实返回对象及交付要求；主进程冻结校验策略，收口通过通用接口连接现有 Investigation 校验器。两轮执行均允许回评估，第三轮拒绝；[INCOMPLETE] 出口只结束 turn，不提升报告状态。handoff v1 原字节归档、v2 单轨、旧待续跑显示重新建立提示。普通 Capsule 无 RDX 段，显式领域扩展仍受租约、串行与回收约束。

实际通过：

- pnpm 11.7.0 typecheck、lint、check:gates、build。完整 tests 为 337 files passed / 4 skipped，2482 tests passed / 4 skipped；coverage ratchet lines 73.50%、functions 75.77%、branches 60.96%、statements 71.21%。Windows 沙箱阻止 Knowledge 安全测试 realpath 访问祖先目录，完整门禁在宿主环境执行，未修改产品路径检查。
- HandoffProviderFixture 使用确定性 ProviderStrategy + 真实 AgentLoop、RuntimeToolAssembly、HandoffStateStore、SessionArtifactResolver、InvestigationArtifactService；三类代表 Plan、直接 Mission/General 路由、Small Loop、一次 Big Loop、第二次回评估、第三轮拒绝、错误返回、重复 consume、取消和重启降级通过。另有缺失/损坏/hash/跨 session 引用、必需 Skill 去重/缺失/权限冲突及 v1 原字节迁移单测。它不是实际模型规划质量验收。
- 真实原生 CLI 两项通过：RdxNativeExecution 验证实际 render-target texture 的 A-B-A 与主进程签名回执；当时的应用生命周期专项现已不在仓库，不再按 `RdxNativeLifecycle.test.ts` 复跑，历史结果仍是当时打开、所属 context、preview off 和关闭租约的证据。原生 runtime state 在独立临时 tools root；现有共享 CLI context 达到数量上限时不删除用户 context。源 capture 与副本 hash 保持不变。制品为本机临时 rdc-native-receipts-ifHtEo / rdc-native-lifecycle-pHnpni；测试签名 key 不等于 OS safeStorage 的产品验收。
- GUI 宿主恢复：策略备份 rdc-gui-rights-20260909-163648/before.inf，仅为 CodexSandboxUsers 增补 SeInteractiveLogonRight，其他登录策略及 elevated 沙箱不变；普通执行与 CUA 宿主均启动成功。
- disposable Browser QA 实际访问一次性 /qa 后的同源 /app，点击 Settings / General 指令、Skills 设置、Plan 展开、失败详情，键盘 Enter 收起，检查 disabled / selected / focus；820px 窄屏 document.scrollWidth=clientWidth=820。Composer 本地 /skills renderdoc-investigation 显示待发送预载，未发送模型请求；旧 v1 fixture 在真实 session select 后显示迁移提示并生成 v2 与归档。会话/Plan/Checkpoint 为生产存储服务写入的明确 GUI fixture，错误行是显示样本，不冒充真实模型轨迹。截图 qa-general.png、qa-plan-wide.png、qa-plan-narrow.png、qa-skill-entry.png、qa-handoff-migration.png 保存在本轮仓库外可视化产物目录。
- Browser QA launcher 66464/Electron 48132 及子进程已停止；桌面 scripts/start-rdc-agent.cmd 另以临时用户目录实启。沙箱桌面 GPU 启动失败，宿主环境同入口加载 file renderer 成功、无占锁失败；launcher 59152/Electron 3816 及子进程已停止。canonical instance.lock 不存在，临时锁 owner 已死；桌面启动权已交还。

离线成本比较使用生产 PromptPlanBuilder；相同工具能力、日期、权限、空外部历史和项目指令，覆盖 core、profile、完整 Skill 目录与按需正文。HEAD 为历史基底，并非第二阶段开始前快照；下列数字为字符和估算，非真实账单 token。本阶段零真实 LLM 请求，先前两个授权请求已耗尽。

- 普通聊天 / 轻量 coding（各一项）：10606 → 8418 字符（-2188）；当前估算 2103 token。
- Debugger 规划：13871 → 9105 字符（-4766）；当前估算 2274 token。
- Analyzer 规划：14147 → 9134 字符（-5013）；当前估算 2282 token。
- Optimizer 规划：13936 → 9124 字符（-4812）；当前估算 2279 token。
- General 调查执行（含三项方法）：17919 → 14445 字符（-3474）；当前估算 3609 token。

当前 General 调查执行比普通 General 额外 6027 字符，体现领域方法按需成本；不预设真实多轮节省比例。完整分段结果在本轮 prompt-cost.json，左全局→虚线→右细节图已同步。

后续专项：Android 真机；真实多轮 Mission 稳定性、正确性与设计符合性；原生 screenshot/preview 呈现链；生产 safeStorage 签名完整产品验收。既有 CLI/fixture/GUI 结果均不替代这些专项。未提交或推送，未创建或切换分支。


## 2026-09-09 截图反馈：工作台 UI 遗漏收敛（未提交工作区实测）

基底 `8d35ed310ffa6a1ea3d31142fdc7be210aab3f53`；本段记录当前工作区实测，不借用历史 SHA 标记新 diff 为已提交 verified。源码差异指纹（`git diff -- src scripts` 加新增 ComposerSendButton.css 原字节的 SHA-256）：`84d96c93c653a074de59e43ea1837a9393cfde5c0c5f219d334795718f34b034`。

修复范围：App 实际接入 AppShell；Knowledge / 用户入口共享 ghost Button 与 36px 行高；项目 Capture 共用 SectionHeader / Button / EmptyState 与紧凑文件行；Send / Stop 共享 Button 状态，28×28、agent accent 实色发送、变量配置圆角；用户菜单初始焦点与 Escape 返回。删除未接线壳层里的旧 footer / placeholder / 装饰与全局 focus 覆盖、原侧栏设备 variant、旧发送/停止样式及重复 Capture 覆盖。sidebar 为实色。增加壳层 CSS 从 renderer 入口可达性门禁，fidelity 清单只移除本轮实际退役 class。

实际通过：

- typecheck、lint、完整 check:gates、最终 build、git diff --check；最终完整测试 337 files passed / 4 skipped，2482 tests passed / 4 skipped。受影响 renderer 单测 23 files / 107 tests 通过。覆盖率 lines 73.50%、functions 75.77%、branches 60.96%、statements 71.21%，coverage ratchet 通过。首次并行覆盖率有三个负载超时，降低到两个 worker 后完整通过；Knowledge 沙箱祖先路径限制通过宿主执行复核，未放宽断言或产品校验。
- disposable Browser QA 同源真实应用：空 Capture、`project.inputs.importPaths` 导入两个明确 UI 列表样本、刷新 busy/disabled → 两文件列表；中英文、Light/Dark；长中文文件名与完整 title/accessible label；Knowledge 打开关闭、顶部本地设备选择；Send 空草稿禁用/有草稿启用，Tab 可到 Send 且 agent accent 焦点可见，未点击发送。
- 最终 390 CSS px：`documentElement.scrollWidth = innerWidth = 390`，七个 Composer 控件高均约 27.992px（显示比例下等于 28px）；右侧文件抽屉、左侧导航抽屉均可开关。用户菜单首项获得焦点，Escape 在宽屏返回用户入口、窄屏返回左栏展开按钮；侧栏入口同高约 35.994px，Send 圆角 9999px、background-image 为 none。
- Browser 截图相对证据目录：`8d35ed31/ui-convergence-20260909/ui-workbench-dark.png`、`ui-workbench-light.png`、`ui-capture-390-dark.png`、`ui-composer-390-light.png`。最终 QA projectId `proj_bd3db12a4f21`，无 session、无模型请求。列表文件内容明确为 UI fixture，不代表真实 capture 回放；原生文件选择器、真实模型运行中的 Stop、Remote/Android 未作本轮实机验收。
- `scripts/start-rdc-agent.cmd` 使用独立临时用户目录实启，加载 `file:///.../out/renderer/index.html`，无占锁失败。测试 Electron owner 60776 / 20544 / 70060 / 22408 / 38716 及对应 launcher/子进程均停止；canonical instance.lock 不存在。桌面启动权已交还。

未创建/切换分支，未提交或推送；既有 `.cursor/` 未修改。

## 2026-09-09 用户菜单切换与 Capture 标题栏补充验收（未提交工作区）

- 来源：用户补充截图。基线仍为 `8d35ed310ffa6a1ea3d31142fdc7be210aab3f53`；当前 `git diff -- src scripts` 加新增 ComposerSendButton.css 字节的 SHA-256：`778c2e1d8414ee620b5979dbbaa7979f21dcfb5ddbd86a8806d48677bd566406`。此前验收段落保留为历史，不代表本次 diff 的全量测试结果。
- 菜单：真实 Browser 鼠标连续点击入口，open true → false；Enter 同样切换；Escape 关闭并返回入口焦点；点击 Capture 标题关闭菜单；aria-expanded 同步。
- Capture：两个操作迁入 SectionHeader actions，共用 IconButton；旧 actions / primary / refresh 局部类已退役。真实刷新成功保留两条隔离 fixture；中英文与深浅色桌面实测，两个按钮均约 28×28 CSS px；390px 窄屏几何检测无横向溢出。
- 本次门禁：typecheck、lint、check:right-rail、check:design-tokens、check:renderer-structure、check:appearance、git diff --check 通过；sidebar / scopedCapture 定向测试 2 文件 2 测试通过。桌面 launcher 本次重建并加载 renderer 成功。
- 限制：本次为局部 UI 回归，不冒充此前全量 tests/coverage 对新 diff 的证明；未操作真实账号或原生导入文件对话框。项目和 capture 均为隔离 QA 测试资料。
- Browser 证据：`ui-convergence-20260909/ui-followup-dark.png`、`ui-convergence-20260909/ui-followup-light.png`（基线 SHA 的本机 QA 目录）。
- 启动权：本轮 Browser owner 44420 / launcher 19376 与 desktop owner 49416 / launcher 45560 均已停止；canonical instance.lock 不存在。桌面启动权已交还。

## 2026-09-09 Composer 窄宽穿插修复（未提交工作区）

- 基线 `8d35ed310ffa6a1ea3d31142fdc7be210aab3f53`，当前 source/scripts diff 加新增 ComposerSendButton.css 字节 SHA-256 `21f7d66c908bc978bb51f77c819b59062ca69af5c47e734be30c5c9b982a6371`。此前全量测试记录只证明此前快照。
- 删除 responsive.css 的 Composer footer/group 重复布局；固定图标与左组尺寸，仅 Model wrapper 可收缩。窄屏保留单行及图标化，Model 宽度自适应并仅在实际溢出时渐隐。<=720px 内容轨道取消桌面 77% 上限。
- 最新 build Browser：320px / 390px / 1023px viewport 均测量按钮无相交且同一行；1023px 时 Composer 宽584px。320px 模型文字46px、内容80px，mask生效；390px能容纳时mask=none。中英文、深浅色已观察；模型菜单可打开、Escape关闭。使用隔离项目与无provider状态，未请求模型。
- 验证：typecheck / lint / build / design-tokens / appearance / renderer-structure / diff whitespace 通过；Composer 20文件101测试通过。未再次执行全库 tests/coverage。
- 截图：`ui-convergence-20260909/composer-320.png`、`ui-convergence-20260909/composer-390.png`，本机基线SHA的QA目录。
- 最终桌面入口已加载 renderer；QA 24964/42780 与桌面 31976/56528 均已关闭，canonical instance.lock 不存在。桌面启动权已交还。

- 2026-09-09 完整改动约束复核：修复 touched Composer CSS 的 CRLF 与 fidelity 精确匹配冲突，按 .gitattributes 归一 LF；未改变动画语义或放宽门禁。当前完整 `pnpm run check:gates` exit 0（含 fidelity、architecture、session-projection、right-rail、legacy-residue、acceptance-ledger、design-tokens、renderer-structure）。全库 tests/coverage 仍以各历史快照为界，不冒充本次重跑。


## 2026-09-10 通用 Harness 收敛：领域/上下文定向验证（集成待收口）

基线 `cfb7eaa0e24d7a7eb74afa25ff246d2551f4bae7`，本轮未提交工作区。下列为受控测试，不代表真实模型、native RDX 或最终全库验证。修改期间跨过零点；五日审查入口仍采用任务开始时 2026-09-05 至 2026-09-09 的窗口，提交明细由本轮审查记录给出。

- 已验证：通用 handoff 不推断 Big Loop、不自动绑定最新 Checkpoint；普通 General 不受 Mission 完成要求；执行绑定不能用 partial 绕过返回。领域/Hook/完成/RDX 初始组合 9 文件 122 测试通过，后续 RDX 身份与 orphan scope 修正已单独复测。
- 已验证：父子 RDX 控制互斥；未确认 native close 继续托管，相关 context 隔离、无关 context 不被锁住；恢复失败保留绑定；确认 close/open 后产生新版本，旧 prepared turn 拒绝执行。重开不作为 rollback 证明。
- 已验证：Capsule 数据仅进入子 user 输入，必需 Skill 显式预载；输入 hash 授权只读，子输出归原调查且重开仍可读；不能借 read grant 覆盖父产物。嵌套执行只向直接父级转交已登记输出的只读引用。
- 已验证：压缩 Checkpoint 保存完整原始 Journal、Task/执行及领域权威记录；50k 字符消息尾部条件保留，archive 分块可分页重建；写失败/校验失败报错，保存失败不提交新 view。相关 context、Skill/PromptPlan 定向测试通过。
- `TODO(UNVERIFIED)`：最终后台执行合同、父 Provider 实际请求端到端、全部 tests/coverage/gates/build、disposable Browser QA 与真实模型/原生设备场景由集成收口阶段验证。本段不得独立作为整项完成依据。
- 本子任务未启动 QA/Electron，未占用桌面启动锁；若集成阶段启动，必须另记录清理及「桌面启动权已交还」。


## 2026-09-10 Harness 审查依据及新增定向证据（全量验收仍待收口）

审查入口：北京时间 2026-09-05 00:00（含）至 2026-09-10 00:00（不含），使用本地 Git 提交时间窗口 `git log --since=2026-09-05T00:00:00+08:00 --until=2026-09-10T00:00:00+08:00`，共 33 提交；当前实施跨过零点，不把窗口无记录地滑动。基底 HEAD cfb7eaa0e24d7a7eb74afa25ff246d2551f4bae7，交付为未提交工作区，`.cursor/` 保留；桌面原稿未修改。

| Harness-audit-1 | 保留单一 loop、prepareTurn 冻结、权限交集、共享预算、代次过滤、durable handoff、领域原生回执；移除 General→Mission+depth 推断 Big Loop、隐式最新 Checkpoint 选择及正文前缀控制终态。通用校验执行回交绑定，领域继续验证 Checkpoint/实验/报告。 | 五日提交审查：8d35ed31；最终工作区验证待收口 | — | planned | — | 2026-09-10 |
| Harness-audit-2 | 保留历史及 shadow seed 退役与 v2 迁移，不恢复官方 Scout/Skeptic 身份或旧 seed 双轨。 | 五日提交审查：7fdd56f1；最终工作区验证待收口 | — | planned | — | 2026-09-10 |
| Harness-audit-3 | 保留六 lane markdown-first Knowledge、固定 read roots、无 Embedding；Scout 仅追加受控 artifact_read 和 turn_complete，不增加 Candidate/持久 Memory 自动写入。 | 五日提交审查：3bff8172、a31d6c00；最终工作区验证待收口 | — | planned | — | 2026-09-10 |
| Harness-audit-4 | 保留 legacy residue 与组合门禁；更新被本轮 canonical Task/结构化完成替代的测试和断言。 | 五日提交审查：60ed27dc、36fff8a4；最终工作区验证待收口 | — | planned | — | 2026-09-10 |
| Harness-audit-5 | 权威边界及阶段验收历史作为来源保留；不拿旧 verified 行证明当前工作区。 | 五日提交审查：fbf5d639、5caefbbc；527e172a、9705c04b、5b158e9b、a21f7c37、85bb50ce、71a81a99、f5ff7205、c88be040；最终工作区验证待收口 | — | planned | — | 2026-09-10 |
| Harness-audit-6 | UI/本地化/分层/验收历史保留；沿当前会话投影接线检查，不以领域边界修复为由重写既有 UI。 | 五日提交审查：cc473444、9f27d43b、f397d3d4、66c2bc7c、035caedc、e9d72b0d、45a51b15、b71efb41、093caa82、950fb311、634892ff、8836d929、3a4037f4、bda24070、053330b5、9be5141c、cfb7eaa0；最终工作区验证待收口 | — | planned | — | 2026-09-10 |

新增受控验证：资源仲裁、ProcessSupervisor bounded join、ToolExecutorFactory、toolConcurrency、DebuggerRuntimePolicy、HandoffProviderFixture、Investigation contracts 共 **7 文件 58 测试通过**（2026-09-10 00:26，两个 worker）；相关实现 ESLint 通过。覆盖预取消、取消排队写任务后读任务放行、进程未退出隔离及真实 close 后解锁、精确执行会话进程所有权、结构化预算暂停与两轮执行约束。Knowledge 来源门禁已更新，沙箱运行的两项 realpath EPERM 不能解释为产品失败或通过；宿主复核由全量阶段记录。

原生专项（主执行者报告，2026-09-10 00:21:48）：独立临时 tools 与 vkcube 副本，**2 文件 2 测试通过**，约 27.83s；证据位于本机 TEMP/rdc-native-receipts-LymeYf/validation.json 与 TEMP/rdc-native-lifecycle-jPMM8H。A/restored SHA-256 `52e503065984534330ee321dbca53e164f87ee4d646b5826fc2041bbd28d13c3`，B `e1d873b5e3bdef3d6bfa784b83fe6b5c83e892e275daee8401ae66ca6f7e1357`，源 capture 未修改。这证明该次 native 回执/生命周期路径，不是后来资源仲裁 diff、真实模型调查或 Remote/Android 验证。

当前责任边界：runtime 强制权限、依赖/代次/执行结果、预算、消息所有权与消费、取消/join、进程资源和产物完整性；实际加载的 execution-orchestrator/renderdoc-execution/knowledge-scout/skeptic-review 指令决定工作拆分、探索、独立审查、补证及回评估。计划要求覆盖与科学结论不可由通用代码猜测。

`TODO(UNVERIFIED)`：最终后台消息/收口/取消集成、父子实际 Provider 输入验收、全量 tests/coverage/check:gates/build、Browser QA 和真实模型场景仍须以最终同一 diff 单独收口。执行期间的局部绿色记录不自动升级整项状态；不得承诺总 token 下降。若主执行阶段启动 QA/Electron，须在最终记录补充进程清理和桌面启动权交还证据。

- 2026-09-10 00:27 宿主复核：check-knowledge-system 与 check-investigation-system 均 PASS、hits 0，涵盖上述最新契约 fixture 更新；沙箱 EPERM 未通过修改安全检查规避。

- 2026-09-10 00:33 追加 Capsule 本地预算实现：子账本按本地上限预留，消费同步计入所有祖先；不修改父上限，不复制账本替代共享计费。派发、嵌套和重试不能重置根消耗；截止时间继承祖先 deadline，并取消等待中的 Provider。DelegationBudget/SubagentRunner/TurnCoordinator/ToolExecutorFactory **4 文件 43 测试通过**；类型检查通过。实际加载 Skill/PromptPlan/scoped resources **5 文件 20 测试通过**。后续同一文件并行集成仍须全量复测。

- 2026-09-10 00:47 追加子执行审批/信息请求验证：exact parent owner 响应、跨会话/null/child 身份拒绝、单次消费、取消与迟到响应；完成后的父消息投影保留正文和状态，控件使用真实 child turn/toolCallId；重启后无主进程 pending 的旧问题取消。相关 **7 文件 34 测试通过**。受影响类型检查/ESLint 已分次执行，最终集成与 Browser 控件操作仍待主执行者收口。

- 2026-09-10 01:02–01:04 新增受控证据：ExplorationReviewProviderFixture 实际 AgentLoop / SubagentRunner / PromptPlan / 领域工具 / handoff 捕获父子 Provider 输入，Scout 与 Skeptic 独立会话，原始来源未整体回灌；Challenge 后 General 读取原证据核查条件并回原 Mission，缺少 driver Y 实测诚实保持 partial。图像经过 artifact_read、结果外置路径后仍以 image block 到达子 Provider 输入。此为受控 Provider fixture，不是真实模型科学判断或新 driver 实验。
- 同期 ArtifactReadTool + ToolResultArtifactizer 2 文件 9 测试通过：根 Session 托管子执行大结果、精确 hash/read grant、分页重建完整错误尾部、视觉内容不被重复外置。ToolResourceArbiter 1 文件 10 测试通过：跨项目 unsafe effects 保守串行、无关只读并行；未确认退出同时保留局部与全局 unsafe 资源，真实退出解锁。最后全库验证仍由最终 diff 收口。

- 2026-09-10 01:17:14 主执行者重新验证最终资源仲裁路径：当时的应用生命周期专项 + RdxNativeExecution **2 文件 2 测试通过**，28.68s；证据 TEMP/rdc-native-lifecycle-Qir217 与 TEMP/rdc-native-receipts-y1oZ6I/validation.json。该生命周期文件名已不在仓库。限定 python/rdx 且 command 含本轮 rdc-native- 的进程检查为空。这是该次本机原生路径证据，不能升级为真实模型、Remote/Android 或尚在修复的后台集成验收。

## 2026-09-10 Harness 最终收口（未提交工作区）

本节替代上方本轮各阶段的“集成待收口”状态；那些日期、失败与局部证据保留为历史。基底 HEAD 为 `cfb7eaa0e24d7a7eb74afa25ff246d2551f4bae7`，未提交或推送、未切换分支，`.cursor/` 和桌面设计原稿未修改。最终 src/scripts/resources 共 165 个修改或新增文件的原字节清单 SHA-256 为 `255676af6c62e98f0dd01bd90597a8fea394f604a811d27e2efca84442e46501`，冻结于 2026-09-10 12:59；权威文档在其后补齐验收记录。未给本地 diff 冒填已提交 verified SHA。

### 已有能力、实际缺口及关闭结果

- **单一 AgentLoop、prepareTurn、持久 handoff、领域回执**：删除按 General/Mission/depth 推断 Big Loop、最新 Checkpoint 隐式选择和正文前缀控制；通用执行返回绑定独立于领域完成证据。验证：HandoffProviderFixture、通用完成及领域合同；普通 General 真实简单问答与后台工作均不进入 RDC 流程。
- **TaskStore 和子执行**：canonical Task v2 区分逻辑任务/执行/代次，绑定依赖和必需输出；补后台托管、取消/join、事件消费及共享预算；替代旧 v1 运行读写。验证：最终全量包含依赖、重试、预算预留失败、取消间隙、停止自身、重复/迟到事件、重启手动恢复与存储失败负路径。
- **Capsule、PromptPlan、Session Artifact**：结构化且有界回传，原始输出保存在所属 Session；Compact 从权威记录保存并核验后提交；必需 Skill 冻结。验证：受控真实 Provider 请求构建链、原图 image block、跨 Session 拒绝、hash/分页重建、失败不丢上下文；真实 OAuth 请求及重启读取另见下文。
- **六 lane Knowledge、RDX 独占控制**：保留无 Embedding/无自动晋升；按完整执行区间控制 live lease，未知退出隔离、mutation 不确定先核对、主进程受控重绑定。验证：原生 parser 与 A-B-A/close/open 独立专项已通过；资源/权限/迟到回执负路径进入最终全量。
- **Browser 事件流、Agent seed COW**：真实 QA 发现 GET EventSource 缺 Origin 导致 401、显式 model-only override 被 seed 当 shadow 清除。验证：改同源 POST fetch SSE，严格 cookie/Origin 不变；显式用户保存使用同一迁移锁与 retained marker、保存失败恢复原字节；实际 UI 事件与重启后 Luna 路由保留。
- **结构化完成和后台适配器**：真实 QA 发现 turn_complete outputs schema 与通用校验器冲突、unresolved 被错误提升为 missingRequirements、后台事件污染同步等待/最终回复。验证：保留字符串输出类型及必需输出校验；未解条件按原认识等级回传；后台生命周期只经 Task/mailbox，审批入口保留。定向 5 文件 45 测试及最终全量通过，随后真实模型复验通过。

五日 33 提交的分类与依据为上方 Harness-audit-1 至 6，审查现已关闭。8d35ed31 中的通用循环/冻结/领域回执机制保留，越界调度与完成推断删除；7fdd56f1 历史 seed 迁移保留，修正显式用户配置被清除的路径；3bff8172/a31d6c00 六 lane 与 60ed27dc/36fff8a4 legacy/gates 机制保留；其他 UI、架构与历史验收提交沿调用链复核，未扩展无关设计。未以改名、新配置或兼容双轨代替收敛。

### 最终验证

- 完整 `vitest run --coverage --maxWorkers=2`：**361 文件通过 / 4 文件按既有开关跳过，2619 测试通过 / 4 跳过**；2026-09-10 12:59:04 开始，163.25 秒，exit 0。覆盖率 statements 72.00%、branches 62.00%、functions 76.53%、lines 74.31%；coverage ratchet exit 0。跳过项为三项显式原生测试与双请求成本比较；前三项已另跑，未虚构新的成本比较。
- 最终 typecheck、lint、build 通过；最终 check:gates 与 whitespace 核对由本节追加记录给出。未删测试、未放宽阈值，Knowledge realpath 检查通过主机身份运行，未绕过权限逻辑。日志为本机 TEMP 下 `rdc-harness-final-{coverage-3,ratchet-3,typecheck-6,lint-6,build-3}.log`。
- 受控模型集成：ExplorationReviewProviderFixture 使用生产 AgentLoop / SubagentRunner / PromptPlan / handoff，Scout 独立探索、Skeptic 独立上下文形成 Challenge、General 按引用补证、回原 Mission 评估；未测 driver Y 保留 partial。该测试证明执行和输入契约，不冒充真实模型科学结论。
- 原生专项最终资源路径：01:17:14 的应用生命周期专项/RdxNativeExecution 2 文件 2 测试、28.68 秒；A/restored hash `52e503065984534330ee321dbca53e164f87ee4d646b5826fc2041bbd28d13c3`，B `e1d873b5e3bdef3d6bfa784b83fe6b5c83e892e275daee8401ae66ca6f7e1357`。该生命周期测试文件名已不在仓库。本轮后续修复不修改这些原生/资源源码。证据 TEMP/rdc-native-receipts-y1oZ6I/validation.json 与 TEMP/rdc-native-lifecycle-Qir217。

### 真实 Browser / OAuth 行为证据

按用户授权，以本设备授权的隔离副本打开 `D:\Projects\agentTest\rdc`，project `proj_fb313da0eedd`、新 session `sess_9fd6daa3c1e2`；真实路由 **chatgpt-account / gpt-5.6-luna / low**，由保存的 Provider 请求与 usage 验证。以下为真实应用，不是 renderer demo 或 fixture server。原项目 capture 未打开或修改。

- 简单 General 请求 19×29 得 551，未创建 Task 或调用工具；POST SSE 正常使 UI 退出 Working。
- 两个独立后台执行 `execution_1789016216461_aba0744d` 与 `execution_1789016217025_9c06b17f`，实际 Provider 运行区间重叠 **59710ms**。父 turn `turn-ec808cbbc916-1789016181581` 于 12:57:02.604 正常结束；子请求持续至 12:58:00.161 / 12:58:03.254。父回复后执行未被停止，完成后由事件分别续跑父模型，无模型轮询工具。
- 两个执行均 completed，analysis 分别 3423 / 3851 UTF-8 字节，4 / 5 条 unresolved 与 scope 保留；父输入只有有界投影、明确 externalizedFields 和 URI/hash，未回灌完整子分析或 transcript。实际请求逐项断言路由、Low、父历史隔离、条件保留及 artifact 字节 hash。可复查证据 TEMP/rdc-harness-real-qa-evidence/real-background-provider-proof.json 及脱敏 Provider records；不据此推断总 token 必然降低。
- 重启后无自动续跑；显式新请求经 artifact_read 读取 A 的同一 hash `40f1591d6fb54de6419154091f835b1b84439f775e49e42890995cd755ef7925`，恢复第一项测试输入/预期、顺序域未定条件与“仅设计、未执行”的适用范围。B hash `bddd5c69e534994b7f054b797b2a3b8ed3958a2ce933834077f9bf66363ab966` 同样通过磁盘字节核验。
- 真实运行的 QA-CANCEL `execution_1789016583064_374941db`：父回复先结束，点击 **Stop all session work**，545ms 后取消/join 完成并持久化 cancelled；UI 停止入口消失，后续未自动唤醒父模型。证据 real-cancel-proof.json 与 task-state-final.v2.json。取消期间没有 shell/RDX 副作用。
- 初次真实 QA 的失败记录原样保留：schema 拒绝、错误完成判定、父 final_answer 缺失；未用后来的成功覆盖旧执行。修复后的新执行具有独立 ID，未用重试重置旧预算。

### 责任、边界与桌面交还

runtime 强制权限/所有权/依赖/执行代次/输出存在/预算/取消/join/消息消费/产物完整性；调用方组织 Capsule，实际加载的 Agent/Skill/Prompt 与模型选择直接执行、重探索委派、独立审查、补证和 Small/Big Loop。Mission 最终评估仍在原 Mission；root 两轮 execute/return 是上限，不是自动循环次数。RDC 证据有效性、签名回执、实验恢复保留在领域工具与受控扩展。

本轮已复现的实现缺陷全部修正并复验。外部资格边界仍明确：Remote/Android 真机、本任务以外的 provider/model 组合、真实模型完整 RDC 科学调查的质量/稳定性未由上述受控链路证明；没有将其冒标为通过，也没有以这些限制掩盖已知实现失败。

本轮 Browser/Electron 已停止；最终桌面 `scripts/start-rdc-agent.cmd` 以新临时目录实启并加载 file renderer，未发生占锁失败。最后 Browser lock owner 36264、desktop owner 30448 均已退出；canonical `%APPDATA%/rdc-agent/instance.lock` 不存在，临时锁仅保留死 owner。授权副本及其 Local State 已删除，canonical 授权仍保留；未停止用户其他进程。**桌面启动权已交还**。

- 最终归档：上述 TEMP 证据已复制到仓库约定的本机 QA 路径 %LOCALAPPDATA%/rdc-agent-qa/cfb7eaa0/harness-20260910/，Provider 记录均为应用脱敏副本，无 token/cookie/secret。13:07 最终源指纹复核一致、git diff --check 通过。第一次最终 gates 在 ledger 三列表格上被固定七列 schema 拒绝，已改为条目说明，未修改门禁。

- 2026-09-10 13:10 最终聚合 check:gates exit 0，包含 contracts/Agent capability、会话投影、右栏、Knowledge/Investigation、legacy residue、acceptance ledger、Provider、release config、design tokens 与 renderer structure。日志 rdc-harness-final-gates-6.log；格式修正未触及冻结源码。最终 git diff --check 通过。


## 2026-09-10 产品与执行连续性收敛实测

基线 `e1d137b4`，在当前工作区继续修改；以下是未提交工作区的实测记录，不把该基线 SHA 当作新代码已提交证明。保留上文历史失败与撤回记录。本轮没有另建版本化引擎、Task 存储或 Compact 产品入口。

- 已复用：单一 Agent loop、Task/执行/mailbox/root budget、durable handoff、Journal、Artifact、PromptPlan、资源仲裁；Investigation 与 RDX 仍是领域边界。删除旧 session 派生窗口存储与按头尾/消息大小删减的模型压缩路径，统一在执行安全请求边界维护窗口。
- 实际加载指令已修正主动目标澄清、少量渐进问题、Unknown/skip/freeform 与授权分离、重知识隔离和独立 Skeptic、全文结果由 runtime 保存。工具搜索、Capsule 模型/推理参数、Task 精确输出键说明与实现相连。
- 受控测试：原始媒体 hash/授权/配额与读取恢复、Unicode 分页重建、冻结工具配对、候选安装失败/取消/状态变化、Provider opaque 状态隔离、父子预算/迟到消息/取消/join/重启手动恢复由对应合同测试覆盖。不得据此宣称所有 Provider 或原生实验现场通过。
- 真实产品、真实模型：隔离 userData，项目 `proj_c630c5bea6e8`（`D:/Projects/agentTest/rdc`），全部验收请求采用 ChatGPT OAuth `gpt-5.6-luna` / Low。`sess_bb6c6f8eea3d` 一句帧时间解释直接完成，无 Task/调查强制流程。`sess_fbdb96eea058` 从模糊白点经三题澄清，两个 unknown 与严格保留高光进入后续请求；历史 Mission 完成误判失败已保留，19:08 普通跟进正常结束。
- Analysis `sess_62810cf73cd4`：用户仅称偶尔卡顿，实际回答形成“新区域、0.5–2 秒、自己恢复、能否稳定复现未知”，20:16 后续回复给可交接记录模板且未猜测原因。19:54 误把澄清标为调查完成导致失败的记录不抹除；完成声明现先向模型返回可修正错误，最终报告门禁保持。
- Optimizer `sess_fbdb96eea058` 20:08：真实视觉请求收到两幅人工图，模型识别候选去掉右点但改变左侧高光大小/位置/形状及背景，拒绝把它当画质合格或真实项目实验成功；提问收敛质量标准。图像为受控样本，不是 capture Ground Truth。baseline SHA-256 `b5d349fc135787541abc64b2fa39df5f7f35eb58af68dd7ee9d7db0e293258ad`。
- 材料 GUI：Composer 实际上传、意图/条件/比较组保存、键盘移动 ROI、重启后原图可读。20:22 修复并验证跨消息同组对照；900×700 下 dialog clientWidth=867、scrollWidth=867，两张原图加载成功；Esc 后焦点回到 material-after.png 附件，viewport 已恢复。用户标注与工具观察明确分开。
- 长任务 `sess_e9b196a26a82`：700 行人工负载（不是测量）；原始来源 `session://tool-outputs/compaction-authority/130b0c66b071.json`，SHA-256 `91fc25741e266c289f8b4686321edd42a4d4b3a2761ab85d47375549a22a3d75`。首次过大输入外置，原始 JSON 可分页恢复。父多次、子执行 `execution_1789042078202_facd8c23` 连续三次真实压缩；压缩调用没有调查工具，实际读取覆盖原始分页，后续不能改名修订与原始不可修改分层。该子执行最终因 Task 输出键不匹配失败，不能以压缩 UI 成功宣称整体验收成功；对应权威键传递及声明预校验已修复并继续复测。
- 实际 Provider wire：20:20 前收集 52 份实际 fetch JSON body，52 份均 Luna/Low，tool call/result 集合逐份相等；9 次无工具调用，12 份只有 Capsule 用户输入的隔离请求，2 个原生 image payload。请求原 body 保存 SHA-256，导出脱敏结构不含认证头、原始 reasoning 或签名内容，图像载荷以 data URL hash/长度表示。这里的数字证明协议观测，不证明科学结论。
- 本机证据存于忽略目录 `.local/plans/product-convergence/`（wire-evidence.json、wire、QA 日志、测试日志），原始模型快照及媒体在本轮隔离 userData。不得提交授权副本或 bootstrap。此前全绿不能替代后续 diff；最终测试与清理结果在下方补记。
- 明确限制：原始文本与权威状态超出专用压缩调用预算时安全暂停，尚未证明任意长度连续压缩；未做 Provider 全路由原生 compaction 实测。完整真实项目 Ground Truth 按用户既有约定分期，本轮图像和长文本 fixture 不替代原生 RDX 因果实验、rollback 或跨设备验证。


### 后续复测与证据校验

- 20:24 新 Task `task_1789043133638_485fda58` 的执行 `execution_1789043157477_9d5c8a00` 已 completed，精确输出键为 analysis；完整结果 `session://tool-outputs/subagent-execution_1789043157477_9d5c8a00.json`，SHA-256 `458692f6b5ae68b9430776738d9f1f41a1fddcdc4a3b0b683072e66567f2c4a4`。父回复先结束，终态事件触发原父评估；父在再次自动压缩后正确将旧 artifact 的自述与原始分页证据区分，最终 partial 不冒充科学完成。
- 独立 wire 校验补齐双遍读取证据：对 `execution_1789042078202_facd8c23` 时段的实际 function_call_output 按 call_id 去重、游标顺序拼接。两遍各 5 页，分别重建同一个 SHA-256 `91fc25741e266c289f8b4686321edd42a4d4b3a2761ab85d47375549a22a3d75`，解析样本序列均严格等于 0–699。见 `double-pass-wire-proof.json`。这证明连续三次子压缩期间真实读取完整原始材料，不撤销该执行的完成字段失败，也不代表人工数据为测量。
- 最终核心回归：原用户权限完整 coverage 363 文件通过、4 跳过，2633 测试通过、4 跳过；lines 74.41%、functions 76.40%、branches 61.90%、statements 72.05%，coverage ratchet 通过。后续同模型恢复 Agent 身份的单点修复再跑相关 3 文件 49 测试通过；typecheck、lint、check:gates 通过，启动器实际构建并加载。沙箱下 Knowledge 8 项路径/权限相关失败独立记在 coverage-final.log，原用户权限复测全通过，未修改安全断言。

- 20:32 最终构建真实重启与 Session 切换后 General/Optimizer 均保持 Low。Artist 回答“严格保持高光位置/形状/亮度与背景”实际进入下一请求；回复将允许变化范围限定为右侧异常点，保留人工示意限定，未执行实验或修改。
- 独立 Scout→Skeptic→Challenge 补证→原 Mission 返回的完整调用链由 `ExplorationReviewProviderFixture.test.ts` 在实际 Agent loop/PromptPlan/领域工具组合上验证；这是受控 Provider 证据，不标为真实模型完成原生 RDX 因果闭环。

- 最终 wire 汇总为 64 份，全部 Luna/Low，逐份工具配对无缺失；11 次无工具压缩调用、15 份 Capsule 单用户输入请求。4 个图像载荷的 data URL SHA-256 与本地原图逐字节编码相同，确认没有用缩略图替代原图。统计包含多个安全边界，不等于独立执行数量。
- 清理：停止本轮 Browser QA、launcher 及 Electron 子进程；隔离 home（模型窗口/压缩阈值覆盖）与 secrets/Local State 授权副本已删除，保留会话及脱敏证据。canonical 桌面入口实际启动到 Settings/RDX/Debugger 初始化，未出现 userData 占锁拒绝，随后关闭本轮桌面实例；QA 与 canonical 锁 owner 均已退出，无残留 launcher。桌面启动权已交还。

- 20:36 最终全量复跑出现一项失败：BackgroundSubagentService 跨会话取消场景在写进度消息时遇到 Windows `EPERM rename task-state.json`（不是取消权限断言失败），其余 2633 项通过。已保留 coverage-delivery.log。补齐同一原子候选文件的有界 EPERM/EBUSY 重试，未引入备份切换或删目标路径；故障注入验证瞬时拒绝后仅提交一次、持续拒绝原文件字节不变且候选清理，相关 2 文件 16 测试通过。重新运行全量回归，结果补记于后。


最终复验（20:44–20:45）：`coverage-delivery-recheck.log` 全量 363 文件通过、4 跳过，2636 测试通过、4 跳过；lines 74.42%、functions 76.41%、branches 61.91%、statements 72.07%，ratchet 通过。最终 typecheck、lint、check:gates、diff whitespace 检查通过，AgentOrchestrator façade 799 行（<800）。最后代码重新构建后 canonical 桌面入口成功初始化；本轮桌面 PID 41092 及子进程已停止，锁 owner 已确认死亡，无 QA/desktop launcher 残留。桌面启动权已交还。

实际结果保存补证 `result-persistence-proof.json`：新完成子执行全文 8203 字节，父通知 2479 字节，outputs 超限部分外置；通知引用与真实文件 SHA-256 相同，文件保存时间早于通知。协议配对、原图字节校验、两遍分页重建与本条测试数字均为可复查证据；未将模型自述或 UI 成功当作原生实验成立。

## 2026-09-11 Settings / Knowledge 现代化重设计

实现提交 `032f819`。上表只把实际跑过的三项标为 verified：八项导航、知识包导出再导入、弹层 Escape 分层。门禁侧 `typecheck` / `lint` / `check:gates` / coverage ratchet / `build` 已通过；disposable Browser QA 后 `instance.lock` 不存在，桌面启动权已交还。

本轮明确没有当作已验收的部分：

- 参考图 T03 / H03 / T04 / T05 / A04 / K04 / K05 / K06 / K12 保留现有字段与实现，只跟着共享组件和 CSS 重整，没有按图重排版式。
- 明暗主题切换、英文 locale、640px 全屏没有逐面板走查。
- 颜色选择器拖拽受 Browser QA 坐标系限制，改用 HSV 几何单测覆盖往返与色域/色相映射。
- 参考图橙色 `#cc7d5e` 是 Absoluty 预设，不是产品默认；默认仍是蓝色 `#33d1ff`。Absoluty / Codex / GitHub 预设原样保留。

## Settings／Knowledge／Composer 发布后待验收项（2026-09-12）

本轮提交包含已有视觉与运行修复及组件职责收敛；代码检查通过不等于 49 面板视觉验收通过。以下待办随本节所在提交发布，不沿用历史 verified 结论。


本轮工程验证：typecheck、lint、design-tokens、renderer-structure、fidelity、appearance、settings-agents、knowledge-system、provider-system、hooks、legacy-residue、repository-hygiene、check:gates、build 通过。完整 tests 与 coverage 使用 --maxWorkers=4 复跑，2676 passed / 4 skipped，coverage ratchet 通过；默认并发初跑超时，未调整测试阈值或断言。后续发布不自动关闭以上待办。

## 2026-09-13 Session Capture 内嵌回放升级

本轮在当前分支实施，未提交、未推送。Agent 基线 `b046757f21161b60935abc3da0747048d6e51075`，Tools 基线 `6bc341a1dd8718afcfd50cb052829feb311e83fb`；基线不是未提交修改的验收身份。Tools 原有 `.qoder/repowiki` 修改保留。本机执行计划、Tasks 和最小运行回执位于 `.local/replay-upgrade/`；下列记录保留实际失败与复验边界。

- 已实测 Local：通过 disposable Browser QA 连接真实 Electron main、IPC 和原生 CLI；Open 自动选择真实 Present EID 14，输出 603×653 画面。EID 5 没有颜色输出，EID 6 为清屏，连续拖动回到 EID 14 恢复立方体；依据不同画面而非按钮文案判断 apply 成功。capture 完整 SHA-256 为 `00797a27e6316a0cf4369327f9db30a21635fa757673b3f9712af07989145ba8`。原生 smoke 图片用于回放验收，不是 GPU 科学实验的效果证据。
- 已实测隔离与输入生命周期：同一 RDC 在 A/B 两个 session 中使用不同 context UUID；关闭 B 不关闭 A。改变选择进入待切换，取消保留原绑定，应用切换先关闭旧 context。删除一个同内容输入时，另一个输入的活跃回放保留；删除最后一个输入后，其关联 context 释放、实时图片清空，原有 Capture 空态恢复，不保留新 Tab／滑条／选择器。
- 已实测 UI：中文／英文、深色／浅色、默认右栏、窄屏 drawer、长文件名、事件输入 Enter、滑条 Home／End、Tab 左右键、drawer Escape。900×700 viewport 请求下实际 CSS 宽度 818，Capture clientWidth 与 scrollWidth 均为 397，没有横向溢出。重启恢复选择资料，没有自动打开或占用设备。
- 性能小样本：原生 PerformanceObserver Event Timing（16 ms 采集阈值）六个非零 interactionId，p95 为 24 ms，Long Task 为 0；一次 EID 6→14 的请求到 applying 投影约 12.1 ms，到新图片可见约 380.9 ms。该样本不能代表全部设备、capture 或持续拖动分布；原生 apply 与导出在一个串行回执中，未独立测量 GPU／网络分段，不把工具往返时间当作交互性能。
- 第一轮完整验证：380 个测试文件通过、4 跳过，2733 项测试通过、4 跳过；coverage lines 74.8%、functions 76.6%、branches 62.03%、statements 72.41%，ratchet 通过。typecheck、lint、check:gates 和 build 通过。Tools 后续完整 Python suite 268 通过，Markdown/catalog 25 文件检查通过。后续完整性修复需以新的验证记录覆盖其受影响范围。
- 发现并修复后复验：共享设备预留空隙、生命周期与 Agent preparation 竞争、迟到 open generation、观察失败误用旧 EID、清理失败阻止空输入投影、历史组件跨 scope 引用、右栏不能滚动、无输出事件永久 applying、手动 Present 事件不能取得最终画面。完整性审查另指出真实传输进度、修改状态／原生 revision 写入和局部失败状态尚需补齐；执行 Tasks 记录修复与独立复验，不以此前绿色结果冒充最终通过。
- Android 边界：设备 `e38b8019` 可见，已有用户的 RenderDoc helper 正在运行。本轮未重启或停止该 helper。现有绑定的客户端 RemoteServer 没有可确认设备画面呈现的接口，不能用应用内 PNG 或 Win32 输出窗口替代 Android 屏幕验收。Android 呈现保持 `blocked / TODO(UNVERIFIED)`。
- 模型边界：隔离 QA 未配置 provider；使用现有模型凭据的询问尚未获答复，未复制凭据。Debugger／Analyzer／Optimizer 的真实模型执行、同 EID 修改／恢复与足迹联动保持 `TODO(UNVERIFIED)`；受控测试和持久记录读取不能代替这项证明。

最终修复与验收补证：

- 完整性遗漏已修复并独立复查：原生真实传输回执贯通；revision／修改状态／显示参数写入；失败事实使用未知 EID 且不附旧图；Agent 图片与其操作信息成对投影，手动帧回放不覆盖；错误、最终目标警告和设备呈现不完整均显示局部就绪；main 为每次操作分配独立 operationId，并在同次阶段和结果中保持相关性。独立冻结源码复查 54 项测试通过，在该修复范围内无剩余可操作发现。
- Android 生命周期收敛：启动前检查两种架构的 helper，查询失败时拒绝继续；移除无条件启动前 force-stop；清理时核对记录的自有 PID 集合。真机只读检查前后均为 arm32 无 PID、arm64 PID 29255，未安装、推配置、启停进程或建立转发。它证明占用识别和保护边界，不证明 Remote 打开或设备显示。
- 最终构建再次实测 Local Open→EID 5 无输出→EID 6 清屏→EID 14 最终画面→Close。EID 5 卡头显示局部就绪，没有错误重试入口；Close 期间保留画面，确认释放后清除。实际投影包含原生 revision、baseline 状态和 main operationId。
- 历史读取使用明确标注的受控持久样本，经真实 main IPC 在重启后读取：默认选择最近成功步骤，支持 14→11→未知 EID 的提交顺序，失败步骤无图片，播放到末尾停止；回看时 context 仍为空。打开后手动 apply EID 6，历史仍显示匹配其操作的 EID 11 图像。该样本没有生成假的 Agent 调用、实验修改或消息证据。
- 最终完整应用验证：381 个文件通过、4 跳过，2749 项测试通过、4 跳过；coverage lines 74.83%、functions 76.59%、branches 62.07%、statements 72.44%，ratchet 通过。与构建／门禁并行的上一轮出现三个既有 Investigation 测试 5 秒超时；重负载结束后以 `--maxWorkers=2` 完整复跑通过，没有修改测试阈值或断言。最终 typecheck、lint、check:gates 和 build 均通过。主 agent 独立重跑最终 Tools 完整 suite：275 通过，20.20 秒。
- 未提交源码身份：Agent `0d0eaa8027ce60109ae1774746bc142ba232f19f98daae7b038b4b4b3ebf34c0`，Tools `0c9b8aa66cdac3d1fc41765d156e3ea324b36aa61497e390b4ad52acaa6dfb85`。算法为排序后的 Git tracked 与非忽略 untracked 文件路径、NUL、内容 SHA-256、LF 所组成记录的 SHA-256；删除文件用 `DELETED`，符号链接用其链接文本；排除受保护的 `.qoder/` 和本验收文档以避免回执自引用。具体基线和文件数记录于本机 `source-identity.json`。
- 正式 `scripts/start-rdc-agent.cmd` 使用本轮临时 userData 实际启动，加载最终 `file://` renderer，未出现占锁失败。QA owner 129936、desktop owner 133808 及自有子进程均已停止；原有 canonical lock owner 17064 已死且未被修改。没有停止用户的其他进程。桌面启动权已交还。

完整计划仍不宣称全绿：Android Remote／设备呈现和真实 provider 的 Agent 执行保持上述 `blocked / TODO(UNVERIFIED)`；代码、受控测试、真实 Local 与历史读取各自按实际证据成立。磁盘清理回执在本机 `cleanup-receipt.json` 中记录最终检查结果。

最终收口：仅移除 ResizeHandle.css 文件末尾多余空行后重新 build 通过，两库 git diff --check 通过；上述源码指纹已按最终文件重新计算。本轮临时 QA 项目、capture 副本、测试目录和自有 context 残留已清理，保留最小验收日志与回执。桌面启动权已交还。Android 与真实 provider 验收阻塞保持不变。

## 2026-09-13 Tools 操作收敛与应用固定对接

本轮在当前分支实施，未提交或推送。Tools 基线 `7f5b085b999641977863f91cdb984e667db36629`，Agent 基线 `d2aecfad274552b7a1e2df8ad9076af5998120a4`。执行状态沿用 Tools 仓库的 `docs/tool-convergence-tasks.md`；以下只记本轮已验证事实，不借用前轮绿色结果。

- Tools 定义、注册与生成目录为 124 个操作，移除名称不再执行；工具版本 2.0.0，canonical envelope 保持 3.0.0。完整 Python 测试 286 项通过；后续耗时修复的 5 项定向测试独立通过，覆盖全事件返回、数值枚举、秒到微秒换算与非法数据拒绝。source gate 与显式发行包检查已分开，两个新增分支独立验证通过；未生成发行包。
- 真实小 fixture 验证了管线目标、绑定格式、OBJ 几何、纹理统计不落盘、像素历史、Present 原子观察以及关闭/重开。独立 preview 实测 on、事件切换、off 与专有 daemon 清理通过；没有目视原生窗口，不将协议状态扩大为视觉验收。
- 应用固定对接的版本、catalog 指纹、身份、取消、关闭失败恢复、冻结配置与 Settings 安装状态测试独立通过；生产 argv 的 7 个固定操作、9 个本地/远端/观察变体通过实际 Tools schema 校验。
- Android 外部边界：设备 `e38b8019` 在线，一次 connect 返回 `android_helper_occupied`。当时仅检测到 helper 进程，未确认服务被其他会话占用；未重启、未上传 WhiteHair，ping/open_replay/observe 与设备呈现尚未验证。测试自有 daemon 已停止。
- 真实设置只移除了 tooling.rdxActions、tooling.rdxCli.catalogPath 和 tooling.rdxCli.jsonMode；逐项比较确认其他解析内容不变，配置的 CLI 能返回 schema 1 的 124 项目录。真实 Settings 页面显示可用 2.0.0 / 124 个操作；空 executable 禁用验证、未保存配置提示、深浅主题和 800×700 请求视口的窄窗口表单均经过实际点击检查。已恢复原深色主题，最终比较确认其他设置完全一致，恢复备份已删除。
- 能力权限和五阶段证据的独立定向检查 60 项通过；三个 Mission 的 requiredSkillIds 交接、General 实际 preload 和可见性检查 59 项通过，四本 Skill 和生成参考校验通过。完整应用测试 2792 项通过、3 项条件跳过；coverage ratchet 通过（lines 74.84%、functions 76.61%、branches 62.12%、statements 72.43%），类型、lint、工程门禁和构建通过。首次完整检查揭示的 schema 互斥定义及 Settings 分层/退役生成基线已修复，只复验直接受影响范围。
- 大 capture 直接读取 `D:/Projects/agentTest/rdc/.rdx/inputs/眼睛泪腺白点.rdc`，没有复制。真实应用打开最初暴露 native 成功结果缺 context 身份；三个生命周期结果现返回真实身份，应用校验没有放宽。修复后打开、1650 项完整事件索引、EID7388 导航、观察、context 查询、正常关闭与新 context 重新打开通过。requested/applied/image EID 均为 7388，目标为 ResourceId::2002006、slot0，真实画面已目视；窄窗口 Capture 抽屉滚动和控件可达性通过。该 capture 没有可唯一确认的最终 swap-buffer，默认 EID147 无颜色输出，页面如实保留部分就绪及无图事实。
- 真实 Provider 边界：该真实设置启动后报告 hasConfiguredProvider=false，Composer 没有可选模型，未执行模型请求。真实三个 Mission 消费手册的效果仍未验证，确定性加载链不是模型效果证明。
- 最终独立真实 GPU 签名 A-B-A 通过（1 项，16 秒）：真实 baseline 像素、shader intervention、不同像素的 variant、真实 replacement 回滚、baseline hash 恢复，以及主进程签发的五阶段回执均验证通过。正式桌面启动脚本复用现有构建启动成功，窗口标题为 RdcAgent - RenderDoc Debug Agent；本轮自有桌面实例已停止。外部 Android 与真实 Provider 边界保持上述未验证状态。
- 最终清理完成：统一临时根 `Tools/intermediate/tool-convergence-tests`、本轮专属回放 `D:/Projects/agentTest/rdc/.rdx/replay/sess_0cf7f31df1db`、真实设置备份、临时 coverage junction、图像/导出和精确自有 context 残留均已移除。测试目录不同执行身份的 ACL 已分别处理，最终删除无错误且两个根目录均不存在；没有沿链接删除。真实输入、既有回放、用户记录、依赖与当前构建均保留。
- QA、桌面验证实例及自有子进程已停止；一个自有查询 daemon 正常停止超时后，按已确认 context 和 PID 清理并确认消失。应用正常关闭/重新打开的通过证据独立保留。canonical 桌面锁不存在，桌面启动权已交还。最终两库差异空白检查与 Tools Markdown 27 文件检查通过。
- Task 已更新：T01–T07 通过；T08 的本地验收和清理通过，仅 Android helper 占用与无真实 Provider 仍为外部阻塞。无剩余本地代码、文档或清理任务；不将未验证的远端及真实模型效果声明为完成。

用户后续要求取消版本分代设定：撤回 Tools 发布号升级，删除应用的 2.x major 门槛及专业手册 toolsContractVersion 绑定。接入依据实际 JSON 格式、catalog 指纹、操作参数和能力；包元数据仅用于诊断。此前 2.0.0 的 UI 记录是当时实测值，不是当前接入要求。定向应用测试 20 项、Tools 文档及 CLI 测试 6 项通过；生成手册新鲜度、类型、lint、构建及差异空白检查通过。本次未启动 QA/Electron，未新增临时测试目录。

## 2026-09-14 Android 连接与 Mission 确定性收敛

执行状态继续使用 Tools/docs/tool-convergence-tasks.md。此前“helper 属于其他用户会话”的推断已撤回；真实模型效果由用户明确安排到后续 debug loop，不再阻塞本轮软件验收。

- Android 设备选择不再提前触发没有 owning context 的连接；Capture 打开后使用冻结 CLI 配置和所属 context 激活设备。移除无法正确拥有会话的 device:activate IPC；应用不实现独立 helper 启停。已连接状态区分启动和借用，不再凭包名宣称 APK 已验证。
- Tools 连接已有服务时不安装、推送配置、启动或停止它；连接与 Ping 成功才返回句柄。真实测试发现 open_replay 第二次创建 native connection 会报告服务忙，现复用所属连接。clear_context 先完成所属会话与远端清理，再清除身份；失败保留恢复信息。CLI 原始错误码和消息保留到应用错误投影。
- Debugger、Analyzer、Optimizer 参数化覆盖 Plan/hash、requiredSkillIds、真实内置内容预载、受控执行交接、返回原 Mission；通用篡改、跨会话、权限及冻结负路径复用既有测试。49 项相关测试通过；设备/会话 29 项、native 协议/调用/会话 46 项通过，组间存在重叠，不相加。生成专业参考、Skill 校验、类型、lint、工程门禁和最新桌面构建通过。受控结果不代表真实模型判断成功。
- 用户无需手动打开 Command。设备最初没有 helper，正常 connect 自动启动通过；随后由测试夹具启动一个本轮自有 helper，CLI 借用、Ping、断开、再连接均通过，借用期间保留该 helper 与原有转发。这验证了复用行为，但不宣称现场存在真实用户预启动进程。
- 实际设备/Capture 页面打开 WhiteHair，成功传输一次、取得 1178 个事件，首次 EID3029 图像成功并目视。EID3027 无颜色输出；返回 EID3029 后 SaveTexture 返回 29/DataNotAvailable，图像重试再次失败。requested/applied 为 3029，imageEventId 为 null，目标 ResourceId::148783。未认定驱动、服务端或应用根因。T08-D 保持阻塞，不能以首次 PNG 成功替代完整事件导航验收。设备呈现仍为 unsupported。
- 实际检查设备选择、打开中的禁用状态、错误/重试和 960 像素宽 Capture 抽屉。最新正式桌面构建启动后窗口标题及非零窗口句柄符合预期；原生窗口存在与 Browser 目视证据分别记录。此前未受影响的全量和本地 GPU 验收保留，不重复上传或重跑。

本轮清理已验证：四个专用 CLI daemon 正常停止，QA/桌面自有进程消失；精确归属的转发与测试 helper 清理无错误，最终 ADB 转发和 helper 查询为空。唯一临时根 intermediate/android-convergence 与本轮 replay/sess_e08b0465e44a 已删除；不同 ACL 使用对应身份处理，未沿链接或修改仓库权限。浏览器 QA 标签已关闭、视口恢复，正常桌面启动权已交还。保留真实输入、用户历史、既有回放、当前依赖、Android 安装和应用构建。两库差异空白检查与 Tools 文档检查通过；T08-A/B/C/E 通过，T08-D 因上述真实重复观察失败保持阻塞。


## Necessary-capability restoration acceptance

Execution status remains in Tools/docs/tool-convergence-tasks.md. Capture identity, temporary replay restoration proof and complete-replay measurement evidence are implemented at the frozen CLI/serial lease boundary. Shared and three specialist manuals and generated references use the current definitions; no operation count or namespace whitelist grants permission.

Agent full run: 2815 passed, eight failed. Two empty-stdout process failures were incorrectly classified as malformed protocol and were repaired without accepting noncanonical success. Six process/file tests timed out under full concurrency; their original assertions and timeout values passed with two workers. All eight affected files passed (70 tests). Typecheck, lint, guide freshness, engineering gates and application build passed; the subsequent native-error classification change received its direct protocol/session regression.

Isolated Browser QA copied only required current configuration, encrypted secrets under the same OS identity, scoped resources and one 65913-byte capture fixture. Actual Capture open, Present21 → draw15 → no-color17 → draw15, close/reopen and final close passed. At 900×760 the drawer scrolls to Capture controls and Composer remains usable. Progress/Artifacts/output empty states and actual context resources were inspected. During General execution replay controls were disabled and restored afterward.

ClinePass DeepSeek V4 Flash used exactly two recorded Provider requests: one actual shell.rdx pipeline query and one result continuation. The query returned one populated color target, a preserved empty slot and separate depth target; visible replay remained EID15. This is one bounded General integration test, not proof of three Missions' real model reasoning quality. Their deterministic software-chain evidence remains separate.

Android matching-runtime acceptance now passed: Android Studio SDK NDK 27.3.13750724/CMake 3.31.6 built both architectures, and the deployed arm64 service connected. The first native failure was a five-second idle packet receive timeout; polling for a new packet fixes idle disconnect while retaining the partial-packet deadline. CLI and actual Capture UI both passed EID3029 → no-color3027 → EID3029 with fresh 1552×720 images. UI close/reopen returned to EID3029; at 900×760 the drawer exposes image, navigation and close controls. A wrong local-backend selection showed the actual unsupported Vulkan-extension error and recovered through close and device selection. Device presentation remains unsupported. The verified device capture was reused without repeated uploads. No further Provider request was made (2/6 total). Final QA/process cleanup passed: Browser tab/viewport released, own Electron instance and task daemons stopped, device sample/forwards released, isolated configuration/secrets and temporary roots removed. Current builds and installed SDK dependencies remain. Canonical desktop lock is absent; older contexts outside proven task ownership were preserved. Exact results remain in the Tools task ledger.

## 2026-09-14 Plan/Handoff 完整链路收敛

本节对应当前未提交工作区，非历史 verified SHA。保留上方前轮来源；表中 planned 不代表本节工程用例未执行，而是尚无可绑定的提交。真实模型完整链路仍未通过。

- T0：对照桌面需求、原计划与本轮批准计划，保留原 Agent 的功能范围；.qoder 等无关工作未修改。
- T1：根/子任务计划审阅与普通审批分离；按真实 owner 路由；批准先冻结并持久化，之后发布内存授权；新周期撤销旧授权；执行核对 target/hash/frozen URI。冻结与写入失败、错误 owner/target、取消和重复回答保持拒绝。
- T2：历史读取/导出/项目保存绑定持久 tool call 的 planId/revision/owner/Agent/URI/hash，覆盖嵌套 work block；无可信来源明确失败。状态使用严格 Zod 与 StorageIo。导出由主进程保存对话框选路径；token 绑定动作、会话、owner、制品与路径，原子写入并验证，失败保留原文件。
- T3：建议行等待 Agent 切换成功并检查当前会话，Stop/重复点击/迟到回调不触发陈旧发送。计划卡独立按钮与折叠；现有语义 token 和共享 Button；390 窄屏保留分节滚动、版本与阅读入口。全文加载失败不展示伪正文，禁用写入/复制；成功写入和复制提供状态提示。Context 排除 session plans，通用资源提取仍保留原始证据。QA 同时修正 RDX CLI 环境与参数前缀逐字符输入丢失，复用已有原始文本草稿方式。
- T4：完整测试 396 文件通过、3 跳过，2853 用例通过、3 跳过；lines 74.94%、functions 76.76%、branches 62.11%、statements 72.55%，coverage ratchet 通过。两次并发运行的 Investigation 超时/嵌套检查退出失败，单独检查及单 worker 全量通过；没有改超时、断言或路径安全检查。Knowledge 在本轮专用 TEMP 正常通过。实际审阅服务驱动三个 Mission 的 Handoff fixture，不直接注入 approvedPlan；这只是确定性工程链路。最后 Browser 修正另做受影响回归，静态门禁与构建结果按最终补证。
- T5 Browser：标准 launcher、一次性同源 /app、隔离 userData/home，复制必要配置、加密凭据及其 Local State；移除的旧 Agent 覆盖只在隔离副本中。project qa-plan-handoff / session sess_441e6b119be5，Debugger 真实提交计划 plan-807e7a086ab8，v1 拒绝后同一链路生成 v2，批准后冻结 hash a407f813750947ab10e3befe4e2bb25d7a4d1152b6aeebed90cbf989bfc6d9af。切换 General 后保存 v2，frontmatter 仍为 debugger，hash/owner 正确；v1 保存发生在修订前。390×844、独立折叠、全文读取、Esc 回到打开按钮、保存/复制成功提示、正文缺失 PLAN_NOT_FOUND 与三个操作禁用已观察。切换空 Capture 会话后五栏回到该会话空态；返回计划会话 Context 仅保留实际 Skill，无 live/frozen plan。
- T5 模型：ClinePass DeepSeek V4 Flash，8 次 provider 请求，每次输出上限 1500，累计输出上界 12000；第 9 次在发送前由临时预算守卫拒绝。批准后模型误调用 background_query，被 ownership 检查拒绝，随后找到 agent_handoff，但预算已尽。真实 General execute/原 Mission 回评估以及由其生成的建议行未完成；不得把 fixture 或人工切换 Agent 算作模型交接通过。
- T5 原生对话框：当前内置浏览器控制面不能操作 Electron 原生保存对话框；导出选路/取消/替换/重放/失败保留原文件由主进程集成测试覆盖，未把原生导出点击链标为 Browser 通过。Android WhiteHair 因无设备未实测。

最终补证：

- 源码识别：基线 HEAD 44f67a8e2cfe8e4ae2b8871db82cbed175449fa0，加当前未提交修改。对 rg --files src resources scripts designs 排序，逐项以路径（斜线归一化）、NUL、原始字节、NUL 累积 SHA-256；2217 个文件的指纹为 a6705a4407b5e022e568e52e6a53034ce2e130e0c8524a3d42c1a07db41815d8。这是工作区指纹，不是 verified commit。
- 最后修改的 5 个相关测试文件共 22 个唯一用例通过；最终 typecheck、lint、check:gates 和 build 全部通过。contracts/resources/project-instructions/prompt/skills/hooks/memory 的测试集合已包含在前述完整测试，不重复调用同一集合。
- 最新 Browser 表单逐字符输入 QA_DRAFT（尚无等号）以及 one two 后的空格均保留，随后恢复草稿，未保存诊断参数。
- Capture：隔离配置继承 RDX disabled，配置现有 CLI 后安装校验识别 128 operations。默认 Tools runtime 根返回 context_limit_exceeded；该尝试创建了本轮 daemon/log metadata，关闭未得到原生确认，UI 保留 RDX_CLOSE_FAILED 和 ownership，不能算关闭成功。随后用官方 RDX_INTERMEDIATE_ROOT 创建独立 runtime，新会话 sess_d9accc00c70f 原位打开本地 RDC（未复制）。capture SHA-256 为 0a79926a92e7e659989befc2322dc93b65782252fc5be2de33496142735a4094；真实事件 147→140→137→147 均得到 Applied EID，最终 Close 返回 Not open。Present 回执为 Final Present does not identify exactly one swap-buffer resource，三个事件均无图像，故这里只通过事件选择/恢复/隔离关闭，图像预览没有通过。无 Android 设备，不尝试 WhiteHair。原项目 metadata SHA-256 前后一致 f367755908a593cad88bddcff675573c3b4a7b725601bcf5264609af76acdcc5。
- T6 清理完成：Browser 尺寸恢复、QA 页面关闭，launcher 退出；QA 锁持有 PID 42288 已退出，canonical 桌面 instance.lock 不存在，桌面启动权已交还。隔离 RDX daemon 随应用退出，默认根本轮失败上下文通过官方 daemon stop 停止（PID 66924 已退出），仅删除该上下文的残留日志，其他上下文保留。清理了本轮 .local（QA project/userData/home、加密凭据副本、运行时、预算守卫、工作清单、专用测试 TEMP）及 coverage 中间报告；保留当前 out 构建与依赖。加密副本因 ACL 首次删除失败，提升权限删除后再次复查。未复制或删除原始 capture、真实会话与用户资源。清理回执不代表未完成的模型、图像或设备验收通过。

### 2026-09-14 续接范围调整

按用户最新决定，General 执行与 Mission 回评估，以及依赖此链路的真实模型建议行验收，交由后续专门大项验证；不再作为本次家中续接任务或阻塞。上述历史未完成事实保持，不改标为通过。本次续接仅保留原生导出对话框、本地与 Android Capture 验收，详见 docs/workflows/plan-handoff-acceptance-continuation.md。

## 2026-09-15 动效与计划门接手复验

适用源码：`main @ f20fc1c7` 加当前未提交修复；前轮用户已否决可见效果，旧 transform 采样不作验收。以下记录与前节独立，不承接前节的桌面启动权结论。

- Active Signal 与 Work Process 动效：**待验证**。已修复 OS 减少动效覆盖 Settings off；同一 clipped-gradient 增加亮带对比；真实持续回合仍待目视。
- Composer 绕光：**待验证**。同一 `::before` 固定圆角遮罩，background-position 光斑沿四边移动，移除旋转遮罩与滤镜，pointer-events none；真实 busy 状态仍待目视。
- 分支续聊终态提交：**待验证**。锚点检查原来把分支首轮身份强加给后续回合；改为验证当前消息身份及分支锚点一致性。12 项单测覆盖续聊、首轮、后台分支、错误 turn/branch、删除分支、缺失/损坏锚点；canonical 现场续聊仍待复验。
- Mission 三层计划门：**待验证**。复用 PlanCard / PlanReviewPanel / Composer PlanReviewRequestPanel；本回合真实 approved plan_artifact 才快照建议行，移除未接线的 approvedPlan 参数。待审/拒绝/取代不得生成建议行。新模型回合尚未验证。
- 工程验证：**通过**。全量 coverage：398 文件通过、2874 测试通过、3 文件/3 测试沿用既有跳过；typecheck、lint、build、check:gates、coverage ratchet 均通过。
- 测试缓存收尾：**通过**。已删除本次专用 motion-validation 缓存和中止测试的隔离 userData 根，确认路径不存在；保留当前 build 与 coverage 证据。

覆盖率：statements 72.60%、branches 62.20%、functions 76.86%、lines 74.99%；来源 `coverage/coverage-summary.json`。初次全量验证因系统临时目录祖先 `realpath C:\Users\Vip` 返回 EPERM 中止，改用仓库内专用 TEMP/TMP 后全量与门禁通过；没有修改 Knowledge 实现、测试断言或覆盖率阈值。

源码 SHA-256：`src/renderer/styles/design-system.css` = `5A2F7A9188BDB7D65093EFD1115E8A3AEA6BFAFFED325E3ADE2A314056002D0C`；`composer-chrome-3.css` = `5178A96BABA2832DD6C544BB663735772AA788C3F0EC2B9C9F04DEDB621C6671`；`ConversationTurnTerminal.ts` = `7F528940BF14ADBDBF6EBB1D86E1E95873B5A7F74810A8FF994E18FC297F21BF`；`missionHandoffSuggestions.ts` = `055FC7F191C3B1E12E3DFCFE24B8DBE932FCA8F0298FEF45860D8F1652A7093A`。

真实 UI 阻塞：本任务内置浏览器接入既有 canonical 服务返回 `net::ERR_BLOCKED_BY_CLIENT`，未能进入页面。既有 canonical browser 进程继续持有 instance.lock；未关闭、未手改 Settings/会话、未发起模型测试。已请求用户确认重启以加载新主进程构建并取得新一次性 /qa 入口，以及内置浏览器仍拦截时能否用 Chrome。批准前不替换既有服务；本条不宣称桌面启动权已交还，也不宣称用户目视验收通过。

## 2026-09-15 核心动效历史还原

基于 `3d501629` 的未提交工作区；Composer 基准为 `093caa82^`，Active Signal 基准为 `1b531894`。本节不改变此前 Mission 验收结果。

- 历史视觉与现有组件收敛：核心运行态通过，完整矩阵仍有下述未覆盖项。单一 Composer 角度绕光、ActiveSignalText 宽渐变；保留当前布局及颜色覆盖修复。
- 全应用减少动效控制删除：工程通过。UI、类型、持久化投影、DOM、CSS 与 Effort 静态分支一起删除；保留正常动效。
- 工程验证：399 文件、2878 用例通过；既有 3 文件 / 3 用例跳过。覆盖率 statements 72.61%、branches 62.19%、functions 76.86%、lines 74.99%；coverage ratchet 通过。typecheck、lint 与 UI 专项检查通过；完整 check:gates 与 build 通过。Knowledge 原临时路径 EPERM，使用本轮工作区内专用 TEMP 后通过，未修改业务逻辑或断言。
- 真实 Browser 局部验收：通过标准 start:agent-browser 的 disposable 用户目录与一次性 /qa 入口进入同源 /app。390px 视口无横向溢出，Composer 宽 354px；三行输入正常；错误终态没有 is-running / active signal，绕光 animation-name 为 none。此项不代表持续运行的视觉恢复通过。
- 首次隔离动态验收的历史阻塞（后由真实账号解除）：本地模拟 Provider 的模型没有 source-backed toolCalling.supported，session:setModelOverride 返回 MODEL_TOOLS_UNVERIFIED；临时 OpenAI 账号模型路由固定在服务目录地址，不能经 models.json 的 provider baseUrl 转向本机模拟服务，假凭据回合以认证失败结束（2.2s）。未更改模型能力门禁或运行时业务逻辑。随后用户明确授权使用 ClinePass 或 OpenCode Go 的 DeepSeek V4，真实回合结果见下节。
- 动画与源码审计：原 25 个 keyframes 名称全部保留；Composer 同名 orbit 从四边位置动画替换为历史角度动画。生产源码无减少动效控制、媒体查询或监听器；旧字段仅在删除验证测试中出现。
- 本轮资源清理：通过。隔离 QA Electron、本机模拟服务与启动器已退出；本轮 motion-verification 测试/QA 根及首次 disposable 临时目录已删除；canonical instance.lock 不存在。桌面启动权已交还。保留当前 out 构建和 coverage 验证产物，不保留临时账号、会话或模拟服务。

本轮源码 SHA-256：`src/renderer/features/composer/composer-motion.css` = `ad23b232c283bec5d64518b2c57a05e9beb9e5a513e725c4d9edaa070c777980`；`src/renderer/styles/design-system.css` = `ebf1d4679089dde661c060e28d40b1dbc50b1ecb2dc76b5239f9ea156f42c76d`。

### 2026-09-15 真实账号续验

用户授权后以 canonical start:agent-browser 和一次性 /qa 入口，使用既有 ClinePass / DeepSeek V4 Pro；仅创建本轮文字验收会话，没有读取凭据明文，没有打开 Capture，也未触发工具或交接。源码与上述 SHA-256 一致，启动器重新 build 通过。

- 两圈 Composer 绕光：通过。General 暗色桌面真实 Working/Thinking 回合中，连续截图序列及角度采样覆盖 6.429 秒（1789447056284–1789447062713），角度从 −95.4065° 推进并两次回绕至负角度，末值 −2.71802°；周期 2.85 秒。连续帧可见短边收窄、长边展开，固定圆角轮廓，未见循环跳边或光环核心裁切。此为真实运行帧观察，不以单张静态截图代替。
- Transcript：Working 与 Thinking 的 background-position 持续推进，文字 computed color 透明；折叠 Working 后仍扫光。正常完成的 22.7 秒回合变为 Work process / Thought for 18.1s；取消回合变为 Stopped / Thought for 23.9s；终态 is-running 和 active signal 数量均为 0。hover 覆盖沿用专项测试，未单独记录鼠标悬停采样。
- 主题、尺寸与 Agent：暗色桌面 General 青色、亮色 390×844 General 青色与 Analyzer 紫色（accent #8d8bff）均呈现运行光环；窄屏 Composer 宽 354px，页面 scrollWidth=390，无横向溢出。多行输入可编辑并在固定输入区滚动，运行中仍可输入；完成后恢复正常发送，运行中附件/effort 禁用。
- 未覆盖边界：当前 browser 控制接口不提供系统减少动效切换或媒体偏好模拟，因此 OS 开/关两态未实测，不标记全矩阵通过。DeepSeek V4 的 Max mode 为 Fixed，UI 正确禁用切换；Effort 可切换进入/持续/退出时间轴由本轮已通过单测证明，本次账号验收没有覆盖该交互。
- 收尾：本轮临时会话经应用删除，界面返回 No sessions yet；恢复暗色主题与默认浏览器尺寸。QA 标签页、启动器和自有主进程均退出，canonical instance.lock 不存在；桌面启动权已交还。没有新增截图/录像文件、测试账号或临时目录。

## 2026-09-16 RDX 活占用与桌面自有 runtime 根

适用源码：`main @ fca93bd0` 加当前未提交实现。不把 CLI 安装目录或 Tools 源码路径写入仓库。本节只记录本轮实际核对，不改标既有 T18/U06 Capture 结论。

- 一次性残片：计划清单中的死户口 / 死 daemon 文件已不存在；用户根下旧泄漏标记已不存在。`WhiteHair.rdc`（168591424 字节）与 `眼睛泪腺白点.rdc`（1647684424 字节）源文件仍在项目 inputs。未整目录删除 Tools `intermediate/`，未扫 QA userData。
- Tools：`max_contexts` 改为活占用（daemon/worker/`owner_pid` 仍在跑，或本进程内存里有活 replay/preview）。空/死 `runtime_state_*.json` 不再占容量。`tests/test_context_occupancy.py` 3 项通过。
- 本库：Settings `command` / `workingDirectory` / `env` 仍是唯一 CLI 入口。未写 `RDX_INTERMEDIATE_ROOT` 时，`withRdxHostRuntimeEnv` 在 `executeCLI`、`openProjectInput` 与 `prepareTurn` 冻结前注入 `~/.rdx/rdx-intermediate`。`initializeRuntime` 不预建该目录。Settings 校验成功文案带有效 Runtime 根；未新增表单字段。
- 工程：`withRdxHostRuntimeEnv` / `RdxCliInvokerService` / `RdxTurnBindings` / `RdxSessionRuntime` / `rdxInstallation` / `AppPathService` 共 6 文件 36 项通过；`AgentOrchestrator.preparedTurn` 5 项通过。`typecheck`、受影响 eslint、`check:legacy-residue` 通过。未跑完整 coverage / Browser QA / 发布 pack。
- 真实打开：使用当前 Settings 已配置 CLI（`env` 为空），注入用户根 `rdx-intermediate`。`rd.capture.open_file` 打开 `WhiteHair.rdc` 成功：`context_id=rdc-ee053f69-b68d-45a5-af73-e488a1553d41`，`capture_file_id=capf_f73fcaf44151`，`driver=Vulkan`，未出现 `context_limit_exceeded`。中间态只出现在用户根 `rdx-intermediate/runtime/...`，Tools 默认 `intermediate/runtime` 无此 lease。`rd.capture.open_replay` 失败，`renderdoc_error`：`Current replaying hardware unsupported`。这与既有本机 WhiteHair GPU 限制同类，**不标本地回放通过**。
- 关闭：仅对该 lease `rd.session.clear_context` 与 `daemon stop` 均确认成功。确认 daemon 已停后，删除该 id 关闭后留下的空 state / snapshot / log / lock；该 id 文件数为 0。未清理其他 context。
- 本轮未启动桌面或 Browser QA；canonical `instance.lock` 不存在。

## 2026-09-17 知识导入导出一次交割

适用源码：当前未提交工作区。不改标历史 `UI-D1-knowledge-export`（当时载体仍是单文件 YAML）。不写 verified 表行，因为尚未点开知识中心原生保存/打开对话框。

- 产品：可再导入知识包是标准 zip，内含 `knowledge.yaml`（`rdc.knowledge-package/1`）和声明对照图。Markdown 仍单文件、不可再导入、不夹图。导入选文件只走 `dialog:selectKnowledgeImport`（zip / yaml / yml）。结果是 `items[]`，没有顶层 `record`。
- 工程：`KnowledgeExportService` / `knowledgeZip` / `knowledgeIngest.images` / `KnowledgeDurableStore` / `knowledgeSystemContract` / `knowledgeSchemas` 及相关 Knowledge Center 测试通过；`typecheck`、受影响 eslint、`check:knowledge-system`、`check:shared-exports`、`check:fidelity`、`check:browser-capability`、`check:design-tokens`、`check:legacy-residue`、`check:contracts` 通过。
- 带图往返：用本机用户知识卡 `~/.rdx/knowledge/cases/AIRD-20260207-0001.md`（`observed.png` 599070 字节、`reference.png` 590171 字节）经 `KnowledgeExportService` 写出临时 zip，再 `ingestKnowledgeFromPath`。一条 draft，`missingAssets` 为空，两张图进入 staging。未写入用户知识根，临时目录已删。
- 本轮未启动桌面或 Browser QA；canonical `instance.lock` 不存在。原生保存/打开对话框未点，不把 Center 点击链标为通过。

## 2026-09-17 RDX daemon/worker 生命周期收口

适用源码：当前未提交工作区。表行 `RDX-daemon-lifecycle` 保持 planned：未提交、未跑完整 coverage / Browser QA / 桌面开关机，不写 verified SHA。仓库已无 `RdxNativeLifecycle.test.ts`，不再恢复该文件名。

- 工程：`OwnedRdxDaemonRegistry` / `RdxSessionRuntime` / `RdxSessionService` / `RdxCliInvokerService` / `ShutdownCoordinator` / `ProcessSupervisor` / `executeRdxShell` / cancellation 与 fault-injection 共 9 文件 114 项通过。受影响 eslint 通过。本轮文件无新增 tsc 诊断；全库 `tsc --noEmit` 仍有既有 `fflate` 缺失，与本轮无关。未跑完整 coverage / check:gates / build。
- Tools：`test_daemon_client.py` 17 项通过（含 clear≠stop、`--owner-pid`、claim_owner、stop 只收本 context worker、宿主死亡后进程退出）。`test_runtime_worker.py` 的 `RDX_DAEMON_PID` 注入通过；另外两项依赖 `rdx.server` 的既有用例在 Python 3.12 上因 `ctypes.wintypes.HCURSOR` 收集失败，未改断言。本轮临时 pytest venv 已删。
- 隔离实机（Tools 3.14、独立 `RDX_INTERMEDIATE_ROOT`，未开桌面 / QA）：两个 `rdc-*` 先 `daemon start --owner-pid`；`context clear` 后目标 daemon 仍在；`daemon stop` 只停目标，另一 context 仍在。已死 owner + 1s lease 后 daemon 进程退出。worker 父 PID 监视线程在父死后退出。临时中间根已删，本轮 `rdc-aaaaaaaa-*` 进程为空。
- 实机修了 Windows 收口缺口：watch 已判定 owner 丢失，但 `Listener.accept()` 不因 `close()` 醒来，进程会继续活着。现在 `serve_forever` 已启动的 daemon 在 `_stop()` 后 `os._exit(0)`。
- 未自动杀安装目录独立 CLI。本机仍有 `rdx-tools` `python.exe` PID 19760：`daemon-context default`、无 `--owner-pid`，状态不在 App `~/.rdx/rdx-intermediate`，也不在安装目录 `intermediate/runtime/rdx_cli` 的可见 `daemon_state*.json`。按计划只作手工诊断，不杀 `default` / 其他用户 helper。
- 本轮未启动 QA / 桌面 launcher；canonical `instance.lock` 不存在。桌面启动权已交还。

## Runtime/host final closeout — 2026-09-19

本节承接前轮运行时/宿主收敛；当前未提交源码基于 Agent `2dd81bc99e61f0bb1ab07c46ee9b4a9a32df48bf`，任务状态沿用 Tools C01–C07。未提交、推送或发布。最小原始证据保存在隔壁 Tools `intermediate/runtime-host-closeout/`，不覆盖历史来源。

- Desktop Mesh/name facts：通过。IRP EID1346 的真实 Float32 NORMAL/UV、14592 顶点/4864 三角形的 v/vt/vn OBJ、五层 marker 和自定义资源名 Sponza_32 均有 canonical 回执。输入与变换后输出分开；选中 shader 的原生自动名称不冒充 debug name，仍为 null，HLSL 来源独立表达。证据 `facts/receipt.json`、`facts/cli-lifecycle.json`。
- Android physical display：通过。配套 Windows DLL/Python binding、arm64/arm32 helper 和桌面消费者构建及启动通过。WhiteHair 3029→2973→3029、无颜色清黑、后台失败/前台恢复、关闭重开均有原生完成序号和实际手机取样；Agent Capture 的 requested/applied/image EID3029 与手机呈现一致。证据 `android/acceptance.json`、`android/agent-screen.png`、`android/cleanup.json`。
- Real model scenarios：通过（限定本计划场景）。原24次真实 DeepSeek Flash 请求完成事实读图及 Mission 计划/按钮交接/General 实际预载与执行/返回评估；初次跨 capture 材料沿用重开前身份，被 Mission 正确拒绝，原证据保留。用户随后批准最多6次、每次3000输出 token 的窄补验；实际追加6次全部HTTP200，总输出2216、单次最大1145。模型在两份当前 owning session 分别读取 rdx_context 和 action，保存A/B身份与比较材料。独立逐字段核验 context/replay session/capture file/lease、文件SHA、事件事实和trace与原始open/query一致，归档内容与模型write_file参数逐字一致，无人工修补。第6次读回已写材料，随后第7次终答请求在发送前被预算保护拒绝；没有新增自然语言终答，不影响本次已完成的材料修正验收。总实际请求30次，无备用Provider。证据 `agent/supplement/verification.json`、`capture-b-current.json`、`requests.json`；旧失败材料继续作为历史记录。
- Short A-B-A：通过。两次原生执行共约22秒；真实像素变化、恢复、五份主进程签名回执及原文件未变由独立核查确认。适用当时 catalog `8681825a610af3466a968eb379268bbebe36e174b670a788a4fda33c02fced1a`，不以之后的生成指纹冒充实验来源。
- Engineering：通过。Agent 413文件/2944项通过，4项 opt-in 默认跳过；coverage ratchet、typecheck、lint、248项 contracts、gates、build 通过。Tools 全量405项、reference/catalog freshness、release gate 通过。隔离 lease 的错误状态及重试提示已修复并独立复验；权限和隔离边界未放宽。
- Canonical generation：通过。discovery/catalog/三本手册统一 `4eefd77d649bef8a03d53ab408f097314c781c33ff01b0eec436c5c1562caf4f`；生成检查显式传入本次 catalog。原生输出、Mesh/OBJ 限制和教法同步，历史 unsupported 快照仅保留为当时证据。
- Cleanup：通过。先释放自有 context，再停止 daemon/helper，forward 为空；隔离凭据、测试副本、QA 进程与 Browser 标签页均已清理。正常 start:human 启动实际桌面窗口后退出，canonical instance.lock 不存在，桌面启动权已交还。证据 `agent/desktop-startup.json`、`agent/acceptance.json`；当前源码以 `source-manifest.json` 为准。模型材料补验及追加隔离环境清理均通过，补验两个 context 已释放、自有进程已退出、普通桌面窗口启动和退出再次验证；证据 `agent/supplement/cleanup.json`、`desktop-startup.json`。本计划全部收口，桌面启动权已交还。
## RDC identity cutover (2026-09-20)

Execution tracking remains in RDC-Tool docs/tool-convergence-tasks.md (T1–T8). This section records evidence only; previous runtime/model facts above remain historical observations.

- Identity and contracts: canonical bundled-Python binding, shared IPC/schema/policy names, Skill IDs, resource roots and RDC.md are aligned. The actual installed RDC-Tool reports version 1.0.0 and 128 catalog operations; fingerprint remains 4eefd77d649bef8a03d53ab408f097314c781c33ff01b0eec436c5c1562caf4f.
- Engineering: 2946 tests passed, 4 existing opt-in tests skipped; coverage ratchet passed (lines 75.14, functions 76.81, branches 62.23, statements 72.72). Typecheck, lint, generated guides, architecture/design gates and build passed. Historical HEAD profile parsing was rechecked after the implementation commit; the General resident Skill's domain wording was corrected without weakening assertions.
- Packaging: the first directory package exposed a missing AWS transitive dependency. Upstream electron-builder 26.16.1 fixes pnpm deduplicated dependency collection. The corrected directory package starts its services and ordinary desktop window, shows RDC-Agent, exits through normal window close and releases the canonical instance lock. Smoke now isolates user/app-data roots and requires service initialization rather than process survival.
- Integration: actual Settings runtime validation, installed catalog handshake, one bounded small-capture replay open/close and context cleanup passed. The one-time local conversion used same-volume directory renames; original capture hashes and project/session/input IDs were preserved. Historical messages remain readable; a temporary Skill was written/read/deleted through the runtime in the new user root. Historical traces and capture contents were not rewritten.
- Boundaries: no new model-effectiveness or Android presentation acceptance is claimed. Installation was verified on this host, not an independent clean machine. Browser automation blocked localhost and Chrome was unavailable, so screenshots/visual inspection are unverified; native window creation/title/normal exit were observed. Agent remains private and has no new release.
- Wiki: both generated wiki inventories were retained; Luna corrected naming and references under the user's explicit direction. No wiki pages or better-harness audit history were deleted.

## 家中 Windows 后续验收（2026-09-21）

适用源码：Agent `11e51d06fdb9a9d82a913b3c855b69439fef2364` 加本轮未提交 UI 修正；Tool 源码 `04295e47cd87727f109f863980aa5b2cfbef2647`。任务状态只在 Tool 的 `docs/tool-convergence-tasks.md` F1–F6 维护。本机是参与两库开发的第二台 Windows，已有 SDK、依赖、用户会话和 Android helper，不能称为干净机器。

- 安装与调用链：官方 Tool **1.0.1** ZIP SHA-256 `e5cd8df1237ad95ecaf64afd911107c5298d08898492924edefb32efdf958357` 与官方校验表一致；解压及 C 盘用户级安装的 3130 项 manifest 均一致。该版本 ZIP 已带正确 License；没有改动或重发 v1.0.0。实际 Settings 检测并验证安装返回 1.0.1、128 operations，catalog 指纹仍为 `4eefd77d649bef8a03d53ab408f097314c781c33ff01b0eec436c5c1562caf4f`。Agent 使用安装中的 Python、CLI、daemon 和 worker，不再以 Tool checkout 为 runtime。
- 隔离真实回放：通过正式桥接接口创建一次性项目并导入 65913 字节的 `vkcube_validation.rdc`，真实 UI 点击打开、切换事件、关闭。EID 21 的 requested/applied/image 均为 21；EID 20 正确返回 `no_color_output` 并清空旧图；返回 21 恢复图像。关闭后 phase=closed、context/image 为空，发行版 daemon/worker 进程均已退出。用户解锁后另行完成原生文件夹选择、返回安装根及验证并应用，返回 1.0.1、128 个操作。
- 视觉与修正：已查看实际 Browser 工作台、上手指南、Settings、回放和无颜色输出状态截图。安装路径改用现有 SettingsField 纵向布局，补齐输入标签关联；在 1280px 和 600px 下路径可读。空会话标题被聊天顶部遮罩遮挡，修正为空态不绘制遮罩，明暗主题截图复验标题可读。错误环境重定向被 `RDC_BINDING_INVALID` 拒绝，原有效绑定未被污染。原生桌面视觉不能由这些 Browser 截图替代。
- 数据：切换前未发现新旧 canonical 根并存或 Git 分叉；仅本机用户根和登记项目根作同卷改名，更新当前结构化引用与本机安装绑定，没有新增迁移/兼容功能。两份原始 capture 的 SHA-256、项目/input/session ID、自定义名称和历史消息保留。真实 canonical Browser 工作台已读到原项目、会话消息、两份 capture 和原用户 Skill。另一个未登记项目桶中的独立会话保持原字节，不合并或删除。历史快照中的旧术语保持原样。
- 工程：安装绑定相关 3 文件 21 项测试通过；随后 CSP 补丁新增 2 项回归通过，覆盖 Document 无内联样式、重复挂载及 ShadowRoot 规则保留。typecheck、受影响 TS/TSX ESLint、design-token 与 renderer-structure 检查、增量 build 通过。未重跑完整测试、未重新打包。两份 `.qoder/repowiki` 无本轮编辑；上述证据取得于提交前。用户随后批准相关修改提交并推送 main；本轮不创建新版本或更新已发布资产。
- Android 补验：首次锁屏连接失败的原始回执保留。用户解锁后，原生 Agent 选择 darwin 并打开 WhiteHair，实际 remote context、capture file、replay session 及安装版 worker 来源已核对；3029 → 2973 → 3029 的输入、已应用事件和图像 EID 一致，三次均显示设备画面已同步。独立 ADB 手机截图可见调试叠层随事件消失、恢复，与桌面图像对应。正常关闭后 UI 回到未打开，Tool 进程、手机 helper 和 forward 均为空。本次正常产品连接的 bootstrap 回执记录安装配套 APK、推送配置及启动 activity，不能沿用首次失败时“未安装/覆盖”的描述。未重跑 Android 无颜色清黑、后台恢复、关闭重开或真实模型场景，不将历史机器的完整矩阵冒充本轮结果。
- 本地证据与清理：`.local/home-windows/evidence/` 保存最小截图和 JSON 回执，不入 Git，不含模型新请求。发行 ZIP 与 SHA256SUMS 保留在本机下载目录。解压副本、一次性项目、隔离 CLI/QA 根、过期 QA Cookie 和一次性脚本已删除；仅前三类目录逻辑字节约 183.4 MB，不等同实际释放空间。先前 Browser 写权限拒绝未落盘；解锁后通过原生设置完成临时 Skill 保存、重新读取、删除，磁盘确认目录不存在，未开启 canonical QA full access。41 个历史会话文件复查原字节不变，真实资源与历史中间态保留。
- 桌面恢复：普通 desktop launcher 启动真实原生窗口，历史会话、设置、Capture、资源编辑与确认弹窗已视觉检查。最后正常点击关闭，launcher 退出码 0；原生 Electron、launcher、Tool daemon/worker、ADB forward 与本轮 helper 均无残留，canonical instance.lock 不存在。桌面启动权已交还。
- 切换收尾：原生资源写读删与历史文件复查通过后，已核对绝对路径、未跟踪状态和无链接边界，删除本轮 9 份恢复副本及其一次性计划（逻辑字节 467923）；切换清单和哈希证据保留。回放临时目录已由产品生命周期释放，没有删除原始 capture、独立会话、原有备份或历史中间态。
- 启动修正：实际桌面日志发现 CodeMirror `style-mod` 在 Document 创建内联 `<style>` 被 CSP 拒绝。通过 pnpm 管理的 4.1.3 两行补丁让支持构造样式表的 Document 复用库已有采用路径，ESM/CJS 同步；不改 CSP、不升级依赖，锁文件仅增加补丁引用。冻结安装通过，真实桌面重启后原内联样式拒绝消失。原生 Markdown 多行输入、标题/强调/列表呈现及编辑/预览切换已截图检查；验收草稿清空，未发送。meta 中 `frame-ancestors` 被忽略的既有提示仍在。

## 2026-09-22 计划卡、确认区与阅读器收敛

- 适用源码：基线 `941b839f4508a24d3b440695914e983088eea7e0` 上本轮未提交修改；没有发布。范围为 PlanCard、Composer 计划门、PlanReaderHost/PlanReviewPanel、Workbench 几何上下文、直接相关 Markdown/Handoff 展示和文档。
- 工程通过：新增定向 5 文件 18 用例；最终全量覆盖率 439 文件通过、4 文件按原配置跳过，3057 用例通过、4 跳过。lines 75.21%、functions 76.88%、branches 62.31%、statements 72.78%，coverage ratchet 通过；typecheck、lint、check:gates（含 appearance、work-process、session-projection、legacy-residue、design-tokens、renderer-structure、acceptance-ledger）及 build 通过。为避开受限环境 TEMP 祖先 realpath 权限错误，将测试 TEMP/TMP 定位到本轮仓库内一次性目录，固定 maxWorkers=4；未跳过或弱化测试。build 保留既有静态/动态 import 提示，不影响退出码。
- 行为测试通过：多执行目标、当前目标提交、重复提交、修订展开聚焦/空值禁用/失败保留、session/revision 隔离、Stop/替换/移除后的迟到响应、批准投影早于 IPC 返回、合法续跑与失败重试。稳定阅读器宿主新增 Transcript 行重挂载后保持打开并回焦新阅读入口的回归；现有主进程计划读取、身份/hash 和审批契约随全量复验。
- Browser 阅读场景通过：正式 disposable bootstrap → 同源 `/app`，使用隔离持久化计划记录经过真实 history/plan.read/hash 链路，没有 renderer demo 或手工改 DOM。深色中文 medium、浅色英文 large、深色中文 small；桌面约 1591/1454 CSS px、1024、640、390 宽度，最低 450 高度；长标题、12 节正文与长路径代码、双侧栏收起、终端打开、跨断点连续缩放。阅读器左右与 Composer 误差最大约 0.019 CSS px；上下按工作区边界保留 16/8 CSS px 安全间距（亚像素取整差小于 1px），页面横向溢出 0。观察到真实背景模糊，面板正文保持清晰；正文滚动超过 1500px 时标题栏不动，Tab 由末控件回首控件，Escape/遮罩关闭后回焦阅读入口。跨断点曾使卡片重挂载并关闭阅读器，提升至稳定工作区宿主后复验保持打开。
- 读取失败实测通过：仅修改本轮计划文件造成 hash 不匹配，面板显示 `PLAN_HASH_MISMATCH`，正文为空，复制/下载/保存均禁用，关闭可用；没有以摘要/章节代替全文。
- TODO(UNVERIFIED)：没有取得修改前真实计划运行态的 Browser 基线；原截图与源码检查仅用于定位。隔离 Provider 的有效目录仍选官方路由（认证失败），改为本地自定义模型后工具能力 unknown 被拒绝；没有放宽权限/目录约束。故实时模型生成 → 待审决策 → 人工批准/修订 → General 续跑，以及待审门完整视觉矩阵不能标通过。当前工具不能控制原生 Electron，Electron zoom、原生导出/保存对话框未验证；Browser 和工程结果不能代替。解除条件为可用且具工具能力的测试 Provider，以及原生 Electron 操作环境。
- 收尾通过：正式 `start:human` 用本轮隔离数据启动至 main/IPC/renderer 初始化，桌面没有被 QA 实例锁阻挡；这仅证明启动健康，不代表原生视觉或 zoom。随后停止本轮 Browser、Provider 和桌面进程，核对退出；三个自有 QA/测试临时目录及中间日志删除后复查不存在，无链接越界，其他任务进程未动。canonical instance.lock 不存在，桌面启动权已交还。保留当前 build/coverage 产物供开发及复查，未生成发行包。

## QA 外观对照与 rc.4（2026-09-22）

用户追加授权提交、上传与发布；发布任务在 first-use-and-release-readiness.md 的 RC4 清单维护。源码基线仍为 941b839f，加本轮计划交互修改与版本 0.6.0-rc.4。

- 外观差异已定位并补验：正常配置是 Absolutely 深色、大字号、composerMarkdown=true；此前 disposable 使用默认主题、中字号、composerMarkdown=false，截图还选择了测试 llama 模型。只复制 appearance 到自有隔离配置，经 start:agent-browser 的正式构建与 one-time bootstrap 打开产品；创建自有项目/会话，实际观察到暖灰界面与 Markdown 编辑/预览，输入 Markdown 后切换预览成功，切换 Debugger 后控件保持同一结构。未提交模型请求，未复制凭据/用户会话；原配置最后修改时间保持 2026-09-21 23:46:05。不存在测试专用 Composer 分支，不以本次空会话补验覆盖先前计划审批或原生缩放的未验证边界。
- 工程证据沿用上一节完整 3057 项测试、coverage ratchet、typecheck、lint、gates 和 build；本次只追加版本/文档，不修改运行时代码。版本增量门禁、发行包与清理结果随后按实际回执记录。
- 发行验证与交付：rc.4 源码/tag 为 19b0db975a285a36242e3d25020604d08993f967；增量 gates/build 通过，包内 52 资源、315 个 out 文件与源码构建一致，ZIP ASAR 与桌面 smoke 产物一致，打包主进程服务启动通过。七项 GitHub 资产 digest 均与本地一致，Release 已公开为未签名预发布，旧 tag/资产保留。详细散列及 CI 快照见 first-use-and-release-readiness.md。
- 收尾：自有 QA 35 文件、进程及 unpacked 暂存已清理；旧 rc.3 本地资产经远端 digest 核对后删除，保留 rc.4 七项正式资产、当前 build/coverage。真实配置修改时间未变，canonical lock 不存在，桌面启动权已交还。其他任务的活 QA 保留；本次未增加原生缩放或真实 Provider 审批链通过声明。

## 2026-09-22 Provider 模型事实复核

- 适用源码：`main` 基线 `6b1c2a520fb2c55a04cb194246607c84668bc91a` 加本轮未提交修改。范围为 Provider manifest、ChatGPT discovery、直接耦合测试、Settings 未知推理文案及两份 Provider 文档；`.qoder/repowiki` 未纳入。未提交、推送或发布。逐 surface 字段、官方及交叉来源见 provider-model-catalog.md 的当日复核来源表；历史缓存只证明采集时账号状态，不证明实时模型调用。
- 工程通过：仓库 resolver 经本轮临时 PATH 定位 pnpm 11.7.0，未变更依赖或锁文件。check:provider-catalog、check:provider-system、check:contracts、typecheck、lint、最终 check:gates 均通过。完整 coverage 串行执行后 444 文件 / 3093 用例通过，4 文件 / 4 用例按原配置跳过；lines 75.26%、functions 76.90%、branches 62.38%、statements 72.85%，coverage ratchet 通过。此前并发运行出现 Investigation 子进程超时；单项及完整串行复跑通过，未删测、跳过或放宽断言。测试 TEMP/TMP/TMPDIR 位于本轮仓库内隔离根，避开系统 TEMP 祖先 realpath 权限限制。
- 实际修正回归：DeepSeek 两模型三协议的推理和 top_p、xAI Priority 与 Grok OAuth 隔离、GLM 档位与无预算拒绝、MiniMax 不发猜测推理参数、Kimi Off 不换模型、ChatGPT image/text/缺失模态不覆盖基线均有测试。Browser 发现 MiniMax unknown 被误显示“关闭”，修复现有 Settings 摘要和默认档，并新增状态区分回归；聚焦 8 项通过。没有新增公共 API、IPC、schema、adapter 或 UI 组件。
- 构建与 Settings Browser 通过：正式 start:agent-browser 完成 main/preload/renderer production build；最终 renderer 为 index-CB5VW-Fa.js。canonical lock 无活 owner 时启动 disposable userData，通过 one-time bootstrap 进入同源 /app；未复制凭据。实际查看 DeepSeek Flash 视觉支持、Pro 不支持及三协议，键盘切至 Chat 后真实配置保存 preferredRouteOptionId；GLM Global Coding Plan 键盘切 Low 后真实配置保存 defaultReasoningSelection=low。最终 MiniMax M3 摘要与禁用默认档均显示“未知”，Fast 不支持。1280 和 390 请求视口下验证；窄屏实际 CSS 宽 354，scrollWidth=354，无横向溢出，Tab 焦点可见，Escape 关闭后回焦连接按钮。未连接时测试/能力验证按钮保持禁用。
- TODO(UNVERIFIED)：Composer supported/unsupported/unknown 附件提示及已连接 Grok OAuth 控件尚未完成运行验收。隔离环境没有凭据；本地兼容 discovery 只提供身份、工具能力 unknown，不能取得 Agent 资格。未伪造目录或绕过门禁。待用户确认是否允许仅在 disposable QA 数据中配置明确标记的合成状态；此状态只能验证界面，不能证明账号资格或真实模型请求。此时运行验收未闭环，原阶段未执行提交。用户随后明确要求清理、提交、推送 main 并发布新版；按新指令推进 rc.6，保留上述未验证边界，不转记为通过。
- 进程收尾：本轮三次 Browser launcher 及自有 Electron 均已退出，canonical instance.lock 不存在，桌面启动权已交还；未停止用户进程。没有执行真实模型请求、原生桌面视觉检查或发行包构建。临时 QA 数据、日志和包管理器 PATH shim 在证据汇总后清理，当前 build/coverage 保留供开发复查。
- rc.6 发行增量验证：用户追加发布授权后版本升为 0.6.0-rc.6。build/dist、release-config、5 项发行回归及文档/整洁门禁通过；包内 52 资源和 316 个 out 文件一致，ZIP 的 app.asar 与已验证 unpacked 相同。正常 Windows 隔离桌面健康 smoke 完成全部主进程服务初始化并退出；沙箱内 GPU 启动失败不计通过。NSIS/应用为 NotSigned，未做交互安装；既有 fs.Stats 弃用和 meta CSP 提示保留。旧 rc.5 七份本地资产逐项匹配远端 digest 后移除，远端旧发布不变；三处本轮空 QA 拼写目录已清理。
- rc.6 发布回执：源码 `c14ab21ec0badc51d177bf3bd4624a196aede272` 已非强制推送 main，[v0.6.0-rc.6](https://github.com/haolange/RDC-Agent/releases/tag/v0.6.0-rc.6) 的 tag 指向该提交；draft=false、prerelease=true、非 latest，7 项远端资产 digest 全部匹配。安装包 SHA256 `690e0b71e56eddfbac909aecde6512fc8c9447d888120fd9e84aad031266b294`，ZIP `c1fa696a627b13d905d696855dfe6498954a2625131c55a0eaa9d7f7c91dfad9`；SBOM 1106 components，记录同一源码 SHA。发布时[源码 CI](https://github.com/haolange/RDC-Agent/actions/runs/35711535830) 为 in_progress，未等待或宣称云端检查通过。后续回执提交不移动发行 tag。
- rc.6 清理复查：本轮 `.local/provider-release`、`.local/provider-facts-review`、空 `.local`、unpacked 打包树、builder-debug、临时 PATH shim/日志/测试数据及旧 QA 空目录均已删除。仅保留 rc.6 七项正式资产及当前 out/coverage；当前依赖、真实配置、历史会话、测试源码和 `.qoder/repowiki` 工作未动。自有打包/桌面进程退出，canonical instance.lock 不存在，桌面启动权已交还。
