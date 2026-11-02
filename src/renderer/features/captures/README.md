# Capture 设备入口

DeviceSelector 使用共享 Popover 展示设备发现列表与当前会话准备状态；发现不代表服务已连接。选择操作调用主进程准备入口，设备安装、修复、启动及清理由 Tools 负责。无会话不发起连接；已有回放的切换和破坏性修复使用主进程签发的单次确认。

顶部入口、Composer 和 right-rail Capture 共享 sessionDeviceStore 中按 scope/generation/revision 接受的主进程投影；不保留全局 selectedDevice 或右栏独立设备草稿。两个 feature 不横向引用，通用准备状态通过 pattern 和 store 组合。原始诊断仅在 Details 中展开，不能作为菜单设备名或错误标题。

Popover 负责视口内定位、Escape 和焦点返回；设备列表支持方向键、Home/End、实际选中态和禁用状态。局部 UI 或 Browser fixture 不能替代真实 Android 安装、握手与设备呈现回执。
