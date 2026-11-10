# 垂直调查能力收敛任务

## 文档状态与分类

本文件由原 `.local/vertical-investigation/tasks.md` 迁入版本库，作为本计划唯一持久 Task 清单继续维护；不再维护本地平行副本。原文件迁移前 SHA-256 为 `12af1a45d85b0182aa8bd9a29287411edf368f20188d9212916b31712e9ad247`；迁入后增补分类标题和历史使用边界。设计目标和获批方向分别见[设计分析](../product/rdc-agent-investigation-design-analysis.md)与[实施计划](vertical-investigation-plan.md)，正式现场证据见[验收账本](../product/acceptance-ledger.md)。

下方状态快照与逐项映射保留当时的实现和验证范围。后面的运行记录是历史，不是当前设备、权限、现场或待执行指令；尤其以用户后续放弃同 session 重启验证的决定为准。继续实施前核对当前分支、工作树、设备和材料。记录中的 `.local`、JSON、图片、原始会话及 capture 均是本机证据位置，不因本文件上传而随 Git 提供。

## 当前任务快照（2026-11-11）

设计复审交接（2026-11-11）：用户要求暂停原有实测与实现，先清理、整理已做工作并上传，再由专业设计 Agent 形成更全面的计划。已在 `codex/vertical-investigation-convergence` 提交并推送 `ccd0b60d`；以下 T0–T7 仍是唯一 Task 清单，已有通过仅代表各项已记录范围，其余保持待验证。旁支 Agent 转达的 Planner 粗定位、人工催续与自主 Small Loop 的区别，以及以真实目标和直接障碍为先的原则，已分别纳入设计分析和原计划；实际 Planner 查询及多轮真实验收以验收账本为准。当前保留隔离 session 与证据，原始 capture、正式凭据和真实用户 session 不动。

只读前沿复核（2026-11-10）：第三轮原始轨迹没有矩形像素数值读取，也未实际调用已发现的按资源追踪使用查询；两者在获批只读计划内可能有价值，成功与否和用户症状映射均未知。已有 Debugger 工具 Skill 增补通用方法，Skill／Agent 门禁、typecheck、lint 通过；真实模型复验仍待清理旧隔离 session 的操作时确认。

锁回收续修（2026-11-10）：真实双进程受控交错复现死 owner 并发回收可删除新锁；现串行化回收并重新核对 owner，26 项定向测试、Node 全量 3685 项及棘轮、typecheck、lint、完整 gates 与 build 通过。Renderer 自上一轮 872 项及棘轮通过后未变。用户症状映射、Debug 因果、Analysis／Optimize、对照与泛化仍未闭合；隔离会话永久删除确认未返回，下一独立 session 仍需等待。

本次真实续验（2026-11-10）：PC 第三轮以 partial 结束；自主使用局部读图、经历一次原生查询失败及受控恢复，独立 Verifier 三代在同一 Task 补源续审，只确认事件输出图中的有限视觉观察，未确认用户症状映射或根因。105 份根／子请求均为 Luna／Medium、Fast 关闭；预算、版本、Skill 与入口恢复见验收账本。全量测试暴露目录锁初始化竞态，确定性复现并修复，Node 及 Renderer 全量覆盖与棘轮、typecheck、lint、完整 gates、build 通过。Analysis／Optimize、陌生 capture 独立真值及受控 Prompt 对照仍未闭合；本轮证据已归档，context 与自有进程已释放，隔离凭据和测试缓存已清理。内置浏览器对不可恢复会话删除要求操作时确认，未回复前保留隔离 session state 及其回放缓存，不能启动下一轮独立 session。

较早 PC 续作：首轮项目内路径由人工提示，不能算自主 Small Loop；保留的请求不完整，不能判断是否收到复评反馈。后续新 session 的完整请求和独立审查结果以顶部最新状态及验收账本为准。

本机续作状态（2026-11-10）：本轮开始时分支 HEAD 为 6c2f5f39；本机真实 Android Debug 与 Planner 只读核验已执行但目标仍 partial。细节见 acceptance-ledger 与 20261110-machine-evidence/manifest.json；下表历史记录不代表当前通过。

历史基线：`36306dbd3d5ca1f6663bcedda43ba6e25a0d0ba4`；功能分支 `codex/vertical-investigation-convergence` 开始时 HEAD 为 `6c2f5f39`，本次提交与上传状态见顶部交接。目标、范围与验收以用户批准的完整计划为准，状态只使用待执行、执行中、待验证、通过和阻塞。工程验证通过不等于真实模型或设备通过。

测试配置要求：本机隔离副本使用 `gpt-6-luna`／Medium，Fast 关闭；真实根请求与三代独立 Verifier 请求均已核对，正式用户配置未因测试覆盖。具体 Profile、Skill、来源版本及请求清单见验收账本。

最新配置链路验证：通过临时隔离诊断实际调用编译后目录、`buildEffectiveCatalogRequest`、`planModelRequest`、`buildResponsesRequestBody` 和 `applyRequestPlanBody`，最终请求体为 `model: gpt-6-luna`、`reasoning.effort: medium`；Fast 明确关闭，避免引入额外档位变量。不可用模型仍被拒绝，不替换模型。连同现有规划、有效目录和 reasoning wire 回归，4 文件／56 项通过；首次系统 TEMP 的 rename EPERM 在收集前失败，改用工作区自有 TEMP／TMP／TMPDIR 后通过，未修改产品路径或安全策略。没有网络请求或凭据读取，不代表真实 Luna 响应或 Mission 完成。回执 `luna-request-check-evidence.json` SHA-256 `6e73bdc785c2a0de3301f17a2513d74417f1a3cc58d5900ac2ef0447c50d67b5`；临时诊断文件及工作区缓存已清理。

Android 当前连接复核（2026-11-07）：仅连接原授权 serial 的本机临时 ADB 查询确认 `device`，不能再用“设备可能离线”描述当前事实；helper 仍为 versionCode 148／`f6aff93bcbb823eb4a8fcea324e55cd54adbdcf9`，未返回该包 PID。沙箱内服务因 socketpair 限制退出，经自动权限审查后仅对 localhost:5038 启动单设备前台服务完成只读查询，并核对进程路径、停止自有服务、确认进程和端口退出。未打开 capture、安装或修改设备；在线不代表回放可用，旧 Connection lost 原因和真实设备验收仍未闭合。详见 `android-current-connection-evidence.json`。

