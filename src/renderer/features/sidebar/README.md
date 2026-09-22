# 项目与会话导航

`Sidebar` 组装项目组、会话列表、行操作与重命名弹层；`useProjectTree` 管理展开状态，`useProjectSelection` 协调用户动作，loader/handler 模块处理选择和请求。项目/会话权威仍在 project store，当前选择不得被旧请求覆盖。

`Sidebar.css` 按布局、行、弹层加载同目录样式。`SidebarResponsive.css` 拥有 viewport 下导航/会话规则，由全局 responsive 入口在原有加载阶段引入；它不承担应用网格或窗口 chrome。样式拆分不改变列表排序、选择、collapsed 或 drawer 行为。

异步选择保护由 `projectSelectionLoaderOps.test.ts` 覆盖；改行操作需验证 busy、失败提示、重命名和键盘焦点。不能为组织文件新增第二套项目缓存。
