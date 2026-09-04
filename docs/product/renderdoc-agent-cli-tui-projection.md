# RenderDoc Agent CLI / TUI 投影附录

> 本文是 `renderdoc-agent-complete-design.md` 的 CLI/TUI 投影附录（draft）。
> 它不定义第二套 Agent 架构，也不是当前产品权威；权威边界以根目录 `DESIGN.md` 为准。
> 所有 Profile、Skill、Hook、Permission、Task、Sub-Agent、Handoff、RDX、Artifact 和 Knowledge 事实均来自与 Electron Workbench 相同的主进程与共享合同。

## 1. 目标

自研 TUI 必须保持本库的通用 Agent 形态，同时完整承载：

- General Execution Orchestrator；
- Debugger / Analyzer / Optimizer Planning Orchestrator；
- Mission -> General Handoff；
- Task、Sub-Agent、Tool、Artifact 与错误投影；
- 外部 RDX CLI Shell 调用；
- deferred Knowledge Browse/Search/Read/Compile/Candidate Tool、Knowledge Scout 与 Candidate Human Review；
- Default / Auto / FullAccess / Custom；
- 同一 Session 的继续、取消、压缩与恢复。

不为 TUI 新建第二套 Profile 注册表、Coordinator 状态机、RDX adapter、Task Store、Knowledge Index 或事件协议。

## 2. 共同事实源

| 事实 | 唯一来源 |
| --- | --- |
| Agent 身份与能力 | `.agent.md` |
| Coordinator 方法 | builtin/user/project `SKILL.md` |
| 确定性检查 | scoped `.hook.yml` |
| Permission | 同一 Permission Policy |
| Prompt | `PromptPlan -> RequestEnvelope -> provider adapter` |
| Task | TaskCreate/Update/Get/List/Stop |
| Sub-Agent | 单进程独立 Context |
| Handoff | `agent_handoff` 与 Handoff 事件 |
| RDX | 外部 CLI + ShellInvocationService |
| Work Process | 同一 Agent/Conversation/Trace 事件 |
| Artifact | 同一 Session Artifact Store |
| Knowledge | 同一 Query/Index/Compile/Candidate/Write Service、stable refs 与 index revision |

TUI 只消费这些事实并生成终端布局。

## 3. 启动与 Profile 选择

Profile 选择入口可以是现有 `--agent`、`/agents` 或等价命令，但语义只能是选择 Agent Profile。

```text
rdc-agent --agent debugger
```

不允许：

- `--agent plan` 隐式切换权限；
- 选择 Debugger 自动变成 FullAccess；
- 用 TUI 自己的枚举覆盖 `.agent.md`；
- 把 General 等同于无 Profile 的裸 Agent Loop。

Profile 列表顺序与桌面一致：

1. General
2. Debugger
3. Analyzer
4. Optimizer
5. 用户自定义且 `userInvocable:true` 的 Profile

## 4. 主界面

建议采用三段式终端布局：

```text
┌ RDC-Agent ─ Project: Demo ─ Session: capture-01 ─ RDX: ready ───────────────┐
│ Debugger · Default · Model Name · Context 18%                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ USER                                                                        │
│ 找出这帧光照错误的根因                                                      │
│                                                                             │
│ WORKING                                                                     │
│ ● 正在规划调查                                                              │
│   ✓ 读取 capture/runtime 上下文                                              │
│   ✓ 查询 rdx replay help                                                    │
│   ✓ 保存计划  debugger-plan.md                                              │
│   ↳ Debugger → General                                                      │
│                                                                             │
│ GENERAL · EXECUTING                                                         │
│   ◐ 定位首个异常事件                                                        │
│   $ rdx ...                                                                 │
│   artifact  evidence/first-bad-event.json                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ > 输入消息…                                                                 │
│ [General] [Default] [Effort: High]                               [Stop/Send] │
└─────────────────────────────────────────────────────────────────────────────┘
```

窄终端按顺序降级：

1. 隐藏非关键 header 字段；
2. Artifact 只显示 basename；
3. Tool 结果保持一行摘要；
4. 详情通过展开或命令进入；
5. 不水平滚动整个 Transcript。

## 5. Work Process 文本投影

### 5.1 基本规则

