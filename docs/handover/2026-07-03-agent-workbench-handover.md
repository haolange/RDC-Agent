# 项目交接文档

> 生成时间：2026-07-03（UTC+8）  
> 生成上下文：用户要求在 `D:\Projects\RDX\RDC-Agent` 完成「产品级 Agent Workbench 体验收敛」任务；本文档基于该会话的实际代码审查、浏览器走查、修复与验证结果整理。  
> 用途：粘贴到新 AI 聊天窗口即可继续开发，无需依赖旧会话记忆。

---

## 1. 项目基本信息

- **项目名称**：RDC-Agent（npm 包名 `rdc-agent`，产品名 `RdcAgent`）
- **项目目标**：构建面向 RenderDoc `.rdc` capture 的通用 Agent Workbench，同时保留 RDC/RDX 垂直调试能力；当前迭代目标是产品级体验收敛，对齐 Claude Desktop / Codex App 等主流 agent 产品的稳定性、显示与交互。
- **这个项目最终要解决什么问题**：让图形调试工程师在单一桌面工作台内，通过自然语言与多 profile agent（Ask/Plan/Edit/Debugger/Analyzer/Optimizer）协作，完成 `.rdc` 打开、证据分析、工具调用、报告生成与 RenderDoc 调试主链；要求可审计、可回放、fail-closed、不泄露 hidden CoT。
- **当前开发阶段**：功能主体已较完整；**当前处于「体验收敛 + 缺陷修复」阶段**。本轮 Workbench 修复与交接文档已提交至 `main`（见 §2.8）。
- **技术栈**：
  - 桌面：Electron 42 + electron-vite 5
  - 前端：React 18 + TypeScript 5 + Zustand 4
  - 构建：Vite 7、electron-builder
  - 校验：Vitest 4、自研 `scripts/check-*.mjs` 门禁
  - Markdown：react-markdown + remark-gfm
  - LLM SDK：openai（兼容多 provider adapter）
- **运行环境**：Windows 10/11（当前开发机 win32 10.0.22631）、macOS、Linux；Node.js + npm；Electron 桌面或 headless + BrowserAppBridge 浏览器会话。
- **主要依赖**（`package.json`）：
  - 运行时：`electron-store`, `openai`, `react-markdown`, `remark-gfm`, `uuid`, `yaml`, `zod`, `zustand`, `@xterm/xterm`
  - 开发：`electron`, `electron-vite`, `typescript`, `vitest`, `eslint`
- **项目所在目录**：`D:\Projects\RDX\RDC-Agent`
- **当前分支或版本状态**：
  - 分支：`main`（跟踪 `origin/main`，无 ahead/behind 信息在本次检查中确认）
  - 版本：`1.0.0`
  - 本轮 Workbench 体验收敛改动已提交（11 个源码/基线文件 + 本交接文档），详见 §2.8
  - 最近 5 条 commit：
    - `70488f5f` 收敛 reasoning artifact 与 Work Process 展示
    - `40742b16` 丝滑体验收敛
    - `bbda9e07` 修复消息重写、回答排版与 Grok 登录入口
    - `0ddd4126` Work Process / 上下文窗口 / 权限 / Composer 体验迭代与正式化清理
    - `01c08929` RDC-Agent 全面补齐
- **是否有线上部署**：否。Electron 桌面应用，打包产物在 `release/`。
- **是否涉及数据库**：否（无 SQL/NoSQL）。本地持久化使用 `electron-store` + 文件系统（workspace 下的 JSON、trace、settings 等）。
- **是否涉及第三方 API**：
  - LLM Providers（Anthropic、OpenAI、Gemini、Ollama、xAI 等，见 `src/shared/types/settings.ts` 的 `BuiltinLlmProviderId`）
  - xAI OAuth（Super Grok Account）
  - Web 工具（`web_fetch`, `web_search`）
  - 外部 RDX/RenderDoc CLI（用户配置，非内置）
- **是否涉及敏感配置或密钥**：是。Provider API Key、OAuth token、secrets 目录；**文档中一律写 `[REDACTED]`**。

---

## 2. 当前项目进度

### 模块 A：Agent Workbench 核心（会话 + Composer + Work Process）

