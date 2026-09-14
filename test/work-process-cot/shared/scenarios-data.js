(function (global) {
  function userPrompt(zh, en) {
    return CotI18n.getLocale() === 'en' ? en : zh;
  }

  function models() {
    const en = CotI18n.getLocale() === 'en';
    return {
      '01': {
        note: en
          ? 'Full happy path: thinking → commentary → mixed tools → final answer.'
          : '完整一轮：thinking → commentary → 多族 tools → final answer。',
        user: userPrompt('梳理 Work Process 工具卡族模板。', 'Survey Work Process tool-card family templates.'),
        wp: {
          status: 'complete',
          duration: '24s',
          actionCount: 7,
          sections: [{
            status: 'complete',
            thinking: {
              kind: 'raw',
              status: 'complete',
              open: false,
              duration: '5s',
              preview: en
                ? 'Cover file/search/shell/git/web/generic, then close with a short final.'
                : '覆盖 file/search/shell/git/web/generic，再给简短 final。',
            },
            prose: {
              html: en
                ? '<p>I will walk each family once, keeping result-first bodies.</p>'
                : '<p>我会逐族各走一遍，保持结果优先 body。</p>',
            },
            items: [
              { type: 'tool', tool: { name: 'read_file', path: 'docs/ui/workbench-and-transcript.md' } },
              { type: 'tool', tool: { name: 'grep', summary: en ? '9 matches · 2 files' : '9 处匹配 · 2 个文件', samples: ['AgentChat.css:1163', 'WorkProcess.tsx:42'] } },
              { type: 'tool', tool: { name: 'bash', command: 'pnpm run check:work-process', expandable: true, stdout: 'OK', rawArgs: '{"ok":true}', rawResult: 'OK' } },
              { type: 'tool', tool: { name: 'git_status', command: 'git status -sb' } },
              { type: 'tool', tool: { name: 'web_search', summary: en ? '2 sources' : '2 个来源', sources: [{ domain: 'github.com', title: 'Spec' }, { domain: 'renderdoc.org', title: 'Docs' }] } },
              { type: 'tool', tool: { name: 'mcp__git__status', body: 'mcp · git/status · clean' } },
            ],
          }],
        },
        final: en
          ? '<p>All six families render as a single disclosure card; MCP uses the plug glyph on the generic family.</p>'
          : '<p>六族均统一为单披露工具卡；MCP 使用 plug 图标并落在 generic 族。</p>',
      },
      '02': {
        note: en
          ? 'Running: Working + Active Signal; even after thinking text exists, live loop keeps「Thinking」open + shimmer (not settled Thought).'
          : '运行中：Working + Active Signal；loop 未结束时即使已有 thinking 文本，仍保持「正在思考」展开扫光（不是已思考折叠）。',
        user: userPrompt('继续分析 capture 打开失败。', 'Keep analyzing the capture open failure.'),
        wp: {
          status: 'running',
          sections: [{
            status: 'running',
            thinking: {
              kind: 'raw',
              status: 'complete', // text settled, but section still running → still「正在思考」
              preview: en
                ? 'Shell action failed closed — need owner session lease before retry.'
                : 'Shell action fail-closed —— 重试前先确认 owner session lease。',
            },
            prose: {
              html: en ? '<p>Checking the configured RDX shell action next…</p>' : '<p>下一步检查已配置的 RDX shell action…</p>',
              streaming: true,
            },
            items: [
              { type: 'tool', tool: { name: 'rdx_context', status: 'running', body: en ? 'Reading session lease…' : '正在读取 session lease…' } },
              { type: 'tool', tool: { name: 'bash', status: 'complete', command: 'echo $RDX_ACTION' } },
              { type: 'tool', tool: { name: 'grep', status: 'running', pattern: 'legacyGlobalMirror' } },
            ],
          }],
        },
      },
      '03': {
        note: en
          ? 'Completed: Work process +「持续 {duration}」meta; thinking collapsed by default; no Active Signal on headline.'
          : '完成后：Work process +「持续 {duration}」meta；thinking 默认折叠；顶栏无 Active Signal。',
        user: userPrompt('总结刚才的诊断。', 'Summarize the diagnosis.'),
        wp: {
          status: 'complete',
          duration: '12s',
          actionCount: 3,
          sections: [{
            status: 'complete',
            thinking: {
              kind: 'summary',
              status: 'complete',
              open: false,
              duration: '3s',
              preview: en
                ? 'Root cause was a stale remoteId; cleared and reopened.'
                : '根因是过期 remoteId；已清理并重新打开。',
            },
            prose: {
              html: en ? '<p>Diagnosis complete. Capture is open under the owning session.</p>' : '<p>诊断完成。Capture 已在归属 session 下打开。</p>',
            },
            items: [
              { type: 'tool', tool: { name: 'edit_file', path: 'session/runtime.json' } },
              { type: 'tool', tool: { name: 'output_register', body: 'reports/diagnosis.md' } },
            ],
          }],
        },
        final: en
          ? '<p>Open succeeded after clearing the stale remote lease.</p>'
          : '<p>清理过期 remote lease 后，打开已成功。</p>',
      },
      '04': {
        note: en
          ? 'Stopped after Running Stop: headline becomes Stopped; does not bounce back to Working.'
          : 'Running 后 Stop：顶栏变为「已停止」，不再回跳 Working。',
        user: userPrompt('先扫一遍整个仓库。', 'Scan the whole repository first.'),
        wp: {
          status: 'stopped',
          duration: '6s',
          actionCount: 2,
          sections: [{
            status: 'complete',
            thinking: {
              kind: 'raw',
              status: 'complete',
              open: false,
              duration: '2s',
              preview: en ? 'User stopped before glob finished.' : '用户在 glob 完成前停止。',
            },
            items: [
              { type: 'tool', tool: { name: 'glob', status: 'complete', summary: en ? 'Partial listing' : '部分列表', samples: ['src/main/**', 'src/renderer/**'] } },
            ],
          }],
        },
        final: en ? '<p>Request stopped.</p>' : '<p>请求已停止。</p>',
      },
      '05': {
        note: en
          ? 'Tool family gallery: file / search / shell / git / web / generic(mcp__) + catalog verbs. mcp__* uses「Called MCP」not「Queried」.'
          : '工具族画廊：file/search/shell/git/web/generic(mcp__) + catalog 动词。mcp__* 用「已调用 MCP」不是「已查询」。',
        user: userPrompt('展示全部工具族卡片。', 'Show every tool-family card.'),
        wp: {
          status: 'complete',
          duration: '40s',
          actionCount: 32,
          sections: [{
            status: 'complete',
            thinking: {
              kind: 'raw',
              status: 'complete',
              open: false,
              duration: '1s',
              preview: en ? 'Static catalog gallery for acceptance.' : '静态目录画廊，用于验收。',
            },
            items: [
              { type: 'tool', tool: { name: 'read_file', path: 'src/shared/types/settings.ts' } },
              { type: 'tool', tool: { name: 'write_file', path: 'notes/draft.md' } },
              { type: 'tool', tool: { name: 'edit_file', path: 'src/renderer/App.tsx' } },
              { type: 'tool', tool: { name: 'delete_file', path: 'tmp/scratch.txt' } },
              { type: 'tool', tool: { name: 'move_file', path: 'a.ts → b.ts' } },
              { type: 'tool', tool: { name: 'copy_file', path: 'fixture.json → fixture.copy.json' } },
              { type: 'tool', tool: { name: 'notebook_edit', path: 'analysis.ipynb' } },
              { type: 'tool', tool: { name: 'glob', summary: '42 files', samples: ['**/*.rdc', '**/captures/**'] } },
              { type: 'tool', tool: { name: 'grep', summary: en ? '12 matches · 3 files' : '12 处匹配 · 3 个文件', samples: ['WorkProcess.tsx:12'] } },
              { type: 'tool', tool: { name: 'bash', command: 'pnpm run typecheck', expandable: true, stdout: 'Done', rawArgs: '{}', rawResult: 'Done' } },
              { type: 'tool', tool: { name: 'git_status', command: 'git status -sb' } },
              { type: 'tool', tool: { name: 'git_diff', command: 'git diff --stat' } },
              { type: 'tool', tool: { name: 'git_log', command: 'git log -5 --oneline' } },
              { type: 'tool', tool: { name: 'git_add', command: 'git add -A' } },
              { type: 'tool', tool: { name: 'git_unstage', command: 'git restore --staged .' } },
              { type: 'tool', tool: { name: 'git_commit', command: 'git commit -m "msg"' } },
              { type: 'tool', tool: { name: 'web_search', summary: en ? '3 sources' : '3 个来源', sources: [{ domain: 'developer.mozilla.org', title: 'MDN' }, { domain: 'web.dev', title: 'web.dev' }, { domain: 'caniuse.com', title: 'Can I use' }] } },
              { type: 'tool', tool: { name: 'web_fetch', page: { domain: 'docs.renderdoc.org', title: 'RenderDoc docs' } } },
              { type: 'tool', tool: { name: 'mcp__browser__snapshot', body: 'mcp · browser/snapshot' } },
              { type: 'tool', tool: { name: 'mcp', body: en ? 'MCP server list' : 'MCP 服务列表' } },
              { type: 'tool', tool: { name: 'skills', body: en ? '12 skills' : '12 个技能' } },
              { type: 'tool', tool: { name: 'skill_read', body: 'work-process-review' } },
              { type: 'tool', tool: { name: 'memory_search', body: en ? '2 memories' : '2 条记忆' } },
              { type: 'tool', tool: { name: 'memory_read', body: 'memory/capture-lease.md' } },
              { type: 'tool', tool: { name: 'memory_write', body: 'memory/note.md' } },
              { type: 'tool', tool: { name: 'memory_delete', body: 'memory/stale.md' } },
              { type: 'tool', tool: { name: 'rdx_context', body: 'ownerSession=sess_1' } },
              { type: 'tool', tool: { name: 'tool_search', body: 'plan_artifact' } },
              { type: 'tool', tool: { name: 'task_create', body: 'task-1' } },
              { type: 'tool', tool: { name: 'task_update', body: 'task-1' } },
              { type: 'tool', tool: { name: 'task_get', body: 'task-1' } },
              { type: 'tool', tool: { name: 'task_list', body: '3 tasks' } },
              { type: 'tool', tool: { name: 'task_stop', body: 'task-2' } },
              { type: 'tool', tool: { name: 'agent_handoff', body: 'Debugger → Analyzer' } },
              { type: 'tool', tool: { name: 'plan_artifact', verb: en ? 'Updated plan · Rejected' : '已更新计划 · 已拒绝', body: en ? 'Add the reproduction steps.' : '请补上复现条件。' } },
              { type: 'tool', tool: { name: 'output_register', body: 'outputs/report.md' } },
            ],
          }],
        },
      },
      '06': {
        note: en
          ? '≥8 consecutive tools collapse into a natural-language aggregate summary.'
          : '≥8 连续工具聚合成自然语言摘要行；展开可看原始卡片。',
        user: userPrompt('批量读取相关文件。', 'Batch-read related files.'),
        wp: {
          status: 'complete',
          duration: '15s',
          actionCount: 9,
          sections: [{
            status: 'complete',
            thinking: {
              kind: 'raw',
              status: 'complete',
              open: false,
              duration: '2s',
              preview: en ? 'Eight reads in a row should aggregate.' : '连续八次读取应聚合。',
            },
            items: [{
              type: 'aggregate',
              text: CotI18n.t('aggregateRead', { n: 8 }),
              tools: [
                { name: 'read_file', path: 'WorkProcess.tsx' },
                { name: 'read_file', path: 'WorkProcessSectionRow.tsx' },
                { name: 'read_file', path: 'WorkProcessRowParts.tsx' },
                { name: 'read_file', path: 'WorkProcessToolCardParts.tsx' },
                { name: 'read_file', path: 'workProcessPresentation.ts' },
                { name: 'read_file', path: 'workProcessToolCatalog.ts' },
                { name: 'read_file', path: 'workProcessToolAggregate.ts' },
                { name: 'read_file', path: 'AgentChat.css' },
              ],
            }, {
              type: 'tool',
              tool: { name: 'bash', command: 'pnpm run check:work-process-tool-coverage' },
            }],
          }],
        },
        final: en
          ? '<p>Aggregation threshold remains 8; commentary/thinking boundaries cut consecutive runs.</p>'
          : '<p>聚合阈值仍为 8；commentary/thinking 边界会切断连续段。</p>',
      },
      '07': {
        note: en
          ? 'Compaction projects only the quiet line “Earlier work summarized” — no token/message counts.'
          : '压缩在 WP 中只显示安静行 Earlier work summarized，不展示 token/消息计数。',
        user: userPrompt('在长会话里继续。', 'Continue in a long session.'),
        wp: {
          status: 'complete',
          duration: '9s',
          actionCount: 2,
          extras: [{ type: 'summary', text: CotI18n.t('compact') }],
          sections: [{
            status: 'complete',
            thinking: {
              kind: 'raw',
              status: 'complete',
              open: false,
              duration: '2s',
              preview: en
                ? 'History was compacted before this turn; keep the summary quiet.'
                : '本轮前历史已压缩；summary 保持安静。',
            },
            prose: {
              html: en
                ? '<p>Continuing from the compacted view.</p>'
                : '<p>从压缩后的视图继续。</p>',
            },
            items: [
              { type: 'tool', tool: { name: 'memory_read', body: 'session-brief.md' } },
            ],
          }],
        },
        final: en
          ? '<p>No “79 → 52 messages” copy appears in Work Process.</p>'
          : '<p>Work Process 中不应出现「79 → 52 messages」类计数文案。</p>',
      },
      '08': {
        note: en
          ? 'Plan = plan review card plus a superseded/rejected shell row; Tasks use one live snapshot card.'
          : 'Plan = 计划卡 + 已拒绝壳行；Tasks 用一张活的快照卡。',
        user: userPrompt('先出计划再执行。', 'Create a plan, then execute.'),
        wp: {
          status: 'complete',
          duration: '21s',
          actionCount: 5,
          sections: [{
            status: 'complete',
            thinking: {
              kind: 'raw',
              status: 'complete',
              open: false,
              duration: '4s',
              preview: en ? 'Submit the live plan for review, then drive tasks from TaskRegistry.' : '用 plan_artifact 提交当前计划审阅，再用 TaskRegistry 驱动任务。',
            },
            prose: {
              html: en
                ? '<p>Current plan is awaiting review. The previous revision is a rejected shell row. Tasks below are one live snapshot card (Progress rail shares taskProjection).</p>'
                : '<p>当前计划待审阅。上一版已拒绝为壳行。下方是一张活的任务快照卡（与 Progress 轨共用 taskProjection）。</p>',
            },
            items: [
              {
                type: 'planReview',
                plan: {
                  title: en ? 'Import then diagnose' : '导入后再诊断',
                  status: 'awaiting',
                  revision: 2,
                  uri: 'session://plans/plan.md',
                  summary: en
                    ? ['Import the capture', 'Open it in the owner session']
                    : ['导入 capture', '在归属 session 打开'],
                  sections: [
                    { heading: en ? 'Goal' : '目标与边界', body: en ? 'Find the first bad event.' : '定位 First Bad Event。' },
                  ],
                },
              },
              { type: 'tool', tool: { name: 'plan_artifact', verb: en ? 'Updated plan · Rejected' : '已更新计划 · 已拒绝', body: en ? 'Add the reproduction steps.' : '请补上复现条件。' } },
            ],
          }],
          extras: [
            { type: 'taskSnapshot', snapshot: { items: [
              { title: en ? 'Import .rdc into project' : '将 .rdc 导入项目', status: 'completed', order: 0 },
              { title: en ? 'Open capture in owner session' : '在归属 session 打开 capture', status: 'in_progress', order: 1 },
              { title: en ? 'Collect replay diagnostics' : '收集 replay 诊断', status: 'pending', order: 2 },
              { title: en ? 'Publish report via output_register' : '经 output_register 发布报告', status: 'blocked', reason: 'waiting for capture', order: 3 },
              { title: en ? 'Cancelled exploratory pass' : '已取消的探索轮', status: 'cancelled', order: 4 },
            ] } },
          ],
        },
        final: en
          ? '<p>Right Rail does not pin <code>plan.md</code>; Outputs only show <code>output_register</code> files.</p>'
          : '<p>Right Rail 不 pin <code>plan.md</code>；Outputs 只展示 <code>output_register</code> 文件。</p>',
      },
      '09': {
        note: en
          ? 'Live loop keeps Thinking open. ask_user = verb·count + caret + 0/2. Flat ApprovalRow「Awaiting approval」+ tool-card approval callout.'
          : '运行中 loop 保持「正在思考」。ask_user = 动词·count + caret + 0/2。扁平 ApprovalRow「等待审批」+ 工具卡内审批条。',
        user: userPrompt('需要你确认后再改文件。', 'Confirm before editing files.'),
        wp: {
          status: 'running',
          sections: [{
            status: 'running',
            thinking: {
              kind: 'raw',
              status: 'complete',
              preview: en ? 'Need user choice before mutation.' : '变更前需要用户选择。',
            },
            items: [
              {
                type: 'tool',
                tool: {
                  name: 'write_file',
                  status: 'pending',
                  path: 'src/renderer/App.tsx',
                  approval: {
                    message: en
                      ? 'write_file will modify src/renderer/App.tsx'
                      : 'write_file 将修改 src/renderer/App.tsx',
                  },
                },
              },
            ],
          }],
          extras: [
            {
              type: 'ask_user',
              status: 'running',
              expanded: true,
              qa: [
                { q: en ? 'Target capture?' : '目标 capture？', a: '' },
                { q: en ? 'Replay device?' : 'Replay Device？', a: '' },
              ],
            },
            {
              type: 'approval',
              status: 'pending',
              verb: CotI18n.t('approvalPending'),
              message: en
                ? 'Current permission mode requires approval for this action.'
                : '当前权限模式要求先审批这个动作。',
            },
          ],
        },
      },
      '10': {
        note: en
          ? 'Opaque/hidden CoT must not render a placeholder. Answer-only turns may omit the whole WP section.'
          : 'opaque/hidden 不渲染 CoT 占位；answer-only 可省略整段 WP。',
        user: userPrompt('一句话回答：现在几点协议？', 'One-line answer: which protocol now?'),
        wp: null,
        final: en
          ? '<p>Use the frozen <code>RequestPlan</code> from turn creation — no Work Process section when there is no visible thinking/tools/commentary.</p>'
          : '<p>使用创建 turn 时冻结的 <code>RequestPlan</code>——无可见 thinking/tools/commentary 时不渲染 Work Process。</p>',
        altNote: en
          ? 'Contrast: tools-only with opaque thinking still shows tools, never a “thinking…” placeholder.'
          : '对照：opaque thinking + 真实 tools 时仍显示 tools，永不出现「正在思考…」占位句。',
        altWp: {
          status: 'complete',
          duration: '4s',
          actionCount: 1,
          sections: [{
            status: 'complete',
            thinking: { kind: 'opaque', visibility: 'hidden', preview: 'MUST NOT RENDER' },
            items: [
              { type: 'tool', tool: { name: 'read_file', path: 'src/shared/conversation/loopOutputPhase.ts' } },
            ],
          }],
        },
      },
      '11': {
        note: en
          ? 'error_recovery_* must NOT appear as blue narration in Work Process. Only real tools/commentary/thinking.'
          : 'error_recovery_* 不得以蓝字旁白进入 Work Process；只保留真实 tools/commentary/thinking。',
        user: userPrompt('刚才模型断流了，继续。', 'The model stream broke — continue.'),
        wp: {
          status: 'complete',
          duration: '11s',
          actionCount: 2,
          sections: [{
            status: 'complete',
            thinking: {
              kind: 'raw',
              status: 'complete',
              open: false,
              duration: '2s',
              preview: en
                ? 'Recovery happened off-stage; resume with the same request plan.'
                : '恢复在台下完成；沿用同一 RequestPlan 继续。',
            },
            prose: {
              html: en
                ? '<p>Resuming the interrupted tool loop.</p>'
                : '<p>从中断的工具循环继续。</p>',
            },
            items: [
              { type: 'tool', tool: { name: 'bash', command: 'pnpm run check:contracts' } },
              { type: 'tool', tool: { name: 'read_file', path: 'src/main/testing/contracts/cancellationContract.test.ts' } },
            ],
          }],
        },
        final: en
          ? '<p><strong>Absent on purpose:</strong> no “error recovery succeeded…” banner in this transcript.</p>'
          : '<p><strong>有意缺席：</strong>本 transcript 中没有「错误恢复成功…」蓝字旁白。</p>',
      },
      '12': {
        note: en
          ? 'Commentary, final, and thinking preview all use Markdown. Sticky open=true so you can inspect rendered ** / ` / #.'
          : 'Commentary、final 与 thinking preview 都走 Markdown。sticky open=true 以便查看渲染后的 ** / ` / #。',
        user: userPrompt('对比 Markdown 表面。', 'Contrast Markdown surfaces.'),
        wp: {
          status: 'complete',
          duration: '8s',
          actionCount: 1,
          sections: [{
            status: 'complete',
            thinking: {
              kind: 'raw',
              status: 'complete',
              open: true,
              duration: '3s',
              preview: en
                ? 'This **should** render as bold. `code` is inline. # Heading'
                : '这里的 **应该** 加粗。`code` 是行内代码。# 标题',
              html: en
                ? '<p>This <strong>should</strong> render as bold. <code>code</code> is inline.</p><h3>Heading</h3>'
                : '<p>这里的 <strong>应该</strong> 加粗。<code>code</code> 是行内代码。</p><h3>标题</h3>',
            },
            prose: {
              html: en
                ? '<p>Commentary <strong>does</strong> render Markdown, including <code>inline code</code> and lists:</p><ul><li>GFM</li><li>fenced blocks</li></ul><pre><code class="language-ts">const phase = "commentary";\n</code></pre>'
                : '<p>Commentary <strong>会</strong>渲染 Markdown，包括 <code>inline code</code> 与列表：</p><ul><li>GFM</li><li>代码块</li></ul><pre><code class="language-ts">const phase = "commentary";\n</code></pre>',
            },
            items: [
              { type: 'tool', tool: { name: 'read_file', path: 'src/renderer/features/debugger/AgentChat/MessageMarkdown.tsx' } },
            ],
          }],
        },
        final: en
          ? '<h3>Final answer</h3><p>Also Markdown — KaTeX/Mermaid would apply in-product; this mock shows GFM basics.</p>'
          : '<h3>最终答案</h3><p>同样是 Markdown——产品内还有 KaTeX/Mermaid；本 mock 展示 GFM 基础。</p>',
      },
    };
  }

  global.CotScenarios = { models, userPrompt };
})(window);
