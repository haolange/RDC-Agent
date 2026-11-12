# AGENTS.md

## 范围

本文件约束在 `RDC-Agent` 仓库内工作的编码 Agent：怎样交付、怎样改代码、怎样验证、怎样汇报，以及本仓库的专属硬约束。

本仓库是面向 RenderDoc `.rdc` capture 的 Electron 桌面应用，代码分布在 `src/main`、`src/preload`、`src/renderer`、`src/shared`。本文件与系统、平台安全规则或用户本轮明确指令冲突时，以更高优先级指令为准。仓库内部文档冲突时，产品边界、架构边界和验证门禁以 `ARCHITECTURE.md` 为准，再同步修正其他文档。

## 1. 目标对齐与完整交付

以代码事实与真实运行证据为依据，在授权范围内端到端完成用户需求。

- **锁定原始量级**。开始前识别任务目标、既有约束与验收条件，保持用户原始目标的工程量级。不降级为 Demo、局部草稿、伪代码框架或半成品。
- **按任务形态停手**。
  - 执行与改造类：完成"代码调查 → 根因定位 → 实现 → 真实构建与验证 → 旧路径清理"的闭环，不停留在建议。
  - 规划、研究、审计与报告类：直接交付结论鲜明的成果；未获指令前不修改业务代码，不执行发布。
- **自主推进**。已授权且在安全边界内的工作一路做完，不在中途询问"是否继续"。
- **阻塞隔离**。遇到真实外部阻塞（缺密钥、硬件不可用、权限受限）时，先把不依赖它的部分全部做完，最后一次性列出阻塞点与最小解阻条件。
- **收口**。用户要求收口时冻结范围，沿最短依赖链完成剩余项；只有明确的验收失败、可复现错误或实际权限漏洞才扩大修复。
- **计划与进度**。垂直调查的当前计划是 `docs/workflows/vertical-investigation-convergence.md`，进度写在它的状态表里。状态只用 `待执行 / 执行中 / 待验证 / 通过 / 阻塞`；代码完成是"待验证"，真实验证通过才是"通过"。不另建计划、交接或总结文档。

## 2. 架构与代码工程铁律

修改前先理清当前模块的 data flow、ownership、lifetime 与调用链契约。

### 2.1 Boundary Contract + Happy Path + Fail-Fast

- **边界校验一次**。在系统入口、外部输入和跨模块边界做严格的契约校验（schema validation、type guard、assert）。本仓库的边界是：IPC handler、preload 暴露的 API、模型 tool 入参、RDC-Tool CLI 返回、磁盘读回的持久记录、Provider 响应。
- **内部信任契约**。边界之内的核心路径直接信任已校验的数据，不重复判空，不写推测性的防御分支。
- **异常就失败或重置**。错误路径用 fail-fast、transaction rollback、generation／lease 失效或外层状态重置处理。本仓库已有的原语优先复用：调查记录的事务提交、Task execution 的 generation、RDC lease 的 quarantine 与受控恢复、capture 入口位置恢复。
- **不写 silent fallback**。不为了"不报错"吞掉异常、返回空值或替换成默认值。本层处理不了的失败按 `docs/contracts/failure-model.md` 向上报告；重试或兜底须有该契约里的明确依据。数据无法解释时在返回里显式标注，不伪造。
- **一处修正优先于逐项加判断**。准备给多种情形分别加分支时，先找到负责该行为的那一处，让这些情形自然正确。只有需求、契约或已复现的问题要求区别对待时才单设分支。

### 2.2 Evidence-Only

- 每项修改直接服务于用户目标，或解决有明确证据的问题。不做顺手重构、过度抽象和防御性扩展。
- 优先沿用仓库里已证明有效的原语与约定。新能力只服务一个具体步骤、而现有机制已能表达时，复用现有机制。
- **病灶已暴露就动刀**。结构性问题已经有证据时，直接给修改方案或动手修；不建议"先建立一套全维度的 profiling、监控矩阵或分类框架"。

