# RDC-Agent Design and Architecture Guide

`DESIGN.md` 是本仓库**产品边界、架构原则、权威地图与核心不变量**的裁决文件。若 `README.md`、`AGENTS.md` 或 `docs/**` 与本文件冲突，以本文件为准并同步修正其它文档。详细契约、产品规格与 UI 规范已分拆到 `docs/`，本文件只保留裁决层与索引，避免根目录堆叠运行时细则。

## Product Boundary

RDC-Agent 是通用 agent workbench，并一等公民支持 RDC/RDX 与 RenderDoc `.rdc`。它应能作为日常 agent 工作台完成阅读、规划、编辑、搜索、工具调用、handoff、memory 与 subagent 编排，同时保留 capture 打开、replay 上下文、RDX actions、诊断与 RenderDoc 调查等垂直能力。

产品不是固定模式向导。Ask、Plan、Edit、Debugger、Analyzer、Optimizer 是 agent profiles（指令、工具、审批策略、handoff、可见性不同）。仅 `user-invocable` 的 profile 出现在 composer orchestrator 菜单。Plan 不是硬编码 `AppMode`，而是可研究、提问、写 plan artifact、调用允许的 subagent 并 handoff 实现的 `.agent.md` profile。

唯一运行时路径是 agent loop：解析 profile / model route / policy / tools → 调用 LLM → 执行已批准工具 → 回灌结果 → 产出 final answer。Renderer 不得伪造推理阶段；隐藏 CoT 永不作为 UI 内容展示或持久化。

## Architecture Principles

1. **单一真相**：Session / Conversation / branch / journal 是会话历史权威；Agent slot 是执行配置与缓存，不是私有历史。
2. **冻结执行**：`EffectiveRuntimePlan`（`schemaVersion: 2`，含 `planId` / fingerprint 与完整工具/策略面）在 `prepareTurn` 冻结；Prompt 与 Executor 共用；在途 turn 不读可变 Settings。
3. **主进程权威**：权限、secret、MCP trust、Shell、RDX CLI、IPC 校验均在 `src/main`；preload / renderer / Browser Bridge 只暴露受控面。
4. **Scope 固定**：用户资源 `~/.rdx`，项目资源 `<project-root>/.rdx`；无配置 workspace root、无旧目录 fallback、无静默迁移。
5. **Provider 事实外置**：模型/协议/控件事实只在 `src/shared/provider-catalog/manifests` 的严格 JSON；TS 只实现 Schema、compiler、Registry、Resolver、Planner、adapter、auth、discovery。
6. **可取消与可回收**：Turn 经 `TurnCoordinator`；子进程经 `ProcessSupervisor`；应用退出经 `ShutdownCoordinator`；abort 必须 join，迟到 event 按 generation 丢弃。
7. **失败有分类**：安全类 fail-closed；完整性 degrade-safe；可用性 recoverable。分类权威见 `docs/contracts/failure-model.md`。
8. **无 legacy 双轨**：新结构替代旧结构时直接收敛；默认不保留兼容 shim。

## Authority Map

| 主题 | 权威位置 |
| --- | --- |
| 产品边界与本文件不变量 | 本文件 |
| Runtime / Prompt / Provider / Tool / Session 契约 | [`docs/contracts/runtime-kernel.md`](docs/contracts/runtime-kernel.md) |
| 权限、Bridge、Secret、MCP trust、Sandbox、CSP、IPC | [`docs/contracts/permissions.md`](docs/contracts/permissions.md) |
| Fail-closed 三分类与标注点 | [`docs/contracts/failure-model.md`](docs/contracts/failure-model.md) |
| Orchestrator façade 行数 / 职责外提 | 本文件 Invariant + `pnpm run check:orchestrator-facade` |
| Profiles / Skills / Hooks / Memory / RDX 产品规格 | [`docs/product/`](docs/product/) |
| Workbench / Work Process / Appearance / Design System | [`docs/ui/`](docs/ui/) |
| 模块地图与数据流 | [`docs/architecture/`](docs/architecture/) |
| 工作流与 Debugger 主链 | [`docs/workflows/`](docs/workflows/) |
| Agent 修改纪律与验证命令 | [`AGENTS.md`](AGENTS.md) |

实现细节以源码为准；文档描述稳定契约，不回写运行时代码规则。

## 核心 Invariant

