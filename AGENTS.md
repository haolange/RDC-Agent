# AGENTS.md

## 范围

本文件只约束 `RDC-Agent` 仓库内的修改方式、文档治理和交付边界。

本仓库是面向 RenderDoc `.rdc` capture 的 Electron 桌面应用，核心代码分布在 `src/main`、`src/preload`、`src/renderer` 和 `src/shared`。若本文件与系统、平台安全规则或用户本轮明确指令冲突，以更高优先级指令为准，并在交付说明中指出采用了哪个约束。仓库内部文档之间出现冲突时，产品边界、架构边界和验证门禁以 `DESIGN.md` 为准，再同步修正文档。

## 修改原则

- UI/UX、产品、架构、跨层契约、feature 拆分与验证策略先读 DESIGN.md 的 Architecture Principles / Authority Map，再读相关 docs/contracts/*、docs/architecture/*；视觉权威是 docs/ui/design-system.md。
- 根目录只放入口和跨层约定，领域规则归稳定主题文档。标准 Electron 布局，不恢复顶层 Config/Saved/Intermediate/Binaries。
- main/preload/renderer/shared 联动；角色、阶段、IPC、共享类型须核对 runtime 与 UI。只改本次必需文件，不添加兼容 shim、双写双读或静默 fallback，替代路径删除旧入口与文案。
- 路径相对本库；上游仓库概念只作标记明确的对照，不能成为运行前提。文档中文为主，保留必要技术术语。

## 执行纪律

- 默认在用户当前所在分支直接修改、提交和推送；除非用户明确要求新分支、PR 或隔离工作树，否则不得擅自创建或切换分支，也不得因为平台默认工作流而改变分支。
- 用户要求“提交”“上传”或“推送”时，以对应 Git 操作成功为交付完成点。GitHub Actions 等云端 CI 属于异步检查：触发后立即报告链接与当时状态，不得阻塞等待；只有用户明确要求守候、确认全绿或处理 CI 失败时，才持续监控并修复。
- 实现前必须先界定本次目标、可验证的成功标准、验证方式和关键假设。
- 遇到需求不明确或存在多种合理解释时，先按影响分级处理：
  - 会导致 data loss、公开 API/IPC/共享类型破坏、schema/workspace 迁移、安全/权限边界变化，或不可安全回滚的产品语义变化时，属于 Blocking Ambiguity，必须先停下来提出澄清问题。
  - 影响范围局限、可回滚、可通过测试或 smoke 验证的歧义，属于 Non-blocking Ambiguity，应显式写明假设、风险和回滚方式后继续推进，不要静默选择。
- 默认采用最小可行修改，不新增未被要求的功能、抽象、配置项、扩展点或兼容层。
- 只修改完成当前目标必需的文件和代码，每一处 diff 都应能对应到本次请求、验证失败或本文件已有约定。
- 新路径替代旧路径时，应同步删除旧入口、旧文案、旧默认路径或无意义兼容分支，避免留下 legacy / deprecated 双轨。
- 临时兼容只能在用户明确要求、外部不可控依赖强制需要，或无法一次性安全迁移时使用；采用前必须说明原因、边界、移除条件和验证方式。默认实现不得保留旧字段/新字段双写、旧入口/新入口双轨或 deprecated 分支。
- **桌面启动权**：人类入口 `scripts/start-rdc-agent.cmd` / `pnpm run start:human` / `start:human:dev` 与任何 Electron 实例互斥占用 canonical `%APPDATA%/rdc-agent/instance.lock`。活 pid **永不回收**；headless Browser QA 占着这把锁时，桌面启动会立刻 `userData is already in use` 并 exit 1。这不是应用坏了。
- Browser QA **默认** disposable `os.tmpdir()/rdc-agent/qa-*`。只有用户本轮明确要求真实账号、canonical 会话或 T15–T18 真实验收时，才允许 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 或 `RDC_AGENT_USER_DATA`。
- 本轮只要启动过 Browser QA / Electron，**结束前必须停掉**对应 `start:agent-browser` 及其 electron/node 子进程，确认 `instance.lock` 不存在或 owner pid 已死，并在交付说明写「桌面启动权已交还」。禁止把 headless 整晚挂在 canonical userData 上，也不得把「桌面起不来」留给用户。
- 改过 launcher、主进程入口、窗口、userData 或跑过 Browser QA 后，宣称可交付前必须确认桌面入口不再因占锁失败。不得只跑 headless 就结束。

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
- 目录与文件按稳定职责命名；不提交乱码，先核实原始字节。
- 用户资源根固定 ~/.rdx、项目 <project-root>/.rdx；不加可配置根、旧目录 fallback、双写或静默迁移。Project Scope 覆盖 agents/skills/MCP/hooks/policies/knowledge/memory；RDX action、executable 和 secret 为本机边界，project 不得覆盖。
- Prompt 调用经 PromptPlan；产品字段、投影与详细状态约束按下方主题路由读取。

## 按任务读取权威与验证

模块字段、历史阶段和完整验收矩阵在主题文档维护，根文件不重复：
- 运行时/安全：DESIGN.md、docs/contracts/runtime-kernel.md、permissions.md、failure-model.md、docs/architecture/agent-runtime-kernel.md。
- Agent/Skill/Hook/Memory：docs/product/scoped-runtime-resources.md；RenderDoc 调查与 handoff：docs/product/renderdoc-agent-complete-design.md。
- RDX 原生协议：docs/architecture/rdx-runtime.md；Browser bridge：docs/architecture/browser-qa-surface.md。
- UI/Composer/Settings：docs/ui/workbench-and-transcript.md、design-system.md、appearance-checklist.md；session gate：docs/contracts/session-projection.md。

关键边界不得回退：IPC parseIpcArgs + 单次 approvalToken；safeStorage fail-closed、无明文 secret IPC；sandbox:true + CSP 禁 inline；Hook/MCP trust 内容/路径/执行身份变更需 retrust；ProcessSupervisor 未观察 close/error 不移除；Turn generation 丢弃迟到事件；只投影 currentSession；RDX per-session lease 无全局镜像，离线 child 不得获得 RDX，unsafe 工具串行；Run 唯一 v3；Memory 活 pid 锁不回收；Knowledge 单一 main-owned 六 lane 五服务、无 Embedding、无自动 Candidate/Memory；Investigation provenance/hash/事务和认识论边界不放宽。

prepareTurn 冻结 PromptPlan / EffectiveRuntimePlan 和本机 RDX binding。预载 skill allowed-tools 取交集，只收窄；skill_read 只读方法，不重算在途权限。普通任务留 General；Mission plan-only → General 执行 → 原 Mission 评估。Full access 不绕过 Mission/lease/hard deny。Handoff 单一持久状态机，root 最多两轮执行与回评估（初始 route 不计），事件驱动续跑，失败回滚、重启手动继续，取消规则不变。

shell.command 与 shell.rdx 互斥；结构化 RDX 仅 owning General，经审批与冻结原生 CLI。实验关闭必须验证主进程签名回执 baseline/intervention/variant/rollback/restored。旧记录可读；权限拒绝、未执行或 capture hash 不变不是回滚证据。旧 verified 不代表当前版本。

## 验证范围与 Browser QA

局部改动运行受影响单测、typecheck、lint 和专项 check；跨层集成补完整 tests/coverage ratchet、check:gates、build；发布配置改动才 pack 并检查产物清洁。resource/instruction/prompt/skill/hook/memory 分别执行 check:scoped-resources、check:project-instructions、check:prompt-plan-snapshot、check:skills、check:hooks、check:memory-policy。安全/并发/取消/存储/provider wire 补 check:contracts。模型/tool/Knowledge/Investigation 改动补对应 check:*。AgentOrchestrator façade 必须 <800 行。

main/preload/IPC/workspace/RDX 变更补真实启动或 Browser QA；UI 局部测受影响入口、交互、窄屏/键盘/焦点/disabled/selected/running，集成测跨层链，发布才完整产品矩阵。不得用 Playwright/Electron E2E 作门禁，不造 renderer demo。无设备的 Remote/Android 如实记录阻塞，不以本地成功代替。

Browser QA 默认 disposable start:agent-browser，使用完整 one-time /qa?qaBootstrap=... 进入同源 /app，不直开 Vite，不接受 URL token。仅显式要求真实账号/canonical/T15–T18 才用真实 userData。debug-only bridge 共用 ElectronAPI factory/manifest/handler，未知/内部/明文 secret/desktop-only fail-closed；high-impact 需 QA full access。性能按原生 Event Timing p95/Long Task，不按工具往返或 RAF。

本轮启动过 QA/Electron，结束前停止本轮 launcher 及子进程，确认 lock 不存在或 owner 已死；不得停止用户的其他进程。改 launcher/main/window/userData 或跑 QA 后验证桌面不因占锁失败，并报告「桌面启动权已交还」。验收写 docs/product/acceptance-ledger.md，保留历史来源、SHA、日期；只标记实际通过的对应场景。

会话投影变更运行 `pnpm run check:session-projection`，右栏变更运行 `pnpm run check:right-rail`。

## Right Rail single-track gate

Session rail 为 Progress / Artifacts / Outputs / Context / Capture，投影契约见 `docs/contracts/session-projection.md`。
