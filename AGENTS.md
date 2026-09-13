# AGENTS.md

## 范围

本文件只约束 `RDC-Agent` 仓库内的修改方式、文档治理和交付边界。

本仓库是面向 RenderDoc `.rdc` capture 的 Electron 桌面应用，核心代码分布在 `src/main`、`src/preload`、`src/renderer` 和 `src/shared`。若本文件与系统、平台安全规则或用户本轮明确指令冲突，以更高优先级指令为准，并在交付说明中指出采用了哪个约束。仓库内部文档之间出现冲突时，产品边界、架构边界和验证门禁以 `DESIGN.md` 为准，再同步修正文档。

## 修改原则

- UI/UX、产品、架构、跨层契约、feature 拆分与验证策略先读 DESIGN.md 的 Architecture Principles / Authority Map，再读相关 docs/contracts/*、docs/architecture/*；视觉权威是 docs/ui/design-system.md。
- 根目录只放入口和长期跨层约定，领域规则归稳定主题文档，Task 记录状态，正式验收记录保存证据；不把临时禁令、机器路径、PID、某轮延期或进度流水账写成永久规则。标准 Electron 布局，不恢复顶层 Config/Saved/Intermediate/Binaries。
- main/preload/renderer/shared 联动；角色、阶段、IPC、共享类型须核对 runtime 与 UI。只改本次必需文件，不添加兼容 shim、双写双读或静默 fallback，替代路径删除旧入口与文案。
- 路径相对本库；上游仓库概念只作标记明确的对照，不能成为运行前提。文档中文为主，保留必要技术术语。

## 执行纪律

- 默认在当前分支工作；没有明确要求且不处于已确认的 Worktree 模式，不创建或切换分支。提交、推送和发布按用户授权执行，不能把修改授权自动扩大为发布授权。
- 用户要求“提交”“上传”或“推送”时，以对应 Git 操作成功为交付完成点。GitHub Actions 等云端 CI 属于异步检查，触发后报告链接与当时状态；只有用户要求守候时才持续监控，不擅自阻塞交付。
- 开始先核对当前改动、实际调用链、架构契约与已有证据，不覆盖其他工作、不重复已完成工作。实现、文档、测试不一致时定位错误方并同步修正，不凭名称或设计意图推断行为。
- 复杂任务沿用已批准 Plan 和持久 Task 清单，记录依赖、状态、修改范围、验证结果及阻塞原因；使用 `待执行 / 执行中 / 待验证 / 通过 / 阻塞`，代码完成不能直接标记通过。开始和交接时压缩已完成、剩余、阻塞和运行中任务，不另建重复报告。
- 已授权工作主动推进到实现、文档、验证和清理完成，不降级为样例、空壳或只交分析。完整交付不等于最少 diff；每项修改必须服务于任务及其直接耦合点，不扩大成无关重构。
- 影响数据、接口、权限或不可逆行为的未决歧义应及早集中问清；不要重问已有决定。可逆选择说明默认依据、风险与回滚方式后继续，不能静默改变目标量级。
- 不为未来可能使用而增加抽象、配置和扩展点；抽象须能减少重复、降低错误或符合既有架构。新路径替代旧路径时同步处理入口、配置、类型、UI、测试和文档，不保留 legacy/deprecated alias、双写双读或无依据 fallback。确实无法直接迁移时，先说明具体约束并按用户明确决定执行，不能自行留下债务。
- 用户要求收口时冻结范围，沿最短依赖链完成原计划剩余项；只有明确验收失败、可复现错误或实际权限漏洞才扩大修复，每次失败先修直接原因，不以假设性风险开启新审查。
- 如使用多 Agent，分配明确、互不重复的交付与验证边界；停止交叉探索、重复检查、空等和频繁切换。是否新增 Agent 遵循当前授权，不把某轮安排固定成永久禁令。
- 用具体行为解释问题和进度：谁在做什么、还差什么、完成条件、实际阻塞和下一步。不要只报 Task 编号、术语或重复历史过程；更新任务状态，而非只追加日志。

- RDX 查询、测量和缩略图沿用冻结的 capture/replay/context 身份。临时回放位置必须恢复并由主进程核验，恢复失败隔离 lease；能力声明不能替代身份检查、实际结果验证和签名回执。

## 代码与文档边界

- `src/main` 负责窗口、菜单、IPC、工作流编排和外部能力接入。
- `src/preload` 负责受控暴露给渲染层的 API。
- `src/renderer` 负责界面、交互、状态展示和用户入口。
- `src/shared` 负责跨层共享的常量、类型与工具函数。
- `docs/` 只放稳定设计说明、流程说明和使用文档，不要把运行时代码规则写回文档层。
- `docs/` 下的正式文档按稳定主题归类到 `contracts/`、`product/`、`architecture/`、`workflows/`、`ui/`。
  - `contracts/`：runtime kernel、permissions、failure-model 等跨层契约（DESIGN 分拆权威）。
  - 产品/架构冲突以 `DESIGN.md` 裁决，再同步 `docs/**`。
- `resources/` 只放需要随应用分发或运行时依赖的资源；`scripts/` 只放可复用的开发脚本。

## 设计系统约束（agent 写 CSS 必读）

Appearance 详细规则见 docs/ui/appearance-checklist.md；禁止恢复 translucent / semi-transparent sidebar。

**权威文件**：[`docs/ui/design-system.md`](docs/ui/design-system.md)（视觉定位 / Token / 刻度 / 组件规则 / 视觉参考）。本节仅保留高层原则。

- **视觉定位**：restrained、高密度、实色分层的精密工具风。不使用 backdrop blur、装饰性特效或插画；单一 accent 只用于 focus / selected / primary CTA。
- **必须**引用语义 token（`--token-*`），禁止直接用 primitive token；字号用 `var(--text-*)`，间距用 `var(--space-*)`，圆角用 `var(--radius-*)`，控件高度用 `var(--control-height-*)`。门禁：`pnpm run check:design-tokens`。
- 全局唯一按钮系统：`.button` + variant 修饰类；React 层用 `<Button>`。
- 颜色双体系：全局 chrome vs Composer agent accent；详见 [`docs/ui/design-system.md`](docs/ui/design-system.md) 与 [`docs/ui/appearance-checklist.md`](docs/ui/appearance-checklist.md)。
- 状态类一律 `is-*`（`is-active` / `is-selected` / `is-running` / `is-disabled`）并配对应 `aria-*`；禁止裸 `.active` / `.current`。
- 任何 `:hover` 必须配 `:focus-visible`；禁止 `outline: none` 而不提供等效焦点样式。
- 新组件必须覆盖所有交互状态、通过 CSS 变量控制 variant、不使用内联 style、文件行数 ≤300/200。
- 渲染层分层与依赖方向由 `pnpm run check:renderer-structure` 与 ESLint `no-restricted-imports` 强制：`ui → lib`；`patterns → ui/lib/stores`（可读 store，不得写 store、不得直调 IPC）；`features` 不得横向 import 其它 feature，也不得 import `app` / `shell`；`stores` / `services` / `hooks` 不得 import `features` / `ui` / `patterns`；组件（`.tsx`）不得直调 `window.electronAPI` / `getElectronApi`。
- 视觉参考：`designs/rdc-agent-design-system/Design System Preview.html`。

## 产物与命名治理

- 构建/测试输出、日志、缓存、workspace 数据与临时文件不入库；根文件受 check:repository-hygiene 允许名单约束。
- 依赖唯一 pnpm@11.7.0，保留 pnpm-lock.yaml；pnpm-workspace.yaml 固定 store。禁止 npm/Yarn fallback、根盘 store、第二 launcher。node_modules/out/release/下载缓存/prepare state 仅本机；发布包不得带包管理器、lockfile、源码 launcher 或开发缓存。
- resources 放分发资源，scripts 放可复用脚本；禁止恢复独立 cli/、Playwright e2e/、docs/handover/。designs 只保留 rdc-agent-design-system。
- 目录与文件按稳定职责命名，不以 v1/v2、new/old、final/final2 等迭代标签建立长期并行路径；协议或存储版本只在确有语义需要的边界表达。已有带版本名且仍被引用的实现，须先核对调用与契约再收敛，禁止凭名字直接删除。不提交乱码，先核实原始字节。
- 用户资源根固定 ~/.rdx、项目 <project-root>/.rdx；不加可配置根、旧目录 fallback、双写或静默迁移。Project Scope 覆盖 agents/skills/MCP/hooks/policies/knowledge/memory；CLI executable、参数前缀、工作目录、环境、超时和 secret 为本机边界，project 不得覆盖。
- Prompt 调用经 PromptPlan；产品字段、投影与详细状态约束按下方主题路由读取。

### 本地整洁与清理原则

目标是让工作区只保留有当前用途的资产，降低误用旧产物和重复路径的风险；不是追求空目录或最少文件数。

- **保留要有用途**：区分源码/配置、真实用户数据、当前依赖、验收证据和一次性产物。文件年龄、目录名、是否被 Git 忽略都不能单独决定删除；`.gitignore` 只防入库，不代表本地已清理。
- **减少落盘**：分析和临时计算优先内存或 stdout；测试需要真实文件语义时使用小文件，临时输出集中管理，控制图像数量、尺寸和生命周期。不无故复制大型 RDC、重复上传/安装依赖、生成整套发行包、录像或截图。
- **谁创建，谁收口**：本轮临时目录、测试副本、诊断脚本、日志和 QA 缓存应集中管理，使用结束后清理。范围包括仓库隐藏目录与实际使用的系统临时目录，不能只看 `git status`。明确属于本轮且不再需要的临时产物主动清理，不把收尾留给用户。
- **从生命周期消除残留**：测试和脚本在成功、失败、取消路径释放自有资源；临时目录在使用前创建，在使用后删除，禁止结束清理后又重建空壳。发现重复残留时修正生成/清理逻辑，并复跑验证，不只删除现场文件。
- **路径替代必须完整**：删除被替代文件时同步检查旧目录、入口、文档和引用。无用途的空目录也属于残留；按需创建的目录无需预留占位。不要用新的兼容分支或版本化目录掩盖未收敛路径。
- **证据保留最小充分集**：保留能复查结论、失败边界和恢复依据的必要来源；归档前验证完整性，随后清理重复副本和中间轮次。不得为省空间删除唯一证据，也不得把所有日志、完整测试副本永久打包成“归档”。最终记录与过时计划/PID/中间状态分开，明确适用源码和时间。
- **删除以边界和所有权为前提**：递归操作前核对绝对路径、Git 跟踪状态、进程占用和链接边界；不得沿 junction/symlink 删除其他目录，不回收活进程的锁。真实会话、授权、原始 capture、当前依赖、用户工具配置及尚需恢复的备份不能当作垃圾；非本轮资产或用途不明的内容先列明依据，再按已有授权处理。
- **完成以复查为准**：重新检查删除清单、剩余目录及本轮新生成的产物，报告失败、保留理由和证据位置。清理报告与脚本本身也须收口，只保留必要回执。门禁通过、进程退出、桌面启动权交还与磁盘清理完成是不同事实；逻辑字节量也不等于实际释放空间，不混为完成证明。

## 按任务读取权威与验证

模块字段、历史阶段和完整验收矩阵在主题文档维护，根文件不重复：
- 运行时/安全：DESIGN.md、docs/contracts/runtime-kernel.md、permissions.md、failure-model.md、docs/architecture/agent-runtime-kernel.md。
- Agent/Skill/Hook/Memory：docs/product/scoped-runtime-resources.md；RenderDoc 调查与 handoff：docs/product/renderdoc-agent-complete-design.md。
- RDX 原生协议：docs/architecture/rdx-runtime.md；Browser bridge：docs/architecture/browser-qa-surface.md。
- UI/Composer/Settings：docs/ui/workbench-and-transcript.md、design-system.md、appearance-checklist.md；session gate：docs/contracts/session-projection.md。

关键边界不得回退：IPC parseIpcArgs + 单次 approvalToken；safeStorage fail-closed、无明文 secret IPC；sandbox:true + CSP 禁 inline；Hook/MCP trust 内容/路径/执行身份变更需 retrust；ProcessSupervisor 未观察 close/error 不移除；Turn generation 丢弃迟到事件；只投影 currentSession；RDX per-session lease 无全局镜像，离线 child 不得获得 RDX，unsafe 工具串行；Run 唯一 v3；Memory 活 pid 锁不回收；Knowledge 单一 main-owned 六 lane 五服务、无 Embedding、无自动 Candidate/Memory；Investigation provenance/hash/事务和认识论边界不放宽。

prepareTurn 冻结 PromptPlan / EffectiveRuntimePlan 和本机 RDX binding。预载 skill allowed-tools 取交集，只收窄；skill_read 只读方法，不重算在途权限。普通任务留 General；Mission plan-only → General 执行 → 原 Mission 评估。RDX 共享 shell 手册与三本专业工具手册只提供知识，必须由 execute handoff 的 requiredSkillIds 真实预载，不能授权操作或替代冻结 catalog。Full access 不绕过 Mission/lease/hard deny。Handoff 单一持久状态机，root 最多两轮执行与回评估（初始 route 不计），事件驱动续跑，失败回滚、重启手动继续，取消规则不变。

shell.command 与 shell.rdx 互斥；结构化 RDX 仅 owning General，经审批与冻结原生 CLI。实验关闭必须验证主进程签名回执 baseline/intervention/variant/rollback/restored。旧记录可读；权限拒绝、未执行或 capture hash 不变不是回滚证据。旧 verified 不代表当前版本。

## 验证范围与 Browser QA

- 不得删除测试、弱化断言或跳过必需验收制造通过；判断实现、测试或契约哪一方错误后修正。未受新改动影响的绿色证据直接沿用，新改动只复验受影响范围；旧绿色不能证明新行为，已完成真实链路不无故重复演示。
- 构建、测试、真实回放、窗口可见、设备呈现、模型效果分别记录；合法空结果、读取失败和不支持必须区分，不以空值、固定零值或假成功掩盖失败，观察与推断分别表达。
- 阻塞记录具体错误、触发条件、受影响验收和解除条件；核对错误是否由自身逻辑引起，不能凭错误名宣称外部占用。缺少外部条件时完成其余工作，不反复空转；用户明确延期的验收记为后续范围，不虚标通过或继续当成本轮阻塞。
- 确定性的 Skill 覆盖、参数示例、交接/preload、权限、身份、取消、恢复和回执测试必须完成；真实模型选工具、解释结果及回评估另有实测证据。集成测试不能冒充模型效果，模型运行的可用条件或延期安排不能成为削弱工程验证的理由。

局部改动运行受影响单测、typecheck、lint 和专项 check；跨层集成补完整 tests/coverage ratchet、check:gates、build；发布配置改动才 pack 并检查产物清洁。resource/instruction/prompt/skill/hook/memory 分别执行 check:scoped-resources、check:project-instructions、check:prompt-plan-snapshot、check:skills、check:hooks、check:memory-policy。安全/并发/取消/存储/provider wire 补 check:contracts。模型/tool/Knowledge/Investigation 改动补对应 check:*。AgentOrchestrator façade 必须 <800 行。

main/preload/IPC/workspace/RDX 变更补真实启动或 Browser QA；UI 局部测受影响入口、交互、窄屏/键盘/焦点/disabled/selected/running，集成测跨层链，发布才完整产品矩阵。不得用 Playwright/Electron E2E 作门禁，不造 renderer demo。无设备的 Remote/Android 如实记录阻塞，不以本地成功代替。

Browser QA 默认 disposable start:agent-browser，使用完整 one-time /qa?qaBootstrap=... 进入同源 /app，不直开 Vite，不接受 URL token。仅显式要求真实账号/canonical/T15–T18 才用真实 userData。debug-only bridge 共用 ElectronAPI factory/manifest/handler，未知/内部/明文 secret/desktop-only fail-closed；high-impact 需 QA full access。性能按原生 Event Timing p95/Long Task，不按工具往返或 RAF。

人类入口 `scripts/start-rdc-agent.cmd` / `pnpm run start:human` / `start:human:dev` 与 QA/Electron 共享 canonical `%APPDATA%/rdc-agent/instance.lock`；活 owner 永不回收。启动过 QA/Electron，结束前停止本轮 launcher 及自有子进程，确认 lock 不存在或 owner 已死；不得停止用户的其他进程。改 launcher/main/window/userData 或跑 QA 后验证桌面不因占锁失败，并报告「桌面启动权已交还」。验收写 docs/product/acceptance-ledger.md，保留历史来源、SHA、日期；只标记实际通过的对应场景。

会话投影变更运行 `pnpm run check:session-projection`，右栏变更运行 `pnpm run check:right-rail`。

## Right Rail single-track gate

Session rail 为 Progress / Artifacts / Outputs / Context / Capture，投影契约见 `docs/contracts/session-projection.md`。

## RDX 操作契约

RDX 接口只维护当前操作契约；包发布号仅用于安装诊断，不设 major-version 权限门槛。接入必须校验真实 catalog 指纹、参数、能力和 JSON 格式，手册引用当前生成定义，不绑定 V1/V2。

操作定义、参数约束、scope、effects 与证据类型来自配置 CLI 的完整 catalog；prepareTurn 冻结目录指纹、CLI 配置和 owning lease。应用固定生命周期通过原生调用边界生成 argv，不恢复自定义生命周期命令、catalogPath 或 JSON 模式配置。普通执行由主进程校验能力、身份、路径和前置条件；Skill 只提供知识，不能授权。专业手册参考通过生成器更新，Mission execute handoff 的 requiredSkillIds 必须在 General prepareTurn 实际加载。详见 docs/architecture/rdx-runtime.md。

专业 Agent 只需完整掌握职责内的工具集合；用途、参数、结果解释、示例和限制由明确成员清单与生成参考覆盖，不复制全部工具箱。共享 CLI/身份/输出/恢复知识只维护一份，专业手册引用；Mission → General → Mission 复用现有交接，不能仅用提示词中的 Skill 名称代替实际加载。

软件固定生命周期、身份与结果校验由主进程负责；普通工具知识不做名称白名单或额外配置表。CLI、catalog 和执行必须来自同一安装，手册不授权，设备/会话/路径等安全约束不因目录声明而绕过。

## Capture replay 改动门禁

项目 RDC 为空的原空态必须保持。修改 Capture 时同时核对 per-session runtime、context 串行执行、Agent 生命周期锁、requested/applied/image EID 和内容 hash。内嵌回放不得恢复应用 human-preview 窗口或旧 Settings action；不要删除 Tools 独立 CLI 的有效窗口能力。足迹与用户 capture/正式证据分开管理。Android 设备呈现必须有真实回执，`unsupported` 不能标绿。除既有专项门禁，运行 `RdxSessionRuntime`、`RdxSessionService`、`executeRdxShell`、ReplayHistoryStore 的受影响测试。

软件应处理用户正常环境，不要求连接前清空设备进程。Android helper 的启动、已有服务连接、就绪检查和自有资源清理由 Tools 统一实现，Agent 复用并展示准确状态与恢复入口，不另写一套设备进程逻辑。进程存在不等于服务被占用；复用用户 helper 不代表取得关闭、重装或修改配置的权限。
