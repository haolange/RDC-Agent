# RDC-Agent UI/UX Design System

## 项目概述

**RDC-Agent** 是一个RenderDoc调试的垂直Agent桌面应用，基于Electron + React + TypeScript构建。

**核心定位**:
- **Debugger**（首发）：调试渲染问题，通过多Agent协作分析.rdc文件
- **Analyzer**（占位）：性能分析（Coming Soon）
- **Optimizer**（占位）：优化建议（Coming Soon）

---

## 设计理念

### 设计方向
- **风格**: Linear + VS Code + Cyberpunk Tech 融合
- **氛围**: 专业、技术感、可信赖
- **适用场景**: 长时间调试工作，需要清晰的视觉层次和舒适的阅读体验

### 核心原则
1. **深色优先**: 减少眼部疲劳，适合开发环境
2. **清晰层次**: 信息架构明确，重要信息突出
3. **流畅反馈**: 丰富的动画和过渡效果
4. **专业质感**: 避免花哨，注重细节打磨

---

## 设计系统

### 颜色系统

#### Primary Color Scale - Indigo/Cyan tech gradient
```css
--color-primary-50: 235 241 255
--color-primary-100: 215 228 255
--color-primary-200: 180 205 255
--color-primary-300: 130 172 255
--color-primary-400: 80 135 255
--color-primary-500: 59 99 255    /* 主品牌色 */
--color-primary-600: 48 79 255
--color-primary-700: 45 62 230
--color-primary-800: 38 53 184
--color-primary-900: 35 49 144
```

#### Cyan Accent - For highlights and active states
```css
--color-accent-50: 236 253 255
--color-accent-100: 207 250 255
--color-accent-200: 165 243 252
--color-accent-300: 103 232 249
--color-accent-400: 34 211 238
--color-accent-500: 6 182 212     /* 强调色 */
--color-accent-600: 8 145 178
--color-accent-700: 14 116 144
--color-accent-800: 21 94 117
--color-accent-900: 22 78 99
```

#### Background Scale - Deep space dark
```css
--color-bg-0: 8 8 12        /* 最深背景 */
--color-bg-1: 13 13 20      /* 主背景 */
--color-bg-2: 18 18 28      /* 卡片背景 */
--color-bg-3: 24 24 38      /* 悬浮背景 */
--color-bg-4: 32 32 48      /* 高亮背景 */
--color-bg-5: 40 40 60      /* 边框背景 */
```

#### Text Colors
```css
--color-text-primary: 250 250 252       /* 主要文字 */
--color-text-secondary: 180 180 195     /* 次要文字 */
--color-text-tertiary: 120 120 140      /* 辅助文字 */
--color-text-muted: 80 80 100           /* 禁用文字 */
--color-text-disabled: 60 60 75         /* 不可用文字 */
```

#### Semantic Colors
```css
--color-success: 34 197 94      /* 成功 - 绿色 */
--color-warning: 251 191 36     /* 警告 - 黄色 */
--color-error: 248 113 113      /* 错误 - 红色 */
--color-info: 56 189 248        /* 信息 - 蓝色 */
--color-purple: 168 85 247      /* 紫色强调 */
--color-pink: 236 72 153        /* 粉色 */
--color-orange: 251 146 60      /* 橙色 */
```

#### Border Colors
```css
--color-border-subtle: 255 255 255 / 0.06
--color-border-default: 255 255 255 / 0.1
--color-border-strong: 255 255 255 / 0.15
--color-border-focus: rgb(var(--color-accent-500))
```

### 字体系统

#### 字体族
```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
--font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace
```

#### 字号规范
```css
--text-xs: 11px      /* 标签、徽章 */
--text-sm: 12px      /* 辅助文字 */
--text-base: 13px    /* 正文 */
--text-md: 14px      /* 强调正文 */
--text-lg: 16px      /* 小标题 */
--text-xl: 18px      /* 标题 */
--text-2xl: 20px     /* 大标题 */
--text-3xl: 24px     /* 页面标题 */
--text-4xl: 32px     /* 超大标题 */
```

