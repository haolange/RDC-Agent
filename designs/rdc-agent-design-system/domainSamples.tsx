import { useState } from 'react';
import { Button, Tabs, TaskDialog } from '../../src/renderer/ui';
import { ComposerMarkdownInput } from '../../src/renderer/features/composer/ComposerMarkdownInput';
import { PlanCard } from '../../src/renderer/features/transcript/PlanCard';
import { TaskSnapshotCard } from '../../src/renderer/features/transcript/TaskSnapshotCard';
import { WorkProcessContent } from '../../src/renderer/features/transcript/WorkProcessContent';
import { buildWorkProcessPresentation } from '../../src/renderer/features/transcript/workProcessTracePresentation';
import { useI18n } from '../../src/renderer/i18n';
import type { ConversationToolCall, ConversationWorkBlock } from '../../src/shared/types/conversation';
import { ScopedWorkDisclosure } from '../../src/renderer/features/transcript/ScopedWorkDisclosure';
import { RightRailTaskList } from '../../src/renderer/features/right-rail/RightRailTaskList';
import { MessageMarkdown } from '../../src/renderer/patterns/Markdown/MessageMarkdown';
import type { ConversationPlanReview } from '../../src/shared/types/planReview';
import '../../src/renderer/features/transcript/AgentChat.css';
import '../../src/renderer/features/transcript/work-process-tasks.css';
import '../../src/renderer/features/transcript/work-process-track.css';
import '../../src/renderer/features/transcript/AgentChat.markdown.css';
import '../../src/renderer/features/right-rail/RightRailShell.css';

const plan: ConversationPlanReview = {
  planId: 'catalog-plan', revision: 1, uri: 'sample:plan', hash: 'sample',
  title: '核对帧分析证据', summary: ['确认当前 capture 与事件范围。', '测量候选瓶颈，保留失败与不支持状态。'],
  sections: [{ heading: '验证步骤', body: '先读取事实，再比较测量结果。这里仅展示组件，不连接真实 capture。' }],
  status: 'approved', handoffOptions: [],
};
const items = [
  { taskId: 'inspect', title: '确认 capture 身份与事件范围', status: 'completed' as const, order: 0 },
  { taskId: 'measure', title: '对候选瓶颈进行测量并保留来源证据', status: 'in_progress' as const, order: 1 },
  { taskId: 'report', title: '整理结论与验证边界', status: 'pending' as const, order: 2 },
];

export function ComposerSample() {
  const [value, setValue] = useState('请分析 **当前帧** 的主要瓶颈。');
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [notice, setNotice] = useState('');
  return <><Tabs label="Markdown 模式" value={mode} onChange={v => setMode(v as typeof mode)}
    tabs={[{ id: 'write', label: '输入' }, { id: 'preview', label: '预览' }]} />
    <ComposerMarkdownInput value={value} onChange={setValue} mode={mode} placeholder="输入示例"
      onSend={() => setNotice('示例已接收；未发出模型请求。')} />
    <p role="status">{notice}</p></>;
}

export function PlanSample() {
  const [open, setOpen] = useState(false);
  return <><PlanCard plan={plan} onOpen={() => setOpen(true)} />
    <TaskDialog open={open} title={plan.title} closeLabel="关闭示例" onClose={() => setOpen(false)}
      footer={<Button onClick={() => setOpen(false)}>关闭</Button>}>
      <MessageMarkdown content={plan.sections.map(section => `## ${section.heading}\n\n${section.body}`).join('\n\n')} />
    </TaskDialog></>;
}

export function TaskTrackSample() {
  return <ScopedWorkDisclosure scope="catalog"><ol className="work-process-steps">
    <TaskSnapshotCard row={{ type: 'taskSnapshot', id: 'catalog-task', status: 'running', completed: 1,
      total: 3, items, duration: '', change: 'updated' }} />
  </ol></ScopedWorkDisclosure>;
}

export function TaskListSample() {
  return <RightRailTaskList locateLabel="示例定位" tasks={items.map(item => ({
    id: item.taskId, title: item.title, status: item.status, displayState: item.status, order: item.order,
    sessionId: 'catalog', traceLaneId: 'catalog', branchId: 'catalog',
    createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z',
  }))} />;
}

const at = Date.parse('2026-10-30T08:00:00Z');
const webResult = (details: Record<string, unknown>) => JSON.stringify({ ok: true, data: { content: [], details } });
const read = (id: string, url: string, title: string | undefined, start: number, end: number, failed = false): ConversationToolCall => ({
  id, toolName: 'web_fetch', status: failed ? 'error' : 'complete', argsPreview: JSON.stringify({ url }),
  ...(failed ? { error: 'HTTP 404 Not Found' } : { resultPreview: webResult({ kind: 'fetch', url, status: 200, bytes: 48_213, ...(title ? { title } : {}) }) }),
  startedAt: at + start, executionStartedAt: at + start, completedAt: at + end,
});
const webTurn = (id: string, text: string, toolCalls: ConversationToolCall[]): ConversationWorkBlock => ({
  id, kind: 'llm_turn', title: 'LLM turn', status: 'complete', startedAt: at, completedAt: at + 4_000,
  result: { status: 'complete', toolCallIds: toolCalls.map(call => call.id) },
  items: text ? [{ kind: 'text', text, phase: 'commentary', status: 'complete', displayOrder: 0,
    providerOutputRef: { protocol: 'sample', providerBlockKey: id, contentIndex: 0 } }] : [],
  toolCalls,
});

/** Search, reads that merge across steps, a failed page and a single read: every web card state, no network. */
export function WorkProcessWebSample() {
  const { t } = useI18n();
  const presentation = buildWorkProcessPresentation({ status: 'complete', updatedAt: at + 4_000, blocks: [
    webTurn('search', '先找 Vulkan 抓帧相关的资料。', [{ id: 'search', toolName: 'web_search', status: 'complete',
      argsPreview: JSON.stringify({ query: 'RenderDoc Vulkan capture' }), startedAt: at, executionStartedAt: at, completedAt: at + 640,
      resultPreview: webResult({ kind: 'search', query: 'RenderDoc Vulkan capture', results: [
        { url: 'https://renderdoc.org/docs/getting_started/quick_start.html', title: 'Quick Start — RenderDoc', snippet: 'Capturing a frame and inspecting the event browser.' },
        { url: 'https://www.khronos.org/vulkan/', title: 'Vulkan Overview', snippet: 'The cross-platform graphics and compute API.' },
        { url: 'https://github.com/baldurk/renderdoc', title: 'baldurk/renderdoc', snippet: 'A stand-alone graphics debugger.' },
        { url: 'https://developer.nvidia.com/nsight-graphics', title: 'Nsight Graphics', snippet: 'Frame debugging and profiling.' },
      ] }) }]),
    webTurn('reads', '', [read('quick', 'https://renderdoc.org/docs/getting_started/quick_start.html', 'Quick Start — RenderDoc', 700, 1_300),
      read('khronos', 'https://www.khronos.org/vulkan/', 'Vulkan Overview', 720, 1_900), read('gone', 'https://example.com/moved', undefined, 740, 1_100, true)]),
    webTurn('single', '再确认一下仓库说明。', [read('repo', 'https://github.com/baldurk/renderdoc', 'baldurk/renderdoc', 2_000, 2_450)]),
  ] }, t);
  return <ScopedWorkDisclosure scope="catalog-web"><WorkProcessContent presentation={presentation} active={false} /></ScopedWorkDisclosure>;
}
