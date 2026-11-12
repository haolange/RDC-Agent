# RenderDoc Agent 完整设计书

## Debugger / Analyzer / Optimizer、Unified Knowledge Engine 与 Long-Horizon Context Engineering

**设计状态：** Architecture Design v1.0  
**产品边界：** RenderDoc-first，Backend-Agnostic  
**主要读者：** Graphics Engineer、Technical Artist、Engine Engineer、Agent System Engineer、负责落地实现的 Codex/Agent  
**设计目标：** 人类可以用它理解完整系统，Agent 可以据此阅读现有仓库真源并实现完整体系

---

# 目录

0. 产品裁决与实现对应  
1. 系统定义与中心思想  
2. 设计原则与外部工程经验校验  
3. 总体架构  
4. 三个 Main Orchestrator 与 Sub-Agent 体系  
5. Tasks API、Handoff 与执行控制  
6. Context Engineering 与长任务 Memory  
7. Evidence、Claim、Hypothesis 与 Experiment  
8. Unified Knowledge Engine  
9. Render Capture World Model  
10. Debugger 完整设计  
11. Analyzer 完整设计  
12. Optimizer 完整设计  
13. 三大模式的共享、协作与边界  
14. 报告与可视化交付  
15. Evaluation、Benchmark 与质量体系  
16. 冷启动方案  
17. 实施路线与 Codex 落地原则  
18. 风险、失败模式与防护  
19. 最终验收标准  
20. 附录：关键语义对象示例

---

# 0. 产品裁决与实现对应

本书最初写于产品实现之前，描述理想架构。产品落地后形成了一组裁决；本章列出它们，正文中与之不同的表述以本章为准。本书是 RenderDoc 领域目标的权威；跨层工程合同以 `ARCHITECTURE.md` 和 `docs/contracts/` 为准，冲突时由 `ARCHITECTURE.md` 裁决并回改本书。

## 0.1 裁决

| 主题 | 正文的表述 | 裁决 |
|---|---|---|
| 交接 | Planning Orchestrator 经 Agent Handoff 交给执行方；Big Loop 交回规划方 | 用户批准计划并点击执行后才进入 General。需要重规划时，General 就地交付缺口与 Checkpoint，由用户切回原 Mission。不存在自动交接，runtime 不按身份、深度或正文开下一轮 |
| 身份 | 以领域职责命名的 Sub-Agent（Triage、Capture Report、pass_graph_pipeline、pixel_value_forensics、shader_ir、Skeptic 等） | 四个用户入口：General、Debugger、Analyzer、Optimizer。八个内部 Agent：generator、verifier、knowledge-scout、report-writer、shader-analyst、pass-analyst、resource-analyst、pixel-analyst。Skeptic 即 verifier。其余职责由 Skill 承载，按任务需要调用 |
| 规划身份的能力 | 可调用前置 Sub-Agent 做调查 | Mission 只读：通过受控的只读探测访问 RDC，不运行 shell 或解释器。Live RDC 的操作与实验只由 General 执行 |
| 模型 | 未规定 | 模型与推理档位归各 Agent 配置。子执行读取目标 Agent 的配置，不继承父对话的选择；配置不可用时明确失败 |
| 完成状态 | Complete／Partial／Inconclusive／Blocked／Replanned | completed／partial／blocked／cancelled／budget_paused。Inconclusive 表达为 partial，并逐项写明未能区分的解释及所需信息 |
| 请求上限 | 未规定 | 不以固定默认总轮数收口，由目标与核验闭环决定继续和完成。用户显式限制、期限、取消和无进展检测始终有效；续跑、压缩、恢复和重新委派沿用累计消费与原期限 |
| 检索 | Lexical／Semantic Retrieval，Embedding 作为补充 | 不使用 Embedding 或 Semantic 通道。Markdown 原文是唯一来源，六条检索通道：Identity／Path、Scope／Metadata、Lexical、Structural、Relation／Graph、Temporal／Version |
| 知识沉淀 | 任务结束后产生 Knowledge Candidate 并进入 Promotion | 知识产物默认留在本次调查的记录里。只有用户明确要求时才创建 Candidate；不自动写入 Memory 或 Knowledge，不由模型自治晋升。主题分类由 Agent 提议、用户批量确认 |
| 调查范围 | 可验证修复 | 止于 capture、replay、授权材料与可恢复实验。不修改 Unity／Unreal 工程或原始 capture，不把 replay 结果称为生产修复已完成 |
| 多 capture | 未规定 | 同一 owning session 串行切换已批准的 capture，结束时恢复可恢复的入口现场 |

## 0.2 实现对应

- 八种调查对象存放在同一套调查记录里（`rdc.investigation.v1`）。Hypothesis 是 Claim 的一种类型，Decision 内嵌于 Claim，不另建平台类型。字段定义以 `src/shared/types/renderdocInvestigation.ts` 和 `investigation_schema` 工具为准。
- 领域字段不写入通用的 Task、Agent Profile 或会话消息；调查记录只引用 Task ID。
- Coordinator 不是新的 Runtime，是 Profile 指令、Skill、Hook、通用 Task、调查记录和声明式交接的组合。
- RenderDoc 能力经外部 CLI 提供。模型按需发现操作，不把整份目录展开成工具定义；手册知识不授予权限。
- 回放、租约、身份与回执的合同见 `docs/architecture/rdc-runtime.md`；运行内核、权限、失败模型与界面投影见 `docs/contracts/`。

## 0.3 不做

- 平台级调查图、第二套 Task 存储、第二套 Agent Runtime、第二套模型路由。
- 固定的 workflow 阶段引擎。第 10 章等处的 Workflow 是调查的判断顺序，不是必须逐格执行的流水线。
- 恢复自动交接、Embedding、自动知识晋升。
- 用提示词代替身份、权限、消费和来源的校验；这些由代码强制。

---

# 1. 系统定义与中心思想

## 1.1 产品定义

我把 RenderDoc Agent 定义为：

> **一个以 Graphics Capture 为主要事实源，能够自动重建渲染系统、调查正确性问题、定位性能机制、执行可验证实验，并持续沉淀领域知识的 Agentic Rendering Investigation System。**

它不是简单的 RenderDoc Copilot，也不是“用自然语言包装 RenderDoc UI”。

RenderDoc 和 `rdc-cli` 提供的是：

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
- Knowledge Evolution；
- Human-readable Report。

整个产品由三个用户明确选择的模式组成：

