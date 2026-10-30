import { useState } from 'react';
import { Badge, Button, CheckPill, ConfirmationDialog, Details, Divider, InlineError, Kbd, ListRow,
  ContextMenu, Menu, Panel, SearchMultiSelect, SectionHeader, Spinner, Tabs, Toast } from '../../src/renderer/ui';

export function ExtraControls() {
  const [selected, setSelected] = useState<string[]>(['missing']);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState('尚未执行示例动作');
  const [state, setState] = useState('ready');
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  return <>
    <Details summary="SearchMultiSelect · 搜索、多选、不可用引用">
      <Tabs label="多选示例状态" value={state} onChange={setState} tabs={[
        { id: 'ready', label: '可用' }, { id: 'loading', label: '加载' },
        { id: 'error', label: '失败' }, { id: 'empty', label: '空' }, { id: 'disabled', label: '禁用' },
      ]} />
      <SearchMultiSelect value={selected} onChange={setSelected}
        loading={state === 'loading'} disabled={state === 'disabled'}
        error={state === 'error' ? '示例目录加载失败；已选引用仍保留。' : undefined}
        onRetry={() => setState('ready')} retryLabel="重试示例"
        options={state === 'empty' ? [] : [{ id: 'read', label: '读取' }, { id: 'write', label: '写入' }, { id: 'blocked', label: '不可用', disabled: true }]}
        label="示例能力" searchLabel="搜索能力" emptyLabel="没有选项" noResultsLabel="没有匹配项"
        loadingLabel="正在加载" unavailableLabel="当前目录不可用" removeLabel={id => `移除 ${id}`} />
      <p>value / options / unavailable / loading / error；不可用引用保留到用户主动移除。</p>
    </Details>
    <Details summary="Menu / ConfirmationDialog · 动作与确认">
      <Menu open={menu} onOpenChange={setMenu} trigger={<Button>动作菜单</Button>} label="示例动作"
        items={[{ id: 'copy', label: '复制示例', onSelect: () => setMessage('本地示例动作已完成') },
          { id: 'disabled', label: '不可执行', disabled: true },
          { id: 'confirm', label: '确认示例', onSelect: () => setConfirm(true) }]} />
      <p role="status">{message}</p>
      <p>Menu items / onSelect；ConfirmationDialog busy / onConfirm / onCancel。确认框默认聚焦取消。</p>
      <Button onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        setContext({ x: rect.right, y: rect.bottom });
      }}>上下文菜单示例</Button>
      <p>ContextMenu x / y / items / onSelect / onClose：用于编辑上下文命令，普通表单使用 Popover。方向键跳过禁用项，Home/End 定位，Escape 返回触发器；视口边缘自动限宽和翻转。</p>
      {context && <ContextMenu {...context} items={[
        { type: 'command', id: 'copy', label: '示例复制', shortcut: 'Ctrl+C', disabled: false },
        { type: 'command', id: 'paste', label: '示例粘贴（不可用）', shortcut: 'Ctrl+V', disabled: true },
      ]} onSelect={() => { setMessage('仅更新本地状态，未访问剪贴板'); setContext(null); }} onClose={() => setContext(null)} />}
    </Details>
    <Details summary="Panel / SectionHeader / ListRow · 结构和选择">
      <Panel header={<SectionHeader title="资源列表" />}>
        <ListRow selected={checked} onClick={() => setChecked(!checked)} trailing={<Badge>示例</Badge>}>选择资源</ListRow>
        <ListRow disabled>不可用资源</ListRow><Divider />
        <CheckPill checked={checked} onCheckedChange={setChecked}>加入当前选择</CheckPill>
      </Panel>
      <p>Panel header；ListRow selected / leading / trailing；选择与运行状态分开。</p>
    </Details>
    <Details summary="InlineError / Toast / Spinner / Kbd · 反馈">
      <InlineError>保存失败，草稿仍保留。此处是明确标注的错误示例。</InlineError>
      <Toast title="已保存" message="操作结果反馈示例" tone="success" />
      <div className="catalog-row"><Spinner /><Kbd>Esc</Kbd><span>关闭顶层浮层</span></div>
      <p>InlineError 保持可见；Toast 用于操作结果；Spinner 不替代文字状态。</p>
    </Details>
    {confirm && <ConfirmationDialog title="确认示例" message="此操作只更新本地展示状态。"
      confirmLabel="确认" cancelLabel="取消" onCancel={() => setConfirm(false)}
      onConfirm={() => { setMessage('已确认展示样例'); setConfirm(false); }} />}
  </>;
}