- **状态**：主体已完成；本轮修复 **开发中（代码已写，浏览器复验未完成）**
- **相关文件**：
  - `src/main/conversation/ConversationService.ts` — 会话 turn 编排、preflight、fail-closed 诊断
  - `src/main/agent-runtime/agent/AgentLoop.ts` — agent loop、LLM 流式、tool 执行
  - `src/main/conversation/ConversationWorkTrace.ts` — Work Process 投影
  - `src/renderer/features/debugger/composer/Composer.tsx`
  - `src/renderer/features/debugger/composer/useComposerSend.ts`
  - `src/renderer/features/debugger/composer/composerSendHelpers.ts` **（本轮修改）**
  - `src/renderer/features/debugger/AgentChat/MessageBubble.tsx` **（本轮修改）**
  - `src/renderer/features/debugger/AgentChat/WorkProcess.tsx`
  - `src/renderer/features/debugger/AgentChat/workProcessPresentation.ts`
  - `src/renderer/app/App.tsx` **（本轮修改）**
  - `src/renderer/app/bootstrap/useIpcEventBridge.ts`
  - `src/renderer/stores/conversationStore.ts`
- **核心逻辑**：
  1. 用户在 Composer 输入 → `conversation:sendMessage` IPC/bridge invoke
  2. `ConversationService.startProfileTurn` 创建 user + assistant draft，异步 `completeProfileTurn`
  3. 无 provider 时 preflight 快速 fail-closed，写入 `ConversationWorkTrace` diagnostic + assistant content
  4. 事件经 `rendererEventHub` → BrowserAppBridge SSE → `useIpcEventBridge` → `conversationStore`
  5. UI 渲染：用户消息 → Work Process → 最终回答（DESIGN.md 三段式）
- **当前问题（已识别）**：
  - **P0（已写修复，待浏览器复验）**：BrowserAppBridge 下 `sendMessage` HTTP 响应晚于 SSE `message_completed` 到达时，`applyConversationTurnResult` 用 `status: 'streaming'` 的旧 snapshot 覆盖已完成消息，UI 永久显示「正在执行」。修复：`reconcileTurnMessages` 按 `updatedAt` 对账。
  - **P1（已写修复，待浏览器复验）**：有项目无会话时 Composer 隐藏但空态文案写「在下方输入」。修复：`showMainPromptBar={Boolean(currentProject)}`。
  - **P1（已写修复，待浏览器复验）**：fail-closed 诊断在 Work Process、assistant 正文、diagnostic 卡片三处重复。修复：`showDiagnosticBlock` 仅在 diagnostic 与 content 不同时渲染卡片。
- **下一步**：
  1. 启动 `npm run start:agent-browser`，复验无 provider 发送消息后 UI 是否实时变为「执行完成」
  2. 验证有项目无会话时 Composer 可见且首条消息可自动建 session
  3. **不确定**：Electron 可见窗口路径是否同样受竞态影响（逻辑相同，但未在本轮实测）

---

### 模块 B：Settings — Providers / Agents / 路由

- **状态**：已完成（基线）；Agents 页 legacy 锚点已清理
- **相关文件**：
  - `src/main/settings/SettingsService.ts`
  - `src/main/settings/DebuggerLlmService.ts`
  - `src/main/settings/ProviderAccountAuthService.ts`
  - `src/main/settings/AgentManifestService.ts`
  - `src/renderer/features/settings/SettingsModal/sections/AgentsSettings.tsx` **（本轮修改）**
  - `src/renderer/features/settings/SettingsModal/SettingsModal.css` **（本轮修改，删 ~200 行死 CSS）**
  - `src/shared/types/settings.ts`
- **核心逻辑**：Provider 账户/API Key 配置 → model route → agent profile 绑定；无 route 时 conversation preflight 失败并给出 `CONVERSATION_LLM_ROUTE_MISSING` 类诊断。
- **当前问题**：
  - Settings > Agents 旧版 fidelity 隐藏 span 已删除；`check:settings-agents` 仍通过
  - **P2**：`window.electronAPI.settings.update is not a function` — 在 browser CDP 直接调用时报错（不确定是 bridge API 未暴露还是方法名不同）；**通过 UI 切换主题正常**
- **下一步**：若需 headless 自动化改 settings，应对照 `src/renderer/platform/browserAppBridge/BrowserAppBridge.ts` 与 `src/preload/api/settings.ts` 补齐 bridge 面