- 只渲染真实事件。
- 不预制固定 Investigation Stage。
- 运行中显示 active signal。
- 完成后默认折叠 Work Process。
- Thinking、Commentary、Tool、Task、Sub-Agent、Handoff 语义分开。
- Final 只来自 canonical final output。

### 5.2 Task

```text
Tasks  2/4
  ✓ 读取 capture facts
  ◐ 定位首个异常事件
  ○ 验证反事实
  ! 生成根因报告  blocked by 定位首个异常事件
```

交互：

- `/tasks` 展开完整列表；
- `/task <id>` 查看详情；
- 选择 Task 可跳转到相关 Work Process 事件；
- 不显示 Task 的 RenderDoc 专用字段，因为它们不存在。

### 5.3 Tool

完成态结果优先：

```text
✓ Shell · 读取 327 个 events · 1.8s
  result: artifacts/capture/events.json
```

展开态：

```text
command
  rdx ...
stdout
  ...
stderr
  ...
exit
  0
```

连续同族调用达到聚合阈值时：

```text
✓ Shell · 12 次 RDX 查询 · 2 artifacts · 18.4s
```

TUI 不增加 194 种 RDX Tool 行。它们都是 Shell。

Knowledge Tool 仍使用统一 Tool 行，但提供 outcome-first family projection：

```text
✓ Knowledge Search · 12 results · project/effective · lexical+structural
  refs: pattern:deferred-lighting-pass-signature, case:driver-552
✓ Knowledge Compile · 18 refs · 3 conflicts · 7.2K tokens
  pack: artifacts/knowledge/debug-plan-pack.md
```

展开后显示 filters、match reasons、lane availability、index revision、预算、截断和 stable refs；Raw 不默认展开，也不复制完整 Card 正文。

### 5.4 Sub-Agent

```text
▸ Sub-Agent · General · skeptic-review
  status: complete
  challenged: 2 claims
  artifact: skeptic/review.md
```

Knowledge Scout 使用同一披露：

```text
▸ Sub-Agent · Knowledge Scout · project model history
  status: complete
  cited: 18 · conflicts: 3 · unresolved: 1
  brief: knowledge/project-history-brief.md
  pack: knowledge/project-history-pack.md
```

展开后显示子 Context 的 Tool/Artifact 摘要和终态诊断，不展开完整子对话。父 Context 仍是唯一主线，并负责最终采用、拒绝或降权 Knowledge。

### 5.5 Handoff

```text
↳ Debugger → General
  plan: debugger-plan.md
  armed: renderdoc-execution, rdx-cli-shell, debugger-execution
```

发生 Handoff 后：

- header active Profile 更新；
- composer Profile 更新；
- 后续事件归属 General；
- Permission 不改变；
- Session 不拆分；
- 不显示“进入执行模式”。

## 6. Composer

单行或多行 Composer 应至少显示：

- active Profile；
- Permission；
- Effort；
- Context 使用；
- Send/Stop。

推荐快捷操作：

| 操作 | 行为 |
| --- | --- |
| Profile picker | 选择 `.agent.md` Profile |
| Permission picker | Default/Auto/FullAccess/Custom |
| `$skill` completion | 武装当前 Session/Turn Skill |
| `/agents` | Profile 列表和当前 route |
| `/skills` | Progressive Skill 列表 |
| `/tasks` | 当前 Task |
| `/artifacts` | 当前 Session Artifact |
| `/knowledge` | Knowledge Browse/Search/Read/Compile/Status/Authoring/Candidate Review 入口 |
| `/status` | Project/Session/RDX/Provider 摘要 |
| `Ctrl+C` | 第一次停止当前 turn，空闲时按既有退出规则 |

Profile picker 与 Permission picker 必须是两个独立控件。

## 7. RDX CLI

### 7.1 Agent 调用

Agent 像人类一样使用 Shell：

```text
$ rdx --help
$ rdx <group> --help
$ rdx <group> <command> ...
```

不得：

- 将 Catalog 展开进 Provider tools；
- 建立 `rdx:<tool>` TUI command；
- 为每个命令创建 slash command；
- 通过 TUI renderer 绕过 ShellInvocationService；
- 使用仓库内 RDX 副本或 MCP fallback。

### 7.2 人类终端

