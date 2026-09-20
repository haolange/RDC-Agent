# Appearance UI 验收清单

> 触发条件：Appearance / chrome / compose accent 改动后执行 `pnpm run check:appearance`。

## Appearance 面板

- System/Light/Dark 迷你窗口磁贴。
- 双栏视觉预览（非 JSON/代码块）。
- Light/Dark 编辑卡跟随 App chrome。
- 圆角色板+hex。
- 可读预设下拉（统一 pill Aa+名称触发体、菜单右缘贴合并向左延伸、caret 衔接 tip、实色 overlay 菜单、每项 Aa+勾选、足够宽度）。
- 多选 `Checkbox` / `CheckPill` 共用空心方框 + 字色勾；`Switch` 才是 accent 胶囊。
- Import/Copy `rdc-theme-v1:`。
- Preferences。

## 预览一致性

- 全局预览跟 chrome。
- Composer/Effort 仍跟 agent accent。
- Context Usage 弹层底色跟 chrome 编译的 `--color-surface-overlay` / `--token-bg-overlay`（分段色点仍用全局 `--token-context-*`）。

## 禁止项

- 不得残留验收脏色（如纯 `#ff0000`）。
- 不得残留伪 `ThemePreview: ThemeConfig` 文案。

## Provider/Model/Composer 控件验收

> 触发条件：Provider/model/Composer control 改动。

- `reasoning unknown` / `none` 均呈现灰掉的 `Disabled` / `禁用`（不发明档位、不出现 Provider 管理文案）。
- 可调关档文案同为 `Disabled` / `禁用`。
- canonical wire `xhigh` 统一显示 `Extra` 且产品最高档为 `Max`。
- 上下文开关只叫 `Max mode / Max 模式`（reasoning 的 `Max` 不变）。
- 固定 Max mode 开启且不可关闭。
- Max mode 与 Fast mode 在思考面板里始终占位：不支持时灰色关闭，固定支持时灰色开启，只有 selectable 状态可交互。收起的合并胶囊只在对应模式开启时显示前置图标。hover / `:focus-visible` 的 Fast/Max tip 是对准图标的实色圆胶囊（`--token-bg-raised`），完全浮在弹层上方；有约束状态只显示状态，不朝下叠进身份行。
- 快速 A→B→C 只保留最新 revision。
- 在途 turn 保持创建时冻结的 `RequestPlan`。
- 切换和输入不触发 Context preview IPC。
- 发送后计量相位依次为 `Preparing` / `Current request ~` / provider `Actual`。
  - 圆环环面只显示 `%` / `—` / `…`，阶段文案仅在 title/aria 与 Context breakdown 弹层。
  - 分段条显示压缩线刻度，圆环不标压缩位置；说明行拼接压缩线、条件完整窗口与本轮可生成。
  - 弹层始终使用同一 hero、分段条、Tokens | Cache | Reasoning 和 Details 结构：Preparing 尚无新快照时保留最近真实计量，Current request 显示 prepared 预估，完全无遥测显示 `—`，不制造假 0 或切换到独立空态。
- Actual / Last actual 在弹层宽度大于 `33rem` 时保持等宽三列独立圆角卡片 Tokens | Cache | Reasoning（Cache：省 tokens、最近一轮%、累计%、命中/未命中；缺遥测显示 `—`，禁止假 0 / 假 0%；Cache 卡内 stats 可折成 2×2）；卡片间距用 `--space-3`，禁止分隔线连体与 `clamp` 归零 gap；只有真实窄屏才纵向单列堆叠。
- 缩窗只在发送 preflight 内派生压缩视图而不提前改写历史。

- Composer 底栏 model-effort 与 Agent / Permission / Usage 互斥；390px 不越界。
- Settings 左侧导航可搜索并跳转高亮；八项顺序为 常规 → 外观 → Provider → Agents → Skills → Tools → Hooks → Policy，没有 Workspace 一级项。
- 常规页底部「资源与诊断」打开任务子弹窗，内含只读用户根 / 项目根与九条资源路径的复制 / 打开；根路径不可编辑，不提供迁移。
- Provider 总览卡片在同一视口下等宽等高；测试连接前 / 中 / 后卡片几何与按钮基线不变；未配置为中性色，只有真实失败才用 error；长错误折成摘要 + 展开。

## Composer Effort 滑杆

- First visible Effort popup frame must use measured inset geometry; measurement correction must not transition left or transform, while normal snap and Max lifecycle timing remain unchanged.

- 圆形滑块全程落在 track 内（inset 几何，无端点 transform 突变）。
- 弹层拖拽无横向滚动条与布局跳动。
- 松手仍 snap 到最近档位并短动画回位。

## 右键上下文菜单

- Composer textarea 与 Markdown CodeMirror 两轨均可弹出完整可编辑菜单；无选区时剪切/复制灰；剪贴板空时两个粘贴灰。
- Settings 输入框、transcript 正文/代码块、Runtime Log 抽屉走同一套菜单；只读面只有复制/全选。
- 「粘贴并清理格式」去掉 zero-width / NBSP / 智能引号 / 全角标点，且与「粘贴」不是同义重复。
- 390px 窄屏菜单完整位于 viewport 内并在边缘翻转；Arrow / Home / End / Enter / Escape 与焦点返回正确；入场动画保持正常播放。

## 验证命令

```bash
pnpm run check:appearance
```
