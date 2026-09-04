# Docs Index

`docs/` 只承载稳定设计文档，不作为运行时代码规则堆放区。修改产品边界、架构边界、跨层契约或验证策略时，先同步 `DESIGN.md`，再更新本目录。

## 分类

- `contracts/`：跨层稳定契约（runtime kernel、permissions、failure model）。
- `product/`：产品定位、scoped resources、垂直能力、[`acceptance-ledger.md`](product/acceptance-ledger.md)。
- `architecture/`：模块地图、数据流、实现向架构说明（指向 contracts，避免双轨权威）。
- `workflows/`：Debugger 主链与流程说明。
- `ui/`：Workbench、Design System、Knowledge Center。

## 推荐阅读顺序

1. `README.md`（仓库根）
2. `DESIGN.md`
3. `AGENTS.md`
4. `docs/contracts/runtime-kernel.md`
5. `docs/contracts/permissions.md`
6. `docs/contracts/failure-model.md`
7. `docs/architecture/overview.md` / `module-map.md`

涉及 UI 时读 `docs/ui/*`；涉及 Skills/Memory/Hooks 时读 `docs/product/scoped-runtime-resources.md`。
