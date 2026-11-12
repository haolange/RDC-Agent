# RenderDoc Agent 完整设计书

## Debugger / Analyzer / Optimizer、Unified Knowledge Engine 与 Long-Horizon Context Engineering

**产品边界：** RenderDoc-first，Backend-Agnostic  
**定位：** RenderDoc 领域目标的权威。描述调查系统应当怎样工作；工程合同见 `ARCHITECTURE.md` 与 `docs/contracts/`

---

# 目录

0. 裁决与工程合同  
1. 系统定义与中心思想  
2. 设计原则与外部工程经验校验  
3. 总体架构  
4. Mission、General 与内部 Agent  
5. 计划、执行控制与循环  
6. Context Engineering 与长任务 Memory  
7. Evidence、Claim、Hypothesis 与 Experiment  
8. Unified Knowledge Engine  
9. Render Capture World Model  
10. Debugger 完整设计  
11. Analyzer 完整设计  
12. Optimizer 完整设计  
13. 三大模式的共享、协作与边界  
14. 报告与可视化交付  
15. 评价  
16. 冷启动方案  
17. 落地原则  
18. 风险、失败模式与防护  
19. 最终验收标准  
20. 附录：关键语义对象示例

---

# 0. 裁决与工程合同

本书是 RenderDoc 领域目标的权威：三种 Mission 要回答什么、调查怎样推进、证据与结论怎样分级、知识怎样使用。跨层工程合同（运行内核、权限、失败模型、界面投影、回放生命周期）以 `ARCHITECTURE.md` 和 `docs/contracts/` 为准；两者冲突时由 `ARCHITECTURE.md` 裁决并回改本书。代码是实现的最终事实。

## 0.1 已定裁决

| 主题 | 裁决 |
|---|---|
| 交接 | Mission 规划，用户批准计划并点击执行后才进入 General。需要重规划时，General 就地交付缺口与 Checkpoint，由用户切回原 Mission。没有自动交接；runtime 不按身份、深度或正文开下一轮 |
| 身份 | 四个用户入口：General、Debugger、Analyzer、Optimizer。八个内部 Agent：generator、verifier、knowledge-scout、report-writer、shader-analyst、pass-analyst、resource-analyst、pixel-analyst。其余领域职责由 Skill 承载，按任务需要调用 |
| 规划身份的能力 | Mission 只读：通过受控的只读探测访问 RDC，不运行 shell 或解释器，只可委派 knowledge-scout。Live RDC 的操作与实验只由 General 执行 |
| 模型 | 模型与推理档位归各 Agent 配置。子执行读取目标 Agent 的配置，不继承父对话的选择；配置不可用时明确失败 |
| 完成状态 | completed／partial／blocked／cancelled／budget_paused。多个解释无法区分时是 partial，逐项写明未能区分的解释及所需信息 |
| 请求上限 | 不以固定默认总轮数收口，由目标与核验闭环决定继续和完成。用户显式限制、期限、取消和无进展检测始终有效；续跑、压缩、恢复和重新委派沿用累计消费与原期限 |
| 检索 | 不使用 Embedding 或 Semantic 通道。Markdown 原文是唯一来源，六条检索通道：Identity／Path、Scope／Metadata、Lexical、Structural、Relation／Graph、Temporal／Version |
| 知识沉淀 | 知识产物默认留在本次调查的记录里。只有用户明确要求时才创建 Candidate；写入、晋升和主题变更都须用户确认；不自动写入 Memory 或 Knowledge |
| 调查范围 | 止于 capture、replay、授权材料与可恢复实验。不修改 Unity／Unreal 工程或原始 capture，不把 replay 结果称为生产修复已完成 |
| 多 capture | 同一 owning session 串行切换已批准的 capture，结束时恢复可恢复的入口现场 |

## 0.2 与实现的对应

- 7.1 的调查对象存放在同一套调查记录里（`rdc.investigation.v1`）：WorldState、Evidence、Claim、Experiment、Challenge、MissionCheckpoint 和 Report 各有记录；Observation 内嵌于 Evidence，Hypothesis 是 Claim 的一种类型，Decision 内嵌于 Claim，Artifact 由记录的清单表达。字段以 `src/shared/types/renderdocInvestigation.ts` 和 `investigation_schema` 工具为准，摘要见 `ARCHITECTURE.md` 裁决 E。
- 领域字段不写入通用的 Task、Agent Profile 或会话消息；调查记录只引用 Task ID。
- RenderDoc 能力经外部的 RDC-Tool CLI 提供。模型按需发现操作，不把整份目录展开成工具定义。
- 回放、租约、身份与回执的合同见 `docs/architecture/rdc-runtime.md`。

## 0.3 不做

- 平台级调查图、第二套 Task 存储、第二套 Agent Runtime、第二套模型路由。
- 固定的 workflow 阶段引擎。书中的 Workflow 都是调查的判断顺序，不是必须逐格执行的流水线。
- 自动交接、Embedding、自动知识晋升。

---

# 1. 系统定义与中心思想

## 1.1 产品定义

我把 RenderDoc Agent 定义为：

> **一个以 Graphics Capture 为主要事实源，能够自动重建渲染系统、调查正确性问题、定位性能机制、执行可验证实验，并在用户要求时沉淀领域知识的 Agentic Rendering Investigation System。**

它不是简单的 RenderDoc Copilot，也不是“用自然语言包装 RenderDoc UI”。

RenderDoc 和 RDC-Tool CLI 提供的是：

- Observation；
- Replay；
- Inspection；
- Shader Debug；
- Shader Edit / Replace；
- Resource Export；
- Timing；
- Compiler Statistics；
- Pixel History；
- Pipeline State。

RenderDoc Agent 真正提供的是：

- Investigation Planning；
- Structure Reconstruction；
- Hypothesis Management；
- Evidence Reasoning；
- Counterfactual Experiment；
- Verification；
- Knowledge Distillation（用户要求时）；
- Human-readable Report。

整个产品由三个用户明确选择的模式组成：

| 模式 | 核心问题 | 主要目标 |
|---|---|---|
| Debugger | 为什么结果错了？ | Root Cause 与 Replay 内可验证的修复方向 |
| Analyzer | 这个未知渲染系统怎样工作？ | Rendering World Model 与 Traceability |
| Optimizer | 性能成本在哪里，怎样降低？ | Bottleneck Mechanism 与可验证优化 |

三个模式不是三套独立系统，而是共享同一套调查基础设施的三个目标函数：

\[
Debugger=\arg\min RootCauseUncertainty
\]

\[
Analyzer=\arg\max SystemExplainability
\]

\[
Optimizer=\arg\min Cost
\quad
subject\ to\ Correctness,\ Quality,\ Scope
\]

---

## 1.2 一句话架构

```text
Debugger / Analyzer / Optimizer（只读规划）
                │
                ▼
     plan.md → 用户批准并点击执行
                │
                ▼
        General（执行与编排）
                │
                ▼
        Tasks + 内部 Agent
                │
                ▼
 RDC-Tool CLI / Offline Artifacts / Web
                │
                ▼
Evidence → Verification → Report
                │
                ▼
 Unified Knowledge Engine（用户要求时沉淀）
```

其中：

- Debugger、Analyzer、Optimizer 是三个 Mission，只读规划并评估；
- General 执行获批的计划，是唯一操作 Live RDC 的身份；
- Tasks 负责执行过程的确定性推进；
- 内部 Agent 负责隔离的领域分析、独立核验和 Context；
- RDC-Tool CLI 是 RenderDoc Capability Layer；
- Knowledge Engine 是三种 Mission 共享的长期知识系统；
- Context Engineering 决定每次推理真正看到什么。

---

## 1.3 中心因果闭环

三种模式最终都遵循同一条调查闭环：

```text
Goal
  ↓
Observed Facts
  ↓
Structure / Hypotheses
  ↓
Evidence Acquisition
  ↓
Differential Analysis
  ↓
Experiment / Verification
  ↓
Accepted Claims
  ↓
Report
```

知识沉淀不是每次调查的收尾步骤，只在用户明确要求时发生。

三者只是关注点不同：

```text
Debugger:
Symptom → Invariant Violation → First Bad Event → Root Cause

Analyzer:
Capture → Structure → Semantic Model → Traceability

Optimizer:
Budget Violation → Cost Location → Limiting Mechanism
→ Intervention → Measured Gain
```

---

## 1.4 核心成功标准

完整产品必须同时满足五类标准。

### 正确性

- 不把推测包装成事实；
- 不把相关性包装成因果性；
- 不把 Replay 收益包装成 Runtime 全项目收益；
- 不把 Capture 中的执行结果包装成原始 Engine Authoring Model。

### 可追溯性

所有关键结论都能追溯到：

- Capture；
- Event；
- Resource；
- Shader；
- Pixel；
- Tool 参数；
- Screenshot；
- Timing；
- Experiment；
- External Source。

### 可验证性

凡是涉及 Root Cause 或 Optimization Causality 的结论，必须通过下列手段验证，否则不标为因果已验证：

- Differential；
- Minimal Intervention；
- Shader Replace；
- Replay；
- A/B/A；
- Visual Regression。

### 可泛化性

系统默认只有 Capture，不能依赖：

- Engine Source；
- Shader Source；
- Debug Marker；
- 项目文档；
- 资源命名；
- Material Graph。

专业项目可以提供这些信息，但它们属于增强输入，不属于系统成立的前提。

### 可进化性

每次任务可以产生：

- Case；
- Pattern；
- Constraint；
- Procedure；
- Model；
- Negative Knowledge；

这些产物默认留在本次调查的记录里。只有用户明确要求时才创建 Candidate，经冲突检查和用户确认后进入长期 Knowledge。

---

## 1.5 非目标

本系统不追求：

1. 从单份 Capture 精确还原原始 RenderGraph 源码；
2. 从编译后的 Shader 精确重建原始 Material Graph；
3. 在缺少 Counter 时强行断言 GPU 硬件瓶颈；
4. 让 LLM 直接阅读所有 Event JSON 后自由发挥；
5. 用三个模式复制三套 Capture Parser、Evidence 与 Knowledge；
6. 为调查另造一套平台配置格式或 Agent Runtime；
7. 允许未经验证的 Agent 结论直接污染 Universal Knowledge；
8. 在没有授权的情况下分析第三方程序或 Capture。

---

# 2. 设计原则与外部工程经验校验

## 2.1 Context 是有限的 Attention Budget

Context Engineering 不只是“压缩 Prompt”，而是每次推理前重新决定哪些信息应该进入模型。随着 Agent Loop 变长，System Prompt、Tool、History、Knowledge、Artifacts 与 Tool Results 都会竞争有限的 Attention。Anthropic 将有效 Context 定义为尽可能小、但能最大化任务结果的高信号 Token 集合，并指出长 Context 会出现注意力稀释与 Context Rot。

因此我采用的原则是：

> **Context 不是历史记录，而是针对下一次决策即时编译的 Working Set。**

---

## 2.2 Multi-Agent 的价值是 Context 隔离，不是角色扮演

独立的内部 Agent 可以使用独立 Context Window，适合：

- 并行调查；
- 隔离竞争假设；
- 深入分析单个 Shader、Pass 或 Capture；
- 将大规模中间信息压缩成结构化结果。

但 Multi-Agent 不适合所有问题。对共享同一个可变 RDC Runtime Context、依赖链很强的任务，盲目并行会增加协调成本和状态冲突。Anthropic 的实践也表明，多 Agent 最适合相对独立、可并行的调查，而共享状态紧密的任务并不是天然适用场景。

因此：

- RDC Live Operation 默认串行；
- Offline Artifact Analysis 可以并行；
- 内部 Agent 按调查价值创建，不按组织岗位机械创建。

---

## 2.3 长任务不能依赖 Conversation History 续命

Long-running Agent 需要留下结构化进度、状态和 Artifact，让后续 Context 能快速恢复，而不是依赖一次次对长对话做模糊总结。Anthropic 在长任务 Harness 中也采用了持久化进度文件和增量工作方式，并指出仅依赖自动 Compaction 容易丢失关键状态。

因此：

> **Conversation History 不是 Source of Truth；Tasks、Artifacts、Mission State 与 Knowledge 才是。**

---

## 2.4 Tool 应稳定、相关、按需暴露

大规模 Tool Definition 会占用 Context。Anthropic 的工具实践支持 Progressive Disclosure，让 Agent 按需读取 Tool 定义和过滤 Tool Result；Manus 的经验则提醒，频繁在同一迭代中动态增加或移除 Tool Schema 可能破坏缓存并造成行为混乱。

两者结合后的原则是：

- 每个 Agent Profile 预先限定稳定的领域 Tool 集；
- 大 Tool Namespace 可以按需展开；
- 同一 Agent Iteration 内避免无理由改变 Tool 语义；
- Tool Result 在进入 Context 前尽量过滤、聚合和 Artifactize。

---

## 2.5 Knowledge Card 是消费视图，不是知识真源

Qoder 使用高密度 Knowledge Card、Repo Wiki 与 Conversation Memory，让 Agent 重用架构、规范、决策和历史经验；其 Knowledge Card 允许人工编辑和团队同步。

RenderDoc Agent 会借鉴“高密度 Agent-Native Knowledge”这一思想，但不会把所有知识压成一种 Card：

> **Markdown 原文是真源；简介、章节、全文与图片是不同深度的读取视图。**

渲染调查比 Coding Knowledge 更依赖：

- Scope；
- Capture State；
- GPU / Driver；
- Evidence；
- Counterfactual Verification；
- Contradiction；
- Applicability。

---

## 2.6 Agent Profile 只描述领域职责，不规定平台重构

GitHub Copilot 的 Custom Agent 采用 `.agent.md` 描述专门职责，子 Agent 拥有独立 Context，用于减少主 Agent 的 Context 污染。

本设计以 `.agent.md`、Skill、Tool、Hook、Task 和声明式交接为载体，不规定新的平台配置格式。书中的领域职责由 0.1 的身份和 Skill 承载。

---

## 2.7 RenderDoc-first，但不把领域架构锁死

RenderDoc 是基于 Frame Capture 的 Graphics Debugger，官方项目当前覆盖 Vulkan、D3D11、D3D12、OpenGL 与 OpenGL ES 等 API。

未来可以接入更专门的 Backend。例如 Nsight Graphics 提供更深入的 Shader Profiler、Stall 与 GPU Limiter 数据；Apple 的 Metal 工具也已提供 Capture、Debug、Profile 和命令行能力。

因此：

- 当前实现建立在 RDC-Tool CLI 上；
- 上层领域概念不直接绑定 RenderDoc 内部对象；
- 未来 Backend 扩展只增强 Evidence，不改变三大模式的因果框架。

---

# 3. 总体架构

## 3.1 五个平面

我把系统拆成五个相互正交的 Plane。

