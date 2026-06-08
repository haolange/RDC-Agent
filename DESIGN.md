# RDC-Agent 设计与工程架构准则

## Agentic Trace 目标状态

Agentic Trace 是 RDC-Agent 的**当前消息流协议**，用 `Event Log → Trace Tree → UI Projection → Renderer Registry → Frontend` 替代已废弃的 Agent Workstream（`items[]` / `aw-*` testid）。

正式文档入口：

- `docs/architecture/agentic-trace-protocol.md`：**权威跨层契约**（类型、JSONL 存储、IPC、Renderer Registry、浏览器真实会话、runtime 输出约束）。

关键裁决：

- 消息流 UI 唯一入口：`AgentRunView` + `renderer-registry`（`trace-*` testid），**不保留** `AgentWorkstream` / `MessageTimeline` / `aw-*` legacy。
- Presentation 模型：`AgentRunPresentation.runs[].timeline.nodes[]`；右栏仍为 session 级 `Progress` / `Artifacts` / `Context`。
- 事件存储：`workspace/.rdc-agent/trace/` 下 **JSONL append-only**（`runs/*.json` + `events/*.jsonl`），当前版本不引入 SQLite。
- IPC：`trace:projectionChanged` + `trace:getRun/getEvents/getProjection/exportRun`；`workflow:workstreamChanged` 已删除。
- `Ask` 仍是默认轻入口；`Debugger` 是现役执行主链；Plan Approval 与修改建议保留在消息流与 composer overlay。
- Raw trace 仅在 Tool 卡片 Raw 标签、Inspector 或 export 中出现。
- 浏览器真实会话通过主进程 localhost bridge 打开同一套 renderer，并连接真实 workspace、settings、LLM runtime、Trace 事件流和 ToolBridge；agent 日常验证使用 `RDC_AGENT_HEADLESS=1` 跳过 Electron 桌面窗口，但不拆分 renderer 或 runtime 能力。

`DESIGN.md` 是本仓库的产品设计和工程架构权威入口。`README.md` 说明项目是什么以及如何启动，`AGENTS.md` 说明修改公约，`docs/architecture/*` 说明具体数据流和模块地图；当这些文件出现冲突时，以本文件描述的产品边界、架构边界和验证门禁为先，再同步修正文档。

## 产品边界

- `RDC-Agent` 是面向 `RenderDoc` `.rdc` capture 的 Electron 桌面工作台，不是通用 coding-agent shell。
- 默认用户入口是 `Ask`：它负责只读 agentic 协作、澄清、解释能力、读取/搜索当前 workspace 与公开网页，并引导用户通过应用内 `Open` 打开 `.rdc`；它不创建正式 run，不暴露 RenderDoc mutation 或 shell/write/edit/remove 工具。
- 当前现役主链是 `Debugger`：用户输入目标、进入 plan/intake、回答必要问题、批准计划、执行 RenderDoc 工具链、沉淀 evidence/report。
- `Analyzer` 和 `Optimizer` 是一等产品模式占位，但本仓库默认不把 Debugger harness 自动泛化到这两个模式。
- `Debugger` / `Analyzer` / `Optimizer` 是执行类 UI 模式；只有应用内已有 `OpenedCaptureState(status=open)` 且属于当前 project 时，renderer 才允许选择执行类模式。用户在 prompt 里写 `.rdc` 路径不等同于 Open capture，也不能被自动升级成正式 run。
- 工具执行链必须保持为 `renderer -> preload -> IPC -> ToolBridge -> resources/tools/rdx.bat`。不能从 renderer、preload、MCP、skill 或 provider adapter 绕过 `ToolBridge` 调 RenderDoc 工具。

## Agent Runtime 收敛

