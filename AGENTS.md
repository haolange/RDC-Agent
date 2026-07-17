# AGENTS.md

## 范围

本文件只约束 `RDC-Agent` 仓库内的修改方式、文档治理和交付边界。

本仓库是面向 RenderDoc `.rdc` capture 的 Electron 桌面应用，核心代码分布在 `src/main`、`src/preload`、`src/renderer` 和 `src/shared`。若本文件与系统、平台安全规则或用户本轮明确指令冲突，以更高优先级指令为准，并在交付说明中指出采用了哪个约束。仓库内部文档之间出现冲突时，产品边界、架构边界和验证门禁以 `DESIGN.md` 为准，再同步修正文档。

## 修改原则

- 涉及 UI/UX、产品设计、架构边界、跨层契约、feature 拆分或验证策略时，必须先阅读 `DESIGN.md`，再阅读相关 `docs/architecture/*` 文档。
- 根目录只放仓库入口、总体说明和跨层约定，不要把具体 agent、stage 或 tool 的领域规则重复写到仓库根。
- 仓库保持标准 Electron 应用布局，`Config`、`Saved`、`Intermediate`、`Binaries` 属于运行期或构建期概念，不要重新引入为仓库顶层源码目录。
- 涉及主进程、预加载脚本、渲染层、共享类型时，优先保持一次改动内联动更新，避免只改单层造成契约漂移。
- 新增或调整 agent 角色、工作流阶段、IPC 事件、共享类型时，必须同步检查 `src/shared`、`src/main` 和对应 UI 页面是否一致。
- 不要保留明显的 legacy 双轨入口、镜像目录或“临时兼容”文案。新结构替代旧结构时，直接收敛到单一路径；除非用户本轮明确要求兼容，否则不得为了旧字段、旧入口或旧语义增加兼容层、迁移 shim 或静默 fallback。
- 路径引用应以本仓库为基准，不要硬编码上游仓库的绝对路径。
- 不要把 Nexus、CodePilot、上游 Frameworks 或 Tools 仓库的路径、概念或兼容面直接写成本库前提；如需引用，只能作为明确标注的对照参考。
- 文档以中文为主，必要的英文术语保留原样，例如 `RenderDoc`、`.rdc`、`Electron`、`IPC`、`LLM`、`Debugger`、`Analyzer`、`Optimizer`。

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

## 代码与文档边界

- `src/main` 负责窗口、菜单、IPC、工作流编排和外部能力接入。
- `src/preload` 负责受控暴露给渲染层的 API。
- `src/renderer` 负责界面、交互、状态展示和用户入口。
- `src/shared` 负责跨层共享的常量、类型与工具函数。
- `docs/` 只放稳定设计说明、流程说明和使用文档，不要把运行时代码规则写回文档层。
- `docs/` 下的正式文档应按稳定主题归类到 `product/`、`architecture/`、`workflows/`、`ui/`。
- `resources/` 只放需要随应用分发或运行时依赖的资源；`scripts/` 只放可复用的开发脚本。

## UI / UX 约束

- UI/UX 迭代必须关联 `DESIGN.md`：先确认本次改动是产品变更、结构保真迁移，还是缺陷修复，再决定验证范围。
- 默认以现有 UI/UX 效果保真为准，不要借重构、整理、命名收敛或类型迁移之名改变既有布局结构、交互路径、信息层级和视觉节奏。
- 涉及页面结构、面板布局、状态展示、样式引用或视觉资源路径时，必须确认属于明确的产品变更；如果不是，应保持现有效果不变。
- 修复结构问题时，不要顺手做与任务无关的视觉改版、布局重排或交互重定义。
- 涉及 `src/renderer` 的改动，除检查类型和功能外，还要检查界面入口是否完整、关键面板是否可渲染、现有交互是否可达。
- Settings 内 Agents / Skills / Tools / Hooks 的 scoped 编辑条不展示装饰性 “RDX Runtime” kicker；User | Project 独占作用域行且横向 `1fr 1fr` 拉满均分。Skills/MCP/Hooks/Policy 内容区为 Import + New 列表与右侧详情编辑器；Agents 不在 scope 条上放 New（仅 Agents 工具栏 Import + New Agent）。Workspace「RDX Runtime 根目录」与 Control Panel「RDX 运行时上下文」职责不同，不得一并删除。

## 设计系统约束（agent 写 CSS 必读）

