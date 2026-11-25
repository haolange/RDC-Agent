# Acceptance Ledger

## 2026-11-24：本地及 Android 回放恢复

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（改前工作区生产构建）
- 结果：本机导入 `vkcube.rdc`，取得 6 个事件，定位 14 → 5 → 14，读取预览并释放回放。
- 结果：Android RMX3551 使用当前 RDC-Tool 工作区准备连接。桌面 capture 因显存类型不兼容被拒。Android 同源 capture 成功读到 592 个事件。一次 ADB 返回空状态，刷新设备后重新准备成功，定位 2653 → 2651 → 2653，读取预览并释放回放。
- 证据：本地：`node scripts/launch-rdc-agent.mjs --mode browser`。隔离工作区、真实 capture 与 USB 连接。
- 人工介入：无。已安装的旧 RDC-Tool 捆绑件缺少自动准备能力，本轮使用当前工作区的捆绑程序。物理拔线由外部条件限制。

## 2026-11-24：模型开关、用量展开与知识中心稳定性

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（工作区生产构建）
- 结果：模型切换的展开行高保持 664.5 CSS px，前后邻行与滚动位移为 0，焦点未丢失。快速切换、写入失败、搜索结果、最后一个模型停用及重开通过。失败提示留在页脚，未重载即用已有模型发送成功。批量检查向隔离服务发出请求，之后取消成功。
- 结果：用量明细在 330 ms 写回延迟下 13 ms 展开，经 12 个实测高度。底边及宽度位移为 0。减少动效直接切换。写入失败后明细仍可读，Electron 桌面在正常尺寸和 708×640、125% 缩放下通过 Space 展开与 Escape 归焦。
- 结果：设置八页与知识中心 11 组场景通过，覆盖 708×640、1400×900、1920×1080、中英文、浅深色、大字号、125% 等效视口与减少动效。快速关闭图片回原缩略图，关闭窄窗知识详情回原列表行。
- 结果：项目切换隔离会话，流式期间切换会话无串入。Markdown 编辑重发保留原名和内容，重载可读。Tasks、子代理、停止、工具拒绝及计划交接均实操。失败请求进入终态，后续流式恢复，打开的用量面板收到实测值。计划阅读面板首帧按 Escape 返回原入口。
- 证据：本地：`node scripts/launch-rdc-agent.mjs --mode browser`。原生 Electron 窗口使用该生产构建。
- 人工介入：无。Provider 与失败注入均使用隔离本地服务。

## 2026-11-24：模型服务工具栏、附件打开与模型目录

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（工作区构建）
- 结果：隔离 Browser QA 连接三个本地服务，复验添加目录、管理、批量请求清单。预览时样本服务未收到推理请求。确认后的批次完成，收起摘要紧邻按钮。
- 结果：708×640、1400×900、1920×1080 覆盖中英文、浅深色、大字号与 125% 缩放。三图混合 7 份附件，实开 1400×630 原图、逐张切换、关闭归焦和移除。长 Markdown 可读到末尾，表格与代码正常。本地样本发送及编辑重发保留 7 份附件。
- 结果：重开隔离历史标注样本，查看关注区域、对比条件和同组文件。Electron 桌面点击 PDF/DOCX 后，Windows 的系统打开调用接受两份独立副本。源代码附件提供定位。
- 结果：182 个 Provider 入口入账，15 个更新。模型目录按官方来源与协议样本核对。全量复跑通过 4828 项，最终批次、附件与 Markdown 增量定向 30 项通过。
- 证据：本地：`node scripts/launch-rdc-agent.mjs --mode browser`。截图 `C:/Users/vulcangu/.codex/visualizations/2026/11/23/01a207f4-cd7f-74e3-a80f-5de70c6c70b4/settings-visual-review/model-service-toolbar-tight-zh.png`，同目录保留 `composer-attachment-shelf-narrow-en.png` 和 `attachment-original-viewer.png`。
- 人工介入：无。联机账号、企业部署权益和计费未实测，模型推理仅用本地协议样本。

## 2026-11-24：设置焦点、知识候选与冲突对照

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（工作区构建）
- 结果：三种窗口尺寸遍历设置。键盘新建 Agent 时焦点进入名称输入，Esc 回到原按钮。MCP、Hook、Policy 空列表同样归焦。真实保存首条 Policy 和删除最后一条后，焦点均落在可用的新建按钮。
- 结果：检查知识卡七章与元信息、导入／导出弹窗、主题与重建确认。从双栏冲突对照打开关联卡，在 708×640 英文浅色大字号下，Space 放大图片，Esc 返回原缩略图。125% 缩放下 Hook 弹窗可完整操作。
- 结果：从空候选进入隔离工程和会话，提交卡片为候选，经预览和写入确认，填写理由并确认冲突后保存成功。
- 证据：本地：`node scripts/launch-rdc-agent.mjs --mode browser-dev`。使用独立资源根、临时工程与知识卡副本。
- 人工介入：无。在线服务和外接设备未参与。

