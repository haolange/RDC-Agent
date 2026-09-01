# RenderDoc Agent 完整设计（v2）

> **文档地位**：本文件是受根目录 [`DESIGN.md`](../../DESIGN.md) 裁决的详细目标设计，**不是第二产品权威**。若与 `DESIGN.md` / `AGENTS.md` 冲突，以 `DESIGN.md` 为准并回改本文。
>
> **实现状态**：文中模块、schema、服务以目标态叙述。Wave 3 已落地 Knowledge 五服务、七 lane、五个 deferred 工具与 Knowledge Center 三列 UI。Wave 4 schema 已落地 `rdc.investigation.v1`、`InvestigationArtifactService` 与三个 deferred Investigation 工具；4 个 builtin Hook 模板与 Session rail 五卡已落地。Wave 5：三条 Mission 方法面已接到 Skill / Hook / Capsule（Debugger `$debugger-causal-method`，Analyzer `$analyzer-architecture-method`，Optimizer `$optimization-experiment`；现 15 个垂直方法 Skill）。产品级 Browser QA 与本机 ColdData 真实验收仍待 Wave 6，不得写成已跑。durable handoff 状态机已落地。`check:knowledge-system` browse-only channel 债务已清零；`check:investigation-system` 已清零 schema/service/contract/五卡债务，其余只减不增。
>
> **读者**：实现后续 Wave 的 Codex / Agent。路径相对本仓库。中文为主，产品术语保留英文。

---

## 0. 阅读约定

- **当前态**：仓库现有实现。
- **目标态**：后续 Wave 必须收敛到的单一路径。
- **迁移中**：目标模块已裁决、尚未实现；实现时直接收敛，不保留 legacy 双轨。
- 本文重组桌面《RenderDoc Agent 完整设计书》的领域契约，并叠加仓库化裁决。桌面书不是权威。
- 本机 `ColdData` 原料与原始导出截图**不进入本仓库**；CI 只用脱敏 fixture（文件名如 `symptom-compare-<shortHash>.png`）。

---

## 1. 产品定义与三个目标函数

RDC-Agent 仍是通用 Agent Workbench。RenderDoc 垂直能力是建立在通用 Runtime、Profile、Skill、Hook、Task、Sub-Agent、Shell、durable Handoff 之上的内置能力包，不是第二套 Agent 内核。

三个 Mission 是同一套调查基础设施上的三个目标函数，不是三套独立系统：

| Mission | 核心问题 | 目标函数 |
| --- | --- | --- |
| Debugger | 为什么结果错了？ | \(\arg\min\) RootCauseUncertainty |
| Analyzer | 这个未知渲染系统怎样工作？ | \(\arg\max\) SystemExplainability |
| Optimizer | 成本在哪里，怎样降低？ | \(\arg\min\) Cost，约束 Correctness / Quality / Scope |

共享因果闭环：

```text
Goal → Observed Facts → Structure / Hypotheses → Evidence
  → Differential Analysis → Experiment / Verification
  → Skeptic → Report
  →（仅当用户显式点击/命令，或 Agent 本轮得到明确用户意图后
     调用 knowledge_candidate_create）Session Candidate
  →（仅 human review）Promote
```

成功标准（正确性 / 可追溯性 / 可验证性 / 可泛化性 / 可进化性）全部落在垂直 Session Artifact 与 Knowledge 上，不侵入 `TaskRecord`、`AgentProfile` 或 `ConversationMessage`。

**非目标（当前态与目标态共同成立）**

- 不把约 194 个 RDX 命令注册为 Agent Tool 或 MCP。
- 不新建平台级 InvestigationGraph、第二 TaskStore、Mailbox / Blackboard。
- 不自动写 Memory / Knowledge / Candidate / Promote；LLM 不得自治写 Knowledge。
- 不把 Embedding 并入 Agent / Composer / subagent picker。
- 不把 Plan 做成 Permission Mode，不恢复 Ask / Plan / Edit 作为目标顶层身份。

---

## 2. 五个平面

五个 Plane 正交。实现时映射到已有主进程模块与垂直 Session Artifact，不新增平行 Runtime。

```text
Control Plane          Plan / Tasks / durable Handoff / Small·Big Loop / Skeptic
Execution Plane        四个 builtin Profile / Sub-Agent / Skill / Tool / 并发组
Investigation State    WorldState / Evidence / Claim / Experiment / Challenge / Manifest
Context Plane          L0–L5 选择 / Delegation Capsule / 三层 Compaction / 可恢复引用
Knowledge Plane        六 Type / 多轴 Scope / Lifecycle / Promotion / Negative
```

| Plane | 回答 | 仓库映射（目标态） |
| --- | --- | --- |
| Control | 目标、当前 Task、谁负责、Verifier、Small / Big Loop | 通用 `taskProjection` + durable `ProfileHandoffState` + plan artifact |
| Execution | 哪个 Agent、哪些 Skill/Tool、谁可并行、谁必须独占 | builtin Profile + executor 并发合同 + 外部 RDX `shell` |
| Investigation State | 已确认、竞争假设、World State、实验污染 | `rdc.investigation.v1` Session Artifact |
| Context | 这次推理看什么、如何压缩、如何 drilldown | PromptPlan + Artifactization + Mission Checkpoint |
| Knowledge | 可复用什么、Scope、验证等级、冲突 | 五服务 + 七 lane；canonical 仍在 `~/.rdx/knowledge` 或 `<project-root>/.rdx/knowledge` |

端到端生命周期：用户选择 Mission → Planning Orchestrator → 有限探测与 Knowledge 检索 → plan artifact → durable Handoff → General Execution Orchestrator → Tasks 展开 → Live RDC 串行 + Offline 可并行 → 垂直记录 → Skeptic → Small Loop 或 Big Loop → 报告。Session Candidate **不是**默认产物：仅当用户显式点击 / 命令，或 Agent 在本轮得到明确用户意图后显式调用 `knowledge_candidate_create` 才创建。持久 Promote 仍只能 human review。

---

## 3. 仓库化裁决摘要

权威表在 `DESIGN.md`「Current / Target / Migration Adjudications」。此处只列实现时不得走样的合同。

### 3.1 四个 builtin Profile（目标态 / 迁移中）