---

### 模块 C：BrowserAppBridge（headless 浏览器真实会话）

- **状态**：可用；有已知边界
- **相关文件**：
  - `src/main/browserAppBridge/BrowserAppBridgeServer.ts`
  - `src/main/browserAppBridge/rendererEventHub.ts`
  - `src/renderer/platform/browserAppBridge/BrowserAppBridge.ts`
  - `scripts/start-browser-session.cmd`
- **核心逻辑**：`RDC_AGENT_HEADLESS=1` 启动主进程 → HTTP bridge（默认端口 `5127`，可 `RDC_AGENT_BROWSER_BRIDGE_PORT`）→ 浏览器打开 `http://127.0.0.1:<port>/app`；invoke 走 HTTP POST，事件走 SSE。
- **已验证可用**：
  - bridge 启动、Settings Providers/Agents 页面渲染
  - 深浅主题 UI 切换
  - 窄屏布局（走查做过）
  - 无 provider 时后端 fail-closed（刷新后历史正确）
  - SSE 事件确实到达浏览器（3ms 内 `message_patched` + `message_completed`）
- **未验证 / 边界**：
  - **P2 headless 原生对话框**：点击「添加项目」调用 `dialog:selectDirectory`，可能在宿主桌面弹出不可见/游离系统对话框，浏览器用户无反馈； workaround：CDP 调用 `window.electronAPI.project.add(path)`
  - Live provider turn：**未验证**（无真实 API Key，只能 fixture/test mode）
- **下一步**：headless 下 dialog 是否应 fail-fast 返回 null + UI toast — **本轮刻意未改**（避免改变 Electron 主路径行为）；若要做，改 `src/main/ipc/shellHandlers.ts` 并在 headless 分支短路

---

### 模块 D：RDX / RenderDoc 垂直能力

- **状态**：架构已完成；产品 smoke 需用户配置 CLI
- **相关文件**：
  - `src/main/tools/RdxShellActionService.ts`
  - `src/main/tools/ShellInvocationService.ts`
  - `src/main/sessions/RdxSessionService.ts`
  - `src/main/captures/*`
- **核心逻辑**：**不内置 RDX 工具链**；用户必须在 Settings 配置 shell action → `ShellInvocationService` 调用系统 CLI。`.rdc` 打开入口仅在 session context panel（DESIGN.md 硬性规定）。
- **当前问题**：本轮未做 `.rdc` 真实打开 smoke
- **下一步**：配置 RDX CLI 后验证 capture 库、open/preview、fail-closed 诊断

---

### 模块 E：Agent Runtime / Provider 适配层

- **状态**：已完成（门禁通过）
- **相关文件**：
  - `src/main/agent-runtime/agent/AgentLoop.ts`
  - `src/main/agent-runtime/providers/*`
  - `src/main/agent-runtime/reasoning/ReasoningArtifacts.ts`
  - `src/main/workflow/debugger/AgentOrchestrator.ts`
  - `src/main/agent-trace/*`
- **核心逻辑**：唯一 runtime 路径 = agent loop（resolve profile → LLM → tools → loop）；thinking 仅作 `ThinkingArtifact`，不 persist hidden CoT。
- **当前问题**：三个并行 code-review 子 agent 曾派出，**不确定是否全部返回结构化 issue 列表**（会话末尾被截图中断）
- **下一步**：人工 spot-check `AgentOrchestrator.ts` 中与 `RDC_AGENT_TEST_MODE` 相关的 E2E hook；非 test mode 路径保持 production 行为

---

### 模块 F：项目 / 会话 / 侧边栏

- **状态**：基本完成；无障碍小修已做
- **相关文件**：
  - `src/renderer/features/projects/Sidebar/ProjectGroup.tsx` **（本轮修改：chevron aria）**
  - `src/renderer/i18n.ts` **（新增 `sidebar.toggleProjectSessions`）**
  - `src/main/ipc/projectSessionHandlers.ts`
- **当前问题**：
  - `sidebar.newTask` i18n key **疑似 dead code**（transcript 提到 renderer 未使用）— **不确定是否仍需要**
  - 新建会话入口：项目行「…」菜单 → 新建会话；修复 Composer 后应可「直接输入自动建会话」
- **下一步**：确认 `useComposerSend` 在无 session 时是否已调用 `session.create`（**不确定**，需读代码确认）