如果 TUI 支持用户直接打开 Shell，直接输入的 `rdx` 与 Agent `shell` 应共享：

- Settings command；
- cwd；
- environment；
- runtime context；
- cancellation；
- Trace；
- Secret 边界。

人类 Shell 和 Agent Shell 的权限来源可以不同，但不能走两套 RDX 安装发现逻辑。

### 7.3 长输出

- 屏幕只显示摘要；
- Raw 写 Session Artifact；
- 提供 `open/copy/path` 动作；
- 终端支持时用 OSC 8 链接，否则输出普通路径；
- JSON 不默认整屏打印。

## 8. Knowledge

### 8.1 单一事实源

TUI 的 Knowledge 是桌面 Knowledge Center 和 Agent Knowledge Tool 的文本投影。三者共用：

```text
KnowledgeQueryService
KnowledgeIndexService
KnowledgeCompileService
KnowledgeCandidateService
KnowledgeWriteService
```

它们必须返回相同 stable Knowledge ref、effective/overridden provenance、source hash、index revision、lane availability、budget/truncation 和诊断。TUI 不建立自己的文件扫描器、ranking、embedding、index、Candidate Store 或写入路径。

### 8.2 Agent Tool 与 Knowledge Scout

Agent 在 TUI 会话里使用的仍是 Provider Tool：

```text
knowledge_browse
knowledge_search
knowledge_read
knowledge_compile
knowledge_candidate_create
```

五者均为 `extended/deferred`，不因打开 TUI 或 `/knowledge` 面板就注入 Provider schema。小型确定性 lookup 可由 Planning Orchestrator/General 直接调用；重检索、冲突综合、Similar Case 消歧和历史演化默认委托 `$knowledge-scout` 独立 Context。父级只接收 Brief/Pack Artifact 和引用，不接收完整子 transcript。

Agent Tool、Sub-Agent、Pack/Candidate 都从共享 runtime 产生真实 Work Process/Artifact 事件；TUI 不根据输出文本猜测“正在检索知识”。

### 8.3 人类命令

建议命令：

```text
/knowledge browse [effective|user|project|all] [path-prefix]
/knowledge search <query> [--scope effective|user|project|all]
                           [--type pattern,case,...]
                           [--status verified,conflict,...]
                           [--lane lexical,structural,semantic,relation]
/knowledge show <stable-ref>
/knowledge compile <goal> [--scope ...] [--budget <tokens>]
/knowledge status
/knowledge rebuild [--scope user|project|all]
/knowledge candidates
/knowledge new --scope user|project
/knowledge edit <stable-ref>
/knowledge specialize <stable-ref> --project <project-id>
/knowledge import <path> --scope user|project
/knowledge merge <source-ref> --into <target-ref>
/knowledge deprecate <stable-ref>
/knowledge history <stable-ref>
```

这些是人类产品命令，直接调用同一 bounded main service；它们不是对 Agent Tool 的文本模拟，也不扩大 active Profile 的 Tool ceiling。`/knowledge compile` 创建 Session Pack Artifact，不修改正式 Knowledge。New/Edit/Specialize/Import/Merge/Deprecate 经 `KnowledgeWriteService`，先显示 target、diff、stable id、change reason、version、conflict 和 rollback basis，再无限等待用户明确确认；它们不是可供 LLM 自治调用的 Tool。`/knowledge rebuild` 只重建派生索引，不修改 canonical Markdown；`/knowledge status` 显示：

```text
Index revision: kidx-20260723-42 · ready
Sources: user 148 · project 63 · stale 0 · invalid 2
Lanes: identity ready · lexical ready · structural ready
       semantic unavailable (no approved backend) · relation ready · temporal ready
```

Search 列表必须显示 match reason，而不是只有不透明 score：

```text
12 results · project/effective · index kidx-20260723-42
  1. Deferred lighting pass signature
     pattern · verified · structural:pass-signature + lexical:"deferred lighting"
     ref pattern:deferred-lighting-pass-signature
  2. Driver 552 false positive
     case · conflict · relation:conflicts-with + temporal:driver-552
     ref case:driver-552-false-positive
```

规则：