#### 字重
```css
--font-normal: 400
--font-medium: 500
--font-semibold: 600
--font-bold: 700
```

#### 行高
```css
--leading-none: 1
--leading-tight: 1.25
--leading-snug: 1.375
--leading-normal: 1.5
--leading-relaxed: 1.625
```

### 间距系统

基于4px网格系统：
```css
--space-0: 0
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px
--space-16: 64px
--space-20: 80px
--space-24: 96px
```

### 圆角系统
```css
--radius-none: 0
--radius-sm: 4px
--radius-md: 6px
--radius-lg: 8px
--radius-xl: 12px
--radius-2xl: 16px
--radius-full: 9999px
```

### 阴影系统
```css
--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.3)
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.3)
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.5), 0 4px 6px -4px rgb(0 0 0 / 0.4)
--shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.4)
--shadow-glow: 0 0 20px rgb(var(--color-accent-500) / 0.3)
--shadow-glow-strong: 0 0 30px rgb(var(--color-accent-500) / 0.5)
```

### 过渡动画
```css
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1)
--transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1)
--transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1)
--transition-slower: 500ms cubic-bezier(0.4, 0, 0.2, 1)
```

### Z-Index层级
```css
--z-base: 0
--z-dropdown: 100
--z-sticky: 200
--z-fixed: 300
--z-modal-backdrop: 400
--z-modal: 500
--z-popover: 600
--z-tooltip: 700
```

### 布局常量
```css
--header-height: 52px
--footer-height: 28px
--panel-width: 360px
--sidebar-width: 240px
```

---

## 动画关键帧

```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeInScale {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 5px rgb(var(--color-accent-500) / 0.3); }
  50% { box-shadow: 0 0 20px rgb(var(--color-accent-500) / 0.6); }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}
```

---

## 全局组件样式

### Button 按钮

**基础样式**:
```css
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
  color: rgb(var(--color-text-primary));
  background: rgb(var(--color-bg-3));
  border: 1px solid rgb(var(--color-border-default));
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
}

.button:hover:not(:disabled) {
  background: rgb(var(--color-bg-4));
  border-color: rgb(var(--color-border-strong));
}

.button:active:not(:disabled) {
  transform: translateY(1px);
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

**变体**:
```css
/* Primary */
.button-primary {
  background: linear-gradient(135deg, rgb(var(--color-accent-600)), rgb(var(--color-primary-600)));
  border-color: transparent;
  color: white;
}

.button-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, rgb(var(--color-accent-500)), rgb(var(--color-primary-500)));
  box-shadow: 0 0 20px rgb(var(--color-accent-500) / 0.4);
}

/* Secondary */
.button-secondary {
  background: rgb(var(--color-bg-2));
  border-color: rgb(var(--color-border-default));
}

/* Ghost */
.button-ghost {
  background: transparent;
  border-color: transparent;
}

.button-ghost:hover:not(:disabled) {
  background: rgb(var(--color-bg-3));
}

/* Danger */
.button-danger {
  background: rgb(var(--color-error) / 0.1);
  border-color: rgb(var(--color-error) / 0.3);
  color: rgb(var(--color-error));
}

/* Sizes */
.button-sm { padding: 4px 12px; font-size: 11px; }
.button-lg { padding: 12px 24px; font-size: 14px; }
```

### Input 输入框

```css
.input {
  width: 100%;
  padding: 8px 12px;
  font-family: var(--font-sans);
  font-size: 13px;
  color: rgb(var(--color-text-primary));
  background: rgb(var(--color-bg-2));
  border: 1px solid rgb(var(--color-border-default));
  border-radius: 6px;
  outline: none;
  transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.input:hover {
  border-color: rgb(var(--color-border-strong));
}

.input:focus {
  border-color: rgb(var(--color-accent-500));
  box-shadow: 0 0 0 3px rgb(var(--color-accent-500) / 0.1);
}

.input::placeholder {
  color: rgb(var(--color-text-muted));
}
```

### Panel 面板

```css
.panel {
  background: rgb(var(--color-bg-1));
  border: 1px solid rgb(var(--color-border-default));
  border-radius: 8px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: rgb(var(--color-bg-2));
  border-bottom: 1px solid rgb(var(--color-border-default));
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--color-text-primary));
}