- 官方文件只放 `resources/agent-runtime/agents`，scope = builtin。
- 生效优先级 **`builtin < user < project`**，整资源替换。运行时**不再写 user seed**。
- `general` = Execution Orchestrator；`debugger` / `analyzer` / `optimizer` = Planning Orchestrator。
- 空 `handoffs` 禁止；空 `agents` 仅表示可委托自身。
- 不新增 `mission` / `orchestratorType` / `investigationMode` 等 Profile 领域字段。
- 历史 S0–S8 以 **parse 后语义 hash** 识别；`instructions` / `tools` / `skills` / `agents` / `handoffs` / **`model` / `icon` / `accent`** 任一变化视为用户修改，保守不迁。
- 匹配官方语义的旧文件原子移至 `~/.rdx/agents/.migrated/<migration-id>/`，**不物理删除**。
- marker：`~/.rdx/agents/.seed-migration.json`；经 `StorageIo` 原子 / 幂等 / 可重入 / 写诊断。
- 禁止交互式「导出 / 保留 / 移除」选择面。Ask / Plan / Edit 不是目标拓扑，也不是 fallback。

### 3.2 Right Rail

- Project rail **仅** `Import .rdc` + 已导入列表，不读 session runtime。此合同当前已成立，目标不变。
- Session rail 只有五卡 `Progress / Artifacts / Outputs / Context / Capture`。
- Artifacts = main-owned Investigation Artifact 投影，不是工作目录扫描，也不是 `output_register`。
- Outputs 只认 `output_register`。Capture 保留 scoped `.rdc`、Replay Device 与现有所有权。
- 只保留五卡一套文案，禁止再把三卡或四卡写成现行合同。

### 3.3 Embedding（独立 capability，目标态 / 迁移中）

路径：manifest `embeddings` → `EmbeddingCatalog` → `EmbeddingExecutionService`。独立 `embeddings` protocol / adapter。opaque credential `operation=embed`。consent **默认关**。索引绑定 identity / dimension / chunker / corpus hash；重建必须显式 rebuild。semantic lane 未配置、拒绝或失败时返回 `unavailable` / `stale` 并 fail-closed，其余 lane 仍可工作，但不得宣称已做语义检索。**严禁**进入 Agent / Composer / subagent picker 或 EffectiveCatalog 的 agent 可选集。Discovery 的 agent modality 边界不放松。Embedding capability 本身已落地；Knowledge 五服务已落地，完整 semantic 检索仍依赖 consent 与显式 rebuild。

### 3.4 Durable Handoff（已落地）

`ProfileHandoffState` 经 `HandoffStateStore` 写入 `<sessionPath>/handoff-state.json`。现有 `AgentHandoffDefinition` 仍只是 manifest 路由声明，不是该状态机。Debugger Big Loop 走同一套机器（链上限 3，重启不自动开火）。见 §5。

### 3.5 并发（目标态 / 迁移中）

缺省不安全。见 §6。实现前不得写成已完成能力。

### 3.6 Knowledge 与 Investigation 门禁

门禁脚本：`pnpm run check:knowledge-system`、`pnpm run check:investigation-system`。**ratchet 已建立**；Investigation schema / Service / contract suite / 五卡已清零。三条 Mission 方法面已接到 Skill / Hook / Capsule。禁止用空壳测试、skip/todo 或只加类名绕过；债务只减不增，Wave 6 清零。产品级 Browser QA 与本机 ColdData 真实验收仍待 Wave 6。

---

## 4. Coordinator 与 Skill / Hook / RDX

Coordinator **不是**新 Runtime，也不是 Profile 新字段。它是：

`profile instructions + 预加载根 Skill + 按需 Skill + Hook + 通用 Task + 垂直 Artifact + durable Handoff`

的组合。Planning Orchestrator 负责理解目标、澄清、有限探测、编排与计划；General 负责 Task 分解、Shell / Sub-Agent、验证与报告。Knowledge Candidate 仅在用户显式意图下由 `knowledge_candidate_create` 创建，不是 General 的默认收尾步骤。

RDX 仍是外部 CLI：Agent 像人类一样用通用 `shell` 调用，经定向 `--help` 发现用法。Settings action 只服务 UI 确定性入口。Catalog 不得展开为模型工具 Schema。Live Capture / shader replace / replay 必须走 exclusive World State，不得进入并发组。

---

## 5. Durable Handoff 状态机

### 5.1 记录字段

| 字段 | 含义 |
| --- | --- |
| `handoffId` | 实例稳定 id |
| `lifecycle` | `prepared` / `committed` / `consumed` / `cancelled` |
| `sourceTurnId` | 发起 turn |
| `sourceRequestId` | 发起 request |
| `sourceAgentId` | 源 profile |
| `toAgentId` | 目标 profile |
| `chainRoot` | 用户 root 链 id |
| `depth` | 相对 root 的深度；每用户 root 链最多 3 |
| `prompt` | 交接正文（含 plan / artifact refs，不含 secret） |
| `label` | 人类可读标签 |
| `declaredModel` | **字段必存在，值可为 `null`**。非空时为 canonical `providerId:modelId` |
| timestamps | `preparedAt` / `committedAt` / `consumedAt` / `cancelledAt` |
| `cancelReason` | Stop / Rewrite / branch / manual_switch / restart_degrade / invalid_model / depth_exceeded / superseded |

### 5.2 提交点

| 状态 | 唯一合法进入条件 |
| --- | --- |
| `prepared` | `agent_handoff` 工具成功，且通过深度 / 同 session 单活跃 / model 预检 |
| `committed` | **仅**源 turn complete |
| `consumed` | **仅**目标消息 commit |
| `cancelled` | 任意未完成点：Stop / Rewrite / branch / 手动切换 profile / 重启降级 / 非法 model / 超深度 |

`send:true` 只在 `committed` 后自动续跑。进程重启后未 `consumed` 的实例降级为手动继续，不自动续跑。审批不继承。同一 session 同时只允许一个活跃 handoff。空 `handoffs` 禁止；空 `agents` 仅自身。

### 5.3 模型优先级

始终按下列顺序，handoff 目标 turn **继承**当前 session `modelOverride`（若存在且可执行）：

1. session `modelOverride`（必须已通过 `isAgentToolExecutableModel`）
2. handoff `declaredModel`（字段必在；值为 `null` 则跳过本档；非空必须再通过 `isAgentToolExecutableModel`。不在 EffectiveCatalog available 或 `pickerVisibility === 'internal'` 则 fail-closed）
3. target profile route

非法 model fail-closed，禁止静默回退。**审批不继承**（与模型优先级无关）。

---

## 6. 并发执行合同

- 只有 `AgentTool.spec.isConcurrencySafe === true` 才安全；**缺省 `false`**。
- 只并发**连续**安全组；unsafe 调用独占，切开前后组。
- 下列工具一律串行：`shell`、write、task mutation、RDX / Live Capture、MCP、ask、handoff、`output_register`。
- `callIndex` 保持稳定顺序，UI / Trace / 结果回灌都按它排序。
- dispatch 前原子扣减预算；扣减失败整组不开。
- abort 必须 `Promise.allSettled` join，不得丢孤儿进程。
- 部分失败不连坐同组其余**已发出**调用的结果记录，但不得继续开新组。
- offline subagent 必须 `requiresRdxLease=false`；需要 RDX lease 的工作不得进并发组。