```text
┌──────────────────────────────────────────────────┐
│ 1. Control Plane                                 │
│ Plan / Tasks / 交接 / Loop / Review              │
├──────────────────────────────────────────────────┤
│ 2. Execution Plane                               │
│ Mission / General / 内部 Agent / Skills / Tools  │
├──────────────────────────────────────────────────┤
│ 3. Investigation State Plane                     │
│ Evidence / Claims / Experiments / World State    │
├──────────────────────────────────────────────────┤
│ 4. Context Plane                                 │
│ Selection / Retrieval / Compact / Rehydration    │
├──────────────────────────────────────────────────┤
│ 5. Knowledge Plane                               │
│ Facts / Constraints / Patterns / Procedures      │
│ Cases / Models / Version / 晋升                  │
└──────────────────────────────────────────────────┘
```

### Control Plane

回答：

- 当前目标是什么？
- 现在执行哪个 Task？
- 谁负责？
- Task 是否完成？
- Verifier 是否通过？
- 需要局部 Retry 还是回到 Mission 重新规划？

### Execution Plane

回答：

- 用哪个 Agent；
- 加载哪些 Skill；
- 调用哪些 Tool；
- 哪些工作可并行；
- 哪些 RDC 操作必须独占。

### Investigation State Plane

回答：

- 已确认什么；
- 当前有哪些 Hypothesis；
- 哪些被否定；
- Evidence 来自哪里；
- 当前 Shader 是否已被替换；
- 当前结论在哪个 World State 下有效。

### Context Plane

回答：

- 这次推理需要看到什么；
- 什么信息不应进入 Context；
- 如何压缩；
- 如何恢复原始 Artifact；
- 如何把 Verifier 的多轮反馈变成精简 Memory。

### Knowledge Plane

回答：

- 哪些历史知识可复用；
- 适用于哪个 Scope；
- 是否经过验证；
- 是否与其他知识冲突；
- 能否从 Project 推广到更大范围。

---

## 3.2 端到端生命周期

```text
用户选择 Mission
        ↓
Mission 只读探测 / Knowledge 检索
        ↓
plan.md
        ↓
用户批准并点击执行
        ↓
General
        ↓
Tasks 展开并执行
        ↓
Live RDC Tasks（串行）+ Offline Tasks（可并行）
        ↓
Evidence / Claims / Artifacts / Experiments
        ↓
Verifier 独立核验
        ├─ 通过
        ├─ Small Loop（批准范围内补证）
        └─ 战略失效 → General 交付缺口与 Checkpoint → 用户切回 Mission
        ↓
General 就地交付 / Report
```

知识产物留在本次调查的记录里；用户明确要求时才创建 Candidate。

---

## 3.3 系统级不变量

整个产品自身也需要一组 System Invariant。

### S-CTX-01：Context 可恢复

任何因压缩而移出 Context 的关键内容，必须保留可访问的 Artifact 或 Evidence Reference。

### S-STATE-01：Evidence 状态一致

任何 Evidence 必须能定位其 Capture、Replay、Patch 与实验状态。

### S-CLAIM-01：推断等级不升级

认识等级有偏序 `unknown < inferred < derived < observed`。Compact、Summary、Report 和视图不得抬高源结论的等级。

### S-CAUSAL-01：因果结论需要 Intervention

因果结论必须引用一个已回滚并验证基线恢复的 Experiment，否则不得标为 Causally Verified。

### S-KNOW-01：Knowledge 可追溯

所有持久化 Knowledge 必须有来源、Scope、Evidence 与版本。

### S-KNOW-02：知识冲突不可静默覆盖

新旧知识冲突时必须保留冲突关系，或写明 retire 原因。

### S-RDC-01：可变 RDC 状态必须隔离

任何 Shader Replace、Replay Variant 或临时 Patch 都必须在可识别的 Experiment State 中执行并恢复。

---

## 3.4 责任分层

五个平面回答"系统有哪些部分"，这里回答"每件事由哪一层负责"。

| 层 | 负责 | 不承担 |
|---|---|---|
| 通用 Harness 内核 | 执行准备、授权、所有权、取消、消费、隔离委派、合同准入、真实终态与续跑 | 不认识头发、Shader 或 First Bad Event；不按 Mission 写固定调查顺序 |
| 可复用平台服务 | Knowledge 查询、读取与编译，Artifact，模型目录与路由配置，Prompt 组装，Hook 执行基础设施 | 服务存在不等于每个任务必须使用 |
| 领域确定性合同 | RDC 的 Capture、Replay 与设备生命周期、身份和回执；调查记录的资格与报告约束 | 不靠提示词替代校验；不把领域字段加入通用 Task 或 Agent 循环 |
| 垂直方法组合 | Profile、Skill、声明配置、Hook 与 Knowledge 共同组织规划、生成、核验和两种 Loop | 不自行授予工具、修改冻结配置、伪造证据或绕过生命周期 |

各种载体放什么：

| 载体 | 放 | 不放 |
|---|---|---|
| Agent Profile | 稳定身份、职责范围、工具与权限上限、允许委派、默认 Skill | 案例解法、冗长工具手册、运行中进度 |
| Skill | 怎样从症状形成可检验的问题，怎样定位、分析、实验、审查和解释结果 | 模型配置；不可绕过的权限与身份校验。Skill 提供方法，不授予权限 |
| Task 执行要求 | 所需方法、独立性、目标 Agent、输出与版本依赖 | 自由文本扩权；临时改写模型或消费上限 |
| Hook | 在明确的生命周期点执行已受信的检查、提醒或审计 | 自建循环引擎、自动批准重规划、隐式扩权 |
| Knowledge | 可复用的事实、机制、案例、方法、反例及适用域 | 当前任务的执行状态；把历史结论强加给新 Capture |
| Plan、Task、调查记录、Checkpoint | 当前目标、已知范围、首批检查、证据、未决方向和续跑状态 | 第二套模型路由；无来源的完成标记 |

判断某条约束放哪里，看失效后果：关掉 Hook、改掉 Skill 或自定义 Profile 之后仍必须成立的权限、身份、消费和来源约束，由代码在执行边界强制；方法文本不复述它们。通用代码里出现 Mission 身份分支、具体症状或固定工具顺序，说明领域方法被放进了内核。

---

# 4. Mission、General 与内部 Agent

## 4.1 规划与执行分开

### Mission：只读规划与评估

由 Debugger、Analyzer、Optimizer 承担。

- 理解用户意图，判断输入是否足够；
- 通过受控的只读探测查看 Capture；
- 检索 Knowledge，复杂检索可委派 knowledge-scout；
- 形成调查策略，生成 `plan.md`；
- 定义成功条件与验证要求；
- 执行结束后，用户切回时评估成果。

Mission 不运行 shell 或解释器，不做 Pixel History、Shader Debug、替换或实验。

### General：执行与编排

用户批准计划并点击执行后，由 General 承担。它是唯一操作 Live RDC 的身份。

- 根据 `plan.md` 创建 Tasks，维护依赖；
- 调用 Live RDC 工具，委派内部 Agent 处理离线材料；
- 根据新 Evidence 在批准范围内调整 Task；
- 请 verifier 独立核验，驱动 Small Loop；
- 战略失效时交付缺口与 Checkpoint，由用户决定是否切回 Mission。

Mission 负责"怎样调查"，General 负责"把调查推进完成"。

---

## 4.2 什么值得成为独立 Agent

不是每个领域名词都需要独立 Agent。满足以下条件之一才适合：

1. 需要独立 Context 隔离；
2. 需要长时间深入分析单个目标；
3. 能产生稳定、可复用的 Artifact；
4. 能与其他工作并行；
5. 需要独立挑战主 Agent 的结论；
6. 能显著减少 General 的 Context 压力。

固定 Checklist、公式计算、Shader 导出、Event 查询、Knowledge 检索、Image Diff、Timing 统计和确定性的 Graph 构建，更适合做成 Skill 或 Tool。

八个内部 Agent 及其方法：

| 内部 Agent | 职责 | 主要 Skill |
|---|---|---|
| generator | 综合证据、形成竞争解释、设计检查和候选实验 | renderdoc-investigation |
| verifier | 独立核验来源、方法、覆盖、反例与结论资格 | skeptic-review |
| knowledge-scout | 多来源检索、适用条件比较、机制与检查建议 | knowledge-scout |
| report-writer | 根据有效成果组织报告 | report-composition |
| shader-analyst | Shader／IR、数据流、数值计算和语义重建 | shader-ir-analysis |
| pass-analyst | Pass、执行关系与管线结构重建 | pass-graph-analysis |
| resource-analyst | 资源版本、依赖和跨 Capture 对应 | resource-versioning、cross-capture-alignment |
| pixel-analyst | 图像、区域、片元材料与质量差异分析 | pixel-forensics |

内部 Agent 只读取获授权的材料、写自己的成果，不持有 Live RDC。verifier 不修改父级记录，report-writer 不重新评级证据。

---

## 4.3 三种 Mission 共享的能力

| 能力 | 承载 | Debugger | Analyzer | Optimizer |
|---|---|---:|---:|---:|
| Capture 概况 | Skill（capture-facts、capture-preflight） | 核心 | 核心 | 核心 |
| Pass Graph／Pipeline | pass-analyst | 核心 | 核心 | 核心 |
| Shader／IR | shader-analyst | 常用 | 核心 | 核心 |
| Pixel／Value Forensics | pixel-analyst | 核心 | 核心 | 可选 |
| Cross-Capture Alignment | resource-analyst | 常用 | 核心 | 常用 |
| 设备与驱动资料 | knowledge-scout | 常用 | 可选 | 常用 |
| 实验执行 | General | 核心 | 可选 | 核心 |
| 独立核验 | verifier | 核心 | 核心 | 核心 |
| 报告 | report-writer | 核心 | 核心 | 核心 |

能力相同、Tool 与 Artifact 可复用、输入输出语义一致，但调查目标不同。以 Shader／IR 为例：

```text
Debug Lens:
查找错误值、Precision、UB、Compiler Mismatch

Analyze Lens:
识别算法结构、Shader Block、Material Feature

Optimize Lens:
识别 ALU、Texture、Branch、Register 与 Patch Opportunity
```

不复制成三套几乎相同的 Agent。

---

## 4.4 Debugger 的调查内容

### Triage 与 Taxonomy（规划阶段，由 Skill 承载）

- Symptom 分类；
- Trigger 分类；
- Bug Family；
- Candidate Invariant；
- 初始 Hypothesis；
- 需要用户补充的信息。

### Root Cause Investigation（执行阶段）

Debugger 在规划阶段设计，General 在执行阶段按需调用 pass-analyst、pixel-analyst、shader-analyst、knowledge-scout 并执行 Experiment。完整设计见第 10 章。

---

## 4.5 Analyzer 的调查内容

### Analysis Scope Decomposition

识别用户主要目标：

- Pipeline Reconstruction；
- Pixel Trace；
- Shader / Material Analysis；
- Cross-Capture Comparison；
- Architecture Learning；
- Feature Identification。

### Structure Reconstruction

重建：

- Event Segmentation；
- Pass Hierarchy；
- Resource Dependency；
- Queue / Submission；
- Resource Lifetime。

### Semantic Module Inference

解释：

- Engine Feature；
- Render Stage；
- Material Feature；
- Shader Block；
- Resource Role。

### Fingerprint Mining

建立：

- Shader Fingerprint；
- Block Fingerprint；
- Pass Fingerprint；
- Resource Pattern；
- Engine Feature Pattern。

### Architecture Synthesis

将多个局部结果合成为：

- Architecture Model；
- Traceability Model；
- Unknown Frontier；
- Confidence Map。

---

## 4.6 Optimizer 的调查内容

### Performance Scope & Budget

识别：

- Frame Budget；
- Pass Budget；
- Target Platform；
- 可用 Timing；
- 可用 Counter；
- Shader Replace 能力；
- Verification Ceiling。

### Frame Breakdown & Critical Path

重建：

- Pass / Event 时间；
- Queue Timeline；
- Async Overlap；
- Serialization；
- Critical Path；
- Pareto Ranking。

### Bottleneck Mechanism

区分：

- Cost Location；
- Hardware Limiter；
- Cost Mechanism；
- Design Cause；
- Optimization Lever。

### Optimization Experiment Design

设计：

- Diagnostic Ablation；
- Semantics-Preserving Patch；
- Quality Trade-off；
- Measurement Protocol；
- Rollback；
- Visual Validation。

### Replay Benchmark

执行：

- Baseline；
- Patch；
- Repeated Replay；
- Compiler Statistics；
- A/B/A；
- Baseline Restore。

---

## 4.7 Live RDC Task 与 Offline Task

这是系统吞吐量和 Context 质量的关键划分。

### Live RDC Task

需要直接持有或修改 RDC Runtime Context：

- Pixel History；
- Shader Debug；
- Resource Export；
- Pipeline Query；
- Shader Replace；
- Replay；
- Timing；
- Framebuffer Capture。

只由 General 执行，必须串行。多个 Capture 由同一 owning session 串行切换，结束时恢复入口现场。

### Offline Task

只读取不可变 Artifact：

- Shader / IR / ISA；
- Event Graph；
- Pass Graph；
- Resource JSON；
- Screenshot；
- Timing Samples；
- Compiler Statistics；
- Knowledge；
- Web Documentation。

可以：

- Background；
- 并行；
- 使用独立 Context；
- 由内部 Agent 离线分析。

---

# 5. 计划、执行控制与循环

## 5.1 plan.md 的定位

`plan.md` 是：

- 人类可读的调查策略；
- Mission 的主要交付；
- 用户批准的对象，也是 General 执行的战略基线。

用户批准后 `plan.md` 冻结。执行中的事实由 Tasks、Artifacts、Evidence、Experiment 和 Challenge 共同保存。

> `plan.md` 表达调查意图，Tasks 表达执行现实。

---

## 5.2 Plan 应包含的领域信息

不规定文件格式，语义上覆盖：

1. User Goal；
2. Mission 类型；
3. 已知输入与批准范围（哪些 Capture、哪些设备、允许哪类实验）；
4. 初始事实，以及对象锚点的状态：用户确认、两条独立路径互相印证、仅候选，或尚未建立；
5. 初始 Hypothesis 或分析方向；
6. 建议的检查顺序；
7. 可能委托的内部 Agent；
8. 任务依赖；
9. 必须执行的验证；
10. 成功条件；
11. 停止条件；
12. 当前能力上限；
13. 已知风险；
14. 哪些情况说明战略已失效，需要回到 Mission。

---

## 5.3 Task 的领域契约

每个 Task 明确：

- 目标；
- 为什么需要；
- 上游依赖；
- 输入 Artifact；
- 当前 World State；
- 允许使用的能力；
- 是否需要 RDC 独占；
- 是否允许后台；
- 输出要求；
- 成功条件；
- 失败条件；
- 后继建议。

---

## 5.4 Task Graph 的动态调整

`plan.md` 冻结后，General 调整的是 Task，不是计划正文。General 可以：

- 新增补充 Task；
- 拆分过大的 Task；
- 合并重复 Task；
- 标记无效 Task；
- 调整顺序；
- 委托内部 Agent；
- 将某个结论送入独立审查。

以下情况必须留下原因：

- 偏离批准的范围或目标；
- 放弃一个失败的实验；
- 把未验证的结论标记为完成。

每次结构性调整说明：

```text
Changed:    调整了什么
Evidence:   什么新信息触发调整
Impact:     原计划哪些部分因此失效
Deviation:  是否仍在批准范围内
```

