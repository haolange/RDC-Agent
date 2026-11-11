# RDC-Agent 垂直调查能力收敛设计

## 文档状态与使用边界

本文是 Debug、Analysis、Optimize 及其共用知识、执行、模型配置、上下文与恢复能力的设计输入。内容包含已确定的产品要求、架构选择和验收要求；实现和现场证据以仓库当前合同与验收记录为准。

源码核查基线：`36306dbd3d5ca1f6663bcedda43ba6e25a0d0ba4`。文中源码路径均相对仓库根目录，通过文件路径和符号定位；仅使用本文与仓库即可理解需求、核对依据和运行所附复现。接手时先检查当前 HEAD 与工作树，再复核发生变化的部分。

`ARCHITECTURE.md` 与其路由的主题合同是现行权威。本文保留基线调查及目标要求；基线行为只用于解释缺口，不代表当前实现或真实运行验收。

后续设计复审应从用户要完成的调查出发，先用真实请求和结果定位直接障碍及其责任层，再选择最简单、完整且可验证的修复。规则、测试、状态检查和报告服务于结果，不因可能出现某种情形就为其增加固定流程或防御；必要的身份、权限与恢复边界仍然有效。已批准方向的实际进度和失败边界见实施计划与验收账本，不能因文中有设计就推定能力已经成立。

| 状态 | 内容 |
|---|---|
| 已确定 | 产品范围、泛化目标、知识组织原则、完整跨 capture 分析体验、受控恢复边界、模型可配置且由 runtime 保证 |
| 基线核查 | 知识服务、Task／委派／路由／完成检查、压缩、回放身份与受控开闭在上述基线的事实 |
| 已确定设计 | 四个用户入口与八个内部 Agent；Agent 配置模型和推理，Task 冻结执行义务；以目标闭环决定完成 |
| 验收边界 | 实际请求、真实多 capture／Android 行为、独立真值与泛化分别取证，不能以设计或单测替代 |

**有效范围（2026-11-11 复审，对照 `f2f34d98`）：**第 1、3—12、14—15 节的目标、范围边界和架构选择仍然有效，是垂直调查的设计权威。第 2.3 节的基线缺口多数已修复，当前主要缺口见新增的第 2.4 节。执行顺序、完成标准和进度以[收敛计划](../workflows/vertical-investigation-convergence.md)为准，本文不记录进度。

建议阅读顺序：第 1—3 节确定目标；第 4—12 节理解完整设计；第 13—15 节检查实施、验收和已定裁决；第 16—17 节用于源码复核与基线复现。

## 1. 产品目标与明确排除项

### 1.1 目标

在通用 Agent Workbench 上，使三个 Mission 能够对不同问题持续完成有依据的调查：正确获取材料，将知识映射到当前对象，选择有价值的检查，根据结果更新判断，经过适当验证后合理交付。

收敛主线为：

> 用户问题 → 目标与完成条件 → 材料和知识 → 当前对象与竞争解释 → 可区分的检查 → 证据与判断更新 → 独立核验 → 继续、重规划或交付。

流程、知识与 Harness 的目的都是泛化处理各自领域的问题。不得把个别历史案例的答案写进通用 Profile、Skill、Hook、工具分支或完成条件，也不得把两个历史案例通过当作泛化完成。

### 1.2 三种 Mission

| Mission | 核心问题 | 交付内容 |
|---|---|---|
| Debug | 为什么出现异常？ | 触发条件、故障位置、传播机制、竞争解释、区分验证、适用范围和剩余未知 |
| Analysis | 渲染系统怎样工作，或者发生了什么变化？ | 执行与资源结构、关键计算、跨 capture 对应与差异、解释层次和不确定边界 |
| Optimize | 在质量和正确性约束下，哪些成本可以降低？ | 可信基线、限制因素、候选干预、实测收益、质量代价和恢复证据 |

三者共享知识、证据、Context 和生命周期基础，不要求采用相同字段、检索次数、实验数量或固定步骤。Debug 现有方法较具体；Analysis 和 Optimize 必须按自身目标收敛，不能复制 Debug 后改名。

### 1.3 范围边界

三个 Mission 的调查与验证边界是 capture、replay、已授权工具及相关只读材料。允许在批准范围内进行回放侧 Shader replacement、受控干预、测量和恢复。

**修改 Unity／Unreal 工程、构建工程、运行游戏并验证生产修复，不属于这三个 Mission 的交付范围。** 可以分析已授权的相关源码、提出修复位置和建议，但不能自动将 capture 调查扩成工程修改，也不能把 replay 结果称为生产修复已经完成。

通用 General 仍可承担另行提出的普通编码任务；这里限定的是垂直 Mission 的范围，不是撤销整个工作台的编码能力。

其他边界：

- 不修改原始 capture 字节，不复制大型 capture 作为常规工作方式。
- 不自动扩大目标、设备范围、权限或输入集合。
- 不增加独立 Goal 模式、额外顶层 Mission 或第二套调查存储作为默认设计。
- 不为每个专业步骤或 Mission 与专长的笛卡尔积新建 Agent 身份。
- 不恢复 Embedding、Semantic lane、自动 `agent_handoff` 或旧式固定 workflow 阶段。

## 2. 权威关系、现有基础与关键缺口

### 2.1 权威

`ARCHITECTURE.md` 裁决产品与架构；`docs/contracts/` 约束运行、权限、失败和投影；`docs/product/renderdoc-agent-complete-design.md` 说明领域目标；`docs/architecture/rdc-runtime.md` 约束回放；`docs/product/acceptance-ledger.md` 记录已验证范围。

必须区分：文档提出了设计、代码有入口、实际请求加载并使用了能力、真实模型和设备验证了结果。任何一项都不能替代其余三项。

### 2.2 已有能力

- 四个默认用户入口：General、Debugger、Analyzer、Optimizer；八个默认内部 Agent 承担生成、核验、检索、报告及专业分析职责。用户／项目可按现有规则配置或添加 Profile。
- Mission 的澄清、有限只读探测、知识检索、`plan_artifact` 与声明式 handoff。
- General 编排与专业 Agent＋Skill 的领域执行、受约束子上下文、Task、Investigation 与 Session Artifact。
- EffectiveRuntimePlan、RequestPlan、实际模型控制投影、权限交集与 owning lease。
- Task 执行要求、必需 Skill 预载检查、独立上下文和生成版本检查。
- 结构化压缩、原始 journal、带 hash 的来源引用与恢复材料。
- Markdown-first 知识索引、六 lane 查询、编译及知识管理入口。

上述基础应复用，不将现有能力重新包装为待新建模块。

### 2.3 基线的三类缺口

| 类别 | 已确认内容 | 处理方式 |
|---|---|---|
| 确定性语义问题 | 默认文本查询可返回不匹配卡片；共同关联可误报成卡片间冲突 | 在工具负责的一处修正语义，补直接正负验证 |
| 配置与执行义务缺口 | 能选择并冻结子执行模型，但没有将“verifier 职责必须使用用户配置”绑定到 Task 义务 | 复用现有准备和路由，补执行职责与配置约束 |
| 目标与行为连续性缺口 | 局部 Task 完成、审查完成、单回合结束、目标完成没有自动等价关系 | 收敛目标状态、证据覆盖、继续／停止判断和结果整合，并做真实行为评测 |

方法偏置、模型差异、提示词负担、压缩漂移都可能影响表现；当前不能为它们分配已证实的因果权重。设计不能建立在某一未经验证的单因解释上。

### 2.4 当前主要缺口（对照 `f2f34d98` 与真实运行记录）

基线的三类缺口中，知识查询语义与职责模型配置已由实现和真实请求覆盖。真实 Debug 轮次暴露的是另外三项：

| 缺口 | 事实 | 性质 |
|---|---|---|
| 症状锚定 | PC 与 Android 的各轮短症状 Debug 都没有证明候选像素或 draw 就是用户所说的对象；首次异常、解释区分、因果实验和独立核验因此都没有发生。延长执行时间和续审没有越过这一步 | 真实运行记录 |
| 记录不回流 | Checkpoint 的未执行检查只有预算暂停门禁读取；开放 Challenge 只在声明完成时拦截，其后续要求无读者；partial 之后的复评反馈是通用文本，不含具体待做项 | 源码事实 |
| 工具返回削弱取证 | 规划阶段的事件树查询没有分页参数，只读探测输出在固定长度截断且原文不保存；独立审查只校验被审成果已授予，不校验其依赖的原始证据 | 源码事实 |

锚定失败的原因尚无区分性证据，候选包括视觉定位能力、方法只有图像侧路径、工具返回不足、缺少只有用户掌握的事实，以及截图与原生纹理的坐标混淆。过早停止可能部分是锚定缺失的下游表现，同样未证实。

## 3. Planner、Generator、Verifier、Goal 和两种 Loop

### 3.1 分工