## 2026-11-24：逐条工具、思考栏与上下文三卡

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（工作区构建）
- 结果：回放真实 GPT 会话，收起的思考只显示状态和时长，键盘展开后依次显示两段原文。中文进度保持可读。23 次工具调用逐项显示，实点的三项耗时 158、144、154 ms；失败的知识读取只显示一次失败状态及具体原因。
- 结果：从 Composer 打开用量面板，鼠标、Space、Enter 切换明细，滚动后 Escape 返回原按钮。三卡分别显示 195.5k、120.2k 和 335。最近与累计命中率分别是 98% 与 62%，费用未上报时直接进入上下文构成。
- 结果：在 708×640、1400×900、1920×1080 分配中英文和浅深色，窄窗复验大字号、125% 缩放；另在 620×640 实测窄面板三卡同序纵排，卡内无横向溢出。
- 证据：本地：`node scripts/launch-rdc-agent.mjs --mode browser-dev`。截图 `C:/Users/vulcangu/.codex/visualizations/2026/11/23/01a207f4-cd7f-74e3-a80f-5de70c6c70b4/settings-visual-review/context-usage-three-cards-zh.png`、同目录 `context-usage-stacked-en.png`、`working-thinking-zh.png` 与 `working-tools-individual-en.png`。
- 人工介入：无。回放使用只读来源的隔离副本，未发起模型请求。

## 2026-11-24：跨模型工作过程、上下文用量与面板交互

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（工作区构建）
- 结果：隔离回放 GPT 历史，中文进度保留原位，短推理标题直接可读。「查找了工具，读取工具结果 2 次」展开为 158、144、154 ms 三项。Grok 旧格式存档在隔离会话中显示历史格式提示；Kimi、DeepSeek、Claude、Gemini 缺可回放存档。16 种已登记适配器的协议样本通过。
- 结果：从 Composer 打开用量面板，鼠标、Space、Enter 切换明细，Escape 返回触发按钮。中英文、浅深色、三种窗口尺寸复验，708×640 大字号检查 125% 缩放。占用量和容量同排，压缩阈值贴近刻度，输出额度单列对齐。
- 结果：运行八个设置页、知识三视图，核对模型行、Agent 折叠、资源弹窗及知识章节。键盘从图片查看器回到原图按钮；在知识副本添加一条测试关系，重建后从冲突对照页打开关联卡片。
- 证据：本地：`node scripts/launch-rdc-agent.mjs --mode browser-dev`。截图 `C:/Users/vulcangu/.codex/visualizations/2026/11/23/01a207f4-cd7f-74e3-a80f-5de70c6c70b4/settings-visual-review/context-scale-zh.png` 与同目录 `context-scale-en.png`。
- 人工介入：无。全程使用隔离数据，模型请求额度消耗为零。

## 2026-11-24：项目 Hook 与 MCP 信任区

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（工作区构建）
- 结果：在隔离工程分别打开项目 Hook 和 MCP 的详情，1400×900、708×640 下信任状态、说明与操作可见，动作与正文的边界无重叠，内容无横向溢出。
- 证据：本地：`node node_modules/.cache/capability-review/run.cjs --trust`。
- 人工介入：无。仅查看两项资源。

## 2026-11-24：本地模型默认端口对照

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（工作区构建）
- 结果：隔离 Ollama 端点使用默认端口 11434。通过界面检查并保存连接、预览清单并确认。端点收到 3 次模型检查，应用逐项判定已验证。
- 证据：本地：`node node_modules/.cache/capability-review/run.cjs --default-port`。
- 人工介入：无。

## 2026-11-24：能力检查入口、确认与自定义端口

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（工作区构建）
- 结果：在 1400×900 配置本地服务，708×640 英文深色下打开服务标题栏的检查入口，展开请求清单、按 Escape 返回原按钮；1920×1080 中文浅色下从单服务和全局入口复查。标题栏、底部操作均在可见范围内。
- 结果：自定义端口 32683 上的隔离 Ollama 端点完成 3 个模型发现。预览时没有模型推理请求，确认后该端点收到 3 次聊天请求，应用全部判定已验证。
- 证据：本地：`node node_modules/.cache/capability-review/run.cjs`。截图 `C:/Users/vulcangu/.codex/visualizations/2026/11/23/01a207f4-cd7f-74e3-a80f-5de70c6c70b4/settings-visual-review/capability-review.png` 及同目录的 `capability-service.png`。
- 人工介入：无。使用隔离配置和仓库的本地协议测试端点。

## 2026-11-24：连接状态与对象操作

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（工作区构建）
- 结果：在英文深色 708×640 的模型面板核对底部尚未测试状态与模型控件。1400×900 下用隔离的 Ollama 测试端点走过连接失败、测试通过、保存并重开已连接。1920×1080 中文浅色下核对 Agent 和知识卡菜单；Escape 关闭当前菜单并归还焦点。
- 证据：本地：`node node_modules/.cache/panel-study/run.cjs status`。截图 `C:/Users/vulcangu/.codex/visualizations/2026/11/23/01a207f4-cd7f-74e3-a80f-5de70c6c70b4/settings-visual-review/status-connection-narrow.png`。
- 人工介入：无。使用隔离的配置、知识副本与本地测试端点。

