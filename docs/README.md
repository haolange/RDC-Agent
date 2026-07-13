# Docs Index

`docs/` 只承载稳定设计文档，不作为运行时代码规则的堆放区。修改产品边界、架构边界、跨层契约或验证策略时，先同步 `DESIGN.md`，再更新本目录下的专题文档。

## 分类

- `product/`：产品定位、模式边界和用户可见能力。
- `architecture/`：架构设计、规范宪章、模块地图和数据流。
- `workflows/`：Debugger 主链、流程校验和执行演示。
- `ui/`：界面结构、设计系统和交互约定。

## 当前文档

- `product/vertical-debugger-overview.md`
- `architecture/overview.md`
- `architecture/data-flow.md`
- `architecture/module-map.md`
- `architecture/provider-architecture.md`
- `architecture/agent-runtime-kernel.md`
- `architecture/agentic-trace-protocol.md`
- `architecture/spec-driven-development.md`
- `architecture/codepilot-comparison.md`
- `workflows/debugger-mainchain-demo.md`
- `workflows/workflow-conformance-analysis.md`
- `ui/design-system.md`

## 推荐阅读顺序

后续 agent 进入本仓库时，优先阅读：

1. `README.md`
2. `DESIGN.md`
3. `AGENTS.md`
4. `docs/architecture/overview.md`
5. `docs/architecture/module-map.md`
6. `docs/architecture/data-flow.md`

如果任务涉及 provider、RDX CLI invoker 或浏览器真实会话，再阅读对应专题文档。
