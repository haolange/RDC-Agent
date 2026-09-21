# RDC-Agent 0.6.0-rc.2

**Windows x64 · 未签名预发布 / Unsigned prerelease**

本版本供试用与反馈，不是签名稳定版。Windows可能提示未知发布者或SmartScreen警告；组织安全策略可能阻止运行。仅从本仓库Releases下载并核对SHA-256，不要关闭安全防护。

## 下载与开始

- `RDC-Agent-0.6.0-rc.2-x64-setup.exe`：NSIS安装包。
- `RDC-Agent-0.6.0-rc.2-x64.zip`：完整解压后运行`RdcAgent.exe`，不要只复制exe。
- `SHA256SUMS.txt`：下载文件校验和；`sbom.cdx.json`及其`.sha256`：依赖清单与校验和。
- 首次启动按图文指南连接自己的Provider/API、选择模型并添加项目。右上角问号可随时重看。无需Node.js或pnpm。
- RenderDoc分析需另下载[RDC-Tool 1.0.1](https://github.com/haolange/RDC-Tool/releases/tag/v1.0.1)，完整解压，在Settings → Tools选择`rdc-tool`文件夹并“验证并应用”。工具自带Python；普通General任务无需配置RDC。

## 本次改动

- Linux 与 macOS CI 的跨平台路径契约已收敛：Windows shell/CLI 路径在非 Windows runner 上按目标方言解析，macOS 测试临时根使用 canonical 路径；安全 symlink 拒绝规则保持不变。
- 四步图文教程：真实入口指引、可访问的中英文标注、深浅主题、窄屏布局和键盘焦点管理；示例状态不会被当作当前配置。
- RDC本机配置收敛为检测安装、选择文件夹、验证并应用；先验证草稿再保存，失败保留原配置，迟到结果丢弃。
- 官方Agent/Skill/Hook随应用提供，不生成用户副本；保留用户自行配置LLM和Project的边界。
- 同时提供安装包与解压包，并核验包内builtin及教程图片、SBOM和校验和。

## 验证边界

已有完整工程检查、Browser QA、同机隔离Tools/capture打开关闭及桌面正常退出证据；本次发行另验证发布门禁与最终包内容。未声称独立干净Windows、NSIS交互安装、真实LLM效果或完整Android/GPU矩阵通过。签名稳定版门禁继续保留。

## English

This is an **unsigned Windows x64 prerelease**, not a signed stable release. Windows or managed security policies may warn or block execution. Use only official release downloads and verify SHA-256; do not disable security protections.

Use the NSIS setup installer or extract the entire zip and run `RdcAgent.exe`. Configure your own provider/API, model and project. The new bilingual illustrated guide can be reopened with the title-bar question mark. RDC-Tool is optional for general tasks; for capture analysis, download Tools 1.0.1 separately and select its extracted folder in Settings → Tools. Python is included with Tools. No Node.js/pnpm installation is required to run RDC-Agent.
