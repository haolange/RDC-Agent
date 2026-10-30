import { useState } from 'react';
import { Button, ColorField, Icon, IconButton, Input, ModeGlyph, Pill, Tabs,
  Toast, ToastStack, UnsavedChangesDialog } from '../../src/renderer/ui';
import { HelpTip } from '../../src/renderer/ui/HelpTip';

export function ColorSample() {
  const [color, setColor] = useState('#33d1ff');
  return <>
    <ColorField label="示例强调色" value={color} onChange={setColor} testId="catalog-color"
      areaLabel="饱和度与明度" hueLabel="色相" pickerTitle="示例颜色" currentLabel="当前颜色" />
    <HelpTip label="颜色帮助">只改变此示例颜色，不写入产品配置。</HelpTip>
  </>;
}

export function NavigationSample() {
  const [value, setValue] = useState('summary');
  const [selected, setSelected] = useState(false);
  return <>
    <Tabs label="示例内容" value={value} onChange={setValue} variant="segmented"
      tabs={[{ id: 'summary', label: '摘要' }, { id: 'detail', label: '详情' },
        { id: 'disabled', label: '不可用', disabled: true }]}>
      {value === 'summary' ? '主要信息直接显示。' : '附属信息在所属详情中呈现。'}
    </Tabs>
    <div className="catalog-row">
      <Pill selected={selected} onClick={() => setSelected(!selected)}>选择状态</Pill>
      <Pill running>运行状态示例</Pill><Pill disabled>不可用</Pill>
      <IconButton label="切换示例选择" onClick={() => setSelected(!selected)}><Icon name="check" /></IconButton>
      <ModeGlyph mode="general" />
    </div>
  </>;
}

export function UnsavedSample() {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  return <>
    <Input aria-label="本地草稿" value={draft} onChange={event => setDraft(event.target.value)} />
    <Button disabled={!draft} onClick={() => setOpen(true)}>离开示例表单</Button>
    {open && <UnsavedChangesDialog title="保留草稿？" message="这里只处理活文档中的本地输入。"
      keepEditingLabel="继续编辑" discardLabel="放弃草稿" onKeepEditing={() => setOpen(false)}
      onDiscard={() => { setDraft(''); setOpen(false); setNotice(true); }} />}
    {notice && <ToastStack><Toast title="示例草稿已放弃" onDismiss={() => setNotice(false)} dismissLabel="关闭反馈" /></ToastStack>}
  </>;
}