| 概念 | 负责什么 | 不负责什么 |
|---|---|---|
| Planner | 澄清目标，决定范围、完成条件、候选方法和计划 | 不在未批准时执行高权限实验 |
| Orchestrator | 保留全局目标，分配工作，整合证据与审查，选择下一步 | 不把局部产物自动升级成目标完成 |
| Generator | 获取材料、形成解释、执行合法实验、产出候选结果 | 不以自己产出的叙事代替独立核验 |
| Verifier | 核对目标覆盖、来源、方法、反例和结论资格，给出具体缺口 | 不私自改目标、扩大权限或把主观偏好升级成新验收标准 |
| Goal | 持续保留目标、完成条件、已完成部分和未决问题 | 不是额外模型，也不是固定阶段控制器 |
| Runtime | 保证身份、权限、配置、消费、取消、引用和状态真实 | 不用关键词规则判断科学结论真伪 |

Planner／Generator／Verifier 是职责，不要求每一种职责对应一个全新的 `.agent.md`。同一基础 Profile 可通过不同 Skill 和冻结执行合同承担不同职责；独立核验仍必须使用独立执行上下文。

### 3.2 与现有 Mission 的关系

Mission 承担规划和正式评估；General 承担获批计划的执行编排。Generator 和 Verifier 是 General 组织的工作，不是新增用户模式。

普通任务仍由 General 按需要完成，不强制每个聊天问题进入完整调查流程。已批准的垂直调查则具有持续目标：完成一个工具轮次或一个局部任务，不应自动结束尚未满足的执行目标。

### 3.3 Goal、Small Loop、Big Loop 是三个不同维度

- **Goal**：要达成什么，怎样知道达到，以及哪些边界不允许越过。计划变化时目标可保持不变；目标变化必须有明确依据。
- **Small Loop**：在批准目标和战略内，补证、区分解释、处理反例、改善测量和核验质量。
- **Big Loop**：当前战略不再成立或继续需要改变范围，保存缺口、重新规划并取得相应批准。

三者不能写成“Goal 调用固定 N 次 Small Loop，失败就自动 Big Loop”。调查方法由 Agent 根据证据决定；运行时只维护真实状态和授权边界。

### 3.4 保留的交接边界

当前合同是：Mission 规划 → 用户批准并点击执行 → General 就地交付 → 用户按需要切回 Mission。Big Loop 由 General 交付 Checkpoint 和重规划理由，用户切回 Mission，再批准新计划。

持续目标不授权自动跨越这个边界。系统可以保持“目标尚未完成、等待计划决定”，但不得暗中切换 Profile、自动批准新计划或重启用户停止的任务。General 执行闭合与 Mission 正式结论分别表达，不虚构自动最终回评。

### 3.5 规划定位与执行定位的区别

“定位”包含不同层次，不能只按同一个词分配职责：

| 层次 | 要解决的问题 | 分工 |
|---|---|---|
| 问题与候选范围 | 哪个对象、哪种异常、哪些 Pass／资源／事件范围可能相关 | Planner 在现有只读能力内做有限探测；能确认的范围带证据交接 |
| 执行入口 | 已有材料是什么，先核对哪个对象，未知 ID 怎样取得，结果如何改变后续选择 | Planner 交付可执行策略，不能只列通用候选原因 |
| 精确对象归属 | 哪个 draw 真正绘制目标区域，使用哪个 shader、资源和绑定 | Generator 继承已确认范围后验证或继续细化 |
| 首次异常与机制 | 异常从哪个实际事件／计算开始，怎样传播，是否由候选机制产生 | Generator 取得证据并做必要区分实验，Verifier 核查 |

当前完整设计明确将 Planning 写为 Triage／Capture Report／Knowledge Retrieval／plan，将 First Bad Event 列入 Execution。`debugger-coordinator` 要求的是定位策略；`debugger-causal-method` 明确用于执行取证。因此 Generator 继续细化定位并不违反现行分工。

但规划也不能只写“之后定位 draw，再分析 shader”。在现有只读能力能安全取得的信息范围内，应先确定问题对象、可观察锚点和候选范围；尚不能定位时说明缺少什么，以及哪一项首批检查能取得它。不能把所有计划前可做工作推迟到执行，也不能为了填出精确 ID 而让 Planner 先完成整场调查。

`rdc_probe` 当前只读查询闭集包含 context／event／pipeline／resource 和受控 VFS；不直接包含 Pixel History 查询或 Shader replacement。不能因某项操作理论上“只读”，就认定 Planner 已具有该工具权限。事件树查询支持按根节点分页、子树、深度和名称过滤，另有按名称、ActionFlags 或事件范围的事件搜索；两者对应的原生操作与原事件树查询同属只读回放查询，不扩大权限类别。探测结果完整返回，体量大时保存为可分页检索的会话制品。若目标设计确需扩大预探测能力，必须显式修改工具与权限合同，不通过提示词偷偷扩权。

交接至少应保留相关材料、身份与来源、已确认范围及其精度、尚未确定的对象、知识机制与当前对象的对应状态、首批区分检查及所需能力。它们优先放在现有 Plan／Task／Investigation 中，不强制新增一套定位 schema。

评估规划是否过早，需看当时可用的只读入口是否实际取得有辨识力的信息、返回是否截断，以及信息能否映射到用户目标；工具存在或未尝试都不足以单独证明规划错误。用户已要求对正常 Planner 入口进行这项核验：本机后续查询到事件、资源、pass／draw 和单 draw 管线，但事件树截断且未证明 draw 与目标对象关联，结果见验收账本。精确对象归属和 First Bad Event 仍由获批后的执行取证完成，不据此增加固定步骤。

Generator 对有效范围进行继承；因身份变化、证据不足或新反证需要重验时说明理由。不能无依据重做规划已经完成的粗定位，也不能把“某阶段之前已异常”误写为已经找到 First Bad Event。

## 4. 目标如何闭环，怎样避免过早停止和无限循环

### 4.1 目标不是一句长期提示词

持久目标至少应能找到以下信息。优先引用现有计划、Task、MissionCheckpoint 和 Investigation，不复制建立第二套事实：

| 内容 | 作用 | 优先复用位置 |
|---|---|---|
| 目标与排除项 | 防止过程中改题或扩大范围 | 冻结 plan、execution offer |
| 完成条件与必需交付 | 判断回答到什么深度 | 计划要求、Task requirements、报告合同 |
| 可信成果 | 不重复已完成工作 | Evidence、Claim、Experiment、Task result |
| 竞争解释及反证 | 保留选择下一步所需信息 | Investigation 与 Checkpoint |
| 有效但未执行的检查 | 防止局部完成后遗失后续 | Task／Challenge／unresolvedFrontier |
| 停止原因与下一条件 | 区分完成、阻塞、待决定与中断 | Checkpoint、completion disposition |
| 授权、设备、版本、消费 | 保证续跑未越界 | 冻结 runtime 与已有账本 |

`MissionCheckpoint` 已有 goal、planVersion、established、rejected、completedExperiments、openChallenges、reasonForReplan、currentWorldStateId、criticalArtifactRefs、unresolvedFrontier。当前这些字段都能写入并校验引用，但运行时只有预算暂停门禁读取 Checkpoint；续跑、复评和压缩都不读它。补的是读者，不是字段。

### 4.2 四种完成不能混用

1. 工具调用成功：取得一个结果。
2. 局部 Task 完成：完成所分配的交付物。
3. 审查完成：核查指定内容，可以返回仍然 open 的问题。
4. 目标达到约定完成条件：必需覆盖完成，相关结论获得足够支持，并按当前交接合同交付。

例如“完成一次亮化实验”可以是局部任务完成，不能自动等同“验证根因”。Verifier 可以完成审查并指出 blocker；这不允许父任务把 blocker 当成已经解决。

### 4.3 建议的继续与收口协议

该协议约束声明与证据，不规定调查顺序：

1. Orchestrator 在得到关键结果、收到审查或准备结束时，对照原目标更新已满足项和剩余项。
2. 存在未满足项时，区分可执行且有价值的下一步、需外部条件的工作、需要重规划的工作。
3. 若存在当前批准范围内的有效下一步，继续 Small Loop；不因已写报告、完成一轮实验或收到审查就结束。
4. 准备宣布执行目标完成时，使用绑定到当前产物版本的核验结果，检查所需覆盖和未决阻断项。
5. 准备 partial 时，说明尚未满足什么、有哪些剩余检查、为什么现在不能或不值得执行；“证据不足”本身不是完整停止理由。
6. Runtime 核验完成声明、必需 Task、审查执行、来源版本、回执和真实中断原因。不能把无工具终答直接提升为目标完成。
7. 若发生允许续跑的普通模型提前终答，可将未满足合同反馈到同一逻辑执行，沿用授权与消费。用户取消、真实额度／期限、安全失败、待用户输入或 Big Loop 待批准不得走自动续跑。

运行时对获批目标的普通提前终答可反馈具体缺口并在同一逻辑执行继续；它不替领域方法判断科学真值。真实模型是否有效利用该反馈仍须单独验收。