- **资源优先级**：`builtin < user < project`；整资源替换；policy 只收紧（deny 并集、审批强度只升、数值上限只降）。
- **Skill 工具面**：`allowedTools = ∩(skill_i) ∩ runtimeAllowlist`（空声明不收窄）；skill 只能收窄、永不扩展 profile 工具集；元工具豁免见 runtime 契约。
- **Deferred tools**：未激活 deferred → `TOOL_NOT_ACTIVATED`；仅 `tool_search`（及契约允许的激活路径）可激活。
- **Capability unknown**：`toolCalling.state === unknown` → text-only；仅 `supported` 才 `native-structured`。
- **输出通道**：`ProviderOutputRef` 一经声明永久归属 `thinking` | `text` | `tool_call` 之一；普通 assistant text 永不合成 thinking；仅 `final_answer` 写正文。
- **Secret**：`safeStorage` 不可用则 fail-closed；secret 不得进入 renderer / IPC 明文 / Trace / RequestPlan。
- **Browser Bridge**：仅 `RDC_AGENT_BROWSER_QA=1`；bearer + Origin + channel allowlist；与桌面 preload 路径共享 handler registry。
- **MCP project**：同 ID 不可覆盖 user 的 command/args/url/env；变更需 `needsRetrust` + 显式 trust。
- **RDX**：无内置 CLI 副本；Open `.rdc` 等垂直入口只走 Settings 配置的 shell action。
- **Capture 所有权**：`ownerSessionId` 不匹配则 fail-closed；不得跨 session 继承已打开 capture。
- **Orchestrator façade**：`AgentOrchestrator.ts` 保持 façade（**少于 800 行**）；turn 准备、tool 装配、executor、turn/subagent runner、prompt-plan 等职责外提到协作单元；门禁 `pnpm run check:orchestrator-facade`（亦挂在 `check:architecture`）。
- **CSP**：生产 `script-src` 无 `unsafe-inline`；`style-src 'self'`（无 `unsafe-inline`）；`style-src-attr 'none'`；动态样式经 constructable stylesheet（`useDynStyle`），禁止依赖 inline style attributes。
- **IPC Zod**：全部 IPC handler 经 `parseIpcArgs`；非法 payload fail-closed；`approvalToken` 单次消费。
- **RDX context lease**：仅 per-session lease（`setRdxRuntimeContextForSession` / `getRdxContextLease` / `assertRdxContextLeaseOwnership`）；**禁止** RDX global mirror、`legacyGlobalMirror`、`getRdxRuntimeContext` 全局 API。
- **EffectiveRuntimePlan**：`schemaVersion: 2`；在 `prepareTurn` **完整冻结**（`planId` / fingerprint / tools / skill ∩ / deferred / MCP hash / permission / policy / route / request+prompt fingerprints）；Prompt 与 Executor 共用；在途 turn 不读可变 Settings。

## Document Index

### Contracts

- [`docs/contracts/runtime-kernel.md`](docs/contracts/runtime-kernel.md) — Agent loop、Prompt/Request、Reasoning、Tools、Session、Model capability
- [`docs/contracts/permissions.md`](docs/contracts/permissions.md) — Permission mode、Sandbox、CSP、IPC Zod 全量、Bridge、Secret、RDX lease、MCP trust、Shell
- [`docs/contracts/failure-model.md`](docs/contracts/failure-model.md) — Security / Integrity / Availability

### Product

- [`docs/product/scoped-runtime-resources.md`](docs/product/scoped-runtime-resources.md) — Scope、Profiles、Skills、Hooks、Memory、Project Instructions
- [`docs/product/vertical-debugger-overview.md`](docs/product/vertical-debugger-overview.md)
- 其它：`docs/product/README.md`

### UI

- [`docs/ui/workbench-and-transcript.md`](docs/ui/workbench-and-transcript.md) — Workbench 轨、Work Process、Composer、Markdown
- [`docs/ui/design-system.md`](docs/ui/design-system.md) — Token、Appearance 双体系
- [`docs/ui/knowledge-center.md`](docs/ui/knowledge-center.md)

### Architecture / Workflows

- [`docs/architecture/README.md`](docs/architecture/README.md)
- [`docs/workflows/README.md`](docs/workflows/README.md)

## Verification Gate（摘要）

代码改动至少：`pnpm run typecheck`。按改动面追加 `check:architecture`（含 `check:orchestrator-facade`）、`check:orchestrator-facade`、`check:fidelity`、`check:shared-exports`、`check:agent-runtime`、`check:provider-system`、`check:provider-catalog`、`check:tool-system`、`check:work-process*`、`check:reasoning-delivery`、`check:appearance`、`check:settings-agents`、`check:repository-hygiene`、`test:coverage`（覆盖率阈值门禁）、相关 vitest contract 套件。UI/工作流用 `pnpm run start:agent-browser` 真实会话验收。完整命令与 UI 验收清单见 `AGENTS.md`。
