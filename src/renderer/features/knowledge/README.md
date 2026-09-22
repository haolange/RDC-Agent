# Knowledge Center

`KnowledgeCenterModal` 组装 spaces/list/detail 三列与覆盖式导入、导出、写入确认面；`columns`、`panels`、`parts` 分别承担布局内容、任务对话框和局部展示。现有样式已按 shell、sidebar、list、reader、metadata 和 dialogs 拆分，继续保持。

`useKnowledgeCenter` 协调查询与选择，`useKnowledgeSelection`、`useKnowledgeRequestScope` 保证请求结果属于当前 open/scope 生命周期；`useKnowledgeImport/Export/WriteConfirm` 各自管理操作状态，不把取消展示当作取消后端写入。窄屏切换不改变所选知识内容。

既有 selection、write-confirm、query/model 测试覆盖迟到响应和写入边界；`useKnowledgeRequestScope.test.ts` 补充 StrictMode、切 scope、关闭、重开与卸载的 React 生命周期验证。知识 lifecycle 中的 deprecated 是有效业务语义，不能当作废弃代码移除。