评价自主持续执行时，须区分已知设备事实的告知、用户在产品计划门的批准、产品生成的 General 交接，以及外部补充调查方法或反复发送“继续”。后者是人工介入，不能作为自主 Small Loop 的通过证据。应同时核对实际请求、完成声明、Task／目标状态、续跑准入、权限、累计消费与期限；先查明直接原因，不能预设是模型或 runtime 单方面失效。新回合、新 Task 或外部提示都不能作为绕过取消、硬限制、权限拒绝或待批准状态的手段。

### 4.4 Verifier 如何影响下一步

核验结果至少能表达：本次核查范围、读到的证据、已支持部分、未支持部分、反例、资格限制、具体后续检查和是否影响必需完成条件。优先复用 Claim／Challenge／Task result，不为每种结论新增并行报告。

Verifier 不拥有最终目标，也不能随意提高标准。Orchestrator 负责将有效缺口变成可执行工作；认为审查要求不适用时，必须给出依据并保留可审计处理，不能直接忽略必需核验。Runtime 不替任何一方决定科学真值。

独立上下文和不同模型是两个维度。使用同一模型的独立执行可以满足上下文隔离；改用另一模型也不自动意味着审查严谨。严谨程度仍由材料覆盖、可核验结果和错误检出能力证明。

### 4.5 防止无限循环

同时处理机械重复和语义空转：

| 情形 | 应有行为 |
|---|---|
| 相同调用、相同语义结果、相同现场版本 | 复用现有无进展检测与错误处理，不无限重试 |
| 调用不同，但没有新增证据、解释区分或完成项变化 | Orchestrator 说明为何下一步仍有信息价值；必要时对当前未决边界做独立复核 |
| 同一证据版本反复送审 | 复用已完成审查；新审查必须有新增材料、范围变化或明确独立复核理由 |
| Verifier 与 Generator 反复争论同一个缺口 | 查清分歧需要什么证据；无法取得时保留分歧，停止无效重复或请求重规划 |
| 所有有效检查都依赖缺失能力／材料 | 真实 blocked／partial，列出恢复条件，不虚构新步骤保持运行 |
| 目标已满足，还想继续提高质量 | 对照约定范围，非必需改进不阻止完成 |
| 只有记录格式或引用错误 | 修正记录，不强制重跑已经有效的科学实验 |
| 有活跃子执行或设备操作 | 等待实际事件或取消并 join；不能后台仍在变更现场却宣告完成 |

是否存在语义进展需要模型判断，runtime 可核验引用和状态变化，但不能把“新写了一条记录”当作科学进展。不能承诺通过一个分数彻底消除空转。

### 4.6 maxTurns 的位置

业务完成由目标、证据和审查决定，不由固定调查轮数决定。用户未配置总资源限制时，不把内部默认请求次数当作正常任务交回的理由；明确配置的 Profile／policy 上限仍生效。

但这不等于删除所有限制：用户取消、显式预算、deadline、权限、请求超时、资源所有权、进程失效和无进展检测继续有效。若采用执行分段，分段只是运行边界，不重置消费、不提高用户上限，也不自动重放实验。真正硬限制命中不能通过另起回合绕过。

Capsule 的工具数与墙钟预算是可选收紧约束，不得扩大根限制；已有冻结限制不能被静默删除。根执行、子执行、恢复和重新委派继续累计消费。

## 5. 执行职责、Skill、Profile 与用户模型配置

### 5.1 执行合同

`DelegationCapsuleSchema` 选择目标 `profile`、必需 Skill、可选预算和获授权输入，不接受自由模型或推理档位覆盖。子执行准备读取目标 Agent 配置，不继承父 Composer 的单回合覆盖；配置缺失或不可用时明确失败。`TaskExecutionRequirements` 绑定目标 Profile、实际加载的方法、独立性和来源版本；准备与结算分别核验。Settings 改动影响后续准备，不改写在途请求。

### 5.2 Agent 与职责的冻结绑定

Profile 决定身份和能力天花板；Skill 提供专业方法；执行职责说明这次工作承担什么责任；用户配置决定该责任的模型与控制参数。四者分开，再编译进现有 RuntimePlan。

保留四个用户入口，增加 `generator`、`verifier`、`knowledge-scout`、`report-writer`、`shader-analyst`、`pass-analyst`、`resource-analyst`、`pixel-analyst` 八个内部 Agent，分别声明默认 Skill 和工具边界。Planner 继续使用现有 Mission 的配置入口，不预建三种 Mission 乘以全部专长的模型矩阵。

该合同必须覆盖三个 Mission 的正式 workflow 子执行，不只覆盖 verifier：每次执行都能说明适用的职责配置及其来源。职责由声明绑定现有 Profile／Skill，不在内核按 Mission 名称或 Skill 名称硬编码模型。需要单独配置的专业工作可以声明自己的绑定；没有独立要求的工作明确使用已选定的通用职责，不能由父 Agent 临时猜测或静默换路由。

职责绑定至少表达：目标 Profile、必需方法、模型路由与推理控制、独立性要求、允许的能力和配置来源。执行准备保留具体来源与 hash，不靠自由文本解释授权字段。

### 5.3 绑定的运行规则

1. 用户在本机按 Agent 配置模型和推理档位；新增内部 Agent 的初始选择是用户配置，不写死到分发资源。
2. 计划／Task 声明需要独立核验；不能由父 Agent 只写一句“我是 verifier”来替代运行要求。
3. Runtime 在执行准备时解析用户配置并冻结。角色缺配置、配置不可用或能力不匹配时明确报告，不静默换模型。
4. 父 Agent 可请求目标 Profile；Capsule 不提供自由 model／reasoning 参数。显式用户变更须经过新的配置／准备边界并留下来源。
5. 执行前、实际请求和完成回执使用同一冻结事实。至少可追溯 role／Profile、Skill hash、配置来源、provider／model、推理控制、runtime fingerprint 和审查对象版本。
6. 同步与后台子执行使用同一路由与准入；不能一条路径守约而另一条漏检。
7. 执行期间修改 Settings 不改写在途绑定。下一次准备读取新配置；旧审查结果不能伪装成新配置产生。
8. 子级不能通过临时新建普通 Task、换 Skill 名称或省略 role 绕过已经冻结的核验义务。普通非核验任务仍按其原有合同执行。
9. 审查版本失效时只核验受影响部分；已完成且来源未变化的核查无需全部重做。

以上复用现有路由解析器、模型能力目录、RequestPlan 和 Task preparation，不另建独立模型客户端或第二套路由服务。模型厂商选择与审查质量评测分别验收。

### 5.4 内部 Agent 的边界

独立 Profile 提供稳定身份、默认方法与用户配置入口，但文件本身不能证明执行合同成立。允许委派集合、必需任务绑定、准备事实、实际请求和完成检查必须共同约束；专业方法保留在 Skill，不在多个 Profile 复制。

## 6. 知识的组织、检索与渐进读取

### 6.1 维度分开

| 维度 | 表达的问题 |
|---|---|
| Fact／Constraint／Pattern／Procedure／Case／Model | 知识以什么形式表达 |
| 主题 | 讲什么领域内容 |
| 症状 | 外部观察到什么 |
| 机制或结构 | 为什么发生或怎样组成 |
| 任务用途 | 能帮助当前哪项决策 |
| Scope | 在哪些项目、版本、API、GPU、驱动、Pass 和质量条件下成立 |
| 来源与验证状态 | 有哪些证据、反例及资格限制 |

一份原文可以跨 Mission 使用，不复制成 Debug／Analysis／Optimize 三份。失败经验保留失败原因、适用条件和重试条件，不必新增顶层类型。

### 6.2 少量但覆盖主要领域的统一主题

主题采用小型受控词表，允许同义词、多主题和必要的浅层级。以下是建立初始词表的覆盖检查维度，不是已经批准的新 schema 或不可扩展枚举：

- 渲染管线、Pass 与执行依赖。
- 资源格式、生命周期、内存与数据流。
- 几何、顶点输入、蒙皮、坐标与空间变换。
- Shader 计算、数值精度、编译与平台差异。
- 材质、光照、阴影和表面模型。
- 纹理、采样、过滤、UV 与 LOD。
- 透明、混合、深度、模板与光栅状态。
- 时序、抗锯齿、后处理与颜色处理。
- GPU 执行、带宽、缓存、同步与性能测量。
- 回放、设备、驱动、工具能力和取证方法。

少量主题应尽量覆盖主要资料，而不是把所有术语枚举成分类。具体词表由实际卡片验证后定稿；未知或未归类材料仍必须能被检索。

导入／整理时可提出新增、合并或同义映射及代表卡片和影响范围，用户预览并批量确认后写入。调查期间可自由检索和临时组织假设，不自动修改全库分类；Candidate 审核与主题确认是不同操作。

### 6.3 六条检索通道的准确职责

| lane | 应帮助解决的问题 |
|---|---|
| Identity／Path | 精确定位已知卡片或路径 |
| Scope／Metadata | 匹配／过滤明确条件，并区分未知条件 |
| Lexical | 用词项或词组发现相关材料 |
| Structural | 按章节和结构特征定位材料 |
| Relation／Graph | 沿有来源、有种类的关联探索 |
| Temporal／Version | 查看时间／版本条件下的材料和变化 |