- Browse/Search 默认 12 条、server hard cap 50，通过 cursor 分页；
- Show/Read 按 token budget 返回，截断必须显示 continuation；
- 六 lane 无语义检索轴；不得把不可用的语义检索标成已完成“智能搜索”；
- 结果过长写 Session Artifact，屏幕只保留摘要、引用和诊断；
- `/knowledge` 命令不得把结果自动写进 Prompt 或复制到所有后续 turn；
- 人类直接 Compile 与 Agent Compile 共享预算、Pack 格式和 Usage Trace；
- Import 只接受受控文件输入，先解析和冲突预览；取消或校验失败时不写 canonical Markdown、不发布新 index revision；
- 人类直接创作与 Candidate Promotion 共用同一 `KnowledgeWriteService` 和确认合同，不形成 TUI 专属写路径。

New/Edit/Specialize 不把正文塞进 composer 单行参数，而是打开可返回的 Authoring View：左侧为 scope、stable id、type/status/relations 与 change reason，右侧为 Markdown Preview 和 source/conflict/history；窄终端按 Form -> Preview -> Confirm 分步呈现。保存前固定进入 Diff/Conflict/Version 确认，取消返回时保留本次 Session Draft，但不写正式 Knowledge。

### 8.4 Candidate 审阅

```text
Candidate: Deferred lighting pass signature
Target: project/rendering/deferred-lighting.md
Status: conflict
Sources: 4 artifacts · 7 knowledge refs
Version: new -> proposed v3
Rollback basis: v2 / hash 91a...

[v] view diff  [s] sources  [c] conflicts  [r] revise  [p] promote  [x] reject
```

规则：

- `knowledge_candidate_create` 和“生成候选”只创建 Session Candidate；
- Promote/Update/Merge/Deprecate 不是普通 LLM Tool；
- 持久动作必须显示 scope、path、diff、source、version、conflict、change reason 和 rollback basis；
- 必须等待用户明确选择，不支持超时自动 Promote；
- `FullAccess`、Profile、Skill、Sub-Agent 或 Agent 自述不能代替确认；
- 失败时 canonical Markdown 与 index revision 均保持不变；
- 不建立 TUI 专属 Knowledge 数据库。

## 9. Settings 与资源

TUI 可以提供文本编辑或跳转到文件，但必须遵守相同 scoped resource：

```text
~/.rdx/agents
~/.rdx/skills
~/.rdx/hooks
~/.rdx/policies
~/.rdx/knowledge
~/.rdx/memory

<project-root>/.rdx/...
```

Project Hook 的 trust/revoke/test 仍基于内容 hash。Project Scope 不能覆盖本机 RDX secret/action。

TUI 不增加可配置 workspace root，不恢复旧目录 fallback。

## 10. Error、Stop 与恢复

错误必须标注来源：

```text
PROVIDER   request failed
POLICY     shell denied
HOOK       mission-plan-handoff-check blocked
SHELL      exit 2
RDX        context stale
ARTIFACT   hash mismatch
KNOWLEDGE  target conflict
```

Stop：

- 中止当前 Provider turn；
- 中止正在运行的 Shell/RDX；
- 更新运行中 Task；
- 保留已完成 Trace/Artifact；
- 不把停止合成为成功 Final。

Resume：

- 恢复同一 Session；
- active Profile 使用最后一次已应用 Handoff；
- Task 和 Artifact 从持久状态恢复；
- Sub-Agent 内存 Task 不伪装成已持久化；
- Knowledge Pack/Candidate 重新验证 source hashes 与 index revision，过期显示 stale，不自动注入；
- RDX Context 必须重新验证，不能假设 daemon 状态仍有效。

## 11. Token 与上下文

- TUI 不维护第二份 Prompt。
- General 普通 turn 不加载 RenderDoc Skill。
- Mission Handoff 的 `$skill` 在 General 首轮预加载。
- Skill catalog 只注入短索引。
- `knowledge_*` schema 全部 deferred；打开 `/knowledge` UI 不激活 Provider Tool。
- Browse/Search 只返回 bounded summaries 和 stable refs；Read/Compile 受同一 Knowledge Budget Policy 约束。
- 重检索由 Knowledge Scout 独立 Context 消费，父级只接收不超过合同预算的 Brief/Pack refs。
- RDX help 定向读取。
- 长 Raw 输出和完整 Knowledge Pack 转 Artifact。
- `/compact` 或自动压缩使用同一 Structured Context/Handoff 路径。
- 不把 TUI 屏幕文本、Search 列表或 Candidate Review 反向复制为新的 Prompt Source。