## 2026-11-24：Settings 预览、服务目录与知识案例

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（工作区构建）
- 结果：Windows Electron Browser QA 在 1400×900 英文深色、1920×1080 中文浅色及 708×640 窄窗走查八个设置页。实际切换模型开关、展开详情，核验窄窗控件边界；通过搜索找到长尾服务与区域入口，使用本地 Ollama 测试端点连接并回到已配置服务页。
- 结果：核对用户知识案例的等高前后图、章节、信息、导入、导出、筛选、主题和重建弹窗。临时会话中创建候选、填写理由并确认保存成功；窄窗经键盘放大图片及返回。
- 结果：服务菜单的 Tab 与 Shift+Tab 均沿触发按钮的原生顺序移动，断开最后一个隔离连接后搜索框获得焦点。固定连接地址省去预览，Azure 资源与部署填写后生成地址。本机 RDC-Tool 在设置里检测、验证并应用成功。
- 证据：本地：`node node_modules/.cache/panel-study/run.cjs after`、`node node_modules/.cache/panel-study/run.cjs finish`、`node node_modules/.cache/panel-study/run.cjs keyboard --focus-only`。截图 `C:/Users/vulcangu/.codex/visualizations/2026/11/23/01a207f4-cd7f-74e3-a80f-5de70c6c70b4/settings-visual-review/after-models.png` 与同目录的 `finish-knowledge-narrow.png`。
- 人工介入：无。设置、会话及知识写入使用隔离副本，本地端点仅验证配置与目录交互。

## 2026-11-24：Settings 与知识中心排版及交互（Windows Browser QA）

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（本轮修改在工作区）
- 结果：Electron 生产构建，708×640、1400×900、1920×1080，DPR 1.25。八个设置页走查，验证偏好保存、主题编辑目标、Agent 窄窗回退、资源子弹窗。知识对照图单组两张且等高，切章节、打开图片、提交候选、键盘确认并保存成功。
- 证据：本地：`node node_modules/.cache/settings-convergence/verify.cjs`，知识审核专项 `node node_modules/.cache/settings-convergence/verify.cjs --knowledge-only`。保留截图 `C:/Users/vulcangu/.codex/visualizations/2026/11/23/01a207f4-cd7f-74e3-a80f-5de70c6c70b4/settings-convergence/agents-1920.png` 与 `C:/Users/vulcangu/.codex/visualizations/2026/11/23/01a207f4-cd7f-74e3-a80f-5de70c6c70b4/settings-convergence/knowledge-1400.png`。
- 人工介入：无。使用独立 Browser QA 配置及测试知识卡，通过产品界面操作。

## 2026-11-24：Working 标题高亮与双题 Ask（Windows Browser QA）

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（本轮交互改动在工作区）
- 结果：Electron 生产构建搭配本地 Ollama 测试服务。深色中文 1400×900 验证 Tasks 卡头和嵌套原因的悬停、离开、键盘焦点、高亮前后等尺寸及减少动效。浅色英文 708×640 同时见两道待答问题，经 Composer 选择并填写后，1920×1080 同卡显示两对问答，原有外列对齐复测通过。
- 证据：本地：`node node_modules/.cache/rdc-work-interactions-qa/verify.mjs`（Tasks），`node node_modules/.cache/rdc-work-interactions-qa/verify.mjs --ask-only`（Ask 专项）。
- 人工介入：无。使用真实 Composer 驱动交互，复用本轮隔离配置，提交后检查同一卡片。

## 2026-11-24：Working 状态点与正文、Composer 共线（Windows Browser QA）

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（本轮排版在工作区）
- 结果：Electron 生产构建搭配本地 Ollama 测试服务。浅色 1400×900 和深色 708×640 的开合状态均实测状态点、最终回复与 Composer 左缘偏差为 0。最终回复保持全宽，工具卡每侧内缩 32 CSS px。
- 证据：本地：`node node_modules/.cache/rdc-working-dot-qa/verify.mjs`。
- 人工介入：无。经 Composer 发送固定测试回合，用键盘展开、折叠。

## 2026-11-24：全宽最终回复与 Working 标题共线（Windows Browser QA）

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（本轮排版在工作区）
- 结果：Electron 生产构建搭配本地 Ollama 测试服务。英文浅色 1400×900 和中文深色 708×640 的展开、折叠状态均实测最终回复与 Composer 外框等宽，Working 标题与回复左缘偏差为 0，状态点可见。工具卡每侧内缩 32 CSS px。
- 证据：本地：`node node_modules/.cache/rdc-plain-answer-qa/verify.mjs`。
- 人工介入：无。经 Composer 发送固定测试回合，再用键盘开合 Working。

## 2026-11-24：Working 整体内缩与最终回复对齐（Windows Browser QA）

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（本轮排版在工作区）
- 结果：Electron 生产构建搭配本地 Ollama 测试服务。英文浅色 1400×900 和中文深色 708×640 均验证 Working 无外框、整体每侧内缩 12 CSS px。展开和折叠时标题文字与最终回复正文左缘误差为 0。窄窗跟随和停止时工具卡边界一致，无横向溢出。
- 证据：本地：`node node_modules/.cache/rdc-working-inset-qa/verify.mjs`。
- 人工介入：无。经 Composer 发送测试请求并用键盘展开、折叠。