六种知识类型、六条检索通道与 Context 层次是不同维度，不互相替代。保持 Markdown-first，不恢复 Embedding。

### 6.4 基线确认的通用查询与编译问题

**不相关文本也能默认命中。** 基线的 `KnowledgeQueryService.scoreLane` 在无相应条件时仍给基础分，合并后可能掩盖真实零命中。

**共同关联被写成相互冲突。** 基线的 `KnowledgeCompileService.compile` 仅因两卡都带 Relation／Graph lane 且标题不同，就创建 `contradicts`。两卡共同 supports 第三卡也会被误判。

这两项由基线源码的纯内存输入复现，见第 17 节；当前实现和直接回归分别约束文本相关性与真实关系。它们不构成某次真实调查失败的已证根因。

### 6.5 工具面合同

- 文字查询与无条件浏览要分清；无条件列举可以返回资料，有文本查询不能靠无关基础分伪造相关命中。
- Lexical 支持归一化、词序变化和可维护词表中的同义表达，同时保留精确词组的区分价值。
- Agent 查询暴露 Scope、asOf、分页和版本条件；截断、preview 与后续读取保持同一内容版本。
- `knowledge_read` 支持简介、章节、行范围和全文，返回读取范围、原文版本及图片引用。
- 图片仍需实际 `read_image` 成功才算观察到；不能以文本提及图片替代读图。
- `knowledge_compile` 是确定性材料编排，不应冒充适用性和机制综合。关系冲突必须有真实依据。
- lane reason 表示各通道的实际贡献；编译包身份纳入内容版本和查询条件。

简介、章节和全文必须来自同一份有版本的原文，避免维护双份知识。来源变化后失效相关派生摘要，不让旧简介误指向新正文。

## 7. 知识怎样改变调查决策

### 7.1 从材料到检查

重要知识应转化成当前问题上的明确工作：

1. 为什么相关，哪些条件已匹配、未知或不符。
2. 描述的是哪条计算、资源链或结构；当前对象如何对应。
3. 若解释成立应观察到什么，若不成立应观察到什么。
4. 哪项低成本、可执行检查最能改变判断。
5. 结果支持、削弱、排除或暂缓哪个方向，依据是什么。

这些是内容要求，不默认全部新增成 schema 字段。优先复用现有 Hypothesis、Claim、Experiment、Challenge 和 Checkpoint。

历史卡处于 draft，说明不能继承其验证资格，不说明它没有提供检查方法的价值。适用条件未知时先核对；条件已经证伪时才据此排除。历史 Event ID、ResourceId 或 Shader ID 不能直接套到当前 capture。

### 7.2 检索何时发生

计划前可从症状、对象和已有条件检索；执行中发现新计算、资源关系或中间异常值后可再次检索。检索次数不固定，停止条件是材料已经足够选择下一项有效检查，或继续检索的价值低于直接取证。

零命中不是失败：继续看其他知识类型，或依据领域知识、用户描述和当前观察提出可检验解释。工具失败与零命中分别报告。

模糊现象应渐进澄清，例如闪烁发生在整个画面还是边缘、镜头静止是否发生、有无正常参考。先检查已有材料，再问真正不可获取的信息；不能要求用户先诊断根因。

### 7.3 Scout 与专业分析

简单精确查询直接完成；复杂多来源检索、适用性比较和冲突综合可委派 Knowledge Scout。Scout 返回来源、cardId＋contentHash、匹配理由、限制和可用检查方法，不仅是长摘要。

Shader 分析子任务处理当前计算理解，Scout 处理材料检索，两者不能混成一个泛泛的“看一下”。父任务须提供具体机制与所需区分的问题，不能只传算法名。

### 7.4 需要防止的通用错误

- 症状相同就直接继承历史原因。
- 识别到同一算法家族，就认为核对了历史材料中的具体计算。
- 干预后画面改善，就认为原机制已证明。
- 以“目前缺动态证据”为由禁止取得该证据所必需的检查。
- 因已有一个方向取得结果，遗失尚未排除的重要替代解释。
- 只统计读过多少知识、调用多少工具，不检查材料有没有改变决策。

这些约束表达通用方法，不包含历史案例答案。

### 7.5 症状级输入也应形成可执行调查

在 capture 已打开、目标对象可通过现有材料识别的条件下，简短的症状描述是正常产品输入。用户不需要预先提供 Event ID、Shader ID、工具操作顺序或根因提示。若对象或期望确有歧义，先检查可安全获取的材料，再问必要且非诱导的问题。

“找到相关对象 → 查看其绑定与计算 → 对照知识机制 → 选择区分检查”应由领域方法自行组织。知识读到后，至少完成三步转换：

- **对应对象**：知识描述哪条计算／关系，当前需要寻找什么特征，哪些条件仍未知。
- **形成预测**：如果适用，什么观测应出现；哪些结果会排除或削弱它。
- **确定行动**：下一项合法且有信息价值的检查是什么，执行所需 ID 和材料怎样取得。

报告中能说出历史案例的名称或机制，只证明线索被识别，不能证明这三步已经发生。相反，因真实工具故障未能完成后续检查，也不能仅凭终答谨慎就断定知识没有被使用。

### 7.6 知识与定位共同推进，不设置循环前提

定位可以帮助判断知识是否适用，知识也可以帮助选择值得定位的对象。不得默认要求“先完成全帧定位和 First Bad Event，再允许读取候选 shader”，也不得因一个历史机制较像就跳过当前对象归属和反证。

若候选机制能导出低成本的绑定／计算特征核对，可以在正式因果结论之前先做，结果反过来缩小事件或资源范围。昂贵或已知受限的精确取证不应成为所有其他合法分析的共同前置；是否采用其他检查必须依据当前工具能力、已有材料和具体问题，而不是假设存在通用 fallback。

这种自适应顺序不降低正式完成门禁：未证明最早异常就保持 First Bad Event 未知；未完成合格实验就不提升因果资格。Unknown 表达结果边界，不自动成为停止获取该结果的理由。

## 8. 三种 Mission 的方法与交付

### 8.1 Debug

从现象和可观察证据开始，定位首次可确认异常、建立竞争解释，追踪触发条件、故障计算／资源与传播路径，选择能区分候选的检查。

反事实干预需要分清修正故障、绕过故障与补偿结果；明显视觉变化不自动具有较强根因解释力。交付包含已支持机制、验证范围、替代解释处理和剩余未知。

正确性与画质验证限定于获批 capture／replay 条件。修复建议可引用相关源码，但不修改外部工程或宣称生产修复完成。

### 8.2 Analysis

Analysis 包含：

- 单 capture 的执行、Pass、资源依赖与组织结构。
- 缺源码、符号或标记时，利用事件、附件、顶点布局、Shader IR／反汇编重建关键计算。
- 用可读 HLSL／GLSL 表达关键计算，并区分可恢复计算与无法恢复的作者命名、源码组织。
- 通过计算与资源关系识别光照、法线、阴影、BRDF 等特征，再推断管线职责。
- 同工程跨时间 capture 的资源数量、尺寸、格式、Shader、绑定、执行路径与画面差异。
- 组合重建与比较，解释新增路径及最早可观察差异。

Observed、Reconstructed、Authoring Hypothesis 继续表示结论依据，不是所有任务必须填满的三个章节。分析深度由用户问题决定，不要求先还原整个引擎。

完成检查按分析目标要求的覆盖判断，并保留每条 Claim 的资格约束；不能为了完成规格差异分析而捏造作者意图。

资源增长不能仅凭两帧证明持续泄漏；无法对齐的对象应保留未匹配与不确定依据，不为了报表完整强行匹配。

### 8.3 Optimize

先定义测量对象、质量约束和可信基线，再提出限制因素、选择干预、复测、恢复并检查质量。

静态指令数、吞吐推测、occupancy、局部 shader 耗时和端到端 GPU 时间分别说明，不能互相替代。减少某项计数不等于已经提高帧率。

正式优化完成需要实际可核验的效果与质量／恢复证据。缺必要设备或测量能力时可以交付有依据的候选及缺口，不能伪装完成优化，也不能为满足形式合同随意挑一个实验。

共享 Analysis 的结构和计算理解能力，但只理解到足以选择和解释当前实验的程度。跨设备、跨场景收益不得由单 capture 实验外推为已验证。

## 9. 单 capture GUI 下的多 capture 分析

### 9.1 目标体验

一个 Analysis 任务接收多个已登记 capture，用户一次说明比较目标。Agent 通过受控工具和 runtime context 顺序取证、保存材料并比较。用户无需先手工做两套报告再拼接。

不要求先建设并排多 capture 编辑器；现有 GUI 可以继续展示当前活动 capture。必要的输入选择、当前身份和进度提示仍须真实，不能后台已切 B、界面仍让用户误以为操作 A。

### 9.2 执行与身份合同

