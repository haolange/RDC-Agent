# RDC-Agent 设计与工程架构准则

`DESIGN.md` 是本仓库的产品设计和工程架构权威入口。`README.md` 说明项目是什么以及如何启动，`AGENTS.md` 说明修改公约，`docs/architecture/*` 说明具体数据流和模块地图。当这些文件出现冲突时，以本文描述的产品边界、架构边界和验证门禁为准，再同步修正文档。

## 产品边界

- `RDC-Agent` 是面向 `RenderDoc` `.rdc` capture 的 Electron 桌面工作台，不是通用 coding-agent shell。
- 默认用户入口是 `Ask`：它负责只读 agentic 协作、澄清、解释、读取/搜索当前 workspace 与公开网页，并引导用户通过应用内 `Open` 打开 `.rdc`。它不创建正式 run，不暴露 RenderDoc mutation 或 shell/write/edit/remove 工具。
- 当前执行主链是 `Debugger`：用户输入目标、进入 plan/intake、回答必要问题、批准计划、执行 RenderDoc 工具链、沉淀 evidence/report。
- `Analyzer` 和 `Optimizer` 是一等产品模式占位，但当前默认不把 Debugger harness 自动泛化到这两个模式。
- 只有应用内已有 `OpenedCaptureState(status=open)` 且属于当前 project 时，renderer 才允许选择执行类模式。用户在 prompt 里写 `.rdc` 路径不等同于 Open capture，也不能被自动升级成正式 run。
- 工具执行链必须保持为 `UI/agent -> Settings shell action or bash -> ShellInvocationService -> system-installed CLI -> JSON runtime context`。命令、默认参数、工作目录、环境变量和 catalog 路径只能来自 Settings，不能从 renderer、preload、MCP、skill、provider adapter 或打包资源绕过主进程 shell boundary 调 RenderDoc/RDX 工具。

## Agent Runtime

- `AgentRuntime` 负责 multi-turn loop、tool mediation events、deterministic policy、ask-user approval events、provider routing 和 trace redaction。
- HTTP provider adapter 或 provider-specific client 只提供模型流、工具请求格式和 provider 能力适配，不能决定 mode、stage、approval、tool policy 或 final status。
- Agent Runtime 的跨层事实事件是 `AgentEvent`。renderer 只消费事件投影和 conversation message projection，不展示原始 chain-of-thought。
- `Ask` 是只读 agentic work：默认允许 `primitive.read/glob/grep/webFetch/webSearch/askUser/task.list`，禁止 `bash/write/edit/remove`。若模型请求禁用工具，runtime 必须返回 policy denial，而不是静默执行。
- `Debugger`、`Analyzer`、`Optimizer` 都是 `.agent.md` 驱动的通用可聊天可执行 agent；计划内容只能作为普通 artifact（例如 `plan.md`）或 handoff 结果出现，不绑定专用 workflow state 或 approval overlay。
- Settings > Agents 必须同时覆盖 provider/model route 与 runtime ecology：profiles、skills、MCP、patterns。高频 agent route 保持首屏可达，runtime ecology 可折叠，但必须能从 UI 保存到 workspace settings。

## 架构分层

- `src/main`：Electron shell、IPC 注册、工作流编排、workspace 数据、settings、runtime log、terminal、RDX CLI invoker、report/evidence 等主进程能力。
- `src/preload`：唯一受控的 renderer API 暴露层。它负责组合 `window.electronAPI`，不承载业务流程。
- `src/renderer`：工作台 UI、交互状态、用户入口、浏览器 bridge 适配和 E2E seed helper。
- `src/shared`：跨 main/preload/renderer 共享的常量、类型和纯工具函数。跨层契约必须从这里出发，不在各层重复定义。
- `resources`：随应用分发或运行时依赖的资源，例如 `resources/agent-runtime` 和 `resources/knowledge`。仓库不保留内置 RDX tool 副本；RDX CLI 由系统安装并在 Settings 中配置。
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
- 浏览器真实会话：`npm run start:agent-browser` 或 `scripts/start-browser-session.cmd`。运行前必须先 build；入口以 `RDC_AGENT_HEADLESS=1` 启动 `out/main/index.js` 和 `out/renderer`，再用 Codex 内置浏览器打开主进程输出的 `/app`。
- 人类开发入口：`scripts/start-rdc-agent-dev.cmd`，启动可见 Electron React WebUI。
- 人类构建产物入口：`scripts/start-rdc-agent.cmd`，使用构建产物启动可见 Electron React WebUI；发布模式直接双击 exe / app 包。
- Provider 体系：`npm run check:provider-system`。
- Settings Agents 路由：`npm run check:settings-agents`。
- 本地产品级浏览器验收需要真实 project 与 `.rdc` 输入，例如 `D:\Utility\RDC_Agent` 和 `D:\Utility\GPUCaptures\RenderDoc\眼睛泪腺白点.rdc`；RDX/RenderDoc 失败必须 fail-closed 并显示诊断。