## 2026-11-24：Working 父子层级复验（Windows Browser QA）

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（层级修正在工作区）
- 结果：Electron 生产构建搭配本地 Ollama 测试服务。浅色英文 1400×900 和深色中文 708×640 展开可见同一轮廓包住标题与过程，工具卡左右内缩各 22 CSS px。运行与停止边界一致，折叠后标题和箭头保持横向位置，无横向溢出。
- 证据：本地：`node node_modules/.cache/rdc-working-frame-qa/measure.mjs`。
- 人工介入：无，经 Composer 触发测试回合并用键盘展开、折叠。

## 2026-11-24：对话主栏对齐复验（Windows Browser QA）

- 提交：`9fc247aab990191646ca18e3203fa45138864ad3`（本轮几何改动在工作区）
- 结果：Electron 生产构建搭配本地 Ollama 测试服务，在 708×640、1400×900、1920×1080（模拟 DPR 1.5）交叉验证中英文、深浅主题、右栏停靠与左栏抽屉。实测状态点与事件点圆心、外列与 Composer 边缘误差为 0。运行、上滚与停止时，卡片两侧内缩均为 22 CSS px。窄窗长中文换行无横向溢出。
- 证据：本地：`node node_modules/.cache/rdc-alignment-qa/measure.mjs before`、`node node_modules/.cache/rdc-alignment-qa/measure.mjs after`、`node node_modules/.cache/rdc-alignment-qa/measure.mjs wrap`。
- 人工介入：无。经真实 Composer 发送测试请求，自动走查展开、折叠、手动上滚、停止、子代理和计划交付。

## 2026-11-24：BlackHair 真机调查完成并就地交付

- 提交：`b43018451001f7c8f34bae056f684b7488232576`（本地工作树）
- 证据：本地：`node node_modules/.cache/rdc-live-acceptance/deliver.mjs`（会话 sess_20675be0cbc7）。GPT-6.0-Luna Medium 实际完成计划、批准、Android E2653 最终图取证与独立 Verifier 核验。报告 invart-2144b9cdba27-1795449571843 为 ready，宿主接受 completed，只显示一份终答。
- General 报告头发大面积近黑、发束层次较弱，较暗的围领候选区域仍有纹理。范围为当前最终输出的观察。原生入口回到 E2653，已持久化签名 resolved 回执并释放回放。
- 人工介入：选择设备、打开回放、批准计划。执行回合内无追加提示词或手工修正报告。

## 2026-11-23：BlackHair Android 应用内自动恢复与同回合续跑

- 提交：`b43018451001f7c8f34bae056f684b7488232576`（本地工作树）
- 证据：本地：`node node_modules/.cache/rdc-live-acceptance/run.mjs`（会话 sess_b4bbe4888399）。Luna Medium 冻结 BlackHair.rdc 和当前 Android，批准后以 General 读取原生现场。
- 停止该回放独占的 Android RenderDoc helper 后，原生返回 replay_fatal_error。General 在同一个 turn 调用 capture_recover，签名回执记录旧 daemon 退出以及同一 capture、设备下的新 context。随后真实查询新 context 并重新取图。
- 人工介入：批准计划、触发故障，后续按应用询问澄清一次围脖毛区域。已有 ADB 服务继续运行，恢复和续跑无需补发提示词。测试驱动异常退出，正式报告另行复验。

## 2026-11-23：BlackHair 真机调查复现普通查询故障未登记

- 提交：`b43018451001f7c8f34bae056f684b7488232576`（本地工作树）
- 证据：本地：`node node_modules/.cache/rdc-live-acceptance/run.mjs`（会话 sess_76611041836f）。GPT-6.0-Luna Medium 提交并获批冻结 BlackHair 与同一 Android 的只读计划，General 完成原生事件查询。在自有 ADB 中断后，资源列表查询报告 replay_fatal_error，capture_recover 随后拒绝了缺失故障记录的 lease。
- 人工介入：打开回放、批准计划、触发中断。General 以一次未解决终答结束，随后释放回放。

## 2026-11-23：Windows Electron 调查回合与交互（Browser QA）

- 提交：`b43018451001f7c8f34bae056f684b7488232576`（本地工作树）
- 证据：本地：`node scripts/launch-rdc-agent.mjs --mode browser`。本机 Provider 实际请求使用 GPT-6.0-Luna Medium。General 的真实工具调用及终答保持一次交付，Working 排在回复上方。在 708×640、1400×900、2560×1440 下，两侧实测内缩均为 22 CSS px。
- 本机知识案例通过键盘切换到证据章节，详情只显示选中章节；设置窗口在 708×640、1400×900、1920×1080 无横向溢出。
- Debugger 正式计划触发待审时，Working 默认收起，展开时剪影与正式卡可区分。人工批准后交接显示为普通用户消息。首次 General 执行在验收时间内未交付，日志显示缺少 Checkpoint 和 ready Report，已修正 Skill 的交付指引。
- 人工介入：录入 QA 提示词、按计划门批准、切换界面；普通 General 回合提交后自动完成。