| 任务 | 状态 | 已有证据与剩余条件 |
| --- | --- | --- |
| T0 基线、需求和数据边界 | 通过 | 功能分支已快进至 6c2f5f39，已核对权威文档、本机隔离根与材料边界。历史状态为 通过。历史记录：已核对分支、权威文档、设备和存量；八个新 User Agent 目标原先不存在，历史执行和签名证据不重写。 |
| T1 Agent、模型与执行合同 | 待验证 | 根和 Verifier 真实请求、Profile、Skill、来源版本及固定 Luna／Medium 已核对；三代累计消费与原期限连续。其他子 Agent 的本机真实委派和全部 Mission 仍待验收。 |
| T2 Knowledge 服务与管理 | 待验证 | 六份本机知识原文隔离核对一致；Android 规划实际命中并读取 draft 案例，适用性仍未完成验证。历史状态为 通过。历史记录：零命中、共同关联、分页与版本、渐进读取和人工确认覆盖正负测试；隔离 Browser 验证管理交互，实际模型检索、读取版本化内容并接收两张图片。正式 Knowledge 主题未批量改写。 |
| T3 持续执行与完成合同 | 待验证 | PC 新执行压缩后读取原计划和来源；General 在故障恢复及独立审查 Challenge 后自主补证，三代审查保持同一 Task、累计消费与期限，最终主目标仍 partial。第二轮复评后模型提前 partial 的缺口未因第三轮局部成功而消失。 |
| T4 Mission 方法与上下文 | 待验证 | 本机 PC 眼部与 Android BlackHair 短症状均未确定根因；PC 已独立核验有限图像观察，Android 对象映射与 verifier 未完成。详细 Prompt 对照、完整 Analysis／Optimize 和陌生 capture 的独立真值泛化仍未验收。 |
| T5 多 capture 与恢复 | 待验证 | Android 黑发 capture 原生打开、设备同步，两个回合有入口 resolved；跨 capture 和其他设备仍未验收。历史状态为 阻塞。历史记录：两份公开样本已在真实 Local Mission 中同会话切换并经签名回执核验恢复。单 capture Optimizer 首轮因计划机器合同遗漏 scope 而无法恢复；修复后新会话自动冻结范围、从 EID 11 恢复 EID 14 并写入 `resolved`，四份回执 HMAC 与引用关系经操作员核验。BlackHair 在 EID 2653 首帧观察时丢失远程连接，原因未知；用户只能提供这一份 Android capture，设备侧切换与恢复仍未通过。 |
| T6 UI、文档与数据 | 待验证 | 内置 Browser QA 已走真实计划和执行；Planner 的 pass／draw／管线只读核验得到结构信息但无目标身份，仍需提升。历史状态为 阻塞。历史记录：主题文档和账本同步；Browser 检查 12 个 Agent、真实子执行、Knowledge、浅色窄屏、深色与键盘焦点，本机流式夹具验证停止；交接档位覆盖回归与新的真实交接 RequestPlan 核验通过。本机公开样本的 Browser 切换／恢复路径已通过，Android 路径仍随 T5 受阻；正式知识分类、旧执行证明及签名未改写。 |
| T7 综合验收及清理 | 待验证 | 本轮 Node／Renderer 全量及棘轮、typecheck、lint、指定基线 gates 和 build 通过；完整目标、Analysis／Optimize、对照与泛化未完成。入口 context 已释放、证据已归档，自有进程及临时测试目录已清理；隔离会话及其回放缓存因永久删除确认尚未返回而保留。 |

## 批准计划逐项证据映射（历史快照）

本表沿批准计划 §2.1–2.7、§4–5 核对当前实现与验收来源。工程通过只采用最终 Node 3591 项、Renderer 868 项及各自棘轮和完整 gates 的结果；真实行为采用下列对应回执，不从文件名或提示词推定效果。路径均相对本库。该表补充现有 Task，不另建验收报告。