| 模式 | 核心问题 | 主要目标 |
|---|---|---|
| Debugger | 为什么结果错了？ | Root Cause 与可验证修复 |
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
Three Planning Orchestrators
Debugger / Analyzer / Optimizer
                │
                ▼
        plan.md + Handoff
                │
                ▼
   General Execution Orchestrator
                │
                ▼
      Tasks API + Sub-Agents
                │
                ▼
 rdc-cli / Offline Artifacts / Web
                │
                ▼
Evidence → Verification → Report
                │
                ▼
       Unified Knowledge Engine
```

其中：

- Debugger、Analyzer、Optimizer 是 **Planning Orchestrator**；
- Handoff 后的 General Agent 是 **Execution Orchestrator**；
- Tasks API 负责执行过程的确定性推进；
- Sub-Agent 负责隔离领域调查、局部推理和 Context；
- `rdc-cli` 是 RenderDoc Capability Layer；
- Knowledge Engine 是三大模式共享的长期知识系统；
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
  ↓
Knowledge Distillation
```

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

凡是涉及 Root Cause 或 Optimization Causality 的结论，都应尽可能通过：

- Differential；
- Minimal Intervention；
- Shader Replace；
- Replay；
- A/B/A；
- Visual Regression；

进行验证。

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

但知识只能经过明确的验证、冲突检查和 Promotion 后进入长期 Knowledge。

---

## 1.5 非目标

本系统不追求：

1. 从单份 Capture 精确还原原始 RenderGraph 源码；
2. 从编译后的 Shader 精确重建原始 Material Graph；
3. 在缺少 Counter 时强行断言 GPU 硬件瓶颈；
4. 让 LLM 直接阅读所有 Event JSON 后自由发挥；
5. 用三个模式复制三套 Capture Parser、Evidence 与 Knowledge；
6. 让现有 Agent Platform 适配一套外部臆造的配置格式；
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

独立 Sub-Agent 可以使用独立 Context Window，适合：

- 并行调查；
- 隔离竞争假设；
- 深入分析单个 Shader、Pass 或 Capture；
- 将大规模中间信息压缩成结构化结果。

但 Multi-Agent 不适合所有问题。对共享同一个可变 RDC Runtime Context、依赖链很强的任务，盲目并行会增加协调成本和状态冲突。Anthropic 的实践也表明，多 Agent 最适合相对独立、可并行的调查，而共享状态紧密的任务并不是天然适用场景。

因此：

- RDC Live Operation 默认串行；
- Offline Artifact Analysis 可以并行；
- Sub-Agent 按调查价值创建，不按组织岗位机械创建。

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

> **Canonical Knowledge Record 是真源；Agent Card 和 Human View 是不同消费视图。**

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

GitHub Copilot 的 Custom Agent 采用 `.agent.md` 描述专门职责，Sub-Agent 拥有独立 Context，用于减少主 Agent 的 Context 污染。

本设计同样以现有 `agent.md`、Skill、Tool、Hook、Task、Handoff 为真源，但不会规定新的平台配置格式。后续实现必须先阅读现有仓库，再将本设计中的领域职责映射到真实机制。

---

## 2.7 RenderDoc-first，但不把领域架构锁死

RenderDoc 是基于 Frame Capture 的 Graphics Debugger，官方项目当前覆盖 Vulkan、D3D11、D3D12、OpenGL 与 OpenGL ES 等 API。

未来可以接入更专门的 Backend。例如 Nsight Graphics 提供更深入的 Shader Profiler、Stall 与 GPU Limiter 数据；Apple 的 Metal 工具也已提供 Capture、Debug、Profile 和命令行能力。

因此：

- 第一实现完全建立在 `rdc-cli` 上；
- 上层领域概念不直接绑定 RenderDoc 内部对象；
- 未来 Backend 扩展只增强 Evidence，不改变三大模式的因果框架。

---

# 3. 总体架构

## 3.1 五个平面

我把系统拆成五个相互正交的 Plane。

```text
┌──────────────────────────────────────────────────┐
│ 1. Control Plane                                 │
│ Plan / Tasks / Handoff / Loop / Review           │
├──────────────────────────────────────────────────┤
│ 2. Execution Plane                               │
│ Main Agents / Sub-Agents / Skills / Tools        │
├──────────────────────────────────────────────────┤
│ 3. Investigation State Plane                     │
│ Evidence / Claims / Experiments / World State    │
├──────────────────────────────────────────────────┤
│ 4. Context Plane                                 │
│ Selection / Retrieval / Compact / Rehydration    │
├──────────────────────────────────────────────────┤
│ 5. Knowledge Plane                               │
│ Facts / Constraints / Patterns / Procedures      │
│ Cases / Models / Version / Promotion             │
└──────────────────────────────────────────────────┘
```

### Control Plane

回答：

- 当前目标是什么？
- 现在执行哪个 Task？
- 谁负责？
- Task 是否完成？
- Verifier 是否通过？
- 需要局部 Retry 还是整体 Replan？

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

> 交接方式以 0.1 为准：计划经用户批准并点击执行后进入 General；Big Loop 由用户切回 Mission。

```text
User selects Mission
        ↓
Planning Orchestrator
        ↓
Pre-planning Investigation / Knowledge Retrieval
        ↓
plan.md
        ↓
Agent Handoff
        ↓
General Execution Orchestrator
        ↓
Tasks API expands and executes task graph
        ↓
Live RDC Tasks + Offline Tasks
        ↓
Evidence / Claims / Artifacts / Experiments
        ↓
Skeptic Verification
        ├─ Pass
        ├─ Small Loop
        └─ Big Loop → Planning Orchestrator
        ↓
Accepted Outcome
        ↓
Developer Report / Visual Report
        ↓
Knowledge Candidate / Knowledge Patch
        ↓
Knowledge Validation and Promotion
```

---

## 3.3 系统级不变量

整个产品自身也需要一组 System Invariant。

### S-CTX-01：Context 可恢复

任何因压缩而移出 Context 的关键内容，必须保留可访问的 Artifact 或 Evidence Reference。

### S-STATE-01：Evidence 状态一致

任何 Evidence 必须能定位其 Capture、Replay、Patch 与实验状态。

### S-CLAIM-01：推断等级不升级

Compact、Summary 或 Report 不能把 `Inferred` 自动改写为 `Observed`。

### S-CAUSAL-01：因果结论需要 Intervention

没有 Differential 或 Counterfactual 支持的结论不能标记为 Causally Verified。

### S-KNOW-01：Knowledge 可追溯

所有持久化 Knowledge 必须有来源、Scope、Evidence 与版本。

### S-KNOW-02：知识冲突不可静默覆盖

新旧知识冲突时必须保留冲突关系或明确 Supersede 原因。

### S-RDC-01：可变 RDC 状态必须隔离

任何 Shader Replace、Replay Variant 或临时 Patch 都必须在可识别的 Experiment State 中执行并恢复。