---

### 模块 G：验证门禁与测试

- **状态**：**全部通过**（2026-07-03 本机复跑）
- **必跑命令及结果**：

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | ✅ OK |
| `npm run check:reasoning-delivery` | ✅ OK |
| `npm run check:work-process` | ✅ OK |
| `npm run check:work-process-tool-coverage` | ✅ OK (27 tools) |
| `npm run check:architecture` | ✅ OK |
| `npm run check:fidelity` | ✅ OK (1078 classes, 157 testids) |
| `npm run check:shared-exports` | ✅ OK (524 symbols) |
| `npm run check:provider-system` | ✅ OK |
| `npm run check:agent-runtime` | ✅ OK |
| `npm run check:settings-agents` | ✅ OK |
| `npm run build` | ✅ OK |

- **单元测试**：Vitest，`src/**/*.test.ts` 约 20 个文件；`composerSendHelpers.test.ts` 存在 — **不确定是否已覆盖 `reconcileTurnMessages`**
- **下一步**：补 `reconcileTurnMessages` 单测；浏览器复验后写最终报告

---

### 模块 H：本轮已提交改动清单（§2.8 详表）

- **状态**：**已提交至 main**（2026-07-03）

| 文件 | 变更要点 |
|------|----------|
| `src/renderer/features/debugger/composer/composerSendHelpers.ts` | 新增 `reconcileTurnMessages`，修复 SSE/invoke 竞态 |
| `src/renderer/app/App.tsx` | `showMainPromptBar` 从 `currentSession` 改为 `currentProject` |
| `src/renderer/features/debugger/AgentChat/MessageBubble.tsx` | `showDiagnosticBlock` 去重诊断卡片 |
| `src/renderer/features/projects/Sidebar/ProjectGroup.tsx` | chevron `title`/`aria-label`/`aria-expanded` |
| `src/renderer/i18n.ts` | `sidebar.toggleProjectSessions` 中英文 |
| `src/renderer/features/debugger/composer/Composer.tsx` | 删除 fidelity 隐藏 span |
| `src/renderer/features/settings/SettingsModal/sections/AgentsSettings.tsx` | 删除 fidelity 隐藏 span |
| `src/renderer/features/settings/SettingsModal/SettingsModal.css` | 删除废弃 `.settings-agent-*` 规则 |
| `src/renderer/styles/global/app-shell.css` | 删除废弃 composer agent menu CSS |
| `scripts/fidelity/fidelity-classnames.txt` | 基线同步 |
| `scripts/fidelity/fidelity-testids.txt` | 基线同步 |

---

### 已放弃 / 证明不可行 / 勿重复尝试

| 项 | 说明 |
|----|------|
| 通过延迟 SSE 修竞态 | 已证明根因是 invoke 响应覆盖；正确方案是 `reconcileTurnMessages` |
| 恢复 Composer 绑定 `currentSession` | 与主流 agent UX 冲突，已改 |
| 在 MessageBubble 始终显示 diagnostic 卡片 | 造成三重文案；已加条件渲染 |
| 为 fidelity 保留 hidden span 假锚点 | 违反 legacy cleanup；已删并更新 baseline |
| headless 下改 dialog 为 mock 路径（本轮） | 风险大于收益；Electron 主路径正常 |
| 声称 live provider turn 已通过 | **无 API Key，禁止声称** |

---

## 3. 文件结构说明

### 权威文档（修改前必读）

- `DESIGN.md`
  - **作用**：产品边界、Runtime Boundary、Work Process 契约、UI/UX、Design System、Verification Gate 的**唯一权威**
  - **当前状态**：稳定
  - **新 AI 注意**：任何与 `README.md`/`AGENTS.md`/`docs/*` 冲突时以本文件为准

- `AGENTS.md`
  - **作用**：仓库修改公约、browser session 边界、RDX CLI 边界、token/CSS 规则
  - **新 AI 注意**：UI 改动必须保真；禁止 legacy 双轨；必跑 check 脚本

- `docs/architecture/module-map.md`
  - **作用**：域 → 主文件 / shared 契约 / IPC / renderer / 验证方式 对照表

- `docs/architecture/agent-runtime-kernel.md`
  - **作用**：Agent runtime 设计边界（provider adapter、tool mediation、reasoning artifact）