| 计划要求 | 已核对的实现与代表性合同验证 | 真实证据／剩余边界 |
| --- | --- | --- |
| §2.1 四个入口、八个内部身份及默认 Skill | `resources/agent-runtime/agents/`、`agentManifestParse`、`builtinProfileContracts`；内置集合与顶层集合分开，非法旧 ID 仍拒绝 | `model-execution-evidence.json` 八个同步子执行均 complete，逐项包含 User Profile hash、匹配 Skill hash、Sol High 的实际请求；后续 Terra 要求仅作用于隔离验收 |
| §2.1 模型／档位唯一来源，Composer 不传子执行 | `SubagentRunner`、`ProfileTurnPreparation`、`EffectiveModelResolver`；`SubagentRunner.test.ts` 覆盖 Capsule 自由模型参数拒绝、缺配置／不可用／非法档位拒绝及不继承父级覆盖 | 同上八个实际子执行各两次 Sol High 请求；根回合为 Sol Low，构成配置来源区分证据；后台 Verifier 另有真实请求 |
| §2.2 Task→Capsule→Prepare→RequestPlan 与运行来源 | `TaskExecutionRequirements.ts` 校验 mode、Profile 来源／hash、方法预载、独立 session、授权成果 URI/hash；`TaskExecutionRequirements.test.ts` 覆盖缺来源、错 Profile、旧成果、旧 generation 与在途约束 | 真实子执行来源记录和 Local Mission Verifier 已有；历史无准备来源的执行仍拒绝充当新证明 |
| §2.2 必需审查不可绕过、修改只使相关核验失效 | `TaskRegistry`、`assertApprovedTaskRequirement`、`readIndependentTaskSources`；测试覆盖冻结义务篡改、源成果变更、相关 source/review 重做及无关 Task 不重跑 | 已批准的真实 Local Mission 要求独立 Verifier 并实际完成；历史审查的开放来源／焦点问题仍未闭合 |
| §2.3 继续执行、完成资格及停止 | `RuntimeContinuation` 将具体宿主事实加入单次请求、不伪造用户消息；`AgentLoop.progress.test.ts`、`AgentTurnRunner.completion.test.ts`、`missionCompletionContract.test.ts` 覆盖重复终答、完成拒绝、合法 partial 与报告资格 | `restoration-live-project/evidence/` 中 General 根据哈希／缺报告反馈继续并正常终答；新 Optimizer 因无 ready 报告拒绝 completed，随后 partial；不宣称全部 Mission 自主成功 |
| §2.3 无默认总量上限、局部预算只收紧、消费与期限保留 | `ExecutionLimits`、`DelegationBudget`、`TaskRootBudget`；测试覆盖父剩余额度、兄弟原子预留、恢复不重复计费／不刷新期限及深度不扩大 | 工程合同通过；真实长 Mission 有连续消费记录，未用新增 Task 清零旧执行。真实重启后的长调查完整闭环仍无单独通过结论 |
| §2.4 零命中、共同关联、词序及中英文词表 | `KnowledgeQueryService`、`KnowledgeCompileService`、`knowledgeVocabulary`；`knowledgeServices.test.ts` 的文本证据、真实关系类型、Scope 与版本用例 | 实际 Knowledge 搜索／读取回执保留在 `model-execution-evidence.json`；不把共同关联编译成冲突 |
| §2.4 版本化搜索分页与渐进读取、图像观察 | 查询页绑定来源版本；`KnowledgeReadSelection` 对非 summary 强制 hash，支持 full/range/section；相关 tests 覆盖版本漂移、范围与原文；图像沿既有读图链路 | 真实模型已读取版本化正文和两张图片；最终 Renderer 组件／状态测试通过，不能替代图像在任意模型上的能力资格 |
| §2.4 主题与同义词批量预览／确认、原文唯一来源 | `KnowledgeTopicService`、`KnowledgeTopicStore` 及 Knowledge Center；测试覆盖不修改的提议、版本化人工确认、过期拒绝、merge 与未知主题可浏览 | 隔离 Browser 管理交互已有；正式知识分类未获批量确认，保持原样，不自动晋升或改写 |
| §2.5 三 Mission 方法、竞争解释、反证与压缩 | 三类方法 Skill、领域报告资格；`investigationMethodCases.ts` 供 Knowledge 检索及 `DelegationCapsuleCompiler.test.ts` 使用；合成材料覆盖同症状／不同机制和条件不适用 | `compaction-runtime-evidence.json` 证明合成上下文经真实压缩后保留未知与反证；这些 fixture 测试本身不证明模型已实施根因区分。真实短／详细 Prompt 受控对照未完成 |
| §2.5 Debug／Analysis／Optimize 各自结论资格 | `missionCompletionContract` 区分方法；Analysis 不强制伪造 Authoring Hypothesis，Optimize 要求实测／质量／恢复，Debug 保留因果门禁 | Local Analyzer 完成限定双抓帧链路；Debugger 历史执行和两轮 Optimizer 为各自记录的 partial。无合格优化收益或当前 Android 根因结论 |
| §2.6 同 owning session 串行切换、身份重准备与预算保留 | `ApprovedCaptureController`、`RdcRuntimeReprepare`、`PromptPlanRuntimeIdentity`、runtime epochs；相关测试覆盖旧 lease、错误／未登记输入、无 scope 拒绝、切换原子发布及旧准备事实不可复用 | Local 两抓帧真实切换与单抓帧恢复已分别验证；回执绑定内容、设备、原生身份。跨 capture 的相同 Event/Resource ID 不能充当对应关系 |
| §2.6 故障隔离、join→clear→stop→reopen 与现场恢复 | `RdcRecoveryChildren`、`TaskRecoveryInterrupt`、`RdcCaptureRecovery`、`RdcLifecycleReceipts`；测试覆盖自有 child join、未确认退出不继续、消费保留与受控恢复 | Local 正常恢复有签名终态；Android BlackHair 已失败且原因未确定，Android 自主重开／多抓帧恢复不标通过；不重复同一未改变失败条件 |
| §2.7 UI 投影、导航、停止及视觉状态 | Agent 设置、SubagentRow、Knowledge Center、CapturePanel；最终 Renderer 200 文件／868 项，覆盖档位、失效状态读取、配置导航与子执行投影；token／分层／rail gates 通过 | 较早隔离 Browser 的深浅色、窄屏、焦点和本机停止已有；后续 Browser URL 策略拒绝不回填为通过，Android UI 随真实路径受阻 |
| §2.7 一次性配置写入与历史保护 | `AgentManifestService.seed.test.ts`、配置保存链及 `agent-configuration-evidence.json`；新八份目标原先不存在，预览→保存→哈希回读，不需要覆盖原四份；`SettingsService.persistence.test.ts` 覆盖 manifest 原子 rename 失败后保留最后成功快照及旧／坏 schema 不改原件；历史 Task 缺来源仍 fail closed | 八份正式配置哈希已复核；历史冻结请求／签名不重写，不自动重启在途工作；旧调查归档的应用内独立比较仍未完成 |
| §2.7／§5 文档、canonical 路径和交付治理 | ARCHITECTURE、runtime-kernel、failure-model、RDC／provider／scoped-resources／complete-design 与设计消费者索引；退役 `subagentModelArg` 已删除，调用改走 Agent 配置 | 完整 gates、类型、lint、build、账本与 diff 检查通过；main 基线未变，无提交／推送／发布。必要历史证据保留，临时产物按本清单清理 |
| §4 方法、真实模型与泛化验收 | 真实请求来源、人工介入和限制分别见模型、Mission、Android及各独立项目证据 | 已有实际 Agent 模型来源、知识读图、压缩、Local Analyzer 和 Optimizer 证据；短／详细 Prompt 对照、Android、陌生 capture 和独立真值不足仍未通过，不以工程绿色降级完成标准 |

## 历史运行与阶段结论

以下依原清单保留当时的阶段记录；“当前”“下一步”、本机资源、进程和权限均指记录当时，不代表现状或后续授权。

审计结论：实现、工程门禁及可确认的 Local 行为已有上述证据；仍需外部运行条件的缺口保持原范围。此次核对没有发现足以授权扩大修复的直接源码失败，也没有据此标记整体验收完成。

本次续验：真实离线 Mission 中完成声明先成功、最终门禁再拒绝的时序缺口已修复；声明前检查可判定制品，最终回复仍经完整领域合同复核。新一轮 Debugger 未尝试 completed，不能将其作为缺报告拒绝的真实模型证据。

最终 Renderer 补验（2026-11-07）：现有最终回执只包含 Node 全量，较早的 Renderer 结果未覆盖最后阶段全部改动；现以 pnpm 11.7.0、Happy DOM、两个 worker 完整运行 Renderer coverage，200 文件／868 项通过，耗时 94.36 秒。Renderer 棘轮 lines 65.20%、functions 58.06%、branches 56.31%、statements 63.07% 通过。回执 `renderer-final-validation-evidence.json` 保存 53 份受影响源码／测试哈希，SHA-256 `53e712708e41b03312d97846b381e4617d96da43bbca9269a3baa73e5ab49f2c`。该结果是组件与状态测试，未补证受限 Browser、Android、视觉或真实调查。进程退出且路径／跟踪／链接核验后清理 coverage、测试临时目录及本轮原始测试输出，共预清点 619 文件、16527408 逻辑字节，不代表实测释放空间。