调整超出批准范围时，进入 Big Loop（5.6）。

---

## 5.5 Small Loop

Small Loop 是批准范围内的补证：一个结论没有通过审查，针对缺口补做检查，不重新规划。

```text
Task Execution
      ↓
Candidate Claims
      ↓
Verifier Review
      ↓
Challenge Set
      ↓
Targeted Follow-up Tasks
      ↓
更新 Iteration Memory
      ↓
再次审查
```

适用情况：

- 缺少一条 Evidence；
- 存在一个替代 Hypothesis；
- 实验有混淆变量；
- Scope 过度扩张；
- Visual Regression 未验证；
- Timing Sample 不足。

预算或期限耗尽时，按 5.7 以 `budget_paused` 收口，不靠缩小结论来凑完成。

---

## 5.6 Big Loop

Big Loop 用于原调查战略已经失效。它由用户手动完成：General 就地交付缺口与 Mission Checkpoint，用户决定是否切回 Mission 重新规划。系统不自动回到 Mission。

触发条件：

1. 初始 Bug Family 判断错误；
2. Analyzer 发现原有结构假设不成立；
3. Optimizer 发现最耗时 Pass 不在可执行范围；
4. 当前 Backend 缺少关键能力；
5. 多轮审查都指出同一个结构性缺口；
6. 新 Evidence 将问题升级为新的 Mission Scope；
7. 用户目标发生变化。

```text
General 就地交付：缺口 + Mission Checkpoint
      ↓
用户切回 Mission
      ↓
Mission 读取 Checkpoint，重新检索 Knowledge
      ↓
新的 plan.md
      ↓
用户批准并点击执行
```

---

## 5.7 完成状态

一轮结束时，General 声明以下之一：

| 状态 | 含义 |
|---|---|
| `completed` | 达到 Mission 的完成条件 |
| `partial` | 产出有价值，但有必需项未完成。例如 Optimizer 找到 Cost Location，却无法执行 Counterfactual；或竞争 Hypothesis 仍无法区分 |
| `blocked` | 缺少 Capture、Backend Capability、合法权限或必要输入 |
| `cancelled` | 用户取消 |
| `budget_paused` | 预算或期限耗尽，已写 Checkpoint，可在补充预算后继续 |

`partial`、`blocked`、`budget_paused` 必须逐项列出未决工作：缺口是什么、试过什么、被什么阻止、什么条件下可以恢复。

`completed` 的条件：必需覆盖完成；结论达到所声明的验证等级；没有开放的 Challenge；交付写清结论、证据、验证覆盖与未决项；正式报告由 Mission 在用户切回评估时产出，或按需委托 Report Writer；已写 Mission Checkpoint；回放现场已恢复到进入时的位置。

四种"完成"不等价：

1. Tool 调用成功：取得一个结果。
2. 局部 Task 完成：完成所分配的交付物。
3. 审查完成：核查了指定内容，可以留下仍然开放的问题。
4. 目标达到完成条件：即上面的 `completed`。

完成一次实验不等于验证了 Root Cause。Verifier 完成审查并指出缺口，父任务不能把它当成已解决。模型没有调用工具就给出的终答，不算目标完成。

---

## 5.8 推进与收口

### 调查者自身的推进

Small Loop 从 Verifier 的 Challenge 开始。但调查在形成任何 Candidate Claim 之前就可能停下，这时没有东西可供质疑。所以推进不能只靠 Verifier，调查者每得到一个结果都要自己回答三个问题：

1. 当前对象是否已经锚定（见 10.4）？没有，下一步就是确立或否定锚点。
2. 现有解释里，哪一项合法、可执行的检查最能区分它们？
3. 结果回来后，谁被支持、削弱、排除或暂缓？

只要批准范围内还有这样的检查，就继续，不把"下一步尚未检查"当成阻塞。确实不能继续时，按 5.7 逐项交代。说不出阻塞的条目是应继续的工作，不是停止的理由。

### Verifier 的边界

Verifier 不拥有最终目标，不提高验收标准，不改目标或扩大权限。General 把有效的缺口变成可执行的工作；认为某项审查要求不适用时给出依据并保留可审计的处理，不直接忽略。独立上下文和不同模型是两个维度：同一模型的独立执行可以满足隔离；审查是否严谨，看材料覆盖和错误检出能力，不看换没换模型。

### 防止空转

| 情形 | 应有行为 |
|---|---|
| 相同调用、相同结果、相同现场 | 机械的无进展检测生效，不无限重试 |
| 调用不同，但没有新增证据、解释区分或完成项变化 | 说明下一步为何仍有信息价值，否则收口 |
| 同一证据版本反复送审 | 复用已完成的审查；新审查须有新增材料或范围变化 |
| Verifier 与调查者反复争论同一缺口 | 查清分歧需要什么证据；取不到时保留分歧 |
| 所有有效检查都依赖缺失的能力或材料 | 真实的 `blocked` 或 `partial`，列出恢复条件 |
| 目标已满足，还想继续提高质量 | 非必需的改进不阻止完成 |
| 只有记录格式或引用错误 | 修正记录，不重跑有效实验 |
| 有活跃的子执行或设备操作 | 等待或取消并 join，不在后台仍在变更现场时宣告完成 |

是否有语义进展由模型判断；"新写了一条记录"不算进展。

---

# 6. Context Engineering 与长任务 Memory

## 6.1 第一性定义

必须严格区分：

### History

发生过的完整 Action、Observation 与 Conversation。

### State / Memory

当前仍然有效、需要延续的任务信息。

### Context

下一次模型推理实际看到的 Token 集。

关系是：

```text
History
   ↓ Artifactize / Distill / Index
Persistent State
   ↓ Select / Retrieve / Compile
Current Context
```

核心目标：

\[
C_t^*=\arg\max_{|C_t|\le B}
ExpectedDecisionQuality(C_t)
\]

其中 \(B\) 是当前模型的 Attention Budget。

---

## 6.2 Context 的六层模型

### L0：Agent Identity

- 职责；
- 领域能力；
- 行为约束；
- 可用 Skill；
- 可用 Tool。

### L1：Mission Context

- 用户目标；
- 当前模式；
- 成功标准；
- 高层约束。

### L2：Task Context

- 当前 Task；
- 依赖；
- 局部目标；
- Active Blocker；
- 输出要求。

### L3：Working State

- Accepted Facts；
- Active Hypotheses；
- Rejected Paths；
- Experiment State；
- World State；
- Current Challenges。

### L4：Retrieved Context

- Knowledge；
- Sibling Result；
- External Research；
- Project Model。

### L5：Raw Evidence

- Shader；
- IR；
- JSON；
- Screenshot；
- Pixel Trace；
- Timing Samples；
- Capture。

使用原则：

```text
L0 / L1：稳定
L2：始终保持最新
L3：高可信、精简
L4：Just-in-Time
L5：默认外置、按需读取
```

---

## 6.3 Delegation Context Capsule

每次委托内部 Agent 时，都应即时编译一份 Task-specific Context Capsule。

它在语义上包含：

1. 你是谁；
2. 当前 Mission；
3. 当前 Task；
4. 为什么需要这个 Task；
5. 已确认事实；
6. 当前竞争 Hypothesis；
7. 相关 Verifier Challenge；
8. 当前 World State；
9. 输入 Artifact；
10. 相关 Knowledge；
11. 已经证伪的路径；
12. 不应重复的实验；
13. 输出要求；
14. 原始 Evidence 的可恢复引用。

Capsule 的字段见 20.A。

---

## 6.4 不同角色的 Context 范围

| 角色 | Context 特征 |
|---|---|
| Mission（规划） | 宽语义、低 Raw Detail |
| General（执行） | 全局进度、Accepted Facts、Task State |
| Analyst（shader / pass / resource / pixel） | 窄范围、深证据、明确目标 |
| Verifier | 宽但干净，只看 Claims、Evidence、Alternatives |
| Report Writer | 最终事实、关键 Artifact、验证等级 |
| Knowledge Scout | 当前问题的 Scope、已有读数、要回答的具体问题 |

### Mission 不需要

- 数百行 Pipeline JSON；
- 完整 Shader Debug Trace；
- 所有 Tool Log；
- 每个内部 Agent 的完整思考过程。

### Analyst 不需要

- 整段用户历史；
- 无关 Pass；
- 无关知识；
- 其他 Task 的全部 Transcript。

### Verifier 不应被 Generator 叙事污染

优先输入：

- Claim；
- Evidence；
- Experiment；
- Negative Evidence；
- Alternative Hypothesis；
- Scope；
- Unknown。

而不是 Generator 长篇解释。

---

## 6.5 Iteration Memory

Small Loop 的 Memory 必须是精简、增量的。

每轮只保留：

```text
Accepted Facts
Active Claims
Rejected Hypotheses + Why
Verifier Blockers
Resolved Challenges
Delta Since Last Iteration
Evidence References
```

例如：

```text
Rejected H3:
Texture corruption.

Reason:
Raw texture data and pre-sample values are normal.

Evidence:
E-104, E-109.

Do not retry unless:
Resource state or capture version changes.
```

错误的完整 Transcript 可以外置保存，但不应反复重新注入。

这样 Context 增长接近：

\[
O(\Delta)
\]

而不是：

\[
O(CompleteHistory)
\]

---

## 6.6 Challenge Memory

Verifier 的 Challenge 是正式调查资产。

每个重要 Challenge 应记录：

- Target Claim；
- Challenge 类型；
- 严重度；
- 为什么证据不足；
- 需要什么行动；
- 解决状态；
- Resolution Evidence。

Challenge 类型包括：

- Missing Evidence；
- Alternative Hypothesis；
- Uncontrolled Variable；
- Causal Gap；
- Scope Overclaim；
- State Mismatch；
- Measurement Noise；
- Visual Regression；
- Stale Knowledge；
- Unsupported Backend Assumption。

---

## 6.7 Mission Checkpoint

声明 `completed`、`budget_paused`，进入 Big Loop，或 Context Compact 之前，必须写 Mission Checkpoint。

最低内容：

```text
Original Goal
Current Mission
Original Plan
Current Plan Version

Established Facts
Accepted Claims
Rejected Hypotheses
Completed Experiments
Verifier Challenges
Reason for Replan
Unresolved Frontier
Critical Artifact References
Current World State
Remaining Tasks
Knowledge Used
Capability Limitations
```

Mission Checkpoint 回答：

> 调查走到了哪里，还剩什么没做；需要重新规划时，旧战略为什么不够，新的规划必须继承什么。

---

### 读取时机

记录的价值在于被读到并改变下一步。只写不读的记录是成本。下列时刻必须把对应内容读回决策：

| 时刻 | 必须读回 |
|---|---|
| 准备声明 `completed` | 全部 Challenge 的状态、报告引用的 Claim 与 Evidence |
| 准备声明 `partial` 或 `blocked` | Unresolved Frontier、未解决的 Challenge 及其所需行动 |
| Context Compact 之后 | 原 Plan、Mission Checkpoint、Unresolved Frontier、未解决的 Challenge |
| 委派独立审查 | 被审 Claim，以及它依赖的原始 Evidence、World State 和 Experiment 回执 |
| Big Loop 重新规划 | Mission Checkpoint 全文 |
| 现场恢复之后 | 仍然有效的 Evidence 与需要重新核验的状态（见 7.7） |

Verifier 只能读到被授予的内容，所以原始证据随被审主张一并授予，Verifier 经可解引用的 Artifact 读回原文。Compact 保留待做检查的原文，不只是索引。

---

## 6.8 三层 Compaction

### Level 1：Artifactization

大体积内容移出 Context：

- Shader；
- IR；
- Pipeline JSON；
- Screenshots；
- Timing Samples；
- Web Documents；
- Framebuffer；
- Resource Dump。

Context 只保留：

- Artifact ID；
- 摘要；
- Provenance；
- World State；
- 读取方式。

### Level 2：Task / Episode Compact

一个 Task 完成后，将大量 Action 压缩为：

```text
Task Outcome
Accepted Evidence
Rejected Attempts
Produced Artifacts
Unresolved Questions
State Side Effects
Follow-up Recommendations
```

### Level 3：Mission Compact

用于：

- Big Loop；
- 长对话压缩；
- Main Agent Context 即将耗尽；
- 跨 Session 恢复。

Mission Compact 不应重复压缩已经失真的 Summary，而应从：

- Tasks；
- Accepted Claims；
- Evidence；
- Experiment；
- Challenges；
- Artifact Manifest；

重新生成。

---

## 6.9 可恢复压缩

Compact 不是 Delete，而是建立更粗粒度的 Index。

```text
Current Context
      ↓
Mission Summary
      ↓
Task Episode
      ↓
Evidence
      ↓
Raw Artifact
```

任何关键结论都可以逐层 Drill Down。

---

## 6.10 World-State Validity

RenderDoc Agent 比 Coding Agent 更容易出现 State Pollution。

一个 Evidence 至少受到以下状态影响：

- Capture；
- Replay Environment；
- Adapter / Driver；
- Shader Replacement；
- Patch Stack；
- Event；
- Resource Version；
- Subresource；
- Pixel；
- Benchmark Condition。

因此每条 Evidence 都必须能回答：

> 它在哪一个世界状态下成立？

Context Compiler 在选择信息时必须同时判断：

\[
ContextUtility =
Relevance
\times
Validity
\times
Trust
\times
Freshness
\]

旧 Patch 状态下产生的 Timing 不能被当作 Baseline。

---

## 6.11 Multimodal Fidelity

图片不能只保留自然语言摘要。

正确方式：

```text
Visual Claim
+ Visual Summary
+ Before Artifact
+ After Artifact
+ Diff Artifact
+ Region Metadata
```

Report Agent 需要时直接读取原始图片，避免：

```text
Image
→ Visual Agent Summary
→ Orchestrator Summary
→ Report Rewrite
```

多次压缩造成视觉信息损失。

---

## 6.12 Tool Context

每个 Agent 只应看到当前职责合理需要的 Tool。

原则：

- Agent Profile 提供稳定 Tool 集；
- Skill 可以补充相关 Tool 使用方法；
- 大规模 Tool 定义按需展开；
- 无关 Tool 不进入 Context；
- Tool Result 先过滤再进入模型；
- 外部网页内容属于 Data，不属于 Instruction。

---

## 6.13 Context Engineering 的质量指标

系统应持续测量：

- Critical Information Omission Rate；
- Stale Context Rate；
- Context Token / Successful Task；
- Duplicate Context Ratio；
- Rehydration Success Rate；
- Small Loop Repeat Rate；
- Compact Fact Retention；
- Compact Scope Preservation；
- World-State Mismatch Rate；
- Negative Memory Reuse Rate。

---

# 7. Evidence、Claim、Hypothesis 与 Experiment

## 7.1 调查对象

系统需要统一理解八种领域对象。

### Artifact

可持久化的文件或数据：

- Capture；
- Shader；
- Screenshot；
- JSON；
- Report；
- Timing Dataset。

### Observation

Tool 返回或视觉观察到的原始现象。

### Evidence

具有来源、参数和 World State 的可引用 Observation。

### Claim

系统希望表达的结论。

### Hypothesis

尚待验证的机制解释。记录为 `hypothesis` 类型的 Claim。

