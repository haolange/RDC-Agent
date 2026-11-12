# Product Docs

- [RenderDoc Agent 完整设计书](<RenderDoc Agent 完整设计书.md>)：理想架构的权威，写于产品实现之前；与当前产品的对应见[收敛计划](../workflows/vertical-investigation-convergence.md)第 8 节。

- `scoped-runtime-resources.md`：Scope、Profiles、Skills（含多 skill `∩` 语义）、Hooks、Memory、Project Instructions。
- `vertical-debugger-overview.md`：Debugger 作为真实主链的产品总览与设计边界。
- `renderdoc-agent-complete-design.md`：设计书的仓库化版本（v2），含调查记录 schema 与仓库裁决摘要。工程落地冲突以根目录 `ARCHITECTURE.md` 裁决。
- `acceptance-ledger.md`：Verifier 结论落盘（U00–U07 / T18）。Browser 证据在仓库外；`check:acceptance-ledger` 由 U04 接入 CI。
- Agentic Trace 的消息流产品语义以 `docs/architecture/agentic-trace-protocol.md`、`docs/ui/workbench-and-transcript.md` 与根目录 `ARCHITECTURE.md` 为准。