---

# 4. 三个 Main Orchestrator 与 Sub-Agent 体系

## 4.1 两级 Orchestration

当前架构中存在两级 Orchestration，二者职责必须严格区分。

### Planning Orchestrator

分别由：

- Debugger；
- Analyzer；
- Optimizer；

承担。

职责：

- 理解 User Intent；
- 判断输入是否足够；
- 检索 Knowledge；
- 调用前置 Sub-Agent；
- 形成 Investigation Strategy；
- 生成 `plan.md`；
- 定义成功条件与验证要求；
- 决定可能使用哪些 Specialist。

### Execution Orchestrator

由 Handoff 后的 General Agent 承担。

职责：

- 根据 `plan.md` 创建 Tasks；
- 维护 Task Dependency；
- 委托 Sub-Agent；
- 调用 Live RDC Tool；
- 根据新 Evidence 局部调整 Task；
- 汇总结构化输出；
- 调用 Skeptic；
- 驱动 Small Loop；
- 在必要时触发 Big Loop Handoff。

Planning Orchestrator 负责“怎样调查”。

Execution Orchestrator 负责“把调查推进完成”。

---

## 4.2 Sub-Agent 的创建原则

不是每个领域名词都需要独立 Agent。

只有满足以下条件之一，才适合成为 Sub-Agent：

1. 需要独立 Context 隔离；
2. 需要长时间深入分析单个目标；
3. 能产生稳定、可复用的 Artifact；
4. 能与其他工作并行；
5. 需要独立挑战主 Agent 的结论；
6. 能显著减少 Main Orchestrator 的 Context 压力。

以下内容更适合 Skill 或 Tool：

- 固定 Checklist；
- 公式计算；
- Shader 导出；
- Event 查询；
- Knowledge Retrieval；
- Image Diff；
- Timing 统计；
- 确定性的 Graph 构建。

本设计中出现的 Agent 名称表达的是**领域职责**，不是强制的文件名、注册表或平台 Schema。最终实现应根据现有 `agent.md` 与代码真源决定复用、合并或拆分。

---

## 4.3 三大模式共享的 Agent 能力

| 能力 | Debugger | Analyzer | Optimizer |
|---|---:|---:|---:|
| Capture Report | 核心 | 核心 | 核心 |
| Pass Graph / Pipeline | 核心 | 核心 | 核心 |
| Shader / IR | 常用 | 核心 | 核心 |
| Pixel / Value Forensics | 核心 | 核心 | 可选 |
| Cross-Capture Alignment | 常用 | 核心 | 常用 |
| Device / Driver Research | 常用 | 可选 | 常用 |
| Visual Evidence | 常用 | 常用 | 核心 |
| Experiment Execution | 核心 | 可选 | 核心 |
| Skeptic | 核心 | 核心 | 核心 |
| Report / Knowledge Curation | 核心 | 核心 | 核心 |

共享意味着：

- 领域能力相同；
- Tool 与 Artifact 可复用；
- 输入输出语义一致；

但调查目标不同。

例如 `shader_ir`：

```text
Debug Lens:
查找错误值、Precision、UB、Compiler Mismatch

Analyze Lens:
识别算法结构、Shader Block、Material Feature

Optimize Lens:
识别 ALU、Texture、Branch、Register 与 Patch Opportunity
```

不应复制成三套几乎相同的 Agent。

---

## 4.4 Debugger 专属职责

### Triage & Taxonomy

负责：

- Symptom 分类；
- Trigger 分类；
- Bug Family；
- Candidate Invariant；
- 初始 Hypothesis；
- 需要用户补充的信息。

### Root Cause Investigation

主要由现有 Debugger Planning Orchestrator 设计，并在 Execution 阶段调用：

- `pass_graph_pipeline`；
- `pixel_value_forensics`；
- `shader_ir`；
- `device_driver`；
- Experiment。

---

## 4.5 Analyzer 专属职责

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

## 4.6 Optimizer 专属职责

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

默认必须串行。

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
- 多个 Sub-Agent 同时分析。

`Offline Worker` 不是强制的新平台 Primitive，而是一种 Task 执行属性。

---

# 5. Tasks API、Handoff 与执行控制

## 5.1 plan.md 的定位

`plan.md` 是：

- 人类可读的调查策略；
- Planning Orchestrator 的主要交付；
- Handoff 的核心输入；
- 任务执行的战略基线。

但 `plan.md` 不应承担所有动态状态。

执行中的事实应由：

- Tasks；
- Artifacts；
- Evidence；
- Experiment State；
- Review Challenges；

共同保存。

原则是：

> `plan.md` 表达调查意图，Tasks API 表达执行现实。

---

## 5.2 Plan 应包含的领域信息

不规定文件格式，但语义上必须覆盖：

1. User Goal；
2. Mission 类型；
3. 已知输入；
4. 初始事实；
5. 初始 Hypothesis 或分析方向；
6. 推荐调查阶段；
7. 可能使用的 Sub-Agent；
8. 任务依赖；
9. 必须执行的验证；
10. 成功条件；
11. 停止条件；
12. 当前能力上限；
13. 已知风险；
14. 可触发 Replan 的条件。

---

## 5.3 Task 的领域契约

每个 Task 至少应明确：

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

具体如何映射到现有 Tasks API，由实现时读取平台真源决定。

---

## 5.4 Task Graph 的动态调整

Execution Orchestrator 可以：

- 新增补充 Task；
- 拆分过大的 Task；
- 合并重复 Task；
- 标记无效 Task；
- 调整顺序；
- 委托 Sub-Agent；
- 将某个结论送入独立 Review。

但不应在没有记录原因的情况下：

- 静默改变 Mission；
- 删除失败实验；
- 覆盖旧 Plan；
- 把未验证结论标记为完成。

每次结构性变更都应说明：

```text
Changed:
为什么调整

Evidence:
什么新信息触发调整

Impact:
原 Plan 哪些部分失效

Plan Version:
新旧关系
```

---

## 5.5 Small Loop

Small Loop 用于局部调查未通过 Verifier 的情况。

```text
Task Execution
      ↓
Candidate Claims
      ↓
Skeptic Review
      ↓
Challenge Set
      ↓
Targeted Follow-up Tasks
      ↓
Update Iteration Memory
      ↓
Retry
```

Small Loop 不应重新规划整个 Mission。

适用情况：

- 缺少一条 Evidence；
- 存在一个替代 Hypothesis；
- 实验有混淆变量；
- Scope 过度扩张；
- Visual Regression 未验证；
- Timing Sample 不足。

### 调查者自身的推进

