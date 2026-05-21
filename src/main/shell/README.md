# Shell

Electron shell 领域入口，覆盖窗口、菜单、系统对话框、剪贴板、打开路径、头像导入等桌面壳能力。

当前 IPC 注册入口是 `src/main/ipc/shellHandlers.ts`。本目录用于承接后续不依赖业务服务的 shell 能力。