用户在收到有界归档核验方案、解释器继承权限及此前自动审批拒绝的说明后明确要求继续并给予授权。复查固定脚本 SHA-256 仍为 `49b4362ee362c49fb00d2ebdc0c62e8fdf67f82e7179b370e9e9896d189dd4c1`，隔离归档与两份提取件的哈希分别仍为 `219b19f1c46bb62f41fa4438bd93cb99cb72026ec6af83fc5d400514cea29f19`、`5ff2feb09a4d581cd103794f7cda919beec710ecafe51e744bb2eddf7786cc06`、`dc32f60a9b5f10b948bf56ba51187340c8b28c2623bff76e623f0fba51f45418`。当前未启用解释器，也没有执行新的应用内核验；用户授权不替代系统自动审批。ADB 与 QA 端口当前无监听，未重启设备或服务。下一步是准备隔离 QA 后按原方案请求同一受控权限，遵守审批结果，不以其他入口绕过拒绝。

隔离 QA 准备续验：无模型访问凭据、解释器默认禁用时启动本轮服务和实例锁守护；为避免在工具输出中暴露一次性 bootstrap，尝试以本地临时引导页进入。Browser Use 因 URL 协议不在 `http:`／`https:` 允许列表而拒绝，并明确禁止通过间接执行或其他浏览器入口绕过；未进入产品、启用解释器、发送模型请求或操作 capture。回放用的旧自动审批拒绝与本次浏览器 URL 策略拒绝是两个不同的阻塞。随后核对进程树并停止本轮 QA，守护释放锁；本轮 PID 与 5127 均已退出，canonical 实例锁不存在，隔离配置中解释器仍禁用、secret 仅余原签名记录。核对工作区路径、Git 跟踪、链接及进程后删除本轮临时目录和启动文件，预清点 31 文件、逻辑长度 6571748 字节，不代表实测释放空间。后续必须先获得不违反该浏览器策略的明确外部条件；不能换入口重试同一受阻浏览器动作。

设备现场只读复核：Windows 当前列出状态为 OK 的 ADB Interface 与手机便携设备；该 ADB 接口的设备属性显示最近到达时间为 2026-11-05 16:24:27，早于 11 月 6 日已记录的远程连接失败。该属性不能证明 ADB 服务、链路或回放在整个期间持续正常，也不证明当前 ADB 在线或先前断连原因。未启动 ADB、重开 capture 或修改设备；没有据此认定失败条件已改变。沙箱内 PnP 查询无法访问 CIM，本机权限的只读查询成功。

单 capture 范围复验：新隔离项目的 Optimizer 计划自动冻结已登记输入、SHA-256 与 local 设备；General 以入口 EID 14 的签名基线执行，两组各 16 次帧计时后读取 EID 11，再经 `capture_restore` 返回 EID 14／原输出。回合以 `partial` 正常终答后主进程写入 `resolved`；操作者核验四份生命周期回执 HMAC、回合引用和现场一致性。独立 Verifier 检查 14 份授权材料，但未独立验签或读取完整操作历史。没有变体、画质比较或收益证明，未知 vsync 等基准设置未被编造。46 份请求均为 Terra Medium／Fast 关闭；输入 2558515、输出 14274 token，输入含 1597056 缓存读取，费用不可得。计划、质量选择及 23 项 General 工具操作由人批准。证据 84 项清单 SHA-256 `90767b124aaf57a69aa95fa07ad96d3850004dea58d4407a85f99804a76fe51c`，见 `capture-scope-live-retest/evidence/`；首轮未恢复的结果不改写。产品已关闭隔离回放，归属 daemon 登记为空，相关 daemon／worker、QA main 与锁守护进程退出，canonical instance.lock 不存在；隔离访问副本移除、签名记录保留，四份来源和八份正式 User Agent 哈希不变。

单 capture 修复的最终工程与清理：完整 Node coverage 为 391 文件／3591 项通过、4 项跳过，ratchet lines 78.62%、functions 78.22%、branches 67%、statements 76.01%；typecheck、lint（0 errors／2151 warnings）、build 和指定本轮基线的完整 gates 均通过。首轮 gates 使用错误变量导致两项历史比较跳过，修正为 `RDC_SYSTEM_DEBT_BASE_REF` 后完整重跑通过；回执 `scope-final-validation-evidence.json` SHA-256 `1a60e980f8db51ea904bc07b22ddd617d4e218559e25d20bc6819835093b2fb6`。四组证据清单共 344 项复核一致；经路径、跟踪、链接及进程检查，移除 coverage、测试缓存、QA 临时目录和本轮启动文件，预清点 1993 文件、逻辑长度 58576588 字节；另移除临时工作检查点 1 文件、6566 字节。逻辑长度不代表实测释放空间。保留用于未决历史归档核验的隔离会话、签名记录和原始请求，以及两次 Optimizer 的公开样本项目及原路径供 partial 复核／续接。

完成声明直接耦合修复（工程验证通过）：已复现 ready report 的状态不允许完成、相关 Challenge 未解决或 Optimizer 缺合格实验时，声明前检查仍放行 completed。现复用最终报告资格检查，允许其他合格报告存在时继续；最终答复仍校验实际引用。另复现并修复存储或意外错误被误作报告不合格并跳过的问题，三组受影响测试 77 项通过；最终源码的完整覆盖率、指定基线的 gates、ratchet、typecheck、lint 和 build 均通过，真实 Debugger 行为仍未复验。

原生日志完整读取续查：来源设备前后 stat／SHA256 与本机副本一致，187 行中无 Error／Fatal；两个能力 Warning 未被日志关联到断连。完整来源与 `android-native-log-full-evidence.json` 已保留，未重开 capture，断连原因及 T3／T4／T5／T7 的验收缺口仍在。

宿主退出续查：Application 在目标时段未返回相关错误事件，Security／Sysmon 当前记录从事发之后开始；不能确定原 ADB 服务退出原因。查询范围和保留窗口见 `android-host-event-evidence.json`。另核对失败回执对应的 RenderDoc 内嵌提交，`RemoteServerConnectionLost` 可由代理泛化错误返回；读写错误或响应包不匹配等均可能进入代理错误状态，不能仅凭错误文本确定具体原因。宿主实际加载模块和当时日志路径未独立核验，见 `android-proxy-status-evidence.json`。

本地端点与停止续验：隔离 Browser QA 先复现自定义本地地址被 RequestPlan 替换成目录默认端口，新增回归并修正；最终构建中请求到达已配置端口，UI／持久记录显示 stopped、夹具观察到流连接关闭。模型能力和流式内容均为隔离模拟，未调用真实模型；该次未验证 capture 切换／恢复，本机续验见下文。