## 设计系统与视觉语言

### 设计方向

**Professional Tool Aesthetic**：克制、高密度、暗色优先、精确感。参考 VS Code、JetBrains、Linear。视觉语言服务于焦点和快速诊断，而非装饰。

- 主题：深色（默认）+ 浅色，同等质量
- 字型：`Inter`（UI）+ `JetBrains Mono`（代码、路径、ID）
- 强调色：信号青（`--color-accent-500`），仅用于焦点环、激活状态、主要 CTA
- 主色：工作站蓝（`--color-primary-500`），用于品牌标识和主按钮渐变

### Token 三层架构

Agent 写组件 CSS 时必须按以下层级引用，禁止跨层：

```
Primitive  →  --color-bg-*, --color-accent-*, --space-*
Semantic   →  --token-bg-*, --token-text-*, --token-border-*  ← 组件必须用这层
Component  →  --btn-*, --input-*, --card-*                    ← 组件内部可进一步细化
```

**完整 token 定义**见 `src/renderer/styles/design-system.css`。
**视觉参考**（可在浏览器打开）见 `designs/rdc-agent-design-system/Design System Preview.html`。

### 颜色使用规则

1. 背景层级：`--token-bg-app`（最深）→ `--token-bg-shell` → `--token-bg-panel` → `--token-bg-raised`（最浅可交互面）
2. 边框 token 已内含 alpha（如 `--color-border-subtle: 255 255 255 / 0.06`），直接用 `rgb(var(--color-border-subtle))`。**禁止**写 `rgb(var(--color-border-subtle) / 0.65)`——那是无效 CSS。
3. 需要自定义透明度的边框，应从 `--token-border-*` 语义层选最接近的，不得二次叠加 alpha。
4. 强调色只用于交互状态和主 CTA，不得作为正文、标签或装饰色。

### 按钮系统

**单一系统**：`.button` 基类 + 修饰符，定义在 `src/renderer/styles/global/panels-composer.css`。

```html
<button class="button button-primary">主操作</button>
<button class="button button-secondary">次要</button>
<button class="button button-ghost">幽灵</button>
<button class="button button-danger">危险</button>
<button class="button button-secondary button-sm">小号</button>
```

React 组件：`<Button variant="primary" size="sm">` —— 见 `src/renderer/ui/Button.tsx`。

**禁止**：不得新增第三套按钮类名（如 `ui-btn`、`ds-btn` 等），也不得在组件 CSS 中重复定义按钮样式。

### 排版规则

- 正文：`var(--text-base)` / 14px，`var(--font-normal)`
- 说明文字：`var(--text-sm)` / 12px，`--token-text-caption`
- 大写标签（区块标题、状态标签）：`var(--text-xs)` + `letter-spacing: var(--tracking-caps)` + `text-transform: uppercase`
- 路径/ID/代码：`var(--font-mono)`，`var(--text-sm)`
- **禁止**使用 px 字面值；所有字号从 `--text-*` 变量读取。

### 间距规则

- 使用 `--space-*` 系列（4px 基准网格）
- 组件内边距：`--space-3`（12px）至 `--space-4`（16px）
- 区块间隔：`--space-4` 至 `--space-6`
- 紧凑列表间距：`--space-2`（8px）
- **禁止**使用奇数像素值（3px、7px、9px 等）。

### Z-index 规范

| 层 | 值 | 用途 |
|---|---|---|
| base | 0 | 普通内容 |
| dropdown | 100 | 下拉菜单 |
| sticky | 200 | 粘性标题 |
| modal-backdrop | 400 | 遮罩层 |
| modal | 500 | 对话框、Settings modal |
| popover | 600 | 浮动面板 |
| tooltip | 700 | 悬浮提示 |
| notification | 1000 | Toast |

### 组件约定

新增组件必须满足：
1. **States**：rest / hover / active / focus / disabled / error（按需）
2. **Variants**：通过 `--component-*` token 控制，不得硬编码颜色
3. **Size variants**：sm / md / lg，使用高度 token 而非 px 字面值
4. **无内联样式**：`style={{}}` 只用于纯动态值（宽度百分比、计算高度）

### 迁移路线图（未来阶段）

下列是已规划但尚未实施的改进，下一次 UI/UX 专项迭代时推进：

1. **shadcn/ui + Tailwind CSS 迁移**：引入 Radix UI 原语 + class-variance-authority，获得 40+ 可访问性合格组件。需要 `npm install tailwindcss @tailwindcss/vite clsx tailwind-merge`，并将现有 CSS 变量映射到 shadcn 的 `--background/--foreground` 体系。
2. **ui/ 控件补全**：补充 `Input`、`Textarea`、`Switch`、`Checkbox`、`Tooltip`、`Select`、`Tabs`、`Toast` 等缺失原语。
3. **Settings 视觉改版**：基于设计系统重写 Settings > Providers / Agents / General 的视觉表达，提升信息层级和状态可读性。