---

### 入口文件

- `src/main/index.ts`
  - **作用**：Electron 主进程入口；userData 路径、`RDC_AGENT_HEADLESS`、BrowserAppBridge 启动、窗口创建
  - **关键**：`configuredUserDataPath = process.env.RDC_AGENT_USER_DATA`
  - **注意**：headless 会 `disableHardwareAcceleration`

- `src/preload/index.ts`
  - **作用**：`contextBridge.exposeInMainWorld('electronAPI', ...)`
  - **关键 API 域**：conversation, settings, project, session, workflow, trace, tool, llm, dialog...

- `src/renderer/app/App.tsx`
  - **作用**：React 根；Workbench 布局、store  wiring、`showMainPromptBar` 条件
  - **当前状态**：已改 Composer 可见性逻辑
  - **注意**：改布局前先读 `WorkbenchShell.tsx`

- `src/renderer/main.tsx`（标准 Vite 入口，未单独展开）
  - **作用**：挂载 React；browser 模式下注入 `BrowserAppBridge`

---

### 配置文件

- `package.json` — scripts、依赖、electron-builder 内联配置
- `electron.vite.config.ts` / `vite.renderer.config.ts` — 构建
- `tsconfig.json` — TS 路径别名 `@shared/*`
- `electron-builder.json`（若存在）/ `package.json` build 段 — 打包
- **运行时配置**：`<workspace-root>/settings.json`（非仓库内）

---

### 核心业务逻辑（主进程）

- `src/main/conversation/ConversationService.ts`
  - **作用**：`sendMessage`、`startProfileTurn`、`completeProfileTurn`、事件 emit、持久化
  - **关键函数**：上述 + `emitConversationEvent`、`persistConversationSnapshot`
  - **注意**：文件很大（千行级）；fail-closed 诊断在此生成

- `src/main/agent-runtime/agent/AgentLoop.ts`
  - **作用**：`agentLoop` / `streamAssistantResponseWithRecovery` / `executeToolCalls`
  - **注意**：所有 runtime 事件必须进 EventStream → WorkTrace 投影

- `src/main/workflow/debugger/AgentOrchestrator.ts`
  - **作用**：Debugger 工作流编排；含 `RDC_AGENT_TEST_MODE` E2E hook
  - **注意**：勿在生产路径保留 test-only 分支

- `src/main/settings/SettingsService.ts`
  - **作用**：加载/ sanitize `AppSettings`；provider、route、tooling

- `src/main/browserAppBridge/BrowserAppBridgeServer.ts`
  - **作用**：HTTP + SSE bridge；端口 `RDC_AGENT_BROWSER_BRIDGE_PORT` 默认 5127

---

### API / IPC 路由（非 HTTP REST，是 Electron IPC channel）

- `src/main/ipc/handlers.ts` — 聚合导出
- `src/main/ipc/conversationHandlers.ts` — `conversation:sendMessage` 等
- `src/main/ipc/settingsLlmHandlers.ts` — settings / llm
- `src/main/ipc/projectSessionHandlers.ts` — project / session / run
- `src/main/ipc/shellHandlers.ts` — `dialog:selectDirectory` 等
- `src/main/ipc/workbenchHandlers.ts` — workbench 初始化
- `src/main/ipc/invokeRegistry.ts` — bridge 与 IPC 共用 handler 注册

**新 AI 注意**：新增 IPC 必须同步 `src/shared/types/electron.ts`、`src/preload/api/*`、renderer 调用点、bridge invoke 列表。

---

### 数据库相关

- **无传统数据库**
- `src/main/sessions/StorageAdapter.ts` — 本地 JSON / store 抽象
- workspace 目录结构见 `README.md`「运行期目录映射」

---

### 前端页面 / Feature

- `src/renderer/app/WorkbenchShell.tsx` — 三栏布局 + Composer 槽位
- `src/renderer/features/debugger/AgentChat/ConversationThread.tsx` — 消息列表
- `src/renderer/features/debugger/AgentChat/MessageBubble.tsx` — 单条消息（**已改**）
- `src/renderer/features/debugger/AgentChat/WorkProcess.tsx` — Work Process UI
- `src/renderer/features/debugger/composer/Composer.tsx` — 输入区
- `src/renderer/features/settings/SettingsModal/*` — 设置弹窗
- `src/renderer/styles/design-system.css` — **semantic token 权威**；组件 CSS 必须用 `--token-*`