本机双 capture 续验：公开样本各自可 Local 回放。首次获批切换中止，正式恢复入口回到原 EID 14；带调用来源的复现证实切换时旧 ID／新哈希混合发布，被右栏触发的项目输入核对误判并停止回合。修复为同时发布 ID 与哈希；重叠刷新回归由失败转通过，真实内容变化仍触发停止。修复后公开样本在同一批准会话内切换至 EID 21 并恢复原样本 EID 14／输出，签名回执已保存且 UI 显示两幅画面，见 `local-switch-cause-evidence.json` 与 `local-switch-fixed-evidence.json`。Provider 为本机夹具，该结果不替代 Android 或真实 Mission 验收。

本机续验收尾：4 文件 75 项相关回归和最终全量覆盖率通过，完整 gates、ratchet、typecheck、lint、build 均通过，见 `local-switch-validation-evidence.json`。隔离回放和本轮服务退出，5127／56606 无监听，桌面实例锁不存在；核验保留证据后删除本轮 QA 与 coverage 共 1000 文件、逻辑长度 45504723 字节，不代表实测释放空间。正式会话当前 capture 未复核。

真实 Provider 停止验收的预审边界：现存 `local-route-after-request.json` 是 Ollama 本地夹具的脱敏快照，含三个测试消息和 32 个工具定义，不能作为未来 ChatGPT 请求的精确外发载荷。当前代码在发送前可写 RequestEnvelope，但会脱敏；ChatGPT Responses 载荷随后由当前上下文和 RequestPlan 重新构造，邮件通知、续跑内容和权限事实也可能变化。若要重试被自动审批拒绝的真实请求，须先固定并核对实际发送范围，再按审批结果执行；不得用本地快照冒充该请求或绕过拒绝。

历史债务对比补验：完整 gates 的默认本地执行未指定 base-ref；以本轮基线 `36306dbd3d5ca1f6663bcedda43ba6e25a0d0ba4` 显式运行知识与调查对比，两项均通过。首次沙箱尝试未取得有效嵌套测试报告，原因未确定；本机权限和隔离临时目录下分别复验通过。

本机真实长 Mission 首轮（未通过）：隔离项目使用两份公开 Local capture 和 ChatGPT Terra Medium，规划 6 次、General 42 次、两代 Verifier 3+4 次，共有 55 份请求快照，均为 Terra Medium／Fast 关闭。General 显示 25 分 06 秒；其 112 次已启动工具调用中，49 项经逐次人工审批，另有一项组内调用被跳过。Analyzer／General 的 Provider 记录分别为输入 119338／4576904、输出 2631／17632 token（输入含缓存读取）；子代理完整 token 用量和实际费用不可得。计划审批与工具单次审批均为人工介入，不能称为无人干预。隔离范围未复制正式会话、私人知识、MCP 或 memory。

两份抓帧的事件树、管线、shader、资源和原生输出已实际采集并经 Verifier 查看；首次独审 partial，补授生命周期材料后第二代确认跨 replay 的同一内容哈希及宿主记录的位置恢复，入口原生 context／focus 未独立核实。两 Task 显示完成、报告和 checkpoint 已创建，但调查清单没有 `Challenge` 类型记录，未满足本轮计划所写的类型化 Challenge 交付。`turn_complete(completed)` 在报告创建后曾记录成功；General 终答只写裸摘要而未写完整 `sha256:` 内容哈希，最终门禁拒绝，后续两次模型答复未重新声明，回合以 `CONVERSATION_AGENT_LOOP_STALLED` 失败。不得将这些局部成果视为完整 Mission 通过。

首次 `capture_restore` 记录 A E11→E14 与最终输出；失败后产品仍显示待恢复，随后人工点正式恢复入口，宿主写入 resolved 回执且右栏不再显示待恢复，A E14 画面可见。关闭回放后本轮 daemon／worker 已退出。切换、恢复和复核材料保留于 `live-local-mission-first-run/`；回执由隔离密钥签名，产品在恢复流程中核验，密钥不随归档保留，因此清理后不能再次独立验签。

恢复提示续查：归档回执正文显示 `position-restored` 的输入 hash、设备、EID 14、替换指纹与输出目标均匹配基线，但它不是关闭基线的 `resolved`；当前源码在模型循环正常返回并通过完成校验后才复核并写终态 `resolved`，而本轮循环失败未到该路径。人工恢复入口随后写入指向同一基线、位置匹配的 `resolved`。三份回执的会话、turn、计划与顺序一致，SHA-256 分别为 `109b1df902405c887a47e4e9fe8c4f76a47bb3ace7b94d067dbb2e6ca315969f`、`1cb6fcba782a7a3fd19d9678aafb505c88bf15aa5cdba457211188281f834476`、`f810a85be3c50c8a277cddd743971fad0c69a466ba8ca27e97b78cdce44a5655`；中途状态不能证明失败时现场未变。该提示符合未闭合基线合同，不据此修改恢复逻辑。

完成反馈修复：`final_not_bound` 反馈列出精确报告 ID 和完整 `contentHash`，说明 `sha256:` 前缀；已失效的完成声明反馈明确要求修正后再次调用 `turn_complete`。未放宽精确引用门禁。相关两组 71 项和模型循环离线联动 15 项通过；全量 Node 限 4 worker 为 391 文件／3573 项通过、4 项跳过，ratchet lines 78.54%、functions 78.18%、branches 66.93%、statements 75.95%；typecheck、lint、Skill、Agent Runtime、Investigation 和 build 通过。默认并行全量的 14 项超时、沙箱链接权限失败及汇总脚本首次参数错误均保留于 `live-local-mission-first-run/validation-evidence.json`。

方法合同续查：首轮 General 已读取 Challenge schema，但后续只改比较稿，未写 Challenge；当前完成门禁检查已登记且与报告相关的开放 Challenge，不把计划自然语言自动转换为新门禁。`renderdoc-execution` 现明确：计划要求 typed Challenge 而只读审查只返回质疑文本时，父级核对合法目标和来源并登记，缺材料则保留缺口；不杜撰 Challenge。另发现 `analyzer-architecture-method` 仍要求用户分别打开 capture、每份另用 owning session，与当前同一 session 的获批 `capture_select`／`capture_restore` 契约不一致；已改为现行身份与恢复流程。两处方法说明修正后，真实续验已补建 Challenge；首轮失败不重写。Skill 门禁 16 项、`RdcProbeTool` 19 项、typecheck、lint（0 errors／2152 warnings）、指定本轮基线的 `check:investigation-system`（hits=0）通过；本次验证临时目录 8 文件、逻辑长度 2660921 字节已核验并清理。