## 2026-11-23：批准后的离线调查交付复验

- 提交：`b43018451001f7c8f34bae056f684b7488232576`（本地工作树）
- 证据：本地：`node scripts/launch-rdc-agent.mjs --mode browser`。GPT-6.0-Luna Medium 提交计划，批准后 General 从本机知识卡提取观察并交付一份终答。
- 真正声明为 partial。宿主要求带 Claim 和 WorldState 的 MissionCheckpoint，Agent 如实交代材料缺口。执行 Skill 已补明会话内的记录依赖；completed 路径本次未通过真实模型验收。
- 人工介入：录入 QA 提示词并批准计划。执行期间无补充提示词。

## 2026-11-23：Android Capture 界面实测与计划范围门

- 提交：`b43018451001f7c8f34bae056f684b7488232576`（本地工作树）
- 证据：本地：`node scripts/launch-rdc-agent.mjs --mode browser`。Capture 在 Windows Electron 中打开 BlackHair.rdc，显示 Android 真机回放画面，随后释放回放。
- 第一条现场调查计划缺少结构化 captureScope，执行门拒绝原生读取。General 交付一次阻塞说明。此轮控制传输已中断，但未进入受控恢复链。
- 人工介入：选择设备、批准计划、触发本轮自有 ADB 中断和关闭回放。

## 2026-11-23：Android 受控续跑复验未进入执行

- 提交：`b43018451001f7c8f34bae056f684b7488232576`（本地工作树）
- 证据：本地：`node scripts/launch-rdc-agent.mjs --mode browser`。Browser QA 的 ADB 发现已看到设备；选择 Android 后，RDC-Tool 对该设备的 get-state 返回 adb_device_invalid_response，Capture 准备失败。
- 人工介入：选择同一台设备。该次未执行中断，也未提交模型请求；仍需设备能通过 get-state，再验收冻结范围、原生恢复和同一调查续跑。

## 2026-11-23：RDC-Tool Android 断开后重建回放

- 提交：`b43018451001f7c8f34bae056f684b7488232576`（Agent 基线）；RDC-Tool 基线 3764eae7a34d，测试使用本地工作树。
- 证据：本地：`rd.pipeline.get_state` 在独立 ADB 传输断开前成功，断开后返回 replay_fatal_error。旧 context clear 与 daemon stop 均成功；同一设备重新打开 BlackHair.rdc，在新 context 完成相同查询，并释放新的 context 与 daemon。
- 人工介入：仅针对本轮独立 ADB 服务触发断开和恢复，然后直接驱动 RDC-Tool 原生验证。

## 2026-11-20：第二轮收敛（视觉语言、对话与 Working、Tasks、计划交付、设置、知识中心；云端 Linux）

- 提交：`5b4ad8e5`
- 证据：本地：`pnpm run check:gates && pnpm test && pnpm run check:contracts && pnpm run test:coverage && pnpm run check:coverage-ratchet && pnpm run build && RDC_DIFF_BASE=b44a5aba pnpm run check:git-diff`（4734 通过/6 跳过；contracts 250 通过；覆盖率 lines 80.82%；其余通过）。GitHub Actions 未在本条核对。
- 证据：本地：`node scripts/qa-ollama-stub.mjs` + 一次性 Browser QA `node scripts/qa-walkthrough.mjs`：粘贴导入两张案例卡、设置、Effort、模型选择、`qa:loops` / `qa:long` / `qa:plan` 三个剧本、计划门 → 阅读器 → 批准 → 交接引用卡 → 执行回合经 `turn_complete` 声明 blocked、浅色、720px，19 屏全部通过，滚轮上滚断言通过；改前改后对照在私有 Artifact。
- 证据：本地：RDC-Tool `python scripts/native_source_digest.py <renderdoc> --revision dde8822…` 得 `20b5f0c8…`，回执为 `bce2094…`；base、upstream 修订，Windows CRLF 检出字节与常见排序、行格式、整树归档均不符，判定回执的源码出处不可核实，记录于 RDC-Tool `1308904`，修正需在 Windows 干净检出上重建。
- 未验证：OpenAI Responses 与 ChatGPT OAuth 的推理摘要实机对照；Ollama 真实模型。
- 人工介入：无。

## 2026-11-20：收敛计划收尾（云端 Linux，无 GPU、无模型账号）