---

## 7. 八个调查对象

领域对象只活在 `rdc.investigation.v1` Session Artifact 中。Hypothesis 是 `ClaimRecord.claimKind`，Decision 内嵌于 Claim，不另建平台类型。

| 对象 | 定义 |
| --- | --- |
| Artifact | 可持久化文件或数据：capture、shader、截图、JSON、报告、timing |
| Observation | Tool 或视觉观察到的原始现象 |
| Evidence | 带来源、参数和 World State 的可引用 Observation |
| Claim | 系统要表达的结论 |
| Hypothesis | 尚待验证的机制解释（`claimKind = hypothesis`） |
| Experiment | 对变量进行 Intervention 的验证过程 |
| Challenge | 对 Claim / Evidence / Experiment 的反驳要求 |
| Decision | 为什么接受、拒绝、降级或延期一个 Claim |

---

## 8. 混合 Schema（`rdc.investigation.v1`）

只存在于垂直 Session Artifact。禁止写入 `TaskRecord` / `AgentProfile` / `ConversationMessage`。垂直记录只能引用 task id。禁止平台级 Graph Service。

### 8.1 认识论与双轴

偏序：**`unknown < inferred < derived < observed`**。Compact、Report、View **不得**升高源 Claim 的认识论等级（`S-CLAIM-01`）。

Confidence 与 Verification **分离**，禁止用单个 `0.92` 代替二者。

| 轴 | 取值 |
| --- | --- |
| Confidence | `exact` / `strong` / `probable` / `speculative` |
| Verification | `observed` / `reconstructed` / `differential_supported` / `replay_counterfactual` / `runtime_counterfactual` / `cross_scene` / `cross_device` / `expert_reviewed` |

### 8.2 `WorldState`

| 字段 | 合同 |
| --- | --- |
| `worldStateId` | 稳定 id |
| `kind` | `baseline` / `experiment` / `restored_baseline` / `unknown` |
| `captureRef` | 当前 capture 引用（session-owned，非绝对路径） |
| `replay` | 环境：adapter / driver / device / exclusiveLock |
| `shaderReplacement` | 当前替换（可空） |
| `patchStack` | 已应用 patch 顺序 |
| `focus` | event / resource / pixel / subresource |
| `benchmark` | warmup、分辨率、vsync、采样协议 |
| `validity` | `valid` / `stale` / `polluted` / `unknown` |

旧 patch 状态下的 timing **不得**当 baseline。未持有 exclusive lock 的 mutate 使后续 Evidence `stale` 或 World State `polluted`。

### 8.3 `EvidenceRecord`

| 字段 | 合同 |
| --- | --- |
| `evidenceId` | 稳定 id |
| `mission` | `debugger` / `analyzer` / `optimizer` |
| `observationKind` | 如 `image_compare` / `spirv_slice` / `timing` / `pixel_history` |
| `summary` | 短摘要，不升格为 Claim |
| `epistemicStatus` | 偏序四值之一 |
| `worldStateId` | 必填；`S-STATE-01` |
| `source` | tool / 人工 / 外部文档，含参数指纹 |
| `artifactRefs` | 可解引用的 Session Artifact |
| `contentHashes` | 对应内容 sha256 |
| `taskRef` | 可选通用 task id |
| `claimIds` | 支撑或反驳的 Claim |
| `experimentId` | 可选；若存在必须可解引用 `ExperimentRecord` |
| `region` | 像素 / event / 资源范围 |
| `strength` | 对所引 Claim 的支持强度 |
| `stale` | World State 失效后必须为 true |

### 8.4 `ClaimRecord`

`claimKind`：`observed_fact` / `derived_structure` / `semantic_inference` / `hypothesis` / `causal_conclusion` / `optimization_recommendation` / `limitation`。

| 字段 | 必填 | 合同 |
| --- | --- | --- |
| `claimId` | 是 | 稳定 id，全 session 唯一 |
| `claimKind` | 是 | 上列枚举 |
| `statement` | 是 | 结论正文 |
| `epistemic` | 是 | 偏序四值之一 |
| `confidence` | 是 | 与 Verification 分离 |
| `verification` | 是 | 验证轴，不得用 confidence 代替 |
| `worldStateId` | 是 | 可解引用 `WorldState` |
| `experimentId` | 条件 | `claimKind ∈ {causal_conclusion}` 或 Claim 宣称 counterfactual 时**必填**，且必须可解引用 `ExperimentRecord`；其余 kind 可空 |
| `supports` / `contradicts` | 否 | 指向其他 `claimId` |
| `scope` | 是 | 多轴适用范围 |
| `rootCause` | 条件 | 仅 Debugger 根因 Claim |
| `decision` | 否 | 内嵌 `accept` / `reject` / `downgrade` / `defer` + 理由 + `challengeId` |
| `compactProvenance` | 条件 | 凡由 compact / report / view **生成或投影**的 Claim / `statement` **必填**且非空。元素：`{ sourceClaimId, sourceEpistemicStatus, sourceVerificationLevel }`。每个 `sourceClaimId` 必须可解引用；三项字段必须与源 `ClaimRecord` 的 `claimId` / `epistemic` / `verification` **逐字一致**。缺省、空数组或任一不一致直接违反 `S-CLAIM-01`。非投影的原始 Claim 可空。 |

投影等级算法（`S-CLAIM-01`）：

```text
epistemicRank: unknown=0 < inferred=1 < derived=2 < observed=3
maxLegalEpistemic = min({ epistemicRank(p.sourceEpistemicStatus) | p ∈ compactProvenance })
require epistemicRank(projected.epistemic) <= maxLegalEpistemic
```

`maxLegalEpistemic` 即「最大合法源」：不得高于**任一**源，因此合法上限是全体源的最小 rank。禁止用多数源或「最强源」抬升。

`rootCause` 七元组：

```text
Trigger · Fault Location · Failure Mechanism · Propagation
· Manifestation · Scope · Counterfactual Evidence
```

`causal_conclusion` 与宣称 counterfactual 的 Claim 必须满足精确 `S-CAUSAL-01`（见 §8.9）。引用解析：`experimentId` → 同 session `ExperimentRecord`；`worldStateId` → `WorldState`；`supports` / `contradicts` → 其他 `claimId`。不可解引用则 schema 失败。

### 8.5 `ExperimentRecord`

