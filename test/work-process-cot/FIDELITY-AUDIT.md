# CoT Mock ↔ 本库 Work Process 保真审计

对照基准：`test/work-process-cot/**` vs `src/renderer/features/debugger/AgentChat/*`、`AgentChat.css`、`i18n.ts`、`docs/ui/workbench-and-transcript.md`。

审计后已修复阻塞级偏差；下列为当前结论。

## 已对齐（验收可用）

| 表面 | 对齐点 |
| --- | --- |
| 顶栏 | Running=`工作中`+Active Signal；Complete=`工作过程`；Stopped=`已停止`；caret 用 CSS order 落在末尾 |
| ZH meta | `持续 {duration} · {n} 个动作`（`chat.workProcessDuration`） |
| Thinking 生命周期 | section running/pending → 标签「正在思考」+ 默认展开 + Active Signal（即使 thinkingStatus 已 complete） |
| Thinking sticky open | completed 时尊重 `open: true`（场景 12） |
| Thinking caret | CSS triangle `.work-process-row-caret` |
| Commentary / Final / Thinking | 均走 Markdown 槽；thinking 包 `.markdown-body` |
| Tool 卡 | 单披露；六族；结果优先；running 显示「进行中」；file Copy；Raw=参数/返回值 |
| mcp__* | 「已调用 MCP」；裸名 `mcp` 仍为「已查询 MCP」 |
| web | search=域名 pills；fetch=title summary + destination chip |
| 聚合 | ≥8 自然语言摘要；triangle caret |
| Compact | `Earlier work summarized`，无计数 |
| Plan | `plan_artifact` 工具卡；不 pin plan.md |
| TaskRow | 叙事流 standalone；grid 布局；completed 删除线；cancelled 态 |
| ask_user | `{verb} · {count}`；`0/2`；caret；无 header icon；待答「等待回答」 |
| Approval | 扁平 ApprovalRow「等待审批」+ 工具卡内 `.work-process-tool-approval` |
| Opaque | `kind=opaque` / `visibility=hidden` 不渲染占位 |
| error_recovery | 场景 11 有意缺席 |
| 间距 | section-list 顶距 `--space-3`；兄弟 tool `--space-2`；list 内 rail 隐藏 |

## 仍可接受的简化（非产品复刻阻塞）

1. **SubagentRow 嵌套 WP**：场景 05 未把 `subagent` 画成嵌套子过程（产品有 `SubagentRow`）；catalog 动词卡可对照，嵌套结构未 mock。
2. **多 loop section 邻接**：CSS 规则在，无双 section 样例数据。
3. **thinking `unknown` / 收束摘要「收束摘要」**：渲染支持 `closing`，无独立场景页。
4. **DiagnosticRow 独立诊断行**：渲染有最小形态，无丰富样例。
5. **KaTeX / Mermaid fail-closed**：场景 12 仅 GFM。
6. **Preparing Stop 干净撤销**：仅有 Running→Stopped（04）。
7. **Favicon**：一律 monogram，无 `web:resolveFavicon` data URL。
8. **Composer ask_user wizard**：WP 只验 transcript，答题在 Composer（产品另一表面）。
9. **静态伪执行**：无真实 IPC/trace 投影。

## 验证方式

浏览器打开 `test/work-process-cot/index.html`，重点抽查：

- 跳到完成 → meta 含「持续」；thinking 折叠为「已思考 ·」
- 场景 02 → 运行中仍「正在思考」展开扫光
- 场景 05 → `mcp__*`「已调用 MCP」；`web_fetch` 有 title
- 场景 08 → Task 在 WP 步骤列表顶层，completed 有删除线
- 场景 09 → ask_user `等待用户 · 2` + `0/2`；扁平「等待审批」；工具卡内审批条
- 场景 12 → thinking 展开可见渲染后的粗体 / 行内代码 / 标题