## 12. 视觉与终端能力降级

颜色只用于：

- active Profile；
- running/success/warning/error；
- focus/selection。

必须同时有文字或符号，不能只靠颜色。

支持：

- truecolor；
- 256 color；
- no-color；
- reduced motion；
- 非 Unicode fallback。

例如 Unicode 不可用时：

```text
[DONE] task
[RUN ] task
[WAIT] task
[ERR ] task
[->  ] Debugger -> General
```

## 13. 共享事件映射

| 共享事件 | TUI |
| --- | --- |
| thinking delta/end | Thinking 区 |
| commentary | Markdown/plain 文本 |
| tool started/completed/denied | Tool 行 |
| task created/updated | Task 树 |
| subagent started/delta/completed | Sub-Agent 披露 |
| handoff requested/applied | 控制转移行 + active Profile |
| artifact ready/failed | Artifact 行；Pack/Candidate 保留 kind、ref、hash、freshness |
| knowledge index changed/stale/failed | `/knowledge status` 与当前列表状态；不伪装成聊天文本 |
| permission request | 同一审批控件 |
| final answer | Final 区 |

TUI 不根据文本关键词猜测事件类型。

## 14. 验收

必须覆盖：

1. General 普通非 RenderDoc 任务。
2. 三个 Mission 各自 Plan。
3. Mission -> General Handoff。
4. Handoff 后 Permission 不变。
5. Task 创建、阻塞、完成。
6. Sub-Agent 独立 Context 和父级返回。
7. 小型 Knowledge lookup 直接 Tool，不产生无意义 Scout。
8. 重 Knowledge Retrieval 派发 Scout，父级只收到 Brief/Pack refs。
9. Browse/Search/Show/Compile/Status 与 Agent Tool 返回相同 stable refs/index revision/provenance。
10. Identity/Path、Scope/Metadata、Lexical、Structural、Relation/Graph、Temporal/Version 六 lane 状态、match reason、stale 和分页/截断。无语义检索轴。
11. Candidate Create 只写 Session Artifact。
12. Candidate 明确 Promote/Reject，FullAccess 不绕过，未回答不自动选择。
13. Session Resume 后 Pack/Candidate freshness 和 RDX Context 重新校验。
14. RDX 定向 help、成功、失败、取消。
15. 长输出 Artifact。
16. 80/120/160 列宽。
17. truecolor/256/no-color。
18. Windows 中文路径和长文件名。
19. Desktop/TUI/Agent Knowledge 同源一致性。
20. New/Edit/Specialize/Import/Merge/Deprecate 共用 Session Draft、Diff/Conflict/Version/Change Reason/Rollback 确认；取消和失败不改 canonical Markdown/index revision。
21. Rebuild 只更新派生索引，成功原子发布 revision，失败保留 last-known-good 并显示 stale/failed。
22. 80/120/160 列下 Authoring View 的 Form/Preview/Confirm 路径均可达，无横向信息丢失。
23. no TodoWrite、no MCP RDX、no 194 tool schemas、no fixed stage、no TUI Knowledge index、no autonomous Promote。

## 15. 实现约束

- 不恢复仓库根 `cli/` 独立入口。
- 复用现有命令注册、主进程服务与 shared types。
- 不在 TUI 包中复制 Agent Runtime。
- 不为 TUI 新建 IPC 风格的本地桥接层。
- 不创建 TUI 专属 Profile 字段。
- 不创建 TUI 专属 Artifact/Knowledge Store、resolver、ranking、embedding 或 index。
- 不让 `/knowledge` 命令绕过 main service、scope、budget、Policy 或 Human Review。
- 不用终端截图或假数据替代真实 Session 验收。

完成后的正确关系是：

```text
Electron Workbench ─┐
Self-developed TUI ─┼─ shared Agent/Profile/Runtime/Trace/Artifact facts
Agent Knowledge Tool┘                         │
                                             └─ one main Knowledge service/index
```

Desktop、TUI 和 Agent 可以有不同的信息密度和交互形式，但不能有不同的产品语义、stable ref、index revision、scope precedence 或持久写入边界。
