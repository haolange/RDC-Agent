# RDC-Agent 设计与工程架构准则

`DESIGN.md` 是本仓库的产品设计和工程架构权威入口。`README.md` 说明项目是什么以及如何启动，`AGENTS.md` 说明修改公约，`docs/architecture/*` 说明具体数据流和模块地图。当这些文件出现冲突时，以本文描述的产品边界、架构边界和验证门禁为准，再同步修正文档。

## 产品边界

- `RDC-Agent` 是面向 `RenderDoc` `.rdc` capture 的 Electron 桌面工作台，不是通用 coding-agent shell。
- 默认用户入口是 `Ask`：它负责只读 agentic 协作、澄清、解释、读取/搜索当前 workspace 与公开网页，并引导用户通过应用内 `Open` 打开 `.rdc`。它不创建正式 run，不暴露 RenderDoc mutation 或 shell/write/edit/remove 工具。
- 当前执行主链是 `Debugger`：用户输入目标、进入 plan/intake、回答必要问题、批准计划、执行 RenderDoc 工具链、沉淀 evidence/report。
- `Analyzer` 和 `Optimizer` 是一等产品模式占位，但当前默认不把 Debugger harness 自动泛化到这两个模式。
- 只有应用内已有 `OpenedCaptureState(status=open)` 且属于当前 project 时，renderer 才允许选择执行类模式。用户在 prompt 里写 `.rdc` 路径不等同于 Open capture，也不能被自动升级成正式 run。
- 工具执行链必须保持为 `workflow/runtime -> RdxCliInvokerService -> configured shell command`。命令、默认参数、工作目录、环境变量和 catalog 路径只能来自 Settings，不能从 renderer、preload、MCP、skill、provider adapter 或打包资源绕过主进程 invoker 调 RenderDoc 工具。

## Agent Runtime

- `AgentRuntime` 负责 multi-turn loop、tool mediation events、deterministic policy、ask-user approval events、provider routing 和 trace redaction。
- HTTP provider adapter 或 provider-specific client 只提供模型流、工具请求格式和 provider 能力适配，不能决定 mode、stage、approval、tool policy 或 final status。
- Agent Runtime 的跨层事实事件是 `AgentEvent`。renderer 只消费事件投影和 conversation message projection，不展示原始 chain-of-thought。
- `Ask` 是只读 agentic work：默认允许 `primitive.read/glob/grep/webFetch/webSearch/askUser/task.list`，禁止 `bash/write/edit/remove`。若模型请求禁用工具，runtime 必须返回 policy denial，而不是静默执行。
- `Debugger` 绑定 `plan-generate-verify` pattern。首版继续复用现有 Debugger stage 名称，但 pattern contract 明确 planner -> generator -> evaluator 的顺序、plan approval 入口和 verifier/curator 收敛责任。
- Settings > Agents 必须同时覆盖 provider/model route 与 runtime ecology：profiles、skills、MCP、patterns。高频 agent route 保持首屏可达，runtime ecology 可折叠，但必须能从 UI 保存到 workspace settings。

## 架构分层

- `src/main`：Electron shell、IPC 注册、工作流编排、workspace 数据、settings、runtime log、terminal、RDX CLI invoker、report/evidence 等主进程能力。
- `src/preload`：唯一受控的 renderer API 暴露层。它负责组合 `window.electronAPI`，不承载业务流程。
- `src/renderer`：工作台 UI、交互状态、用户入口、浏览器 bridge 适配和 E2E seed helper。
- `src/shared`：跨 main/preload/renderer 共享的常量、类型和纯工具函数。跨层契约必须从这里出发，不在各层重复定义。
- `resources`：随应用分发或运行时依赖的资源，例如 `resources/agent-runtime` 和 `resources/knowledge`。`resources/tools` 不是应用内置默认执行链，只能作为显式配置的外部 CLI 目标。
- `scripts`：可复用开发脚本，不放一次性调试代码。

renderer 内部分层依赖方向：

- `ui`：无业务依赖的基础控件。
- `patterns`：无副作用展示模式。
- `stream` / `services`：renderer 侧纯逻辑。
- `features`：业务 UI。
- `shell` / `app`：应用装配。
- `platform` 与 `stores`：IPC/状态边界。

禁止重建 `src/renderer/components` 技术桶。基础控件进 `ui/`，展示模式进 `patterns/`，业务组件进 `features/*`。

## Provider 与 RDX CLI

