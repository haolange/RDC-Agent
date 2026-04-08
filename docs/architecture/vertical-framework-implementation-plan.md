# Vertical Framework Implementation Plan

本文档承接早期“垂直框架设计初步设想”，保留其核心目标，但收敛为稳定实现主题。

## 目标

- 用 Electron 工作台承载 RenderDoc 调试主链，而不是做无边界的通用聊天壳。
- 把 `Debugger` 作为真实生产入口，`Analyzer` / `Optimizer` 作为后续模式扩展位。
- 让工作流、证据链、工具桥接和多 Agent 协作成为同一条可审计主链。

## 实现主轴

- Renderer 负责工作台、会话入口、状态展示和中间产物可视化。
- Main process 负责窗口、IPC、工作流编排、工具桥接和运行期目录管理。
- Shared 层负责跨层类型、常量和工具函数，不在单层重复定义共享契约。
- 运行期数据落在 `workspace root`，仓库本身只保留源码、文档、测试和资源。

## 当前约束

- Debugger 主链必须命中真实 `provider / model / route`。
- 缺少 capture、模型配置或运行前置条件时，应明确进入 blocker，而不是 silent fallback。
- 新增阶段、Agent 角色、IPC 事件或共享类型时，必须同步更新 `src/shared`、`src/main`、`src/preload` 和对应 renderer 页面。

## 后续维护

- 设计意图以当前仓库代码为准，不再保留“设想稿”和正式结构并存。
- 若后续架构继续演进，优先更新这里和 `docs/architecture/spec-driven-development.md`。