| 字段 | 必填 | 合同 |
| --- | --- | --- |
| `experimentId` | 是 | 稳定 id，供 Claim / Evidence / Manifest 引用 |
| `hypothesisClaimId` | 是 | 可解引用被测 `ClaimRecord`（通常 `hypothesis`） |
| `intervention` | 是 | `{ type, payload }`；`type == none` **不能**当 counterfactual |
| `baselineWorldStateId` / `variantWorldStateId` / `restoredWorldStateId` | 是 | 三者齐全且可解引用才能关闭 mutate |
| `controlledVariables` / `changedVariables` | 是 | 必须显式列出 |
| `metrics` | 是 | timing / 视觉 / compiler 等 |
| `protocol` | 是 | `A-B-A` 或 `ABABAB`；含 warmup 与噪声阈值 |
| `visualValidation` | 否 | before / after / diff / region |
| `result` | 条件 | `status ∈ {recorded, rolled_back}` 时必填 |
| `rollback` | 是 | 形状必须为 `{ executed: boolean; baselineRestored: boolean; verifyEvidenceIds: string[] }`。因果验证三者均须满足：`executed === true`、`baselineRestored === true`、`verifyEvidenceIds.length >= 1` 且每项可解引用 `EvidenceRecord` |
| `actionClass` | 否 | Optimizer：`C` / `R` / `E` |
| `status` | 是 | `designed` / `running` / `recorded` / `rolled_back` / `failed` / `aborted` / `polluted` |

Shader Replace 事务：Clean Baseline → Begin Experiment → Apply Patch → Verify Compilation → Replay → Record → Rollback → Verify Baseline Restored。后续 Task **不得**默认继承上一实验的 shader 状态。引用解析：`hypothesisClaimId` → `ClaimRecord`；三个 world state id → `WorldState`；`rollback.verifyEvidenceIds` → `EvidenceRecord`。

### 8.6 `ChallengeRecord`

| 字段 | 必填 | 合同 |
| --- | --- | --- |
| `challengeId` | 是 | 稳定 id |
| `targetRef` | 是 | `{ type: claim\|evidence\|experiment, id }`，id 必须可解引用 |
| `challengeKind` | 是 | 反驳类别 |
| `statement` | 是 | 反驳要求 |
| `requiredFollowUp` | 否 | 定向补证 |
| `status` | 是 | `open` / `resolved` / `wont_fix` |
| `resolutionClaimId` | 条件 | `status == resolved` 时必填，可解引用 `ClaimRecord` |

Skeptic 的输入应是 Claim / Evidence / Experiment / Negative / Alternative / Scope / Unknown，而不是 Generator 长叙事。

### 8.7 `MissionCheckpoint`

Big Loop 与长任务恢复的精简状态：`goal`、`planVersion`、`established`、`rejected`、`completedExperiments`（`experimentId[]`）、`openChallenges`（`challengeId[]`）、`reasonForReplan`、`currentWorldStateId`、`criticalArtifactRefs`（`artifactId[]`）、`unresolvedFrontier`。不是第二份 TaskStore。所列 id 必须可解引用。

### 8.8 `InvestigationArtifactManifest`

每条清单记录的字段与必填性：

| 字段 | 必填 | 合同 |
| --- | --- | --- |
| `artifactId` | 是 | 稳定 id |
| `mission` | 是 | `debugger` / `analyzer` / `optimizer` |
| `kind` | 是 | 闭集，见下方 Kind Registry；禁止未登记 kind |
| `status` | 是 | `draft` / `ready` / `stale` / `failed` / `superseded` |
| `title` | 是 | 人类可读标题 |
| `summary` | 是 | 短摘要，不升格 Claim |
| `contentRef` | 是 | 正文相对 session artifact 路径 |
| `sourceRefs` | 是 | `ArtifactSourceRef[]`，元素 `{ artifactId: string; expectedHash: 'sha256:...' }`。`ready` 时 `length >= 1`；`artifactId` 可解引用；`expectedHash` 必须等于该源**当前**内容的 sha256（与源自身 `contentHash` 一致） |
| `contentHash` | 是 | `sha256:` + hex，**等于** `contentRef` 指向正文字节的 sha256，不是 source 的 hash，也不是摘要文本的 hash |
| `recordType` | 是 | 必须等于 Kind Registry 为该 `kind` 解析出的 `recordType`；否则不得 `ready` |
| `worldStateId` | 条件 | 绑定世界状态的记录必填，且可解引用 |
| `supersedes` | 否 | 被取代的旧 `artifactId` |
| `createdAt` | 是 | ISO-8601 |

Kind Registry（闭集，无悬空 `kind`）。`kind` 必须解析到唯一 `{ recordType, schema }`，解析失败不得 `ready`：

| `kind` | `recordType` | 验证 schema |
| --- | --- | --- |
| `world_state` | `WorldState` | `rdc.investigation.v1.WorldState` |
| `evidence` | `EvidenceRecord` | `rdc.investigation.v1.EvidenceRecord` |
| `evidence_pack` | `EvidencePack` | `rdc.investigation.v1.EvidencePack`（`items: EvidenceRecord[]`，每项按 Evidence schema） |
| `claim` | `ClaimRecord` | `rdc.investigation.v1.ClaimRecord` |
| `claim_set` | `ClaimSet` | `rdc.investigation.v1.ClaimSet`（`items: ClaimRecord[]`） |
| `experiment` | `ExperimentRecord` | `rdc.investigation.v1.ExperimentRecord` |
| `challenge` | `ChallengeRecord` | `rdc.investigation.v1.ChallengeRecord` |
| `checkpoint` | `MissionCheckpoint` | `rdc.investigation.v1.MissionCheckpoint` |
| `report` | `InvestigationReport` | `rdc.investigation.v1.InvestigationReport`（只投影已有 Claim / Evidence / Experiment，受 `S-CLAIM-01`） |

`EvidencePack` / `ClaimSet` / `InvestigationReport` 只是 Session Artifact 正文 schema，不是平台级新 Store。未列入上表的 `kind` 非法。

`contentHash` 与 `contentRef` 关系：`contentHash === "sha256:" + hex(sha256(bytes(contentRef)))`。改正文必须改 hash，否则 `stale`。`sourceRefs[].expectedHash` 核的是**源** artifact 当前字节，不与本条 `contentHash` 互换。

清单项进入 `ready` 当且仅当同时成立：

1. `sourceRefs.length >= 1`，每项为 `ArtifactSourceRef`，`artifactId` 可解引用
2. 每个 `expectedHash` 与该源当前内容 sha256 匹配；本条 `contentHash` 与 `contentRef` 正文 sha256 匹配
3. `kind` 经 Registry 得到 `recordType + schema`，且正文按该 schema 通过

版本更新把旧清单标 `superseded`，`supersedes` 指向旧 `artifactId`，保留历史引用。原始 Provider opaque payload 不进 Artifact。引用解析失败、hash 不一致或 `kind` 未登记则不得标 `ready`。

Right Rail **目标** Artifacts 卡只投影 main-owned 本清单及其记录，不混入 Outputs。

### 8.9 系统不变量