- Provider 体系的稳定结构以 `docs/architecture/provider-system.md` 为权威说明，`LlmProviderEntry`、`LlmProviderKind`、`LlmProviderAuthMode`、`LlmProviderCatalogGroup`、`LlmProviderCapability` 在 `src/shared/types/settings.ts` 单点定义，跨层不得重复声明。
- Provider `catalogGroup` 采用产品导向分类：`account`、`openai-compatible`、`anthropic-compatible`、`cloud-platform`、`local`、`image`。它独立于 `authMode`，只决定 Settings UI 展示位置。
- Protocol Kind (`LlmProviderKind`) 表示 wire protocol 差异，不与产品分组绑定。
- Provider 必须声明 `capabilities` 数组。调用方在使用 `tool-calling`、`structured-output`、`reasoning`、`vision-input`、`image-generation` 等能力前必须显式判定，未声明的能力按 fail-closed 处理。
- Media generation 通过独立的 `MediaRuntimeService` 路由，不进入 chat runtime；当前实现为 fail-closed skeleton。
- RDX CLI command details 是 Settings 数据，不是模块常量。renderer 可显示 catalog/runtime status，但不能调用任意 RDX tools。

## UI / UX 设计原则

- 默认保持现有 UI/UX：布局结构、面板层级、交互路径、信息层级、视觉节奏、CSS class、测试定位符和截图基线都不应因架构重排改变。
- 保真契约：`scripts/fidelity/*` 清单为冻结输出；重写只允许搬移既有 class/testid，不允许无产品理由改名或删锚点。
- 文件行数预算：组件不超过 300 行、hook/service/store slice 不超过 200 行。`check:architecture` 对 renderer 执行 R1 守卫，历史豁免应逐步清零。
- UI 结构调整只有两类允许原因：明确的产品变更，或为保持现有行为而必须做的结构拆分。
- 任何涉及 `src/renderer` 的改动，都必须确认主界面、左侧 project/session、右侧控制面板、composer、Activity/runtime log、Settings、capture library、opened capture preview 仍可达。
- Settings > Providers 必须清楚区分 account provider、API-key/local/environment provider、不可用 provider、已连接状态和模型来源。
- Settings > Agents 必须保持 provider/model 路由首屏可用，同时保留 runtime config 折叠区和 RDX CLI invoker 配置入口。

## 浏览器真实会话评审

- 浏览器真实会话通过主进程 localhost bridge 打开同一套 renderer，并连接真实 workspace、settings、LLM runtime、Trace 事件流和已配置的 RDX CLI invoker。
- agent 日常验证使用 `RDC_AGENT_HEADLESS=1` 跳过 Electron 桌面窗口，但不拆分 renderer 或 runtime 能力。
- 产品级 UI/功能评审必须模拟真实用户使用软件，至少覆盖：
  - Workbench 初始状态。
  - 新建或选择 project。
  - 新建 session。
  - 导入 `.rdc` 到 project inputs。
  - 打开 `.rdc` 并检查 success/error 的可诊断状态。
  - Settings > Providers。
  - Settings > Agents。
  - 桌面与窄屏视口截图。
  - 水平溢出、遮挡、长路径、中文文件名、按钮状态、滚动可达性。
- 本地真实输入通过环境变量传入测试，不写死到源码默认值。

## 执行纪律

- Think Before Coding：不明确的地方先从仓库事实中查证。仍不明确且会影响产品语义、公开契约或 UI/UX 时，必须停下来说明多种解释和当前假设。
- Simplicity First：只实现当前目标需要的最小结构。能用现有框架、类型和 helper 表达的，不引入新框架、新 runtime 或过度抽象。
- Surgical Changes Only：每一行 diff 都应能追溯到当前目标。禁止顺手视觉改版、重命名产品概念、清理无关代码或改动无关测试。
- Goal-Driven Execution：先定义验证方式，再实施。代码改动至少跑 `npm run typecheck`；入口、构建、窗口、preload 或 IPC 改动补 `npm run build`；UI/UX 或跨层契约改动补关键 E2E。
- 不允许提交 mojibake/乱码文案。架构检查应阻止常见乱码序列进入 `src`、`docs` 和根目录正式文档。

## 验证门禁

- 文档/规则改动：检查路径、术语、阅读顺序和仓库当前结构一致。
- 架构检查：`npm run check:architecture`。
- 保真检查：`npm run check:fidelity`。
- 共享导出：`npm run check:shared-exports`。
- 静态类型：`npm run typecheck`。
- 构建检查：`npm run build`。
- 浏览器真实会话 smoke：`npm run test:browser-session`。运行前必须先 build，因为 smoke 以 `RDC_AGENT_HEADLESS=1` 启动 `out/main/index.js` 和 `out/renderer`，再用浏览器打开 `/app`。
- Electron 壳边界 smoke：`npm run test:shell-smoke`。只验证窗口启动、preload 注入、IPC 连通、workspace 权限和 RDX CLI invoker/RenderDoc 本地链路诊断。
- Provider 体系：`npm run test:provider-system`。
- Settings Agents 路由：`npm run test:settings-agents`。
- 本地产品级 smoke：`npm run test:product-smoke`，需要 `RDC_AGENT_PRODUCT_SMOKE_PROJECT_ROOT` 和 `RDC_AGENT_PRODUCT_SMOKE_RDC_PATH`。
