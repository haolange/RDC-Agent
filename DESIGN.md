# RDC-Agent 设计与工程架构准则

`DESIGN.md` 是本仓库的产品设计和工程架构权威入口。`README.md` 说明项目是什么以及如何启动，`AGENTS.md` 说明修改公约，`docs/architecture/*` 说明具体数据流和模块地图；当这些文件出现冲突时，以本文件描述的产品边界、架构边界和验证门禁为先，再同步修正文档。

## 产品边界

- `RDC-Agent` 是面向 `RenderDoc` `.rdc` capture 的 Electron 桌面工作台，不是通用 coding-agent shell。
- 默认用户入口是 `Ask`：它只负责对话、澄清、解释能力和引导用户通过应用内 `Open` 打开 `.rdc`，不创建正式 run，不暴露 RenderDoc 执行工具。
- 当前现役主链是 `Debugger`：用户输入目标、进入 plan/intake、回答必要问题、批准计划、执行 RenderDoc 工具链、沉淀 evidence/report。
- `Analyzer` 和 `Optimizer` 是一等产品模式占位，但本仓库默认不把 Debugger harness 自动泛化到这两个模式。
- `Debugger` / `Analyzer` / `Optimizer` 是执行类 UI 模式；只有应用内已有 `OpenedCaptureState(status=open)` 且属于当前 project 时，renderer 才允许选择执行类模式。用户在 prompt 里写 `.rdc` 路径不等同于 Open capture，也不能被自动升级成正式 run。
- 工具执行链必须保持为 `renderer -> preload -> IPC -> ToolBridge -> resources/tools/rdx.bat`。不能从 renderer、preload 或任意 SDK adapter 绕过 `ToolBridge` 调 RenderDoc 工具。
- OpenAI Agents SDK / Claude Agent SDK 只能作为 stage 内 runner，经 `AgentRunnerPort` 接入；顶层 stage、gate、approval、final status 由本仓库 workflow runtime 决定。

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
- `src/main/sessions`：project/session/run repository、workspace layout、attachment/output store、legacy workspace migration、JSON/YAML file store。
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

渲染层按用户能力组织：

- `src/renderer/shell`：App shell、窗口控制、布局 sizing、session bootstrap、event subscriptions、composer/run action glue、E2E seed harness。
- `appMeta.testMode` 是 renderer 区分 deterministic E2E seed 与真实运行恢复的跨层信号；只有 test mode seed 才跳过项目输入和 workflow state 恢复，真实构建的自动化 smoke 仍必须恢复待审批 run。
- `src/renderer/features/debugger`：Debugger 业务 UI。
- `DebugPlan.presentation` 只在消息流中渲染为 Debugger Plan 审批卡，composer 上方不再承载 Plan；`PlanIntakePanel` 只负责当前待回答的 `AskUserQuestion` overlay，并通过 `workflow.submitQuestions(runId, answers)` 回写，不进入普通 Ask 聊天的全局 resume loop。`AskUserQuestion` 的请求和回答同时作为 `ui.ask_user_question` tool trace 留在消息流中，便于像普通工具调用一样追溯。
- `src/renderer/features/settings`：settings/provider/model/profile/workspace UI。
- Settings > Provider 必须把账号登录 Provider 单独展示；API Key/local/environment provider 使用单一 Provider 清单，已连接条目直接在原清单中呈现连接成功状态，不再单独拆出“已连接 Provider”区域。Provider 连接弹层必须保留明确的 `Connect` 与 `Test` 两个动作；已连接 OAuth detail 只展示账号/模型状态，不再显示启动授权的 `Connect`。
- Settings > Provider 的模型列表必须区分真实来源：标准模型接口返回的列表显示为“已发现模型”，逐候选模型请求验证成功的列表显示为“已验证模型”；Claude/ChatGPT Account 使用“账号模型目录”，GitHub Copilot 使用“账号模型目录”并允许 live `/models` 补充；静态推荐只能作为内置候选，不得伪装成已发现模型保存到 route。
- API Key 明文只进入 `SecretStorageService`，`settings:get` 和 detail 二次打开不得把已存密钥回传 renderer；UI 只能显示固定星号占位，输入新密钥后才允许显示/隐藏本次输入。
- `src/renderer/features/projects`：project/session navigation。
- `src/renderer/features/captures`：capture library、device selector、opened capture preview 和 context panels。
- `src/renderer/features/terminal`：terminal drawer 和 terminal UI glue。
- `src/renderer/ui`：纯基础控件，不直接调用 `window.electronAPI`。
- `src/renderer/patterns`：无副作用展示模式，不承载业务请求。
- `src/renderer/platform`：Electron/browser 平台适配，浏览器 fallback 必须按 API 域拆分。

## UI / UX 设计原则

- 默认保持现有 UI/UX：布局结构、面板层级、交互路径、信息层级、视觉节奏、CSS class、测试定位符和截图基线都不应因架构重排改变。
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
- 架构检查：`npm run check:architecture`。
- 静态类型：`npm run typecheck`。
- 构建检查：`npm run build`。
- Electron E2E：运行前必须先 build，因为 E2E 启动 `out/main/index.js` 和 `out/renderer`。
- 关键 E2E：`debugger-plan-intake.spec.ts`、`session-lifecycle.spec.ts`、`settings-persistence.spec.ts`、`workbench-visual.spec.ts`。
- 模式门禁改动必须补 `mode-switch.spec.ts`，确认默认 `Ask`、未 Open capture 时执行类模式 disabled、Open 后可切换。
- Provider/OAuth UI 改动：先用 mock E2E 验证分组、Connect/Test、token 状态和模型发现，再用内置浏览器检查 Settings > Provider 的视觉层级、弹层可读性、长文本和窄宽度布局；真实 OAuth 登录验证需要明确区分账号/组织策略失败与本地 UI/IPC 失败。