1. 计划记录参与比较的 capture 集合、目标、设备和取证范围。新增未批准输入或换设备按相应授权处理。
2. 每份材料绑定 capture hash、取证身份和适用条件。Event ID／ResourceId 仅在所属 capture 内解释。
3. Live RDC 继续串行；切换前确认相关子执行结束、替换／实验正确关闭、当前资源可释放。
4. 通过应用受控生命周期切换，禁止模型直接用底层 CLI 改全局 context 或借用其他 session 的 lease。
5. capture／lease 改变会使冻结 binding 失效，必须重新准备。逻辑任务与调查进度继续，旧准备事实不能直接沿用。
6. 取证完成后可离线并行比较已授权产物，不共享 live lease。
7. 比较采用多种特征建立对应：执行位置、资源结构、计算特征、用途和来源；记录匹配依据与歧义，不能只靠同名或同 ID。
8. 结束时说明当前打开哪份 capture、哪些现场操作已恢复；切换或恢复失败时不伪造初始现场已恢复。

采用同一 owning session 顺序切换，不恢复跨 session 共享上下文。

### 9.3 实现与验收边界

`rdc_probe` 的受控选择、恢复与重准备使用批准计划内的已登记输入及设备；不能指定任意路径或默默改为 Local。身份、进程和恢复回执必须逐项核验。真实多 capture 自动取证、Android 和失败恢复分别需要运行证据，定向测试不能替代。

多 capture 切换与故障恢复应复用同一受控生命周期和重新准备能力，分别保留各自的授权理由。

## 10. Context、委派和压缩的语义连续性

Context 的身份、目标、Task、工作状态、按需知识和原始证据是内容组织层次，不是六套存储。复用 PromptPlan、Capsule、Task、Investigation 和 Artifact。

### 10.1 委派内容

委派应明确当前问题、所需判断、必要事实与证据资格、具体机制、竞争解释、反例和有条件的负路径、输入引用、必需 Skill、真实执行限制和交付要求。

当前 Capsule 已具备多数相关字段；需要检查是否正确填写和消费，不把字段存在当作保真证明。对子任务隐藏无关历史，但不能隐藏完成工作必需的机制依据。

Verifier 使用干净上下文，读取源证据和必要约束，不继承 Generator 的长叙事或 live lease。父任务保留全局目标并负责结果整合，不能把“已委派”当作“问题已处理”。

### 10.2 压缩后必须能找回

- 原目标、排除项、完成条件和批准计划。
- 当前候选解释及其具体机制、适用条件。
- 已完成工作和原始来源。
- 已排除方向、真实反证和重查条件。
- 尚未执行的有效检查及优先理由。
- 当前实验、设备和恢复状态。
- 真实停止限制、配置绑定和剩余决策。

不得把未知压缩成否定、把暂缓变成永久排除、把局部完成写成目标完成。不能对已经失真的摘要反复压缩而不回到源证据。

### 10.3 现有机制与验证

`StructuredHandoffBuilder` 已要求保留事实／假设、来源和重查条件；`CompactionAuthoritySource` 保存可回查的 journal、Task、执行和产物身份。它们不自动证明摘要语义正确。

验证要观察委派／压缩前后仍有哪些合法下一步、候选为何保留或排除、缺失信息是否能沿引用回读。全文落盘、hash 正确、曾经调用 read，都不能单独证明模型理解并持续使用材料。

## 11. 回放故障与调查续跑

### 11.1 允许自主恢复的范围

同一已登记 capture、同一已批准设备、原目标和权限范围内，允许 Agent 请求受控恢复。主进程负责旧执行退出和新身份核验，重新准备后继续调查。

换设备、扩大权限、改变目标或需要新的外部条件时找用户。用户主动停止的任务不得自动重启；整个应用重启后由用户触发续跑，沿用历史消费与期限。

### 11.2 环境恢复与进度恢复分开

| 责任方 | 责任 |
|---|---|
| 主进程 | 分类失败、必要隔离、取消并 join 自有执行、关闭 context 与 daemon、进程回执、重新打开、核验身份 |
| Orchestrator | 读取状态与进度，判断材料可用性、必要重验和下一检查 |
| Verifier | 对需要核验的成果和受影响依赖做评估，不凭重开成功补认旧实验完整 |
| 用户 | 决定新的设备、权限、目标和战略；提供不可获取的外部输入 |

归属 daemon 先释放 context 再 stop；context clear 不代表进程已退出。禁止通过通用 setContext 写回旧 ID，禁止恢复中偷偷切 Local 代替原 Android。

### 11.3 证据恢复规则

| 内容 | 处理 |
|---|---|
| 有来源的截图、IR、资源表、完整实验 | 条件仍成立时继续作为历史事实使用，不一律重做 |
| 当前事件、连接、替换、能力和测量条件 | 在新现场重新核验 |
| 未返回可靠结果的步骤 | 保持未知，按需要补做 |
| 中断实验的已保存阶段 | 保留历史事实，不拼接新现场生成完整旧实验 |
| 重开后仍要验证原假设 | 在新现场建立必要基线并完成新的可核验实验链 |
| 已完成 Task | 保留完成历史；必要补证使用正确依赖和执行实例，不重建同义任务清消费 |

只补受影响依赖链。相同 capture hash 只说明文件相同，不说明设备、事件、replacement、驱动或性能条件相同。

### 11.4 运行故障不自动等于战略失败

将三种情况分开：一次查询失败、现场被隔离、原战略已无可行取证路径。前两者并不自动证明第三者。

现场被隔离后停止依赖 live replay 的操作是正确行为。检查已保存的 IR、资源表、图像和知识是否仍足以完成有价值的离线工作；没有可用材料或离线工作不能推进目标时，诚实等待恢复，不为保持运行制造无效任务。

同 capture／同设备的恢复如果只改变现场身份、不改变批准目标与战略，应在新准备后继续原计划。不能默认要求用户重新描述症状、重新规划或切回 Mission。只有恢复暴露出需要改变设备、权限、输入范围或战略的缺口时，才进入相应用户决定或 Big Loop。

语义早停与现场阻塞分别诊断。不能用“目标未完成”推断所有停止都错误，也不能用“发生故障”掩盖故障前长期没有把知识转成有效行动的问题。

## 12. 报告、停止与用户体验

### 12.1 可见进度

Progress 显示目标相关工作与实际执行状态；Artifacts／Outputs 引用真实成果；Context 显示与当前执行有关的材料和限制；Capture 显示真实活动身份。

不新增独立 Goal 开关，不把方法阶段伪装成模型内部思维。可展示简短的当前判断、依据、下一步和阻塞，不收集或展示隐藏推理链。

### 12.2 交付内容

按 Mission 目标组织：回答了什么、证据是什么、验证覆盖、仍未知什么、哪些结果只能说明局部效果、现场是否恢复、是否需要新的用户决定。

保留 completed、partial、blocked、cancelled 和预算中断的语义区别。预算耗尽不是完成；审查不可用不是通过；设备不支持不是已呈现；没有陌生材料不是泛化已验证。

正式报告与 General 执行交付保持现有职责分离。报告生成只能消费具有相应资格的成果，不在写作阶段把未验证建议升级成结论。

### 12.3 审查的使用频率

所有必需核验按计划合同执行。额外复核重点放在影响主导解释、目标完成声明或无阻塞却准备提前结束的节点，不要求每次工具调用都启动 verifier。

对同一来源版本避免重复审查；仅因记录修订不要求新实验。审查者的局部额度不足，只能说明该审查的限制，不自动证明整个调查无法继续。

## 13. 泛化目标与现有材料下的验收

### 13.1 不学习固定答案

历史案例应作为有适用条件的知识材料和回归输入。通用方法不得包含案例专用参数、固定原因、固定实验顺序或答案匹配条件。知识库提供可检验解释和方法，不替 Agent 直接宣布当前原因。

现有三个真实 capture，其中两个在 Knowledge 里有对应的历史案例卡，在它们上面的结果属于知识迁移，不是陌生问题泛化。用户可封存已知根因用于事后评分、在隔离副本移除案例卡做盲测，并提供未用于调整规则的新 capture；这些尚未执行。材料有限会限制泛化实测的结论强度，不改变产品必须泛化的目标，也不阻止完成通用能力改进。

### 13.2 可以立即验证的内容

- 查询精确命中、真实零命中、分页／截断、Scope、版本和关系种类。
- 同症状多机制、不同症状同机制、过时或冲突知识、零命中的推理材料 fixture。
- 有效区分实验与只改善表象的实验，合理停止与错误早停，真阻塞与仍有替代检查。
- 委派和压缩前后目标、反例、下一步的保真。
- Task 完成、核验完成和目标完成分离。
- 用户职责模型配置确实进入同步／后台实际 RequestPlan；错误覆盖和不可用模型被拒绝。
- 停止、重启、续跑、版本变化与消费保留。
- 跨 capture 身份、对应关系与恢复回执的确定性负向测试。

合成材料可以验证机制和边界，但不冒充陌生真实工程的调查成功率。仅重命名对象不构成新的问题家族。

### 13.3 后续真实材料的评测维度

代表情形包括：无历史命中的闪烁；相似知识但条件不适用；同症状不同原因；不同症状相同机制；缺标记的计算重建；跨时间资源变化；质量受约束的性能实验；工具失败但仍有合法替代；长上下文；实验中断；确实应该停止的任务。