.panel-content {
  padding: 16px;
}
```

### Card 卡片

```css
.card {
  background: rgb(var(--color-bg-2));
  border: 1px solid rgb(var(--color-border-default));
  border-radius: 8px;
  padding: 16px;
  transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.card:hover {
  border-color: rgb(var(--color-border-strong));
}

.card-interactive {
  cursor: pointer;
}

.card-interactive:hover {
  background: rgb(var(--color-bg-3));
  border-color: rgb(var(--color-accent-500) / 0.3);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
```

### Badge 徽章

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
}

.badge-default {
  background: rgb(var(--color-bg-4));
  color: rgb(var(--color-text-secondary));
}

.badge-primary {
  background: rgb(var(--color-accent-500) / 0.15);
  color: rgb(var(--color-accent-400));
}

.badge-success {
  background: rgb(var(--color-success) / 0.15);
  color: rgb(var(--color-success));
}

.badge-warning {
  background: rgb(var(--color-warning) / 0.15);
  color: rgb(var(--color-warning));
}

.badge-error {
  background: rgb(var(--color-error) / 0.15);
  color: rgb(var(--color-error));
}
```

### Icon Button 图标按钮

```css
.icon-button {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--color-text-tertiary));
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.icon-button:hover {
  color: rgb(var(--color-text-primary));
  background: rgb(var(--color-bg-3));
}
```

### Status Dot 状态指示点

```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
}

.status-dot-success { background: rgb(var(--color-success)); box-shadow: 0 0 8px rgb(var(--color-success) / 0.6); }
.status-dot-warning { background: rgb(var(--color-warning)); box-shadow: 0 0 8px rgb(var(--color-warning) / 0.6); }
.status-dot-error { background: rgb(var(--color-error)); box-shadow: 0 0 8px rgb(var(--color-error) / 0.6); }
.status-dot-info { background: rgb(var(--color-info)); box-shadow: 0 0 8px rgb(var(--color-info) / 0.6); }
.status-dot-pending { background: rgb(var(--color-text-muted)); }
```

---

## 页面布局

### 整体布局结构

```
┌─────────────────────────────────────────────────────────────┐
│                        App Header                           │  52px
│  ┌─────────────┐  ┌─────────────────────┐  ┌─────────────┐ │
│  │ Logo/Brand  │  │ Tab Navigation      │  │ Actions     │ │
│  └─────────────┘  └─────────────────────┘  └─────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                      Main Content                           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                        App Footer                           │  28px
│  ┌──────────────────────────┐  ┌─────────────────────────┐ │
│  │ Status Info              │  │ Version Info            │ │
│  └──────────────────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### App Header 详细设计

**尺寸**: 高度52px，全宽
**背景**: rgb(var(--color-bg-1))
**边框**: 底部1px实线 rgb(var(--color-border-default))
**特殊效果**: 底部渐变边框线（从左到右：透明 → 青色 → 透明）

**布局结构**:
```
┌─────────────────────────────────────────────────────────────┐
│  ┌─────────────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Logo Icon + Text    │  │ [Tabs]       │  │ [Icons]   │  │
│  │ RD  RDC Agent       │  │ Debugger(*)  │  │ ⚙️  ?     │  │
│  │     RenderDoc...    │  │ Analyzer     │  │           │  │
│  └─────────────────────┘  └──────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Logo区域**:
- Logo图标: 28x28px，渐变背景（cyan到indigo），圆角6px
- 应用名称: 18px，粗体，白色
- 副标题: 12px，muted颜色，带背景pill

**Tab导航**:
- 容器: 圆角8px，bg-2背景
- Tab按钮: padding 8px 16px，圆角6px
- 激活状态: bg-3背景，底部渐变下划线
- Badge: 小圆角pill，青色背景

**拖拽区域**: 整个header支持窗口拖拽（-webkit-app-region: drag），按钮区域除外（no-drag）

### App Footer 详细设计

**尺寸**: 高度28px，全宽
**背景**: rgb(var(--color-bg-1))
**边框**: 顶部1px实线 rgb(var(--color-border-default))
**字体**: 11px，muted颜色

**内容**:
- 左侧: 状态指示点 + 连接状态 | Context: -- | Session: --
- 右侧: LLM: OpenRouter | v1.0.0

---

## 页面详细设计

### Debugger页面 - 欢迎状态

```
┌─────────────────────────────────────────────────────────────┐
│                      WorkflowPanel                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                      Welcome Screen                         │
│                                                             │
│    ┌─────────────────────────────────────────────────┐     │
│    │                                                 │     │
│    │              [Animated Logo]                    │     │
│    │                  RD                             │     │
│    │                                                 │     │
│    │         Welcome to RDC Agent                    │     │
│    │    Upload a RenderDoc capture file to start     │     │
│    │                                                 │     │
│    │    ┌─────────────────────────────────────┐     │     │
│    │    │         [Upload Zone]               │     │     │
│    │    │                                     │     │     │
│    │    │         [Upload Icon]               │     │     │
│    │    │     Drag & drop .rdc files          │     │     │
│    │    │     or click to browse              │     │     │
│    │    │                                     │     │     │
│    │    │         [Select Files Button]       │     │     │
│    │    │                                     │     │     │
│    │    └─────────────────────────────────────┘     │     │
│    │                                                 │     │
│    │    [Selected Files List]                        │     │
│    │                                                 │     │
│    │         [Start Debug Session Button]            │     │
│    │                                                 │     │
│    │    ─────────────────────────────────────        │     │
│    │    Recent Sessions                              │     │
│    │    [Session 1] [Session 2] [Session 3]          │     │
│    │                                                 │     │
│    └─────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**背景效果**:
- 中央径向渐变光晕（青色，透明度8%）
- 尺寸约800x800px，居中

**Logo动画**:
- 尺寸: 80x80px
- 背景: 渐变（cyan到indigo）
- 圆角: 16px
- 动画: float（上下浮动）+ pulse-glow（发光脉冲）

**标题样式**:
- 主标题: 24px，粗体，白色
- "RDC Agent"部分使用文字渐变（cyan到indigo）
- 副标题: 14px，secondary颜色

**Upload Zone**:
- 边框: 2px dashed，默认颜色border-default，hover时accent-500
- 圆角: 16px
- 内边距: 40px 32px
- Hover效果: 背景色变化 + 边框颜色变化 + 轻微放大
- Drag over效果: 背景accent-500/5 + 边框accent-500

**Upload Zone内部**:
- 图标: 64x64px，muted颜色，hover时accent-400 + 上移4px
- 主文字: 18px，semibold，白色
- 提示文字: 13px，tertiary颜色
- 按钮: primary样式

**Selected Files列表**:
- 容器: bg-2背景，圆角12px，边框
- 每个文件项: 横向布局（图标 | 文件名/路径 | 删除按钮）
- 图标: 40x40px，accent-500/10背景，accent-400图标色
- 删除按钮: hover时红色

**Start Debug Session按钮**:
- 尺寸: 较大，padding 12px 32px
- 样式: primary + 阴影
- Hover: 上移2px + 阴影增强

**Recent Sessions**:
- 标题: 11px，uppercase，tertiary颜色，带分隔线
- 会话项: 卡片样式，横向布局
- 包含: 图标 | 名称/日期 | 状态badge

### Debugger页面 - 工作状态

```
┌─────────────────────────────────────────────────────────────┐
│                      WorkflowPanel                          │
├────────────────┬──────────────────────┬─────────────────────┤
│                │                      │                     │
│                │                      │    EvidencePanel    │
│   AgentChat    │   AgentChat          │    (Timeline)       │
│                │   (continued)        │                     │
│   (Flexible)   │                      ├─────────────────────┤
│                │                      │                     │
│                │                      │    ArtifactViewer   │
│                │                      │    (File Browser)   │
│                │                      │                     │
└────────────────┴──────────────────────┴─────────────────────┘
```

**布局说明**:
- 三栏布局: 1fr | 360px | 320px
- 左侧: AgentChat（自适应宽度）
- 中间: EvidencePanel（固定360px）
- 右侧: ArtifactViewer（固定320px）
- 中间和右侧之间有1px分隔线

**响应式**:
- < 1400px: 右侧栏隐藏
- < 1200px: 中间栏变窄

---

## 组件详细设计

### 1. WorkflowPanel 工作流面板

**位置**: 页面顶部，全宽
**高度**: 自适应（约120-140px）
**背景**: 渐变（bg-1到bg-0）
**边框**: 底部1px

**内部结构**:
```
┌─────────────────────────────────────────────────────────────┐
│  Stage Timeline                                             │
│  ○──────○──────○──────○──────○──────○──────○               │
│  Preflight Intake Dispatch Specialist Investigation Verify Final│
│                                                             │
│  [Progress Bar ==================================>    70%]  │
│                                                             │
│  Current Stage: Preflight Pending    Events: 12    [Agent]  │
└─────────────────────────────────────────────────────────────┘
```

**Stage Timeline设计**:
- 7个阶段节点横向排列
- 每个节点: 36x36px圆形
- 节点状态:
  - Pending: bg-3背景，border-default边框，muted图标
  - Active: bg-0背景，accent-500边框，发光效果，脉冲动画
  - Completed: success/10背景，success边框，success图标
  - Blocked: error/10背景，error边框，error图标，抖动动画
- 连接线: 2px高度，默认border-default，完成部分success色

**节点图标**（使用SVG）:
- Preflight: 时钟图标
- Intake: 文件图标
- Dispatch: 播放/发送图标
- Specialist: 用户组图标
- Investigation: 搜索/放大镜图标
- Verification: 对勾圆圈图标
- Finalization: 完成旗帜图标

**进度条**:
- 高度: 3px
- 背景: bg-3
- 填充: 渐变（accent-500到primary-500）
- 动画: shimmer效果

**信息栏**:
- 左侧: Current Stage（高亮显示）
- 中间: Events数量（success色）
- 右侧: Blocker数量（如果有，error色）
- Agent活动指示器（如果有活跃Agent）

**Agent活动指示器**:
- 小卡片样式
- Agent头像（首字母 + 渐变背景）
- Agent名称 + 状态
- 打字动画（三个跳动点）

### 2. AgentChat 对话组件

**布局**: 垂直三栏（头部 | 消息区 | 输入区）

**头部**:
- 高度: 约52px
- 左侧: Agent选择器（头像 + 名称/角色）
- 右侧: 操作按钮（清除、设置）

**消息区**:
- 背景: bg-0
- 消息气泡:
  - 用户: 渐变背景（右对齐），圆角（左下小圆角）
  - Agent: bg-2背景，边框（左对齐），圆角（右下小圆角）
- 头像: 36x36px，用户灰色，Agent渐变
- 时间戳: 10px，muted颜色
- 工具调用: 内嵌卡片，显示工具名和执行状态

**输入区**:
- 背景: bg-1
- 输入框: 圆角pill形状，带边框
- 快捷操作栏: 横向滚动的小按钮
- 发送按钮: 渐变背景，圆形
- 提示文字: Enter发送，Shift+Enter换行

**空状态**:
- 大图标（聊天气泡）
- 标题 + 描述
- 建议问题chips（可点击）

**打字指示器**:
- 三个跳动的小圆点
- 动画: typing关键帧

### 3. EvidencePanel 证据链面板

**布局**: 垂直布局（头部 | 过滤器 | 时间线 | 详情）

**头部**:
- 标题: "Evidence Chain" + 文件图标
- 事件数量badge
- 导出按钮

**过滤器**:
- Chip按钮组，横向滚动
- 选项: All, Dispatch, Tools, Artifacts, Quality, Stages, Deviations
- 每个chip带颜色指示点

**时间线**:
- 左侧时间线（竖线 + 圆点）
- 按日期分组
- 每个事件:
  - 类型badge（带颜色）
  - 时间戳
  - 标题
  - Agent名称
  - 状态（可选）
- 事件类型颜色:
  - Dispatch: 蓝色
  - Tool Execution: 绿色
  - Artifact Write: 紫色
  - Quality Check: 黄色
  - Stage Transition: 青色
  - Deviation: 红色

**详情面板**:
- 点击事件后从底部滑出
- 显示完整事件信息
- JSON payload格式化显示

### 4. ArtifactViewer Artifact查看器

**布局**: 垂直布局（头部 | 工具栏 | 内容区）

**头部**:
- 标题: "Artifacts" + 文件夹图标
- 视图切换按钮（网格/列表）

**工具栏**:
- 面包屑导航
- 搜索框（focus时展开）

**内容区 - 网格视图**:
- 网格布局，自动填充
- 每个文件卡片:
  - 大图标（根据文件类型着色）
  - 文件名
  - 文件大小

**内容区 - 列表视图**:
- 表格形式
- 列: 名称 | 大小 | 修改日期
- 每行hover效果

**文件类型图标颜色**:
- YAML/JSON: 蓝色
- Markdown: 灰色
- Image: 紫色
- Other: 默认

**代码预览**:
- 语法高亮（简单实现）
- 关键字、字符串、数字不同颜色
- 等宽字体

---

## 交互设计

### 悬停效果
- 按钮: 背景色变化 + 轻微上移
- 卡片: 边框高亮 + 阴影增强
- 列表项: 背景高亮
- 图标按钮: 背景出现 + 颜色变化

### 点击反馈
- 按钮: 缩放0.98
- 卡片: 边框颜色变化
- 列表项: 选中状态指示器（左侧边框或背景）

### 加载状态
- 全局: 旋转Logo + 进度条
- 局部: 骨架屏或脉冲动画
- 按钮: loading状态（禁用 + spinner）

### 空状态
- 图标 + 标题 + 描述
- 建议操作按钮
- 柔和的颜色（muted）

---

## 技术规范

### 文件结构
```
src/renderer/
├── styles/
│   ├── design-system.css    # CSS变量和工具类
│   ├── global.css           # 全局样式
│   └── components.css       # 共享组件样式
├── features/
│   ├── debugger/
│   │   ├── WorkflowPanel/
│   │   ├── AgentChat/
│   │   ├── EvidencePanel/
│   │   └── ArtifactViewer/
│   ├── settings/
│   ├── projects/
│   ├── captures/
│   └── terminal/
├── shell/
├── ui/
├── patterns/
├── pages/
│   └── Debugger/
│       ├── index.tsx
│       └── Debugger.css
├── assets/
│   └── images/
│       ├── hero-bg.png
│       └── logo.png
└── App.tsx
```

### 命名规范
- CSS类名: kebab-case
- 组件名: PascalCase
- 变量名: camelCase
- 常量名: UPPER_SNAKE_CASE

### 样式组织
- 使用CSS变量统一管理设计令牌
- 组件样式使用BEM命名规范
- 动画使用GPU加速属性（transform, opacity）
- 支持 prefers-reduced-motion

### 浏览器兼容
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

---

## 图片资源

### 已生成图片
1. **hero-bg.png** - 欢迎页面背景
   - 尺寸: 1792x1024
   - 风格: 深色科技背景，几何网格，青色发光线条

2. **logo.png** - 应用Logo
   - 尺寸: 1024x1024
   - 风格: 现代极简，bug+放大镜组合，cyan/indigo渐变

---

## 实现优先级

### P0 - 核心功能
1. 设计系统CSS变量
2. 全局布局（Header/Footer）
3. WorkflowPanel基础显示
4. Debugger欢迎界面

### P1 - 主要功能
1. AgentChat完整功能
2. EvidencePanel时间线
3. ArtifactViewer文件列表
4. 所有交互动画

### P2 - 增强功能
1. 语法高亮
2. 拖拽上传
3. 响应式适配
4. 主题切换

---

*设计版本: 1.0*
*更新日期: 2026-04-01*