真实续验结果：用户批准后按 `live-local-mission-first-run/continuation-scope.json` 续发并使用 Terra Medium。General 补记两条 Challenge、检查点和草稿报告，以 partial 结束；Verifier 确认 shader 修订符合四份反汇编，归档副本完整哈希匹配但因长记录截断未逐项比较。普通 shell 不能绕过文件工具边界，自动审批拒绝启用隔离本机解释器；历史来源认证仍开放，Android 阻塞独立保留。续验 6 个原始回合、三份 Verifier 轨迹、调查记录、报告及必要产物保留在 `live-local-mission-continuation/`，129 项文件清单 SHA-256 为 `5c0f0885dc58ed47ee4ef9d5e50f417006b1666fe604c298bddffd280a422cbe`。

本轮测试清理：路径、Git 跟踪、reparse 和进程核验后删除 coverage 与两个本轮测试临时根，共 761 文件、逻辑长度 38314227 字节；随后清理早先独立本机探测的 33 文件、逻辑长度 34828 字节，其脱敏结果及原始回执哈希保留于 `local-fixture-probe-evidence.json`（SHA-256 `5ee699876fcc94124aee0c4bf3b5802d4b6f0476820fcfbaf435bbac65bbe533`）。逻辑长度不代表实测释放空间。首轮归档 89 个文件的长度和 SHA-256 均复核一致。当时隔离 QA 停服并移除访问凭据，仅为同会话续验保留状态、签名记录和 Local State；用户批准后已续验。最新一轮已再次移除临时访问副本，四份 canonical 来源哈希均未变化；因历史归档核验仍受阻，保留该会话状态和隔离签名记录供后续处理。

当前现场 probe 续验：最初真实请求暴露 Local 直接打开后 preparation 仍为 idle，已先复现并在主进程将 Local ready 与已验证的 replay 设备身份原子发布。四文件 65 项、typecheck 和 lint 通过。最终构建经产品入口直接打开公开 vkcube，General 查询成功；Verifier 按完整哈希读取 22171 字节、两页至末尾，确认 EID 14、空焦点，封装标记未截断而内层无独立标记。原调查的 ready report 门禁拒绝 completed，General 随后以 partial 终答；该现场不能补证历史。隔离回放关闭后登记为空，daemon／worker、QA 及端口已核验退出，桌面锁经应用获取／释放流程交还。

本次验证及清理回执：`continuation-validation-evidence.json` SHA-256 `72945ff8b9fa68096b900e5a514c062f41b2ec81feb0a5210270df5ee653aad3`；首轮 89 项与续验 129 项证据清单逐项哈希复核无误。核对绝对路径、无 Git 跟踪、无 reparse 与无活 owner 后，移除 coverage、测试编译缓存、隔离 QA 临时目录及本轮 23 个日志／状态文件，共 1957 文件、逻辑长度 47481753 字节；逻辑字节不等于实际释放空间。隔离 QA 的完整会话、受保护的签名记录、Local State 和尚需复核的请求来源保留，访问凭据已移除；后续重启时按需新建临时目录并重新准备访问副本。

历史归档操作员续查：固定只读脚本在宿主上核对原归档与隔离副本字节一致，并定位两次调用；两份提取的完整 toolResult 与归档对应对象深度一致，两段原文 UTF-8 SHA-256 均与声明一致。脚本、输出和分离原文见 `history-context-audit/`，清单 SHA-256 `3b3d12b55376ecf1454edaa04be3b8e967bbeb10db292404fd96ff29d9a8c39f`。这是操作员执行，不等于应用独立执行、来源认证或签名验证。随后应用对分离的两份原文做全文件哈希审计，Verifier 逐页审阅脚本、提取件与回执；入口与恢复后的资源焦点不同，恢复后记录比位置回执晚约 17 秒。Challenge 保持开放，General 以 partial 终答；此轮 22 个记录请求均为 Terra Medium，三处隔离报告修改经单次人工批准。复审原始轨迹及报告在 `history-context-audit/review/`，57 项清单 SHA-256 `4e3e54998e5bda930d1bd8f1ac248ba83b8f5ec67a7c3208c822d37fd6e14319`。

历史复审收尾：产品入口显示未打开、归属 daemon 登记为空；本轮隔离应用和守护进程退出，5127／56606 无监听，桌面锁经应用获取／释放流程交还。重新移除临时账户访问副本并保留隔离签名记录。核对绝对路径、Git 跟踪、链接及进程后，移除本次临时目录和 6 个日志／状态文件，共 20 文件、逻辑长度 4429353 字节；不等于实际释放空间。

生命周期回执操作员核验：使用隔离 QA 保留的密钥在本机核验 baseline、position-restored、resolved 三份回执，HMAC 均通过；同一 turn、baseline 引用及入口／恢复后的原生身份与对应回执一致。密钥未输出或发送给模型；这不是第三方签名，不能认证未签名的会话归档，也不能证明回执时刻的资源焦点。应用和 Verifier 未独立执行该核验。脚本及脱敏结果见 `history-context-audit/verify-receipts.cjs`、`receipt-verification.json`，单独清单 SHA-256 为 `5986bdab5bf4cf781237e64a76fa55e6c57e2579a2bf3b757b92c79aa80005c7`。核对路径、跟踪、链接和进程后移除本轮临时目录 2 文件、逻辑长度 936 字节；不代表实测释放空间。

Analyzer 回评估：按获批计划切回 Analyzer，读取比较报告、独立审查、三份回执及新增操作员材料；应用核对清单和文件哈希，但未读取密钥或自行重算 HMAC。Analyzer 保留历史来源及焦点的开放 Challenge，登记草稿报告 `invart-8f28a87c6fcc-1793970900022`（内容 SHA-256 `bc5e3aa8a6a018c0fa54c4d90fd529b475a360f74b53d9837fb5529db406b338`）和 ready 检查点 `invart-31c9b8a336b1-1793970873538`，以 partial 正常终答。9 次请求均为 Terra Medium，输入 2387285、输出 5579 token，输入含缓存读取，实际费用不可得；没有打开回放或执行脚本。该次材料 20 项的清单 SHA-256 为 `0187e58f4a22c3f27a4bd0b931a8f9e323617cb95c73c2ec30ed8c93e1573d0f`，见 `history-context-audit/mission-evaluation/`。本轮服务、归属进程和监听端口已退出，失效锁经产品获取／释放流程交还；隔离访问凭据副本已移除，签名记录保留。核对路径、跟踪、链接和进程后清理临时目录及日志 20 文件、逻辑长度 4429378 字节；已消费的一次性 bootstrap 文件另行移除，逻辑长度不代表实测释放空间。