上面的 Small Loop 从 Verifier 的 Challenge 开始。但调查在形成任何 Candidate Claim 之前就可能停下，这时没有东西可供质疑。所以推进不能只靠 Verifier，调查者每得到一个结果都要自己回答三个问题：

1. 当前对象是否已经锚定（见 10.4）？没有，下一步就是确立或否定锚点。
2. 现有解释里，哪一项合法、可执行的检查最能区分它们？
3. 结果回来后，谁被支持、削弱、排除或暂缓？

只要批准范围内还有这样的检查，就继续，不把"下一步尚未检查"当成阻塞。确实不能继续时，逐项交代：缺口是什么、试过什么、被什么阻止（能力、权限、预算或期限、战略边界、外部条件）、什么条件下可以恢复。说不出阻塞的条目是应继续的工作，不是停止的理由。

---

## 5.6 Big Loop

> 交接方式以 0.1 为准：General 就地交付缺口与 Mission Checkpoint，由用户决定是否切回 Mission 重新规划。

Big Loop 用于原调查战略已经失效。

触发条件：

1. 初始 Bug Family 判断错误；
2. Analyzer 发现原有结构假设不成立；
3. Optimizer 发现最耗时 Pass 不在可执行范围；
4. 当前 Backend 缺少关键能力；
5. 多轮 Verifier 都指出同一个结构性缺口；
6. 新 Evidence 将问题升级为新的 Mission Scope；
7. 用户目标发生变化；
8. Context 即将耗尽且原 Plan 已高度偏离现实。

Big Loop 流程：

```text
Execution State
      ↓
Mission Checkpoint
      ↓
Handoff to Planning Orchestrator
      ↓
Knowledge Re-retrieval
      ↓
New plan.md Version
      ↓
Handoff to Execution
```

---

## 5.7 完成状态

任务不能只有“成功 / 失败”。

建议领域上区分：

### Complete

满足 Mission 的完整成功标准。

### Partial

产出有价值，但未达到全部验证要求。

例如 Optimizer 找到了 Cost Location，却无法执行 Counterfactual。

### Inconclusive

完成了合理调查，但证据无法区分竞争 Hypothesis。

### Blocked

缺少 Capture、Backend Capability、合法权限或必要输入。

### Replanned

当前执行结束，已移交新 Plan。

这可以映射到现有平台状态，不要求新增相同枚举。

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

每次委托 Sub-Agent 时，都应即时编译一份 Task-specific Context Capsule。

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

这不是要求平台新增某种文件，而是 Context 构造必须满足的领域契约。

---

## 6.4 不同角色的 Context 范围

| 角色 | Context 特征 |
|---|---|
| Planning Orchestrator | 宽语义、低 Raw Detail |
| Execution Orchestrator | 全局进度、Accepted Facts、Task State |
| Specialist | 窄范围、深证据、明确目标 |
| Skeptic | 宽但干净，只看 Claims、Evidence、Alternatives |
| Report Agent | 最终事实、关键 Artifact、验证等级 |
| Knowledge Curator | Accepted Outcome、失败经验、Scope、Provenance |

### Planning Orchestrator 不需要

- 数百行 Pipeline JSON；
- 完整 Shader Debug Trace；
- 所有 Tool Log；
- 每个 Sub-Agent 的完整思考过程。

### Specialist 不需要

- 整段用户历史；
- 无关 Pass；
- 无关知识；
- 其他 Task 的全部 Transcript。

### Skeptic 不应被 Generator 叙事污染

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

Big Loop 或 Context Compact 前必须生成 Mission Checkpoint。

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
Why Replanning Is Required
Unresolved Frontier
Critical Artifact References
Current World State
Remaining Tasks
Knowledge Used
Capability Limitations
```

Mission Checkpoint 回答：

> 旧战略为什么已经不够，以及新 Planner 必须继承什么。

---

## 6.7.1 读取时机

记录的价值在于被读到并改变下一步。只写不读的记录是成本。下列时刻必须把对应内容读回决策：

| 时刻 | 必须读回 |
|---|---|
| 准备声明完成或 Partial | Unresolved Frontier、未解决的 Challenge 及其所需行动 |
| Context Compact 之后 | 原 Plan、Mission Checkpoint、Unresolved Frontier、未解决的 Challenge |
| 委派独立审查 | 被审 Claim，以及它依赖的原始 Evidence、World State 和 Experiment 回执 |
| Big Loop 重新规划 | Mission Checkpoint 全文 |
| 现场恢复之后 | 仍然有效的 Evidence 与需要重新核验的状态（见 7.7） |

Verifier 只能读到被授予的内容，所以原始证据须随被审主张一并授予。Compact 与委派保留的是这些内容本身，不只是它们的索引。

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

尚待验证的机制解释。

### Experiment

对变量进行 Intervention 的验证过程。

### Challenge

对 Claim、Evidence 或 Experiment 的反驳要求。

### Decision

为什么接受、拒绝、降级或延期一个 Claim。

---

## 7.2 Claim 类型

| 类型 | 示例 |
|---|---|
| Observed Fact | Event 1834 写入 SceneColor |
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

---

# 8. Unified Knowledge Engine

## 8.1 目标

Knowledge Engine 必须同时服务：

- Debugger 的 Bug、Invariant、排查流程；
- Analyzer 的 Pass、Shader Block、Architecture Model；
- Optimizer 的 Cost Pattern、Experiment 与 Optimization；
- Planner 的冷启动；
- Specialist 的即时检索；
- Skeptic 的反例检索；
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

为当前 Planner 或 Specialist 即时生成最相关的 Knowledge Pack。

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

每条知识存在三种表示：

```text
Canonical Knowledge Record
        ├─ Agent Card
        └─ Human View
```

### Canonical Record

真源，保存：

- 完整 Claim；
- Evidence；
- Scope；
- Verification；
- Version；
- Relations；
- Conflict；
- Lifecycle。

### Agent Card

高密度、低 Token、面向任务消费。

### Human View

包含解释、图表、案例和历史变更。

所以：

> Card 是 Projection，不是 Storage Ontology。

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

Canonical Scope 应能够表达：

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

## 8.6 Knowledge Relations

Knowledge Engine 至少支持以下语义关系：

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
Draft
  ↓
Candidate
  ↓
Verified
  ↓
Promoted
  ↓
Deprecated / Superseded
```

### Draft

Agent 或人类刚创建。

### Candidate

通过基本完整性检查，但尚未充分验证。

### Verified

在明确 Scope 内有可靠 Evidence。

### Promoted

扩大 Scope，成为 Engine、Platform 或更通用知识。

### Deprecated

不再推荐，但保留历史。

默认不物理删除，除非涉及：