### Experiment

对变量进行 Intervention 的验证过程。

### Challenge

对 Claim、Evidence 或 Experiment 的反驳要求。

### Decision

为什么接受、拒绝、降级或延期一个 Claim。记录在该 Claim 的裁决字段里，不单独成类。

---

## 7.2 Claim 类型

| 类型 | 示例 |
|---|---|
| Observed Fact | Event 1834 写入 SceneColor |
| Hypothesis | 该亮度来自某一路贡献的越界，尚待区分 |
| Derived Structure | Events 1800–1860 构成一个 Lighting Pass |
| Semantic Inference | 该 Pass 很可能是 Deferred Lighting |
| Causal Conclusion | FP16 Overflow 是异常颜色的直接机制 |
| Optimization Recommendation | 将该 Block 特化可降低当前 Replay 成本 |
| Limitation | 当前缺少 Counter，无法确认 Bandwidth Bound |

---

## 7.3 Confidence 与 Verification 分离

### Confidence

表达系统主观把握：

- Exact；
- Strong；
- Probable；
- Speculative。

### Verification Level

表达结论经过什么验证：

- Observed；
- Reconstructed；
- Differential-Supported；
- Replay-Counterfactual；
- Runtime-Counterfactual；
- Cross-Scene；
- Cross-Device；
- Expert-Reviewed。

不能用一个 `0.92` 同时代替二者。

---

## 7.4 Root Cause 结构

Debugger 的 Root Cause 应拆成：

```text
Trigger
Fault Location
Failure Mechanism
Propagation
Manifestation
Scope
Counterfactual Evidence
```

例如：

```text
Trigger:
Adreno Compiler 将 RelaxedPrecision lowering 为 FP16。

Fault Location:
LightingCalculation 中不合理的 half 声明。

Mechanism:
中间值超过 FP16 finite range，fmul 产生 Inf。

Propagation:
Inf 进入 Diffuse 与后处理链。

Manifestation:
角色皮肤局部过亮。

Counterfactual:
局部 Precision Fence 消除首次 Overflow，并恢复结果。
```

这样不会把合法 Driver 行为误写成 Driver Bug。

---

## 7.5 Experiment 的最低要求

每个 Experiment 必须说明：

- Hypothesis；
- Intervention；
- Baseline；
- Controlled Variables；
- Changed Variables；
- Metrics；
- Visual Validation；
- Timing Protocol；
- Result；
- Limitations；
- Rollback；
- World State。

---

## 7.6 Shader Replace 的事务性

```text
Clean Baseline
      ↓
Begin Experiment
      ↓
Apply Patch
      ↓
Verify Compilation
      ↓
Replay and Capture Evidence
      ↓
Record Result
      ↓
Rollback
      ↓
Verify Baseline Restored
```

任何 Task 不能默认继承前一个实验的 Shader 状态。

---

## 7.7 现场故障后的证据规则

回放可能崩溃、断连或进入不确定状态。一次查询失败、现场被隔离、原战略已无可行取证路径是三件事，前两者不自动证明第三者。

同一 Capture、同一设备、原目标和权限范围内，可以请求受控恢复并继续原计划，不要求用户重新描述症状或重新规划。换设备、扩大权限或改变目标找用户。同一失败条件重复出现时停止无效重开。

| 内容 | 恢复后的处理 |
|---|---|
| 有来源的截图、IR、资源表、完整 Experiment | 条件仍成立时继续作为历史事实使用 |
| 当前 Event、连接、替换、能力和测量条件 | 在新现场重新核验 |
| 未返回可靠结果的步骤 | 保持未知，按需补做 |
| 中断 Experiment 的已保存阶段 | 保留为历史事实，不与新现场拼成一次完整 Experiment |
| 仍要验证的原 Hypothesis | 在新现场建立 Baseline 并完成新的实验链 |

相同的 Capture 内容只说明文件相同，不说明设备、Event、替换、驱动或性能条件相同。现场被隔离期间，已保存的材料足以推进离线分析时继续，否则诚实等待恢复。

恢复分两件事：回放环境和调查进度，责任不同。

| 责任方 | 要做什么 |
|---|---|
| 主进程 | 区分普通失败和现场不可信；必要时隔离当前现场，保留真实错误与回执；确认自有执行停止，重开已登记的 Capture，核验文件、设备和新的回放身份 |
| Agent | 查看当前状态；读回 Task、调查记录和已保存的 Artifact，找回进度与证据；决定最少要补哪一步 |
| 用户 | 需要选择设备、改变调查方向或批准新计划时参与。已确认的目标和已有材料直接沿用 |

续跑沿用原有的 Task 与 Checkpoint，说明哪些可用、哪些重验、哪些重做、下一步是什么。应用重启后尊重已中断的执行、执行代次、既有消费与期限；不重开已完成的 Task，不指望在崩溃瞬间补写记录。

---

# 8. Unified Knowledge Engine

## 8.1 目标

Knowledge Engine 必须同时服务：

- Debugger 的 Bug、Invariant、排查流程；
- Analyzer 的 Pass、Shader Block、Architecture Model；
- Optimizer 的 Cost Pattern、Experiment 与 Optimization；
- Mission 规划前的检索；
- 内部 Agent 的即时检索；
- Verifier 的反例检索；
- 人类工程师的学习、编辑与审核。

它必须：

- 强大；
- 泛化；
- 简洁；
- 透明；
- 可版本化；
- 可追溯；
- 可冲突；
- 可回滚。

---

## 8.2 三个逻辑平面

### Evidence Plane

保存不可变事实与原始依据：

- Capture；
- Event；
- Shader；
- Screenshot；
- Timing；
- Pixel Trace；
- External Documentation；
- Human Annotation。

Evidence 不是 Knowledge。

### Knowledge Plane

保存已经结构化、带 Scope 和验证信息的知识。

### Compiled Context Plane

为当前 Mission 或内部 Agent 即时生成最相关的 Knowledge Pack。

```text
Mission
+ Task
+ Capture Features
+ Project / Platform
+ Hypotheses
        ↓
Knowledge Retrieval & Compilation
        ↓
Task-specific Knowledge Pack
```

---

## 8.3 Knowledge Card 的正确定位

Markdown 原文是唯一来源（0.1）。一张卡是一份带 frontmatter 的 Markdown 文件：frontmatter 记录类型、生命周期、Scope、Relations 与图片引用，正文承载内容。Agent 与人类读同一份原文，不维护两套知识。

### 读取方式

渐进读取，由浅入深：

| 方式 | 内容 |
|---|---|
| 简介 | 这张卡讲什么、何时适用、有什么限制 |
| 章节 | 按需读取某一章，例如 Case 的 Evidence 或 Fix |
| 全文 | 完整原文 |
| 图片 | 卡片附带的图片；须实际读图才算观察到 |

简介由原文派生，原文变化后随之失效。

> Card 是原文的读取视图，不是独立的存储本体。

---

## 8.4 六种一级 Knowledge Type

### 1. Fact

描述已知事实或映射。

例如：

- 某 Resource 的项目语义；
- 某 Shader Hash 对应某 Feature；
- 某 Backend 支持 Pixel History；
- 某 Pass 名称约定。

### 2. Constraint

描述在特定条件下必须成立的约束。

子类：

- Correctness Invariant；
- API Contract；
- Project Contract；
- Performance Budget；
- Quality Constraint；
- Experiment Validity Constraint。

### 3. Pattern

描述可匹配的重复结构。

子类：

- Bug Pattern；
- Pass Pattern；
- Shader Block Pattern；
- Material Pattern；
- Resource Pattern；
- Performance Pattern；
- Driver Quirk Pattern。

### 4. Procedure

描述怎样调查、分析或验证。

子类：

- Debug SOP；
- Analysis Recipe；
- Optimization Playbook；
- Experiment Protocol；
- Capture Procedure；
- Verification Procedure。

### 5. Case

保存完整任务经历。

子类：

- Debug Case；
- Analysis Case；
- Optimization Case。

### 6. Model

表达较完整的系统模型。

子类：

- Architecture Model；
- Rendering Pipeline Model；
- Material Model；
- Performance Model；
- Platform Model；
- Project Rendering Model。

---

## 8.5 Scope 不是简单层级，而是多轴空间

知识 Scope 不能只写：

```text
Project → Engine → Platform → Universal
```

因为 Engine、Platform、API 与 GPU 是正交维度。

Scope 表达以下维度：

```text
Project
Engine
Engine Version
Graphics API
Platform
GPU Vendor
GPU Architecture
Device
Driver
Capture
Pipeline Stage
Pass
Shader Family
Material Family
Quality Level
Resolution
Feature Configuration
```

适用条件之外还可以写明不适用条件；检索结果同时显示两者。不适用条件写在 `exclusions` 中，按 Scope 轴逐项列出。

Generalization 是扩大一个或多个维度的适用范围，而不是简单“升级一层”。

例如：

```text
Project A + Vulkan + Adreno 630
```

经过多项目验证后，可能推广为：

```text
Vulkan + Adreno 6xx
```

但不一定适用于：

```text
D3D12 + NVIDIA
```

---

### 知识的五个维度与主题治理

一份知识同时有五个互不替代的维度：

| 维度 | 回答的问题 | 注意点 |
|---|---|---|
| Knowledge Type | 这是什么形式的知识？ | 六种类型已够用。失败经验用 Case、Constraint 或 Procedure 表达，保留失败原因、证据和重试条件 |
| 领域主题 | 它讲什么？ | 可多主题，允许同义词和确有上下位关系时的浅层级 |
| 任务用途 | 现在能帮我做什么决定？ | 可跨 Mission |
| Scope | 在哪些条件下成立？ | 见上文，多轴交叉 |
| 来源与验证 | 有什么证据、反例和限制？ | 导入案例写着 fixed，不自动取得 Verified |

"发黑"是症状，"精度损失"是可能的机制，"某型号 GPU"是环境条件，三者不串成唯一路径。Debug 要把症状和 Root Cause 分开，允许一个症状通向多个竞争机制。同一份原文可以帮 Debug 提出假设、帮 Analysis 识别计算、帮 Optimize 做质量回归，只保留一份原文和来源，不按 Mission 复制。三种 Mission 的侧重不同，不为了对称而要求相同的字段、步骤或检索次数。

**主题受控演进，调查自由探索。** 区分三种动作：

| 动作 | 影响 | 谁能做 |
|---|---|---|
| 给卡片建议已有主题 | 局部 | Agent 提议，用户确认 |
| 在本次任务里临时组织假设 | 仅本次调查 | Agent |
| 修改全库的正式分类 | 以后所有人的检索 | Agent 提议，用户预览并批量确认 |

正式主题从少量真实资料开始。是否新增主题，看现有词或同义词能否表达、边界能否讲清、是否改善检索或改变检查方法；数量只作参考。未知机制保持未知，未归类的卡片仍须能被检索到。审核知识内容（Candidate）与确认主题分类是两件事。

六种 Knowledge Type 描述知识，检索通道用来找资料，Context 的 L0–L5 决定模型这一步实际看到什么。三者是不同维度，不互相替代。

---

## 8.6 Knowledge Relations

Knowledge Engine 支持以下语义关系：

```text
supports
contradicts
specializes
generalizes
derived_from
validated_by
invalidated_by
applies_to
excludes
supersedes
related_to
recommended_for
failed_in
```

这样 Knowledge 才是可推理网络，而不只是文档目录。

---

## 8.7 Knowledge Lifecycle

```text
draft
  ↓
candidate
  ↓
verified
  ↓
promoted
  ↓
retired
```

### `draft`

Agent 或人类刚创建。

### `candidate`

通过基本完整性检查，但尚未充分验证。

### `verified`

在明确 Scope 内有可靠 Evidence。

### `promoted`

扩大 Scope，成为 Engine、Platform 或更通用知识。

### `retired`

不再推荐，但保留历史。

进入 candidate 及之后的每次状态变化都由用户确认。

默认不物理删除，除非涉及：

- 敏感信息；
- 合规；
- 明确错误且无审计价值；
- 用户要求彻底清除。

---

## 8.8 晋升的证据门槛

各类知识晋升所需的证据不同。任何层级的晋升都由用户确认，门槛只决定什么时候可以提请确认。

### Case

一次完整任务即可成为 Project-level Verified Case，前提是：

- Evidence 完整；
- Verifier 通过；
- 报告可复现；
- Scope 明确。

### Pattern

单次任务只能成为 Candidate。

升级需要：

- 多次独立匹配；
- 或明确数学 / API 结构；
- 或人工专家确认。

### Constraint

最严格。

Universal Constraint 需要：

- API Specification；
- 数学证明；
- 多项目独立证据；
- 或人工批准。

### Procedure

不能因为一次 Action Chain 成功就成为推荐 SOP。

需要统计：

- Success Rate；
- Information Gain；
- Cost；
- Applicability；
- Failure Mode；
- Verification Yield。

### Optimization Knowledge

必须标记：

- Predicted；
- Replay-Validated。

Runtime-Validated、Cross-Scene、Cross-Device 不在范围内。

---

## 8.9 Human 与 Agent 的权限

Agent 只提议：在用户要求沉淀时起草 Candidate，或提出合并、特化、泛化、标记冲突、retire 的建议。人类审核、编辑并决定：

- Add；
- Edit；
- Merge；
- Specialize；
- Generalize；
- Contradict；
- Supersede；
- Retire；
- Delete。

关键原则：

> 人类来源不自动更正确，Agent 来源也不自动更客观。

优先级来自：

- Evidence；
- Provenance；
- Verification；
- Scope；
- Freshness；
- Review。

所有修改都必须保留：

- 修改者；
- 修改原因；
- 前后版本；
- Evidence；
- 影响范围。

---

## 8.10 知识沉淀

知识沉淀由用户在调查之后的请求触发；调查本身不以沉淀收尾（0.1）。

```text
调查结束，用户要求沉淀
        ↓
Agent 起草 Candidate 卡
        ↓
冲突检查
        ↓
用户审核、编辑
        ↓
用户确认后写入知识库
```

Candidate 卡带：

- 来源：调查记录中的 Claim、Evidence、Experiment 引用；
- Scope：成立的多轴条件，以及不适用条件；
- 类型：各 Mission 可沉淀的类型见 10.7、11.11、12.13。

没有自动规则：调查完成、重复命中或统计达标都不会自动写入或晋升。用户不要求时，知识产物留在调查记录里。

---

## 8.11 Negative Knowledge

必须保存有价值的失败信息：

- 哪个 Hypothesis 已被证伪；
- 哪个 Procedure 在什么条件下无效；
- 哪个 Experiment 有混淆变量；
- 哪种 Tool 输出不可靠；
- 哪条路径成本高但 Information Gain 低；
- 哪个 Pattern 容易误判。

不保存完整无压缩对话作为知识。

保存：

```text
When
What Failed
Why
Evidence
Do Not Retry Unless
```

---

## 8.12 Knowledge Retrieval

六条检索通道（0.1）按任务需要组合，顺序不固定：