- 提交：`38c8db34`
- 证据：本地：`pnpm run lint && pnpm run typecheck && pnpm run test:coverage && pnpm run test:coverage:renderer && pnpm run check:gates && pnpm run build`（node 3821 通过/6 跳过，覆盖率 lines 80.76%；renderer 878 通过，51.82%；gates、build 通过）。GitHub Actions 未在本条核对。
- 证据：本地：`RDC_NATIVE_TOOLS_ROOT=<Linux 候选> RDC_NATIVE_CAPTURE=<vkcube_lavapipe.rdc> RDC_NATIVE_ALLOW_MUTATION=1 npx vitest run src/main/rdc`，Read、Parser、守护进程回收、A-B-A（着色器替换改变像素→回滚恢复→主进程回执验证）、Rejection after 通过；候选为 dde8822 构建，未经发行打包。
- 证据：本地：`node scripts/qa-ollama-stub.mjs` + 一次性 Browser QA：连接 Ollama → 选择器列出模型（上下文、推理）→ 思考 → glob → 流式答复，请求带 `think=true`；`node scripts/qa-readability.mjs` 深/浅色、720px 0 问题。
- 未验证：真实模型（本机不能运行模型服务，云端无账号）；经产品 UI 在 lavapipe 上打开 capture——RDC-Tool doctor 要求发行打包，而仓库回执中 dde8822 的 `tree_sha256` 与 `scripts/native_source_digest.py` 的结果不一致，无法如实生成 Linux 回执。
- 人工介入：无。

## 交接单对比基线

交接单 B／C（`docs/workflows/vertical-investigation-convergence.md`）以下面四轮的数字为对照基线，原文保留；其余 2026-11-20 之前的记录已从本账本删除，需要时从 Git 历史查阅。

### 2026-11-15：M1 用户指定补跑（第十三轮），停在首次异常
- 骁龙 865／Android remote，新会话 GPT-6.1 Sol／Medium；十二个 Agent 来源均为内置，隔离 Memory 为空、Knowledge 保持原样，抓帧已打开且回放画面与设备一致。
- 监工仅输入短症状，对正常颜色及范围的澄清答“不知道”，原样批准并执行计划。模型写出交叉锚点 Evidence 与区域到 draw 的 Claim，但明确只证明 EID 1242→1248 的抽样亮色边界，未排除全部更早写入，首个未满足步骤为首次异常。
- 监工判断直接原因在方法文本：模型实际收到检查更早写入的指引，只在 EID 1176、1216、1242 等处抽样；指引未明确要求覆盖并排除全部更早候选写入。此前已满 12 轮，本次为用户指定补跑，按 3.5 停止。
- 内置 verifier 两次实际使用 ChatGPT Account／GPT-6.1 Sol／Medium；首次因证据授权缺口返回 partial，General 补充授权后第二次完成审查，两条 Challenge 更新为 resolved。两次完成声明曾因缺 Checkpoint／报告被拒，补齐后最终声明为 completed。
- 目标 Pixel History 返回 `pixel_history_unsupported_input_attachment`，主进程核验恢复并保留 lease，模型使用事件前后值与覆盖继续。可逆精度实验五份回执齐全并回滚，产品终态回执 `rdc-lifecycle-765d6638-2c6c-43f9-8aa9-8d708606656f.json` 回到入口 capture 与 EID 3029；关闭回放后转发释放，设备配置原字节及属性已恢复。
- 规划约 5 分 06 秒、执行约 35 分 15 秒；规划 7 次、General 97 次、两次 verifier 共 25 次及自动审查 4 次 Provider 请求，共 input 14958155／output 49109 token（input 含缓存读取 4842240）。会话、子 Agent Trace、Task 和回执归档 `.local/vertical-investigation-20261108/evidence/m1-20261115-round-13-sources.zip`，SHA-256 `67a8148ccbd68a2850fe43560d736fbfcb9531e2fcccbbd56c5ac1e0e230ce18`；工程导出另存 `m1-round13-project-outputs.zip`。
- 2026-11-15 M1 第十三轮 verifier 授权旁查（只读）：审查 Task 有 `independentOfTaskIds`；首次委派输入的闭包提示新增 24 个引用、未列 `Not granted`；锚定与 IR 两份 Evidence 的 `claimIds` 均为空且未显式授予，导致其记录和相应读数、覆盖图、IR 原始材料未进入首次授权；补授后复审完成。证据为上述第十三轮源归档中的首次委派输入、Task、结果及两条 Challenge。
- 2026-11-15 M2 启动前核对：隔离实例 Settings 中十二个 Agent 来源均为内置；Verifier 的 GPT-6.1 Sol 路由显示可用，其他十一个显示未选择模型。系统 ADB 仅有 `e38b8019`（`kona`），骁龙 8 Gen 1 未在线，按计划 3.5 阻塞；未新建调查会话或调整设备配置。
- 2026-11-15 M2 再次启动前核对：隔离实例 Settings 的十二个 Agent 均为内置，GPT-6.1 Sol 路由均显示可用，默认档位为 Medium；用户解锁手机并重新开启 USB 调试后，Windows 可见手机与通用 WinUSB ADB 接口，系统 ADB 在重启及独立 libusb 复核后仍无设备，产品设备列表仅有本地；未新建调查会话或调整设备配置，M2 仍阻塞。
- 2026-11-15 M2 设备接入：备份原 Windows 设备参数后，为该手机现有 Microsoft WinUSB 接口注册 ADB 标识并只重启该接口；用户在手机允许 USB 调试，ADB 显示 `b54ed446` 在线、`SM8475`，用户确认骁龙 8+ Gen 1 可用于 M2。用户放入的 `HairBlack_Mobile.rdc` 的 SHA-256 与账本登记的发黑 capture 一致。
- 2026-11-15 M2 首轮前连接：按用户要求保留旧会话并新建 `sess_511eb886ad60`；产品发现并选择 `RMX3551` 后返回 `RDC_CLI_FAILED: remote_install_unconfirmed: Android installation could not be verified within the connection budget`，重启 ADB 并经产品重试后仍未确认。设备存在 11 月 12 日创建、包名未知且未提交的活动安装会话 `78666123`，原始活动会话输出保存在 `.local/m2-adb-interface-20261115/package-active-install.txt`；该会话未修改，回放未打开，无转发残留，按 3.5 因需用户决定而阻塞。
- 2026-11-15 M2 设备安装清理：用户授权仅取消 `78666123`；执行 `adb shell pm install-abandon` 后 Android 返回 `SecurityException: Caller has no access to session 78666123`，该系统安装器持有的会话仍未提交且存在。原始返回保存在 `.local/m2-adb-interface-20261115/package-abandon-78666123.txt`，未扩大设备权限。
- 2026-11-15 M2 连接与配置缺失：用户重启手机后活动安装会话为空；产品准备匹配服务时卸载原 RenderDocCmd，用户完成手机系统扫描后新服务已安装（versionCode 149），但原 `/sdcard/Android/media/org.renderdoc.renderdoccmd.arm64/files/renderdoc.conf` 已不存在。监工此前只记录原文件 SHA-256 `d235f48e90e4e8e486b5719dba0d2da28928eca9eff6059011cbbe613ea27466` 和属性，未保存文件副本；已查找设备及本机候选，未找到哈希一致的副本。回放未打开、无转发残留，等待用户决定恢复方式。
- 2026-11-15 M2 继续：用户确认没有原配置备份，允许重新生成默认配置并保留旧测试会话；手机在线、活动安装会话为空，沿用尚未发起调查的 M2 空白会话。
- 2026-11-15 M2 首轮预检：RenderDocCmd 生成的默认配置 SHA-256 为 `6a0ecaa762d1bba2ee80d0bdb201cc584195f11f66d0a1412322ef0b6834b349`，已保存副本；用户关闭手机系统提示后，产品连接 `RMX3551` 并打开发黑 capture，EID 2653 的产品预览与手机画面一致且显示设备画面已同步，手机画面保存在 `.local/m2-adb-interface-20261115/device-replay.png`；未临时调整设备配置。