- 敏感信息；
- 合规；
- 明确错误且无审计价值；
- 用户要求彻底清除。

---

## 8.8 不同 Knowledge Type 的 Promotion 规则

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
- Replay-Validated；
- Runtime-Validated；
- Cross-Scene；
- Cross-Device。

---

## 8.9 Human 与 Agent 的权限

人类工程师可以：

- Add；
- Edit；
- Merge；
- Specialize；
- Generalize；
- Contradict；
- Supersede；
- Deprecate；
- Delete。

Agent 也可以提出这些操作，但默认生成 Knowledge Patch。

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

## 8.10 知识自进化流程

```text
Completed Mission
      ↓
Investigation Distillation
      ↓
Knowledge Candidate Set
      ↓
Deduplication
      ↓
Conflict Detection
      ↓
Scope Validation
      ↓
Evidence Validation
      ↓
Knowledge Patch
      ↓
Auto Rule / Human Review
      ↓
Versioned Knowledge Store
```

Knowledge Patch 支持：

- Add；
- Update；
- Merge；
- Link；
- Specialize；
- Generalize；
- Contradict；
- Supersede；
- Deprecate；
- Reject。

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

检索顺序：

```text
1. Scope Filter
2. Structural Match
3. Lexical / Semantic Retrieval
4. Graph Expansion
5. Verification Ranking
6. Freshness Check
7. Contradiction Injection
8. Diversity Selection
9. Context Compilation
```

### Structural Match

RenderDoc Agent 应优先利用：

- Shader Fingerprint；
- Pass Fingerprint；
- Resource Graph；
- Event Pattern；
- Format；
- Binding Layout；
- Symptom；
- Trigger；
- Compiler Statistics。

纯 Embedding 只是补充。（裁决见 0.1：产品不使用 Embedding 或 Semantic 通道。）

### Contradiction Injection

Knowledge Pack 不能只返回支持当前 Hypothesis 的内容。

还应主动返回：

- Counterexample；
- Exclusion；
- Failure Case；
- Conflicting Knowledge；
- Scope Mismatch。

这对 Skeptic 尤其重要。

---

## 8.13 Knowledge Pack

三个 Planner 使用同一个 Knowledge Engine，但获得不同 Pack。

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
- Validated Gains。

---

## 8.14 Knowledge Usage Trace

系统应记录：

```text
Knowledge K-102
      ↓ used by
Planning Decision P-14
      ↓ created
Task T-08
      ↓ produced
Evidence E-302
      ↓ supported
Claim C-91
```

这样可以测量知识的真实价值，而不只是“被检索了几次”。

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
- Skeptic-reviewed；
- Knowledge-evolving。

---

## 10.2 Planning 阶段

Debugger 本身是 Planning Orchestrator。

前置 Sub-Agent：

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

---

## 10.3 Execution 阶段

General Execution Orchestrator 根据 Plan 创建 Tasks。

可能调用：

- Pass Graph / Pipeline；
- Pixel / Value Forensics；
- Shader / IR；
- Device / Driver；
- Cross-Capture；
- Experiment；
- Visual Analysis。

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
Skeptic
  ↓
Report and Knowledge
```

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

**锚点的依据分三档：** 用户确认；两条路径互相印证；仅候选。锚点仍是"仅候选"时，First Bad Event、Hypothesis 区分和 Counterfactual 都没有成立的基础，此时下一步优先选择能确立或否定它的检查。对象或区域确有歧义且现有材料无法判定时，问用户一次，比长时间猜测更好。展示截图的尺寸可能不同于原生纹理，坐标以原生纹理为准。

---

## 10.5 Debugger 完成条件

### Complete

- Symptom Anchor 已确立（用户确认或两条路径互相印证）；
- First Bad Event 已定位；
- Root Cause 已拆分；
- 替代 Hypothesis 已处理；
- 至少一个 Counterfactual；
- Patch 后结果恢复；
- Scope 明确；
- Skeptic 无 Blocker。

### Partial

- 已定位错误范围；
- 有强 Hypothesis；
- 但 Backend 不支持充分 Counterfactual。

### Inconclusive

- 多个机制仍无法区分；
- Evidence 不足；
- 明确给出下一步所需信息。

---

## 10.6 Debugger 知识产物

- Debug Case；
- Bug Pattern；
- Correctness Constraint；
- Debug Procedure；
- Device / Driver Fact；
- Negative Knowledge；
- Project Mapping。

---

## 10.7 对现有 Debugger 的增强

不推翻现有流程，只增加：

1. Unified Context Capsule；
2. World-State Provenance；
3. Challenge Memory；
4. Small / Big Loop Checkpoint；
5. Unified Knowledge Engine；
6. Shared Analyzer World Model；
7. 统一 Evidence 与 Experiment；
8. 更严格的 Knowledge Promotion。

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

---

## 11.3 Planning 阶段

Analyzer Planning Orchestrator 调用：

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
- 需要的 Specialist；
- 预期 Model；
- Coverage 标准；
- Unknown 处理规则。

---

## 11.4 Analyzer 执行阶段

### 阶段一：Observed Model

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

### 阶段二：Resource Versioning

建立 Resource Producer / Consumer。

### 阶段三：Pass Reconstruction

聚类 Event，生成 Hierarchical Pass Graph。

### 阶段四：Shader Reconstruction

建立：

- Shader Fingerprint；
- Backward Slice；
- Block Graph；
- Semantic Candidate。

### 阶段五：Traceability

形成 Pixel / Resource / Pass Provenance。

### 阶段六：Cross-Capture

对齐：

- Pass；
- Shader；
- Resource；
- Feature；
- Graph Neighborhood。

### 阶段七：Architecture Synthesis

形成项目级 Rendering Model。

### 阶段八：Skeptic

检查：

- 事实与推断是否混淆；
- Pass Boundary 是否证据不足；
- Engine Feature 是否过度命名；
- Unknown 是否被隐藏；
- Cross-Capture 对齐是否错误。

---

## 11.5 Pass Reconstruction

Pass Boundary 不能由 LLM 单独判断。

建议使用：

\[
PassScore =
w_m Marker
+w_a AttachmentChange
+w_r ResourceBoundary
+w_s ShaderSimilarity
+w_p PipelineSimilarity
+w_g GraphNeighborhood
\]

具体权重可以通过 Benchmark 学习，不写死在设计书。

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

## 11.10 Analyzer 成功标准

### 最低完整标准

- 主要 Pass 可用；
- Resource Dependency 清晰；
- 高频 Shader / Material Block 有 Fingerprint；
- 用户目标 Trace 可回答；
- Observed / Derived / Inferred 分离；
- Unknown Frontier 明确；
- Skeptic 无结构性 Blocker。

### Coverage 指标

- Top GPU Work Pass Coverage；
- Top Resource Coverage；
- Top Shader Coverage；
- Trace Completeness；
- Semantic Label Coverage；
- Unknown Ratio。

---

## 11.11 Analyzer 输出

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

### Knowledge

- Model；
- Pattern；
- Fact；
- Analysis Procedure；
- Case。

---

## 11.12 无 Debug Tag Capture 的分析策略

冷启动时可以使用人工量化出的真实项目 Rendering Structure 作为 Ground Truth。

Agent 输入只看到无 Marker Capture，输出后与人工版图比较：

- Pass Segmentation；
- Pass Semantic；
- Resource Edge；
- Major Feature；
- Hierarchy；
- Unknown；
- False Inference。

这会成为 Analyzer 最重要的真实 Evaluation Case。

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

### O5：Runtime A/B

可改游戏配置、重新运行与 Capture。

### O6：Cross-Scene / Device

可验证项目级收益与回归。

当前默认 RenderDoc 工作流重点覆盖 O1–O3。

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

### P4：Runtime-Counterfactual

真实运行时 A/B。

### P5：Regression-Validated

跨场景、Quality、平台无回归。

当前默认完整 Optimizer 至少应争取 P3。

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

推荐：

```text
Warm-up
   ↓