| 通道 | 找什么 |
|---|---|
| Identity／Path | 已知的卡片 ID 或路径 |
| Scope／Metadata | 按 Scope 轴、类型、生命周期过滤 |
| Lexical | 关键词与术语 |
| Structural | 指纹与结构特征（见下） |
| Relation／Graph | 沿 Relations 展开 |
| Temporal／Version | 新鲜度与版本 |

检索结果再经验证等级排序、Contradiction Injection、多样性选择，编译成 Context。不做向量检索。

### Structural Match

RenderDoc Agent 优先利用：

- Shader Fingerprint；
- Pass Fingerprint；
- Resource Graph；
- Event Pattern；
- Format；
- Binding Layout；
- Symptom；
- Trigger；
- Compiler Statistics。


### Contradiction Injection

Knowledge Pack 不能只返回支持当前 Hypothesis 的内容。

还应主动返回：

- Counterexample；
- Exclusion；
- Failure Case；
- Conflicting Knowledge；
- Scope Mismatch。

这对 Verifier 尤其重要。

---

### Knowledge 怎样改变决策

读到的 Knowledge 要完成三步转换，才算被使用：

- **对应对象**：它描述哪条计算或关系，当前要寻找什么特征，哪些适用条件已匹配、未知或不符。
- **形成预测**：若适用，应观察到什么；哪些结果会排除或削弱它。
- **确定行动**：下一项合法且有信息价值的检查是什么，所需 ID 和材料怎样取得。

报告里能说出历史案例的名称，只证明线索被识别，不证明这三步发生过。

处于 draft 的历史卡不能继承其验证资格，但仍可提供检查方法。条件未知先核对，已证伪才排除。历史的 Event ID、Resource ID 或 Shader ID 不能套到当前 Capture。

检索次数不固定：规划前可从症状和对象检索，执行中发现新计算或异常值后可再次检索；材料足以选择下一项检查，或继续检索的价值低于直接取证时停止。零命中不是失败：换 Knowledge Type 继续找，或依据领域知识和当前观察提出可检验的解释。Tool 失败与零命中分别报告。

规划阶段使用 Knowledge 的目标，是选出能减少不确定性的第一步，而不是比较谁调用了搜索工具。三种 Mission 的产出不同：Debugger 得到可区分的假设，Analyzer 得到可识别的结构，Optimizer 得到可验证的优化实验。

现象模糊时先读已有的截图和 Capture，仍不能判断再向用户澄清可观察的现象（见 10.4），不要求用户诊断原因。放宽设备或项目条件后召回的结果，保留条件差异，不当作完全适用。

需要防止的通用错误：

- 症状相同就继承历史原因。
- 认出同一算法家族，就当作核对了历史材料中的具体计算。
- 干预后画面改善，就认为原机制已证明。
- 以"缺动态证据"为由，禁止取得该证据所必需的检查。
- 一个方向取得结果后，遗失尚未排除的替代解释。
- 只统计读了多少 Knowledge、调了多少 Tool，不看材料有没有改变决策。

---

## 8.13 Knowledge Pack

三种 Mission 使用同一个 Knowledge Engine，但获得不同 Pack。

### Debug Pack

- Similar Bug Cases；
- Candidate Invariants；
- Debug Procedures；
- Platform Quirks；
- Counterfactual Templates；
- Known False Positives。

### Analyze Pack

- Pass Patterns；
- Shader Block Fingerprints；
- Architecture Models；
- Engine Features；
- Resource Mapping；
- Trace Templates。

### Optimize Pack

- Performance Budgets；
- Cost Patterns；
- Counter Semantics；
- Optimization Procedures；
- Experiment Templates；
- Platform Constraints；
- Replay-Validated Gains。

---

# 9. Render Capture World Model

## 9.1 三层现实

Analyzer 以及整个系统都必须区分：

### Observed Execution Model

Capture 中真实发生了什么。

### Reconstructed Rendering Model

根据事件和资源关系恢复的逻辑结构。

### Authoring Model Hypothesis

对原始 Engine、Material 与 RenderGraph 的高层推测。

```text
Observed
   ↓ Deterministic Derivation
Reconstructed
   ↓ Semantic Inference
Authoring Hypothesis
```

---

## 9.2 Event / Queue Model

包含：

- Draw；
- Dispatch；
- Copy；
- Clear；
- Resolve；
- Barrier；
- Present；
- Marker；
- Queue；
- Submission；
- Synchronization。

用于回答：

- GPU 执行顺序；
- Queue 依赖；
- Async Overlap；
- Critical Path；
- Marker 层级。

---

## 9.3 Resource Version Model

同一个 Resource 在一帧内可能多次写入。

因此逻辑身份必须包含：

```text
Resource
+ Subresource
+ Mip
+ Array Slice
+ Byte Range
+ Write Version
```

类似 SSA：

```text
SceneColor@V0
    ↓ Event 310 writes
SceneColor@V1
    ↓ Event 420 writes
SceneColor@V2
```

它是以下能力的基础：

- Producer / Consumer；
- Pass Graph；
- Pixel Provenance；
- Lifetime；
- Cross-Capture Alignment；
- Resource Hotness；
- First Bad Producer。

---

## 9.4 Pass Model

Pass 不一定来自 Debug Marker，而是由多种信号联合重建。

证据优先级：

1. Debug Marker；
2. Render Target / Depth Attachment 变化；
3. Resource Producer / Consumer 边界；
4. Clear / Resolve / Copy；
5. Pipeline State 聚类；
6. Shader Fingerprint；
7. Event 行为模式；
8. Graph Neighborhood；
9. Known Engine Pattern；
10. Semantic Naming。

每个 Pass 应有：

- Event Range；
- Inputs；
- Outputs；
- Pipeline Traits；
- Shader Set；
- Resource Effects；
- Semantic Candidates；
- Confidence；
- Evidence。

---

## 9.5 Shader Artifact 与 Fingerprint

### L0：Exact Binary

识别完全相同的编译产物。

### L1：Normalized IR

消除：

- Register ID；
- Debug Name；
- 地址；
- 无关 Metadata。

保留：

- Opcode；
- Type；
- CFG；
- Resource Access；
- Control Structure。

### L2：Dataflow / CFG

描述：

- Backward Slice；
- Basic Block；
- Loop；
- Branch；
- Texture Sample；
- Output Dependency。

### L3：Semantic Block

识别：

- Normal Decode；
- Shadow Sample；
- BRDF；
- TAA Reprojection；
- Tone Mapping；
- Skin；
- Hair；
- Water；
- Bloom；
- Color Grading。

### L4：Engine / Material Hypothesis

推断：

- UE-like Deferred Lighting；
- Hair Dual Specular；
- Face SDF Shadow；
- GBuffer Decode；
- Mobile Forward Shading。

层级越高，推断性越强。

---

## 9.6 Provenance Model

一个最终 Pixel 的颜色通常不是线性链，而是 DAG。

```text
Final Pixel
 ├─ Current Shader Output
 │   ├─ Direct Lighting
 │   ├─ Reflection
 │   └─ Emissive
 ├─ Blend Destination
 └─ Temporal History
```

每条边标记：

- Exact；
- Derived；
- Inferred；
- Unresolved。

系统必须允许 Trace 停止，并输出 `Unresolved Frontier`。

---

## 9.7 Performance Model

每个 Event、Pass、Shader 或 Resource Scope 可以关联：

```text
Time
Invocation
Instruction Statistics
Register / Shared Memory
Texture Access
Resource Traffic Estimate
Raster Coverage
Overdraw
Queue Overlap
Counter
Experiment Result
Evidence Level
```

Resource Cost 通常不能伪装成可精确相加的毫秒值。

应表达：

- Hotness；
- Estimated Traffic；
- Consumer；
- Related Pass；
- Intervention Result。

---

## 9.8 Backend Capability

每个 Backend 必须暴露真实能力边界，例如：

- Event Enumeration；
- Pipeline State；
- Resource Inspection；
- Pixel History；
- Shader Debug；
- Shader Disassembly；
- Timing；
- Counter；
- Shader Replace；
- Compiler Statistics；
- Queue Timeline。

上层 Workflow 根据 Capability 降级，而不是假设所有平台完全一致。

---

# 10. Debugger 完整设计

## 10.1 定位

Debugger 的目标是：

> 从渲染异常中定位 First Bad Event、Failure Mechanism 与 Root Cause，并通过 Counterfactual 建立可靠因果链。

现有 AIRD 思想继续保留：

- Invariant-driven；
- Differential-first；
- Evidence-driven；
- Counterfactual-required；
- Verifier-reviewed；
- 结论可在用户要求时沉淀为 Knowledge。

---

## 10.2 Planning 阶段

Debugger 是 Mission：只读规划，交付 `plan.md`。下面三件事由 Debugger 自己依靠 Skill 和只读探测完成；知识综合可以委托 Knowledge Scout。

### Triage & Taxonomy

输出：

- Symptom Tags；
- Trigger Tags；
- Bug Family；
- Candidate Invariants；
- 初始 Hypothesis；
- 用户缺失信息。

### Capture Report

输出：

- Capture Metadata；
- API；
- Event 结构；
- Resource 概况；
- Shader 概况；
- Backend Capability；
- 初步风险。

### Knowledge Retrieval

检索：

- Similar Cases；
- Applicable Invariants；
- Known Procedures；
- Project Knowledge；
- Driver / Platform Knowledge；
- Counterexamples。

最终生成 `plan.md`。

### 规划定位与执行定位

"定位"有四个层次，分属规划和执行：

| 层次 | 要解决的问题 | 分工 |
|---|---|---|
| 问题与候选范围 | 哪个对象、哪种异常、哪些 Pass、Resource 或 Event 范围可能相关 | 规划阶段在只读能力内做有限探测；能确认的范围带证据交接 |
| 执行入口 | 已有材料是什么，先核对哪个对象，未知的 ID 怎样取得 | 规划阶段交付可执行的策略，不只列通用的候选原因 |
| 精确对象归属 | 哪个 Draw 真正绘制目标区域，用了哪些 Shader、Resource 和绑定 | 执行阶段继承已确认的范围后验证或细化 |
| 首次异常与机制 | 异常从哪个 Event 或计算开始，怎样传播 | 执行阶段取证并做区分实验，Verifier 核查 |

规划不能只写"之后定位 Draw，再分析 Shader"，也不必为了填出精确 ID 先完成整场调查。只读能力能安全取得的范围应先取得，并带来源、精度和未知项交接；取不到时说明缺什么、哪项首批检查能取得它。规划阶段的探测能力是显式的只读闭集，需要扩大时修改工具与权限合同，不靠提示词扩权。执行阶段继承有效范围；因身份变化、证据不足或出现反证需要重验时说明理由。

---

## 10.3 Execution 阶段

用户批准计划并点击执行后，General 根据 Plan 创建 Tasks。回放上的取证和实验由 General 自己串行完成；离线分析可以委托内部 Agent：

- Pass Analyst：Pass 结构与 Pipeline 状态；
- Pixel Analyst：像素历史、区域数值与外观判断；
- Shader Analyst：Shader 与 IR；
- Resource Analyst：Resource 版本与跨 Capture 对齐；
- Generator：提出可区分的 Hypothesis；
- Knowledge Scout：综合历史知识；
- Verifier：独立审查；
- Report Writer：撰写报告。

---

## 10.4 Debug Workflow

```text
Triage
  ↓
Symptom Anchoring
  ↓
Differential Plan
  ↓
Pass / Resource Localization
  ↓
Pixel / Value Trace
  ↓
First Bad Event
  ↓
Shader / IR / Device Mechanism
  ↓
Competing Hypotheses
  ↓
Minimal Intervention
  ↓
Counterfactual Replay
  ↓
Verifier
  ↓
Report
```

主线可以压成五步，每一步都要在调查记录里留下依据：锚定 → 首次异常 → 区分 → 因果 → 核验。

这是判断顺序，不是固定流水线。定位帮助判断 Knowledge 是否适用，Knowledge 也帮助选择值得定位的对象；低成本的绑定或计算特征核对可以提前做。

### Symptom Anchoring

后面每一步都默认"哪里错了"是已知的。实际拿到的往往只有一份 Capture 和一句症状，没有正确参照。所以调查的第一件事是锚定：证明 Capture 里的某个原生纹理区域、某个 Event 或 Draw 就是用户所说的对象，并说明"错"是相对什么而言。

**"应该是什么"的来源。** 没有参照就无法定义异常。可用的来源按可得性排列：

| 来源 | 说明 |
|---|---|
| 用户指认 | 用户指出区域、给出参考图或描述期望。这是只有用户掌握的事实，不是让用户提供方法；属于用户标注，不等于工具观察 |
| 同帧对照 | 同一 Capture 中未受影响的邻近区域、同类对象或同一像素在更早 Event 的值 |
| Invariant | 无须参照即可判定的规则：数值有限、范围合法、守恒关系、格式与精度约束 |
| 跨 Capture 参照 | 正常设备或正常版本的对应 Capture |
| Knowledge 给出的特征 | 历史机制预测的可观察特征，只作待核对的线索 |

**两条路径互相印证。**

- Image side：从最终输出找到候选区域，映射到原生纹理坐标，读取区域数值，用 Pixel History 得到写入该区域的 Event。
- Object side：对这些 Event，查看 Draw 实际覆盖的范围和内容，结合 Mesh、绑定的 Texture 与 Shader 判断它画的是什么。

Image side 的区域落在 Object side 某个 Draw 的覆盖内，且该 Draw 的内容与用户描述的对象一致，锚点才算确立。

**澄清是目标形成。** 先读可获取的材料，再用少量、渐进的问题确认区域、期望、参考和验收；允许用户回答不知道、跳过非必需问题或自由补充。回答进入计划和 Task 的修订；它是用户描述，不升级为工具观察、已验证的原因或修改授权。

**用户材料。** 用户可以提供参考图、圈出的区域和对比条件，产品保留：

- 原始附件及其内容哈希、用户意图、归一化的 ROI、文档位置、音视频的时间范围；
- 比较组及每份材料的角色与条件（Before／Reference／After／Diff）。同一会话内分多条消息上传的同组材料一起对照展示，不跨会话聚合。

Composer 里可以选择区域并补充描述，对话中可原位打开原图与条件。这些都是用户标注：派生视图不覆盖原图，人工示意图不标成 Capture 证据。存在引用不表示模型已经看见，需要实际读图。用户修订与工具事实分开保留；来源变化后，冻结的附件读取失败而不是静默换成新内容。

**锚点的依据分三档：** 用户确认；两条路径互相印证；仅候选。锚点仍是"仅候选"时，First Bad Event、Hypothesis 区分和 Counterfactual 都没有成立的基础，此时下一步优先选择能确立或否定它的检查。对象或区域确有歧义且现有材料无法判定时，问用户一次，比长时间猜测更好。展示截图的尺寸可能不同于原生纹理，坐标以原生纹理为准。

---

## 10.5 主线各步的判定

### 症状先在回放里复现

锚定之前先确认：用户描述的现象在当前回放的输出里看得到。看不到时，问题可能出在回放与设备的差异上，先解决这个，不在看不到症状的画面上找原因。

### 没有参照时怎样判定"错"