恢复范围核对：Analyzer 复读获批计划、回执和 Challenge，确认计划指定原 capture、事件和输出目标，三份回执在这些字段上相符；资源焦点是更宽的历史状态，仍不能证明。它尝试提交范围限定的 ready 报告，完成门禁实际返回 `MISSION_COMPLETION_DENIED`，因为该报告关联的 `challenge-prior-entry-focus` 仍开放；随后将报告改为草稿并以 partial 正常终答，未关闭挑战或修改门禁。最终报告 `invart-d348e131186f-1793971571816` 的内容 SHA-256 为 `3cb9b6d48a0cfb65526b3103ff610009621d730768f46014311e0ac6750f7d56`。7 次请求均为 Terra Medium，输入 1985491、输出 5250 token，输入含缓存读取；实际费用不可得。原始回合、含拒绝记录的过程与产物见 `history-context-audit/scope-check/`，12 项清单 SHA-256 为 `2795d03c4a88b76ce78c43b04fa5fbf61a6320cbc4658aaab886655b30972202`。未打开回放、执行代码或读取密钥；本轮服务退出、失效锁经产品流程交还，访问副本移除且签名记录保留。核对路径、跟踪、链接和进程后清理临时目录及日志 20 文件、逻辑长度 4429474 字节，不代表实测释放空间。

应用内有界核验的待授权方案：`history-context-audit/proposed-bounded-archive-check.py` 固定读取隔离项目中的归档副本和两份提取件，校验归档 SHA-256、调用唯一性、完整 toolResult、元数据与原文哈希，只输出结果，不读取签名密钥或写入输入文件；脚本 SHA-256 为 `49b4362ee362c49fb00d2ebdc0c62e8fdf67f82e7179b370e9e9896d189dd4c1`。使用现有 RDC-Tool 随附 Python 的操作员试运行通过，记录 `proposed-bounded-archive-check-evidence.json` SHA-256 为 `6fe9c9d4f3ae82b9c78c48c21433057849b2ba448a46d0724862549bc197614d`；这不是应用内执行。若用户授权，可仅在该隔离 QA 临时启用本机解释器，由 General 提议调用并逐次核对、批准相同代码，结束后禁用并清理。解释器进程继承当前用户权限和环境，并非操作系统沙箱，能访问其权限内文件及网络；脚本本身不访问网络。该核验只能补充归档逐项比较，不能认证未签名来源、补证回执时刻焦点或替代 Android 验收。当前配置仍禁用。

长行搜索修复与真实复验：此前 General 对约 780647 字节的归档行搜索已知调用 ID，返回零命中且未标记截断；回归先复现这一错误。现对超长行在受限 worker 中匹配完整原行，结果只返回有截断提示的有界预览，并对超时和取消终止 worker。6 项定向测试通过。最终构建经隔离产品入口执行，General 分别找到两个此前遗漏的调用 ID；四次请求均为 Terra Medium，输入 1219402（含缓存读取 305536）、输出 703 token。搜索复验只证明定位与截断提示，不能证明完整对象比较、原始来源或历史焦点；原调查完成门禁拒绝后回合仍为 partial。真实请求及清单见 `grep-live-verification/`，清单 SHA-256 `f49c7ff7bad298f596a909661eb95672f8c85ff0b491d4b10f9a1d619193d74b`。隔离服务退出，临时账户访问副本移除，核验后清理本轮 QA 临时文件 20 个、逻辑长度 4457945 字节，不代表实测释放空间。

搜索续验收尾：八份相关证据清单共 318 项逐项核对长度与 SHA-256 均一致；四份 canonical 来源和八份正式 User Agent 配置哈希未变。隔离解释器禁用、secret 存储仅留签名记录；自有 QA／测试进程、5127／56606 监听与桌面锁均未发现。核对路径、Git 跟踪和链接后移除本轮 coverage 与测试临时目录 1925 文件、逻辑长度 43207699 字节；逻辑长度不等于实测释放空间。

独立真实 Mission 首次复验：为验证完成反馈修复后的完整执行路径，独立项目仅复制获批的两份公开 Local 抓帧并核对原 SHA-256；隔离用户资源中 Knowledge、Memory、MCP、Hooks、Policies 和自定义 Skill 均为空。使用与原测试相同的提示及 Terra Medium，项目 `proj_86bf8d0e5f84`、会话 `sess_edb2efa74f2e`；Analyzer 计划 `plan-2026-11-06T141741476Z-7bb3cf30` 经核对批准。General 采集两帧、导出并查看两图、取得隔离 Verifier 的三项挑战，回合最终失败 `CONVERSATION_AGENT_LOOP_STALLED`。主进程签名入口基线是 EID 14 和最终输出目标，但 `runtime_context` 误将打开时保存的旧 `raw.active_event_id=11` 暴露为现场，General 和 Verifier 都将其当成入口，General 先恢复 E14 后又主动设为 E11；终答前恢复校验拒绝，模型收到继续恢复提示后未调用工具，重复终答触发无进展停止。人工经产品入口恢复 E14 后关闭回放。失败材料 70 项清单 SHA-256 `004cda4fd4b2ee191019e5e9bbb00767db19ff4be067f62651a0d8b261bc1ebc`；原失败和历史 partial 保留。

入口基线修复与第二次真实复验：`runtime_context` 不再暴露打开时原始快照，获批 owning General 可读取带回执引用的冻结入口基线；终答恢复不符时反馈基线与当前观察。定向 145 项、Node 全量 391 文件／3588 项通过和 4 项跳过，typecheck、lint、ratchet、指定基线 gates、build 通过，回执 `restoration-regression-validation.json` SHA-256 `0dbbd84df22ee2dd02a5c091b9eff8814f0f930f2d6a17b0ae3ec7727460ad3f`。新的隔离项目 `proj_b7933785a9f6`、会话 `sess_8003c402647a` 以相同提示和两份公开抓帧完成 Analyzer 计划、General 执行、两次 Verifier、报告与终答；68 份请求全部 Terra Medium。General 实际返回入口基线 EID 14，切换并两次恢复，最终 `resolved`，五份回执经操作员 HMAC 核验。计划和 21 项工具操作经人工批准，报告与 117 项证据清单 SHA-256 `2e0e6adcced9c26d9b35bcea5d200df52b38fe9e6e0990147108a7ca7af98e8d`。结果限于两份 Local 抓帧；Android、真实短／详细 Prompt 对照和陌生案例泛化仍未通过。

本轮复验清理：经路径、跟踪、链接与进程核对，移除测试覆盖率、QA 临时目录、六个本轮与前一轮失败现场的已关闭 context 残留、自建 helper 及临时检查点，共 854 文件、逻辑长度 45402809 字节；不代表实测磁盘空间增量。两组证据清单共 187 项逐项复核一致。QA 与归属 daemon／worker 已退出，5127／56606 无监听，失效锁经产品获取／释放流程交还；正式来源与八份 User Agent 哈希未变，隔离访问副本已移除，仍需历史来源核验的隔离会话和签名记录保留。

