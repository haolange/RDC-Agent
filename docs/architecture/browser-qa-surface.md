# Browser QA Surface（debug-only）

Browser QA 与桌面 Electron **共用同一套 renderer**；差异仅在传输与 channel 面：

| 路径 | 传输 | 鉴权 |
| --- | --- | --- |
| Desktop | `preload` → `ipcMain` | 进程内信任边界 |
| Browser QA | `BrowserAppBridge` → `POST /invoke` | Bearer / query `rdcBridgeToken\|token` / cookie `rdcBridgeToken` |

权威短入口：`GET /qa` → Set-Cookie → 302 `/app`。仅 `RDC_AGENT_BROWSER_QA=1` 启动；**不进 release 默认路径**。

实现权威：`src/main/browserAppBridge/bridgeSecurity.ts`（allow/deny 正则）、`BrowserAppBridge.ts`（renderer 镜像 + deny stub）。

## 工作台主路径（应对齐）

| 能力 | Desktop | Bridge |
| --- | --- | --- |
| Workbench / Project / Session | ✅ | ✅ `project:*` `session:*` |
| Conversation Send / Stop / Rewrite / History | ✅ | ✅ 显式 allow 的 `conversation:*` |
| Work Process / Trace / Workflow | ✅ | ✅ `trace:*` `workflow:*` `run:*` |
| Settings 读 / Providers catalog / Effective model | ✅ | ✅ `settings:get*` 只读族 |
| Agents 编辑（`.agent.md` save） | ✅ | ✅ `settings:saveAgentDefinition` 等 |
| Capture / Context / Device / Knowledge | ✅ | ✅ 对应前缀 allow |
| Appearance / General `settings:set` | ✅ | ❌ 永久 deny（UI 显式桌面专用） |
| Provider secret 读写 | ✅ | ❌ `settings:getProviderSecret` deny；UI 禁用 |
| MCP trust / revoke | ✅ | ❌ `rdx-runtime:trustMcp` 等；UI 禁用 |
| Tool approval / Memory / Hook trust / command execute | ✅ | ❌ 永久 deny |
| PTY `terminal:*` | ✅ | ❌ deny（Agent Activity 抽屉走 `runtimeLog:*`，仍可用） |

## Deny 面 UX

Browser 模式下上述桌面专用入口必须 **禁用或隐藏并说明**，禁止仅靠 `Promise.reject` 看起来像故障。文案键：`browserQa.desktopOnly*`（`i18n.ts`）。

## 验证

- 契约：`bridgeSecurity.test.ts`、`BrowserAppBridgeServer.contract.test.ts`
- Smoke：`pnpm run smoke:agent-browser`
- 人工：`start:agent-browser` → 打开 `/qa` → 隔离 project 主路径 + deny 抽检
