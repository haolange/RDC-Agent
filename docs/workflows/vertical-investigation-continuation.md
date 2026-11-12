# 垂直调查：上传说明与后续需求 Prompt

> **历史交接（2026-11-08）**：本文保留当时的需求、问答与计划背景，不作为当前测试指令或设备状态。较新的事实以[任务清单](vertical-investigation-tasks.md)和[验收账本](../product/acceptance-ledger.md)为准；我方后续已决定放弃同 session 重启验证，本文较早的相关表述不再是当前验收要求。

本次交接日期：2026-11-08。分支：`codex/vertical-investigation-convergence`；开发基线：`36306dbd3d5ca1f6663bcedda43ba6e25a0d0ba4`。这是一批实现、修复和验收记录的上传，不是全部真实验收通过，也不是安装包发布。最终提交 SHA 以该分支 Git 记录为准。

## 阅读入口

- [设计分析原文](../product/rdc-agent-investigation-design-analysis.md)：现为重写后的目标架构设计；当时上传的原文与基线复现见 Git 历史。
- [用户批准的完整 Plan](vertical-investigation-plan.md)：保留当时批准的原文；后续测试模型要求以本文最新说明为准。
- [当前架构权威](../../ARCHITECTURE.md)及其 Authority Map：裁决现行产品、运行、权限和投影合同。
- [验收账本](../product/acceptance-ledger.md)：搜索“垂直调查收敛”，查看实际结果与失败边界。
- [最小工程回执](../product/vertical-investigation-validation.json)：保留最终工程结果、相关源码哈希及原回执哈希，不含账号凭据或原始模型会话。

## 需求、问答与 Plan 如何合并

用户原始问题是：短症状 Prompt 在换案例后容易走偏；知识虽然读到了，却没有形成适用性检查；还有有效检查时，Orchestrator 已经给出结论或结束。原始短输入示例为“角色头发整体发白，像漏光或过曝；调查一下原因。”详细提示能改善表现的另一台机器记录未提供原文，因此没有完成受控对照，也不能据此认定唯一根因。

用户要求改进的是三个 Mission 的通用能力、知识使用和持续行为，不能把发白／发黑案例的答案写进通用路径。完整目标是：**症状或目标 → 有依据的规划 → 用户批准 → 执行与专业委派 → 证据和竞争解释 → 独立核验 → 补证、恢复或交付。**

| 当时对齐的问题 | 用户最终选择与实施边界 |
| --- | --- |
| 职责继续由 General＋Skill 承载，还是拆 Agent？拆到什么粒度？ | 明确选择八个内部 Agent，默认加载匹配 Skill；保留四个用户入口，不新增顶层模式，也不强制每次调用全部 Agent。 |
| 用户怎样指定子执行模型？ | 每个 Agent 经现有设置独立配置，runtime 核对实际 Profile、Skill、模型、档位和来源版本；父 Composer 不覆盖子执行。 |
| 新 Agent 初始模型是什么？ | 原批准 Plan 选择本机 `chatgpt-account / gpt-6.1-sol / high`，不写死到分发资源。最新后续软件测试要求是 **GPT-6 Luna / Medium**，准确 ID 为 `gpt-6-luna`；旧证据不重写，正式配置不批量覆盖。 |
| 是否沿用固定默认总轮数？ | 采用目标与核验闭环；没有显式总量限制就不自设总轮数。取消、明确限额、无进展、权限及真实阻塞继续有效，消费和期限不能被续跑清零。 |
| 多 capture、设备故障和外部工程如何处理？ | 同一 owning session 串行切换获批输入，结束恢复入口现场；同 capture／设备／权限可受控恢复。换设备、权限或目标需用户决定；不自动修改 Unity／Unreal 工程。 |
| 旧数据和知识主题如何治理？ | 仅转换受影响且可可信映射的数据，备份、预览、验证后原子替换；不留兼容双读。历史签名／原始日志不改写。少量统一主题由 Agent 提议、用户批量确认。 |
| 没有陌生 capture 或独立真值怎么办？ | 完成通用实现与可取得的验证，明确保留泛化缺口；不能学习两个答案，也不能用合成材料替代真实案例验收。 |

