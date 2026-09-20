# Browser App Surface（debug-only）

Browser 与桌面 Electron 共用同一套 renderer、`ElectronAPI` 产品接口、main runtime、状态目录与权限语义。允许差异仅限 transport 和 Electron 原生窗口容器：

| 路径 | Transport | 鉴权 |
| --- | --- | --- |
| Desktop | `preload` → `ipcRenderer` → `ipcMain` | 进程内信任边界 |
| Browser | `BrowserAppBridge` → localhost HTTP/SSE → IPC handler registry | One-time `/qa` bootstrap → HttpOnly `rdcBridgeToken` cookie（同源 `/app`）；explicit Bearer for programmatic clients |

Authoritative entry: the launcher logs one-time `GET /qa?qaBootstrap=...`; consume it once to mint the bridge cookie, then redirect to clean `/app` **on the same bridge origin**. In `browser-dev`, Vite is reverse-proxied through the bridge（含 HMR WebSocket）；浏览器不得直接打开 Vite 端口，也不再经跨端口 challenge / `rdcBridgeOrigin` query。Only `RDC_AGENT_BROWSER_QA=1` starts this surface; missing, repeated, or invalid bootstrap returns 401. JSON bodies are capped at 1 MiB，唯一例外是 `conversation:stageAttachments`（经 `x-rdc-invoke-channel` 与 payload.channel 一致校验后上限 96 MiB），用于 Browser QA 的 bytes 拖放/粘贴/隐藏 file input。

## 单轨接口

- `browser-dev` 只将文档入口 `/app` / `/app/` 映射到 Vite 根；`/app/App.tsx` 等真实模块路径保持原样。Vite 开发期 CSS HMR 经 `devStyles.ts` 写入 constructable stylesheet，保留 `style-src 'self'` 与 `style-src-attr 'none'`，不放宽为 inline 样式。

- `src/shared/renderer-api/` 是唯一 `ElectronAPI` 工厂与 channel manifest；Desktop 和 Browser 各自只实现 transport。
- manifest 中的全部 invoke channel 必须存在 main handler；启动时 `assertRendererIpcParity` fail-closed 校验。
- Browser bridge 仅接受 canonical manifest 中且已登记 capability 并已注册的 channel。未知、内部、未注册 channel 与不存在的明文 `settings:getProviderSecret` 返回 403。capability 映射是闭合 Record，禁止默认 `mutation` fallback。
- 事件流采用携带 cookie 的同源 `POST /events` fetch，保留 SSE 帧格式；不依赖原生 EventSource GET 的 Origin 行为。断流只重接同一事件流，不轮询应用状态；401/403 停止重连，最后订阅移除后 abort，迟到帧不得派发。
- Cookie 认证的 `/invoke`、`/events`、`/api/*` 必须带精确 Origin。`browser-dev` 同源反代 Vite 时不得把 cookie / authorization / `x-rdc-*` 转给上游。
- Secret 只可提交给主进程；renderer 只读取 `{ hasSecret, maskedPreview? }`，不得获得明文。
- 两个 Capture 图像读取 channel 在 Browser JSON transport 中严格解析 Node Buffer 的 `{ type: 'Buffer', data: byte[] }`，还原为 `Uint8Array`；非法字节拒绝。Desktop 仍使用原有字节返回类型，组件不感知 transport 差异。

## 产品能力矩阵

| 能力 | Desktop | Browser |
| --- | --- | --- |
| Workbench / Project / Session / Run | ✅ | ✅ |
| Conversation / Stop / Rewrite / Tool Approval | ✅ | ✅ |
| Work Process / Trace / Workflow / Context Usage | ✅ | ✅ |
| Settings / Language / Appearance / Models Override | ✅ | ✅ |
| Provider connect / secret status / secret submission | ✅ | ✅ |
| Agents / Skills / MCP / Hooks / Policy | ✅ | ✅ |
| Capture / Context / Device / Knowledge | ✅ | ✅ |
| Runtime Log / Command Execute | ✅ | ✅ |
| Memory approval / write / delete | ✅ | ✅ |
| Hook/MCP trust / revoke / test | ✅ | ✅ |
| Electron 原生窗口 chrome | ✅ | 浏览器标签页容器 |

上述 Browser 能力仍受 main-owned Zod、PermissionPolicy、approval token、MCP trust、`safeStorage`、session ownership 与 shell policy 约束；parity 不等于绕过权限。`command:execute`、`settings:set`、`rdc-runtime:trustMcp`、`rdc-runtime:revokeMcp` 仅在 `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1` 时开放，否则 fail-closed。

## 状态与实例

Browser QA / Browser-dev 在未显式指定 `RDC_AGENT_USER_DATA` 且未设置 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 时默认使用经过校验的临时 `os.tmpdir()/rdc-agent/qa-*` userData，并在 `will-quit` 清理；显式路径或 canonical 开关才会共享真实数据。进入该 disposable 分支时，主进程同时把 `RDC_AGENT_HOME` 指到同一目录下的 `.rdc-agent`，使 provider 配置与 `userData/secrets` 落在同一隔离边界；launcher 会先清掉继承来的 `RDC_AGENT_HOME`，避免读到或写回真实 `~/.rdc-agent`。只有显式 `RDC_AGENT_USER_DATA` 或 `RDC_AGENT_USE_CANONICAL_USERDATA=1` 才落真实 `~/.rdc-agent`。两种载体不得同时占用同一目录；`instance.lock` 冲突应明确失败。涉及真实本机数据的验收必须显式指定 userData。

## 验证

- 契约：`createRendererApi.test.ts`、`bridgeSecurity.test.ts`、`BrowserAppBridgeServer.contract.test.ts`
- Smoke：`pnpm run smoke:agent-browser`
- Manual: run start:agent-browser, copy the complete one-time `/qa?qaBootstrap=...` URL from the latest log, and verify real Settings/Project/Session/usage, language persistence, and parity. Check high-risk channels both without and with `RDC_AGENT_BROWSER_QA_FULL_ACCESS=1`; use explicit canonical userData only for an authorized real-data flow.

## Capture Replay QA

capture:getReplayState/getReplaySelection/listReplayHistory/readReplayImage/readLivePreview 为只读面；applyReplayEvent/refreshFrame 为 mutation；clearReplayHistory 为 high-impact，复用共享 channel capability 表。状态事件为 capture:replayChanged，包含完整 scope/generation/revision，不含像素。QA 应覆盖跨 session 迟到结果、运行锁、非空回放与 RDC 归零原空态。真实 Android 显示验收必须来自设备屏幕与原生回执，不以 Browser 图片或 local export 代替。