| ID | 机器判定 |
| --- | --- |
| `S-CTX-01` | 关键移出项必须有可解引用 `ref + hash`；drilldown 从 Mission Summary → Task Episode → Evidence → Raw Artifact 闭合 |
| `S-STATE-01` | 每条 Evidence 能定位 Capture / Replay / Patch / 实验状态（`worldStateId` 可解） |
| `S-CLAIM-01` | compact / report / view 生成或投影的 Claim / statement 必须带非空 `compactProvenance`；每条源可解且字段与源记录一致；`epistemicRank(projected) <= min(源 rank)`（见 §8.4）。缺 provenance 或升格即违反 |
| `S-CAUSAL-01` | `claimKind == causal_conclusion` 或宣称 counterfactual 的 Claim 必须：`experimentId` 可解引用；该实验 `intervention.type != none`；`status ∈ {recorded, rolled_back}`；且 `rollback.executed === true` **与** `rollback.baselineRestored === true` **与** `rollback.verifyEvidenceIds.length >= 1`（每项可解引用 `EvidenceRecord`）。三者缺一不可 |
| `S-KNOW-01` | 持久 Knowledge 必须有来源、Scope、Evidence、版本 |
| `S-KNOW-02` | 冲突不可静默覆盖；必须保留 `contradicts` 或显式 `supersedes` 原因 |
| `S-RDC-01` | mutate 必有 Experiment + exclusive World State + rollback / restored 验证；否则 World State `polluted`，相关 Evidence `stale` |

`check:investigation-system` ratchet 已建立；schema + `InvestigationArtifactService` + 三个 deferred 工具 + `investigationSystemContract.test.ts` 已落地并硬执行。应覆盖字段完整性（含 `claimId` / `experimentId` / `challengeId` / `artifactId`）、`ready` 三条件、偏序不可升级、精确 `S-CAUSAL-01`、引用可解、非侵入、Skeptic `ChallengeRecord` 形状、Checkpoint 所列 id 可解引用、Analyzer `claimKind` 越层失败、Optimizer 无 rollback 的 mutate 不得关闭。15 Skill / 4 Hook 与 Session rail 五卡已落地。三条 Mission 方法面已接到 Skill / Hook / Capsule。禁止 skip/todo/无断言空壳。产品级 Browser QA 与本机 ColdData 真实验收仍待 Wave 6。

---

## 9. 三层现实与 World Model

Analyzer 与全系统必须区分：

```text
Observed Execution Model
        ↓ 确定性派生
Reconstructed Rendering Model
        ↓ 语义推断
Authoring Model Hypothesis
```

| 层 | 内容 | 允许的 `claimKind` |
| --- | --- | --- |
| Observed | Capture 里真实发生的 draw / dispatch / copy / barrier / present | `observed_fact` |
| Reconstructed | Event / Resource / Pass 的可推导结构 | `derived_structure` |
| Authoring | 对 Engine / Material / RenderGraph 的高层推测 | `semantic_inference` 或 `hypothesis` |

World Model 组成（均为 Artifact 内容，不是平台表）：Event / Queue、Resource Version、Pass、Shader Fingerprint（L0 Exact Binary → L1 Normalized IR → L2 Dataflow/CFG → L3 Semantic Block → L4 Engine/Material Hypothesis）、Provenance、Performance、Backend Capability。无 Debug Tag 的 capture 仍必须能产出主要 Pass Graph，并把 Unknown Frontier 写清楚。

Optimizer 另用五层 Bottleneck（Cost Location → Candidate Limiter → Mechanism → Root Design Cause → Optimization Lever）与证据等级 P0–P5；不得把「最慢 Pass」直接写成 Root Bottleneck。

---

## 10. Context 工程

严格区分 History（发生过的全部）、State/Memory（仍有效）、Context（下次推理实际看到的 token）。目标：在预算 \(B\) 内最大化决策质量。

### 10.1 六层

| 层 | 内容 | 驻留 |
| --- | --- | --- |
| L0 Agent Identity | 职责、Skill、Tool 上限 | 稳定 |
| L1 Mission Context | 目标、模式、成功标准、约束 | 稳定 |
| L2 Task Context | 当前 Task、依赖、blocker、输出要求 | 始终最新 |
| L3 Working State | Accepted Facts、竞争假设、World State、Challenges | 高可信、精简 |
| L4 Retrieved Context | Knowledge Pack、Sibling Result、外部研究 | Just-in-Time |
| L5 Raw Evidence | Shader / IR / JSON / 截图 / Pixel / Timing / Capture | 默认外置、按需读取 |

Planning Orchestrator 宽语义、低 raw；Specialist 窄而深；Skeptic 干净；Report 只看 Accepted Claim 与真实 Artifact。

### 10.2 Delegation Context Capsule

每次委托 Sub-Agent 即时编译，**不是**新平台文件类型。语义必须包含：身份、Mission、Task、原因、已确认事实、竞争 Hypothesis、相关 Challenge、当前 World State、输入 Artifact、相关 Knowledge、已证伪路径、不应重复的实验、输出要求、原始 Evidence 的可恢复引用。

offline subagent 的 Capsule 不得携带 RDX lease；`requiresRdxLease` 必须为 `false`。Debugger 纵切把该 Capsule 写成 `$debugger-coordinator` / `$renderdoc-execution` 的委托纪律，而不是新平台文件类型。

### 10.3 三层 Compaction

| 级 | 动作 | 留下 |
| --- | --- | --- |
| L1 Artifactization | 大体积移出 Context | Artifact id、摘要、provenance、World State、读取方式 |
| L2 Task / Episode | Task 完成后压缩动作流 | Outcome、Accepted Evidence、Rejected Attempts、产物、未决问题、副作用 |
| L3 Mission Compact | Big Loop / 预算耗尽 / 跨会话恢复 | 从 Tasks、Accepted Claims、Evidence、Experiment、Challenges、Manifest **重新生成**，禁止对已失真 Summary 再压缩 |

图片不得只留自然语言摘要：Visual Claim + Summary + Before / After / Diff Artifact + Region。现有 `/compact` 的 `StructuredHandoff` 仍是实现载体；凡 compact / report / view 投影出的 Claim 必须带非空 `compactProvenance`，遵守 §8.4 算法与 `S-CLAIM-01` / `S-CTX-01`。

---

## 11. Small Loop 与 Big Loop

完成状态映射到现有 Task / Mission 语义，**不**新增同名平台枚举：`Complete` / `Partial` / `Inconclusive` / `Blocked` / `Replanned`。

**Small Loop**（不重规划整个 Mission）：缺一条 Evidence、替代 Hypothesis、混淆变量、Scope 扩张、视觉回归未验、采样不足。流程：Execution → Candidate Claims → Skeptic → Challenge Set → 定向 Follow-up → 更新 Iteration Memory → Retry。Iteration Memory 只留 Accepted Facts、Active Claims、Rejected + Why、Blockers、Resolved Challenges、Delta、Evidence refs。

