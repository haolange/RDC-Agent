# 运行日志抽屉

`TerminalDrawer` 入口连接 `TerminalDrawerShell`、toolbar 与 activity pane；`useTerminalDrawer` 管理筛选、自动跟随与刷新，`useTerminalDrawerResize` 管理高度与监听释放。Terminal store 是日志与筛选状态来源，视图不维护第二套历史。

`TerminalDrawer.css` 依次加载 layout、toolbar、activity 样式；移动只改变归属，保留原声明顺序和滚动/高度行为。搜索标签使用 terminal 专属隐藏类，不向其它 feature 隐式提供全局 utility。

`terminalActivityWindow.test.ts` 验证长列表窗口；实际 UI 还须检查筛选、展开、滚动跟随、关闭重开和 resize。日志错误呈现不应影响会话实际运行状态。