**权威文件**：`DESIGN.md` 的"设计系统与视觉语言"章节。本节是该章节的快速执行摘要。

### Token 使用规则

- **必须**引用语义 token（`--token-*`），禁止在组件 CSS 中直接用 primitive token（`--color-bg-3`、`rgb(var(--color-accent-500))` 等）。
- `--token-*` 完整定义在 `src/renderer/styles/design-system.css` 的 "Semantic Token Layer" 部分。
- 边框 token 已内含 alpha，使用方式为 `rgb(var(--color-border-subtle))`，**禁止**追加额外 alpha：`rgb(var(--color-border-subtle) / 0.65)` 是无效 CSS。
- 字号必须用 `var(--text-*)` 变量，**禁止** px 字面值。
- 间距必须用 `var(--space-*)` 变量，**禁止**奇数像素值（3px、7px、9px）。

### 按钮规则

- 全局唯一按钮系统：`.button`（基类） + `.button-primary / button-secondary / button-ghost / button-danger`，定义在 `panels-composer.css`。
- React 层用 `<Button variant="primary|secondary|ghost|danger" size="sm|md|lg">`（`src/renderer/ui/Button.tsx`）。
- **禁止**新增第三套按钮类名，禁止在 feature CSS 中重复定义按钮样式。

### 颜色使用规则

- 强调色（`--color-accent-*`）只用于：焦点环、激活状态、主要 CTA。不得用于正文、装饰或多处背景。
- 状态色（success / warning / error / info）只用于语义状态，不得挪作装饰。
- `--token-effort-*` 紫色阶专用于 Composer effort 强度渐进指示（滑杆填充/thumb，以及 Max 顶档暗轨像素场演化），不得挪作其它装饰或背景。
- `--token-context-*` 色阶专用于 Context breakdown 弹窗的分段条与图例色点，不得挪作其它装饰或背景。
- 不得引入非 design-system.css 定义的新颜色；需要新颜色时先在 `--token-*` 层添加并说明用途。

### 新增组件规则

每个新组件必须：
1. 覆盖所有交互状态：rest / hover / active / focus / disabled（按需加 loading / error）。
2. 通过 CSS 变量控制 variant，不得在选择器里硬编码颜色。
3. 不使用内联 `style={{}}`，动态值（宽度百分比、JS 计算值）例外。
4. 文件行数不超过 300 行（组件）/ 200 行（hook / service）。

### 视觉参考

`designs/rdc-agent-design-system/Design System Preview.html`——在浏览器打开，可交互查看所有 token、组件规范和完整 dark/light 两套主题展示。写新组件前应先参考对应 section。

## 浏览器真实会话边界

- agent 日常 UI/功能验证默认使用 headless 浏览器真实会话：设置 `RDC_AGENT_HEADLESS=1` 启动应用主进程，再用主进程输出的 `http://127.0.0.1:<port>/app` 打开同一套 renderer。
- 浏览器真实会话通过 localhost bridge 连接真实 `main process`、workspace、settings、LLM runtime、事件流和已配置的 RDX CLI invoker；不得新增渲染层本地样本或演示场景作为验收入口。
- Electron 窗口仍通过 `preload -> IPC` 进入主进程；浏览器真实会话通过 `localhost bridge -> IPC handler registry` 进入主进程。两条路径必须共享同一套 main/runtime 能力。
- 涉及 UI/UX、布局、消息流、状态展示、样式、面板可达性的改动，优先用浏览器真实会话和内置浏览器点击/截图验证。
- 产品级浏览器评审必须至少覆盖：Workbench 初始状态、Project/Session 入口、`.rdc` 导入或打开状态、Settings > Providers、Settings > Agents、桌面与窄屏视口、水平溢出检查、长路径/中文文件名显示、按钮 disabled/active 状态和前后端数据一致性。
- Composer 性能回归使用同一真实 `/app?qaPerformance=1` 页面读取 `data-rdc-qa-performance`，以原生 Event Timing 的 click-to-next-paint p95 和 Long Task 为准；16 ms 以下未上报 entry 按阈值保守计入，不支持 Event Timing 时 fail-closed。不得用 Browser 工具调用往返时间或后台节流的 RAF cadence 替代 renderer 指标；默认 `/app` 不得安装该探针的 listener 或 observer。
- 涉及 `src/main`、`src/preload`、窗口、IPC 注册、workspace 权限、RDX CLI invoker 或 `RenderDoc` 本地链路时，补真实启动检查或内置浏览器真实会话；禁止把 Playwright/Electron E2E 作为门禁。