无需每个维度机械制造一个 capture。选择应有行为不同的代表情况，并将开发材料与未参与规则调整的保留材料分开。保留材料的真值不进入运行 Prompt 或通用知识；若任务本来允许检索历史答案，应单独归为知识迁移组。

### 13.4 固定条件和结果分类

记录实际模型、推理档位、路由控制、角色配置、Profile／Skill／Hook hash、知识版本、权限、工具版本、capture、设备／驱动、资源限制与人工介入。

结果分为自主完成、经提示完成、合理未完成、错误结论、过早停止和无效长跑。不能混成一个“最终通过率”。

评估重点：知识有没有改变下一步，实验是否区分解释，反证是否处理，原目标是否保留，核验配置是否真实生效，停止是否有依据，恢复是否保留可信成果并补齐必要证据。

时间、请求、token／可得费用、设备占用和人工介入同时记录。用户未指定硬上限时，不编造计划阶段配额；成本指标用于比较和调优，不能擅自降低交付要求。

### 13.5 验收层次

| 层次 | 完成标准 |
|---|---|
| 合同与确定性实现 | 正负路径、身份、路由、来源、状态和消费一致 |
| 方法与 Context | 实际输入和关键决策内容可追溯，压缩／委派未改变资格 |
| 真实模型行为 | 不靠答案硬编码，正确使用材料并合理继续／停止 |
| 真实回放设备 | 实验、质量、恢复和设备效果有实际回执 |
| 泛化评估 | 未参与规则调整的代表真实材料上取得可复查结果 |

没有对应证据的层级保持未验证。不得用 build、schema 合法、报告 ready 或 mock 成功替代真实运行。

### 13.6 短 Prompt 与方法提示的对照验收

将“用户是否必须补写调查方法”作为明确的产品验收维度。对同一问题，区分以下输入提供了什么：

| 输入类型 | 新增内容 | 如何解释差异 |
|---|---|---|
| 症状级请求 | 对象、异常表现、调查目标 | 代表正常自主调查入口 |
| 方法提示 | 定位相关对象、检查 shader／数据流等一般步骤，不提供新事实 | 若表现明显改善，提示方法自主组织与执行存在缺口；不能只要求用户以后写长 Prompt |
| 事实补充 | 已确认事件、目标区域、正常参考、独立实验结果 | 信息条件发生变化，不能直接当作方法提示的收益 |
| 原因或答案提示 | 明确根因、修复代码或预期参数 | 仅能检验执行与验证能力，不证明自主诊断 |

对照固定 capture、知识版本、模型与推理控制、实际预载、权限和工具条件；分别从干净且等价的回放状态开始，避免上次替换、上下文或结果泄漏。工具崩溃、断连及恢复不同的运行单独标记，不能把它们计为纯粹的 Prompt 效果。

观察链条为：规划是否取得合理范围 → 是否把知识转为当前对象的检查 → 交接是否保留依据 → 执行是否沿范围继续 → 是否因新证据改变下一步 → 停止原因是否真实。不要仅按最终答复的谨慎程度判断质量，也不要求不同输入逐步调用完全一致。

没有更多真实 capture 时仍可在已有材料上做该对照，判断方法提示依赖；这不等于已取得跨问题家族泛化成功率。规则只能修正通用方法和合同，不能吸收案例答案。

## 14. 收敛范围与实施约束

### 14.1 按责任划分四层

第一性 primitive 指职责最小、可组合、有明确输入／输出、权限、生命周期和失败语义的能力，不等于把每个领域步骤包装成通用接口。已有 primitive 能表达的内容应补齐调用链，不另起框架。

| 层 | 负责内容 | 不能承担的内容 |
|---|---|---|
| 通用 Harness 内核 | 执行准备、授权、所有权、取消、消费、隔离委派、合同准入、真实终态与续跑 | 不知道头发、shader、First Bad Event，也不按 Mission 写固定调查顺序 |
| 可复用平台服务 | Knowledge 查询／读取／编译、Artifact、模型目录与路由配置、PromptPlan、Hook 执行基础设施 | 服务存在不等于每个任务必须使用；不把知识查询和审查固定为所有回合的步骤 |
| 领域确定性合同与能力适配 | RDC capture／replay／设备生命周期、身份和回执；Investigation schema、资格与报告约束 | 不靠提示词替代校验，也不把领域字段加入通用 TaskStore 或 AgentLoop |
| 垂直方法组合 | `.agent.md`、Skill、声明配置、适用的 Hook 与知识共同组织规划、生成、核验、Small／Big Loop | 不自行授予工具、修改冻结配置、伪造证据或用脚本绕过生命周期 |

Renderer／preload 是这些事实的操作与投影边界：显示真实配置、目标状态、当前 capture 和缺口，不新增另一套调度或领域真值。

### 14.2 通用 primitive 的补全清单

下列是已有能力的补全责任，不是要求新建六个服务、六个注册表或六套存储。

| primitive | 应表达的最小合同 | 现有复用点 | 本次需要补全的边界 |
|---|---|---|---|
| 目标／交付合同与终态准入 | 当前目标引用、必需交付与依赖、完成／部分／阻塞／取消的声明和依据 | 冻结 plan／offer、Task requirements、TurnCompletionValidator、AgentTurnRunner | 单回合结束不自动等于目标完成；必需核验和当前版本未满足时不能伪装完成。领域目标的含义由方法和领域验证器提供 |
| 执行请求准备与配置绑定 | 配置来源、Profile、必需 Skill、模型及控制、工具能力、权限和 fingerprint | EffectiveRuntimePlan、RequestPlan、ProfileTurnPreparation、路由解析器 | 已声明职责必须采用用户配置，父 Agent 的自由参数不能覆盖冻结要求；同步与后台一致，不硬编码 verifier 厂商或三 Mission 名称 |
| 隔离委派与依赖核验 | 独立上下文、输入授予、输出归属、源执行版本、依赖是否仍有效 | Capsule、TaskExecutionRequirements、independentOfTaskIds、SubagentRunner | 让当前生成版本对应的核验成为可检查的执行义务；不把“存在一段审查文本”当作有效核验，也不要求所有任务都独审 |
| 可恢复来源与上下文组装 | URI／hash、可读范围、版本、完整原件和有界投影、恢复条件 | Session Artifact、PromptPlan、StructuredHandoff、CompactionAuthoritySource | 领域提供当前相关状态与引用；通用压缩保留来源和边界，不自行推断 Hypothesis 或丢弃未决检查 |
| 继续／结束／等待的生命周期 | 逻辑工作身份、合法续跑条件、失败原因、等待事件、旧执行撤销与新准备 | AgentLoop、TurnCoordinator、Task execution／generation、failure-model | 支持获授权目标的继续判断与真实中断，不能靠外部 stop Hook 无条件再发“继续”；取消、硬限制和待批准状态禁止自动复活 |
| 自有资源、取消与消费 | owner、代次、可用性、取消并 join、已观察停止、累计消费与期限 | 现有调度、Task root／child 账本、进程监督和资源准入 | 续跑、审查、重准备不能清消费或借旧授权；资源失效向调用者报告。具体关闭／打开 RDC 的动作仍由领域生命周期实现 |

已有合同已经覆盖的部分应保留并接通，不能重新实现。例如 Task 已有必需 Skill 与独立性校验，本次补的是职责模型约束与完成依赖的使用，不是重新制造“独立审查系统”。

目标内容可以是开放的领域文本，引用和执行义务必须可核验。Runtime 不能仅靠自由文本判断目标是否科学成立，也不能因为全部字段非空就认定任务成功。目标完成判断由 Orchestrator／Verifier 提供，主进程核验声明所依赖的可确定事实。

### 14.3 可复用服务与领域代码各自补什么

| 能力 | 代码归属 | 要做的变化 | 保持在方法层的决定 |
|---|---|---|---|
| 准确查询与关系编译 | `src/main/knowledge/` 及共享知识类型／工具 | 修正不相关基础分、虚构冲突；接通必要过滤、分页、版本和渐进读取 | 用什么查询、如何放宽条件、何时重新检索、材料是否适用 |
| 正式主题维护 | 既有 Knowledge 数据与管理入口 | 提议／确认的真实状态、来源和写入边界；具体 schema 按已确定方案实施 | 主题是否有区分价值、同义与层级建议；内容需用户确认 |
| 模型职责配置 | 现有 Settings／Profile／route／prepare 链 | 配置与执行义务一致，投影实际生效值；不可用时明确失败 | 哪项工作需要独立核验，选哪本方法 Skill；不由模型改用户绑定 |
| 调查记录资格 | `src/main/investigation/`、调查共享类型 | 引用、状态、证据资格、实验关闭与报告要求 | 什么机制值得查、证据实际支持多强结论、目标需要哪些分析层 |
| 多 capture 与恢复 | `src/main/rdc/`、RDC 工具适配与准备边界 | 批准输入／设备、串行切换、lease 身份、旧执行结束、新准备和真实回执 | 采集顺序、对应关系、差异解释、恢复后最少补什么 |

