# RDC-Agent 生产组件活文档

运行 `pnpm run design:dev`，打开输出的本地地址；构建检查运行 `pnpm run design:build`。

唯一入口为 index.html，直接导入生产 React 组件、运行时 CSS 和 applyChromeTheme。预览状态只存在于页面内存，不读取用户配置，不执行 IPC、模型或 RDC 操作。构建输出位于 node_modules/.cache/rdc-agent/design-system，不进入发行包。

支持组件搜索、主题、字号、窄容器及长内容；每项附用途、不适用场景、状态、接口、键盘、布局、动效与生产使用位置。多选可交互切换加载、失败、重试、空和禁用状态；草稿示例支持继续编辑与放弃。示例状态不构成产品运行验收，真实业务仍通过官方 Browser QA / Electron 验证。

[完整生产消费者索引](consumers.md)由 TypeScript import 生成，覆盖 ui 公开入口与直接导入的 HelpTip/TaskStatusMarker。`check:appearance` 同时检查索引是否与源码一致。消费者变化后运行 `node scripts/check-component-catalog.mjs --write`，复核差异后再验收；不手写重复路径列表。表单协调、业务副作用和领域状态继续留在生产所有者内。

## 生产消费者与所有权

以下路径均相对 `src/renderer`。目录示例直接复用组件；领域协调器仍在产品链路验收，不在文档中模拟 IPC。

| 组件与契约 | 生产消费者 | 使用边界 |
|---|---|---|
| Button、Input、Textarea、Switch、Checkbox | Settings 八页、Composer、Knowledge | 基础控件不读写领域状态；标签、错误和操作由所属表单提供 |
| Select、SearchMultiSelect | Settings 模型与工具配置、patterns/MaterialContextEditor | 固定单选和搜索多选分别使用现有入口，不保留原生 select 替代入口 |
| Details | Settings 高级配置、Knowledge 索引/元信息、素材上下文、RightRailInvestigationPreview | 内嵌与面板两种表现；子树保留挂载；历史任务展开仍由 ScopedWorkDisclosure 管理 |
| Popover、ContextMenu | 工作台局部操作、全局编辑菜单、设置选择器 | Popover/Select/ContextMenu 共享 lib/anchoredSurface 几何；顶层 Escape 与原触发器焦点返回；Menu 作为公开基础控件在目录中展示，当前没有生产直接消费者 |
| TaskDialog、ConfirmationDialog | Settings 子弹层、Knowledge 写入确认、项目操作 | 标题与操作区固定，正文占剩余空间；嵌套浮层不关闭父层 |
| Panel、ListRow、SectionHeader、EmptyState | 左右栏、Knowledge、Settings 资源页 | 容器只负责布局，不制造业务状态；短空态不撑出重复空白 |
| OverflowFade | 右栏任务、Composer 附件、模型标签 | 按真实可用宽度判断溢出，完整标题可访问；正文和错误允许换行 |
| ActiveSignalText、TaskStatusMarker | Transcript 工作过程、右栏进度 | selected 与 running 分离；左到右扫光只使用现有实现 |
| ComposerMarkdownInput | features/composer/ComposerEditor | 输入与 Markdown 预览保持领域所有权；文档仅本地回调 |
| PlanCard、TaskSnapshotCard | features/transcript/WorkProcessRows | 保留时间顺序、多交接动作和会话展开记忆；PlanCard 通过 onOpen 交还全文入口 |
| RightRailProgressList | features/right-rail | 当前会话单轨投影，不从动画推断运行状态 |
| ComposerModelEffortPanel、EffortMaxField | features/composer/ComposerModelEffortControl | Max 特效仍由 useMaxVisualController + maxVisual 时间线 + EffortMaxField 共同实现；不复制到通用 ui |

Max 视觉验收与模型调用分开：可在真实滑条上检查进入、持续、重开和退出，但模型验证请求使用 Low。Composer 边缘绕光与 ActiveSignalText 扫光也通过真实 working 链路验收；目录样例不能替代该证据。
