# Generative UI 与 Canvas 架构

## 边界

Generative UI 使用现有 provider 配置与 `edit` agent route，将 prompt 转换为可运行的 Web UI。Canvas 是持久化创作聚合，不是聊天消息附件，也不是预定义模板目录。

```text
Prompt / refinement
  -> LlmGenerativeUiModel.plan (UI Spec)
  -> LlmGenerativeUiModel.generate (HTML/CSS/JS)
  -> GenerativeUiVerifier (Level 1 + Level 2)
  -> sandbox preview + runtime observer
  -> LlmGenerativeUiModel.reflect
  -> GenerativeUiInnerLoop decision
  -> GenerativeUiCanvasService persistence
```

Agent 自动模式采用可恢复的 split-phase loop：L1/L2 通过后 version 以 `runtimeDecision=pending` 持久化；真实 Canvas sandbox 上报 L3 后，`GenerativeUiRuntimeContinuation` 再执行 runtime-aware Reflector/Decision。`success` 会关闭 Canvas，`continue` 会在同一 branch 生成下一 version；browser/main 跨阶段不依赖一个长期挂起的 IPC 请求。人工 checkpoint 模式只记录 L3，由用户决定是否继续或完成。

Verification Ladder 采用 fail-closed 语义。L1 校验 HTML 标签结构、CSS delimiter/`@import`、JavaScript 编译，以及 embedded script/style、remote URL/dynamic import、network/storage API 和 parent-frame access 禁令。L2 不接受 component kind 的模糊命中：每个 Spec component 必须以 exact stable ID 出现在 source 中；每条 interaction 必须有对应事件 handler，data binding 两端必须可解析，并同时满足 responsive/viewport、semantic landmark、image alt 与 form-control accessible name。L3 只接受真实 sandbox observation 与明确的人类/评估 evidence。

Sandbox observer 在 generated JavaScript 执行前创建私有 `MessageChannel`，host 只接受 iframe 首个带 transferable port 的握手；generated source 的普通 `parent.postMessage` 不能成为 telemetry。`ready` 与 interaction 还要求 `Event.isTrusted`，因此脚本自行 dispatch 的事件不能满足 L3。无论调用来自 UI、IPC 还是 agent loop，持久化层都拒绝将缺少通过态 L1/L2/L3 的 active branch head 标记为 `success`；manual edit 若未提交 deterministic verification，会在 commit 时重新计算 L1/L2。

编辑器中的未保存 source 属于 draft preview：它可以即时重载 sandbox 供用户查看，但 observer event 不得归入当前 persisted version。保存后 iframe 以新 `versionId` 作为 navigation key 重新创建，建立该 version 独占的 telemetry channel，随后产生的 trusted ready/interaction 才能进入 L3。这避免 live edit 的事件污染父 version，也避免 source 在保存前已预览时遗漏新 version 的握手。

每个 plan、generate、reflect 与 runtime-reflect provider call 都必须经过 `PromptPlan -> RequestEnvelopeSnapshot -> LLMAdapter`。Snapshot 使用 `sessionId` 与 `generative-ui:<canvasId>:<branchId>` turn identity 持久化 phase、route、protocol、redacted messages、controls 和最终 usage。图像使用 provider-native multimodal content block，snapshot 对 binary bytes 做 hash/redaction；Canvas version 只持久化外部上下文的 source/hash/scope/precedence/redaction reference，不复制 data payload 或 image bytes。Canvas 的 Changes tab 展示相对 parent version 的 HTML/CSS/JS 与 UI Spec 变化，branch history 只投影当前 branch。

## 跨层契约

- `src/shared/types/generativeUi.ts`：Canvas、version、branch、verification、observation、feedback、budget 和 metrics。
- `src/main/generative-ui`：模型适配、Inner Loop、deterministic verifier、sandbox 与持久化服务。
- `src/main/ipc/generativeUiHandlers.ts`：唯一 main-process API 边界。
- `src/preload/api/generativeUi.ts`：Electron 受控暴露。
- `src/renderer/features/generative-ui`：Canvas 工作区、实时源码编辑和 preview。
- `BrowserAppBridge` 与 Electron preload 暴露相同 API，不产生 renderer-only 假数据。

## 安全与追溯

Preview iframe 仅包含 `allow-scripts`，不包含 `allow-same-origin`。CSP 禁止 network、form、base URL 与外部资源。Observer 只允许向宿主上报有限的运行事件。Canvas JSON 使用临时文件加原子 rename 写入；branch commit 必须匹配当前 head，stale commit fail-closed。

每个 version 保存原始 refinement prompt、Spec、source、reflection、verification 和成本/时延数据。runtime observation 与 Level 3 feedback 作为 append-only evidence 关联 version，不改写历史 source。

## 停止与评估

- `success`：验证完成并经自动规则或人类 checkpoint 确认。
- `blocked`：连续生成相同 source，无法取得实质进展。
- `exhausted`：达到 iteration、time、token 或 cost 上限。
- `no_op`：Planner 判断请求不适合交互 UI。

`GenerativeUiCanvasService.summarize` 从实际持久化证据计算 success rate、loop closure、preference rate、median iteration processing time、median prompt-to-usable time、preview-ready latency、五轮有效 Canvas 数和 runtime errors。Prompt-to-usable 从 `Canvas.createdAt` 计算到首个 L3 通过并写入 `version.usableAt` 的时刻，每个 Canvas 只取首次可用时间；不得用 planning/generation/render/verification 阶段相加冒充端到端时间。Preview latency 由 sandbox document 用 navigation 后的 `performance.now()` 到 `DOMContentLoaded` 计算，并随第一个 `ready` event 持久化；median 目标为不高于 2 秒。五轮有效迭代必须是同一 parent-linked lineage 上连续五个 L1/L2/L3 全通过的 version；仅有五个持久化 version 不计入。没有 Level 3、preference 或 latency 样本时对应结果为 `null`，不得用 0 或推测替代。

## Outer Loop

`GenerativeUiOuterLoopService` 将项目级演进证据持久化到应用状态目录 `state/generative-ui-evaluation`，与 Canvas source/version 分离。证据包含四类：真实 use case、带来源与日期的 competitor observation、独立 expert review，以及记录随机候选顺序的 blind preference。每条有效 blind decision 必须绑定当前 session 中真实存在的 Canvas/version 和明确的 static baseline artifact reference；相同 panel、dynamic artifact、static artifact 组合不能重复计数。普通的 “Prefer UI / Prefer text” 反馈不等同于盲测证据，不能自动提升发布指标。

每周 report 同时检查产品指标和最低样本量：至少 20 个复杂生成案例、5 个真实 use case、1 份竞品观察、3 份专家评审、20 个有效盲测判断，并至少有一个 Canvas 保留 5 轮版本。Real use case 必须绑定本 session 中 L1/L2/L3 全通过的 Canvas/version；blind preference 的 dynamic candidate 也必须绑定闭环 version。Expert review 必须包含 0-100 score 与 review notes，并以规范化 reviewer source 去重，重复 reviewer 不计作独立评审；旧 evidence 即使存在于文件中，不满足这些 provenance 条件也不进入 release counts。只有 generation success ≥ 85%、L1/L2/L3 closure ≥ 90%、blind preference ≥ 65% 且全部证据门槛满足时，decision 才能进入 `v1_ready`；否则保持 `continue` 并返回可执行 gaps/actions。