A Baseline Samples
   ↓
B Variant Samples
   ↓
A Baseline Recheck
```

或：

```text
A B A B A B
```

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
- Runtime Validation Requirement；
- Confidence。

---

## 12.12 Optimizer 完成条件

### Complete

- Frame Breakdown；
- Top Cost Location；
- Mechanism 达到支持等级；
- 至少一个 Counterfactual Experiment；
- Timing 高于 Noise；
- Visual Regression 已检查；
- Scope 与 Verification Ceiling 明确；
- Skeptic 无 Blocker。

### Partial

- 已定位 Cost Location；
- 给出强 Mechanism；
- 但缺少可执行 Experiment。

此时不能称为“已验证优化”。

### Inconclusive

- Replay 噪声过高；
- Counter 不足；
- 多种 Limiter 无法区分。

---

## 12.13 Optimizer 输出

- Performance Model；
- Frame Breakdown；
- Bottleneck Report；
- Experiment Record；
- Before / After；
- Optimization Case；
- Optimization Pattern；
- Budget Constraint；
- Negative Result；
- Runtime Validation Plan。

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
- 建议启动 Debugger；

而不是擅自把 Analyzer 任务改成 Debug Mission。

### Analyzer 发现性能问题

同理，输出 Optimization Opportunity，不自动切换。

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

报告是 Investigation State 的 View。

最终 Claim、Evidence、Experiment、Artifact 和 Knowledge Patch 应先确定，再生成报告。

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
- Skeptic Challenges；
- Limitations；
- Knowledge Patch；
- Artifact Index。

### Debugger

- Symptom；
- First Bad Event；
- Root Cause；
- Counterfactual；
- Fix。

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

每个关键结论应带：

```text
Observed
Derived
Inferred
Replay-Validated
Runtime-Validated
Unresolved
```

Optimizer 必须明确：

```text
Replay Gain ≠ Project Runtime Gain
```

Analyzer 必须明确：

```text
Reconstructed Model ≠ Original Authoring Model
```

---

# 15. Evaluation、Benchmark 与质量体系

## 15.1 评价方法

Agent Evaluation 不应只看最终文案。

应组合：

- Code-based Grader；
- Model-based Grader；
- Human SME；
- End-state Evaluation。

Anthropic 的 Agent Eval 实践同样建议组合确定性检查、模型评分和人工审核，并根据任务选择 Outcome 或 Transcript 评价。

---

## 15.2 Debugger 指标

- Root Cause Accuracy；
- First Bad Event Accuracy；
- Evidence Precision；
- Evidence Recall；
- Counterfactual Validity；
- Alternative Hypothesis Coverage；
- False Driver Blame Rate；
- Loop Count；
- Tool Cost；
- Expert Acceptance。

---

## 15.3 Analyzer 指标

- Pass Segmentation Precision / Recall；
- Pass Hierarchy Accuracy；
- Resource Edge Precision / Recall；
- Shader Family Clustering；
- Semantic Label Accuracy；
- Trace Completeness；
- Trace Correctness；
- Unknown Calibration；
- Cross-Capture Match Accuracy；
- Architecture Model Coverage。

---

## 15.4 Optimizer 指标

- Top Cost Localization；
- Limiter Accuracy；
- Mechanism Accuracy；
- Experiment Reproducibility；
- Predicted vs Measured Gain；
- False Positive Optimization；
- Visual Regression Detection；
- Runtime Transfer Error；
- Critical Path Accuracy；
- Noise Handling。

---

## 15.5 Knowledge Engine 指标

- Retrieval Precision；
- Retrieval Recall；
- Scope Match；
- Stale Knowledge Detection；
- Conflict Preservation；
- Promotion Precision；
- Knowledge-caused Error Rate；
- Effective Knowledge Usage；
- Procedure Success Rate；
- Negative Knowledge Reuse。

---

## 15.6 Context Engineering 指标

- Token / Successful Task；
- Critical Omission；
- Stale Context；
- Duplicate Context；
- Compact Retention；
- State Mismatch；
- Rehydration Success；
- Small Loop Repetition；
- Big Loop Recovery；
- Sub-Agent Result Loss。

---

## 15.7 Benchmark 数据集

### Synthetic Ground Truth

人工构造：

- NaN；
- Precision Overflow；
- Resource Hazard；
- Wrong Blend；
- Texture Format；
- Overdraw；
- Shader Loop；
- Sample Redundancy；
- Known Pass Graph。

### Historical Cases

来自真实：

- BugCard；
- Invariant；
- SOP；
- Optimization；
- Human Debug Report。

### Real Project Capture

包括：

- 无 Debug Tag；
- 人工 Pipeline Structure Ground Truth；
- Feature Variants；
- Platform Variants；
- Quality Variants。

### Adversarial Cases

- 模糊现象；
- 多 Root Cause；
- Capture Corruption；
- Unsupported Shader Debug；
- Async Compute；
- Stale Knowledge；
- 错误人工知识；
- Web Prompt Injection；
- Noisy Timing；
- Shader Patch State Pollution。

---

## 15.8 End-state Evaluation

由于 Shader Replace 与 Knowledge Update 会改变持久状态，评估重点应放在最终状态：

- Baseline 是否恢复；
- Knowledge 是否被错误修改；
- Evidence 是否来自正确状态；
- 报告是否与最终 Claim 一致；
- Artifact 是否可复现；
- Task 是否真正达到成功条件。

---

# 16. 冷启动方案

## 16.1 冷启动资产

初始 Knowledge 来源：

1. 现有 Bug Case；
2. Existing Invariant；
3. Debug Procedure；
4. 已验证 Experiment；
5. Agent Skill；
6. RenderDoc Tool Description；
7. 项目知识；
8. 人工 Rendering Structure；
9. 通用 Graphics Knowledge；
10. 合成 Benchmark。

---

## 16.2 真实项目 Rendering Structure 的价值

人工分析出的无 Debug Tag Pipeline 版图同时承担：

### Ground Truth

评价 Analyzer。

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

## 16.3 冷启动步骤

### Step 1：资产盘点

识别：

- 哪些是事实；
- 哪些是人类判断；
- 哪些已验证；
- 哪些仅为经验。

### Step 2：标准化

统一转换为：

- Fact；
- Constraint；
- Pattern；
- Procedure；
- Case；
- Model。

### Step 3：Scope 标注

标记：

- Project；
- API；
- Platform；
- GPU；
- Engine；
- Version。

### Step 4：Evidence Link

能链接到 Capture 的必须链接。

不能链接的知识标记为 Human-authored。

### Step 5：Seed Agent Card

为 Planner 和 Specialist 生成高密度视图。

### Step 6：Benchmark

运行：

- Debug；
- Analyze；
- Optimize；

三类基准。

### Step 7：人工校准

重点检查：

- Analyzer 过度推断；
- Optimizer 假瓶颈；
- Knowledge Scope 过宽；
- Compact 丢失关键信息。

---

## 16.4 合成 Knowledge 的规则

缺少真实资产时，可以生成冷启动示例，但必须标记：

```text
Synthetic
Unverified
Educational
Not Project Ground Truth
```

合成内容不能直接进入 Verified Knowledge。

---

## 16.5 历史案例导入归一化

历史 Debug Case 服务冷启动，是可选的 Candidate 原料，不是已验证的 Knowledge，也不会自动成为 Candidate。

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

# 17. 实施路线与 Codex 落地原则

## 17.1 Release 目标

第一版产品范围同时包含：

- Debugger；
- Analyzer；
- Optimizer。

但实现顺序仍应遵循依赖关系。

“同时完整”不等于“三条线各写一套”。

---

## 17.2 Phase 0：读取仓库真源

Codex 必须先阅读：

- Agent Platform；
- 现有 Debugger `agent.md`；
- Sub-Agent；
- Skill；
- Hook；
- Tasks API；
- Handoff；
- Compact；
- Runtime Context；
- `rdc-cli`；
- Knowledge 目录；
- Report 产物。

输出：

- 现有能力图；
- 可复用组件；
- 缺口；
- 迁移计划；
- 不应改变的兼容边界。

---

## 17.3 Phase 1：抽取共享调查基础

在不破坏 Debugger 的前提下统一：

- Evidence；
- Artifact；
- World State；
- Experiment；
- Challenge；
- Mission Checkpoint；
- Context Capsule；
- Knowledge 引用。

不要求新建与本设计同名的类或文件。

目标是语义一致。

---

## 17.4 Phase 2：Context 与 Knowledge

完成：

- Task-specific Context；
- Iteration Memory；
- Big Loop Checkpoint；
- Artifactization；
- Knowledge Types；
- Scope；
- Version；
- Retrieval；
- Knowledge Patch；
- Human Edit；
- Conflict。

---

## 17.5 Phase 3：Analyzer 与 Optimizer 并行建设

### Analyzer

- Pass Graph；
- Resource Version；
- Shader Fingerprint；
- Trace；
- Cross-Capture；
- Architecture Model。

### Optimizer

- Timing Baseline；
- Frame Breakdown；
- Cost Mechanism；
- Experiment；
- Replay Benchmark；
- Visual Regression。

---

## 17.6 Phase 4：统一验证与报告

完成：

- Skeptic Challenge；
- Developer Report；
- Executive Visual Report；
- Artifact Manifest；
- Evaluation Harness；
- Benchmark Corpus。

---

## 17.7 Phase 5：知识自进化

完成：

- Distillation；
- Candidate；
- Conflict；
- Promotion；
- Negative Knowledge；
- Procedure Metrics；
- Knowledge Usage Trace。

---

## 17.8 Phase 6：Backend 扩展

根据实际价值接入：

- PIX；
- Nsight Graphics；
- Xcode Metal Debugger；
- AGI；
- Snapdragon Profiler；
- Mali 工具。

先扩展 Evidence Capability，不重写 Mission 逻辑。

---

## 17.9 Codex 实现约束

负责落地的 Codex 必须遵守：

1. 现有仓库是真源；
2. 先理解再修改；
3. 优先复用现有 Debugger；
4. 不要求平台适配外部虚构 Schema；
5. 本设计中的对象是领域语义，不一定是一对一代码类型；
6. 不进行大规模重写，除非真源证明无法渐进演化；
7. 所有迁移需要兼容旧 Debugger；
8. 新机制必须有测试；
9. Context、Knowledge 与 Experiment 必须可审计；
10. 不允许为了“架构一致”引入无实际价值的中间层。

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
**防护：** Diagnostic、Semantic-preserving、Quality Trade-off 分级。

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
**防护：** Claim Type 与 Verification Level 必须保留。

---

## 18.8 Multi-Agent 共享 RDC 冲突

**风险：** 多 Agent 修改同一个 Replay State。  
**防护：** Live RDC 串行，Offline Artifact 并行。

---

## 18.9 Knowledge Poisoning

**风险：** 一次误判成为长期 SOP。  
**防护：** Candidate、Scope、Promotion、Conflict、Negative Usage。

---

## 18.10 Confirmation Bias

**风险：** Knowledge Retrieval 全部支持当前 Hypothesis。  
**防护：** Contradiction Injection 与独立 Skeptic。

---

## 18.11 Report 漂移

**风险：** 视觉设计过程改变结论或数值。  
**防护：** Report 只消费 Accepted Claims 与真实 Artifact。

---

## 18.12 Benchmark 过拟合

**风险：** Agent 记住固定案例。  
**防护：** Synthetic、Historical、Real、Adversarial、Hidden Set。

---

## 18.13 Cost 失控

**风险：** 所有 Task 都启动昂贵 Sub-Agent。  
**防护：**

- 仅在 Context 隔离有价值时委托；
- Knowledge Retrieval 优先 Tool；
- Offline 并行只用于高价值工作；
- 记录 Token、Tool、Loop 与 Information Gain。

---

## 18.14 未授权 Capture

RenderDoc 官方明确将其定位为调试自行开发程序的工具。

系统应要求：

- Capture 来源合法；
- 项目授权；
- Knowledge 隔离；
- Shader / Asset 不泄露；
- External Agent 不获取无关敏感信息。

---

# 19. 最终验收标准

## 19.1 系统级

- 一个 Agent Platform；
- 三个 Planning Orchestrator；
- 一个 Execution Orchestrator 机制；
- 一套 Tasks API；
- 一套 Context Engineering；
- 一套 Evidence / Experiment；
- 一个 Knowledge Engine；
- 三类 Mission；
- 统一 Report 与 Evaluation。

---

## 19.2 Debugger

- 可从现象形成 Plan；
- 可确立 Symptom Anchor；
- 可定位 First Bad Event；
- 可建立 Root Cause；
- 可完成 Counterfactual；
- 可通过 Skeptic；
- 可生成 Debug Case 和 Report。

---

## 19.3 Analyzer

- 无 Debug Tag Capture 可生成主要 Pass Graph；
- Resource Producer / Consumer 可追溯；
- 高频 Shader Block 可聚类；
- Pixel / Resource Trace 可用；
- Observed / Inferred 分离；
- 可增量形成 Architecture Model。

---

## 19.4 Optimizer

- 生成 Frame Breakdown；
- 定位 Top Cost；
- 解释 Mechanism；
- 完成至少一个 Replay Experiment；
- 统计结果高于 Noise；
- 检查视觉差异；
- 明确验证上限和 Runtime 风险。

---

## 19.5 Context

- 每个 Sub-Agent 只获得 Task-relevant Context；
- 原始 Artifact 可恢复；
- Small Loop 不重复完整历史；
- Big Loop 能通过 Mission Checkpoint 恢复；
- Patch 后旧 Evidence 不会错误复用。

---

## 19.6 Knowledge

- 六类 Knowledge 可统一管理；
- Scope 多轴表达；
- Agent 与人类均可编辑；
- 冲突不静默覆盖；
- Promotion 有规则；
- Negative Knowledge 可检索；
- 每条知识可追溯到来源。

---

# 20. 附录：关键语义对象示例

以下示例只表达领域语义，不规定 Agent Platform 必须采用 YAML、JSON、类或特定目录。

---

## A. Delegation Context Capsule

```yaml
mission:
  type: optimize
  goal: identify primary cost mechanism

