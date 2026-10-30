import { useState } from 'react';
import { Button, Tabs, TaskDialog } from '../../src/renderer/ui';
import { ComposerMarkdownInput } from '../../src/renderer/features/composer/ComposerMarkdownInput';
import { PlanCard } from '../../src/renderer/features/transcript/PlanCard';
import { TaskSnapshotCard } from '../../src/renderer/features/transcript/TaskSnapshotCard';
import { ScopedWorkDisclosure } from '../../src/renderer/features/transcript/ScopedWorkDisclosure';
import { RightRailProgressList } from '../../src/renderer/features/right-rail/RightRailProgressList';
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

export function ProgressSample() {
  return <RightRailProgressList locateLabel="示例定位" tasks={items.map(item => ({
    id: item.taskId, title: item.title, status: item.status, order: item.order,
    sessionId: 'catalog', traceLaneId: 'catalog', branchId: 'catalog',
    createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z',
  }))} />;
}