没有参考图或正常 Capture 时，"错"由两类依据成立：违反 Invariant（数值非有限、超出格式或物理合法范围、守恒关系不成立），或与同帧对照不一致（同类对象、邻近未受影响区域、同一像素在更早 Event 的值）。两者都没有时，这是一个需要用户补充期望的问题，不靠亮度或观感猜测。

### First Bad Event

First Bad Event 是写入目标区域的 Event 中，最早一个使被观察量从"符合期望"变为"不符合"的 Event。取得方式：

1. 用 Pixel History 取得写入该区域的 Event 序列，逐个比较写入前后的值；
2. Pixel History 不可用或返回未知值时，沿 Resource 的版本链做二分：在候选 Event 之前和之后读取同一原生区域的值，缩小区间；
3. 异常来自上游 Resource 时，对该 Resource 重复同样的过程。

每一步保留读数和所在 Event。读不到的值保持未知，不当成零。

### 区分 Hypothesis

至少保留两个可以被同一次检查区分的解释，并在检查之前写下各自预测的读数。结果回来后，逐个记录被支持、削弱、排除或暂缓。证据已经排除其余解释时，一个就够。无法设计出能区分它们的检查时，说明原因并保留为未决。

### 最小干预

一次实验只改一个变量，改动范围尽量小（一个 Shader 分支、一个状态、一个绑定），并验证改动确实生效。实验顺序是 baseline → 干预 → 观察 → 撤销 → 确认回到 baseline。干预后异常消失且撤销后重现，因果成立；同时写明这个结论适用的范围。

### 用户跳过澄清

用户跳过或回答不知道时，调查继续，锚点保持"仅候选"，优先做能确立或否定它的检查。锚点最终仍是"仅候选"时，结论最高为 `partial`。

---

## 10.6 Debugger 完成条件

### `completed`

- Symptom Anchor 已确立（用户确认或两条路径互相印证）；
- First Bad Event 已定位；
- Root Cause 已拆分；
- 替代 Hypothesis 已处理；
- 至少一个 Counterfactual：干预后结果恢复，撤销后回到 baseline；
- Scope 明确；
- Verifier 读过当前版本的原始证据，没有开放的 Challenge。

交付的是回放内验证过的原因和修复方向，不是对项目源码的修改。

### `partial`

- 已定位错误范围，有强 Hypothesis，但 Backend 不支持充分的 Counterfactual；
- 或多个机制仍无法区分，Evidence 不足；
- 或锚点仍是"仅候选"。

逐项给出未决工作和恢复条件（见 5.7）。

---

## 10.7 可沉淀的知识类型

仅在用户要求时沉淀，经用户确认后进入知识库：

- Debug Case；
- Bug Pattern；
- Correctness Constraint；
- Debug Procedure；
- Device / Driver Fact；
- Negative Knowledge；
- Project Mapping；
- Symptom Anchor 的做法（某类对象怎样从画面定位到 Draw）。

---

# 11. Analyzer 完整设计

## 11.1 定位

Analyzer 的目标不是修 Bug，而是：

> 从一份或多份 Capture 中恢复一个可解释、可查询、可比较、可持续积累的 Rendering World Model。

它需要回答：

- 这一帧有哪些主要 Pass？
- 每个 Pass 读写什么？
- 某个 Resource 从哪里来？
- 某个 Pixel 的颜色由哪些阶段贡献？
- 某个 Shader 执行什么算法？
- 哪些 Shader 属于相同 Material Block？
- 两份 Capture 为什么不同？
- 这个未知项目大致采用什么 Rendering Architecture？

---

## 11.2 Analyzer 的用户入口

用户可以指定：

- Full Architecture Analysis；
- Pass Graph；
- Pixel Trace；
- Shader / Material Analysis；
- Resource Trace；
- Capture Diff；
- Feature Reconstruction；
- Learning Report。

所有维度都属于 Analyzer 的泛化能力，不应被拆成互不兼容的单一产品流程。

### 职责范围

Analyzer 基于一个或多个 Capture 及相关材料，重建渲染系统的执行、计算与组织结构，解释它如何工作、各部分有什么关系，以及不同 Capture 之间发生了什么变化。几类典型任务可以交叉，不构成封闭清单：

- **同一工程跨时间的 Capture 比较。** 把两份 Capture 中对应的 Pass、Resource 和 Shader 对齐（见 11.8），再看数量、尺寸、格式、画面、计算、绑定和执行路径的变化。两帧只能显示所捕获资源的差异；要证明持续的内存泄漏，还需要时间序列或运行时的内存证据。
- **缺少调试信息时重建结构。** 从 Event、附件、资源流、顶点输入布局、Shader IR 或反汇编重建 Pass、数据流和计算逻辑。关键计算尽量用可读的 HLSL／GLSL 表达，并指出哪些部分符合已知的算法特征。重建的是计算与结构；原作者的命名、工程组织和未保留的源码属于推断，须标明边界。
- **组合分析。** 分别重建两份无标记的 Capture，再解释新增了哪条渲染路径、用了哪些资源、改变了什么计算、画面从哪里开始不同。

Observed、Reconstructed、Authoring Hypothesis 三层说明"结论凭什么成立"；结构重建、计算理解、关系追踪、跨帧比较说明"这次要做什么"。两组维度自由组合，三层不是每个任务都要填满的章节，也不为了完成而编造作者意图。

分析深度由用户的问题决定，理解到足以回答当前问题即可，不要求先还原整个引擎。比较中发现的异常或成本是否值得继续查，由用户决定是否进入 Debugger 或 Optimizer。

---

## 11.3 Planning 阶段

Analyzer 是 Mission，依靠 Skill 与只读探测完成下面三件事，知识综合可以委托 Knowledge Scout：

### Analysis Scope

识别：

- 用户主要查询；
- 分析深度；
- Capture 数量；
- 是否需要 Cross-Capture；
- 是否有 Project Knowledge；
- 是否允许语义推断。

### Capture Report

建立基础 Inventory。

### Knowledge Retrieval

检索：

- Pass Pattern；
- Shader Pattern；
- Engine Model；
- Material Pattern；
- Project Mapping；
- Trace Procedure。

最终生成：

- 分析目标；
- 重建范围；
- 需要的内部 Agent 与 Skill；
- 预期 Model；
- Coverage 标准；
- Unknown 处理规则。

---

## 11.4 Analyzer 执行阶段

以下八项是判断顺序，不是固定流水线；已有的结构可以跳过，发现缺口时回到前面的项。

### Observed Model

提取：

- Event；
- Queue；
- Pipeline；
- Resource；
- Shader；
- Binding；
- Attachment；
- Timing；
- Marker。

### Resource Versioning

建立 Resource Producer / Consumer。

### Pass Reconstruction

聚类 Event，生成 Hierarchical Pass Graph。

### Shader Reconstruction

建立：

- Shader Fingerprint；
- Backward Slice；
- Block Graph；
- Semantic Candidate。

### Traceability

形成 Pixel / Resource / Pass Provenance。

### Cross-Capture

对齐：

- Pass；
- Shader；
- Resource；
- Feature；
- Graph Neighborhood。

### Architecture Synthesis

形成项目级 Rendering Model。

### Verifier 审查

检查：

- 事实与推断是否混淆；
- Pass Boundary 是否证据不足；
- Engine Feature 是否过度命名；
- Unknown 是否被隐藏；
- Cross-Capture 对齐是否错误。

---

## 11.5 Pass Reconstruction

Pass Boundary 不能由 LLM 单独判断。

使用：

\[
PassScore =
w_m Marker
+w_a AttachmentChange
+w_r ResourceBoundary
+w_s ShaderSimilarity
+w_p PipelineSimilarity
+w_g GraphNeighborhood
\]

权重不在设计书中固定。

Pass 输出：

```text
Observed Name
Semantic Name
Event Range
Inputs
Outputs
Resource Versions
Shader Families
Confidence
Evidence
Unknown
```

---

## 11.6 Shader / Material Reconstruction

过程：

```text
Shader Output
    ↓
Backward Slice
    ↓
Relevant Instructions
    ↓
CFG / Dataflow Partition
    ↓
Block Fingerprint
    ↓
Pattern Retrieval
    ↓
Semantic Candidate
```

判断依据：

- 数学结构；
- Resource Format；
- Binding；
- Constant Shape；
- Output Channel；
- Control Flow；
- Cross-Capture Presence；
- Known Pattern；
- Project Knowledge。

必须表述为：

```text
Semantic Block:
Tangent-Space Normal Decode

Confidence:
Strong

Evidence:
Sample → Remap → Z Reconstruct → Normalize
```

而不是：

```text
已恢复原始 DecodeNormal() 函数
```

---

## 11.7 Traceability

### Level 1：Structural

```text
Pixel / Resource
→ Last Writer
→ Event
→ Shader
→ Inputs
→ Producer Events
```

### Level 2：Dataflow

```text
Shader Output
→ Relevant Instruction Slice
→ Samples / Constants / Inputs
```

### Level 3：Numerical

```text
Input Values
→ Intermediate Values
→ Output
→ Blend Result
```

### Level 4：Semantic

```text
BaseColor
+ Direct Lighting
+ Shadow
+ Reflection
+ Exposure
+ Tone Mapping
```

系统必须显示 Trace Frontier：

- Unsupported Shader Debug；
- Wave Operation；
- Dynamic Bindless；
- Atomic；
- Temporal External State；
- Driver Replay Difference；
- Unknown Encoding。

---

## 11.8 Cross-Capture Alignment

不能依赖：

- Event ID；
- Resource ID；
- 完全相同名称；
- 完全相同顺序。

Pass Signature 应综合：

```text
Output Format
Dimensions
Depth Usage
Event Histogram
Shader Fingerprints
Resource Access Pattern
Draw / Dispatch Count
Marker Tokens
Graph Neighborhood
Timing Shape
```

可比较：

- Feature On / Off；
- Quality；
- Platform；
- Driver；
- Scene；
- Material；
- Engine Version；
- Bug / Normal。

---

## 11.9 Incremental Architecture Model

Analyzer 不是每次从零开始。

项目模型应允许：

- 新 Capture 补充；
- 旧结论修正；
- 冲突并存；
- Version；
- Confidence 更新；
- Unknown 减少；
- Feature Mapping 增长。

例如：

```text
Capture 1:
识别 GBuffer + Lighting

Capture 2:
补充 Shadow + TAA

Capture 3:
识别 Hair Material Family

Capture 4:
发现 Mobile Pipeline 与 PC 不同
```

最终形成可查询的 Project Rendering Model。

---

## 11.10 Analyzer 完成条件

### `completed`

- 主要 Pass 可用；
- Resource Dependency 清晰；
- 高频 Shader / Material Block 有 Fingerprint；
- 用户目标 Trace 可回答；
- Observed / Derived / Inferred 分离；
- Unknown Frontier 明确；
- Verifier 读过当前版本的原始证据，没有结构性 Blocker 与开放的 Challenge。

### `partial`

- 用户目标已部分回答，但某些 Pass、Shader 或 Trace 因 Backend 能力或材料缺失无法重建；
- 或语义标签仍只是候选。

逐项给出未决工作和恢复条件（见 5.7）。

### Coverage

Coverage 说明已重建的范围：

- Top GPU Work Pass Coverage；
- Top Resource Coverage；
- Top Shader Coverage；
- Trace Completeness；
- Semantic Label Coverage；
- Unknown Ratio。

---

## 11.11 Analyzer 的交付物

### Architecture Model

- Pipeline Overview；
- Pass Graph；
- Resource Graph；
- Shader Family；
- Material Feature；
- Queue；
- Unknown。

### Trace Report

- 查询目标；
- Provenance DAG；
- Evidence；
- Numerical Trace；
- Semantic Explanation。

### Cross-Capture Report

- Matched；
- Added；
- Removed；
- Changed；
- Unresolved。

### 可沉淀的知识

仅在用户要求时沉淀，经用户确认后进入知识库：

- Model；
- Pattern；
- Fact；
- Analysis Procedure；
- Case。

---

## 11.12 无 Debug Tag Capture 的分析策略

没有 Marker 的 Capture 靠结构与数据流重建：Event 与 Attachment 的变化划分 Pass，Resource 的生产与消费确定依赖，Shader 的数据流与 Fingerprint 给出语义候选。

用户已有的 Rendering Structure 是增强输入，不是前提。结果中事实、推断与 Unknown 分开，每个语义标签带 Confidence 与 Evidence，不命名证据不足的 Feature。过度推断和隐藏 Unknown 是主要的错误方向。

---

# 12. Optimizer 完整设计

## 12.1 定位

Optimizer 的目标不是生成泛泛建议，而是：

> 建立可操作的 Performance Model，定位主要 Cost Mechanism，设计可执行 Intervention，并用实验数据验证优化动作与收益之间的因果关系。

---

## 12.2 三层性能概念

### Objective Budget

真正需要满足的目标：

- Frame Time；
- Pass Time；
- Peak Memory；
- Power；
- Quality；
- Stability。

### Hardware Constraint

- Compute Throughput；
- Texture Throughput；
- Memory Bandwidth；
- Raster Throughput；
- Register Capacity；
- Cache；
- Queue / Synchronization。

### Efficiency Indicator

- Occupancy；
- Cache Hit；
- Overdraw；
- Divergence；
- ALU Utilization；
- Texture Utilization；
- Early-Z；
- Wave Stall。

低 Occupancy 不自动等于问题。

高 Bandwidth Utilization 也不自动等于错误。

正确逻辑：

```text
Budget Violation
      ↓
Cost Location
      ↓
Candidate Limiting Mechanism
      ↓
Supporting Indicators
      ↓
Intervention
      ↓
Counterfactual
```

---

## 12.3 Capability Ceiling

Optimizer 首先判断当前输入能达到什么验证层级。

### O0：Structure Only

只有 Event 与 Resource。

### O1：Timing

有 Event / Pass Timing。

### O2：Compiler Evidence

有 Instruction、Register、Compiler Statistics。

### O3：Replay Intervention

支持 Shader Edit / Replace 与 Timing。

### O4：Hardware Counter

支持更强的 Hardware Limiter 归因。

### O5：Runtime A/B（不在范围内）

可改游戏配置、重新运行与 Capture。

### O6：Cross-Scene / Device（不在范围内）

可验证项目级收益与回归。

RenderDoc 工作流重点覆盖 O1–O3。

---

## 12.4 Frame Breakdown

至少包含四种视图。

### Hierarchical Time

```text
Frame
 ├─ Shadow
 ├─ GBuffer
 ├─ Lighting
 ├─ Post Process
 └─ UI
```

### Queue Timeline

- Graphics；
- Compute；
- Copy；
- Overlap；
- Idle；
- Sync。

### Cost Facet

- Shader；
- Texture；
- Raster；
- Memory；
- Sync；
- Compiler；
- Resource。

### Pareto

- Top Pass；
- Top Event；
- Top Shader；
- Top Invocation；
- Top Resource；
- Top Overdraw Region。

Async Compute 下：

\[
FrameTime \neq \sum EventTime
\]

必须区分：

- Inclusive Time；
- Exclusive Time；
- Critical Path Contribution；
- Overlap。

---

## 12.5 Bottleneck 归因的五层结构

### 1. Cost Location

哪里慢。

### 2. Candidate Limiter

受什么资源限制。

