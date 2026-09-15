# Plan/Handoff 剩余验收续接需求

> 给家中 Windows / Android 环境的新 Agent：请执行本文，完成剩余两组真实验收及由失败直接引出的修复。证据截止 2026-09-14；不需要旧聊天或桌面需求文件。本文是本轮交接任务，不是新增产品权威。历史结果见 acceptance ledger，不能代替接手机器的实测。

## 1. 项目基本信息

RDC-Agent 是 Electron / React / TypeScript 的通用 Agent workbench，支持 RenderDoc capture。原机器仓库为 `D:\Projects\Native\rdx\RDC-Agent`，远端为 https://github.com/haolange/RDC-Agent.git，分支 main；家中路径请发现实际 checkout，不硬编码原机器路径。依赖版本以 package.json、pnpm-lock.yaml 为准：Node >=22.13.0、pnpm 11.7.0。无线上部署任务。

产品链路保持 Mission 规划→用户审阅→人点声明按钮切到 General→General 就地终答→用户自行切回 Mission 评估。按用户 2026-09-15 决定，不存在 `agent_handoff` 工具或 durable 状态机。General 执行与 Mission 回评估及依赖该链路的真实模型建议行验收移交后续专门大项时，不得把旧交接合同写成现行权威。保持同意前覆盖活计划、同意后冻结、拒绝回同一 tool result、项目保存由用户显式触发。禁止另造 Plan Mode、第二条执行通道或兼容 shim。

## 2. 当前项目进度

| 模块 | 状态与证据 | 剩余验收 |
| --- | --- | --- |
| 审阅、owner、冻结与执行授权 | 确定性测试已验证；真实模型拒绝修订批准已验证 | 后续专项，本次排除 |
| 历史计划保存/导出 | 主进程集成测试已验证；Browser 项目保存已验证 | 原生保存对话框端到端 |
| Composer/卡片/阅读面板 | Browser 窄屏、错误态、Esc 焦点、右栏隔离已验证 | 真实交接产出的建议行归后续专项 |
| Capture | 本地 EID 选择/恢复/关闭已验证 | 本地图像、Android 回放与呈现能力 |

没有放弃上述需求。不要把确定性 fixture 等同模型效果，不把无图像、unsupported 或未连接设备标为通过。

## 3. 文件结构说明

- `src/main/agent-runtime/interactions/AgentPlanReviewRequestService.ts`：生产审阅门；先持久化后发布批准。
- `src/main/sessions/PlanReviewStateStore.ts`、`sessionPlanReference.ts`、`planFilePersistence.ts`：严格状态、持久历史身份、原子文件写入。
- `src/main/ipc/planHandlers.ts`、`validation/planSchemas.ts`：全文读取、保存对话框、固定项目路径及一次性授权。
- `src/main/conversation/applyDeclaredHandoff.ts`、`src/main/sessions/ExecutionOfferStore.ts`、`RuntimeToolAssembly.ts`：声明续跑、execution offer、Skill 预载。
- `src/renderer/features/composer/useQueuedHandoffSuggestion.ts`：切换成功后的预填/发送事务。
- `src/renderer/features/transcript/PlanCard.tsx`、`src/renderer/hooks/`：卡片与阅读操作；组件不得直调 IPC。
- `src/main/sessions/ExecutionOfferStore.test.ts`、`src/main/conversation/applyDeclaredHandoff.test.ts`：确定性 offer / 声明续跑链路；不是产品 provider。
- `src/shared/renderer-api/`、`src/shared/types/planReview.ts`：跨层 API/Browser capability。
- `resources/agent-runtime/`：Mission/Skill/Prompt；`scripts/`：标准 launcher 和门禁；`test/work-process-cot/`：既有演示投影。
- `out`、`node_modules` 为本机构建/依赖，不手改；`.qoder` 是独立知识文档，不是架构权威。

## 4. 核心逻辑说明

plan_artifact 进入生产审阅服务。父会话展示 delegated 请求，回答和正文读取绑定实际 child owner。批准必须验证正文、冻结制品和持久决定成功后才发布内存授权并写入 execution offer；新周期撤销旧授权。历史保存从所选 tool call 的持久投影（含嵌套 work block）确定身份，不读最新状态替代旧版本。

