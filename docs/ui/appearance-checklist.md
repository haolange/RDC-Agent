# Appearance UI 验收清单

> 触发条件：Appearance / chrome / compose accent 改动后执行 `pnpm run check:appearance`。

## Appearance 面板

- 全应用只有一个主题入口：外观页的「主题：跟随系统 / 浅色 / 深色」分段 `Tabs`（`variant="segmented"`）；用户菜单只有头像、名字与「设置」。
- 浅色与深色两张实时预览在宽面板并排、窄面板堆叠，切换预览改变唯一编辑器的目标，默认选择当前显示主题。复验主题模式与编辑目标独立，导入／复制、Aa 色样预设、圆角色板、界面字体、代码字体与对比度均属于编辑目标。
- 预览以所编辑主题编译的表面、文字、强调色及对比度呈现导航与操作。导入有效主题后同步显示同一份预览。编辑界面或代码字体时，分别检查预览标签和代码样例，手输多词字体名时中间空格应保留。选中预设的色样跟随实际强调色。
- 「偏好」一节放字号与 Markdown 输入，每项一句次级正文说明；没有「使用指针光标」开关，可点击元素始终使用指针光标。

## 预览一致性

- 常规页的工作过程选择器显示相同的四个步骤；「跟随最新」淡出较早步骤，「全部展开」显示完整轨道。方向键切换同步更新当前说明与选中指示。
- 全局预览跟 chrome。
- Composer/Effort 仍跟 agent accent。
- Context Usage 弹层底色跟 chrome 编译的 `--color-surface-overlay` / `--token-bg-overlay`（分段色点仍用全局 `--token-context-*`）。

## Provider/Model/Composer 控件验收

> 触发条件：Provider/model/Composer control 改动。

- 模型服务配置三项时，标题、添加、批量检查及进度沿阅读顺序衔接。窄窗换行保留两项操作及顺序，进入添加目录和返回时标题与操作保持左对齐。
- 在普通列表、搜索结果和已展开模型详情中启停模型，观察待保存、刷新和提交。被操作行与邻行位移最多 1 CSS px，展开、滚动与键盘焦点留在原处。覆盖最后一个模型、连续反向操作和失败反馈。
- 在待发、已发与编辑重发入口检查三图混排、长文件名和 Markdown。打开图片应显示原图与共用查看器，Markdown 阅读到文末，Esc 返回对应附件。测试 125% 缩放、纯键盘、触屏移除，以及旧消息标注确有内容时的读法。

- `reasoning unknown` / `none` 均呈现灰掉的 `Disabled` / `禁用`（不发明档位、不出现 Provider 管理文案）。
- 可调关档文案同为 `Disabled` / `禁用`。
- canonical wire `xhigh` 统一显示 `Extra` 且产品最高档为 `Max`。
- 上下文开关只叫 `Max mode / Max 模式`（reasoning 的 `Max` 不变）。
- 固定 Max mode 开启且不可关闭。
- Max mode 与 Fast mode 只在模型支持时出现：固定支持显示锁定开启，只有 selectable 状态可交互。收起的合并胶囊只在对应模式开启时显示前置图标。hover / `:focus-visible` 的 Fast/Max tip 是对准图标的实色圆胶囊（`--token-bg-raised`），完全浮在弹层上方；有约束状态只显示状态，不朝下叠进身份行。
- 快速 A→B→C 只保留最新 revision。
- 在途 turn 保持创建时冻结的 `RequestPlan`。
- 切换和输入不触发 Context preview IPC。
- 发送后计量相位依次为 `Preparing` / `Current request ~` / provider `Actual`。
  - 圆环环面只显示 `%` / `—` / `…`，阶段文案仅在 title/aria 与 Context breakdown 弹层。
  - 首行并列占用率、来源和已用／上限。压缩阈值标在占用条的对应刻度；本轮可生成量单列，数值与右侧上限对齐。
  - Preparing 尚无新快照时保留最近实测；Current request 显示 prepared 估算，无遥测显示 `—`，收到的零值显示 `0`。
- 展开「详细用量」首先看到 Tokens、Cache、Reasoning。检查三卡在面板宽度 38rem 两侧的排列、内边距、标签与数字基线。费用在有来源时显示在三卡后，上下文构成与窗口外的延迟工具排在其后。检查中英文的标签与数值对齐、窄窗滚动、鼠标与键盘展开，以及关闭后的焦点。
- 用鼠标、Enter 和 Space 快速反向切换用量明细。整个过渡保持面板宽度和底边，空间不足时滚动正文。确认减少动效、偏好写回延迟与 Escape 归焦。
- 缩窗只在发送 preflight 内派生压缩视图而不提前改写历史。

## Composer Effort 滑杆

- 弹层首帧使用实测 inset 几何，测量修正不对 left / transform 做过渡；常规吸附与 Max 生命周期时序不变。
- 圆形滑块全程落在 track 内（inset 几何，无端点 transform 突变）。
- 弹层拖拽无横向滚动条与布局跳动。
- 松手仍 snap 到最近档位并短动画回位。

## 右键上下文菜单

- Composer textarea 与 Markdown CodeMirror 两轨均可弹出完整可编辑菜单；无选区时剪切/复制灰；剪贴板空时两个粘贴灰。
- Settings 输入框、transcript 正文/代码块、Runtime Log 抽屉走同一套菜单；只读面只有复制/全选。
- 「粘贴并清理格式」去掉 zero-width / NBSP / 智能引号 / 全角标点，且与「粘贴」不是同义重复。
- 390px 窄屏菜单完整位于 viewport 内并在边缘翻转；Arrow / Home / End / Enter / Escape 与焦点返回正确；入场动画保持正常播放。

## 组件与窗口验收

- Settings 八页逐页检查，特别是列表/编辑器在断点前后的滚动所有权、固定动作区和低高度窗口。
- 深浅主题、三档字号、中英文按代表性与极端组合检查。实际宽度溢出使用 OverflowFade，悬停提示只在截断时出现，正文/错误合理换行。
- ActiveSignalText、Composer 绕光、Max 特殊滑条分别检查。Max 保持 Composer 专属控制器与绘制模块；不引入全局停播或第二套动画实现。
- 活文档、Browser、模型、原生 Electron/DPI 是独立证据。原生最大化/恢复必须实际操作，截图尺寸不替代设备证据。

## 验证命令

```bash
pnpm run check:appearance
```
