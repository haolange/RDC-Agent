# 设置中心

`SettingsModal` 负责窗口与叠层接线，`SettingsCenterNav` 和 `SettingsPageContent` 分别负责导航与页面装配，领域内容在 `sections`，局部组合在 `parts`。现有组织已按领域拆分，保留这一结构，不用统一重命名打散职责。

`useSettingsModal` 协调现有状态与操作；Provider 连接、Agent 自动保存、RDC 概览分别拥有请求生命周期。`useSettingsNavigation` 保护 profile/personalization/tools 等手动草稿，自动保存内容继续由自身 controller 管理。关闭叠层和关闭设置中心是不同动作。

验证沿用 provider 请求、Agent autosave/close、project scope、settings actions 测试，另用 `useSettingsNavigation.test.ts` 验证保留编辑与丢弃离开的真实 React 生命周期。视觉与焦点检查需要实际设置页及其叠层，单独测试 state hook 不代表完整 UI 验收。
