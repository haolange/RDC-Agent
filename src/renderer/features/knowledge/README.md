# Knowledge Center

`KnowledgeCenterModal` 组装 spaces/list/detail 三列与覆盖式导入、导出、写入确认面；`columns`、`panels`、`parts` 分别承担布局内容、任务对话框和局部展示。现有样式已按 shell、sidebar、list、reader、metadata 和 dialogs 拆分，继续保持。

`useKnowledgeCenter` 协调查询与选择，`useKnowledgeSelection`、`useKnowledgeRequestScope` 保证请求结果属于当前 open/scope 生命周期；`useKnowledgeImport/Export/WriteConfirm` 各自管理操作状态，不把取消展示当作取消后端写入。窄屏切换不改变所选知识内容。

既有 selection、write-confirm、query/model 测试覆盖迟到响应和写入边界；`useKnowledgeRequestScope.test.ts` 补充 StrictMode、切 scope、关闭、重开与卸载的 React 生命周期验证。知识 lifecycle 的 `retired` 保留人工退役与历史追溯语义；默认召回排除该状态。

导入结果的缺失附件状态随 canonical Draft 保留；Detail 在无当前会话或附件缺失时禁用创建 Candidate 并解释原因。主进程仍独立校验缺失记录和图片实际文件，UI 禁用仅提供可见反馈。
