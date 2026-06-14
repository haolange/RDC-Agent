# Debugger Mainchain Demo

本文档承接早期“正常全流程演示”，用于描述当前 Debugger 主链的标准执行路径。

## 标准路径

1. 用户在工作台中补齐项目、capture、设备和问题描述。
2. 系统完成 `preflight / entry_gate / speclist` 等前置检查。
3. `plan` 阶段产出结构化调查计划，并等待用户批准。
4. `dispatch / investigate / fix_verify / skeptic / curator` 严格按工作流主链推进。
5. 最终生成报告、证据链和运行记录。

## 演示关注点

- UI 中的会话、面板、控制栏和状态展示必须与真实主链一致。
- 运行中产生的计划、证据、摘要和报告都应能在工作台内回看。
- 若前置条件不满足，应先给出自然语言说明，再进入 blocker 或等待用户输入。

## 使用说明

- 该文档用于帮助开发者理解当前主链行为，不单独定义新的产品规则。
- 具体阶段约束与类型契约以 `docs/architecture/spec-driven-development.md` 和 `src/shared` 为准。