### 3. Mechanism

为什么产生这些成本。

### 4. Root Design Cause

为什么系统会形成这个机制。

### 5. Optimization Lever

可以改变什么。

例如：

```text
Location:
Deferred Lighting Pass，4.2 ms。

Limiter:
Texture / Bandwidth Candidate。

Mechanism:
全分辨率下每像素读取多组 GBuffer 与 Shadow 数据。

Design Cause:
多个互斥 Lighting Feature 共存在同一 Generic Shader。

Lever:
Feature Specialization、Sample Reuse、Format Reduction。
```

---

## 12.6 Bottleneck Evidence Level

### P0：Observed Dominance

某 Pass 最耗时。

### P1：Mechanism-Supported

Compiler、Invocation 或 Resource 数据支持某机制。

### P2：Differential-Supported

不同 Capture / Variant 的变化与机制一致。

### P3：Replay-Counterfactual

Shader Replace 改变机制后 Timing 改善。

### P4：Runtime-Counterfactual（不在范围内）

真实运行时 A/B。

### P5：Regression-Validated（不在范围内）

跨场景、Quality、平台无回归。

完成条件要求至少 P3（见 12.12）。

---

## 12.7 三类 Optimization Action

### C-Class：Capture Executable

可以直接实验：

- Shader Block Ablation；
- Precision；
- Sample Count；
- Branch；
- Math Approximation；
- Sample Reuse；
- Dead Block；
- Loop Strategy。

### R-Class：Runtime Required

需要真实游戏：

- Resolution；
- Feature Toggle；
- LOD；
- Quality；
- Dynamic Resolution；
- Material Variant。

### E-Class：Engine Required

需要代码或内容修改：

- Pass Merge；
- Async Compute；
- Resource Aliasing；
- Format；
- Pipeline Reorder；
- Culling；
- Mesh；
- RenderGraph Lifetime。

报告必须分开：

```text
Measured Replay Gain
Projected Runtime Gain
Unvalidated Engine Opportunity
```

R 类与 E 类动作不在调查内执行，只作为建议写入报告，并标明未验证。

---

## 12.8 Shader Experiment Lab

### Diagnostic Ablation

目的：确定成本来自哪个 Block。

允许明显改变画面：

- 移除 Texture Sample；
- 常量替代 BRDF；
- 关闭 Loop；
- Null Shader。

只能用于 Mechanism Isolation，不能作为最终方案。

### Semantics-Preserving Patch

目的：尽量保持结果等价。

例如：

- Algebraic Simplification；
- Common Subexpression Reuse；
- Sample Reuse；
- Safe Precision Change；
- Feature Specialization；
- Dead Code Removal。

### Quality Trade-off

目的：用质量换性能。

例如：

- 减少 Sample；
- 近似 BRDF；
- 降低迭代；
- Lower Precision；
- Simplified Filter。

必须报告：

- Gain；
- Image Difference；
- Scope；
- Risk；
- Rollback。

---

## 12.9 Measurement Protocol

单次 Timing 不构成 Evidence。

协议是 A-B-A：

```text
Warm-up
   ↓
A  Baseline Samples
   ↓
B  Variant Samples
   ↓
A  Restored（回到 Baseline 后复测）
```

噪声使单轮不足以判定时，重复该序列（A-B-A-B-A-B）。

记录：

- Sample Count；
- Median；
- P10 / P90；
- MAD / Variance；
- Noise Floor；
- Compiler Statistics；
- Framebuffer；
- World State；
- Thermal / Replay Condition。

只有收益显著高于 Noise Floor 才能判定有效。

---

## 12.10 Visual Regression

需要同时使用：

### 数值方法

- Absolute Difference；
- Relative Difference；
- PSNR；
- SSIM；
- Masked Region Statistics；
- HDR-aware Error。

### 语义方法

- 是否丢失高光；
- 是否出现 Shadow Leak；
- 是否改变 Silhouette；
- 是否破坏 Hair；
- 是否出现 Temporal Artifact；
- 差异是否符合预期 Quality Trade-off。

数值无差异不一定等于视觉无差异，反之亦然。

---

## 12.11 收益估算

局部 Shader 收益不能直接当作整帧收益。

简单上限：

\[
FrameGain_{upper}
\approx
AffectedScopeShare
\times
LocalGain
\]

如果存在 Async Overlap，还需要按 Critical Path 修正。

报告至少给：

- Local Replay Gain；
- Frame-level Estimated Range；
- Critical Path Assumption；
- Runtime 未验证说明；
- Confidence。

---

## 12.12 Optimizer 完成条件

### `completed`

- Frame Breakdown；
- Top Cost Location；
- Mechanism 达到支持等级；
- 至少一个 P3（Replay-Counterfactual）实验，已回滚并验证基线恢复；
- Timing 高于 Noise；
- Visual Regression 已检查；
- Scope 与 Verification Ceiling 明确；
- Verifier 读过当前版本的原始证据，没有开放的 Challenge。

### `partial`

- 已定位 Cost Location，有强 Mechanism，但缺少可执行的 Experiment，此时不能称为“已验证优化”；
- 或 Replay 噪声过高、Counter 不足、多种 Limiter 无法区分。

逐项给出未决工作和恢复条件（见 5.7）。

---

## 12.13 Optimizer 的交付物

- Performance Model；
- Frame Breakdown；
- Bottleneck Report；
- Experiment Record；
- Before / After；
- 未验证事项：Runtime 与跨场景收益不在范围内，作为限制写明。

### 可沉淀的知识

仅在用户要求时沉淀，经用户确认后进入知识库：

- Optimization Case；
- Optimization Pattern；
- Budget Constraint；
- Negative Knowledge。

---

# 13. 三大模式的共享、协作与边界

## 13.1 Analyzer 是认知基础，但不是强制前置模式

从架构上：

```text
Analyzer builds understanding
Debugger investigates correctness
Optimizer investigates efficiency
```

但用户入口保持明确：

- 选择 Debug 就执行 Debug Mission；
- 选择 Analyze 就执行 Analyze Mission；
- 选择 Optimize 就执行 Optimize Mission。

系统可以调用共享的结构分析能力，但不应静默改变用户选择的 Mission。

---

## 13.2 模式之间的协作

模式之间不自动切换。一个 Mission 发现另一类问题时可以建议，是否切换由用户决定。

### Debugger 使用 Analyzer

- Pass Graph；
- Resource Trace；
- Shader Block；
- Cross-Capture。

### Optimizer 使用 Analyzer

- Frame Structure；
- Resource Dependency；
- Shader Semantics；
- Architecture Model。

### Analyzer 发现 Bug

应：

- 标记 Suspicious Finding；
- 保存 Evidence；
- 建议用户启动 Debugger；

而不是擅自把 Analyzer 任务改成 Debug Mission。

### Analyzer 发现性能问题

同理，输出 Optimization Opportunity，建议用户切换到 Optimizer，不自动切换。

---

## 13.3 共享但不混淆的产物

| 共享基础 | Debugger | Analyzer | Optimizer |
|---|---|---|---|
| Evidence | Root Cause | Model | Cost Mechanism |
| Resource Graph | First Bad Producer | Dependency | Traffic / Lifetime |
| Shader Model | Error Mechanism | Semantic Block | Cost Block |
| Experiment | Fix Validation | Feature Probe | Gain Validation |
| Knowledge | Bug / Invariant | Pattern / Model | Optimization / Budget |

---

# 14. 报告与可视化交付

## 14.1 报告不是事实真源

报告是 Investigation State 的 View，记录与报告的对应见 0.2。

最终 Claim、Evidence、Experiment 和 Artifact 先确定，再生成报告。

General 就地交付写清结论、证据、验证覆盖与未决项；正式报告由 Mission 在用户切回评估时产出，或按需委托 Report Writer。报告不是 General 完成的前置条件。

Visual Design Skill 只能改变：

- Layout；
- Typography；
- Diagram；
- Narrative；

不能改变：

- 数值；
- Scope；
- Verification；
- Conclusion。

---

## 14.2 Developer Report

### 通用部分

- Goal；
- Input；
- Environment；
- Capability；
- Plan；
- Task Timeline；
- Evidence；
- Claims；
- Experiments；
- Verifier Challenges；
- Limitations；
- Knowledge Candidate（仅在用户要求时）；
- Artifact Index。

### Debugger

- Symptom；
- First Bad Event；
- Root Cause；
- Counterfactual；
- 回放内验证过的修复方向。

### Analyzer

- Architecture；
- Pass Graph；
- Resource Graph；
- Shader / Material；
- Trace；
- Unknown Frontier。

### Optimizer

- Frame Breakdown；
- Bottleneck；
- Mechanism；
- Experiment；
- Gain；
- Risk；
- Validation Level。

---

## 14.3 Executive Visual Report

按需生成，不是每个小任务强制生成。

内容：

- 一页核心结论；
- 问题或分析目标；
- 关键图；
- Before / After；
- 性能收益；
- 影响；
- 风险；
- 建议动作；
- 验证等级。

使用真实 Intermediate Artifact：

- Framebuffer；
- Diff；
- Pass Graph；
- Timing Chart；
- Resource Diagram；
- Shader Block Diagram。

---

## 14.4 报告可信度标识

每个关键结论带一个短标签，正文不再重复限定语：一条结论一个标签，不写成段的免责说明。

```text
Observed
Derived
Inferred
Replay-Validated
Unresolved
```

标签与 Verification Level（7.3）的对应：Observed = Observed；Derived = Reconstructed；Replay-Validated = Differential-Supported 或 Replay-Counterfactual（因果结论须为后者）；Inferred 与 Unresolved 没有对应的验证等级，由 Claim 类型与 Confidence 表达。

Optimizer 必须明确：

```text
Replay Gain ≠ Project Runtime Gain
```

Analyzer 必须明确：

```text
Reconstructed Model ≠ Original Authoring Model
```

---

# 15. 评价

## 15.1 自主性与泛化的判定

短症状是正常入口。用户不需要提供 Event ID、Shader ID、Tool 顺序或 Root Cause 提示。

**输入类型。** 同一问题下，输入提供了什么，决定结果该怎样解释：

| 输入 | 新增内容 | 怎样解释结果差异 |
|---|---|---|
| 症状级请求 | 对象、异常表现、调查目标 | 正常的自主调查入口 |
| 事实补充 | 目标区域、正常参考、已确认的 Event、独立实验结果 | 信息条件变了，单列，不算方法提示的收益 |
| 方法提示 | 一般调查步骤，不含新事实 | 表现明显改善，说明方法的自主组织存在缺口 |
| 原因或答案提示 | Root Cause、修复代码或预期参数 | 只检验执行与验证能力，不证明自主诊断 |

**人工介入。** 告知设备事实、在计划门批准、产品生成的交接属于正常输入。外部补充调查方法或反复发送"继续"属于人工介入，这样完成的调查不算自主完成。

**结果分类。** 自主完成、事实补充后完成、经方法提示完成、合理未完成、过早停止、错误结论、无效长跑。分别统计，不合并成一个通过率。

**区分"Tool 不可用"与"没有选择有效检查"。** 对调查中未执行的检查，事后经同一产品路径亲自执行一次：成功说明 Agent 遗漏，失败说明 Tool 或环境有问题。

**知识迁移不是泛化。** 有对应历史案例卡的 Capture 上取得的结果属于知识迁移。未参与规则调整的保留材料，其真值不进入运行 Prompt 或通用 Knowledge。合成材料可以验证机制和边界，不冒充陌生真实工程的成功率；仅重命名对象不构成新的问题家族。

**验收层次。** 合同与确定性实现、方法与上下文、真实模型行为、真实回放设备、泛化，五层分别取证，互不替代。没有对应证据的层级保持未验证；构建通过、Schema 合法、报告就绪或 Mock 成功都不能替代真实运行。

---

## 15.2 观察指标

以下是评价时要看的内容，不是通过门槛。

- Debugger：Root Cause 与 First Bad Event 是否正确，Evidence 是否精确完整，Counterfactual 是否有效，替代 Hypothesis 是否被处理，是否误怪驱动；
- Analyzer：Pass 分段与层级、Resource Edge、语义标签是否准确，Trace 是否完整正确，Unknown 是否校准，跨 Capture 匹配是否正确；
- Optimizer：Top Cost 定位，Limiter 与 Mechanism 判断，实验可复现性，预测与实测收益的差距，视觉回归检出，Noise 处理；
- Knowledge：检索是否命中并匹配 Scope，冲突是否保留，知识是否改变了决策；
- Context：关键信息是否丢失，是否出现过期或重复的 Context，压缩后保留了什么，内部 Agent 的成果是否丢失。

---

## 15.3 评价材料

评价材料是用户提供的真实 Capture 及其已知的结论。合成材料与对抗材料可选：合成材料检验机制和边界，对抗材料检验模糊现象、多 Root Cause、Capture 损坏、不支持的 Shader Debug、Async Compute、过期或错误的知识、Web Prompt Injection、噪声 Timing 与 Patch 状态污染。不建立数据集。

---

## 15.4 终态检查

评价组合确定性检查、模型评分和人工审核。Shader Replace 会改变回放状态，评价重点放在最终状态：

- Baseline 是否恢复；
- Evidence 是否来自正确状态；
- 报告是否与最终 Claim 一致；
- Artifact 是否可复现；
- Task 是否真正达到成功条件。

---

## 15.5 通过的定义

一次调查通过，当且仅当主线五步——锚定 → 首次异常 → 区分 → 因果 → 核验——每一步都在调查记录里留有依据，并且用户确认结论正确。

---

# 16. 冷启动方案

## 16.1 冷启动资产

初始 Knowledge 的来源由用户导入：

1. 现有 Bug Case；
2. Existing Invariant；
3. Debug Procedure；
4. 已验证 Experiment；
5. Agent Skill；
6. RenderDoc Tool Description；
7. 项目知识；
8. 人工 Rendering Structure；
9. 通用 Graphics Knowledge。

---

## 16.2 真实项目 Rendering Structure 的价值

用户人工分析出的无 Debug Tag Pipeline 版图，经用户确认后同时承担：

### Ground Truth

评价 Analyzer（见第 15 章）。

### Seed Architecture Model

初始化项目 Knowledge。

### Pattern Source

提炼：

- Pass Pattern；
- Resource Pattern；
- Shader Family；
- Semantic Mapping。

### Teaching Material

帮助人类工程师理解：

- Agent 如何推断；
- 哪些地方是事实；
- 哪些地方是 Semantic Inference。

---

## 16.3 合成 Knowledge 的规则

缺少真实资产时，经用户确认可以生成冷启动示例，但必须标记：

```text
Synthetic
Unverified
Educational
Not Project Ground Truth
```

合成内容不能直接进入 Verified Knowledge。

---

## 16.4 历史案例导入归一化

历史 Debug Case 服务冷启动，是可选的 Candidate 原料，不是已验证的 Knowledge，也不会自动成为 Candidate。导入由用户发起并确认。

### 导入步骤

