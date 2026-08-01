# Appearance UI 验收清单

> 触发条件：Appearance / chrome / compose accent 改动后执行 `pnpm run check:appearance`。

## Appearance 面板

- System/Light/Dark 迷你窗口磁贴。
- 双栏视觉预览（非 JSON/代码块）。
- Light/Dark 编辑卡跟随 App chrome。
- 圆角色板+hex。
- 可读预设下拉（统一 pill Aa+名称触发体、菜单右缘贴合并向左延伸、caret 衔接 tip、毛玻璃菜单、每项 Aa+勾选、足够宽度）。
- Import/Copy `rdx-theme-v1:`。
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
- Max mode 与 Fast mode 始终显示：不支持时灰色关闭，固定支持时灰色开启，只有 selectable 状态可交互。
- 快速 A→B→C 只保留最新 revision。
- 在途 turn 保持创建时冻结的 `RequestPlan`。
- 切换和输入不触发 Context preview IPC。
- 发送后计量相位依次为 `Preparing` / `Current request ~` / provider `Actual`。
  - 圆环环面只显示 `%` / `—` / `…`，阶段文案仅在 title/aria 与 Context breakdown 弹层。
  - 弹层始终使用同一 hero、分段条、Tokens | Cache | Reasoning 和 Details 结构：Preparing 尚无新快照时保留最近真实计量，Current request 显示 prepared 预估，完全无遥测显示 `—`，不制造假 0 或切换到独立空态。
- Actual / Last actual 在弹层宽度大于 `33rem` 时保持内容宽度驱动的同行三栏 Tokens | Cache | Reasoning（Cache：省 tokens、最近一轮%、累计%、命中/未命中；缺遥测显示 `—`，禁止假 0 / 假 0%）；只有真实窄屏才纵向堆叠，禁止用比例列制造组间大空白。
- 缩窗只在发送 preflight 内派生压缩视图而不提前改写历史。

## Composer Effort 滑杆

- First visible Effort popup frame must use measured inset geometry; measurement correction must not transition left or transform, while normal snap and Max lifecycle timing remain unchanged.

- 白方块全程落在 track 内（inset 几何，无端点 transform 突变）。
- 弹层拖拽无横向滚动条与布局跳动。
- 松手仍 snap 到最近档位并短动画回位。

## 验证命令

```bash
pnpm run check:appearance
```
