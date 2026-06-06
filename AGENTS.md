# AGENTS.md

## 范围

本文件只约束 `RDC-Agent` 仓库内的修改方式、文档治理和交付边界。

本文件是仓库级工作约定；若与系统、平台安全规则或用户本轮明确指令冲突，以更高优先级指令为准，并在交付说明中指出采用了哪个约束。仓库内部文档之间出现冲突时，`AGENTS.md` 只负责修改公约，产品边界、架构边界和验证门禁以 `DESIGN.md` 为准，再同步修正文档。

本仓库是一个面向 RenderDoc `.rdc` capture 的 Electron 桌面应用，核心代码分布在 `src/main`、`src/preload`、`src/renderer` 和 `src/shared`。仓库级规则只描述这些层之间的协作方式，不承接上游 `RDC-Agent-Frameworks` 或 `RDC-Agent-Tools` 的仓库级规则。

## 修改原则

- 涉及 UI/UX、产品设计、架构边界、跨层契约、feature 拆分或验证策略时，必须先阅读 `DESIGN.md`，再阅读相关 `docs/architecture/*` 文档。
- 根目录只放仓库入口、总体说明和跨层约定，不要把某个具体 agent、stage 或 tool 的领域规则重复写到仓库根。
- 仓库保持标准 Electron 应用布局，`Config`、`Saved`、`Intermediate`、`Binaries` 属于运行期或构建期概念，不要把它们重新引入为仓库顶层源码目录。
- 涉及主进程、预加载脚本、渲染层、共享类型时，优先保持一次改动内联动更新，避免只改单层造成契约漂移。
- 新增或调整 agent 角色、工作流阶段、IPC 事件、共享类型时，必须同步检查 `src/shared`、`src/main` 和对应 UI 页面是否一致。
- `README.md` 负责项目定位、使用方式和结构说明；`AGENTS.md` 负责修改公约。两者不要互相堆叠职责。
- 改变产品边界、UI/UX 规则、架构边界、跨层契约或验证策略时，必须同步更新 `DESIGN.md`。
- 不要保留明显的 legacy 双轨入口、镜像目录或“临时兼容”文案。新结构替代旧结构时，直接收敛到单一路径。
- 路径引用应以本仓库为基准，不要硬编码上游仓库的绝对路径。
- 不要把 Nexus、CodePilot、上游 Frameworks 或 Tools 仓库的路径、概念或兼容面直接写成本库前提；如需引用，只能作为明确标注的对照参考。
- 文档以中文为主，必要的英文术语保留原样，例如 `RenderDoc`、`.rdc`、`Electron`、`IPC`、`LLM`、`Debugger` / `Analyzer` / `Optimizer` 等。

## 执行纪律

- 实现前必须先界定本次目标、可验证的成功标准、验证方式和关键假设。
- 遇到需求不明确或存在多种合理解释时，先按影响分级处理：
  - 会导致 data loss、公开 API/IPC/共享类型破坏、schema/workspace 迁移、安全/权限边界变化，或不可安全回滚的产品语义变化时，属于 Blocking Ambiguity，必须先停下来提出澄清问题。
  - 影响范围局限、可回滚、可通过测试或 smoke 验证的歧义，属于 Non-blocking Ambiguity，应显式写明假设、风险和回滚方式后继续推进，不要静默选择。
- 涉及产品边界、UI/UX、架构边界、跨层契约、数据结构或模块解耦时，若仍存在 Blocking Ambiguity，必须先澄清；若只是 Non-blocking Ambiguity，按显式假设执行并验证。
- 默认采用最小可行修改，不新增未被要求的功能、抽象、配置项、扩展点或兼容层。
- 只修改完成当前目标必需的文件和代码，每一处 `diff` 都应能对应到本次请求、验证失败或本文件已有约定。
- 新路径替代旧路径时，应同步删除旧入口、旧文案、旧默认路径或无意义兼容分支，避免留下 legacy / deprecated 双轨。
- 如确需临时兼容，必须明确原因、边界和移除条件；临时兼容不得成为静默 `fallback` 或默认执行路径。

## 代码与文档边界