上表来自当时需求、澄清问题、用户回答及批准 Plan 的交叉核对；是结论摘要，不是逐字聊天归档。

## 本分支上传信息

**建议提交标题：**`feat: 收敛垂直调查执行、知识与受控回放链路`

- **执行与模型：**新增 Generator、Verifier、Knowledge Scout、Report Writer、Shader／Pass／Resource／Pixel Analyst；统一 Agent 模型与推理配置、同步／后台准入、方法预载和来源核验，移除 Capsule 自由模型覆盖旧入口。
- **目标闭环：**移除未配置时的默认总轮数／强制局部配额；完成反馈携带具体缺口并在同一逻辑执行续跑，核对报告、独立审查、当前成果版本、取消和累计消费。
- **知识链路：**修复文本零命中被基础分抬成命中、共同关联被误判为冲突；补词序／中英文词表、版本化分页、渐进读取、图像来源及主题提议／预览／确认。
- **回放与修复：**同会话受控选择与恢复、身份重新准备、生命周期回执及子执行收口；修复切换时混合发布输入身份、Local ready、旧入口快照误投影、单 capture 计划缺 scope 的 live 准入，以及超长行搜索遗漏。
- **界面与文档：**设置展示配置错误与内部 Agent，子执行显示真实模型／档位，Knowledge 与 Capture 交互同步更新；架构、运行、失败及产品合同一并调整。
- **验证结果：**最终 Node 391 文件／3591 passed、4 skipped；Renderer 200 文件／868 passed；各自覆盖率棘轮、typecheck、lint、指定开发基线的完整 gates 和 build 通过。lint 为 0 errors／2151 warnings。Luna 请求构建及目录／规划／reasoning 相关 56 项通过。以上是本机已有记录，上传后未因此宣称云端 CI 通过。

本次上传前另核对了暂存范围、文档链接、敏感信息、repository hygiene、architecture、acceptance ledger 和 staged diff；Agent runtime 门禁 9 文件／161 项通过。八个新增 Agent 文件仅清除了多余的 EOF 空行。该门禁首次因系统 TEMP rename EPERM 在收集前失败，改用自有工作区 TEMP／TMP／TMPDIR 后通过；未放宽产品安全策略，也没有新增模型请求。

### 真实行为已证明的范围

八个新增 Agent 有匹配 Profile／Skill 来源和真实同步请求，后台 Verifier 另有实际请求；这批历史请求为 Sol High。真实模型已读取版本化知识与两张图片，合成上下文压缩保留未知和反证。独立 Local Analyzer 在两份公开 capture 上完成获批计划、采集、独立核验、报告和恢复；68 份请求均为 Terra Medium，计划和 21 项工具操作经人工批准，不称为无人干预。

单 capture Optimizer 修复后自动冻结 scope，从 EID 11 恢复 EID 14，宿主闭合 `resolved`，四份回执经本机操作员 HMAC 核验；调查仍为 `partial`，没有合格优化收益、A/B/A 或质量验收。首次失败和历史 partial 均保留，不用新结果覆盖。

### 尚未完成的验收