---

### 共享契约

- `src/shared/types/conversation.ts` — `ConversationMessage`, `ConversationWorkTrace`, stream events
- `src/shared/types/electron.ts` — `ElectronAPI` 全貌
- `src/shared/types/settings.ts` — `AppSettings`, provider ids
- `src/shared/constants/agents.ts` — 内置 agent 常量

---

### 工具脚本

- `scripts/start-browser-session.cmd` — agent 验证入口（build + headless electron）
- `scripts/start-rdc-agent-dev.cmd` — 人类开发（可见 Electron 窗口）
- `scripts/check-*.mjs` — CI/本地门禁
- `scripts/fidelity/*` — UI class/testid 基线

---

### 测试文件（部分）

- `src/renderer/features/debugger/composer/composerSendHelpers.test.ts`
- `src/main/conversation/ConversationService.workTrace.test.ts`
- `src/main/agent-runtime/agent/ErrorRecovery.test.ts`
- `src/preload/api/conversation.test.ts`

---

### 部署相关

- `npm run dist` → `release/` NSIS/DMG/AppImage
- **无云端部署**

---

## 4. 核心逻辑说明

### 4.1 用户请求从哪里进入？

**路径 A — Electron 桌面（人类用户）**  
Renderer → `window.electronAPI.*` → preload → `ipcMain.handle` → Main Service

**路径 B — Browser 真实会话（agent 验证）**  
Renderer → `BrowserAppBridgeClient.invoke` → HTTP → `BrowserAppBridgeServer` → 同一套 IPC handler registry → Main Service  
事件回程：Main → `rendererEventHub` → SSE → `useIpcEventBridge`

两条路径必须共享同一 main/runtime 能力（AGENTS.md 硬性要求）。

---

### 4.2 一次 Agent Turn 的数据流（通俗版）

1. **用户按发送**  
   Composer → `useComposerSend.handlePromptSend` → `electronAPI.conversation.sendMessage(request)`

2. **主进程接单**  
   `conversationHandlers` → `ConversationService.sendMessage`  
   - 若无 session：应创建 session（**需新 AI 确认 `useComposerSend` 是否已保证**）  
   - `startProfileTurn`：写入 user 消息 + assistant draft（常带 `status: 'streaming'`），**同步返回** TurnResult  
   - **异步**启动 `completeProfileTurn`

3. **Preflight（无 provider 时）**  
   `DebuggerLlmService` / route 解析失败 → 不调用真实 LLM → 构建 diagnostic workTrace → `commitTerminal` → emit `message_completed`  
   全程可能仅数毫秒。

4. **事件 vs 响应的竞态（本轮 P0 根因）**  
   - SSE 很快推送 `message_completed`（`status: 'complete'`）→ store 已更新  
   - 稍后 HTTP invoke 返回 TurnResult，其中 `messages` 仍含旧 `streaming` draft  
   - 旧逻辑 `setConversationMessages(result.messages)` **整表替换**，把 complete 打回 streaming  
   - UI：`hasActiveConversationTurn` 仍为 true → 「正在执行」永不结束  
   - **修复**：`reconcileTurnMessages` 按 message id + `updatedAt` 保留较新版本

5. **UI 渲染**  
   `conversationStore` → `ConversationThread` → `MessageBubble` + `WorkProcess`  
   Work Process 语义：每个 section = 一个 `llm_turn`；thinking 辅助，result 主语义；tool rows 是同一 loop 证据。

---

### 4.3 关键函数索引

| 阶段 | 函数 / 位置 |
|------|-------------|
| Turn 入口 | `ConversationService.sendMessage` |
| Turn 启动 | `ConversationService.startProfileTurn` |
| Turn 完成 | `ConversationService.completeProfileTurn` |
| LLM 流 | `AgentLoop.streamAssistantResponseWithRecovery` |
| Tool 执行 | `AgentLoop.executeToolCalls` |
| 事件 emit | `ConversationService.emitConversationEvent` |
| Renderer 订阅 | `useIpcEventBridge` → `handleConversationEvent` |
| Turn 结果落地 | `composerSendHelpers.applyConversationTurnResult` + **`reconcileTurnMessages`** |
| Work Process 投影 | `workProcessPresentation.buildWorkProcessPresentation` |