- 2026-06-05 runtime kernel baseline：`AgentRuntime` 负责 multi-turn loop、tool mediation events、deterministic policy、ask-user approval events、provider routing 与 trace redaction；`ModelProviderRegistry` 统一 API key / account / local provider capability，包括可 mock 验证的 Grok / Gemini / Qwen account adapters；Debugger multi-agent 执行保持串行，由 `MultiAgentWorkflowEngine` 与 deterministic specialist executor 投影 task graph。
- 本库的 Agent 执行权威是自有 `AgentRuntime`。HTTP provider adapter 或 provider-specific client 只能提供模型流、工具请求格式和 provider 能力适配，不能决定 mode、stage、approval、tool policy 或 final status。
- Agent Runtime 的跨层事实事件是 `AgentEvent`：覆盖 assistant delta/completed、tool requested/started/completed、task/subagent、approval、diagnostic、run completed/failed/cancelled。renderer 只消费该事件投影和 conversation message projection，不展示原始 chain-of-thought。
- `Ask` 是只读 agentic work：默认允许 `primitive.read/glob/grep/webFetch/webSearch/askUser/task.list`，禁止 `bash/write/edit/remove`。若模型请求禁用工具，runtime 必须返回 policy denial，而不是静默执行。
- `Debugger` 绑定 `plan-generate-verify` pattern。首版继续复用现有 Debugger stage 名称，但 pattern contract 明确 planner -> generator -> evaluator 的顺序、plan approval 入口和 verifier/curator 收敛责任。
- `Analyzer` / `Optimizer` 只作为可配置 mode profile 和 pattern 入口保留，不复制 Debugger runtime，也不声明已有专属执行链。计划文档中的 `Profiler` 在当前代码命名中对应 `Optimizer` 占位。
- 内置 profile、stage policy、pattern 和 skill 来自 `resources/agent-runtime/`，启动时 seed 到 workspace；workspace 配置优先。通用 MCP descriptor 仍可由 workspace 配置提供，但不再内置 RDC ToolBridge MCP descriptor。`ExecutionProfileService` 只负责 schema、loader、validator、seed/repair 和 effective runtime profile 解析，不再把默认 profile 内容写死在代码里。
- Settings > Agents 必须同时覆盖 provider/model route 与 runtime ecology：Profiles、Skills、MCP、Patterns。高频 agent route 保持首屏可达；runtime ecology 可折叠，但必须能从 UI 保存到 workspace settings。

## 架构分层

- `src/main`：Electron shell、IPC 注册、工作流编排、workspace 数据、settings、runtime log、terminal、tool bridge、report/evidence 等主进程能力。
- `src/preload`：唯一受控的 renderer API 暴露层。它负责把 `window.electronAPI` 组合出来，不承载业务流程。
- `src/renderer`：工作台 UI、交互状态、用户入口、浏览器 fallback 和 E2E seed helper。
- `src/shared`：跨 main/preload/renderer 共享的常量、类型和纯工具函数。跨层契约必须从这里出发，不在各层重复定义。
- `resources`：随应用分发或运行时依赖的资源，例如 `resources/tools/rdx.bat`。
- `scripts`：可复用开发脚本，不放一次性调试代码。

## 目标目录边界

主进程按领域组织：

- `src/main/workflow/debugger`：Debugger workflow facade、plan/intake、approval、execution lifecycle、LLM payload normalization、blocker normalization、workflow projection。
- `src/main/agent-trace`：Agentic Trace runtime（`TraceService`、`TraceEventStore`、`TraceTreeBuilder`、`ProjectionBuilder`、manifest registry）。
- `src/main/sessions`：project/session/run repository、workspace layout、attachment/output store、JSON/YAML file store。
- `src/main/settings`：settings、provider connection、secret storage、LLM adapter、Debugger LLM route。
- 模型服务商授权属于 settings 边界：API Key/local/environment provider 走 `ProviderConnectionService`，Claude/ChatGPT/GitHub Copilot 这类账号登录 provider 走本库自研 OAuth/device-flow 服务。Claude/ChatGPT Account 使用账号模型目录；GitHub Copilot 使用账号模型目录并用 Copilot `/models` 补充；ChatGPT Account 运行时使用 ChatGPT OAuth token 与账号专用 Codex runtime。GitHub Copilot `/models` 中存在不支持当前 chat completions endpoint 的模型时，运行时 route 必须收敛到同 provider 下可用的 Debugger 模型，不让 specialist loop 因 endpoint 不兼容中断。API Key 和账号 token 只进 secret storage；Bedrock/Vertex 这类 environment provider 使用运行环境凭据，settings 只保存状态和模型列表。
- `src/main/tools`：`ToolBridge`、tool catalog、runtime summary、RDX tool execution helpers。
- `src/main/reports`：artifact store、evidence ledger、report bundle publication。
- `src/main/runtime`：runtime log、terminal session、app path 和 workspace path runtime helpers。
- `src/main/conversation`：conversation persistence、stream/event bridge、conversation-to-workflow request glue。
- conversation message 可以携带脱敏后的 `diagnostic`，用于把 Debugger/Cowork 的模型 route 缺失、provider 不可用或请求失败同步给 renderer 和 Activity；诊断只描述 agent/provider/model/错误分类，不保存 token、secret 或完整请求体。
- conversation-to-workflow 只把应用维护的 `openedCapture` runtime context 投影为 `DebugSessionStartRequest.captures`。prompt、任务文件或项目目录中的 `.rdc` 路径只能作为文本线索提示用户 Open capture，不能绕过应用状态创建正式 run。
- `src/main/captures`：ReplayDevice、capture opened state、context preview。
- `src/main/ipc`：按 API 域注册 handlers，保留一个总注册入口。

渲染层内部分层（依赖方向：`ui` 无业务依赖 → `patterns` → `stream` / `services` → `features` → `shell` / `app`；`platform` 与 `stores` 为 IPC/状态边界）：