### 2026-11-15：M2 第一轮，待用户确认
- 骁龙 8+ Gen 1／Android remote，十二个 Agent 内置、GPT-6.1 Sol／Medium，隔离 Memory 为空、Knowledge 保持原样；用户授权保留旧会话。监工仅输入短症状、对超出已知事实的澄清答“不知道”，原样批准并执行计划。
- EID 2065 头发覆盖与前后区域读数、竞争解释和 `exp-hair732` 可恢复 A-B-A 实验支持头部局部结论；五份签名回执齐全，verifier 完成独立核验，两条 Challenge resolved、一条对不再使用的 645 视觉锚点降域为 wont_fix，当前无 open Challenge。
- 按 2.3 实质判断交付并保留疑点：EID 2059→2065 两侧均偏暗，未确立异常首次出现边界；肩部仍黑，产品最终声明为 `partial` 而非 completed。历史线索经当前 capture 实验验证，结论只覆盖头部局部。
- 旁支：首个 verifier 因三项原始材料授权缺口建议总体 `partial`；补授后两项解决，一项随 645 视觉主张降域。补授 645 小图的一次委派另返回 `ARTIFACT_NOT_FOUND`；最终限定版核验完成，这些问题未成为本轮停点。
- 交付门禁：General 模型配置将 `tools` 改为 YAML 行内数组后，旧门禁仍按多行文本匹配导致误报；门禁改用运行时严格解析器核对 `knowledge` token，完整门禁通过。
- 终态回执 `rdc-lifecycle-204dab9b-d48c-496c-bd9e-2d13b6cef2b0.json` 确认恢复入口 capture、设备及 EID 2653；关闭回放后 ADB 转发为空，用户授权生成的默认配置哈希与调查前一致，未作临时配置调整。
- 规划约 4 分 13 秒、执行约 45 分 42 秒；规划 8 次、General 102 次、verifier 32 次及自动审查 5 次 Provider 请求，共 input 20788132／output 60240 token（input 含缓存读取 5992192）。会话、Trace、Task、回执和最小工程输出归档 `.local/vertical-investigation-20261108/evidence/m2-20261115-round-01-sources.zip`，SHA-256 `93fd0fed5f4f8e950d0cb1b2b3bb4d779c8c659b740334097da35a3b60c2a2ef`。

- 2026-11-15 M3 首轮预检：基线 `6c6e80835c6245e74c5efe8afc552029ad170786`；十二个 Agent 均为内置且 GPT-6.1 Sol 可用，隔离 Memory 与项目知识目录为空。隔离知识副本与真实库逐文件一致，仅有发白 `AIRD-20260207-0001` 和发黑 `AIRD-20260207-0002` 两张卡片，未发现眼部白点材料，移除 0 张；真实知识库未改动。
- PC 本机已打开眼部 capture，产品显示“部分就绪”，诊断为 `Final Present does not identify exactly one swap-buffer resource`，入口 EID 147 暂无可用画面；M2 测试会话已在归档校验后删除，用户此前要求保留的 M1 会话仍保留。