task:
  target: lighting shader
  reason: dominant event group in frame breakdown

accepted_facts:
  - lighting pass contributes 31% of replay critical path
  - target shader executes at full resolution

active_hypotheses:
  - repeated texture sampling is dominant
  - register pressure may hide texture latency

rejected:
  - excessive draw call count
  - reason: pass contains one fullscreen draw

world_state:
  capture: CAP-01
  patch: baseline
  replay_environment: ENV-02

artifacts:
  - shader_ir
  - compiler_statistics
  - timing_samples
  - framebuffer

knowledge:
  - texture-cost-pattern
  - fullscreen-lighting-optimization-procedure

required_output:
  - block-level cost hypotheses
  - supporting evidence
  - experimental patch candidates
  - unresolved mechanisms
```

---

## B. Mission Checkpoint

```yaml
goal:
  diagnose character skin color anomaly

current_plan:
  version: 3

established:
  - anomaly first appears in lighting pass
  - source texture is normal
  - first non-finite value appears in lighting multiplication

rejected:
  - texture corruption
  - blend state error

completed_experiments:
  - full FP32 replacement
  - targeted precision fence

open_challenges:
  - verify that codegen change is not sole cause

reason_for_replan:
  original plan assumed texture decode failure

current_world_state:
  baseline restored