## RDX CLI Invoker 边界

- 本仓库不保留内置 RDX tool 副本，不把任何 tool bridge、MCP server 或仓库资源目录作为默认执行链；RenderDoc/RDX 能力必须来自系统安装或用户配置的外部 CLI。
- Open `.rdc`、connect remote、preview、close runtime 等垂直入口必须经 Settings 中配置的 RDX shell action 进入 `ShellInvocationService`；不得在主进程、preload、renderer 或打包配置中写死 CLI 命令、catalog 路径或仓库 fallback。
- 新增 RDX CLI 配置项时必须同步 `src/shared/types/settings.ts`、`SettingsService` sanitize、Settings UI 和文档；不得在调用点硬编码命令、catalog 路径或环境变量。
- renderer/preload 不暴露任意 tool execute 入口；UI 只读取 catalog、runtime summary 和 trace projection，实际执行由主进程根据 workflow/runtime policy 调用配置的 CLI。

## 产物与命名治理

- 不要把构建输出、测试输出、日志、workspace 本地数据、缓存文件或临时调试文件提交到源码目录或根目录。
- 源码依赖统一使用 `pnpm@11.7.0`；`pnpm-workspace.yaml` 将 store 固定到 `~/.cache/rdc-agent/pnpm-store`。不得新增 npm/Yarn lockfile、npm fallback、盘符根目录 store 或第二套启动路径。
- `node_modules/`、`out/`、`release/` 和 launcher prepare state 只属于源码开发/构建期；发布包不得包含 pnpm、lockfile、源码 launcher 或开发缓存。
- 不要在仓库根目录留下临时脚本、一次性测试文件、零字节垃圾文件或含义不明的实验文件名。
- 新增目录、脚本和文档时，命名应表达稳定职责，不使用临时性、讨论式或个人化命名。
- 不允许提交 mojibake/乱码文案。若终端显示异常，先用文件搜索或十六进制/编辑器确认真实字节，再决定是否修复。
- Agent Runtime 的用户资源根固定为 `~/.rdx`，项目资源根固定为 `<project-root>/.rdx`。不得新增可配置 workspace root、旧目录 fallback、双写或静默迁移。
- Project Scope 必须覆盖 agents、skills、MCP、hooks、policies、knowledge 和 memory；RDX CLI action 与 secret 仍属于本机边界，不能由项目覆盖。
- Prompt 调用链必须经 `PromptPlan -> RequestEnvelope -> provider adapter`。新增上下文来源时必须提供 scope、source、hash、precedence 和脱敏策略。
- Provider/Model 事实只能写入 `src/shared/provider-catalog/manifests` 的严格 JSON；TS 只实现 Schema、compiler、Registry、Resolver、Planner、adapter、auth 与 discovery。禁止恢复 TS preset、factory 推导、名称/后缀/上游 SDK 包元数据/hostname 猜测或 renderer 静态 Catalog。
- Fast、Reasoning Max、Max mode 与 variant 必须由 `ControlDefinition + ExecutionBinding` 编译；可选控件没有唯一可执行路径时 fail-closed。认证 secret/header 只能进入主进程 opaque credential lease，不得进入 manifest、Route、RequestPlan、IPC 或 Trace。
- Memory 写入必须由明确用户意图或交互审批触发；禁止恢复轮次自动抽取、自动 consolidation 或全索引 prompt 注入。

## 修改时的检查项

- 是否存在只改 UI 没改 IPC 或共享类型的情况。
- 是否存在只改主进程没改渲染层入口或状态展示的情况。
- 是否引入新的重复定义、旧命名或兼容分支。
- 是否把运行期 / 构建期产物错误地带回仓库结构。
- 是否让现有 UI/UX 的布局、交互或视觉效果发生非预期退化。
- 是否需要同步更新 `README.md`、`docs/` 或注释中的说明。

## 验证建议

