# AGENTS.md

## 范围

本文件只约束 `RDC-Agent` 仓库内的修改方式、文档治理和交付边界。

本仓库是面向 RenderDoc `.rdc` capture 的 Electron 桌面应用，核心代码分布在 `src/main`、`src/preload`、`src/renderer` 和 `src/shared`。若本文件与系统、平台安全规则或用户本轮明确指令冲突，以更高优先级指令为准，并在交付说明中指出采用了哪个约束。仓库内部文档之间出现冲突时，产品边界、架构边界和验证门禁以 `ARCHITECTURE.md` 为准，再同步修正文档。

## 修改原则

- 产品、工程架构、跨层契约、feature 拆分与验证策略先读 ARCHITECTURE.md 的 Architecture Principles / Authority Map，再读相关 docs/contracts/*、docs/architecture/*；UI/UX 先读 DESIGN.md，详细视觉权威是 docs/ui/design-system.md。
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
- 新增检查、分支、配置、重试或抽象，须能指出其维护的现有合同、当前能力或已复现问题。先明确责任与失败边界，再选择机制；不为尚未发生的输入组合增加补救路径，不在多个层级重复承担同一职责。新路径替代旧路径时同步处理入口、配置、类型、UI、测试和文档，不保留 legacy/deprecated alias、双写双读或无依据 fallback。确实无法直接迁移时，先说明具体约束并按用户明确决定执行，不能自行留下债务。
- 用户要求收口时冻结范围，沿最短依赖链完成原计划剩余项；只有明确验收失败、可复现错误或实际权限漏洞才扩大修复，每次失败先修直接原因，不以假设性风险开启新审查。
- 如使用多 Agent，分配明确、互不重复的交付与验证边界；停止交叉探索、重复检查、空等和频繁切换。是否新增 Agent 遵循当前授权，不把某轮安排固定成永久禁令。
- 用具体行为解释问题和进度：谁在做什么、还差什么、完成条件、实际阻塞和下一步。不要只报 Task 编号、术语或重复历史过程；更新任务状态，而非只追加日志。

- RDC 查询、测量和缩略图沿用冻结的 capture/replay/context 身份。临时回放位置必须恢复并由主进程核验，恢复失败隔离 lease；能力声明不能替代身份检查、实际结果验证和签名回执。归属 daemon 必须先释放 context 再 `daemon stop`，并以进程回执为准；不得把 context clear 当成 daemon/worker 已退出。

## 代码与文档边界

- `src/main` 负责窗口、菜单、IPC、工作流编排和外部能力接入。
- `src/preload` 负责受控暴露给渲染层的 API。
- `src/renderer` 负责界面、交互、状态展示和用户入口。
- `src/shared` 负责跨层共享的常量、类型与工具函数。
- `docs/` 只放稳定设计说明、流程说明和使用文档，不要把运行时代码规则写回文档层。
- `docs/` 下的正式文档按稳定主题归类到 `contracts/`、`product/`、`architecture/`、`workflows/`、`ui/`。
  - `contracts/`：runtime kernel、permissions、failure-model 等跨层契约（ARCHITECTURE 分拆权威）。
  - 产品/架构冲突以 `ARCHITECTURE.md` 裁决，再同步 `docs/**`。
- `resources/` 只放需要随应用分发或运行时依赖的资源；`scripts/` 只放可复用的开发脚本。

## 设计系统约束（agent 写 CSS 必读）

Appearance 详细规则见 docs/ui/appearance-checklist.md；禁止恢复 translucent / semi-transparent sidebar。

**权威文件**：[`docs/ui/design-system.md`](docs/ui/design-system.md)（视觉定位 / Token / 刻度 / 组件规则 / 视觉参考）。本节仅保留高层原则。

- **视觉定位**：restrained、高密度、实色分层的精密工具风。不使用装饰性特效或插画；backdrop blur 只允许模态遮罩 `--modal-backdrop-filter`，Dropdown / chrome 仍为实色；单一 accent 只用于 focus / selected / primary CTA。
- **必须**引用语义 token（`--token-*`），禁止直接用 primitive token；字号用 `var(--text-*)`，间距用 `var(--space-*)`，圆角用 `var(--radius-*)`，控件高度用 `var(--control-height-*)`。门禁：`pnpm run check:design-tokens`。
- 全局唯一按钮系统：`.button` + variant 修饰类；React 层用 `<Button>`。
- 颜色双体系：全局 chrome vs Composer agent accent；详见 [`docs/ui/design-system.md`](docs/ui/design-system.md) 与 [`docs/ui/appearance-checklist.md`](docs/ui/appearance-checklist.md)。
- 状态类一律 `is-*`（`is-active` / `is-selected` / `is-running` / `is-disabled`）并配对应 `aria-*`；禁止裸 `.active` / `.current`。
- 任何 `:hover` 必须配 `:focus-visible`；禁止 `outline: none` 而不提供等效焦点样式。
- 新组件必须覆盖所有交互状态、通过 CSS 变量控制 variant、不使用内联 style、文件行数 ≤300/200。
- 渲染层分层与依赖方向由 `pnpm run check:renderer-structure` 与 ESLint `no-restricted-imports` 强制：`ui → lib`；`patterns → ui/lib/stores`（可读 store，不得写 store、不得直调 IPC）；`features` 不得横向 import 其它 feature，也不得 import `app` / `shell`；`stores` / `services` / `hooks` 不得 import `features` / `ui` / `patterns`；组件（`.tsx`）不得直调 `window.electronAPI` / `getElectronApi`。
- 视觉参考：`designs/rdc-agent-design-system/index.html`。

## 产物与命名治理

- 构建/测试输出、日志、缓存、workspace 数据与临时文件不入库；根文件受 check:repository-hygiene 允许名单约束。
- 依赖唯一 pnpm@11.7.0，保留 pnpm-lock.yaml；pnpm-workspace.yaml 固定 store。禁止 npm/Yarn fallback、根盘 store、第二 launcher。node_modules/out/release/下载缓存/prepare state 仅本机；发布包不得带包管理器、lockfile、源码 launcher 或开发缓存。
- resources 放分发资源，scripts 放可复用脚本；禁止恢复独立 cli/、Playwright e2e/、docs/handover/。designs 只保留 rdc-agent-design-system。
- 目录与文件按稳定职责命名，不以 v1/v2、new/old、final/final2 等迭代标签建立长期并行路径；协议或存储版本只在确有语义需要的边界表达。已有带版本名且仍被引用的实现，须先核对调用与契约再收敛，禁止凭名字直接删除。不提交乱码，先核实原始字节。
- 用户资源根固定 ~/.rdc-agent、项目 <project-root>/.rdc-agent；不加可配置根、旧目录 fallback、双写或静默迁移。Project Scope 覆盖 agents/skills/MCP/hooks/policies/knowledge/memory；`plans/<sessionId>/` 只在用户点击「保存到项目」时写入。CLI executable、参数前缀、工作目录、环境、超时和 secret 为本机边界，project 不得覆盖。
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

模块字段和验收证据在主题文档，根文件不重复。运行时、权限、失败模型和投影见 `ARCHITECTURE.md` 与 `docs/contracts/`。Agent、Skill、Hook、Memory 与调查目标见 `docs/product/scoped-runtime-resources.md` 和 `docs/product/renderdoc-agent-complete-design.md`。RDC 与回放见 `docs/architecture/rdc-runtime.md`。UI 见 `docs/ui/design-system.md`。现场证据只写入 `docs/product/acceptance-ledger.md`。

关键边界以 ARCHITECTURE 核心 Invariant 为准，这里不另写一份。Plan 与 generation：Mission 计划门冻结后，用户点声明按钮进入 General，General 就地终答，用户自行切回 Mission。`handoffs` 只驱动建议行和计划门；不存在 `agent_handoff` 工具或自动回 Mission。

## 验证矩阵

测试锁定可观察行为、已决合同和真实回归，不照抄实现或以穷举未知组合证明可靠性。失败时先对照权威合同判断代码、测试或环境哪一方有误；不能为了通过测试恢复已撤回的行为，也不能删除仍有效的负向约束。完成下列适用验证后停止扩查，只有新的直接失败才补充修复与验证。

局部改动运行受影响单测、`pnpm run typecheck`、`pnpm run lint` 和对应 `check:*`。会话投影跑 `pnpm run check:session-projection`，右栏跑 `pnpm run check:right-rail`。跨层改动补 `pnpm run test:coverage`、`pnpm run check:coverage-ratchet`、`pnpm run check:gates` 和 `pnpm run build`。行为门禁在 `src/main/testing/gates/behaviorChecks.test.ts`。行数与分层由 ESLint `max-lines` / `no-restricted-imports` 执行。发布配置才 pack。

Browser QA 用 disposable `pnpm run start:agent-browser`，只消费一次 `/qa?qaBootstrap=...`，进入同源 `/app`。不直开 Vite，不把 token 留在 URL。high-impact 需要 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`。无设备的 Remote/Android 记阻塞，不以本地成功代替。

人类入口与 QA 共享 `%APPDATA%/rdc-agent/instance.lock`。活 owner 不回收。本轮若启动过 QA 或 Electron，结束前停掉本轮进程，并报告桌面启动权是否交还。

## RDC 与 Capture

操作契约、lease、回放身份和 Android 回执以 `docs/architecture/rdc-runtime.md` 与 ARCHITECTURE 的 Session Capture 节为准。Skill 只提供知识，不能授权。空项目保持原空态。`unsupported` 不能标成设备已呈现。

## Right Rail single-track gate

Session rail 为 Progress / Artifacts / Outputs / Context / Capture。投影契约见 `docs/contracts/session-projection.md`。
