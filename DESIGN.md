# RDC-Agent UI/UX 设计原则

本文件是本仓库 UI/UX 的上位原则。权威链：[ARCHITECTURE.md](ARCHITECTURE.md)（产品边界、运行时不变量、验证契约）> 本文（原则）> [`docs/ui/design-system.md`](docs/ui/design-system.md)（刻度、token、组件规则）> 主题文档。文档清单见 [`docs/ui/README.md`](docs/ui/README.md)。

## 视觉定位

**视觉定位（裁决）**：RDC-Agent 是 restrained、高密度、实色分层的精密工具，参照 VS Code / JetBrains / Linear 的信息密度与克制程度。每一处视觉选择都服务于聚焦与快速研判：不使用装饰性动效或插画；层次由 1px 边框与实色表面建立，阴影只用于 popover 与 modal；除模态全屏遮罩外禁止毛玻璃；单一 accent 只承担 focus / selected / primary CTA。该定位是 `docs/ui/design-system.md` 全部刻度的上位依据，冲突时以本段为准。

## Token 合规

组件 CSS 只使用语义 token 与刻度变量；primitive `--color-*`、hex 字面量、px 字号 / 间距 / 圆角、`!important` 与字面量 `blur(...)` 一律禁止，豁免仅限 token 定义层与全局 chrome 层。规则细节与迁移对照见 design-system.md，门禁：`pnpm run check:design-tokens`。受门禁锁定的 renderer 文件路径集中登记在 [`scripts/fidelity/renderer-contract.json`](scripts/fidelity/renderer-contract.json)。组件结构和依赖方向遵循 ARCHITECTURE.md 的 Renderer 架构。

## 权限切换反馈

权限选择显示正在保存与主进程确认的生效状态，不把乐观选择当作已执行授权；提示尚未开始的工具使用新权限、已启动命令继续。切换保留卡片身份、展开状态、草稿与焦点。规格见 workbench-and-transcript.md「权限挡位切换」。

## 失败与恢复

失败呈现让用户知道原因、影响范围和下一步；恢复动作直接作用于原因，保留已有输入与可验证结果，让局部失败停留在对应对象上。未完成或已失败时保持真实状态，不用成功提示掩盖，也不自动扩大操作范围。界面呈现并触发所属能力的恢复动作，不复制其决策；错误分类与资源清理由工程契约负责。

## Android 设备连接

选择设备即进入连续的检查、必要安装、启动与连接流程，正常路径不要求用户处理修复确认；可能需要手机授权时提示在设备上完成，不把推测显示成已检测到的状态。连接成功不等于 Capture 已打开；设备面板只负责设备操作，抓帧选择与打开归右侧 Capture 区域。规格见 workbench-and-transcript.md「右下角 Capture 内容」。

## Appearance 与安全呈现

Appearance chrome 和 Composer Agent accent 是两个明确体系。主题配置字段 chromeThemes、支持的 schemaVersion 与持久化约束见工程架构和 Appearance 文档。安全边界由主进程与 CSP 实施；style-src 禁止 inline，样式只走语义 token 和受控样式表，不以 UI 特效绕过安全要求。
