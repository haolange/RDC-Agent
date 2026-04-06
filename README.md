# RDC-Agent

`RDC-Agent` 是一个面向 `RenderDoc` `.rdc` capture 的桌面调试代理框架，使用 `Electron + React + TypeScript` 构建。

它的目标不是做一个无边界的通用聊天客户端，而是做成“体验先像正常协作助手，真正执行时再进入严格垂直流程”的 RenderDoc 调试产品。当前仓库以 `Debugger` 作为真实生产主链，并围绕它实现工作流图、Agent 编排层和证据 / Artifact 展示框架。

## 它能做什么

- 将项目目录接入到 `Project` 体系，并自动使用 `<project-root>/.resource/` 作为项目资源目录。
- 在右侧栏浏览、导入和打开 `<project-root>/.resource/inputs/` 下的 `.rdc` 文件。
- 按当前 `Replay Device` 打开单个 `.rdc`，由 app 内部维护活动 `contextId` / capture session。
- 在设置中心把 `workspace` 配置为单一工作根目录，并由它统一派生 `settings.json`、日志和运行数据目录。
- 在模型设置页管理 `provider`、启用模型清单以及 `Agent -> provider/model` 路由。
- 启动一个围绕渲染问题的调试会话，并严格走 `Plan / Intake -> 用户批准 -> execution loop -> verification / skeptic / curator -> report` 主链。
- 在正式执行前，先以正常 assistant 对话方式做问题澄清、边界说明和 capture / 路由补齐。
- 通过多个专门角色进行协作分析，例如 triage、pixel forensics、shader IR、driver/device、skeptic 和 curator。
- 用工作流状态机控制阶段推进、阻断处理和受控回转。
- 在界面中展示会话状态、证据链和中间产物。
- 只展示 reasoning summary，不暴露私有原始思维；如果 provider / secret / route / model / LLM request 任一环节无效，Debugger 会明确进入 blocker，而不是 silent fallback 到 tool-only 路径。

## 当前界面

- `Debugger`：真实生产入口，顶部 titlebar 直接显示当前模式。
- `Analyzer` / `Optimizer`：继续保留在顶部模式切换中，当前仍是独立占位页，不参与本轮主链执行。
- 右侧栏收敛为四个信息区块：`Task Monitor`、`Capture Library`、`Opened Capture` 和 `Runtime Context`。
- `Capture Library` 负责项目内 `.rdc` 资源列表，`Opened Capture` 负责当前打开态与预览，`Runtime Context` 负责运行时上下文和会话归属。

## 代码结构

- `src/main`：Electron 主进程，负责窗口、菜单、IPC 和工作流编排。
- `src/preload`：预加载层，向渲染进程暴露受控 API。
- `src/renderer`：前端界面，包括页面、组件和样式。
- `src/shared`：跨层共享的常量、类型和工具函数。
- `docs`：设计说明、流程说明和演示文档。

## 数据结构

- `Project`：用户手动添加的本地项目根目录。
- `Project Resource`：
  - `project knowledge`：位于项目根目录下的 `.resource/knowledge/`
  - `project inputs`：位于项目根目录下的 `.resource/inputs/`
- `Session`：项目下的问题线程，每个线程拥有独立目录。
- `Run`：线程下的一次实际调试执行。
- `Knowledge`：
  - `global knowledge`：位于应用 `userData` 目录，由安装包内置 seed 首次复制生成

运行期的应用级设置与日志统一存放在设置中心配置的 `workspace root` 下，默认会落到系统 `appData/rdc-agent` 目录，并派生出：

- `<workspace-root>/settings.json`
- `<workspace-root>/logs/rdc-agent.log`
- `<workspace-root>/projects/`
- `<workspace-root>/knowledge/`
- `<workspace-root>/migration-orphans/`
- `<workspace-root>/profiles/`
- `<workspace-root>/policies/`
- `<workspace-root>/secrets/`
- `<workspace-root>/migration-reports/`

`session/run` 真相目录位于 `<project-root>/sessions/<sessionId>/...`，其中每次执行的报告、artifact 和 `action_chain.jsonl` 都以项目根目录下的 session 目录为准。

## 开发运行

```bash
npm install
npm run dev
```

常用脚本：

- `npm run build`：构建开发产物。
- `npm run pack`：生成未打包安装目录。
- `npm run dist`：生成安装包。
- `npm run typecheck`：TypeScript 类型检查。
- `npm run lint`：代码风格检查。

## Git 与本地产物约定

- 克隆仓库后先执行 `npm install`，`node_modules/` 不会随 Git 分发。
- `out/`、`dist/`、`release/` 等构建与打包产物属于本地可再生文件，不应提交到仓库。
- 仓库启用了 Git LFS，前端大图、`.rdc` 样本以及二进制资源应通过 LFS 管理；开发机在首次拉取前应完成 `git lfs install`。
- 若后续新增 `resources/` 下的工具或静态大文件，应优先复用现有 LFS 规则，不要直接把大体积二进制以普通 Git blob 提交。

## 当前状态

这个仓库当前聚焦在 `Debugger` 生产链路和多 Agent 编排。`Analyzer` 和 `Optimizer` 仍然保留为可见模式入口，但当前只是独立占位页。

`Debugger` 不是“RenderDoc 本地工具壳 + 可选模型增强”。真实配置的 `provider/model/agent route` 属于主链的一部分；如果没有真实命中已绑定的 LLM provider/model，本次 run 视为未完成。与此同时，缺少 capture 或模型链路时，assistant 仍应先给出自然语言说明，而不是把 blocker 直接当成主交互。

如果你想继续，我可以下一步把 `docs/` 里的设计文档也整理成一份更像“项目总览”的说明，或者直接补一版更细的开发约定。
