# Generative UI v1 对标与评估基线

## 目的

本基线用于 Outer Loop，不是生成模板。Canonical suite 位于 `src/shared/constants/generativeUiBenchmark.ts`，版本为 `v1.0.0`，包含 20 个复杂 case，覆盖 website、dashboard、simulator、tool、visualization 与 game。每个 case 都声明至少三个必须交互和两个外部证据要求。

release report 只统计带 `benchmarkCaseId` 且完成 L1/L2/L3、最终为 `success` 的 Canvas。普通演示 Canvas 或单元测试不能代替 canonical benchmark evidence。

Outer Loop 的辅助证据同样 fail-closed：real use case 和 blind dynamic candidate 必须引用实际闭环 Canvas/version；expert review 必须有 score、notes 和独立 reviewer source。重复 reviewer、未闭环 artifact 或仅有自由文本的 legacy record 不满足 v1 release evidence。

## Gemini Canvas 官方行为观察

观察日期：2026-07-12。

Google 官方帮助页说明 Canvas app 支持 prompt refinement、直接代码编辑、自动保存、preview error/log console、recent changes、Select & ask，以及为 app 添加 text/image generation：

- https://support.google.com/gemini/answer/16047321?co=GENIE.Platform%3DDesktop&hl=en

Google 官方发布说明将其定位为创建、编辑、分享代码和设计的一体化空间，并明确列出 HTML/React web prototype、game、simulation 等交互应用：

- https://blog.google/products-and-platforms/products/gemini/gemini-collaboration-features/

Google 的安全说明指出公开分享和持久化数据需要清晰的数据可见性边界：

- https://support.google.com/gemini/answer/16419134?hl=en-GB

## 当前对标维度

| 维度 | RDC-Agent 当前证据 | 下一门禁 |
| --- | --- | --- |
| Prompt refinement | Canvas 多轮 version/branch | 5 轮真实 benchmark case |
| Live preview | opaque-origin sandbox + L3 observer | 每个有 interaction 的 case 必须产生真实 interaction evidence |
| Code editing | HTML/CSS/JS editor + immutable version save | selection-directed refinement |
| Error visibility | runtime error 已持久化 | 增加用户可见 console/log view |
| Recent changes | version history、branch head、reflection | source diff/recent changes view |
| AI/data/image integration | `generative_ui` 可组合 MCP/web/image 输出与 deterministic simulation | 真实 provider/tool chain benchmark |
| Sharing | standalone HTML export | 明确公开分享的数据边界后再设计 public link |
| Safety | `allow-scripts` opaque origin、CSP network denied | 持续负路径与 payload 限制测试 |

## 评估纪律

- 不从空样本推断成功率。
- 不把普通 “Prefer UI” 按钮当成盲测。
- 盲测由外部 panel 只提交 Candidate A/B/Tie，facilitator mapping 与 evaluator 隔离。
- competitor observation 必须保留来源和观察日期；产品变化后重新验证。
- 达到代码门禁但未达到真实样本门槛时，Outer Loop decision 保持 `continue`。
