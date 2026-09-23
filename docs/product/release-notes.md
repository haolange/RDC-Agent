# RDC-Agent 0.6.0-rc.8

**Windows x64 · 未签名预发布 / Unsigned prerelease**

本次预发布更新 OpenAI、ChatGPT Account、Anthropic、Claude Account 与 Grok Account 的模型目录事实，修整 Composer Fast/Max 提示的实色表面，并让维护型模型不受过期账号目录缺项影响。它仍是未签名预览版，不是稳定版。

## 本次改动

- 将 GPT-6 Sol 与 GPT-6 Luna 加入 OpenAI API（含 US/EU 路由）及 ChatGPT Account，各 surface 保留独立上下文、能力与 Fast priority 路由定义。
- 将 Claude Opus 5.5 加入 Anthropic API 与 Claude Account，按各自 route 独立维护。
- 将 Grok Account 的 Grok 4.5 Vision 与 Structured Output 标记为 Supported。
- 修整 Composer 推理挡位 Fast/Max 提示的背景与边界呈现，保留原有 hover/focus 行为；优化模型能力详情区域，使其更贴合 Context 弹窗的实色分层设计。
- 持久 discovery 按编译模型投影指纹失效；ChatGPT Account 维护型 GPT-6 Sol/Luna 不会因过期或失败的目录刷新缺项而隐藏。

## 下载

- `RDC-Agent-0.6.0-rc.8-x64-setup.exe`：Windows x64 安装包。
- `RDC-Agent-0.6.0-rc.8-x64.zip`：完整解压后运行 `RdcAgent.exe`。
- `SHA256SUMS.txt`、`sbom.cdx.json` 和 `.sha256`：资产校验与依赖清单。

运行不需要 Node.js 或 pnpm。首次使用需配置自己的 Provider。包未签名，Windows 可能显示未知发布者；请从本仓库 Release 下载并核对 SHA256，不关闭安全防护。

## 验证范围与限制

目录编译、provider discovery 与 wire contract、Composer/Settings 外观和设计令牌门禁按本次验收台账记录。未执行真实模型请求；工程测试不代表各 Provider 当前账号的服务可用性或实际模型效果。窗口现场验收边界见仓库验收台账。

## English

Unsigned Windows x64 prerelease. This update adds GPT-6 Sol and Luna to OpenAI API and ChatGPT Account catalogs, adds Claude Opus 5.5 to Anthropic API and Claude Account, confirms Grok 4.5 vision and structured output for the Grok account surface, polishes Composer Fast/Max hint surfaces, and invalidates persisted discovery when its compiled catalog projection changes. No live model request or provider account availability is claimed. See the acceptance ledger for validation scope.