### 2.3 全链路收敛，不留兼容层

- `main / preload / renderer / shared` 联动：角色、阶段、IPC、共享类型的改动须同时核对 runtime 与 UI，并覆盖调用方、数据结构、序列化与配置、状态释放和配套测试。
- 新路径替代旧路径时，同步处理入口、配置、类型、UI、测试和文档，旧路径**当场删除**。不保留 legacy／deprecated alias、兼容 shim、双写双读、平行实现或 feature flag。
- 确实无法直接迁移时，说明具体约束并按用户明确决定执行，不自行留下双轨。

### 2.4 版本控制与环境红线

- 默认在当前分支工作。**未经用户在当前指令中明确要求，且不处于已确认的 Git Worktree 模式时，不创建、切换或删除分支。**
- 提交、推送和发布按用户授权执行；修改授权不自动扩大为发布授权。用户要求"提交""上传""推送"时，以对应 Git 操作成功为完成点；云端 CI 是异步检查，报告链接与当时状态即可，用户要求守候时才持续监控。
- 保护用户数据、未提交的无关修改和非本任务资源。开始前核对当前改动，不覆盖他人工作。
- 多 Agent 协作时，各自的交付与验证边界明确且不重叠；不交叉探索、不重复检查、不空等。

## 3. 事实、证据与判断

- **实锤支撑**。架构判断、性能归因和 bug 定位须有源码行、日志、测试输出、真实运行记录或文档直接支撑。不编造 API，不捏造执行结果。
- **冲突查真相**。代码行为、文档、测试结果或用户描述互相冲突时，去查源码与运行态，以当前实际运行的代码为第一基准，再修正错误的一方。不凭名称或设计意图推断行为。
- **直接决断**。做代码审查、架构评估或方案对比时，给出明确的优劣判断、问题排序和具体改法。
- **用标签标注证据属性，不写免责段落**。在关键结论旁用一个短标签说明它的依据，正文不再重复限定：

  | 标签 | 含义 |
  |---|---|
  | `[源码]` | 读过当前源码得出 |
  | `[静态检查通过]` | typecheck、lint 或门禁通过 |
  | `[单元测试通过]` | 受影响的测试通过 |
  | `[真实模型验证]` | 经真实 Provider 请求验证 |
  | `[实机验证]` | 在真实 capture、回放或设备上验证 |
  | `[需实机验证]` | 改动合理但尚未在真实环境确认 |
  | `[账本 MM-DD]` | 依据验收账本中该日期的记录 |

  不写"我未在当前对话重新编译""这不代表""不能据此推断"这类预防性陈述。一条结论一个标签就够。

## 4. 歧义与授权

- **低风险直接做**。低风险、可局部验证、易回滚的工程选择，直接选最干净的方案落地，不在回复里解释假设和回滚步骤；关键取舍在最终交付里一句话带过。
- **高危先停手确认**。涉及以下任一情况且授权不明确时，暂停该操作并精准提问：
  1. 可能的数据丢失、破坏性写入或外部状态污染；
  2. 破坏公共 API、序列化格式或跨模块契约的不兼容变更；
  3. 大范围不可逆重构、删除核心资产或无法安全回滚的用户可感知变化；
  4. 触及安全、权限、计费或合规边界。
- 影响数据、接口、权限或不可逆行为的未决歧义，尽早集中问清；已有决定不重问。
- 已获授权不重复询问；历史任务的授权不延续到新任务；用户未回复不视为同意。遇到权限或沙箱限制时说明原因，在授权范围内找替代验证方式，不绕过安全机制。

## 5. 验证与完成标准

验证直击真实执行路径。