### 2026-11-18：M3 第十二轮，停在因果

- PC 本机、新隔离会话 `sess_3a7256f5905b`；十二个 Agent 均为内置且 GPT-6.1 Sol 可用，Medium、Fast／Max 关闭、自动审查，Memory 为空、Knowledge 不含本案例。监工先向 General 输入短症状，按其提示切换 Debugger 后重复同一句，未知位置和外观答“不知道”，原样批准计划；未提供区域、事件或方法，旧会话均保留。
- 交叉锚点 Evidence `invart-0113088f6739-1795001979310` 和 Claim `invart-a134bfb960b1-1795001998757` 将左侧候选亮点定位至 `ResourceId::308658`／`(518,455)`／E6152；E6128→E6152 的 RGB 为 `(0.06738,0.03662,0.03320)`→`(0.46875,0.49219,0.5625)`，邻近控制点不变。
- 反射、局部光和采样机制分别保留未验证及其理由；verifier 指出错误的互斥关系和采样资格，两项 Challenge 更新为 `resolved` 并经新版复审。按 2.3 允许有理由的暂缓，本轮区分记录已处理，不等于确定机制。
- 首个未满足步骤为因果：产品接受 `partial`，检查点 `invart-50088c233a8f-1795003393879` 的 `completedExperiments=[]`。调试结果与实际写入不一致，已有完整源码替换能力需要匹配 HLSL，而本 capture 未提供；模型因此未建立安全的单项干预。其他现有干预能否达到同样效果未被证明全部不可用，也无剩余某机制独有的差分读数，未满足能力阻塞三条件。
- 模型请求已包含 `ac3bccd9` 指明的 post-transform 操作，但本轮只读取有界顶点输入，没有调用该操作；第十一轮独立产品复验已证明索引窗口可读，其本身不证明片元插值、实际贡献或可恢复干预。按 3.5 满 12 轮停止，不再修复或新开调查。
- 终态回执 `rdc-lifecycle-b168ed54-6720-45fa-930a-6733c5731b96.json` 确认同一 capture／local／入口 E147、零替换；回放关闭、归属进程退出，无配置调整。产品记录 `partial` 后界面显示 `PROVIDER_STREAM_MISSING_FINAL_ANSWER`，有效终答及声明均留存，记为旁支。
- General 转接约 58 秒、Debugger 规划约 2 分 29 秒、General 执行约 37 分 24 秒；各 3／7／85 次 Provider 请求，两次 verifier 共 23 次、自动审查 1 次，另有 1 次压缩；General input 12463399／output 28380 token（含缓存读取 3127168）。会话、请求、审查、回执和图像归档 `.local/vertical-investigation-20261108/evidence/m3-20261118-round-12-sources.zip`，SHA-256 `657c8c1a897a4c09790edf25c02ec5bc3ef0b57e3c776567eb2bd2a326bd4627`。

### 2026-11-19：M3 第十四轮，可恢复实验待用户确认

- 隔离会话 `sess_60d672e14cde`／眼部 capture／local／入口 E147；Settings 确认十二个 Agent 均为内置且模型可用，GPT-6.1 Sol／Medium、自动审查，Memory 和覆盖为空，Knowledge 无眼部案例。
- 仅输入短症状，对主动澄清答“不知道”并原样批准计划；General 将 E7343 输出的候选点经合成绑定链追到 `ResourceId::308658` 的 `(518,455)`，以 Pixel History、前后读数和覆盖图定位 E6152 泪液 draw。
- 原生目标 RGB 从 E6128 的 `(0.06738,0.03662,0.03320)` 变为 E6152 的 `(0.46875,0.4921875,0.5625)`；相邻控制点不变。粗糙度下限对照使目标降至 `(0.34375,0.36328125,0.421875)`，亮点仍在。
- 单独切除末段反射 RGB 加入项后，目标降至 `(0.03271484,0.01782227,0.01611328)`，控制点不变；两项 A-B-A 各有五份签名回执，撤销后区域数值和 PNG 回到基线。记录 `invart-8ce8a0505f62-1795038036386`、`invart-50b500a6db66-1795038816092`。
- Verifier 首次指出中间绑定链材料缺口；General 补授后复审并关闭 Challenge，产品接受 `completed`。候选点是否为用户所指、正常外观及反射为何集中仍待判断；精确 filter tap 未证。
- 产品自行恢复同一 capture／local／E147、replacement 0，签名回执 `rdc-lifecycle-be07b567-eeea-470e-af4d-d97befbcec7a.json`；监工随后关闭回放。无设备配置调整，会话、Trace、调查记录、回执及图像保留于隔离 userData 和测试工程。
- 第十三轮的截断恢复修复为 `14613ee8`；本轮直接读取单块 constant buffer，未触发该截断路径。规划约 2m48s、执行约 58m47s；Provider 累计输入 23,622,293、输出 73,286 tokens（含自动审查、Shader Analyst、Verifier 和压缩）。
