---
name: renderdoc-execution
description: Execute a frozen RenderDoc investigation plan, deliver in place, and checkpoint changes requiring strategic realignment.
---

# RenderDoc Execution

General 消费本次会话 execution offer 冻结的 Plan URI/hash 与 requiredSkillIds：读取原 Plan 和 Checkpoint，在计划边界内把调查做到证据允许的深度，就地交付。CLI 用法见 `$rdc-tool-shell`，专业操作见本次预载的 `debugger-rdc-tools` / `analyzer-rdc-tools` / `optimizer-rdc-tools` 之一，领域记录见本次必需方法。身份、权限、消费、期限和恢复由主进程强制执行；被拒绝时按回执处理，不需要在方法里预先设防。

## 调查主线

每得到一个结果，都回到这条主线判断下一步。它是判断顺序，不是固定工具序列；知识检索、对象定位和计算分析可以交错。

1. **锚定**。把用户目标落到当前 capture 的具体对象：哪张原生纹理、哪个区域、哪个事件或 draw、哪条资源链，以及"它就是用户所指"的依据。依据分三档：用户确认；两条独立路径互相印证；仅候选。锚点仍是"仅候选"时，下一步优先选择能确立或否定它的检查，其余分析建立在它之上。
2. **解释与预测**。对已锚定的对象保留互相可区分的解释。每条写明：成立时应观察到什么，什么观察会削弱或排除它；来自 Knowledge 的解释另写哪些适用条件已匹配、未知或不符。条件未知先核对，已证伪才排除。
3. **选下一项检查**。在合法、可执行的检查里选最能改变判断的一项，说清它区分的是哪几条解释。结果回来后更新：支持、削弱、排除或暂缓了谁。符合预测只增加支持，不单独证明因果。
4. **在决策点记录**。工具回执已经是带 hash 的制品，探索阶段直接沿回执推进。到锚点确立、解释集合成形、实验设计与关闭、准备交付这些节点，再用 `investigation_*` 写 WorldState／Evidence／Claim／Experiment／Challenge／Checkpoint。Checkpoint 的 `unresolvedFrontier` 写仍然有效但未执行的检查。
5. **请独立核验**。形成拟接受的定位、归因或因果主张后派发审查；没有主张时不做空审查。审查返回的 open Challenge 是待处理的工作，审查完成不等于它已解决。
6. **继续或交付**。计划范围内还有合法且有区分力的检查就继续，不把"下一步尚未检查"写成阻塞。确实不能继续时交付 partial：逐项写缺口、已尝试的路径、真正阻止继续的条件（能力、权限、预算或期限、战略边界、外部条件）和恢复条件。一次无副作用的拒绝不等于能力不可用。

## 共享 Plan 模板

Plan 是按任务规模填写的 Markdown 策略。Mission 用 plan_artifact 提交给用户审阅，拒绝则修订同一份；批准后本回合结束，用户点声明按钮才切到 General。本规划回合创建了未完成 Task 时，提交须填写 requiredTaskIds（确无必需 Task 传空数组）；正文里的 Task 名称或 ID 不会冻结要求。需要实时 RDC 时，在 `plan_artifact.captureScope` 填写已登记 `inputIds`、当前 `deviceId` 和调查目标，身份取自 `runtime_context.capturePlanning`；仅离线分析可省略。只读调查也需要临时选择回放事件并在结束时恢复入口位置，计划应允许这类导航与恢复，只禁止未批准的 shader／data 修改、替换或实验干预。

六块内容，可标注不适用及原因：

1. **目标与边界**：用户目标、成功标准、范围、质量约束、输入缺口。
2. **输入与参考依据**：输入引用、已知事实、未知项；已取得的锚点及其依据档位、来源和精度；Knowledge 来源及适用条件。多词查询要求词项共同匹配，无命中时拆成对象、症状或领域概念的短查询。
3. **候选方向与选择依据**：各方向的预测、最小区分检查、进入／排除条件。不固定数量。
4. **执行策略与依赖**：首批检查及其所需 ID 如何取得、必要依赖、父级直接工作、需隔离委派的分析、需独立审查的主张。不预写全部命令。
5. **决策与循环**：Small Loop 补证、Big Loop 改策略、ask_user 条件、真实停止条件。
6. **交付与重新对齐**：必要证据、未解问题和 General 就地交付；战略变化时的 Checkpoint 与触发依据。

修订后的冻结正文须完整自足，不以"其余同上一版"省略；引用外部合同或检查点时给出可解引用的 URI/hash。计划新增的硬前置必须有执行侧实际可读的来源，读不到就在计划门修正，不猜值。

额度权威在 Harness：provider 请求上限见 `runtime:execution-limits`，Task root／Capsule 的工具数、子执行数与 deadline 由主进程冻结并执行，实际消费与余量读 `task_get.budgetSnapshot`／`requestUsage`。计划的预算节只引用这些真实限制和用户明确规定的限制；可以给出可调整的估算，但不自编阶段配额，也不把估算变成停止门。已批准的用户限制或旧计划中的硬限需要变更时，经 `plan_artifact.taskRevisions` 正常修订，不静默删除。执行时先做能决定下一步的检查，为恢复和收口留余量；只有真实硬限制被触及才保存 Checkpoint 并按 partial／`budget_paused` 收口。

## 续跑与循环

用户点声明的 continue 后，主进程写入 execution offer 并预载声明的 requiredSkillIds。General 就地终答，不自动切回 Mission。

