# Docs Index

`docs/` 只承载稳定设计文档，不作为运行时代码规则堆放区。修改产品边界、架构边界、跨层契约或验证策略时，先同步 `ARCHITECTURE.md`，再更新本目录。

## 分类

- `contracts/`：跨层稳定契约（runtime kernel、permissions、failure model）。
- `product/`：[RenderDoc Agent 完整设计书](<product/RenderDoc Agent 完整设计书.md>)（领域目标权威）、scoped resources、Agent manifest、Provider 文档、[`acceptance-ledger.md`](product/acceptance-ledger.md)。
- `architecture/`：模块地图、数据流、实现向架构说明（指向 contracts，避免双轨权威）。
- `workflows/`：垂直调查收敛计划（当前执行计划）。
- `ui/`：Workbench、Design System、Knowledge Center。

## 推荐阅读顺序

1. `README.md`（仓库根）
2. `ARCHITECTURE.md`（工程）与 `DESIGN.md`（UI/UX）
3. [RenderDoc Agent 完整设计书](<product/RenderDoc Agent 完整设计书.md>)（领域目标）
4. `AGENTS.md`
5. `docs/contracts/runtime-kernel.md`
6. `docs/contracts/permissions.md`
7. `docs/contracts/failure-model.md`
8. `docs/architecture/overview.md` / `module-map.md`

涉及 UI 时读 `docs/ui/*`；涉及 Skills/Memory/Hooks 时读 `docs/product/scoped-runtime-resources.md`。