- **测行为与契约**。测试验证业务行为、数据契约和失败恢复。每个新增或改变的行为一条测试；触发条件不同而机制与预期相同的情形选一个代表。不为假设中的情形补用例，不重复实现细节。
- **Zero Fake-Pass**。不用 mock、硬编码打桩、跳过编译、注释报错代码或旧缓存结果冒充当前代码路径通过。受控 fixture、真实模型请求、真实 RDC 回放是三种不同的证据，互不替代。改动使原有验证失效后重新跑通。
- **失败先判对错**。测试失败时对照权威合同判断代码、测试或环境哪一方有误。不为通过测试恢复已撤回的行为，不删除仍有效的负向约束。
- **覆盖率底线**。`check:coverage-ratchet` 是固定底线，设在实际覆盖率下方几个百分点，只在大幅回退（删掉测试、大块代码无测试）时失败。不为它补测试，也不把底线上调去追当前数字。它失败时说明出了大问题：查原因并报告，不靠补测试过关。
- **停止扩查**。适用的验证通过后停止；只有新的直接失败才补充修复与验证。

### 验证命令

依赖唯一 `pnpm@11.7.0`。

| 改动范围 | 运行 |
|---|---|
| 局部 | 受影响单测、`pnpm run typecheck`、`pnpm run lint`、对应 `check:*` |
| 会话投影 | 另加 `pnpm run check:session-projection` |
| 右栏 | 另加 `pnpm run check:right-rail` |
| 跨层（main / preload / renderer / shared） | 另加 `pnpm run test:coverage`、`pnpm run check:coverage-ratchet`、`pnpm run check:gates`、`pnpm run build` |
| 发布配置 | 才执行 pack |

行为门禁在 `src/main/testing/gates/behaviorChecks.test.ts`。行数与分层由 ESLint `max-lines` / `no-restricted-imports` 执行。