领域的确定性约束必须用代码实现。例如“原实验恢复回执不能由新现场补造”是 RDC／Investigation 合同，不是普通 Skill 建议，也不是通用内核按实验字段写死的规则。

### 14.4 `.agent.md`、Skill、Hook、Knowledge 的分工

| 承载 | 应放内容 | 不应放内容 |
|---|---|---|
| `.agent.md` | 稳定身份、职责范围、工具／权限天花板、允许委派、声明 handoff、确需的根 Skill 和完成合同 | 每个案例的解法、冗长工具手册、运行中进度；不为每项技能复制一个官方身份 |
| Skill | 如何从症状形成可检验问题，怎样定位、分析、实验、审查和解释结果；渐进读取详细手册 | 永久用户模型配置、不可绕过的权限与身份校验；普通方法不全部改为强制预载 |
| 声明的执行要求 | Task 所需方法、独立性、适用职责配置、输出与版本依赖 | 自由文本扩权、父 Agent 临时重写用户模型或消费上限 |
| Hook | 在明确生命周期点执行已受信的检查、提醒或审计；通过已有 block／warn 合同反馈 | 自建循环引擎、自动批准 Big Loop、隐式扩大权限；不能成为核心不变量的唯一防线 |
| Knowledge | 可复用事实、机制、案例、方法、反例及适用域 | 当前 Task 的真实执行状态、授权依据、把历史结论强制套给新 capture |
| Plan／Task／Investigation／Checkpoint | 当前目标、已知范围、首批检查、交付依赖、证据、未决方向和续跑状态 | 第二套模型路由、全局知识分类、无来源的完成标记 |

当前 Hook 是带 event、command、timeout、failurePolicy 和信任状态的执行机制。判断某项校验放在哪里时，应先看失效后果：关闭 Hook、修改 Skill 或用户自定义 Profile 以后仍必须成立的权限、身份、消费和来源约束，必须保留在权威服务及执行边界。Hook 可以调用同一校验能力做提前反馈，不另写一份逐渐漂移的规则。

科学语义核验仍是有输入、权限、成本、来源版本和结果的子执行。Hook 不应偷偷启动一个不记账、不可取消的“隐藏 verifier”。如确有事件触发核验需求，也必须通过正常 Task／prepare／执行链，并显式声明触发和停止条件。

### 14.5 全部改进项的落点

| 需求／问题 | 通用能力或服务补全 | 垂直合同与方法组合 |
|---|---|---|
| 短症状 Prompt 也能自主调查 | 提供真实可用工具、可读材料、准备和记录能力；不解析症状决定工具序列 | Coordinator 澄清并有限定位，方法把知识变成对象映射、预测和检查 |
| Planner 与 Generator 定位不脱节 | 冻结输入／计划，保证引用和范围可交接 | Plan 记录已确认范围与精度；Generator 继承后细化；First Bad Event 资格由领域合同检查 |
| 知识读到却未用于决策 | 查询准确性、渐进读取、版本与委派来源 | Scout／Generator 说明机制对应和最小区分检查；Verifier 核对覆盖和反例 |
| verifier 必须遵守用户模型配置 | 职责绑定、路由准备、真实请求与完成证明 | 哪些任务必须核验、核验什么内容由领域计划与方法决定 |
| Goal 持续推进 | 保留目标身份、执行依赖、终态／续跑边界和消费 | 判断剩余检查是否有效，如何处理挑战及何时提出重规划 |
| 防早停与防无限循环 | 拦截缺失必需执行事实；机械重复、取消、超时和硬限制守约 | 识别语义无进展、边际价值、真实阻塞；不能通过新建同义任务骗过限制 |
| Small／Big Loop | 提供重用 Task、版本依赖、取消、重新准备及批准交接 | 是否局部补证或战略改变，由 Orchestrator／Mission 根据证据判断；不固定轮数和阶段 |
| 压缩后不丢调查方向 | 源材料可回读、投影完整性、模型摘要来源保真 | 领域选择目标、候选、反证、尚可执行检查与当前现场状态 |
| 多 capture 与崩溃恢复 | 通用 owner／generation／join／prepare 与累计账本 | RDC 实现切换、设备和恢复回执；方法决定对齐方式与恢复后的必要工作 |
| Analysis 与 Optimize 泛化 | 相同基础执行能力和服务 | 分别组合结构重建／比较方法、测量／质量实验方法及相应资格检查 |

同一需求跨层是正常的，但每层只承担其事实。例如 verifier 模型问题需要设置、准备与 UI 联动；不代表应将“是否存在局部光解包误差”也写进 runtime。

### 14.6 以一次调查检查分层是否成立

1. 用户只描述异常，Debugger 的 Profile／Coordinator 确定职责并组织有限探测；Harness 不识别具体症状。
2. Knowledge 服务返回准确可读材料；方法选择相关机制，映射当前对象并设计首批检查。
3. 计划批准后，Harness 冻结范围和执行要求；General 组织 Generator 工作，RDC 适配层保证每次现场操作的身份与权限。
4. 需要核验时，方法声明任务和输入，Harness 按用户绑定准备独立执行，Verifier Skill 指导证据审查，领域服务校验合法记录。
5. 结果指出缺口，Orchestrator 判断可继续的检查；Harness 保持真实依赖、版本和消费，不能把核验调用结束当作目标结束。
6. 若回放失效，领域生命周期隔离和恢复，Harness 处理取消／join／新准备；方法从 Checkpoint 判断哪些成果可用、哪些需要重验。
7. 达到完成条件后，方法给出结论，主进程核验所需执行与领域合同，按原交接职责交付；若需要 Big Loop，等待用户的计划决定。

该链可用别的领域工具和方法替换 RDC 部分，而无需修改通用 AgentLoop 才能运行。是否达到这种可替换性由依赖和接口验证，不要求为证明抽象额外实现第二个产品。

### 14.7 实施审查的边界检查

- 通用文件新增了 Debugger／Analyzer／Optimizer 身份分支、具体算法／症状或固定工具顺序，应检查是否把领域方法误放入内核。
- Skill／Hook 写了“保证模型一定如此、保证恢复成功、保证证据有效”，却没有权威执行事实与服务检查，应检查是否用文字代替 runtime。
- 新 primitive 只服务一个具体步骤，现有 Task／prepare／artifact 已可表达，应优先复用而非增加抽象。
- 不同专业方法需要同一种独立执行、配置冻结或版本失效能力时，补共用机制，领域只声明参数和依赖。
- 不把所有方法变成硬前置。只有权限、完整性和已声明必需执行要求由 runtime 强制；调查顺序与科学判断保持可调整。
- 安全与完整性检查在输入准入、实际使用和完成处可以有不同职责，但同一事实的实现保持单一权威，不复制多份规则。
- 验证分别覆盖通用合同、领域不变量和真实模型方法行为。只做其中一类不构成整条链路交付。

### 14.8 交付单元与工程约束

以下是后续计划必须覆盖的交付单元及依赖，不是已经批准的实施顺序：

| 单元 | 必须改通的链路 | 不能只交付什么 |
|---|---|---|
| 知识准确性与可读性 | 原文／索引 → 查询／编译 → Agent 工具返回 → 方法使用 | 只改提示词或仅修 UI 文案 |
| 目标闭环 | 冻结目标 → Task／调查 → 核验 → 继续／终态 → UI 和恢复 | 只追加“不要停止”或无限自动重试 |
| 职责模型合同 | 用户配置 → Task 义务 → 准备／路由 → 实际请求 → 核验回执 | 只增加 `.agent.md` 或 Skill 中写模型名称 |
| 方法与上下文 | 三种 Mission → 委派内容 → 压缩 → 后续决策 | 只验证字段存在或文件落盘 |
| 多 capture 与恢复 | 批准输入／设备 → 受控生命周期 → 新准备 → 身份化证据 → 续跑 | 仅让模型调用底层 context 切换 |
| 验收 | 确定性合同 → 方法 fixture → 实际模型 → 可得设备材料 | 将两个案例的成功当作泛化完成 |

`runtime-kernel.md` 与产品文档须持续保持 General Small Loop、手动 Big Loop、预算和 Agent 配置边界一致，不能恢复已撤回路径。

实现必须复用现有存储、路由、准备和生命周期，不增加无依据 fallback、双写双读或长期新旧并行路径。schema／配置变化须先明确对现有记录的处理；不能静默迁移用户数据。根目录不新增临时规则或报告堆叠。

变更涉及 main／shared／preload／renderer 时完整串联。按仓库验证矩阵执行受影响单测、typecheck、lint、对应 check；跨层变更补 coverage、ratchet、gates 和 build。运行时行为与设备验收独立结算。未经明确授权不提交、推送或发布。

## 15. 已确定的架构选择

### A. 执行职责的承载

保留四个默认用户入口，增加八个默认内部 Agent。每个 Agent 通过现有设置配置模型和推理；Task 和 runtime 冻结并核验目标 Profile、方法、独立性与成果版本。Verifier 的执行义务不能由父模型临时覆盖。八个内部 Agent 的初始模型选择写入用户配置，不硬编码在分发资源。

### B. 默认请求上限与持续执行

