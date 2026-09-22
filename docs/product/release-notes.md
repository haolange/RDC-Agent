# RDC-Agent 0.6.0-rc.6

**Windows x64 · 未签名预发布 / Unsigned prerelease**

本次更新校正 Provider 模型目录、能力和参数事实，并修复 Settings 将未知推理状态显示为关闭的问题。延续预发布通道，不是签名稳定版。

## 本次改动

- 更新 Grok、DeepSeek、OpenAI/ChatGPT、Anthropic、Google、GLM、MiniMax、Kimi 等内置 surface 的模型与字段，保留逐字段来源；删除已证实退役入口及直接耦合残留。
- 保持 manifest 基线与账号 discovery 分层。ChatGPT 账号返回的缺失或 text-only 模态不会覆盖已证实的结构能力；Azure 和 Groq 的独立生命周期例外保留。
- 修正 GLM 可选推理档位、Kimi 关闭思考、DeepSeek 三协议参数和 xAI Priority 接线；Grok OAuth 不继承直连 Priority，未证实字段保持 unknown。
- Settings 明确区分未知、供应商控制和已证实关闭。继续沿用现有模型行和控件。

## 下载

- `RDC-Agent-0.6.0-rc.6-x64-setup.exe`：Windows x64 安装包。
- `RDC-Agent-0.6.0-rc.6-x64.zip`：完整解压后运行 `RdcAgent.exe`。
- `SHA256SUMS.txt`、`sbom.cdx.json` 和 `.sha256`：资产校验与依赖清单。

运行不需要 Node.js 或 pnpm。首次使用需配置自己的 Provider。包未签名，Windows 可能显示未知发布者；请从本仓库 Release 下载并核对 SHA256，不关闭安全防护。

## 验证范围与已知限制

完整测试 3093 项通过，4 项按原配置跳过；coverage ratchet、typecheck、lint、Provider 检查、contracts、gates 和 build 通过。隔离 Browser QA 验证 DeepSeek 视觉差异与路由保存、GLM 键盘选择推理档、MiniMax 未知状态、窄屏和焦点。

Composer 三种视觉附件提示及已连接 Grok OAuth 控件尚未完成运行验收；未复制真实凭据，也未调用真实模型。目录缓存和单测不代表账号实际可用或模型调用成功。NSIS 交互安装和完整 GPU/Android 矩阵不在本轮通过声明内。

## English

Unsigned Windows x64 prerelease. This update corrects provider model facts and request parameters, preserves account-specific availability boundaries, and fixes unknown reasoning labels in Settings. All 3,093 tests and engineering gates passed. Composer attachment warnings across all three vision states and connected Grok OAuth controls remain unverified at runtime; no real model request is claimed.