**Big Loop** 触发：Bug Family 判错、结构假设崩、关键能力缺失、Verifier 反复指向同一结构缺口、用户目标变化、Context 将尽且 Plan 已偏离。流程：Execution State → Mission Checkpoint → Handoff 回 Planning Orchestrator → 再检索 → 新 plan 版本 → Handoff 回 Execution。消耗 durable handoff 深度预算。

三条 Mission 纵切都把 Small Loop / Big Loop 写成各自 Coordinator、`$skeptic-review`、`$renderdoc-execution` 的可执行步骤，并由 `mission-plan-handoff-check` 校验 Big Loop 必须携带 `checkpointId`、链深度 ≤ 3。产品级 Browser QA 与本机 ColdData 真实验收仍待 Wave 6。

---

## 12. 三个 Mission 的流程与成功条件

Analyzer 是认知基础，**不是**强制前置模式。Debugger / Optimizer 可按需消费 Analyzer Artifact；发现新 Bug / 性能问题通过 durable Handoff 或用户显式切换，不自动改 Mission。

### 12.1 Debugger

Planning：Triage & Taxonomy → Capture Report → Knowledge Retrieval → plan。Execution：First Bad Event → 竞争 Hypothesis → Evidence → Experiment → Skeptic。

落地方式（Wave 5 前半）：接到已有 Profile / Skill / Hook / durable Handoff / `investigation_*` / `task_*`，不新建 Runtime。First Bad Event / Hypothesis Matrix / Counterfactual Artifact 的记录形状与步骤在 `$debugger-causal-method`（现有 `evidence` / `claim` / `claim_set` / `experiment` kind，无新 Registry 项）。`$debugger-coordinator` 负责规划与 Small / Big Loop；`$skeptic-review` 只写 `ChallengeRecord`；General 用 `task_create` 把 `requiredFollowUp` 变成补证 Task。

| 结局 | 条件 |
| --- | --- |
| Complete | First Bad Event、七元组 Root Cause、替代假设已处理、至少一个合格 Counterfactual、patch 后结果恢复、Scope 明确、Skeptic 无 blocker |
| Partial | 已定位范围且有强 Hypothesis，但 Backend 不足 |
| Inconclusive | 机制无法区分；必须写下一步所需信息 |

未执行 Fix / 验证时不得宣称已修复。知识产物（Debug Case、Bug Pattern、Constraint、Procedure、Device Fact、Negative）**默认留在 Session Artifact**；仅当用户显式点击 / 命令，或 Agent 本轮得到明确用户意图后调用 `knowledge_candidate_create`，才创建 Session Candidate。

### 12.2 Analyzer

阶段：Observed Model → Resource Versioning → Pass Reconstruction → Shader Reconstruction → Traceability → Cross-Capture → Architecture Synthesis → Skeptic。

落地方式（Wave 5）：接到已有 Profile / Skill / Hook / durable Handoff / `investigation_*` / `task_*`，不新建 Runtime。Architecture Model 版本比较 Artifact 与 Observed / Reconstructed / Authoring 分层写在 `$analyzer-architecture-method`（现有 `claim` / `claim_set` kind，无新 Registry 项）。`claimKind` 越层在写入时失败。`$analyzer-coordinator` 负责规划与 Small / Big Loop。仓库只用脱敏 fixture（`src/main/investigation/__fixtures__`）；本机 ColdData 真实验收仍待 Wave 6。

最低完整：主要 Pass 可用、Resource 依赖清晰、高频 Shader/Material 有 Fingerprint、用户目标 Trace 可答、Observed / Derived / Inferred 分离、Unknown Frontier 明确、Skeptic 无结构性 blocker。不得把未观察的引擎语义写成 `observed_fact`。

### 12.3 Optimizer

三层性能概念：Objective Budget、Hardware Constraint、Efficiency Indicator。Capability Ceiling O0–O6。三类动作 C / R / E。Shader Lab 分 Diagnostic Ablation、Semantics-Preserving、Quality Trade-off；Ablation 不得当正式优化。

落地方式（Wave 5）：接到已有 Profile / Skill / Hook / `investigation_*`，不新建 Runtime。Baseline Qualification + Noise Floor → Frame Breakdown → Cost/Limiter/Mechanism → 事务性 Experiment → Replay Benchmark（A-B-A）→ Visual/Numerical Regression 写在 `$optimizer-coordinator` 与 `$optimization-experiment`。Experiment 必须 intervention + rollback；`type == none` 不能当 counterfactual；无 rollback 的 mutate 不得关闭。最终回答结构由 `$report-composition` + `report-contract` hook 卡住。仓库只用脱敏 fixture；本机 ColdData 真实验收仍待 Wave 6。

| 结局 | 条件 |
| --- | --- |
| Complete | Frame Breakdown、Top Cost、Mechanism 达支持等级、至少一个 Counterfactual、timing 高于噪声、视觉回归已查、Scope 与验证上限明确、Skeptic 无 blocker |
| Partial | 已定位 Cost 且有强 Mechanism，但缺可执行 Experiment；不得称「已验证优化」 |
| Inconclusive | 噪声过高、Counter 不足、多种 Limiter 无法区分 |

---

## 13. Knowledge Engine（目标态 / 迁移中）

五个主进程服务已落地：`KnowledgeQueryService` / `KnowledgeIndexService` / `KnowledgeCompileService` / `KnowledgeCandidateService` / `KnowledgeWriteService`。七 lane：Identity/Path、Scope/Metadata、Lexical、Structural、Semantic、Relation/Graph、Temporal/Version。五个 deferred 工具与 `$knowledge-scout` / `$knowledge-candidate` 已落地。Knowledge Center 三列 UI（Spaces / List / Detail）、Candidate Inbox 与 ColdData Import 已落地；browse-only IPC 已删除。

三个逻辑平面：Evidence（不可变事实，不是 Knowledge）→ Knowledge（结构化、带 Scope 与验证）→ Compiled Context（即时 Pack）。Card 是 Projection，不是存储本体。

### 13.1 六 Type

Fact / Constraint / Pattern / Procedure / Case / Model。Scope 是多轴空间，不是 `Project → Engine → Platform` 单链：Project、Engine、Engine Version、API、Platform、GPU Vendor / Arch、Device、Driver、Capture、Pipeline Stage、Pass、Shader / Material Family、Quality、Resolution、Feature Configuration。Generalization 是放大若干轴，不是「升一级」。

关系至少：`supports` / `contradicts` / `specializes` / `generalizes` / `derived_from` / `validated_by` / `invalidated_by` / `applies_to` / `excludes` / `supersedes` / `related_to` / `recommended_for` / `failed_in`。

