# 上手引导与发行准备

## HEAD CI 跨平台收口与 rc.2（2026-09-21）

本轮目标：修复 current HEAD 的 Linux `pnpm test` 与 macOS runtime/primitives Vitest 失败，在不移动 `v0.6.0-rc.1` 的前提下，以全绿 HEAD 生成 `v0.6.0-rc.2` 未签名预发布。状态使用「待执行 / 执行中 / 待验证 / 通过 / 阻塞」。

| Task | 状态 | 范围与通过条件 | 验证批次 |
|---|---|---|---|
| CI-1 路径契约 | 通过 | Shell、shell trailer、RDC CLI 绑定按目标路径方言工作；不放宽安全拒绝 | A：受影响 Vitest 81/81、typecheck、lint |
| CI-2 测试隔离 | 通过 | macOS 临时根 canonicalize；大小写别名按实际文件系统能力断言；桌面 smoke 的 DIPS 清理重试已收口 | A/B：macOS 与 Linux runner |
| CI-3 HEAD 全绿 | 通过 | Linux build、macOS shell 及全部 CI job 全绿 | C：GitHub CI [35566584898](https://github.com/haolange/RDC-Agent/actions/runs/35566584898) |
| CI-4 rc.2 发行 | 通过 | 版本、产物、checksum、SBOM、预发布说明一致；保留 rc.1；NSIS 与 zip 均明确未签名 | C：隔离产物验证 |
| CI-5 收尾 | 通过 | 验收记录、临时目录、进程与 canonical lock 收口 | C：清理复查 |

当前失败根因已确认：Linux runner 把 Windows 路径交给宿主 POSIX `path`；CLI 绑定结构校验不接受真实 POSIX 测试夹具；macOS `/var` 是指向 `/private/var` 的系统路径别名。生产 symlink 拒绝语义不改变。

本轮修复提交：`85a2da92`（路径契约与测试隔离）及 `a4d6b5aa`（macOS Electron 测试串行化、桌面 smoke 临时目录清理重试）。发行源码提交 `70254a76` 的 CI run `35567724271`、最终台账收口提交 `65256b00` 的 CI run `35568188278` 均为全 job success；Linux build 包含完整测试、coverage ratchet、gates 与 build，macOS runtime/primitives 为串行执行后全绿。Windows 本机 `pnpm test` 仍受 Codex 运行时 pnpm store SQLite 权限影响的 Knowledge/SystemDebt 旧环境问题不冒充 Linux 失败；本轮跨宿主门禁以 GitHub runner 结果为准。

rc.2 本地产物（应用代码对应 `a4d6b5aa`，发布 tag `v0.6.0-rc.2` 指向收口提交 `70254a76`；文档提交不改变包内代码）：

- `release/RDC-Agent-0.6.0-rc.2-x64-setup.exe`：SHA256 `3ec8ae5e3246c2f1f79ff62b1e6c639b4af87be3219f1031155f14dd434bdc10`
- `release/RDC-Agent-0.6.0-rc.2-x64.zip`：SHA256 `cb200d7630ffdfde50131be313b4d3ca818b70b17cfb00e1f2b37441c699a8f9`
- `release/RDC-Agent-0.6.0-rc.2-x64-setup.exe.blockmap`：SHA256 `ea692a63672d13e4969e632a9735a7e990ed40894663497f8b2dddaab6a7186e`
- `release/sbom.cdx.json`：SHA256 `1770d95c48dcd9fdd287c9cbc7fe92c716546c1d25906cfe7e0ea9ec8f212fbc`

`verify-package.mjs` 检查通过：版本 `0.6.0-rc.2`、应用入口、52 个 runtime resource、四张教程图字节一致，asar 无源码/开发配置/包管理器。生成器输出 1,099 个 SBOM components；最终 GitHub release 仅保留上述一套发行资产与必要元数据。

GitHub release：[RDC-Agent v0.6.0-rc.2](https://github.com/haolange/RDC-Agent/releases/tag/v0.6.0-rc.2)。远端 7 项资产 digest 与本地 SHA256 一致，`prerelease=true`；`v0.6.0-rc.1` tag 与资产保持原状。

## 发行执行（用户追加授权）

2026-09-20用户选择：Agent `0.6.0-rc.1` 未签名预发布、Tools `1.0.1` 正式发布；允许提交main、推送、创建新tag与Release。不创建分支，不改变仓库可见性，不覆盖Tools v1.0.0。以下早期“不发布”记录为历史阶段边界，本节为当前执行范围。

| Task | 状态 | 范围与验证 |
|---|---|---|
| P1 发行整理 | 通过 | Agent 0.6.0-rc.1与双语未签名说明；Tools 1.0.1发布说明；显式预发布门禁，正式签名要求保留，5项门禁正负例通过 |
| P2 产物与验证 | 通过 | Agent typecheck/受影响lint/16项聚焦测试与check:gates通过；最终0.6.0-rc.1 NSIS/zip构建，52 builtin+4教程PNG字节一致，NSIS确认NotSigned；Tools 37测试+2subtests、文档/identity及实际zip验证通过 |
| P3 上传与收口 | 通过 | Agent 392c71f1 / v0.6.0-rc.1与Tools 04295e4 / v1.0.1已非强制推送并发布；GitHub全部9资产digest与本地一致，Agent明确prerelease，Tools正式版；临时目录清理、无自有进程或canonical lock |

最终Agent产物：NSIS SHA256 `99973c09f4d223a26e7456b2392560f1adc8a28ee5000647ea0fcb64ac98a147`，zip SHA256 `5af6785a2068f645b0cc36a97a4acd9f5c79d7aee310e3f642e4a304a40f64f6`；旧0.6.0本地候选已由本次rc.1替换并删除。Tools正式包SHA256 `e5cd8df1237ad95ecaf64afd911107c5298d08898492924edefb32efdf958357`，不再使用早期candidate散列。包验证在Windows修正asar读取的路径分隔后通过，属于验证脚本修正，不是包内资源缺失。

发布地址：[Agent预发布](https://github.com/haolange/RDC-Agent/releases/tag/v0.6.0-rc.1)、[Tools正式版](https://github.com/haolange/RDC-Tool/releases/tag/v1.0.1)。2026-09-20 19:40（UTC+8）快照：Tools [CI 35508297088](https://github.com/haolange/RDC-Tool/actions/runs/35508297088) success；Agent [CI 35508421797](https://github.com/haolange/RDC-Agent/actions/runs/35508421797) in_progress。云端CI异步，不把该快照写成Agent全绿。发行tag保留在实际构建提交；本回执后续提交仅更新文档，不移动tag或替换资产。SBOM记录Agent构建提交392c71f1。最终本地保留Agent release/与Tools dist/publish/；pytest临时依赖与测试根（先移除内部符号链接）、被替代candidate、打包暂存均已清理，桌面启动权已交还。

## 图文教程改版任务（本轮）

已批准：四步说明型引导，桌面左文右图、窄屏上图下文；Image Gen四张同风格教学图，关键文字由HTML/i18n承载。仅onboarding、配图、双语及设计文档；不改配置/IPC/Tools，不重打发行包。交互验收只用真实Browser QA。

| Task | 状态 | 依赖与范围 | 验证 |
|---|---|---|---|
| V1 内容与配图 | 通过 | 真实入口核对、四张本地配图、简洁双语 | 四张1536×1024图进入renderer构建；真实项目加号直达文件夹，凭据掩码，HTML标注与示意声明 |
| V2 组件落地 | 通过 | V1；响应式图文、稳定导航与页脚 | 无第二套业务状态；TaskDialog焦点闭环、关闭返回、问号重开首步、索引与上下步通过 |
| V3 验证收口 | 通过 | V2；集中工程检查、真实Browser、文档与清理 | typecheck、受影响lint、token/structure、GettingStartedState 1项、最终build与diff检查通过；Browser中文深色/英文浅色、1280×720与390×844；四页、固定页脚、滚动可达、焦点返回通过；自有QA进程停止、两个隔离目录清理、lock不存在 |

本轮采用可逆的局部图文组件替换，未修改业务状态/IPC或Tools；若回退仅回退onboarding及配套双语/图片。本地仅保留四张选定配图，无截图或落选图片进入仓库。图像来源与生成要求见UI说明。早期检查的PNG导入类型问题与一次lint路径输入错误已修正并复验；开发中间HMR错误不作为最终构建结论。语言/主题验证使用隔离QA的既有full-access开关，不修改真实配置。现有release候选仍对应此前版本，本轮只构建应用资源，未重打安装包、提交或发布。桌面启动权已交还。

## 批准的交付边界

### 历史临时内容清理复查（2026-09-20）

按用户追加授权盘点两库与系统临时目录。对照测试源码精确前缀、目录内容及进程命令行，删除3,742个临时/测试目录、30个空且无运行owner的Tools锁；被删文件逻辑大小合计189,699,948字节，不等同实际磁盘释放量。包含Investigation/Knowledge/附件/会话fixture、空Interpreter与原生测试目录、四份历史包验证解压副本、tool-convergence-tests暂存、pytest缓存及本任务五张生图原件（四张正式图片已逐一核对SHA256相同后保留于源码）。这些临时内容直接删除，未送入回收站；正式配图和候选未删除。

复查生图缓存、上述暂存、canonical lock均不存在；无Electron/RdcAgent/Python/Tools运行进程，无需额外强杀。Codex工具宿主不是已证明的死进程，保持运行；历史回放状态、原始capture、必要日志/验收来源、当前依赖及构建/发行候选保留。此次未改业务代码、不重跑测试或生成产物，桌面启动权已交还。

四步只读上手说明（欢迎、模型、项目、RDC），Settings 风格模态与步骤动画，首次启动一次展示、标题栏问号重开。实际配置复用原入口。Builtin 直接从应用资源读取，不写用户 seed。Code Interpreter 不在本轮范围。

RDC Settings 使用检测安装、选择目录、验证并应用；main 派生同安装 Python 与 CLI，沿用唯一 rdcCli 配置和 catalog 验证。检测只查已配置目录及 `%LOCALAPPDATA%/Programs/rdc-tool`；用户确认前不执行候选。失败保留原配置，迟到结果丢弃。

Tools 准备 1.0.1，核对 1.0.0 历史、许可证字节、版本及发行清单，收口 staging 生命周期。Agent 保留 NSIS，增加 zip，同步文档和发行检查。保留已有 .qoder 改动，不创建分支、不提交、不推送、不发布。

## Tasks

| Task | 状态 | 依赖与范围 | 验证/阻塞 |
|---|---|---|---|
| T1 基线与契约 | 通过 | 两库调用链、设计与既有改动 | Agent 基线 728fc2fa9ea1ccc50023e5ef61376d083c86b27b；Tools v1.0.0=4a819f7，当前 a216c37；不改 .qoder/wiki 工作 |
| T2 安装选择与验证 | 通过 | T1；main/IPC/shared/Settings | 草稿/保存失败/取消/迟到测试通过；真实原生目录选择 + Settings 验证 1.0.1/128 操作；非法 PYTHONPATH 拒绝，旧配置保持 |
| T3 上手说明 | 通过 | T1；onboarding/app/TitleBar/UI 状态 | marker 幂等；首显/刷新不重显/问号回第一步/上下步/索引/完成/Escape/Tab/焦点返回；中文深色、英文浅色390px |
| T4 Tools 发行修复 | 通过 | T1；版本/CHANGELOG/打包与许可证门禁 | 隔离运行目录、clear/stop/finally清理与失败报告已修复；34项不同受影响测试通过；真实源码门禁、异常/取消清理与更新zip门禁通过，3130文件匹配源码 |
| T5 集成与发行验证 | 通过 | T2–T4；工程门禁及本地候选产物 | 2957通过/4既有跳过；coverage ratchet/typecheck/lint/gates/build通过；zip/NSIS/Tools候选已生成；Vulkan EID21打开/关闭通过。Browser QA通过；打包exe原生窗口与上手指南显示正常，Alt+F4正常退出，主进程及子进程消失、canonical lock释放 |
| T6 收口 | 通过 | T5；文档、验收与自有资源清理 | 本轮测试、staging、解压、runtime与退出补验隔离配置均已清理；候选与文档同步完成，桌面启动权已交还；签名/独立干净机等外部条件仍按既定边界单列 |

## 分批验证

- A：受影响单测、typecheck/lint 与专项检查；重点为取消、路径、跨安装、catalog 失败、保存失败、迟到结果和许可证负例。
- B：稳定后一次完整 tests/coverage ratchet、check:gates、受影响 contracts、build；Tools 受影响测试、文档/identity/source release gate。失败只复跑受影响范围。
- C：disposable Browser QA 的四步交互、主题/窄屏/键盘、Settings 成功与失败；同次构建的 Agent zip/NSIS 与 Tools zip；隔离解压、doctor/catalog、本地小 capture 打开关闭、打包窗口及 builtin。无独立干净机或签名时如实记录，不冒充通过。

只保留一套候选产物与必要证据；清理本轮暂存、解压、日志和自有进程，保护用户数据、capture、依赖及其他工作。

## 2026-09-20 本地候选与证据

验证针对上述基线上的未提交工作区，未创建分支、提交、推送、tag或发布。

- Agent `release/RDC-Agent-0.6.0-x64.zip`：SHA256 `3555cc854f6396f3bd5594b91cad682016879c0bf68d43df64d649ee917a81d7`。
- Agent `release/RDC-Agent-0.6.0-x64-setup.exe`：SHA256 `cb9fd3f4092c65d982084bbc42092050b8313f824238768d0d07947a907a5bfb`。
- Tools `dist/candidate/rdc-tool-1.0.1-windows-x64.zip`：SHA256 `9d3a653b0fcfc78ba97324cf5e452651e8e90f7f445b19981540a24d9509b254`（包含发行验证生命周期修复，替换本轮旧候选；v1.0.0资产不变）。
- Agent解压包：52项builtin资源字节一致；无源码启动器/包管理器/lockfile；包内Electron执行官方artifact-integrity Hook通过。新用户agents目录没有官方`.agent.md`副本（仅既有迁移标记）。
- Tools：源码/zip发行门禁、doctor/catalog、manifest/SBOM/inventory/version/checksum/许可证字节通过；替换zip LICENSE并重算manifest/checksum仍拒绝。修复生成dist-info升级时残留旧版本的实际缺陷。
- Browser QA：中文深色、英文浅色390×844；四步与键盘焦点已验证。原生选取中文/空格路径，Settings显示1.0.1与128操作；非法PYTHONPATH失败，落盘env仍为空。
- 项目`proj_6646965201c4`、会话`sess_56928f2a5437`；65,913字节公开`vkcube_validation.rdc`导入，Replay ready/Applied EID21，Close后Not open；没有调用LLM。
- 覆盖率：lines 75.15%、functions 76.82%、branches 62.24%、statements 72.73%。全量2957通过/4既有跳过，随后仅复验新增junction与发行负例。
- 本地候选未签名；正式签名门禁保留。未验证独立干净Windows、NSIS交互安装、真实LLM、Android或GPU性能矩阵。打包桌面视觉与正常退出因用户停止Computer Use留待续验，强制结束自有进程不冒充正常退出。

### 首轮清理回执与续验

- 用户物理Escape停止Computer Use后未再操作界面；本轮打包应用进程树已结束，不计作正常退出验收。
- 已先释放验证所建context，再停止default、release-gate-context、release-gate-empty、package-contract、package-empty的自有daemon；复查其进程已退出。
- 已删除本轮`.check-tmp`、disposable Browser QA目录及两份Tools包验证临时解压目录；复查路径均不存在。保留候选、必要验收记录、当前依赖及用户数据。
- canonical instance.lock不存在，桌面启动权已交还。
- 首轮发现Tools验证脚本缺少完整daemon退出处理；本次续验已修复，而非继续依赖手动清理。
- 两脚本共用`isolated_release_runtime`：独立临时状态，不复用调用方目录；finally先clear再stop，失败仍尝试其余自有context；恢复调用方环境，保留原始错误与清理错误，失败不写PASS。删除解压目录不再ignore_errors。
- 受影响批次33项通过；新增报告失败回归后同文件18项通过，合计34项不同测试（含6项生命周期测试，另2个subtests）。真实源码门禁通过；分别注入RuntimeError与KeyboardInterrupt，各启动两个真实context，退出后目录不存在。
- 更新候选通过真实doctor/catalog/负例与发行包校验，源码manifest匹配3130文件。最小源码门禁记录为Tools `intermediate/logs/first-use-release-cleanup.md`。复查无Python进程、无本轮runtime/staging/包解压临时目录；测试专用pytest及fixture目录已删除，桌面启动权已交还。
- 按用户本次确认，界面目视采用已通过的真实Browser QA；不把Browser证据扩大为原生窗口容器和打包exe正常退出证据。

### 打包窗口正常退出补验

2026-09-20使用现有`release/win-unpacked/RdcAgent.exe`及独立临时profile/home启动，实际观察到原生窗口与上手指南；向目标窗口发送Alt+F4正常关闭。随后进程查询确认主进程及该exe子进程均不存在，canonical instance.lock不存在，未使用强制结束。隔离配置已删除并复查，桌面启动权已交还。此回执补齐上文历史未验项，T5/T6通过；未重建候选或重跑其它验收。