---

### 4.4 容易出 bug 的地方

1. **IPC/bridge 双路径契约漂移** — 只改 preload 不改 bridge client
2. **流式竞态** — invoke 响应 vs SSE（已修一处，rewrite/branch switch 仍需对账语义）
3. **sessionId 过滤** — 事件 session 与 UI 当前 session 不一致时 silently drop
4. **Work Process 投影** — runtime block kind 与 UI row 映射错误会违反 DESIGN.md
5. **headless dialog** — promise 悬挂、无 UI 反馈
6. **RDX CLI 未配置** — 必须 fail-closed 显示诊断，不能 fallback 内置命令

---

### 4.5 本轮已改逻辑及原因

| 改动 | 原因 |
|------|------|
| `reconcileTurnMessages` | 保留 SSE 终态，防止 invoke 旧 snapshot 覆盖 |
| `showMainPromptBar={Boolean(currentProject)}` | 空态文案与 Composer 可见性一致 |
| `showDiagnosticBlock` 条件 | 避免 diagnostic 与正文重复三遍 |
| 删除 hidden fidelity span | canonical UI + 干净 DOM |
| ProjectGroup a11y | chevron 无 accessible name |

---

### 4.6 为什么这样设计？

- **Main/Renderer 分离**：Electron 安全模型 + 重逻辑在主进程便于 tool/FS/CLI
- **EventStream + WorkTrace**：可审计 transcript，非 fake stage UI
- **Profile 驱动**：Ask/Plan/Edit 等是 `.agent.md` 配置，非 hardcoded mode 分支
- **Fail-closed**：无 provider/无 RDX 配置时必须可读诊断，禁止 silent failure
- **BrowserAppBridge**：agent 自动化验证不依赖 Electron 窗口，但连真实 main process

---

### 4.7 临时方案 / 技术债

| 项 | 说明 |
|----|------|
| headless dialog | 无 fail-fast；验证时用 `project.add(path)` bypass |
| bridge settings.update | CDP 直接调用失败，UI 正常 — API 面不一致 |
| `sidebar.newTask` dead i18n | 可能遗留，待清理 |
| browser-session-tmp/ | 运行产物，**勿提交**（当前 git status 有大量 untracked） |
| 三个 code-review 子 agent 结果 | **不确定**是否已合并进 issue 列表 |

---

## 5. 环境变量与配置

### 5.1 环境变量

- `RDC_AGENT_USER_DATA`
  - **用途**：Electron userData 目录；browser session 默认 `.\browser-session-tmp\user-data`
  - **是否必填**：否

- `RDC_AGENT_HEADLESS`
  - **用途**：`1` = 不创建可见主窗口，启动 BrowserAppBridge
  - **是否必填**：否（`start-browser-session.cmd` 会自动设为 1）

- `RDC_AGENT_BROWSER_BRIDGE_PORT`
  - **用途**：Bridge HTTP 端口
  - **是否必填**：否（默认 `5127`）

- `RDC_AGENT_TEST_MODE`
  - **用途**：`1` 启用 E2E hook、跳过部分加密、Orchestrator 测试分支
  - **是否必填**：否（仅测试）

- `RDC_AGENT_REBUILD_SETTINGS_ONLY`
  - **用途**：仅重建 settings 后退出（`scripts/rebuild-settings-only.cmd`）
  - **是否必填**：否

- `RDC_AGENT_WORKSPACE`
  - **用途**：覆盖 workspace root 路径
  - **是否必填**：否

- `RDC_AGENT_DISABLE_AUTOUPDATE`
  - **用途**：任意 truthy 值禁用自动更新
  - **是否必填**：否

- `RDC_AGENT_GROK_OAUTH_CLIENT_ID` / `GROK_OAUTH_CLIENT_ID` / `XAI_OAUTH_CLIENT_ID`
  - **用途**：Super Grok OAuth public client id（Settings 可留空若环境已提供）
  - **是否必填**：仅 Super Grok Account 登录时需要其一

- `RDC_AGENT_MODEL` / `RDC_AGENT_PROVIDER`
  - **用途**：Standalone CLI 指定模型/provider（`StandaloneCli.ts`）
  - **是否必填**：否

