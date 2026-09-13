# UI 特性

<cite>
**本文引用的文件**
- [src/renderer/i18n.ts](file://src/renderer/i18n.ts)
- [src/renderer/hooks/useWindowControls.ts](file://src/renderer/hooks/useWindowControls.ts)
- [src/renderer/hooks/appShellBridge.ts](file://src/renderer/hooks/appShellBridge.ts)
- [src/renderer/styles/global.css](file://src/renderer/styles/global.css)
- [src/renderer/styles/design-system.css](file://src/renderer/styles/design-system.css)
- [src/renderer/patterns/CommandPalette/index.tsx](file://src/renderer/patterns/CommandPalette/index.tsx)
- [src/renderer/features/transcript/Debugger-2.css](file://src/renderer/features/transcript/Debugger-2.css)
- [src/shared/theme/composeAccent.test.ts](file://src/shared/theme/composeAccent.test.ts)
- [src/renderer/ui/Switch.css](file://src/renderer/ui/Switch.css)
- [src/renderer/styles/global/app-shell.css](file://src/renderer/styles/global/app-shell.css)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考量](#性能考量)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本文件聚焦 RDC-Agent 的 UI 特性实现，覆盖国际化、主题系统、窗口控制集成、命令面板、响应式设计与动画反馈。目标是帮助开发者与产品人员快速理解多语言切换、文本资源管理、动态语言加载、主题切换与样式隔离、CSS 变量体系、窗口控制桥接、命令面板交互、以及动画与用户反馈机制的设计与落地方式。

## 项目结构
UI 相关能力主要分布在以下位置：
- 国际化：src/renderer/i18n.ts 及 locales 目录（en、zh-CN）
- 主题与设计系统：src/renderer/styles/design-system.css、global.css、global 子目录
- 窗口控制：src/renderer/hooks/useWindowControls.ts、appShellBridge.ts
- 命令面板：src/renderer/patterns/CommandPalette/index.tsx
- 响应式与布局：src/renderer/styles/global/responsive.css、app-shell.css
- 动画与过渡：design-system.css 中的关键帧与工具类、Switch 等组件样式

```mermaid
graph TB
A["应用入口<br/>App"] --> B["国际化层<br/>i18n.ts"]
A --> C["主题与设计系统<br/>design-system.css / global.css"]
A --> D["窗口控制桥接<br/>useWindowControls.ts / appShellBridge.ts"]
A --> E["命令面板<br/>CommandPalette/index.tsx"]
C --> F["全局样式与响应式<br/>global.css / responsive.css / app-shell.css"]
C --> G["动画与过渡<br/>design-system.css"]
```

图表来源
- [src/renderer/i18n.ts:1-122](file://src/renderer/i18n.ts#L1-L122)
- [src/renderer/styles/global.css:1-12](file://src/renderer/styles/global.css#L1-L12)
- [src/renderer/styles/design-system.css:1-800](file://src/renderer/styles/design-system.css#L1-L800)
- [src/renderer/hooks/useWindowControls.ts:1-20](file://src/renderer/hooks/useWindowControls.ts#L1-L20)
- [src/renderer/hooks/appShellBridge.ts:1-31](file://src/renderer/hooks/appShellBridge.ts#L1-L31)
- [src/renderer/patterns/CommandPalette/index.tsx:1-70](file://src/renderer/patterns/CommandPalette/index.tsx#L1-L70)

章节来源
- [src/renderer/styles/global.css:1-12](file://src/renderer/styles/global.css#L1-L12)
- [src/renderer/styles/design-system.css:1-800](file://src/renderer/styles/design-system.css#L1-L800)

## 核心组件
- 国际化服务：集中管理翻译键与参数替换，提供 React Hook 以订阅当前语言并生成 t 函数
- 主题系统：基于 CSS 自定义属性的设计令牌，通过 data 属性切换明暗主题，语义化 token 统一消费
- 窗口控制：封装最小化、最大化切换、关闭等原生窗口操作，供 UI 调用
- 命令面板：内置命令列表与过滤逻辑，支持键盘输入与执行回调
- 响应式设计：媒体查询与布局适配，保证小屏下的可用性
- 动画与反馈：统一的缓动与时长变量，预置关键帧与工具类，配合可访问性开关

章节来源
- [src/renderer/i18n.ts:1-122](file://src/renderer/i18n.ts#L1-L122)
- [src/renderer/styles/design-system.css:1-800](file://src/renderer/styles/design-system.css#L1-L800)
- [src/renderer/hooks/useWindowControls.ts:1-20](file://src/renderer/hooks/useWindowControls.ts#L1-L20)
- [src/renderer/patterns/CommandPalette/index.tsx:1-70](file://src/renderer/patterns/CommandPalette/index.tsx#L1-L70)
- [src/renderer/features/transcript/Debugger-2.css:176-235](file://src/renderer/features/transcript/Debugger-2.css#L176-L235)

## 架构总览
下图展示 UI 特性在渲染进程内的协作关系：应用通过 i18n 获取本地化文案，通过 design-system 消费主题令牌，通过窗口控制桥接与宿主交互，命令面板作为快捷入口触发业务动作，响应式与动画贯穿各组件提升体验。

```mermaid
sequenceDiagram
participant App as "应用"
participant I18n as "国际化<br/>i18n.ts"
participant Theme as "主题系统<br/>design-system.css"
participant WC as "窗口控制<br/>useWindowControls.ts"
participant Bridge as "宿主桥接<br/>appShellBridge.ts"
participant CP as "命令面板<br/>CommandPalette"
App->>I18n : 读取当前语言并生成 t()
App->>Theme : 根据 data-resolved-theme 消费 token
App->>WC : 点击最小化/最大化/关闭
WC->>Bridge : 调用 minimize/toggleMaximize/close
Bridge-->>WC : 返回结果或无返回值
App->>CP : 打开命令面板并监听输入
CP-->>App : 执行命令回调
```

图表来源
- [src/renderer/i18n.ts:101-121](file://src/renderer/i18n.ts#L101-L121)
- [src/renderer/styles/design-system.css:199-299](file://src/renderer/styles/design-system.css#L199-L299)
- [src/renderer/hooks/useWindowControls.ts:4-18](file://src/renderer/hooks/useWindowControls.ts#L4-L18)
- [src/renderer/hooks/appShellBridge.ts:20-30](file://src/renderer/hooks/appShellBridge.ts#L20-L30)
- [src/renderer/patterns/CommandPalette/index.tsx:19-69](file://src/renderer/patterns/CommandPalette/index.tsx#L19-L69)

## 详细组件分析

### 国际化支持（多语言切换、文本资源管理、动态语言加载）
- 多语言切换
  - 通过 useI18n 钩子从设置中读取当前语言，并以 useMemo 缓存 t 函数，避免重复计算
  - 语言类型来自共享类型定义，确保键名安全
- 文本资源管理
  - 英文为基线资源，中文通过覆盖映射合并，减少重复定义
  - translate 函数支持键值查找与参数替换，未命中时回退到键名
- 动态语言加载
  - 当前实现为静态导入所有语言包；如需按需加载，可在保持相同导出结构的前提下将 import 改为动态 import，并在语言切换时刷新 t 函数

```mermaid
flowchart TD
Start(["进入界面"]) --> ReadLang["读取当前语言"]
ReadLang --> BuildT["构建 t(key, params)"]
BuildT --> Lookup{"查找翻译"}
Lookup --> |找到| Replace["参数替换"]
Lookup --> |未找到| Fallback["回退到键名"]
Replace --> Render["渲染文案"]
Fallback --> Render
Render --> End(["完成"])
```

图表来源
- [src/renderer/i18n.ts:93-112](file://src/renderer/i18n.ts#L93-L112)
- [src/renderer/i18n.ts:114-121](file://src/renderer/i18n.ts#L114-L121)

章节来源
- [src/renderer/i18n.ts:1-122](file://src/renderer/i18n.ts#L1-L122)

### 主题系统（主题切换、样式隔离、CSS 变量管理）
- 主题切换
  - 通过根节点 data-resolved-theme 切换明/暗主题，覆盖色板、阴影、表面与对比度
- 样式隔离
  - 采用三层令牌：原始色板 → 语义 token → 组件 token，组件仅消费语义 token，降低耦合
- CSS 变量管理
  - 设计系统集中声明 --color-*、--space-*、--token-* 等变量，并提供动画时长、圆角、阴影等基础值
  - 亮/暗主题分别覆盖关键变量，保证一致的可访问性与视觉层级

```mermaid
classDiagram
class 设计令牌 {
+原始色板 --color-*
+间距 --space-*
+字体 --font-*
+阴影 --shadow-*
+语义 token --token-*
}
class 主题切换 {
+data-resolved-theme="light"
+data-resolved-theme="dark"
}
class 组件样式 {
+使用 --token-*
+不直接使用十六进制
}
主题切换 --> 设计令牌 : "覆盖变量"
组件样式 --> 设计令牌 : "消费语义 token"
```

图表来源
- [src/renderer/styles/design-system.css:8-197](file://src/renderer/styles/design-system.css#L8-L197)
- [src/renderer/styles/design-system.css:199-299](file://src/renderer/styles/design-system.css#L199-L299)
- [src/renderer/styles/design-system.css:752-800](file://src/renderer/styles/design-system.css#L752-L800)

章节来源
- [src/renderer/styles/design-system.css:1-800](file://src/renderer/styles/design-system.css#L1-L800)

### 窗口控制集成（最小化、最大化、关闭）
- 使用 useWindowControls 暴露 handleWindowMinimize、handleWindowToggleMaximize、handleWindowClose
- 内部通过 appShellBridge 调用宿主 windowControls API，最大化后返回布尔状态用于更新 UI
- 适合嵌入标题栏或菜单项，提供一致的桌面端行为

```mermaid
sequenceDiagram
participant UI as "按钮/菜单"
participant Hook as "useWindowControls"
participant Bridge as "appShellBridge"
UI->>Hook : 点击事件
Hook->>Bridge : minimize()/toggleMaximize()/close()
Bridge-->>Hook : 返回结果(可选)
Hook-->>UI : 更新状态(如最大化标志)
```

图表来源
- [src/renderer/hooks/useWindowControls.ts:4-18](file://src/renderer/hooks/useWindowControls.ts#L4-L18)
- [src/renderer/hooks/appShellBridge.ts:20-30](file://src/renderer/hooks/appShellBridge.ts#L20-L30)

章节来源
- [src/renderer/hooks/useWindowControls.ts:1-20](file://src/renderer/hooks/useWindowControls.ts#L1-L20)
- [src/renderer/hooks/appShellBridge.ts:1-31](file://src/renderer/hooks/appShellBridge.ts#L1-L31)

### 命令面板（搜索、过滤、执行）
- 内置命令集合，支持按名称与描述模糊匹配
- 输入框自动聚焦，回车或点击执行回调并关闭面板
- 空结果提示友好，便于扩展更多命令

```mermaid
flowchart TD
Open["打开命令面板"] --> Focus["输入框自动聚焦"]
Focus --> Input["用户输入查询"]
Input --> Filter{"是否匹配?"}
Filter --> |是| Show["显示匹配项"]
Filter --> |否| Empty["显示无匹配提示"]
Show --> Execute["选择执行命令"]
Empty --> Close["关闭面板"]
Execute --> Close
```

图表来源
- [src/renderer/patterns/CommandPalette/index.tsx:19-69](file://src/renderer/patterns/CommandPalette/index.tsx#L19-L69)

章节来源
- [src/renderer/patterns/CommandPalette/index.tsx:1-70](file://src/renderer/patterns/CommandPalette/index.tsx#L1-L70)

### 响应式设计适配
- 通过媒体查询在小屏幕下调整布局方向、尺寸与定位策略
- 针对特定区域（如计划面板、审批条、进度指示）进行堆叠与拉伸优化
- 结合全局响应式样式，保证在不同视口下的可用性

章节来源
- [src/renderer/features/transcript/Debugger-2.css:176-235](file://src/renderer/features/transcript/Debugger-2.css#L176-L235)
- [src/renderer/styles/global/app-shell.css:59-95](file://src/renderer/styles/global/app-shell.css#L59-L95)

### 动画效果、过渡动画、用户反馈机制
- 统一动画时长与缓动变量，确保一致的节奏感
- 预置 fadeIn、slideInRight、pulse、shimmer、typing 等关键帧，配合工具类快速启用
- 可访问性：尊重 prefers-reduced-motion 与 data-reduce-motion，禁用不必要的动画
- 组件级反馈：开关、按钮、状态点等具备 hover/focus/active 状态与焦点环

章节来源
- [src/renderer/styles/design-system.css:152-184](file://src/renderer/styles/design-system.css#L152-L184)
- [src/renderer/styles/design-system.css:325-471](file://src/renderer/styles/design-system.css#L325-L471)
- [src/renderer/ui/Switch.css:1-90](file://src/renderer/ui/Switch.css#L1-L90)

## 依赖关系分析
- 国际化依赖设置存储与语言类型，提供 t 函数给各组件
- 主题系统被全局样式引入，并通过 data 属性驱动
- 窗口控制依赖宿主桥接，屏蔽平台差异
- 命令面板依赖国际化文案与样式系统

```mermaid
graph LR
I18N["i18n.ts"] --> UI["各组件"]
THEME["design-system.css"] --> UI
WC["useWindowControls.ts"] --> BRIDGE["appShellBridge.ts"]
CP["CommandPalette/index.tsx"] --> I18N
CP --> THEME
```

图表来源
- [src/renderer/i18n.ts:1-122](file://src/renderer/i18n.ts#L1-L122)
- [src/renderer/styles/design-system.css:1-800](file://src/renderer/styles/design-system.css#L1-L800)
- [src/renderer/hooks/useWindowControls.ts:1-20](file://src/renderer/hooks/useWindowControls.ts#L1-L20)
- [src/renderer/hooks/appShellBridge.ts:1-31](file://src/renderer/hooks/appShellBridge.ts#L1-L31)
- [src/renderer/patterns/CommandPalette/index.tsx:1-70](file://src/renderer/patterns/CommandPalette/index.tsx#L1-L70)

章节来源
- [src/renderer/i18n.ts:1-122](file://src/renderer/i18n.ts#L1-L122)
- [src/renderer/styles/design-system.css:1-800](file://src/renderer/styles/design-system.css#L1-L800)
- [src/renderer/hooks/useWindowControls.ts:1-20](file://src/renderer/hooks/useWindowControls.ts#L1-L20)
- [src/renderer/hooks/appShellBridge.ts:1-31](file://src/renderer/hooks/appShellBridge.ts#L1-L31)
- [src/renderer/patterns/CommandPalette/index.tsx:1-70](file://src/renderer/patterns/CommandPalette/index.tsx#L1-L70)

## 性能考量
- 国际化
  - 使用 useMemo 缓存 t 函数，减少重渲染开销
  - 建议未来按需加载语言包以降低首屏体积
- 主题
  - 通过 CSS 变量切换主题，避免 JS 频繁操作 DOM 样式
  - 语义 token 复用减少样式冗余
- 动画
  - 合理使用 transform/opacity 动画，避免重排
  - 尊重减少动效偏好，提升可访问性与性能
- 命令面板
  - 简单字符串过滤，数据量小时性能良好；若扩展大量命令，可考虑虚拟滚动与更高效的索引

[本节为通用指导，不直接分析具体文件]

## 故障排查指南
- 国际化
  - 现象：文案显示为键名
  - 排查：检查 translate 是否命中键；确认语言包已正确合并；参数占位符是否正确
  - 参考路径：[src/renderer/i18n.ts:101-112](file://src/renderer/i18n.ts#L101-L112)
- 主题
  - 现象：切换主题无效或颜色异常
  - 排查：确认根节点 data-resolved-theme 是否正确设置；检查是否误用十六进制而非 token
  - 参考路径：[src/renderer/styles/design-system.css:199-299](file://src/renderer/styles/design-system.css#L199-L299)
- 窗口控制
  - 现象：最小化/最大化/关闭无响应
  - 排查：确认宿主环境存在 windowControls API；检查 appShellBridge 调用链
  - 参考路径：[src/renderer/hooks/appShellBridge.ts:20-30](file://src/renderer/hooks/appShellBridge.ts#L20-L30)
- 命令面板
  - 现象：无法执行命令或无匹配项
  - 排查：检查 onExecute 回调是否注册；确认查询过滤逻辑
  - 参考路径：[src/renderer/patterns/CommandPalette/index.tsx:23-69](file://src/renderer/patterns/CommandPalette/index.tsx#L23-L69)
- 动画与可访问性
  - 现象：动画干扰或不符合预期
  - 排查：检查 prefers-reduced-motion 与 data-reduce-motion；确认是否启用了工具类
  - 参考路径：[src/renderer/styles/design-system.css:455-471](file://src/renderer/styles/design-system.css#L455-L471)

章节来源
- [src/renderer/i18n.ts:101-112](file://src/renderer/i18n.ts#L101-L112)
- [src/renderer/styles/design-system.css:199-299](file://src/renderer/styles/design-system.css#L199-L299)
- [src/renderer/hooks/appShellBridge.ts:20-30](file://src/renderer/hooks/appShellBridge.ts#L20-L30)
- [src/renderer/patterns/CommandPalette/index.tsx:23-69](file://src/renderer/patterns/CommandPalette/index.tsx#L23-L69)
- [src/renderer/styles/design-system.css:455-471](file://src/renderer/styles/design-system.css#L455-L471)

## 结论
本项目在 UI 层面形成了清晰的模块化与标准化体系：国际化提供安全的文案管理与参数替换；主题系统通过 CSS 变量与语义 token 实现高内聚、低耦合的样式治理；窗口控制桥接屏蔽平台差异；命令面板提供高效的操作入口；响应式与动画保障跨设备可用性与流畅体验。建议在后续迭代中继续遵循“优先语义 token、避免硬编码颜色”的原则，并逐步完善按需加载与可访问性增强。

[本节为总结，不直接分析具体文件]

## 附录

### 主题配置示例（说明）
- 在根节点设置 data-resolved-theme 为 light 或 dark 以切换主题
- 通过 design-system.css 中的 --token-* 语义变量消费主题值
- 组件样式应引用 --token-*，避免直接使用十六进制

章节来源
- [src/renderer/styles/design-system.css:199-299](file://src/renderer/styles/design-system.css#L199-L299)
- [src/renderer/styles/design-system.css:752-800](file://src/renderer/styles/design-system.css#L752-L800)

### 国际化文件结构（说明）
- 英文为基线语言包，中文通过覆盖映射合并
- 每个模块对应独立的翻译文件，便于维护与扩展
- 使用 translate(language, key, params) 进行文案渲染

章节来源
- [src/renderer/i18n.ts:45-99](file://src/renderer/i18n.ts#L45-L99)
- [src/renderer/i18n.ts:101-121](file://src/renderer/i18n.ts#L101-L121)

### 主题与强调色生成（说明）
- 强调色会根据主题进行亮度调节，保证可读性
- 测试用例验证了强调色的归一化、派生与主题调制逻辑

章节来源
- [src/shared/theme/composeAccent.test.ts:1-42](file://src/shared/theme/composeAccent.test.ts#L1-L42)