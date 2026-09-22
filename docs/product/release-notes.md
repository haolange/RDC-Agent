# RDC-Agent 0.6.0-rc.7

**Windows x64 · 未签名预发布 / Unsigned prerelease**

本次预发布完成 renderer 组件与样式职责收敛，修整 Work Process 可见边界和四页上手指南，并同步 Grok 4.7 Fast 的 OAuth/Builder 路由能力与 RDC-Tool 会话超时策略。它仍是未签名预览版，不是稳定版。

## 本次改动

- 按 feature 职责拆分 Composer、Transcript、左右栏、Terminal、Knowledge、Settings 与引导界面组件及样式；强化 renderer 结构门禁和针对性交互测试。
- 校准 Transcript Work Process 卡片右边界；Composer 与最终回复宽度保持不变。四页引导说明加宽文字栏、整理步骤和完成提示，中英文同步。
- Grok 4.7 Fast 在 xAI 与 OAuth/Builder surfaces 分别使用独立 request binding；OAuth 路由发送 `service_tier=priority`。
- RDC-Tool `rd.session.*` worker budget 为 60 秒、CLI transport 为 65 秒；Agent 默认外层 CLI 等待为 120 秒，并迁移旧默认值。

## 下载

- `RDC-Agent-0.6.0-rc.7-x64-setup.exe`：Windows x64 安装包。
- `RDC-Agent-0.6.0-rc.7-x64.zip`：完整解压后运行 `RdcAgent.exe`。
- `SHA256SUMS.txt`、`sbom.cdx.json` 和 `.sha256`：资产校验与依赖清单。

运行不需要 Node.js 或 pnpm。首次使用需配置自己的 Provider。包未签名，Windows 可能显示未知发布者；请从本仓库 Release 下载并核对 SHA256，不关闭安全防护。

## 验证范围与限制

本次新增的定向测试 90 项通过；该发布源码的 GitHub CI 全部检查通过。真实 OAuth Fast 请求、设备/后端能力和完整窗口断点矩阵不因工程检查通过而自动视为验收完成，具体边界见仓库验收台账。

## English

Unsigned Windows x64 prerelease. This update converges renderer components and styles, refines Transcript card geometry and the four-page onboarding layout, enables Grok 4.7 Fast with an OAuth/Builder-specific request binding, and aligns the RDC-Tool session timeout policy with the Agent CLI deadline. Ninety targeted tests passed and the source commit's GitHub CI completed successfully. The package is unsigned; verify the published SHA256SUMS. Live OAuth requests and device/backend behavior are not claimed by engineering checks alone.