- `src/main` 负责窗口、菜单、IPC、工作流编排和外部能力接入。
- `src/preload` 负责受控暴露给渲染层的 API。
- `src/renderer` 负责界面、交互、状态展示和用户入口。
- `src/shared` 负责跨层共享的常量、类型与工具函数。
- `docs/` 只放稳定设计说明、流程说明和使用文档，不要把运行时代码规则写回文档层。
- `docs/` 下的正式文档应按稳定主题归类到 `product/`、`architecture/`、`workflows/`、`ui/`，不要再新增“设想 / 建议 / 演示 / 分析”式阶段性文件名。
- `resources/` 只放需要随应用分发或运行时依赖的资源；`scripts/` 只放可复用的开发脚本。

## UI / UX 约束

- UI/UX 迭代必须关联 `DESIGN.md`：先确认本次改动是产品变更、结构保真迁移，还是缺陷修复，再决定验证范围。
- 默认以现有 UI / UX 效果保真为准，不要借重构、整理、命名收敛或类型迁移之名改变既有布局结构、交互路径、信息层级和视觉节奏。
- 若改动涉及页面结构、面板布局、状态展示、样式引用或视觉资源路径，必须先确认属于明确的产品变更；如果不是，就应保持现有效果不变。
- 修复结构问题时，不要顺手做与任务无关的视觉改版、布局重排或交互重定义。
- 涉及 `src/renderer` 的改动，除检查类型和功能外，还要检查界面入口是否完整、关键面板是否可渲染、现有交互是否可达。

## 浏览器真实会话边界

- agent 日常 UI/功能验证默认使用 headless 浏览器真实会话：设置 `RDC_AGENT_HEADLESS=1` 启动应用主进程，再用主进程输出的 `http://127.0.0.1:<port>/app` 打开同一套 renderer。
- 浏览器真实会话通过 localhost bridge 连接真实 `main process`、workspace、settings、LLM runtime、事件流和 `ToolBridge`；不得再新增渲染层本地样本或演示场景作为验收入口。
- Electron 窗口仍通过 `preload -> IPC` 进入主进程；浏览器真实会话通过 `localhost bridge -> IPC handler registry` 进入主进程。两条路径必须共享同一套 main/runtime 能力。
- 涉及 UI/UX、布局、消息流、状态展示、样式、面板可达性的改动，优先用浏览器真实会话和内置浏览器多模态点击验证。
- 涉及 `src/main`、`src/preload`、窗口、IPC 注册、workspace 权限、`ToolBridge` 或 `RenderDoc` 本地链路时，补 `npm run test:shell-smoke` 或等价 shell smoke；不把交互类 Electron Playwright 作为默认门禁。

## 产物与命名治理

- 不要把构建输出、测试输出、日志、workspace 本地数据、缓存文件或临时调试文件提交到源码目录或根目录。
- 不要在仓库根目录留下临时脚本、一次性测试文件、零字节垃圾文件或含义不明的实验文件名。
- 新增目录、脚本和文档时，命名应表达稳定职责，不使用临时性、讨论式或个人化命名。

## 修改时的检查项

- 是否存在只改了 UI 没改 IPC 或共享类型的情况。
- 是否存在只改了主进程没改渲染层入口或状态展示的情况。
- 是否引入了新的重复定义、旧命名或兼容分支。
- 是否把运行期 / 构建期产物错误地带回了仓库结构。
- 是否让现有 UI / UX 的布局、交互或视觉效果发生了非预期退化。
- 是否需要同步更新 `README.md`、`docs/` 或注释中的说明。

## 验证建议

做完改动后，至少确认以下内容：

- 开始实现前先写明本次验证方式；实现后按该方式验证并报告结果。无法运行的验证，必须说明原因和剩余风险。
- 代码改动后执行一次 `npm run typecheck`。
- renderer 结构或 UI 锚点改动后执行 `npm run check:architecture`、`npm run check:fidelity`、`npm run check:shared-exports`。
- 入口、构建或窗口逻辑改动后，再补一次 `npm run build` 或等价打包检查。
- 浏览器真实会话 smoke 使用 `npm run test:browser-session`，它打开 `/app` 并通过真实 localhost bridge 调用主进程。
- Electron 壳边界 smoke 使用 `npm run test:shell-smoke`；运行前必须先执行 `npm run build`，因为 smoke 启动的是 `out/main/index.js` 与 `out/renderer` 的构建产物。
- 涉及工作台交互、页面结构、样式引用或共享契约的改动后，至少补一次关键 E2E smoke 或等价人工回归，确认主界面、关键面板和主要交互未退化。
- 仅文档改动时，检查术语、路径和描述是否与当前仓库结构一致。
