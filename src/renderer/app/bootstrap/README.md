# 工作台启动与事件订阅

`useAppBootstrap` 负责启动加载。`useIpcEventBridge` 是事件安装与释放的唯一协调入口，保持显式的订阅顺序，卸载时先丢弃会话消息批次，再释放订阅。切会话和 StrictMode 重装复用同一路径。

- `conversationSubscriptions`：流式消息、handoff、工具完成；高频 patch 使用 `conversationEventBatcher`，terminal 先刷新对应消息。
- `sessionSubscriptions`：usage、trace、Agent、证据、run 与项目输入；当前会话写活动 store，后台投影只写所属会话缓存。
- `captureSubscriptions`：冻结 scope 的 context/opened-capture 投影、设备事件和首次查询；异步返回重新核对活动 scope，不能污染新会话。
- `shellSubscriptions`：Terminal 日志、主题和窗口菜单命令；新工作区仍调用统一的 `resetWorkbenchStores`。

这些模块负责订阅，不创建第二套状态或 IPC API。新增事件须同时给出订阅释放路径、会话归属与负路径测试。`check:session-projection` 从协调入口追踪真实导入，检查门禁不依赖所有处理器挤在同一个文件。
