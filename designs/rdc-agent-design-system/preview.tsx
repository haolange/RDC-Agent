import { useEffect, useState, type ReactNode } from 'react';
import { Button, Input, Textarea, Select, Switch, Checkbox, Tabs, Details, Popover, TaskDialog, EmptyState, OverflowFade, ActiveSignalText } from '../../src/renderer/ui';
import { TaskStatusMarker } from '../../src/renderer/ui/TaskStatusMarker';
import { createDefaultUiPreferences } from '../../src/shared/theme/uiPreferences';
import { applyChromeTheme } from '../../src/renderer/app/theme/applyChromeTheme';
import '../../src/renderer/styles/design-system.css';
import '../../src/renderer/ui/kit.css';
import { ComposerSample, PlanSample, TaskTrackSample, ProgressSample } from './domainSamples';
import { ExtraControls } from './extraControls';
import { ColorSample, NavigationSample, UnsavedSample } from './controlSamples';
import { contracts, type CatalogName } from './contracts';
import './preview.css';

export default function Preview() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [scale, setScale] = useState<'small' | 'medium' | 'large'>('medium');
  const [narrow, setNarrow] = useState(false);
  const [long, setLong] = useState(false);
  const [value, setValue] = useState('general');
  const [checked, setChecked] = useState(false);
  const [popup, setPopup] = useState(false);
  const [dialog, setDialog] = useState(false);
  useEffect(() => applyChromeTheme({ ...createDefaultUiPreferences(), theme, fontScale: scale }, theme), [theme, scale]);
  const entries: { name: CatalogName; group: string; usage: string; api: string; keyboard: string; source: string; sample: ReactNode }[] = [
    { name: 'ColorField / HelpTip', group: '输入', usage: '颜色输入与按需帮助，复用生产取色面。', api: 'value / onChange / layout / label；HelpTip label / children', keyboard: '色面方向键、色相方向键；Tab 聚焦帮助、Escape 关闭', source: 'ui/ColorField.tsx', sample: <ColorSample /> },
    { name: 'Tabs / Pill / IconButton', group: '选择', usage: '内容页签、选择与独立运行标记，以及具名图标动作。', api: 'Tabs value / tabs / variant；Pill selected / running；IconButton label', keyboard: 'Tabs 方向键、Home/End；按钮 Enter/Space', source: 'ui/Tabs.tsx', sample: <NavigationSample /> },
    { name: 'UnsavedChangesDialog', group: '浮层', usage: '手动保存表单的草稿退出保护。', api: 'onKeepEditing / onDiscard / keepEditingLabel / discardLabel', keyboard: '初始焦点继续编辑，Escape 返回草稿', source: 'ui/UnsavedChangesDialog.tsx', sample: <UnsavedSample /> },
    { name: 'Composer Markdown', group: '领域组合', usage: '真实输入与预览组件。输入保持领域所有权；此处 Enter 仅反馈本地状态。', api: 'value / onChange / mode / onSend', keyboard: 'Enter 提交、Shift+Enter 换行、Tab 缩进', source: 'features/composer/ComposerMarkdownInput.tsx', sample: <ComposerSample /> },
    { name: 'PlanCard', group: '领域组合', usage: '历史计划摘要和全文入口；审批与交接仍由业务持有。示例弹层仅显示样本正文。', api: 'plan / onOpen', keyboard: 'Enter、Space 打开；选中文字不触发打开', source: 'features/transcript/PlanCard.tsx', sample: <PlanSample /> },
    { name: 'TaskSnapshotCard', group: '领域组合', usage: '按时间呈现任务快照；折叠记忆由会话作用域管理，不以当前任务覆盖历史。', api: 'row / ScopedWorkDisclosure', keyboard: 'Enter、Space 展开；运行中可继续操作', source: 'features/transcript/TaskSnapshotCard.tsx', sample: <TaskTrackSample /> },
    { name: 'RightRailProgressList', group: '领域组合', usage: '单轨任务投影；真实宽度渐隐并提供完整标题。示例定位只发送页面内事件。', api: 'tasks / locateLabel', keyboard: 'Tab、Enter 定位', source: 'features/right-rail/RightRailProgressList.tsx', sample: <ProgressSample /> },
    { name: 'SearchMultiSelect / Menu / ListRow / Feedback', group: '组合控件', usage: '目录多选保留不可用引用；菜单动作、列表选择、错误和成功反馈分别表达。', api: '各项接口与状态见展开示例', keyboard: '方向键菜单导航、Escape 返回、Tab 选择', source: 'ui/index.ts', sample: <ExtraControls /> },
    { name: 'Button', group: '操作', usage: '单一动作；loading 阻止重复提交。导航选择使用 Tabs。', api: 'variant / size / loading / disabled', keyboard: 'Tab、Enter、Space', source: 'ui/Button.tsx', sample: <div className="catalog-row">{(['primary','secondary','ghost','danger'] as const).map(variant => <Button key={variant} variant={variant}>{variant}</Button>)}<Button loading>保存中</Button><Button disabled>不可用</Button></div> },
    { name: 'Input / Textarea', group: '输入', usage: '短字段与自动增长正文；全文编辑使用 fill，由父容器分配高度。', api: 'value / onChange / sizing / minRows / maxRows', keyboard: '原生编辑、Tab', source: 'ui/Textarea.tsx', sample: <><Input aria-label="示例名称" placeholder="名称" /><Textarea aria-label="示例说明" placeholder="输入多行内容观察增长" /></> },
    { name: 'Select', group: '选择', usage: '固定单选；长列表搜索用专属搜索选择器。菜单跟随锚点并限制视口边界。', api: 'value / options / onChange / menuAlign', keyboard: '方向键、Enter、Escape、Tab', source: 'ui/Select/index.tsx', sample: <Select dataTestId="catalog-select" ariaLabel="智能体" value={value} onChange={setValue} options={[{value:'general',label:long?'General · 很长的模型与智能体名称，用于检查真实容器边界':'General'},{value:'debugger',label:'Debugger'},{value:'disabled',label:'不可用',disabled:true}]} /> },
    { name: 'Switch / Checkbox', group: '选择', usage: '即时开关与多选；不替代执行动作。', api: 'checked / onCheckedChange / disabled', keyboard: 'Tab、Space', source: 'ui/Switch.tsx', sample: <div className="catalog-row"><Switch aria-label="示例开关" checked={checked} onCheckedChange={setChecked}/><Checkbox aria-label="示例多选" checked={checked} onCheckedChange={setChecked}/></div> },
    { name: 'Details', group: '披露', usage: '所属详情按需展开；错误与操作约束始终保持可见。每项独立，不强制单开。', api: 'summary / variant / open / onToggle', keyboard: 'Tab、Enter、Space', source: 'ui/Details.tsx', sample: <Details variant="panel" summary="高级设置"><Input aria-label="展开后的草稿" placeholder="折叠后草稿仍保留"/><p>原生披露语义，统一箭头与焦点。</p></Details> },
    { name: 'Popover / TaskDialog', group: '浮层', usage: '锚定局部操作与独立任务；Escape 只关闭顶层并返回焦点。', api: 'open / onOpenChange / onClose / size', keyboard: 'Escape、Tab', source: 'ui/Popover.tsx', sample: <div className="catalog-row"><Popover open={popup} onOpenChange={setPopup} trigger={<Button>打开浮层</Button>}><Button onClick={()=>setDialog(true)}>打开嵌套对话框</Button></Popover><Button onClick={()=>setDialog(true)}>任务对话框</Button></div> },
    { name: 'OverflowFade / EmptyState', group: '内容', usage: '单行真实溢出才渐隐；空态区分空内容和读取错误。', api: 'text / title / description / layout', keyboard: '完整标题提示；操作继续用 Button', source: 'ui/OverflowFade.tsx', sample: <><OverflowFade text={long?'很长的资源名称与路径，用于检查父容器收缩之后的渐隐及完整提示内容'.repeat(4):'资源名称'}/><EmptyState title="没有匹配内容" description="调整筛选后重试。"/></> },
    { name: 'ActiveSignalText / TaskStatusMarker', group: '运行状态', usage: '生产组件展示样本，不代表真实 Agent 执行。状态由调用方投影，不由动画推断。', api: 'active / tone / status', keyboard: '状态不抢夺焦点', source: 'ui/ActiveSignalText.tsx', sample: <div className="catalog-row"><ActiveSignalText active>正在工作</ActiveSignalText>{(['pending','in_progress','blocked','completed','cancelled'] as const).map(status=><TaskStatusMarker key={status} status={status}/>)}</div> },
  ];
  const visible = entries.filter(e => (category === 'all' || (category === 'domain' ? e.group === '领域组合' : e.group !== '领域组合')) && (e.name + e.group + e.usage).toLowerCase().includes(query.toLowerCase()));
  return <main className={`catalog ${narrow?'is-narrow':''}`}><header><h1>RDC-Agent 组件目录</h1><p>生产组件活文档 · 所有内容均为本地展示样本，不连接账户或执行工具。</p></header>
    <nav className="catalog-controls" aria-label="预览控制"><Input aria-label="搜索组件" placeholder="搜索组件、用途或分类" value={query} onChange={e=>setQuery(e.target.value)}/><Tabs label="主题" value={theme} onChange={v=>setTheme(v as typeof theme)} tabs={[{id:'dark',label:'深色'},{id:'light',label:'浅色'}]}/><Tabs label="字号" value={scale} onChange={v=>setScale(v as typeof scale)} tabs={[{id:'small',label:'小'},{id:'medium',label:'中'},{id:'large',label:'大'}]}/><Button aria-pressed={narrow} onClick={()=>setNarrow(!narrow)}>窄容器</Button><Button aria-pressed={long} onClick={()=>setLong(!long)}>长内容</Button></nav>
    <Tabs label="组件分类" value={category} onChange={setCategory} tabs={[{id:"all",label:"全部"},{id:"base",label:"基础与组合"},{id:"domain",label:"产品领域"}]} />
    {visible.length === 0 && <EmptyState title="没有匹配组件" description="调整搜索或分类。" layout="compact" />}
    <div className="catalog-grid">{visible.map(e=><article key={e.name}><h2>{e.name}</h2><p>{e.group} · {e.usage}</p><div className="catalog-sample">{e.sample}</div><Details summary="接口与交互契约"><p>接口：{e.api}</p><p>不适用：{contracts[e.name].avoid}</p><p>状态：{contracts[e.name].states}</p><p>键盘：{e.keyboard}</p><p>布局：{contracts[e.name].layout}</p><p>动效：{contracts[e.name].motion}</p><p>生产使用：{contracts[e.name].consumers}</p><code>src/renderer/{e.source}</code></Details></article>)}</div>
    <TaskDialog open={dialog} title="任务对话框示例" closeLabel="关闭" onClose={()=>setDialog(false)} footer={<Button onClick={()=>setDialog(false)}>完成</Button>}><p>标题与操作区保持可达，正文负责滚动。</p><Textarea aria-label="示例草稿"/></TaskDialog>
  </main>;
}