垂直调查不以固定默认总轮数正常收口，使用目标与核验闭环决定继续和完成；保留用户显式限制及技术安全边界。执行分段、恢复和重新委派必须保存逻辑目标、消费和授权，不绕过真实上限。

其余产品要求已经明确：外部工程修改不在范围内；多 capture 完整体验通过工具与受控 context 实现；同 capture／同设备受控恢复可自主请求；换设备、权限或目标找用户；正式主题由 Agent 提建议并由用户批量确认；泛化材料见第 13.1 节。

## 16. 源码核对索引

所有路径相对仓库根。符号比行号更适合跨提交复核。

| 主题 | 文件与重点 |
|---|---|
| 产品／身份／交接 | `ARCHITECTURE.md`：Product Boundary、EffectiveRuntimePlan、声明式 handoff、裁决 I／J |
| 运行与完成 | `docs/contracts/runtime-kernel.md`；`docs/contracts/failure-model.md` |
| 领域目标 | `docs/product/renderdoc-agent-complete-design.md`：Knowledge、Context、Small／Big Loop、三 Mission、Scout／Skeptic |
| 已验范围 | `docs/product/acceptance-ledger.md`：按相关章节检查适用条件，不依赖本机私人会话 |
| Profile | `resources/agent-runtime/agents/*.agent.md`：四个默认用户入口及八个内部 Agent |
| 方法 | `resources/agent-runtime/skills/renderdoc-execution/SKILL.md`、`execution-orchestrator/SKILL.md`、`skeptic-review/SKILL.md`、`knowledge-scout/SKILL.md` |
| 三 Mission 方法 | `resources/agent-runtime/skills/debugger-causal-method/SKILL.md`、`analyzer-architecture-method/SKILL.md`、`optimization-experiment/SKILL.md`、`cross-capture-alignment/SKILL.md` |
| 查询与编译 | `src/main/knowledge/KnowledgeQueryService.ts`：query／scoreLane；`KnowledgeCompileService.ts`：compile |
| 知识工具与索引 | `src/main/knowledge/KnowledgeTools.ts`：toQueryRequest／createKnowledgeSearchTool／createKnowledgeReadTool；`KnowledgeIndexService.ts`；`knowledgeServices.test.ts` |
| 委派输入 | `src/shared/types/delegationCapsule.ts`：DelegationCapsuleSchema／JSON schema |
| 委派路由 | `src/main/agent-runtime/orchestration/SubagentRunner.ts`：runSubagent；`BackgroundSubagentService.ts` |
| 执行准备 | `src/main/agent-runtime/orchestration/ProfileTurnPreparation.ts`：prepare；`AgentOrchestrator.ts`：模型路由解析；`TurnPreparationService.ts` |
| Task 义务与证明 | `src/shared/types/taskExecution.ts`；`src/main/agent-runtime/tasks/TaskExecutionRequirements.ts`；`TaskRegistry.ts` |
| 模型与路由 | `src/main/settings/provider-catalog/EffectiveModelResolver.ts`；`src/shared/types/providerCapability.ts`；`src/shared/types/rdcRuntime.ts` |
| 循环与终态 | `src/main/agent-runtime/agent/AgentLoop.ts`；`LoopProgressGuard.ts`；`TurnCompletionValidator.ts` |
| 回合完成 | `src/main/agent-runtime/orchestration/RuntimeToolAssembly.ts`；`AgentTurnRunner.ts`；`src/main/investigation/missionCompletionContract.ts` |
| 调查记录 | `src/shared/types/renderdocInvestigation.ts`：MissionCheckpoint 等；`src/main/investigation/investigationInvariants.ts` |
| 压缩／Capsule | `src/main/agent-runtime/context/StructuredHandoffBuilder.ts`；`src/main/sessions/store/CompactionAuthoritySource.ts`；`src/main/agent-runtime/prompt/DelegationCapsuleCompiler.ts` |
| 回放合同 | `docs/architecture/rdc-runtime.md`；`src/main/rdc/RdcTurnBindings.ts`；`RdcProbeLifecycle.ts` |
| 工具与生命周期 | `src/main/agent-runtime/orchestration/RdcProbeTool.ts`；`src/shared/constants/agentToolTokens.ts` |
| 规划探测能力闭集 | `src/shared/constants/rdcProbe.ts`：RDC_PROBE_READONLY_CLI_ACTIONS；`resources/agent-runtime/skills/debugger-coordinator/SKILL.md`：定位策略与预探测职责 |
| 现有模型相关测试 | `src/main/agent-runtime/orchestration/SubagentRunner.test.ts`、`BackgroundSubagentProviderFixture.test.ts`、`ProfileTurnPreparation.ts` 对应调用测试 |
| 现有独立执行测试 | `src/main/agent-runtime/tasks/TaskExecutionRequirements.test.ts` |

## 17. 知识问题的自包含最小复现

### 17.1 输入和结果

使用真实 Query／Compile 类，索引替换为内存两张卡：

| 卡片 | lexical | 初始关系 |
|---|---|---|
| user:a／Texture sampling | texture sampling | 空 |
| user:b／Mesh index | mesh index | 空 |

两卡均为 user space、fact、draft、Vulkan scope，updatedAt=1，具有独立路径和 contentHash。

已观察结果：

- 默认查询 `zzzz_absent_mechanism_91827` 返回两条、各 3 分，来自 Identity／Path、Scope／Metadata、Temporal／Version。
- 同查询仅使用 Lexical 时返回零条。
- Lexical 查询 `sampling texture` 返回零条，说明整串匹配的限制。
- 两卡各增加 supports→user:shared，按该 target 查询 Relation／Graph 后 compile，出现 a 与 b 的 `contradicts`。

这只证明函数在给定输入下的行为，不代表完整索引、Electron、模型或设备验收。没有使用或修改真实知识。

### 17.2 可复现脚本

在上述基线仓库根运行，使用已有 Node 与 TypeScript 依赖；通过 stdin 执行即可，无需将脚本加入仓库。脚本不写文件、不访问用户知识、不启动应用。

```javascript
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
function load(file, stubs) {
  const m = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(js, {
    exports: m.exports, module: m, console, Buffer,
    require: id => {
      if (id.startsWith('node:')) return require(id);
      if (id in stubs) return stubs[id];
      throw Error('Unexpected import: ' + id);
    },
  }, { filename: file });
  return m.exports;
}
const lanes = ['Identity/Path', 'Scope/Metadata', 'Lexical',
  'Structural', 'Relation/Graph', 'Temporal/Version'];
const { KnowledgeQueryService } = load(
  'src/main/knowledge/KnowledgeQueryService.ts', {
    '../runtime/AppPathService': {},
    '../sessions/store/StorageAdapter': {},
    './knowledgeCardSchema': {}, './knowledgeFs': {},
    './KnowledgeIndexService': {},
    './knowledgeLanes': { KNOWLEDGE_RETRIEVAL_LANES: lanes },
  });
const { KnowledgeCompileService } = load(
  'src/main/knowledge/KnowledgeCompileService.ts', {});
const cards = [
  ['a', 'Texture sampling', 'texture sampling'],
  ['b', 'Mesh index', 'mesh index'],
].map(([id, title, lexical]) => ({
  cardId: 'user:' + id, spaceId: 'user', relativePath: id + '.md',
  title, type: 'fact', lifecycle: 'draft', scope: { api: 'Vulkan' },
  relations: [], headings: [title], lexical, updatedAt: 1,
  contentHash: id.repeat(64),
}));
(async () => {
  const query = new KnowledgeQueryService({
    listSpaces: () => [], index: { getOrRebuild: async () => ({ cards }) },
    readFile: async () => { throw Error('Unexpected file read'); },
    statMtime: async () => 1,
  });
  const absent = 'zzzz_absent_mechanism_91827';
  const result = await query.query({ text: absent });
  assert.equal(result.hits.length, 2);
  assert.ok(result.hits.every(hit => hit.score === 3));
  assert.equal((await query.query({ text: absent, lanes: ['Lexical'] })).hits.length, 0);
  assert.equal((await query.query({ text: 'sampling texture', lanes: ['Lexical'] })).hits.length, 0);
  for (const card of cards) card.relations = [{ kind: 'supports', targetCardId: 'user:shared' }];
  const pack = new KnowledgeCompileService().compile(await query.query({
    lanes: ['Relation/Graph'], relationTargetCardId: 'user:shared',
  }));
  assert.equal(pack.conflicts.length, 1);
  assert.equal(pack.conflicts[0].kind, 'contradicts');
  console.log(JSON.stringify({ defaultHits: result.hits, conflicts: pack.conflicts }));
})().catch(error => { console.error(error); process.exitCode = 1; });
```

这些断言只用于在指定基线复现历史问题，不是当前预期，也不应在修改后的工作树直接运行。当前预期由 `knowledgeServices.test.ts` 等回归覆盖：不存在的查询返回零匹配，共同支持不产生虚构冲突；真实模型使用仍需单独验收。

附录脚本曾在指定基线源码上运行；基线复现不构成当前应用、设备或模型调查的验收。