收尾安全说明：进程检查曾意外在工具输出中显示无关 Cursor 进程的凭据；未复述该值或操作账户，已提示用户撤销并轮换。

## 待验收边界

- 本机真实案例的短／详细 Prompt 对照需要同一模型、知识和权限，以及可成功使用的干净回放；当前 BlackHair 首帧观察失败，不以合成材料替代。陌生 capture 与独立真值不足，泛化仍是缺口。
- Debugger 的 Task 与 Verifier 第二代结果保留各自历史预算根；最终缺正式 report，人工整合的七项建议未经再次独立复审。Analyzer 缺 WorldState／Checkpoint 而部分完成；Optimizer 的修复后合成复验因缺实测基准而部分完成。它们都不证明真实 Mission 已自主完成。
- BlackHair 此前在 Adreno 管线创建栈出现 SIGSEGV；本次重试的观察失败是远程连接丢失，原因尚未确认，不将两者直接等同。历史成功的 APK 内 Android 库 Build ID 与较早打开崩溃栈一致；故障后只读得到的现存 APK 哈希与历史成功一致，包管理器更新时间早于故障，但故障当时的 APK 哈希和进程加载字节未核验；历史重连也没有活动 capture。只读 crash／system 缓冲区与 helper exit-info 未提供断连原因，main 缓冲区不含故障时段。设备原生日志在 11:22:25 记录关闭活动连接；对应基线源码在该日志前执行回放清理，不能把它的时间当作初始断线时刻。采集时临时 ADB 意外退出，自动启动的替代服务经归属核验后停止；未停止其他项目共享服务。已停止在同一失败条件下重复重开；用户仅能提供 BlackHair，后续切换验收还需另一份可回放输入及兼容设备，或先取得可复查的 native 故障根因并修复。
- 用户 11:44:33 要求后续软件操作使用 Terra Medium；一个已运行旧回合在 11:44:38 仍发起 Sol Low 请求，记录没有完成用量，随后已停止；其后请求均为 Terra Medium。真实用户数据副本仅用于本轮验收，副本及其临时访问授权已清理。

## 工程与资源回执

- 正式验收记录：`docs/product/acceptance-ledger.md`。切换修复阶段 Node 全量为 391 文件／3571 项通过、4 项跳过；Local 续修阶段为 391 文件／3577 项通过、4 项跳过。搜索修复后的 Node 全量为 391 文件／3581 项通过、4 项跳过；由覆盖率 JSON 汇总的 ratchet 为 lines 78.57%、functions 78.19%、branches 66.95%、statements 75.96%。V8 控制台显示的截断百分比略低，原始计数及两者均记录在回执。最终 typecheck、lint（0 errors／2151 warnings）、工具系统检查、指定本轮基线的完整 gates 和 build 通过。gates 首次在沙箱临时目录重命名报 EPERM、未执行测试，改用工作区临时目录后通过；Node 全量在本机权限下运行以覆盖回环与链接测试。回执 `grep-regression-validation.json` SHA-256 `71afb23a6adf22323467a3581fd963071ad528549ee8976e0f92add67598c7f2`；前两阶段分别见 `local-switch-validation-evidence.json`、`continuation-validation-evidence.json`。
- 模型、历史配置、真实离线 Mission、Android 失败及压缩来源分别保留为本目录下的 `agent-configuration-evidence.json`、`model-execution-evidence.json`、`mission-runtime-evidence.json`、`analyzer-runtime-evidence.json`、`optimizer-runtime-evidence.json`、`mission-readiness-evidence.json`、`debugger-readiness-evidence.json`、`android-failure-evidence.json`、`android-resume-evidence.json`、`android-historical-comparison.json`、`android-transport-forensics.json`、`android-installed-apk-evidence.json`、`android-native-log-evidence.json`、`android-proxy-status-evidence.json`、`compaction-runtime-evidence.json` 和 `compaction-source.json`。合成压缩原始来源哈希为 `b77ee8da41c266a71c150c4b1383b0632bb12322460a9681cf1e8d4e9447caa4`；完成声明复验回执哈希为 `66eba59a94c9ea5175f07ffd5905c80eb41154e1a11ba9e849070e03a57c0c89`，Debugger 续验回执哈希为 `ce1e89c70bacaaba6c368b5290fb02b665e15bd74a1e73d35915d78ff9fd67f7`，Android 历史对照哈希为 `859a014a1f510cb947775282c1b7a8bcb420d9898226c73429baf427e7be62ba`，只读日志回执哈希为 `12f08c8b8eb2a94931beefa0cef01d8d2c9f17af853dc89babf8c352777d5dad`，现存安装包回执哈希为 `cb47162dd29d5cee454e4e60fe36a1b61a8dd10dc3006c4743dc8f3fd20ba398`，原生日志筛选回执哈希为 `fda12c9593846c0fecb64fce6dc5ce59856df7d58f70f73da1a417fc03b7b70e`，代理状态源码追溯回执哈希为 `2d7918c41a7848038b8dbad997d6088efb5bda8ff48ee94113cc0a90c9688faa`。
- 隔离 Browser QA 和归属回放已退出；最终 5127、56606 无监听，canonical 实例锁不存在，桌面启动权已交还。隔离 capture 已关闭；正式会话当前 capture 本轮未复核。此前 `resume-qa`、`test-temp` 和 coverage 清理的逻辑文件长度为 107375270 字节；首次续验另清理 2028 文件、逻辑长度 51508663 字节，Debugger 续验清理 113 文件、逻辑长度 9000509 字节；本地停止续验的 QA 清理 65 个文件、逻辑长度 1096606 字节，随后测试与 coverage 清理 766 个文件、逻辑长度 36695397 字节；完成声明续修再清理 755 个文件、逻辑长度 36270594 字节；异常传播修复再清理 756 个文件、逻辑长度 36646704 字节。均先核对绝对路径、无 Git 跟踪、无链接及无活 owner；逻辑长度不代表实测磁盘可用空间变化。收尾时另一套 Android SDK 的 ADB 正在监听 5037，本续修未启动或停止该进程，具体归属未确认；异常传播修复收尾时上述端口均未观察到监听。另有独立 Cursor agent 进程引用本仓库，未干预；本次修复的源码／测试文件哈希与验证回执一致。真实 capture、用户会话、凭据、依赖和构建保留。
- 未创建或切换分支，未提交、推送或发布。
