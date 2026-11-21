import { useState } from 'react';
import { Button, Disclosure, ReadingSheet } from '../../src/renderer/ui';

export function ReadingSample() {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  return <>
    <Disclosure open={details} onOpenChange={setDetails} summary="查看分项" trailing={<span>12 项</span>}>
      <p>关闭时正文不渲染；箭头与正文进入使用同一披露动效。</p>
    </Disclosure>
    <Button onClick={() => setOpen(true)}>打开阅读面板</Button>
    <ReadingSheet open={open} title="核对帧分析证据" meta="第 2 版" closeLabel="关闭" onClose={() => setOpen(false)}
      status={<p role="status">已复制到剪贴板。</p>}>
      {Array.from({ length: 12 }, (_, index) => <p key={index}>第 {index + 1} 段：正文是唯一滚动区，头部与状态保持可见。</p>)}
    </ReadingSheet>
  </>;
}
