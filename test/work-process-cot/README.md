# Agent CoT / Work Process 验收 HTML

静态高保真验收页，用于审视本库前端 Agent CoT（Work Process）的视觉与状态效果。**不接入 vitest/CI，不改动 `src/renderer`。**

视觉权威：`docs/ui/workbench-and-transcript.md`、`src/renderer/features/debugger/AgentChat/*`、`AGENTS.md` Work Process 条款。

## 打开方式

直接用浏览器打开：

```text
test/work-process-cot/index.html
```

或在本目录起一个静态服务：

```bash
npx --yes serve test/work-process-cot
```

顶栏支持：**播放 / 暂停 / 重播 / 跳到完成**、**ZH/EN**、**Light/Dark**，以及各场景页导航。

## 页面索引

| 页面 | 验收重点 |
| --- | --- |
| `index.html` | 伪执行时间轴：Working→thinking/commentary/tools/plan/compact→Work process + final |
| `scenarios/01-happy-path.html` | 完整一轮多族工具 + final |
| `scenarios/02-running-streaming.html` | 运行中 Active Signal、thinking 展开、streaming commentary |
| `scenarios/03-completed-collapsed.html` | 完成后 meta、thinking 默认折叠 |
| `scenarios/04-stopped.html` | 已停止顶栏，不回跳 Working |
| `scenarios/05-tool-families.html` | file/search/shell/git/web/generic(mcp) 与 catalog 主要动词 |
| `scenarios/06-tool-aggregate.html` | ≥8 连续工具自然语言聚合 |
| `scenarios/07-context-compact.html` | `Earlier work summarized`（无 token/消息计数） |
| `scenarios/08-plan-and-tasks.html` | 计划卡 + 已拒绝壳行 + 活的 Tasks 快照卡 |
| `scenarios/09-ask-user-approval.html` | ask_user Q/A + 审批行 |
| `scenarios/10-opaque-answer-only.html` | opaque/answer-only：无 CoT 占位 |
| `scenarios/11-error-recovery-absent.html` | 有意不出现 error_recovery 蓝字旁白 |
| `scenarios/12-markdown-surfaces.html` | commentary / final / thinking 均走 Markdown |

## 与产品规格对照

| 规格点 | Mock 落点 |
| --- | --- |
| 运行中「工作中 / Working」+ Active Signal | index / 02 |
| 完成后「工作过程 / Work process」+ duration · actions | index settle / 03 |
| Thinking Markdown；运行开 / 完成关 | index / 02 / 03 / 12 |
| Commentary MessageMarkdown，不进 thinking 槽 | index / 01 / 12 |
| 统一单披露 tool 卡，结果优先 body | 05 |
| web_search pills / web_fetch page chip | index / 05 |
| mcp → plug + generic | index / 05 |
| ≥8 聚合 | 06 |
| Compact 安静行 | 07 |
| Plan = 计划卡 + 壳行，不进 Right Rail | 08 |
| Tasks snapshot pending/in_progress/completed/blocked | 08 |
| opaque 零占位 | 10 |
| error_recovery 不进 WP | 11 |
| assistant full-bleed / user raised bubble | 全页 `.conversation-thread` |

## 保真审计

详见 [`FIDELITY-AUDIT.md`](FIDELITY-AUDIT.md)：阻塞级偏差（thinking 生命周期、ZH「持续」、mcp__*「已调用」、ask_user/Approval/Task 结构等）已对齐产品；Subagent 嵌套、KaTeX/Mermaid、Preparing Stop 等仍为有意简化。

## 迭代约定

1. 先在本目录改 HTML/CSS/文案，满意后再另开任务复刻进 renderer。
2. 类名尽量保持与产品一致（`.work-process-*`），方便对照。
3. Canvas 驾驶舱：`canvases/work-process-cot-acceptance.canvas.tsx`（场景矩阵，不是视觉替身）。

## 明确不做

- 不放进 `designs/`（hygiene 仅允许 `rdc-agent-design-system`）
- 不接入 Playwright / 默认 pack
- 不在本轮修改产品代码