| 剩余项 | 已有事实 | 继续所需证据 |
| --- | --- | --- |
| Android 原生回放、串行切换和恢复 | 2026-11-07 原手机 ADB 在线；helper versionCode 148。BlackHair 此前有 Adreno 管线创建崩溃，另一次首帧观察在 EID 2653 丢失远程连接，两者因果未建立。 | 在家中重新核对设备、工具与输入身份；取得可用回放或定位并修复实际 native 故障。多输入切换还需另一份兼容 capture。在线不能代替回放成功。 |
| 短／详细 Prompt 对照 | 历史运行不是固定条件的成对实验；另一台设备的详细 Prompt 原文未取得。 | 固定模型、知识版本、权限、输入和干净现场；详细提示只补方法，不泄露答案。保存两组原文、请求、来源、介入、耗时和用量，区分工具故障与方法差异。 |
| 陌生案例泛化及三 Mission 结论资格 | Local Analysis 已通过限定场景；Debug／Optimize 的若干记录仍为 partial；合成 fixture 与压缩不能证明真实泛化。 | 有独立真值或可复查区分实验的陌生材料；Debug 看因果区分，Analysis 看目标覆盖，Optimize 看测量、噪声、收益、质量及恢复。 |
| 首轮历史归档的应用内独立核验 | 本机操作员完成字节／对象比较及分离的 HMAC 核验；应用已读提取件，但未独立完成长 JSONL 的逐项比较。未签名来源和回执时刻焦点仍未知。 | 在合法可用的工具边界内复核；比较通过也不能认证未签名来源或补证当时焦点。不要为关闭旧 Challenge 放宽门禁。 |
| 重启后的真实长调查完整闭环 | 累计消费、期限、恢复和重新准备有合同回归，已有长 Mission 请求记录。 | 在新机器准备可用的隔离现场后，单独保留一次重启前后身份、消费和最终交付的真实回执。 |

此前自动审批拒绝启用隔离本机解释器，理由是扩大后续代码执行能力；浏览器拒绝 `file://` bootstrap 入口并禁止绕过。家中应依据那里的实际工具与权限准备正式入口，不能把旧拒绝当成所有新环境都不可用，也不能换入口绕过仍生效的拒绝。不要在同一失败条件下无效重开 capture。

## 跨设备资料与准备

Git 包含本次代码／测试／合同、设计原文、批准 Plan、本 Prompt 及最小工程回执。**不包含** `.local/vertical-investigation/` 中的原始模型轨迹、用户会话、隔离签名密钥、Provider 登录、正式 User Profile／Knowledge／Memory、RDC-Tool 安装、原始 RDC 或设备数据；这些仍留在原机器，不因上传而自动同步。验收账本中的旧 `.local` 路径是原机器证据位置，家中不存在时不能声称已读取，也不要因此删除账本。

家中需使用自己的 Provider 登录、User space、RDC-Tool 和兼容输入／设备；通过产品配置逐个确认测试 Agent。不要复制 secret 存储或整份用户目录到 Git，不要把 `.rdc` 上传为源码。仅凭本仓库可以继续代码工作；缺少现场材料时先完成不依赖它们的工作，再集中说明必要输入。

在已有 checkout、确认没有需要保留的本地改动后：

```powershell
git status --short
git fetch origin
git switch --track origin/codex/vertical-investigation-convergence
```

若本地已存在该分支，切换到该分支并核对 upstream；有本地改动或分叉时先保留并核对，禁止 reset／clean／force push。新 checkout 可直接 clone 该远端分支。当前 CI 只对 main push、版本 tag 和 pull request 触发；本次仅推送功能分支不代表触发或通过 CI。

## 可直接复制的后续需求 Prompt