- `src/renderer/app`：应用装配（`App.tsx` ≤220 行）、`AppProviders`、`bootstrap/*`（`useAppBootstrap`、`useIpcEventBridge`、`useE2ESeedHarness`）。
- `src/renderer/shell`：布局原语（`AppShell`、`TitleBar`、`WorkbenchLayout`、`PanelZone`、`ResizeHandle`）、`layoutGeometry`、用户菜单。
- `src/renderer/stream`：Agentic Trace UI（`AgentRunView`、`TimelinePanel`、`renderer-registry`、`TraceCards`）。
- `src/renderer/services`：renderer 侧纯逻辑（`conversationTimeline`、`attachmentHelpers` 等），无 React、无 IPC。
- `src/renderer/hooks`：通用 hooks（`useIpcSubscription`、`useResizablePanel`、`useScrollAnchor`）；feature 私有 hook 放各 feature 目录。
- `src/renderer/stores`：分域 Zustand（`projectStore`、`conversationStore`、`workflowStore`、`evidenceStore`、`captureStore`、`sessionStore` 仅 run/usage）+ `selectors/`；`storesReset` 供 case:new / E2E 重置。
- `src/renderer/features/debugger/plan/`：计划审批与问答 UI（`PlanIntakePanel`、`PlanApprovalCard`、`ComposerApprovalOverlay`）。
- `src/renderer/styles/tokens`：RGB 三元组 design token（主题/字号预留）；`global.css` 逐步按域拆分。
- **禁止**重建 `src/renderer/components` 技术桶；基础控件进 `ui/`，展示模式进 `patterns/`。
- `appMeta.testMode` 是 renderer 区分 deterministic E2E seed 与真实运行恢复的跨层信号；只有 test mode seed 才跳过项目输入和 workflow state 恢复，真实构建的自动化 smoke 仍必须恢复待审批 run。
- `src/renderer/features/debugger`：Debugger 业务 UI（`composer/`、`plan/`、ControlPanel 等）。
- `DebugPlan.presentation` 只在消息流中渲染为 Debugger Plan 审批卡，composer 上方不再承载 Plan；`PlanIntakePanel` 只负责当前待回答的 `AskUserQuestion` overlay，并通过 `workflow.submitQuestions(runId, answers)` 回写，不进入普通 Ask 聊天的全局 resume loop。`AskUserQuestion` 的请求和回答同时作为 `ui.ask_user_question` tool trace 留在消息流中，便于像普通工具调用一样追溯。
- `src/renderer/features/settings`：settings/provider/model/profile/workspace UI。
- Settings > Provider 必须把账号登录 Provider 单独展示；API Key/local/environment provider 使用单一 Provider 清单，已连接条目直接在原清单中呈现连接成功状态，不再单独拆出“已连接 Provider”区域。Provider 连接弹层必须保留明确的 `Connect` 与 `Test` 两个动作；已连接 OAuth detail 只展示账号/模型状态，不再显示启动授权的 `Connect`。
- Settings > Provider 的模型列表必须区分真实来源：标准模型接口返回的列表显示为“已发现模型”，逐候选模型请求验证成功的列表显示为“已验证模型”；Claude/ChatGPT Account 使用“账号模型目录”，GitHub Copilot 使用“账号模型目录”并允许 live `/models` 补充；静态推荐只能作为内置候选，不得伪装成已发现模型保存到 route。
- API Key 明文只进入 `SecretStorageService`，`settings:get` 和 detail 二次打开不得把已存密钥回传 renderer；UI 只能显示固定星号占位，输入新密钥后才允许显示/隐藏本次输入。
- Provider catalogGroup 采用产品导向分类（`account` / `openai-compatible` / `anthropic-compatible` / `cloud-platform` / `local` / `image`），独立于 `authMode`（认证方式）；分组只决定 Settings UI 的展示位置，不反推协议或认证形态。
- Protocol Kind (`LlmProviderKind`) 表示 wire protocol 差异，不与产品分组绑定；同一 kind 可能出现在多个 catalogGroup（例如 `openai-compatible` kind 在 `openai-compatible`、`cloud-platform`、`local` 等多个分组中均可存在）。
- Provider 必须声明 `capabilities` 数组，作为运行时能力查询和 UI 展示的唯一事实；调用方在使用 `tool-calling`、`structured-output`、`reasoning`、`vision-input`、`image-generation` 等能力前必须显式判定，未声明的能力按 fail-closed 处理。
- Media generation 通过独立的 `MediaRuntimeService` 路由，不进入 chat runtime；当前实现为 fail-closed skeleton，所有请求返回 `adapter-not-implemented`。
- 不可用 provider（`unavailableReason` 非空）在 Settings UI 中仍然显示，但标记为不可用且不能被选作 agent route，不静默从清单中删除。
- Provider 体系的稳定结构以 `docs/architecture/provider-system.md` 为权威说明，`LlmProviderEntry`、`LlmProviderKind`、`LlmProviderAuthMode`、`LlmProviderCatalogGroup`、`LlmProviderCapability` 在 `src/shared/types/settings.ts` 单点定义，跨层不得重复声明。
- `src/renderer/features/projects`：project/session navigation。
- `src/renderer/features/captures`：capture library、device selector、opened capture preview 和 context panels。
- `src/renderer/features/terminal`：terminal drawer 和 terminal UI glue。
- `src/renderer/ui`：纯基础控件，不直接调用 `window.electronAPI`。
- `src/renderer/patterns`：无副作用展示模式，不承载业务请求。
- `src/renderer/platform`：Electron/browser 平台适配，浏览器 fallback 必须按 API 域拆分。