- 开始实现前先写明本次验证方式；实现后按该方式验证并报告结果。无法运行的验证，必须说明原因和剩余风险。
- 代码改动后执行 `pnpm run typecheck`。
- 依赖、入口、构建、发布配置或仓库目录治理改动后执行 `pnpm run check:repository-hygiene`。
- renderer 结构或 UI 锚点改动后执行 `pnpm run check:architecture`、`pnpm run check:fidelity`、`pnpm run check:shared-exports`。
- Work Process 投影、工具行文案/图标或 transcript UI 改动后执行 `pnpm run check:work-process`、`pnpm run check:work-process-tool-coverage`。
- Work Process UI 验收必须覆盖：运行中顶层「工作中 / Working」与 Active Signal 文本能量扫光、完成后「工作过程 / Work process」+ meta、loop thinking 完成态「已思考 · {duration} / Thought for」+ 前置 quiet icon、commentary 散文（markdown，不进 thinking 槽）、统一单披露 tool 卡片（header icon+动词 + **结果优先** 族 body：有结果时显示计数/路径样本等，运行中才回退 pattern/path/`$ cmd`；展开为族内容层 + 样式化 Raw 面板；默认不展开 Raw；无 verb/target 双轨 toggle、无 `toolGroup` 双层壳）或 ≥8 聚合摘要行、同 loop 连续 tool 外距 `--space-3`（thinking/commentary → 首个 tool 入场呼吸更大）、file/search/shell/git/web/generic 族模板一致、安静 loop 级轨道点、web_search/fetch source pills、无 Reply 边界行（收束 thinking 归入普通折叠）、Request Inspector 不出现在消息流也不在右侧默认会话/Trace 面板、真实事件驱动的逐条出现与短 CSS 入场（禁止假 stagger）、**assistant full-bleed**（最终答案与 Work Process 含 tool 卡片横跨 transcript rail 全宽并与 composer 对齐；仅用户 prompt 使用 raised bubble、fit-content、右对齐）、**MessageMarkdown**（commentary 与最终答案：GFM、代码块 language+复制、KaTeX、Mermaid fail-closed；thinking/CoT 保持纯文本）、**Appearance 默认关**：`composerMarkdown`（composer Write/Preview + 高亮，开启后已发送用户气泡也走 Markdown）、`usePointerCursors`（`html[data-pointer-cursors='true']` 手型光标）。
- provider thinking 投递或 reasoning artifact 投影改动后执行 `pnpm run check:reasoning-delivery`。
- Provider/model/Composer control 改动的真实验收必须覆盖：`reasoning unknown` 显示中性 `未验证 / Provider managed`、`none` 才锁定 `Off`、canonical wire `xhigh` 统一显示 `Extra` 且产品最高档为 `Max`、上下文开关只叫 `Max mode / Max 模式`（reasoning 的 `Max` 不变）、固定 Max mode 开启且不可关闭、快速 A→B→C 只保留最新 revision、在途 turn 保持创建时冻结的 `RequestPlan`、切换和输入不触发 Context preview IPC、发送后依次显示 `Preparing` / `Current request ~` / provider `Actual`、缩窗只在发送 preflight 内派生压缩视图而不提前改写历史。
- scoped resource、project instruction、prompt snapshot、skill、hook 或 memory policy 改动后，必须执行相应专项 contract check；缺少时应在同一改动中补齐。
- 入口、构建或窗口逻辑改动后，再补 `pnpm run build` 或等价打包检查。
- 发布配置改动后执行 `pnpm run pack`，并确认 unpacked 产物不包含开发期包管理器、lockfile、launcher 和缓存状态。
- 浏览器真实会话使用 `pnpm run start:agent-browser`；Windows 也可用 `scripts/start-browser-session.cmd`，macOS/Linux 使用对应 `.sh`，然后用 Codex 内置浏览器打开主进程输出的 `/app`。
- 人类开发入口使用 `pnpm run start:human:dev`，源码构建入口使用 `pnpm run start:human`；平台包装器只转发到共享 launcher，依赖与 build 由指纹条件式准备，发布模式直接双击 exe / app 包。
- Provider 体系契约验证使用 `pnpm run check:provider-system`。
- Provider Catalog strict manifest 与编译语义验证使用 `pnpm run check:provider-catalog`。
- Builtin 工具目录、manifest token 展开与 `REJECTED_TOOL_TOKENS` 契约验证使用 `pnpm run check:tool-system`。
- Settings Agents 路由契约验证使用 `pnpm run check:settings-agents`。
- 产品级本地验收通过真实浏览器会话完成，并指向真实 project 和 `.rdc`；RDX/RenderDoc 失败必须 fail-closed 并显示诊断。
- 涉及工作台交互、页面结构、样式引用或共享契约的改动后，至少补一次关键 E2E smoke 或等价人工回归，确认主界面、关键面板和主要交互未退化。
- 仅文档改动时，检查术语、路径和描述是否与当前仓库结构一致。