### 13.2 Lifecycle 与 Promotion

`Draft → Candidate → Verified → Promoted → Deprecated / Superseded`。

- ColdData Historical Debug Case 摄入为 session staging / **Draft**，**绝不默认或自动进入 Candidate**。
- 源 YAML `meta.status: fixed` **不等于** `Verified`（`fixed ≠ verified`）。
- Session Candidate 仅当用户显式点击 / 命令，或 Agent 在本轮得到明确用户意图后显式调用 `knowledge_candidate_create` 才创建。
- 持久写入与 Promote 仅 human review；`FullAccess` 不可绕过。
- 无自动抽取 / 自动 Candidate / 自动 Promote；不注册 LLM 可自治执行的 Promote Tool。
- Case 晋升要求完整 card + Evidence + Scope；Pattern / Constraint 要跨案例或反事实；Procedure 要复用成功与失败边界；Optimization Knowledge 要高于噪声的实验与视觉检查。

### 13.3 Negative Knowledge

保存：When / What Failed / Why / Evidence / Do Not Retry Unless。不保存无压缩完整对话。必须可检索，供 Contradiction Injection 与 Skeptic 使用。

检索顺序：Scope → Structural → Lexical / Semantic → Graph → Verification Ranking → Freshness → Contradiction Injection → Diversity → Compile。Semantic 不可用时其余 lane 继续，UI / Tool 必须如实报 `unavailable` / `stale`。

---

## 14. ColdData Normalization

原料角色：**Historical Debug Case**，服务冷启动与**可选** Candidate 原料，不是已验证 Knowledge，也不是自动 Candidate。

### 14.1 摄入边界

- 只接受**显式** case 文件 + 该文件声明的 assets 闭包。
- 拒绝：`.rdc`、可执行文件、SVG、目录扫描、闭包外路径。
- assets 以 **sha256 内容寻址** 入库；**绝对路径不入库**。
- 源导出文件名必须匿名化为稳定 content id，例如 `symptom-compare-<shortHash>.png`。原文件名只进本机 staging audit，**不进仓库、不进 card 正文**。
- Secret / credential fail-closed，整单不入库。
- HLSL / shader diff **默认外置**为独立 asset，card 只保留锚点与 hash，不把整份 diff 内联进 canonical 正文。

### 14.2 字段映射（对照 BugFull 案例 01 / 02）

| 源字段 | canonical card / 垂直记录 |
| --- | --- |
| `case_id` / `title` | Case 身份；`title` 进 Claim 陈述种子 |
| `meta.status` | 源状态；`fixed` 只作 Fix 章事实，**不**写 Verified |
| `meta.severity` / `owner` | Scope 辅助，可脱敏 |
| `environment.*` | Scope 多轴（platform / api / gpu / engine / renderer_path） |
| `repro.*` | Symptoms 复现与 Exclusions 对照机 |
| `assets.*` | 内容寻址 attachments；缺文件 → 整单 `Draft` |
| `symptoms.*` | Symptoms |
| `evidence[]` | Evidence 章 + 可选 `EvidenceRecord` 草稿 |
| `investigation.action_chain` | Derived / 过程，不得升格为 observed |
| `root_cause.*` | RootCause 七元组（缺项标 unknown，不补写） |
| `fix.*` / `patch_hlsl_diff` | Fix；diff 外置 |
| `verification_plan` | Experiment + Verification（历史计划 ≠ 已复跑 Experiment） |
| `generalization.*` | Derived；推荐 SOP 只是候选 Procedure 引用 |
| `notes.derived_feature` | Derived；SPIR-V id / HLSL 锚点 |

YAML 破损 → `quarantine`，不解析半份。缺附件 → `Draft`，不得创建 Candidate。重复 `case_id` → 出示 diff，**不覆盖**。staging 只存在于当前 session；canonical 仍只写 user / project Knowledge。摄入本身**不**调用 `knowledge_candidate_create`。本机原始 ColdData **不进仓库**；CI 使用脱敏 fixture（占位文件名如 `symptom-compare-<shortHash>.png`、去绝对路径、去 secret、必要时替换 HLSL）。

### 14.3 Canonical Case Card 最低章节

1. **Claim**
2. **Scope + Exclusions**
3. **Symptoms**
4. **Evidence**
5. **RootCause**（七元组）
6. **Experiment + Verification**
7. **Fix**
8. **Negative**
9. **OpenChallenges**
10. **Derived**

缺章不得标 `Verified`。案例 01（Adreno 740 头发发黑 / KajiyaDiffuse）与案例 02（Adreno 650 发白 / Local Light unpack）说明：同家族 Pattern 仍可能在 GPU 轴上互斥，Scope 不得升成「全部 Adreno」。

### 14.4 脱敏 worked example

card 正文与 CI fixture **只**允许内容寻址占位名：

```yaml
assets:
  images:
    - { file: "symptom-compare-a1b2c3d4.png", role: "symptom_compare" }
```

本机 staging audit 可暂存 `{ originalName, sha256, anonymizedName }`；`originalName` 不得写入仓库、canonical card、Evidence 摘要或报告。摄入结果为 `Draft`。转为 Session Candidate 必须另走显式 `knowledge_candidate_create`。

---

## 15. Embedding 与 Knowledge 读路径

Embedding 是独立 capability，见 §3.3。Agent 侧 Knowledge 仍走 deferred `knowledge_*` Tool 与主进程五服务；Planning Orchestrator 只做小规模直接查询，大范围检索委托 Knowledge Scout Sub-Agent（调用者 Profile + `$knowledge-scout`，不是第五个顶层 Profile）。Scout 返回有来源、有预算的 Brief / Pack，父 Context 不接收子 transcript。

---

## 16. 报告

报告是 Investigation State 的 View，不是事实真源。Visual Skill 只能改 Layout / Typography / Diagram / Narrative，不能改数值、Scope、Verification、Conclusion（`S-CLAIM-01`）。

Developer Report 通用：Goal、Input、Environment、Capability、Plan、Task Timeline、Evidence、Claims、Experiments、Challenges、Limitations、Artifact Index。若本轮已显式创建 Session Candidate，再追加 Candidate 引用；未创建则不得假装已有 Candidate。Debugger 追加 Symptom / First Bad Event / Root Cause / Counterfactual / Fix。Analyzer 追加 Architecture / Pass / Resource / Shader / Trace / Unknown。Optimizer 追加 Breakdown / Bottleneck / Mechanism / Experiment / Gain / Risk / Validation Level。

Executive Visual Report 按需，不强制每个小任务。可信度标识必须回指 Claim 的 `epistemic` + `verification`，不得重新评级。

---

## 17. 评估