1. 资产盘点：区分事实、人类判断、已验证与仅为经验；
2. 标准化：转换为 Fact、Constraint、Pattern、Procedure、Case、Model 之一；
3. Scope 标注：Project、API、Platform、GPU、Engine、Version；
4. Evidence Link：能链接到 Capture 的必须链接，不能链接的标记为 Human-authored；
5. 用户校准：重点检查 Analyzer 过度推断、Optimizer 假瓶颈、Scope 过宽、压缩丢失关键信息。

### 摄入边界


- 只接受显式指定的 case 文件及其声明的附件闭包；拒绝 `.rdc`、可执行文件、SVG、目录扫描和闭包外路径。
- 附件按内容哈希寻址入库，绝对路径不入库；源文件名匿名化为稳定的内容 ID，原文件名不进仓库和卡片正文。
- 含 Secret 或凭据时整单不入库。
- Shader diff 外置为独立附件，卡片只保留锚点与哈希。
- 文件破损时隔离，不解析半份。缺附件时保持 Draft，不能创建 Candidate、标记 Verified 或 Promoted。

### 字段映射

| 源字段 | 卡片或调查记录 |
|---|---|
| 身份与标题 | Case 身份；标题作为 Claim 陈述的起点 |
| 状态 | 源状态。`fixed` 只是 Fix 章的事实，不等于 Verified |
| 环境 | Scope 多轴（平台、API、GPU、引擎、渲染路径） |
| 复现条件 | Symptoms 与 Exclusions |
| 症状 | Symptoms |
| 证据 | Evidence 章 |
| 调查过程 | Derived，不升格为 Observed |
| 根因 | Root Cause 七段；缺项标 unknown，不补写 |
| 修复与 diff | Fix；diff 外置 |
| 验证计划 | Experiment 与 Verification；历史计划不等于已复跑的 Experiment |
| 泛化建议 | Derived；推荐流程只是候选 Procedure |

### Case Card 最低章节

Claim、Scope 与 Exclusions、Symptoms、Evidence、Root Cause、Experiment 与 Verification、Fix、Negative、Open Challenges、Derived。缺章不得标 Verified。同一家族的 Pattern 可能在 GPU 轴上互斥，Scope 不得从个别型号扩大为整个厂商。

---

# 17. 落地原则

三种 Mission 同时完整，不等于三条线各写一套：它们共享同一套调查基础。

- 以现有仓库为真源，先理解再修改；本书的对象是领域语义，不为对应本书而新建同名的类或文件，目标是语义一致。
- 不新建与现有平台并行的第二套平台；复用现有的 Tasks、Artifacts 与权限。
- 代码、Skill 与 Knowledge 里不写针对某个案例的逻辑。
- 新机制有测试，Context、Knowledge 与 Experiment 可审计；不为“架构一致”引入没有实际价值的中间层。
- 改动在真实 Capture 上验证，构建通过或 Schema 合法不替代真实运行。
- 除非真源证明无法渐进演化，不做大规模重写。

接入新的 Backend（PIX、Nsight Graphics、Xcode Metal Debugger、AGI、Snapdragon Profiler、Mali 工具）按实际价值进行：先扩展 Evidence Capability，不重写 Mission 逻辑。

执行计划见 `docs/workflows/vertical-investigation-convergence.md`。

---

# 18. 风险、失败模式与防护

## 18.1 LLM 直接命名 Pass

**风险：** 把相似结构误判成特定 Engine Feature。  
**防护：** 底层 Graph 和规则先分段，LLM 只做语义解释。

---

## 18.2 从 Capture 还原原始 Engine

**风险：** 将编译后执行结构伪装成 Authoring Model。  
**防护：** Observed / Reconstructed / Hypothesized 三层。

---

## 18.3 最慢 Pass 等于 Root Bottleneck

**风险：** 只定位 Cost，不解释 Mechanism。  
**防护：** 五层 Bottleneck 结构和 Evidence Level。

---

## 18.4 Shader Ablation 被当作正式优化

**风险：** Compiler 删除大量上游逻辑，收益不可落地。  
**防护：** Diagnostic、Semantic-preserving、Quality Trade-off 分级；动作按 C / R / E 分类（12.7），只有 C 类在回放内实验，R、E 类只作建议并标明未验证。

---

## 18.5 Experiment 状态污染

**风险：** Patch A 的 Evidence 被当作 Baseline。  
**防护：** World State、Patch Transaction、Rollback Verification。

---

## 18.6 Context 无限累积

**风险：** 重复、错误和旧 Tool Result 占满 Attention。  
**防护：** Artifactization、Episode Memory、Delta Loop、Mission Checkpoint。

---

## 18.7 Compact 提升推断等级

**风险：** “可能”被压缩成“确定”。  
**防护：** Claim Type 与 Verification Level 必须保留，记录对应见 0.2。

---

## 18.8 Multi-Agent 共享 RDC 冲突

**风险：** 多 Agent 修改同一个 Replay State。  
**防护：** Live RDC 只由 General 串行操作，内部 Agent 只读离线 Artifact。

---

## 18.9 Knowledge Poisoning

**风险：** 一次误判成为长期 SOP。  
**防护：** 用户批准、Provenance、Scope、retire。

---

## 18.10 Confirmation Bias

**风险：** Knowledge Retrieval 全部支持当前 Hypothesis。  
**防护：** Contradiction Injection；Verifier 在独立 Context 中读原始证据。

---

## 18.11 Report 漂移

**风险：** 视觉设计过程改变结论或数值。  
**防护：** Report 只消费 Accepted Claims 与真实 Artifact。

---

## 18.12 对已知案例过拟合

**风险：** Agent 记住已知案例的特征，在新问题上套用。  
**防护：** 修复与方法必须与案例无关；由用户用未参与调整的案例检验。

---

## 18.13 Cost 失控

**风险：** 所有 Task 都启动昂贵的内部 Agent。  
**防护：**

- 仅在 Context 隔离有价值时委托；
- Knowledge Retrieval 优先 Tool；
- Offline 并行只用于高价值工作；
- Task 根预算约束整棵委派树，耗尽时 `budget_paused` 并写 Checkpoint（5.7）。

---

## 18.14 锚定失败

**风险：** 对象没有锚定就开始找原因，后续每一步都建立在错误的对象上。  
**防护：** 先锚定（10.4）；锚点仅为候选时，结论最高为 `partial`。

---

## 18.15 回放故障被当成调查结论

**风险：** 回放崩溃或断连被写成“无法取证”。  
**防护：** 崩溃、断连不等于无法取证；受控恢复后继续原计划（7.7）。

---

## 18.16 未授权 Capture

RenderDoc 官方明确将其定位为调试自行开发程序的工具。

系统要求：

- Capture 来源合法；
- 项目授权；
- Knowledge 隔离；
- Shader / Asset 不泄露；
- External Agent 不获取无关敏感信息。

---

# 19. 最终验收标准

## 19.1 系统级

- 一个 Agent Platform；
- 四个用户入口：General，以及 Debugger、Analyzer、Optimizer 三个 Mission；
- 八个内部 Agent，其余领域职责由 Skill 承载；
- 一套 Tasks API；
- 一套 Context Engineering；
- 一套 Evidence / Experiment；
- 一个 Knowledge Engine；
- 统一的报告与评价：报告由 Mission 在用户切回评估时产出，或按需委托 Report Writer（5.7、14.1）；评价见第 15 章。

---

## 19.2 Debugger

满足 10.6 的 `completed` 条件：

- 可从现象形成 Plan；
- Symptom Anchor 已确立（用户确认或两条路径互相印证）；
- First Bad Event 已定位；
- Root Cause 已拆分，替代 Hypothesis 已处理；
- 至少一个 Counterfactual：干预后结果恢复，撤销后回到 baseline；
- Scope 明确；
- Verifier 读过当前版本的原始证据，没有开放的 Challenge。

不满足时按 `partial` 收口，逐项给出未决工作。Debug Case 仅在用户要求时沉淀。

---

## 19.3 Analyzer

- 无 Debug Tag Capture 可生成主要 Pass Graph；
- Resource Producer / Consumer 可追溯；
- 高频 Shader Block 可聚类；
- Pixel / Resource Trace 可用；
- Observed / Inferred 分离；
- 可增量形成 Architecture Model；
- Verifier 无结构性 Blocker。

---

## 19.4 Optimizer

- 生成 Frame Breakdown；
- 定位 Top Cost；
- 解释 Mechanism；
- 完成至少一个 P3 Replay Experiment，已回滚；
- 统计结果高于 Noise；
- 检查视觉差异；
- 明确验证上限，Runtime 与跨场景收益作为限制写明。

---

## 19.5 Context

- 每个内部 Agent 只获得 Task-relevant Context；
- 原始 Artifact 可恢复；
- Small Loop 不重复完整历史；
- Big Loop 能通过 Mission Checkpoint 恢复；
- Patch 后旧 Evidence 不会错误复用；
- 回放现场恢复有回执。

---

## 19.6 Knowledge

- 六类 Knowledge 可统一管理；
- Scope 多轴表达；
- 人类可编辑，Agent 只提议；
- 冲突不静默覆盖；
- 晋升由用户确认，不自动晋升；
- Negative Knowledge 可检索；
- 每条知识可追溯到来源；
- 评价方法与通过的定义见第 15 章。

---

# 20. 附录：关键语义对象示例

字段名与 `src/shared/types` 及 `src/main/knowledge` 中的实现一致，取值为通用示意。

---

## A. Delegation Context Capsule

对应 `DelegationCapsule`（`src/shared/types/delegationCapsule.ts`）。

```yaml
goal: 找出目标 Pass 的主要成本机制
task: 分析该 Pass 的主 Shader，区分采样成本与寄存器压力
scope: 当前 Capture 的光照 Pass；不修改任何 Shader
acceptedFacts:
  - statement: 该 Pass 占回放关键路径的 31%
    sourceRefs: [session://investigation/evidence-timing-01.json]
    qualification: 回放内 Timing，中位数，噪声已测
hypotheses:
  - 重复纹理采样是主要成本
  - 寄存器压力掩盖了纹理延迟
challengeRefs: []
negativePaths:
  - path: 绘制调用数量过多
    reason: 该 Pass 只有一次全屏绘制
    applicableWhen: 全屏 Pass
    recheckWhen: Pass 拆分方式改变
inputArtifactRefs:
  - session://investigation/evidence-shader-ir-01.json
  - session://investigation/evidence-compiler-stats-01.json
outputRequirements: 给出块级成本假设、支撑证据、候选实验与未决机制
stopConditions:
  - 两个假设都有可比较的读数
  - 缺少所需材料时说明缺口并停止
requiredSkillIds: [shader-ir-analysis]
budget:
  maxToolCalls: 40
  maxWallTimeMs: 600000
  maxSubagents: 0
profile: shader-analyst
```

---

## B. Mission Checkpoint

对应 `MissionCheckpoint`（`src/shared/types/renderdocInvestigation.ts`）。

```yaml
checkpointId: ckpt-03
goal: 定位目标区域出现非有限值的原因
planVersion: plan-v3
established:
  - claim-02：异常首先出现在光照 Pass
  - claim-03：输入纹理读数正常
rejected:
  - claim-04：纹理数据损坏
  - claim-05：混合状态错误
completedExperiments:
  - exp-01
  - exp-02
openChallenges:
  - chal-02：尚未排除编译器代码生成变化是唯一原因
reasonForReplan: 原计划假设纹理解码失败，证据已将其排除
currentWorldStateId: ws-restored-02
criticalArtifactRefs:
  - session://investigation/evidence-pixel-history-01.json
  - session://investigation/evidence-shader-diff-01.json
unresolvedFrontier: 驱动相关的降级范围尚未确定
```

---

## C. Knowledge Card

对应 `KnowledgeCardRecord`（`src/shared/types/knowledge.ts`），存为带 frontmatter 的 Markdown，字段由 `knowledgeCardSchema` 校验。

```markdown
---
cardId: "user:patterns/fp16-hdr-intermediate-overflow.md"
type: "pattern"
lifecycle: "verified"
title: "FP16 HDR 中间量溢出"
scope: {"pipelineStage":"lighting","shaderFamily":"deferred-lighting","exclusions":{"shaderFamily":["编译器保留 FP32 的变体"]}}
relations: [{"kind":"contradicts","targetCardId":"user:cases/bounded-lighting-case.md"}]
---

# FP16 HDR 中间量溢出

HDR 光照路径上的 relaxed precision，在数值范围超过 FP16 时可能产生非有限的中间值。

## 适用条件

- 中间量为 HDR；
- 实际发生 FP16 降级；
- 数值范围超过 FP16 的有限范围。

## 不适用条件

- 编译器保留 FP32；
- 数值范围保持有界。
```

---

## D. Optimization Experiment

对应 `ExperimentRecord`（`src/shared/types/renderdocInvestigation.ts`）。

```yaml
experimentId: exp-07
hypothesisClaimId: claim-11
intervention:
  type: shader_replace
  payload: {description: 将重复的阴影采样替换为一次复用采样}
baselineWorldStateId: ws-baseline-01
variantWorldStateId: ws-variant-01
restoredWorldStateId: ws-restored-01
controlledVariables: [capture, event, resolution, pipeline state]
changedVariables: [shader]
metrics:
  - {name: event_gpu_time, kind: timing, unit: ms}
  - {name: instruction_count, kind: compiler_statistics}
protocol:
  kind: A-B-A
  warmup: 5
  noiseThreshold: 0.02
visualValidation:
  before: session://investigation/evidence-fb-before-01.json
  after: session://investigation/evidence-fb-after-01.json
  diff: session://investigation/evidence-fb-diff-01.json
  region: 目标区域
result:
  summary: 局部回放收益约 11%，整帧估计 1.8%–2.4%；目标 Capture 内未检出视觉差异
  accepted: true
rollback:
  executed: true
  baselineRestored: true
  verifyEvidenceIds: [ev-31]
actionClass: C
status: rolled_back
```

---

# 结论

RenderDoc Agent 的最终形态：

```text
One Agent Runtime
One Tasks-driven Control Flow
One Investigation State
One Context Engineering System
One Unified Knowledge Engine

四个用户入口：
General（执行）
Debugger / Analyzer / Optimizer（Mission：只读规划）
```

它的核心竞争力不只是“Agent 会使用 RenderDoc”，而是：

1. 能从 Capture 中重建一个可解释的 Rendering World；
2. 能把正确性问题转化为可验证的因果调查；
3. 能把性能问题转化为可测量的 Intervention；
4. 能让每个内部 Agent 只获得正确、足够、可恢复的 Context；
5. 能让多轮 Verifier Loop 保留有效 Memory，而不是堆积 History；
6. 能在用户要求时把一次调查沉淀为有 Scope、有 Evidence、有版本的候选知识，经用户确认后进入知识库；
7. 能让人类理解、审核、修改和推翻 Agent 的任何结论；
8. 能在缺少 Engine Source、Debug Tag 和项目知识时仍然工作；
9. 能随真实项目与长期任务积累：知识由用户确认后增长，不自动演化；
10. 能在未来扩展到 PIX、Nsight、Xcode、AGI 等 Backend，而不推翻领域架构。

最终系统不是几个 Agent 的简单拼接，而是一套完整的：

> **Rendering Investigation Runtime + Capture World Model + Evidence & Experiment System + Context Compiler + Knowledge Engine。**