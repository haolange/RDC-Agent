# RDC-Agent UI/UX 设计原则

本文件是本仓库 UI/UX 的上位原则。权威链：[ARCHITECTURE.md](ARCHITECTURE.md)（产品边界、运行时不变量、验证契约）> 本文（原则）> [`docs/ui/design-system.md`](docs/ui/design-system.md)（刻度、token、组件规则）> 主题文档。文档清单见 [`docs/ui/README.md`](docs/ui/README.md)。

## 视觉定位

**视觉定位（裁决）**：RDC-Agent 是现代精密工作台，参照 Linear / Raycast / Arc 的完成度：工作区高密度、其余处从容。层次由分层实色表面、柔和 elevation 与 1px 半透明描边共同建立（卡片 elevation 1，浮层 2，Sheet 与对话框 3）；圆角宽松（控件 8、卡片 10、Sheet 18）；动效只为可追踪的状态变化服务（披露展开、选中指示器滑动、浮层进出、运行指示），时长 120–240ms，遵守系统减少动效；随应用分发 Inter 与 JetBrains Mono，中文落到系统字体。单一主题 accent 承担 focus、选中与主要动作；状态色只表达状态，灰色只表示「未开始或不做了」。侧栏、弹层与 chrome 保持实色，毛玻璃只用于模态全屏遮罩。该定位是 `docs/ui/design-system.md` 全部刻度的上位依据，冲突时以本段为准。

## Token 合规

组件 CSS 只使用语义 token 与刻度变量；primitive `--color-*`、hex 字面量、px 字号 / 间距 / 圆角、`!important` 与字面量 `blur(...)` 一律禁止，豁免仅限 token 定义层与全局 chrome 层。规则细节与迁移对照见 design-system.md，门禁：`pnpm run check:design-tokens`。受门禁锁定的 renderer 文件路径集中登记在 [`scripts/fidelity/renderer-contract.json`](scripts/fidelity/renderer-contract.json)。组件结构和依赖方向遵循 ARCHITECTURE.md 的 Renderer 架构。

## 可读性与信息卫生

- **字号下限**：可读文本不小于 12px。组件只引用排版角色（display / title / heading / body / reading / item / label / caption / overline / code），不引用原始字号；正文 14px，供人扫读的列表行（任务、设置列表、知识卡片）用 item 14px，控件与字段名 13px，说明 12px，回复与知识正文 15px。等宽字体只给代码、路径与数值。门禁 `pnpm run check:design-tokens` 拒绝非角色字号。
- **信息卫生**：界面只说用户能理解的话。内部 ID、协议名、错误码、Provider 标识与探测细节只出现在折叠的「诊断信息 / 技术详情」里；主进程产生的诊断按当前语言给出，不夹杂另一种语言。
- **首次使用**：不弹引导对话框。空工作台按真实配置列出仍缺的准备项（RDC 工具、模型服务、项目），每项直达对应设置或动作，全部完成后自然消失。
- **设计预览**：组件与组合的活文档是 `designs/rdc-agent-design-system`（`pnpm run design:dev`），它直接渲染生产组件；屏幕级验收用 `scripts/qa-walkthrough.mjs` 在真实运行状态下截图，改前改后成对比较。

## 权限切换反馈

权限选择显示正在保存与主进程确认的生效状态，不把乐观选择当作已执行授权；提示尚未开始的工具使用新权限、已启动命令继续。切换保留卡片身份、展开状态、草稿与焦点。规格见 workbench-and-transcript.md「权限挡位切换」。

## 失败与恢复

失败呈现让用户知道原因、影响范围和下一步；恢复动作直接作用于原因，保留已有输入与可验证结果，让局部失败停留在对应对象上。未完成或已失败时保持真实状态，不用成功提示掩盖，也不自动扩大操作范围。界面呈现并触发所属能力的恢复动作，不复制其决策；错误分类与资源清理由工程契约负责。

## Android 设备连接

选择设备即进入连续的检查、必要安装、启动与连接流程，正常路径不要求用户处理修复确认；可能需要手机授权时提示在设备上完成，不把推测显示成已检测到的状态。连接成功不等于 Capture 已打开；设备面板只负责设备操作，抓帧选择与打开归右侧 Capture 区域。规格见 workbench-and-transcript.md「右下角 Capture 内容」。

## Appearance 与安全呈现

Appearance chrome 和 Composer Agent accent 是两个明确体系。主题配置字段 chromeThemes、支持的 schemaVersion 与持久化约束见工程架构和 Appearance 文档。安全边界由主进程与 CSP 实施；style-src 禁止 inline，样式只走语义 token 和受控样式表，不以 UI 特效绕过安全要求。
