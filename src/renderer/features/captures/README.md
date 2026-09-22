# Capture 设备入口

本 feature 的 `DeviceSelector` 负责设备选择展示、定位与菜单生命周期；设备权威来自 device store，设备启动与清理由 Tools/主进程负责。实际回放、图像、历史和会话 Capture 卡在 right-rail feature，各自沿 owning scope 执行，两个区域不横向引用。

`useDeviceDropdownPosition` 负责 viewport 内弹层定位，菜单关闭时释放相关监听。无设备、失败、不支持与已就绪必须保持不同呈现；局部前端测试不能替代真实 Android/Remote 回执。