- **Small Loop**：批准目标和战略内的补证、区分、处理反例与核验，在当前执行里直接继续，沿用原消费与期限。
- **Big Loop**：战略或范围需要改变（换 capture 或设备、超出计划的操作、目标变化）时，保存可解析的 Checkpoint，在终答写清缺口与变化依据，由用户切回 Mission 决定。runtime 不按身份、depth 或正文开下一轮。
- 额度耗尽未完成时，声明 `budget_paused` 并引用最后 Checkpoint 的 URI/hash；这只结束当前 turn，不提升报告状态。
- 已执行动作、成功回执、失败尝试和剩余检查须跨 Context 压缩保留；压缩后先读回冻结计划和最新 Checkpoint，再决定下一步。

## 现场与实验

- **切换与恢复**：跨 capture 用批准计划中的 inputId，由拥有现场的 General 调用 `rdc_probe` 的 `capture_select`。`runtime_context.captureRestoration` 是签名的入口基线，不是当前事件；当前现场用 `rdc_probe` 实际查询。结束前调用 `capture_restore` 并检查返回的 `restoration.restored`；`changed:false` 可以表示现场本来就一致。回合运行中 `terminalReceiptPending` 为预期状态，`restored:true` 后继续其他获准工作，终态回执由主进程在提交前签发。
- **故障**：现场因原生失败被隔离时，关闭中断的实验后调用 `capture_recover`，在相同输入、设备和权限下重开并重新准备；离线分析可照常继续。中断实验的旧阶段不与新现场拼成一次实验；同一故障条件再次出现时停止重开，改做其他合法检查或如实交付。
- **取图**：某个临时路径不可读或当前事件没有普通颜色目标，不等于图像不可取得。核对本轮工具返回的精确路径，再用 catalog 中可用的观察或导出能力（例如 `rd.session.observe` 的最终输出）写到有权限的临时位置并实际读取。展示截图的尺寸可能不同于原生纹理，坐标以原生纹理为准。
- **实验**：因果介入与优化实验须真实执行并恢复。shell.rdc 的 experimentId 绑定 baseline→intervention→variant→rollback→restored 五份签名回执（Experiment.executionEvidence）；baseline、variant、restored 是三份 measurement 回执的引用角色。介入前保存真实基线；需要变体现场的图像、参数和替换枚举在撤销前保存。权限拒绝、未执行、布尔声明或 capture hash 不变都不是回滚证据。
- **最小区分实验**：干预集合有语义依据、范围受限、预测可区分并具备恢复能力即可进入；不要求事先证明它的全局最小性，那往往正是实验要检验的。对象与源材料的绑定、修改边界和恢复条件必须先成立。
- 按规模使用 task_create / task_update 在计划边界内调整 Tasks；领域字段不写进 TaskRecord。普通 subagent 不请求领域扩展。用户未要求时不写持久 Memory／Knowledge。

## 委派与独立审查

单次 lookup、必要抽查及低成本操作由 General 直接完成。需要隔离时按职责委派：知识综合用 knowledge-scout，机制与候选检查用 generator，Shader、Pass、Resource、Pixel 分析分别用对应 analyst，独立审查用 verifier，报告组织按需用 report-writer。General 负责 live RDC 操作和整合，子级只处理获授材料。每次委派给出问题、scope、已确认事实及来源、竞争解释、相关 Challenge、否定路径的适用与重验条件和输出要求。

计划明确要求的直接工作、隔离分析和独立审查，在所属 Task 的 executionRequirements 中声明 mode 及审查所针对的来源 Task，并由 requiredTaskIds 绑定。requiredSkillIds 只列确需预载的方法，其余方法使用前 skill_read。已批准义务需要变更时，停止并 join 受影响执行，在新 plan_artifact.taskRevisions 中提出同一 Task 的修改；成果版本失效时只重做受影响的来源与审查。

独立审查：

- 创建审查 Task，绑定 profileId=verifier 和独立的来源 Task。来源先结算并提供 resultRef/resultHash。
- Capsule.inputArtifactRefs 授予被审成果，以及它所依赖的原始证据的精确 URI/hash：图像、工具回执、测量、实验各阶段。审查者只能看到被授予的内容，typed 摘要里提到的路径不算授予。按引用数量为读取、写入和收口留足预算。
- General 自己读取 skeptic-review 不等于独立审查。
- 审查指出来源缺失时，把已有的精确引用补给同一审查 Task 继续，不重跑已完成的测量，也不另建同义 Task。
- 逐项处理 Challenge：看它的 targetRef、依赖的主张和阻断条件。某个数值尚无解释资格时，限制使用它的结论，不因此禁止不依赖它的区分实验。Challenge 在最终接受前须有真实补证、范围修订或其他有依据的处理。计划要求 typed Challenge 而审查只返回文字时，由 General 核对目标与来源后用 `investigation_write` 保存；没有质疑不杜撰。
- 交付审查的范围要兑现冻结 Plan 的必要目标，不能只审一个较弱的局部主张就结束整个任务。

## 材料与交付

- 用户给出的区域、参考图和对比条件属于用户描述，可以作为锚点的"用户确认"依据，不是已验证的原因，也不是修改授权。没有参考图或坐标时按 `$pixel-forensics` 自主建立候选并验证；对象或区域确有歧义且现有材料无法判定时，问用户一次，比长时间猜测更好。
- 参考图与 capture 的构图或曝光不一致时，跨图定量比较标为不可比；同一 replay 内事件前后、目标区与控制区的配对仍可进行。
- 画质依实际读到的图像和采样条件判断；看不清的区域读取原图或原生区域数值。引用存在不代表已经看见图像。
- 文件字节审计、语义阅读和独立审查是三件事：hash 相等证明范围，不证明理解。
- 交付写清结论、证据、验证覆盖、仍未知什么、现场是否恢复、是否需要用户决定。General 在获批目标、必要核验、相关 Challenge 与恢复事实闭合后声明 completed；否则如实声明 partial 或 blocked。恢复未确认时不能声明 completed。