critical_artifacts:
  - pixel_trace
  - shader_ir_diff
  - before_after_images

unresolved_frontier:
  - driver-specific lowering scope
```

---

## C. Canonical Knowledge Record

```yaml
type: pattern
title: FP16 HDR Intermediate Overflow

summary:
  relaxed precision on an HDR lighting path can produce non-finite
  intermediate values when the numerical range exceeds FP16.

scope:
  stage: lighting
  precision: fp16
  api: any
  gpu: unspecified

preconditions:
  - HDR intermediate
  - actual FP16 lowering
  - value range exceeds finite FP16

exclusions:
  - compiler retains FP32
  - value range remains bounded

evidence:
  - debug-case-021
  - experiment-044

verification:
  level: replay-counterfactual

relations:
  - violates: finite-value-constraint
  - recommends: precision-fence-procedure
  - contradicted_by: bounded-lighting-case

lifecycle:
  status: verified
```

---

## D. Optimization Experiment

```yaml
hypothesis:
  repeated shadow texture samples dominate target shader cost

baseline:
  world_state: CAP-01/BASELINE

intervention:
  replace repeated samples with one reused sample

controlled:
  - capture
  - event
  - resolution
  - pipeline state

metrics:
  - event timing
  - shader instructions
  - registers
  - framebuffer difference

protocol:
  warmup: required
  sequence: A-B-A
  statistic: median
  noise_threshold: measured

result:
  local_replay_gain: 11%
  frame_estimated_gain: 1.8% to 2.4%
  visual_difference: none detected in target capture

verification:
  replay-counterfactual

limitations:
  runtime and cross-scene validation required
```

---

# 结论

我将 RenderDoc Agent 的最终形态定义为：

```text
One Agent Runtime
One Tasks-driven Control Flow
One Investigation State
One Context Engineering System
One Unified Knowledge Engine

Three Explicit Missions:
Debugger
Analyzer
Optimizer
```

它的核心竞争力不只是“Agent 会使用 RenderDoc”，而是：

1. 能从 Capture 中重建一个可解释的 Rendering World；
2. 能把正确性问题转化为可验证的因果调查；
3. 能把性能问题转化为可测量的 Intervention；
4. 能让每个 Sub-Agent 只获得正确、足够、可恢复的 Context；
5. 能让多轮 Verifier Loop 保留有效 Memory，而不是堆积 History；
6. 能把一次任务沉淀为有 Scope、有 Evidence、有版本的组织知识；
7. 能让人类理解、审核、修改和推翻 Agent 的任何结论；
8. 能在缺少 Engine Source、Debug Tag 和项目知识时仍然工作；
9. 能随真实项目与长期任务持续进化；
10. 能在未来扩展到 PIX、Nsight、Xcode、AGI 等 Backend，而不推翻领域架构。

最终系统不是三个 Agent 的简单拼接，而是一套完整的：

> **Rendering Investigation Runtime + Capture World Model + Evidence & Experiment System + Context Compiler + Knowledge Engine。**