# Composer

Composer 保留产品专属输入、附件、Agent 配置与运行态视觉；领域组件留在本 feature，不提升为通用 UI。架构与视觉权威仍为 `DESIGN.md` 和 `docs/ui/workbench-and-transcript.md`。

## 入口与所有权

- `Composer.tsx`：组合附件、输入与底栏，计算 accent 和会话作用域；菜单 registry 随项目/会话作用域重新挂载，防止旧会话菜单、焦点和 Effort 生命周期延续。
- `ComposerEditor.tsx`：受控书写区，接收文本、事件、Markdown 模式与 slash 菜单数据；不读取 store，也不复制 draft/send 状态。发送策略仍由 `useComposerSend` 负责，IME 确认与 Shift+Enter 不发送。
- `ComposerFooter.tsx`：组合附件按钮、Agent、Permission、Model/Effort、上下文用量和发送/停止按钮。Context Breakdown 展开设置由这里读取与写入，pattern 只接收值和回调。
- `useComposer.ts`：既有会话草稿、附件、发送/停止与运行态的唯一协调入口；子视图仅接收各自使用的字段。
- `pendingRequestSelection.ts`：从当前会话投影纯函数选择待处理请求，优先级为工具审批、计划审阅、用户提问。`useComposerPendingRequest` 订阅投影，`ComposerPendingRequest` 展示选中请求；计划 key 继续包含会话/turn/call/plan/revision/hash。
- 审批与提问的挂载身份包含 session、turn 和请求标识；提问另包含问题 fingerprint。提交在异步调用前同步锁定，失败后允许重试；旧请求完成不能修改新请求的错误、草稿或提交锁。`ComposerPendingRequest.test.ts` 从真实入口覆盖快速重复提交和跨请求完成顺序。

## 样式与动效

`composer-chrome.css` 按原顺序导入 shell、editor、toolbar、usage、Agent/model 控件、运行状态与窄宽样式；`composer-effort.css` 导入 permission、模型面板、Effort track/thumb、用户提问和 viewport 规则，审批和提问面板外壳归 `composer-pending-requests.css`。文件按职责命名，入口顺序是 cascade 合同，不按文件名排序。

`composer-motion.css` 保持独立且唯一：2.85 秒角度渐变光环、accent 和分层辉光不因组件拆分改变。Max timeline、退出交接与 Canvas field 继续由现有控制器驱动；关闭和卸载释放观察器、监听器和排队帧。附件、Markdown、计划审阅继续使用专属样式。

## 验证

运行本目录 Vitest、typecheck、lint，以及 `check:appearance`、`check:work-process`、`check:renderer-structure`、`check:design-tokens` 和 `check:session-projection`。关键自动化覆盖待处理请求优先级、IME、会话草稿隔离、发送失败恢复、菜单互斥、焦点回收、Popup observer 和 Max 迟到 completion。

真实 UI 另行确认光环、Active Signal、Effort 的持续动效、中文输入、附件、计划/Q&A、菜单、单行底栏渐隐和窄宽表现；自动化测试不能代替视觉验收。