## UI / UX 设计原则

- 默认保持现有 UI/UX：布局结构、面板层级、交互路径、信息层级、视觉节奏、CSS class、测试定位符和截图基线都不应因架构重排改变。
- **保真契约**：`scripts/fidelity/*` 清单为冻结输出；重写只允许搬家 class/testid，不允许改名或删锚点。
- **文件行数预算**：组件 ≤300 行、hook/service ≤200 行、store slice ≤200 行（`check:architecture` R1 强制执行，遗留清单逐步清零）。
- UI 结构调整只有两类允许原因：明确的产品变更，或为保持现有行为而必须做的结构拆分。
- 任何涉及 `src/renderer` 的改动，都必须确认主界面、左侧项目/会话、右侧控制面板、composer、Activity/运行记录、Settings、capture library、opened capture preview 仍可达。
- 基础控件沉淀到 `ui`，无副作用展示沉淀到 `patterns`，业务组件沉淀到 `features/*`。不要把新的业务组件继续堆回通用技术桶。

## 执行纪律

- `Think Before Coding`：不明确的地方先从仓库事实中查证。仍不明确且会影响产品语义、公开契约或 UI/UX 时，必须停下来说明多种解释和当前假设。
- `Simplicity First`：只实现当前目标需要的最小结构。能用现有框架、类型和 helper 表达的，不引入新框架、新 runtime 或过度抽象。
- `Surgical Changes Only`：每一行 diff 都应能追溯到当前目标。禁止顺手视觉改版、重命名产品概念、清理无关代码或改动无关测试。
- `Goal-Driven Execution`：先定义验证方式，再实施。代码改动至少跑 `npm run typecheck`；入口、构建、窗口、preload 或 IPC 改动补 `npm run build`；UI/UX 或跨层契约改动补关键 E2E。

## 文档和规则同步

- 改变产品边界、架构边界、UI/UX 规则、跨层契约或验证策略时，必须同步更新本文件。
- 改变源码入口或数据流时，必须同步更新 `docs/architecture/module-map.md`、必要时更新 `overview.md` 和 `data-flow.md`。
- `AGENTS.md` 只能写修改公约，不复制本文件的长篇设计说明。
- 不要把 Nexus、CodePilot、RDC-Agent-Frameworks 或 RDC-Agent-Tools 的路径和规则直接写成本仓库前提；只能作为明确标注的参考。

## 验证门禁

- 文档/规则改动：检查路径、术语、阅读顺序和仓库当前结构一致。
- 架构检查：`npm run check:architecture`（含 renderer 行数预算 R1、依赖方向 R2、分层 IPC R3、内联颜色 R4；遗留超标文件见守卫内 `R1_LEGACY_OVER_BUDGET` 清单）。
- 保真检查：`npm run check:fidelity`（`scripts/fidelity/fidelity-classnames.txt` / `fidelity-testids.txt` 差集为空）。
- 共享导出：`npm run check:shared-exports`（相对 Phase 0 `shared-exports.txt` 无符号删除）。
- 静态类型：`npm run typecheck`。
- 构建检查：`npm run build`。
- 浏览器真实会话 smoke：`npm run test:browser-session`，运行前必须先 build，因为 smoke 以 `RDC_AGENT_HEADLESS=1` 启动 `out/main/index.js` 和 `out/renderer`，再用浏览器打开 `/app`。
- Electron 壳边界 smoke：`npm run test:shell-smoke`，只验证窗口启动、preload 注入、IPC 连通、workspace 权限和 ToolBridge/RenderDoc 本地链路诊断。
- 模式门禁改动必须补 `mode-switch.spec.ts`，确认默认 `Ask`、未 Open capture 时执行类模式 disabled、Open 后可切换。
- Provider/OAuth UI 改动：先用 mock E2E 验证分组、Connect/Test、token 状态和模型发现，再用内置浏览器检查 Settings > Provider 的视觉层级、弹层可读性、长文本和窄宽度布局；真实 OAuth 登录验证需要明确区分账号/组织策略失败与本地 UI/IPC 失败。