取消、重启、重复回答和迟到事件不得恢复执行权。导出 token 绑定动作、会话/owner、计划身份及规范化路径；保存前重新校验。读失败不伪造全文；写失败保留原文件。建议行只在 Agent 切换成功且仍是当前会话时操作草稿，send:false 仅预填。

## 5. 环境变量与配置

通过标准 launcher 使用隔离 `RDC_AGENT_USER_DATA` 与 `RDC_AGENT_HOME`；Browser 高影响操作需要 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`。读取定义见 AppPathService 与 launcher。必须以完整 one-time bootstrap URL 进入同源 /app，不直接开 Vite，不用 URL token。

只从家中机器的现有资源复制必要配置、用户资源和加密凭据，排除历史会话、缓存、大型 capture；凭据值一律不输出。原机器曾需一并复制 Chromium Local State 才能解密隔离副本，但这不保证跨电脑 safeStorage 可解密：优先家中本机凭据；失败明确记录并让用户在正式界面完成登录，不自动切真实 userData 或解密成明文。

RDX CLI 使用本机已有安装与完整 catalog，不能照搬原机器 executable。必要时在隔离设置里用官方 `RDX_INTERMEDIATE_ROOT` 指向本轮独立 runtime，避免既有上下文限额；不得删除其他上下文。

## 6. 数据库与数据模型

会话/计划为主进程文件存储，复用 StorageIo 和严格 Zod；PlanReviewState 有正整数 revision、状态及完整批准字段约束。无批量迁移要求。真实会话、原始 capture、用户资源禁止覆写/迁移/清理。测试副本与正式数据严格隔离。

## 7. API、集成与外部依赖

plan:* 以 shared 类型和 Zod 为唯一当前接口，不恢复弱绑定形态。Electron 原生对话框只能由主进程选路；Browser bridge 不得为测试放宽 desktop-only、安全或 secret 边界。

本次续接不安排真实模型调用，不需要申请模型预算。General 执行、Mission 回评估及依赖它们的模型效果由后续专项另行制定场景和预算；历史八次请求的结果保留在 acceptance ledger，不重复执行。

## 8. 构建、运行、测试与部署

先用 `node --version`、`pnpm --version` 核对版本；依赖缺失才 `pnpm install --frozen-lockfile`，不回退到其他包管理器。标准入口 `pnpm run start:agent-browser`、`pnpm run start:human`；GUI 控制遵循可用工具，不把 Playwright/Electron E2E 变成门禁。

已有证据：`pnpm run test:coverage --maxWorkers=1` 396文件/2853用例通过，3文件/3用例跳过；coverage ratchet 通过，lines74.94/functions76.76/branches62.11/statements72.55%。最后5个测试文件22用例以及 typecheck、lint、check:gates、build 通过。并发测试曾导致 Investigation 超时，单 worker 全量通过；没有弱化断言。Knowledge 在专用 TEMP 通过，不要修改路径安全逻辑规避 EPERM。

修改后批量跑受影响单测、`pnpm run typecheck`、`pnpm run lint` 及专项 gate；跨层改动才补完整 coverage/ratchet、`pnpm run check:gates`、`pnpm run build`。已覆盖绿色不无故重跑。无需 pack 或发布。

## 9. 当前工作区与版本状态

生成本文时基线 HEAD 为 44f67a8e2cfe8e4ae2b8871db82cbed175449fa0，main；全部 pending list（含原 Agent 实现及 .qoder 重组）由用户明确授权提交上传。本文与该提交共同分发，无法在自身内容里嵌入自身提交 SHA。接手先 `git status --short`、`git log -1 --format=fuller`、`git remote -v`，用实际提交和 ledger 源码指纹核对；存在本地改动时不得 reset/覆盖。没有授权家中任务自动提交/推送或创建分支。

## 10. 已知问题、风险与技术债

| 优先级 | 事实/根因状态 | 收敛标准 |
| --- | --- | --- |
| P1 Capture 图像 | 本地 capture 的 Present 未唯一识别 swap-buffer；147/140/137 均无图，原因未定位 | 合法图像与证据身份、内容 hash、回放恢复一致，或明确能力边界并纠正错误实现 |
| P2 导出 UI | 内置浏览器无法操作原生保存对话框；不是已证代码缺陷 | 真实选择、取消、覆盖确认、文件内容和焦点回归 |
| P1 Android | 原机器未连接设备；旧 ledger 其他轮成功不能代表本次 | 家中真实 helper/连接/回放/恢复/关闭与设备呈现回执 |

## 11. 下一步执行计划

建立一份临时 Tasks，状态为待执行/执行中/待验证/通过/阻塞，沿下面两组推进，不重新全库审计。

1. **原生导出端到端**：用标准 Electron 或 Browser 配合用户操作原生对话框。验证读全文、复制、下载选目标、取消不写入；历史 A 在 B 产生且切 Agent 后仍保存 A 的身份和正文；固定项目路径正确。对换路径/计划、跨会话、重放、过期及写入失败沿用确定性测试。不要为 UI 自动化新增弱接口；若工具不能操作，让用户完成那一步并核验输出，其他测试继续。
2. **本地与 Android Capture**：寻找本地 capture；原路径 `J:\DebugTest\rdx` 仅供定位。原本地 capture `眼睛泪腺白点.rdc` SHA256 为 0a79926a92e7e659989befc2322dc93b65782252fc5be2de33496142735a4094，约1.65GB，不重复复制。原147→140→137→147 Applied EID与Close Not open已证，但没有图像；定位有输出的真实事件与原生回执后检查 requested/applied/image EID 和内容hash。WhiteHair 用连接的 Android 设备，核对 Tools 原生 catalog、安装/服务版本、现有 helper复用、就绪、回放、无色输出事件、恢复、关闭及设备呈现。不要求先清空设备进程，不关闭用户 helper；已有服务不等于占用。Tools 仓库只有确认不可替代直接依赖缺陷才纳入，先读其 AGENTS。unsupported 精确记录，不能伪造绿色。不要一次性跑全部128工具。

两组完成后同步受影响契约/UI文档与既有 ledger（真实源码 SHA、日期、证据、失败边界分开）。清理本轮 QA home/TEMP/日志/截图/工作清单与自有进程；先核对路径、链接、Git状态、PID所有权，保留用户数据、当前依赖和必要证据；确认桌面启动权已交还。可逆修复按逐项diff回退，不整库restore。

## 12. 新 AI 接手指令

请立即核对 checkout，再按 AGENTS.md → DESIGN.md Architecture Principles/Authority Map → docs/contracts/{runtime-kernel,permissions,session-projection}.md → docs/ui/{design-system,workbench-and-transcript}.md → docs/architecture/{rdx-runtime,browser-qa-surface}.md → docs/product/acceptance-ledger.md 的顺序读取相关部分。以本文第11节为收敛范围执行到验证和清理完成。

搜索/历史核对只委托 Luna 子 Agent，主 Agent 负责计划、实现与验证裁决。保持现有组件层级、公共Button和语义token，不留legacy/双路径。不因跨电脑路径或已清理旧QA会话重新打开整个产品设计。不可逆数据操作或安全边界冲突必须明确询问；其余可逆操作说明默认选择后继续。

## 13. 证据索引

`docs/product/acceptance-ledger.md` 的「2026-09-14 Plan/Handoff 完整链路收敛」保存工程/Browser/模型/Capture/清理证据及2217源码文件指纹。它明确区分历史与当前，不把 planned/旧verified混成新验收。相关 `.test.ts` 与生产文件同目录；Handoff fixture 经过生产审阅服务。原QA临时会话、预算守卫与覆盖率中间文件已清理，不能要求新Agent去找已删除日志。

## 14. 不确定项与待确认问题

家中 checkout/capture 路径、Android序列号与服务可用性、家中凭据可解密性需现场核实。模型回评估由后续专项负责，本次不追踪。Present 无图像的根因、原生导出交互仍需实证，不提前归因于设备或产品代码。

## 15. 交接完成度自检

- [x] 分支、基线、提交时机和家中路径发现方式明确。
- [x] 已验证与剩余两组真实验收分别描述，文件/调用链/命令可定位。
- [x] 不复制 secret、原始 capture 或旧测试副本；不依赖旧聊天。
- [x] 后续专项排除边界、失败路径、禁止重复的规避方法与清理出口明确。
- [x] 这是可执行续接需求，未把未完成验收写成通过。
