# RDC-Agent UI/UX 设计原则

本文件是本仓库 UI/UX 的上位原则与阅读入口。工程架构、产品边界、运行时不变量和验证契约以 [ARCHITECTURE.md](ARCHITECTURE.md) 为准。详细视觉刻度、组件状态与交互规格按下列主题文档维护，不在根目录复制。

## 视觉定位

**视觉定位（裁决）**：RDC-Agent 是 restrained、高密度、实色分层的精密工具，参照 VS Code / JetBrains / Linear 的信息密度与克制程度。每一处视觉选择都服务于聚焦与快速研判：不使用装饰性动效或插画；层次由 1px 边框与实色表面建立，阴影只用于 popover 与 modal。backdrop blur 只允许用在模态全屏遮罩（`--modal-backdrop` + `--modal-backdrop-filter`），把注意力压到弹层上；Dropdown / popover / chrome 仍为实色，禁止装饰性毛玻璃。单一 accent 只承担 focus / selected / primary CTA。该定位是 `docs/ui/design-system.md` 全部刻度的上位依据，冲突时以本段为准。

## Token 与组件

**Token 合规（裁决）**：组件 CSS 只允许语义 token 与刻度变量；primitive `--color-*`、hex 字面量、px 字号 / 间距 / 圆角、`!important` 一律禁止。`backdrop-filter` 禁止字面量 `blur(...)`；模态遮罩只能写 `var(--modal-backdrop-filter)`。豁免仅限 token 定义层与全局 chrome 层。门禁：`pnpm run check:design-tokens`。受门禁锁定的 renderer 文件路径集中登记在 [`scripts/fidelity/renderer-contract.json`](scripts/fidelity/renderer-contract.json)。

全局唯一按钮系统为 Button；状态使用 is-* 并配 aria-*。hover 必须有对应 focus-visible；禁用、选中、运行、失败和等待均须有明确表现。组件结构和依赖方向遵循 ARCHITECTURE.md 的 Renderer 架构。

## 权限切换反馈

权限选择显示正在保存与主进程确认的生效状态，不能把乐观选择当作已执行授权。生效提示说明“尚未开始的工具使用新权限”，明确全局作用域和已启动命令继续。切换保留卡片身份、展开状态、草稿与焦点；长英文、窄屏、大字号、深浅主题及键盘操作分别验收。

## Appearance 与安全呈现

Appearance chrome 和 Composer Agent accent 是两个明确体系。主题配置字段 chromeThemes、支持的 schemaVersion 与持久化约束见工程架构和 Appearance 文档。安全边界由主进程与 CSP 实施；style-src 禁止 inline，样式只走语义 token 和受控样式表，不以 UI 特效绕过安全要求。

## 主题文档

- [`docs/ui/workbench-and-transcript.md`](docs/ui/workbench-and-transcript.md) — Workbench 轨、Work Process、Composer、Markdown
- [`docs/ui/design-system.md`](docs/ui/design-system.md) — Token、按钮、颜色、组件规则、Appearance 双体系
- [`docs/ui/work-process-checklist.md`](docs/ui/work-process-checklist.md) — Work Process UI 验收清单
- [`docs/ui/appearance-checklist.md`](docs/ui/appearance-checklist.md) — Appearance / Provider/Composer 控件 / Effort 滑杆验收清单
- [`docs/ui/knowledge-center.md`](docs/ui/knowledge-center.md)
