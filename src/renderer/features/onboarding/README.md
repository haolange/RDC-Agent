# 上手指南

`GettingStartedDialog` 通过共享 TaskDialog 呈现四步说明。每页左侧按导语、对齐的编号步骤和紧凑完成提示组织；桌面布局为文字栏优先的双栏，窄屏切换为上图下文。`GuideIllustration` 使用本地教学图与 i18n 标注，不读取或伪造当前配置。已读记录由应用层 `useGettingStarted` 管理，展示组件只维护当前页并发出关闭动作。

`GettingStartedDialog.test.ts` 验证前进/返回、结束关闭、重新挂载从第一页开始和 Escape。教学完成不表示 Provider、项目或 RDC 已配置成功。UI 验证需覆盖双语与窄屏，不将本地图片当作设备回执。
