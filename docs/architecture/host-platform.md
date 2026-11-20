# 宿主平台模块

> 权威裁决：[`ARCHITECTURE.md`](../../ARCHITECTURE.md) 的 Product Boundary。本文说明宿主相关行为的唯一归属、各能力契约、门禁与 Linux 策略。对照：RDC-Tool 的 `rdc_tool/platform/`（`host.py` 是唯一读取 OS 的模块，各能力 = 共享逻辑 + Windows／POSIX 原语）。

## 定位

运行面是 Windows 与 Linux（x64）；发布面仍是 Windows-only（`electron-builder.json` 只有 `win`，`scripts/check-release-config.mjs` 不变）。

宿主相关行为只在 `src/main/platform/`：

- `host.ts` 是 `src/main` 中唯一读取 `process.platform` / `process.arch` 的模块，给出 `HostDescriptor`（`platform`、`arch`、`target`、`isWindows`、`isLinux`、`isMac`）。`target` 沿用 RDC-Tool 命名：`windows-x64`、`linux-x64`，其余宿主照实拼出（如 `darwin-arm64`）。
- 每个能力一个契约文件，Windows 与 POSIX 原语分文件；调用方只依赖契约。
- 测试用 `describeHost(platform, arch)` 注入另一宿主，或用 `currentHost()` 判断真实宿主能力，不分支 `process.platform`。
- 渲染层的平台信息只经 `src/preload/index.ts` 一处暴露（`createRendererApi` 的 `isMac` / `isWindows` / `isLinux`）。

## 盘点

状态词：**已跨平台**（逻辑本已覆盖两种宿主，本轮只把宿主判断收进平台模块）、**需 Linux 实现（本轮已实现）**、**仅 Windows 有意义**。