评价组合 Code-based Grader、Model-based Grader、Human SME、End-state Evaluation，不只看最终文案。

| 面 | 指标（摘要） |
| --- | --- |
| Debugger | Root Cause / First Bad Event 准确率、Evidence P/R、Counterfactual 合法性、误责 Driver 率 |
| Analyzer | Pass / Resource P/R、Shader 聚类、Trace 完整与正确、Unknown 校准 |
| Optimizer | Top Cost、Limiter / Mechanism、实验可复现、预测 vs 实测、视觉回归、噪声处理 |
| Knowledge | Retrieval P/R、Scope 匹配、陈旧检测、冲突保留、Promotion 精度、Negative 复用 |
| Context | Token / 成功任务、关键遗漏、陈旧 / 重复 Context、Rehydration、Small / Big Loop |

Benchmark 四类：Synthetic Ground Truth、Historical Cases（含脱敏 ColdData fixture）、Real Project Capture、Adversarial。禁止只用固定案例过拟合。

---

## 18. 冷启动

资产来源：现有 Bug Case、Invariant、Procedure、已验证 Experiment、Skill、RDX/RenderDoc 能力描述、项目知识、人工 Rendering Structure、通用 Graphics、合成 Benchmark。

步骤：资产盘点 → 标准化（§14）→ Scope 标注 → Evidence Link → Seed Agent Card → Benchmark → 人工校准。合成 Knowledge 必须标 provenance，不得冒充 Observed。人工 Pipeline 版图可同时做 Analyzer Ground Truth、Seed Model、Pattern 源与教材；写入 Knowledge 仍须显式 Candidate 创建 + human Promote，不自动进入任一生命周期。

---

## 19. 风险与防护

| 风险 | 防护 |
| --- | --- |
| LLM 直接命名 Pass | 底层 Graph / 规则先分段，LLM 只做语义解释 |
| 把 Capture 还原成原始 Engine | 三层现实 |
| 最慢 Pass = Root Bottleneck | 五层 Bottleneck + P0–P5 |
| Ablation 当正式优化 | 三类 Shader Lab |
| 实验状态污染 | World State + 事务 + `S-RDC-01` |
| Context 无限累积 | 三层 Compaction + Delta Loop |
| Compact 提升推断等级 | `S-CLAIM-01` |
| 多 Agent 抢同一 Replay | Live 串行；offline `requiresRdxLease=false` |
| Knowledge Poisoning | Candidate / Scope / Promotion / Conflict / Negative |
| Confirmation Bias | Contradiction Injection + 独立 Skeptic |
| Report 漂移 | 只消费 Accepted Claims 与真实 Artifact |
| Benchmark 过拟合 | 四类数据集 + Hidden Set |
| Cost 失控 | 仅在 Context 隔离有价值时委托 |
| 未授权 Capture | 来源合法、项目授权、Knowledge 隔离、敏感资产不外泄 |

---

## 20. 最终验收（目标态）

系统级：一套 Agent Platform、三个 Planning Orchestrator、一个 Execution Orchestrator、一套 Tasks、一套 Context 工程、一套垂直 Evidence / Experiment、一个 Knowledge Engine、统一 Report / Evaluation。不是三套独立产品。

- **Debugger**：从现象形成 Plan；定位 First Bad Event；写出七元组；完成合格 Counterfactual；通过 Skeptic；产出 Report。Case Candidate 仅在用户显式意图下创建。
- **Analyzer**：无 Debug Tag 也能给出主要 Pass Graph；Producer / Consumer 可追溯；高频 Shader 可聚类；Observed / Inferred 分离；可增量 Architecture Model。
- **Optimizer**：Frame Breakdown；解释 Mechanism；至少一个 Replay Experiment；统计高于噪声；检查视觉差异；写明验证上限与 Runtime 风险。
- **Context**：Sub-Agent 只得 Task-relevant Capsule；原始 Artifact 可恢复；Small Loop 不重放完整历史；Big Loop 经 Checkpoint 恢复；patch 后旧 Evidence 不误用。
- **Knowledge**：六 Type、多轴 Scope、人类可审可写、冲突不静默覆盖、Promotion 有规则、Negative 可检索、每条可追溯；ColdData 摄入为 Draft/staging 且 `fixed ≠ verified`；Candidate 仅显式创建。
- **平台非侵入**：无 InvestigationGraph、无第二 TaskStore、无 194 RDX tools / RDX MCP、无自动 Memory / Knowledge / Promote、Embedding 不进 Agent catalog。

通用 Runtime 回归仍必须成立：无 RenderDoc Context 时 `general` 保持完整通用能力；Custom Profile 仍可创建；Permission 与 Profile / Handoff 互不替代。

---

## 21. 明确禁止

- 平台级 InvestigationGraph、第二 TaskStore、第二 Agent Runtime、Mailbox / Blackboard。
- 向 `TaskRecord` / `AgentProfile` / `ConversationMessage` 增加领域字段。
- 194 个 RDX Agent Tool、RDX MCP、把 catalog 展开给模型。
- 自动 Memory / Knowledge / Candidate / Promote；LLM 自治写 Knowledge。
- 交互式旧 Profile 导出选择面。
- 宣称现有 `AgentHandoffDefinition` 已足够。
- Embedding 进入 Agent / Composer / subagent picker。
- 把三卡或四卡 Right Rail 写成现行契约。
- 把未实现的并发组写成已完成模块。Embedding / Knowledge 五服务 / 垂直 schema / durable handoff / 三条 Mission 方法面（Skill/Hook/Capsule）已落地，不得再写成「尚未实现」。不得把产品级 Browser QA 或本机 ColdData 真实验收写成已跑。
- 用空壳测试、skip/todo 或只加类名绕过已建立的 `check:knowledge-system` / `check:investigation-system` ratchet。

---

## 22. 与当前实现的差距（非实现清单）

Wave 1 已落地四个 builtin profile、Coordinator Skills、seed 无损迁移、effective snapshot 与 Run v2（`kind` / `mission` / `profileId`，无 `mode`）。Wave 3 已落地独立 Embedding、Knowledge 五服务 / 七 lane / ColdData staging ingest、五个 deferred 工具与 Knowledge Center 三列 UI。Wave 4 schema 已落地 `rdc.investigation.v1`、`InvestigationArtifactService` 与 `investigation_read` / `investigation_write` / `investigation_list`。15 个垂直方法 Skill、4 个 builtin Hook 模板与 Session rail 五卡已落地。durable handoff 状态机已落地。三条 Mission 方法面已接到 Skill / Hook / Capsule。尚未实现：连续安全工具并发组、产品级 Browser QA、本机 ColdData 真实验收（Wave 6 / 人工步骤）。后续 Wave 按 `DESIGN.md` 裁决落地，落地一项删除一项旧路径。