**Browser QA**：用 disposable `pnpm run start:agent-browser`，只消费一次 `/qa?qaBootstrap=...`，进入同源 `/app`。不直开 Vite，不把 token 留在 URL。high-impact 需要 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`。没有设备的 Remote／Android 验证记为阻塞，不以本地成功代替。

**实例锁**：人类入口与 QA 共享 `%APPDATA%/rdc-agent/instance.lock`，活 owner 不回收。本轮启动过 QA 或 Electron 时，结束前停掉本轮进程并交还桌面启动权。

### 交付时的状态

最终交付用一句话说明成果所处阶段，例如 `[静态检查通过]`、`[单元测试通过]`、`[实机验证]`。某一步因环境限制没有执行时，直接写"未执行 X（原因：缺少 Y）"。不把局部通过说成全量验收完成。

## 6. 沟通与交付

默认使用简体中文；技术、架构、硬件与工程术语保留英文原词。

- **结论先行**。第一句给出完成状态、核心根因或最终决断。简单任务几句话说清；复杂任务用清晰的层级和紧凑表格呈现改动与验证结果。
- **说具体行为**。汇报聚焦于改了哪里的什么契约、解决了什么根因、验证结果如何。不只报 Task 编号或术语，不倾倒搜索过程和终端输出。
- **验收账本**。现场证据只写入 `docs/product/acceptance-ledger.md`，每轮一条，不超过 10 行：做了什么、结果、证据位置、人工介入。不写清理流水账、字节数和进程号。

## 7. 仓库结构与权威

| 目录 | 职责 |
|---|---|
| `src/main` | 窗口、菜单、IPC、工作流编排和外部能力接入 |
| `src/preload` | 受控暴露给渲染层的 API |
| `src/renderer` | 界面、交互、状态展示和用户入口 |
| `src/shared` | 跨层共享的常量、类型与工具函数 |
| `docs/` | 稳定的设计与流程文档，按 `contracts/`、`product/`、`architecture/`、`workflows/`、`ui/` 归类 |
| `resources/` | 随应用分发或运行时依赖的资源 |
| `scripts/` | 可复用的开发脚本 |

按任务读取权威：

| 主题 | 权威 |
|---|---|
| 产品、工程架构、跨层契约、feature 拆分、验证策略 | `ARCHITECTURE.md` 的 Architecture Principles 与 Authority Map，再读相关 `docs/contracts/*`、`docs/architecture/*` |
| 运行时、权限、失败模型、投影 | `ARCHITECTURE.md` 与 `docs/contracts/` |
| RenderDoc 领域目标与三种 Mission 的设计 | `docs/product/RenderDoc Agent 完整设计书.md`（第 0 章为产品裁决） |
| Agent、Skill、Hook、Memory | `docs/product/scoped-runtime-resources.md` |
| RDC 操作契约、lease、回放身份、Android 回执 | `docs/architecture/rdc-runtime.md` 与 `ARCHITECTURE.md` 的 Session Capture 节 |
| UI/UX | `DESIGN.md`，详细视觉权威是 `docs/ui/design-system.md` |
| 右栏投影 | `docs/contracts/session-projection.md` |

文档约定：

- 根目录只放入口和长期跨层约定；领域规则归稳定的主题文档。临时禁令、机器路径、PID、某轮进度不写成永久规则。
- 路径相对本库。文档中文为主，保留必要技术术语。上游仓库概念只作标记明确的对照，不成为运行前提。
- 标准 Electron 布局，不恢复顶层 Config／Saved／Intermediate／Binaries。
- 关键边界以 `ARCHITECTURE.md` 的核心 Invariant 为准。Plan 与 generation：Mission 计划门冻结后，用户点声明按钮进入 General，General 就地终答，用户自行切回 Mission。`handoffs` 只驱动建议行和计划门；不存在 `agent_handoff` 工具或自动回 Mission。
- Session rail 为 Progress / Artifacts / Outputs / Context / Capture 单轨。
- Prompt 调用经 PromptPlan。

## 8. 设计系统约束（写 CSS 必读）

Appearance 详细规则见 `docs/ui/appearance-checklist.md`；禁止恢复 translucent / semi-transparent sidebar。

**权威文件**：[`docs/ui/design-system.md`](docs/ui/design-system.md)。本节只保留高层原则。

- **视觉定位**：restrained、高密度、实色分层的精密工具风。不使用装饰性特效或插画；backdrop blur 只允许模态遮罩 `--modal-backdrop-filter`，Dropdown / chrome 仍为实色；单一 accent 只用于 focus / selected / primary CTA。
- **Token**：必须引用语义 token（`--token-*`），禁止直接用 primitive token；字号用 `var(--text-*)`，间距用 `var(--space-*)`，圆角用 `var(--radius-*)`，控件高度用 `var(--control-height-*)`。门禁：`pnpm run check:design-tokens`。
- **按钮**：全局唯一按钮系统 `.button` + variant 修饰类；React 层用 `<Button>`。
- **颜色**：全局 chrome 与 Composer agent accent 是两个体系，见 `docs/ui/design-system.md` 与 `docs/ui/appearance-checklist.md`。
- **状态类**：一律 `is-*`（`is-active` / `is-selected` / `is-running` / `is-disabled`）并配对应 `aria-*`；禁止裸 `.active` / `.current`。
- **焦点**：任何 `:hover` 必须配 `:focus-visible`；禁止 `outline: none` 而不提供等效焦点样式。
- **新组件**：覆盖所有交互状态，通过 CSS 变量控制 variant，不使用内联 style，文件行数 ≤300/200。
- **渲染层分层**由 `pnpm run check:renderer-structure` 与 ESLint `no-restricted-imports` 强制：`ui → lib`；`patterns → ui/lib/stores`（可读 store，不得写 store、不得直调 IPC）；`features` 不得横向 import 其他 feature，也不得 import `app` / `shell`；`stores` / `services` / `hooks` 不得 import `features` / `ui` / `patterns`；组件（`.tsx`）不得直调 `window.electronAPI` / `getElectronApi`。
- 视觉参考：`designs/rdc-agent-design-system/index.html`。

## 9. 产物、依赖与命名

- 构建与测试输出、日志、缓存、workspace 数据和临时文件不入库；根文件受 `check:repository-hygiene` 允许名单约束。
- 依赖唯一 `pnpm@11.7.0`，保留 `pnpm-lock.yaml`；`pnpm-workspace.yaml` 固定 store。禁止 npm／Yarn fallback、根盘 store、第二 launcher。`node_modules`、`out`、`release`、下载缓存和 prepare state 仅本机；发布包不带包管理器、lockfile、源码 launcher 或开发缓存。
- 禁止恢复独立 `cli/`、Playwright `e2e/`、`docs/handover/`。`designs` 只保留 `rdc-agent-design-system`。
- 目录与文件按稳定职责命名，不用 v1/v2、new/old、final 等迭代标签建立并行路径；协议或存储版本只在确有语义需要的边界表达。已有带版本名且仍被引用的实现，先核对调用与契约再收敛。不提交乱码。
- 用户资源根固定 `~/.rdc-agent`，项目资源根固定 `<project-root>/.rdc-agent`；不加可配置根、旧目录 fallback、双写或静默迁移。Project Scope 覆盖 agents／skills／MCP／hooks／policies／knowledge／memory；`plans/<sessionId>/` 只在用户点击「保存到项目」时写入。CLI executable、参数前缀、工作目录、环境、超时和 secret 是本机边界，project 不得覆盖。

## 10. 本地整洁

工作区只保留有当前用途的资产。

- **谁创建，谁收口**。本轮的临时目录、测试副本、诊断脚本、日志和 QA 缓存用完即清，包括仓库隐藏目录和系统临时目录；测试和脚本在成功、失败、取消路径都释放自有资源。重复出现的残留，修生成或清理逻辑，不只删现场文件。
- **少落盘**。分析和临时计算优先用内存或 stdout。不无故复制大型 RDC、重复安装依赖、生成整套发行包、录像或大量截图。
- **删除看边界和所有权**。递归删除前核对绝对路径、Git 跟踪状态、进程占用和链接边界；不沿 junction／symlink 删除其他目录，不回收活进程的锁。真实会话、授权、原始 capture、当前依赖、用户工具配置和尚需恢复的备份不是垃圾。非本轮资产或用途不明的内容，列出依据后按已有授权处理。
- **证据留最小充分集**。保留能复查结论和失败边界的必要来源，清理重复副本和中间轮次；不删除唯一证据。
- **汇报一行**。清理结果只说删了什么、保留了什么及原因。

## 11. RDC 与 Capture 纪律

- RDC 查询、测量和缩略图沿用冻结的 capture／replay／context 身份。
- 临时回放位置必须恢复，并由主进程核验；恢复失败则隔离 lease。
- 能力声明不替代身份检查、实际结果验证和签名回执。
- 归属 daemon 先释放 context 再 `daemon stop`，以进程回执为准；context clear 不等于 daemon／worker 已退出。
- Skill 只提供方法，不授予权限。
- 空项目保持原空态。`unsupported` 不标成设备已呈现。
- 不自动修改 Unity／Unreal 工程或原始 capture。

## 12. 修改产品内 Agent 的方法文本

`resources/agent-runtime/` 下的 Profile、Skill 和 prompt 决定产品里的 Agent 怎样调查，改它们时：

- **证据等级用短标签表达**。产品内 Agent 仍须区分 Observed、Derived、Inferred、Replay-Validated 等等级，不把推测写成事实；但要求它用标签标注，不在报告正文里反复写限定语。
- **写正向主线，不堆禁令**。说明下一步怎样判断和行动。权限、身份、消费和来源已由代码强制的约束，不在方法文本里复述。
- **只减不增**。改动后净字节数不增加；要加一句，先删掉等量的旧内容。
- **不写案例**。方法文本、代码和知识里不出现具体案例的对象、事件、资源编号或原因。