| 类别 | 状态 | 平台模块 | 调用方与说明 |
| --- | --- | --- | --- |
| 路径与目录 | 已跨平台 | `paths.ts` | 比较键（Windows NFC + 小写，POSIX 原样）收敛了 `knowledgeReadRoots.ts`、`_shared.ts`、`fileReadAccess.ts`、`knowledgeFs.ts`、`SessionArtifactSource.ts`、`ApprovedCaptureHost.ts`、`McpConnectionCoordinator.ts`、`ToolResourceArbiter.ts`、`PermissionReviewAuthority.ts`、`ConversationToolResourceRefs.ts`、`ipc/shellHandlers.ts`、`AgentManifestService.ts` 的各自实现；`~` / `%USERPROFILE%` 展开收敛了 `_shared.ts`、`GlobTool.ts`、`AgentPermissionPolicy.ts`、`settingsSanitize.ts`；另有长路径前缀、PATHEXT（`hookTrustFingerprint.ts`）、appData 默认（`AppPathService.ts`）、`%APPDATA%`（`GoogleApplicationCredentials.ts`）。PATHEXT、`%APPDATA%`、`\\?\` 前缀仅 Windows 有意义 |
| 进程身份与回收 | 需 Linux 实现（本轮已实现） | `process.ts`、`processWin32.ts`、`processPosix.ts` | `OwnedRdcDaemonRegistry.ts` 记录并比较 owner / daemon / worker 的 birth；`RdcSessionRuntime.ts` 从 daemon start 状态取 birth；`userDataInstanceLock.ts` 与 `directoryFileLock.ts` 记录 owner birth；`ProcessSupervisor.ts` 的子进程隔离与树终止。修复了 Linux 上 PID 复用使旧锁一直"被占用"、`EPERM` 被当成进程已死、以及 `MemoryStore.lock` 测试在 Linux 超时（pid 1 是 init）的问题 |
| Shell 与命令 | 已跨平台 | `shell.ts` | `ShellResolver.ts` 的候选解释器表、`AgentPermissionPolicy.ts` 与 `shellHardDeny.ts` 的默认方言、`shellTrailer.ts` 的 locale、`CodeInterpreterTool.ts` 的 `python` / `python3`、`ShellInvocationService.ts` 的 `.bat` / `.cmd` 解释器；`PromptPlanBuilder.ts`、`resolveConfiguredShell.ts`、`commands/builtins/status.ts` 经 `currentHost()` 报告宿主 |
| 密钥存储 | 需 Linux 实现（本轮已实现） | `secrets.ts` | `SecretStorageService.ts`：Linux 拒绝 `basic_text` 后端（见下文）；文件 0600 各宿主一致；`icacls` ACL 仅 Windows 有意义 |
| RDC 安装布局 | 需 Linux 实现（本轮已实现） | `rdcLayout.ts` | `rdc/rdcCliBinding.ts`（自 `src/shared` 迁入，因其依赖宿主布局且只有主进程调用）、`RdcInstallationService.ts`、`RdcCliInvokerService.ts`、`captures/adbExecutable.ts`、`OwnedRdcDaemonRegistry.ts`；Settings 与准备清单文案不再写 `python.exe` 或 Windows 专属包。安装器默认目录仅 Windows 有意义 |
| 窗口与菜单 | 已跨平台 | `host.ts` | `index.ts` 的 window-all-closed（macOS 保活）、`window/applicationMenu.ts` 的 macOS 菜单；`src/preload/index.ts` 是渲染层唯一平台暴露点 |
| 发布 | 仅 Windows 有意义 | — | `electron-builder.json`、`scripts/check-release-config.mjs`、CI 的 `desktop-smoke` / `release`；开发脚本（`scripts/launch-rdc-agent.mjs`、`smoke-*.mjs`）不在门禁范围 |

## 能力契约

### `paths.ts`

- `pathComparisonKey(value)`：已定形路径的比较键；`resolvedPathKey(value)`：绝对化后的比较键；`samePath(a, b)`。只有 Windows 折叠大小写与 Unicode 组合形式。
- `expandHomePath(value)`：各宿主展开 `~` 与 `~/…`；Windows 另展开 `~\…` 与开头的 `%USERPROFILE%`。
- `stripLongPathPrefix`、`defaultAppDataDir`、`roamingAppDataDir`（仅 Windows 返回 `%APPDATA%`）、`commandFileNames`（Windows 对裸命令名追加 PATHEXT）、`directoryLinkType`（Windows `junction`，其余 `dir`）。

### `process.ts`

- 进程身份 `ProcessIdentity = { pid, birth }`；birth 是 OS 创建时间，PID 复用后不会与记录相等。格式与 RDC-Tool 一致，`RdcProcessIdentity` 接受同样格式：
  - Windows：`windows-filetime:<创建 FILETIME>`，经 `%SystemRoot%` 下的系统 Windows PowerShell 读取，单次查询上限 5 秒；先用 `kill(pid, 0)` 排除不存在的 pid，不为已退出进程起查询。
  - Linux：`linux-start-ticks:<boot_id>:</proc/<pid>/stat 第 22 字段>`；状态 `Z` / `X` 视为已退出。没有 `/proc` 的 POSIX 宿主读不到 birth，身份为 unknown。
- `probeProcess(identity)` → `alive` / `exited` / `unknown`。读不到身份是 `unknown`：不当作已退出，不授权终止。空 birth 表示未记录，只按 pid 判断，活 pid 视为存活（fail-closed）。本进程从缓存的 `currentProcessIdentity()` 回答，不重复查询宿主。
- `currentProcessIdentity()`：本进程身份，读不到 birth 时为空串。Windows 上这需要一次 PowerShell 查询，在启动取得实例锁时进行并缓存。
- `terminateProcessTree(identity)`：杀前重新探测，只杀 `alive` 的身份，返回 `terminated` / `exited` / `unconfirmed`。Windows 用 `taskkill /T /F`；Linux 在目标自领进程组且不是本进程组时 `kill(-pgid, SIGKILL)`（daemon 与其 worker 同组），否则 `kill(pid, SIGKILL)`。
- `readProcessCommandLine(pid)`：Windows 经 CIM，Linux 读 `/proc/<pid>/cmdline`；读不到为 `null`，不作为退出证据。
- `signalChildProcessTree` / `isolatedChildSpawnOptions`：`ProcessSupervisor` 的子进程树；POSIX 子进程自成进程组（detached），Windows 强制终止整棵树。

持久记录中的身份：`owned-rdc-daemons.json` 的 `ownerBirth` / `daemonBirth` / `workerBirth` 来自 RDC-Tool daemon 状态（`owner_birth`、`birth`、`worker.birth`），worker 未运行时为空串；`instance.lock` 为 `{ pid, birth, mode, startTs }`；`.memory.lock` 等目录锁为 `{ pid, birth, createdAt }`，owner 记录在独占创建前生成。

### `shell.ts`

`shellCandidates`（Windows：真实 PowerShell 7 → Windows PowerShell 5.1；POSIX：合法 `$SHELL` → zsh → bash → sh）、`defaultShellKind`（解析失败时的策略方言）、`defaultPythonCommand`、`defaultShellLocale`、`requiresCommandInterpreter`、`windowsPowerShellPath`。探测与 fail-closed 规则仍在 `ShellResolver`。

### `secrets.ts`

`secretStorageUnavailableReason(safeStorage)` 给出拒绝写入凭据的原因或 `null`；`hardenSecretFile` 把凭据文件限制为当前用户（0600，Windows 另加 `icacls` ACL）。

### `fileIdentity.ts`

`openedFileIdentity(path)` 打开文件取句柄 stat，`sameFileState(a, b)` 比较设备号、inode、大小与两个时间戳。capture 哈希、外部 capture 引用和知识锁清理都用它判断"还是同一个文件"。

### `rdcLayout.ts`

`RDC_HOST_LAYOUTS` 镜像 RDC-Tool `rdc_tool/runtime_paths.py` 的 `HOST_LAYOUTS`：

| target | runtime_dir | Python | native library |
| --- | --- | --- | --- |
| `windows-x64` | `binaries/windows/x64` | `python/python.exe` | `renderdoc.dll` |
| `linux-x64` | `binaries/linux/x64` | `python/bin/python3.14` | `lib/librenderdoc.so` |

CLI 入口固定为 `<root>/cli/run_cli.py`。`rdcHostLayout()` 按宿主 target 选择布局，RDC-Tool 未提供的宿主报 `RDC_HOST_UNSUPPORTED`。安装根由捆绑 Python 路径去掉布局后缀得到（`rdcRootFromPython`），不按层数上溯；只有 Windows 布局大小写不敏感。检测候选：已配置的根，Windows 另加安装器默认 `%LOCALAPPDATA%/Programs/rdc-tool`；Linux 只检查已配置或用户选择的根（RDC-Tool 没有 Linux 安装器）。

## 门禁

`eslint.config.mjs` 的宿主平台门禁（`no-restricted-syntax`）覆盖 `src/main`、`src/shared`、`src/preload`（含测试），豁免 `src/main/platform/**` 与 `src/preload/index.ts`。禁止：

- `process.platform`、`process.arch`、`os.platform()`、`os.arch()`、从 `os` 导入 `platform` / `arch`；
- 读取 `APPDATA`、`LOCALAPPDATA`、`USERPROFILE`、`SystemRoot`（成员访问、计算属性或解构）；
- 字面量 `taskkill`、`powershell.exe`，以及含 `Get-CimInstance` 的字符串或模板。

字面量禁令只匹配宿主工具本身；`shellHardDeny` 检查的 PowerShell / cmd 命令文本是命令内容，不受影响。自检：`scripts/check-host-platform-gate.mjs` 证明每条规则在平台模块外拒绝、在模块内放行，作为行为门禁 "host platform gate" 运行（`pnpm run check:host-platform`，包含在 `check:gates`）。

## Linux 密钥策略

Linux 上 Electron `safeStorage.isEncryptionAvailable()` 在没有系统钥匙环时也返回 true，此时后端是 `basic_text`（硬编码密钥）。`getSelectedStorageBackend()` 为 `basic_text`（无钥匙环）或 `unknown`（尚未选定）时视为不可用：写入凭据 fail-closed，提示安装并解锁 Secret Service 钥匙环（GNOME Keyring 或 KWallet）后重启。`gnome_libsecret`、`kwallet`、`kwallet5`、`kwallet6` 可用。Windows 只检查 `isEncryptionAvailable()`，行为不变。

## CI

`build`（ubuntu）运行 node 与 renderer 两个测试项目，即 Linux 单元测试；`windows-unit` 在 windows-latest 经 Windows launcher 准备（与其它 Windows job 相同，补装 pnpm 不执行的 Electron 运行时）后运行 node 项目；`linux-smoke` 经 POSIX launcher 准备后在 `xvfb-run` 下运行 Browser QA smoke；`macos-shell` 保留 runtime / shell 子集（macOS 读不到 birth，相关身份为 unknown）。

`windows-unit` 把测试进程的 TEMP/TMP/TMPDIR 指到 runner 自有的长路径临时目录：runner 默认 TEMP 是 8.3 短路径，realpath 会展开它，路径身份断言因此不成立，这不是产品缺陷，也不放宽产品路径检查。手动触发（`workflow_dispatch`）没有 PR base 和上一次 head，门禁的比较基线取分支与默认分支的 merge-base。

文件身份只在句柄 stat 之间比较（`fileIdentity.ts` 的 `openedFileIdentity`）：较新的 Windows 版本按路径的 stat 走另一条系统调用，同一文件的路径 stat 与句柄 stat 可能报告不同的设备号、inode 或变更时间。路径 stat 只用于类型和链接检查。

## Linux 上的 CPU 回放

没有 GPU 的 Linux 机器可以用 Mesa 的 lavapipe（CPU 实现的 Vulkan 驱动）回放 Vulkan capture，前提是 capture 也在 lavapipe 上录制。[实机验证（lavapipe）]

- 同驱动 capture 可以回放：RDC-Tool 的 Linux 候选在 lavapipe 上打开 lavapipe 自录的 vkcube capture，事件树、像素值、Pixel History、SPIR-V 反汇编、最终输出图像与 SPIR-V 替换的 A-B-A 均通过；RDC-Agent 经 Settings 验证并应用该安装后，在本地设备上打开同一 capture 并切换事件，两次都有画面。录制方法见 RDC-Tool `docs/tool-convergence-tasks.md` 的阻塞表。
- 跨厂商 capture 不能回放：仓库里的 `vkcube.rdc` 录自 NVIDIA，lavapipe 以内存类型不匹配明确拒绝。这是 Vulkan capture 的可移植性限制，不是产品缺陷。
- 早先记录的"lavapipe 上回放崩溃"是 RDC-Tool 在 POSIX 上预加载 `librenderdoc.so`，使 RenderDoc 按捕获目标初始化；Linux 布局改为 `lib/librenderdoc.so` 后由 binding 的 RUNPATH 加载，已修复。

细节与数字见验收账本 2026-11-19 的 Linux 冒烟条目。