- `RDC_AGENT_DAEMON`
  - **用途**：Daemon 子进程标记
  - **是否必填**：否

- `RDC_AGENT_PRODUCT_SMOKE_PROJECT_ROOT` / `RDC_AGENT_PRODUCT_SMOKE_RDC_PATH`
  - **用途**：README 中的产品级 smoke 路径
  - **是否必填**：否（做 smoke 时必填）

- `RDC_WORKSPACE_ROOT`
  - **用途**：agent tool 层 workspace root fallback
  - **是否必填**：否

- `NODE_ENV`
  - **用途**：`development` vs `production`；影响 dev 模式判定
  - **是否必填**：否

- `RDX_ANDROID_ADB_PATH` / `ADB`
  - **用途**：Replay device ADB 路径
  - **是否必填**：否

---

### 5.2 应用内配置（非 env）

- **`<workspace-root>/settings.json`**
  - Providers、API keys（`[REDACTED]`）、model routes、agent bindings、theme、language
- **`<workspace-root>/profiles/*.agent.md`**
  - 用户可编辑 agent profile
- **Settings > Tools**
  - RDX shell actions（命令模板，非硬编码）
- **Secrets**
  - `<workspace-root>/secrets/` — 由 `SecretStorageService` 管理，`[REDACTED]`

---

## 6. 新 AI 接手后的推荐行动顺序

1. **读** `DESIGN.md` + `AGENTS.md` + 本文档 §2.8 未提交改动
2. **跑** §2 模块 G 全部 check + build（应全绿）
3. **启动** `npm run start:agent-browser`，打开控制台输出的 `/app` URL
4. **复验 P0/P1 修复**：
   - 无 provider 发送消息 → 实时「执行完成」+ 单一诊断文案
   - 新项目无 session → Composer 可见 → 发送后自动有 session
5. **决定** 是否 commit 当前 11 文件（用户未要求 commit 则先询问）
6. **补** `reconcileTurnMessages` 单测 + 最终体验报告
7. **可选** headless dialog fail-fast（P2，需产品确认）

---

## 7. 未能验证的边界（诚实声明）

- Live LLM provider turn（无 `[REDACTED]` API Key）
- 真实 `.rdc` + RDX CLI 全链路
- Electron **可见窗口**下 P0 竞态是否复现（理论同代码路径，**不确定**）
- 三个并行 code-review subagent 的完整 issue 清单（**不确定**是否已全部回收）
- 修复后浏览器 session 完整复验（会话末尾 screenshot 被用户中断）

---

## 8. 关键代码片段（便于新 AI 定位）

### reconcileTurnMessages（竞态修复）

文件：`src/renderer/features/debugger/composer/composerSendHelpers.ts`

```typescript
const reconcileTurnMessages = (currentMessages, turnMessages) => {
  const currentById = new Map(currentMessages.map((m) => [m.id, m]));
  return turnMessages.map((message) => {
    const existing = currentById.get(message.id);
    if (!existing) return message;
    const existingUpdatedAt = existing.updatedAt ?? existing.createdAt;
    const nextUpdatedAt = message.updatedAt ?? message.createdAt;
    return existingUpdatedAt > nextUpdatedAt ? existing : message;
  });
};
// applyConversationTurnResult 内：
setConversationMessages(reconcileTurnMessages(
  useConversationStore.getState().conversationMessages,
  result.messages,
));
```

### Composer 可见性

文件：`src/renderer/app/App.tsx`

```tsx
showMainPromptBar={Boolean(currentProject)}
```

### 诊断去重

文件：`src/renderer/features/debugger/AgentChat/MessageBubble.tsx`

```tsx
const showDiagnosticBlock = Boolean(
  message.diagnostic
  && message.diagnostic.userMessage.trim() !== (message.content ?? '').trim(),
);
```

---

## 9. 联系上下文

- 上一轮用户任务 transcript：`C:\Users\Vip\.cursor\projects\d-Projects-RDX-RDC-Agent\agent-transcripts\53606866-4b77-494d-9b22-186a3a374835\53606866-4b77-494d-9b22-186a3a374835.jsonl`
- 浏览器 session 临时数据：`D:\Projects\RDX\RDC-Agent\browser-session-tmp\`（勿提交）

---

*文档结束。如有与仓库实际状态冲突，以 `git status` 与 `DESIGN.md` 为准。*