> 继续 RDC-Agent 垂直调查能力收敛，承接 `codex/vertical-investigation-convergence`，不要从头重做，也不要把剩余任务降级成静态检查或样例。
>
> 先读 `AGENTS.md`、`ARCHITECTURE.md` 的 Principles／Authority Map、`DESIGN.md`，再读 `docs/product/rdc-agent-investigation-design-analysis.md`、`docs/workflows/vertical-investigation-plan.md`、本交接文档和 `docs/product/acceptance-ledger.md` 的垂直调查条目。以当前源码与运行证据为准；设计基线、原 Plan、已实现状态和未验证状态分开。
>
> 我的目标是让 Debug、Analysis、Optimize 能处理各自领域的不同问题：短症状也是正常入口，Agent 自己组织对象定位、知识适用性检查、竞争解释、区分实验和独立核验；还有有价值且合法的检查就继续，完成或合理未完成都要有具体证据。不要针对发白／发黑两个答案加补丁。沿已批准的 Small Loop／Big Loop、Mission → 用户批准 → General 执行合同推进，不新增固定工作流或第二套 Goal、路由、调查存储。
>
> 先核对当前分支、SHA、dirty state、已有验证以及家中 Provider／Knowledge／RDC-Tool／capture／设备条件，压缩成一份工作状态，并按批准 Plan T0–T7 维护唯一 Task 清单。旧 `.local` 原始证据没有上传；先读已上传账本和最小工程回执，缺材料就明确标注，不伪造已读或重复已完成工作。无需默认重复所有旧验收。
>
> 后续本库软件测试统一选 **ChatGPT Account / GPT-6 Luna / Medium**，准确模型 ID 为 `gpt-6-luna`。先核对家中账号目录可用性，再经现有 Agent 设置保存链配置隔离测试 Profile；核对根请求和实际委派 RequestPlan 的模型／档位，不以界面显示或父 Composer 覆盖冒充子执行配置。默认沿已有测试关闭 Fast／Max 以固定条件，不擅自换模型、降档或重写 Sol／Terra 历史记录。正式用户配置变更与测试副本分开。
>
> 主攻剩余真实验收：先取得 Android 可用回放或实际故障的可复查根因，再做同 session 的获批 capture 切换／恢复与短／详细 Prompt 固定条件对照；并行条件不足时完成可独立推进的工作。新故障沿最短调用链定位责任层，不在本库猜测修补外部 native／driver，不在相同失败条件下反复重开。需要外库修改、换设备、扩大权限或改目标时集中说明具体边界。
>
> 针对三 Mission 分别记录目标、材料身份、知识版本、竞争解释、已执行／未执行检查、反证、独立来源、报告资格、恢复、请求数、耗时、token、可得费用和人工介入。比较详细提示时只补方法，不能加入额外根因事实。陌生材料和独立真值不足就保留泛化缺口；Analysis 成功不代表 Debug 或 Optimize 通过，画面变好不等于因果成立，局部耗时下降不等于端到端收益。
>
> 历史归档核验只在当前真实可用且获准的工具边界内推进，不绕过审批。机械比较、操作员 HMAC、未签名来源认证和当时资源焦点是不同问题，不为了关闭 Challenge 改写证据或降低门禁。重启验收也必须保留同一逻辑执行的累计消费和期限。
>
> 复用现有 primitive、平台服务和 Agent＋Skill。通用内核只负责身份、配置、权限、消费、取消、引用和真实状态；RDC／Investigation 处理领域确定性合同；方法留在匹配 Skill。只修已证实且直接影响目标的问题，替代路径同步删除旧入口、类型、测试与文案，不留兼容 shim、双读双写或静默 fallback，不扩大到无关清理或 Unity／Unreal 工程。
>
> 修改后按影响运行相关单测、typecheck、lint 和对应门禁；跨层变更补 Node／Renderer 覆盖率、各自 ratchet、完整 gates 与 build。固定 pnpm 11.7.0；完整 gates 的历史比较使用 `RDC_SYSTEM_DEBT_BASE_REF=36306dbd3d5ca1f6663bcedda43ba6e25a0d0ba4`，secrets 比较使用 `RDC_DIFF_BASE` 同一基线。Windows 测试如遇系统 TEMP 权限问题，使用本轮自有工作区 TEMP／TMP／TMPDIR，不放宽生产路径检查。Browser QA 用正式 disposable `start:agent-browser`，一次消费 bootstrap 后进入同源 `/app`；保留当前权限边界。
>
> 任务主动推进到实现、文档、适用验证和临时资源清理完成；只在不可替代输入缺失或真正无法合法继续时说明具体阻塞。可逆非阻塞选择写明默认、理由、风险与回滚方式后继续，不为普通实现选择反复询问。结束前恢复可恢复的 capture／位置，释放 context 后 stop 自有 daemon 并核对进程回执，停止自有 QA／Electron，核对桌面锁和临时产物；逻辑字节不等于实际释放空间。
>
> 本 Prompt 不授权新建分支、提交、推送、发布或删除真实数据；沿家中已核对的当前分支继续。最终交付分别说明实现、工程检查、真实模型、Android、泛化和清理结果，未验证项不标成通过。
