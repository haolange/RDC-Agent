# Provider model catalog

运行时模型、路由、能力、价格和来源以 [Provider manifests](../../src/shared/provider-catalog/manifests) 为准。Effective Catalog 的合并与执行边界见 [Provider 架构](../architecture/provider-architecture.md)。

## 2026-11-24 目录核对

本轮以 surface manifest 的稳定 ID 为计数单位。共 182 个接入面，逐项对照接入面定义、关联 identity、来源记录和 discovery 策略。重点接入面比对运营方的公开目录、协议说明和退役公告。公开来源能证明的字段按对应接入面写入 JSON。部署、账号、地区或本机安装决定的可用性由该入口自身发现。

| 状态 | 数量 | 判定 |
| --- | ---: | --- |
| 已更新 | 15 | 已按该接入面证据修改目录。仍需账号确认的字段继续依赖 discovery。 |
| 已核对 | 48 | 对照了该运营方的公开目录或接入说明，保留现行目录。 |
| 依赖账号发现 | 50 | 实际可用项由账户、套餐、部署、区域或本机安装决定。 |
| 缺公开依据 | 69 | 对该接入面已有来源记录，但本轮缺少足以核对具体模型事实的公开材料。链接供继续查证。 |
| 合计 | 182 | 每个 surface 计一次。 |

这一轮证据来自公开文档、目录元数据与 checkout。先前记录的账号观察只适用于当时账户，无本轮认证后的真实请求或计费回执。不同接入面的模型名称重合时，窗口、价格、Fast 与账户权限分别以各接入面的证据为准。

| Surface ID | 状态 | 依据或待确认项 |
| --- | --- | --- |
| `302ai` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://doc.302.ai) |
| `abacus` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://abacus.ai/help/api) |
| `abliteration-ai` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.abliteration.ai/models) |
| `ai-router` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://ai-router.dev/openai-compatible-api-gateway/) |
| `aihubmix` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.aihubmix.com) |
| `alibaba` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://www.alibabacloud.com/help/en/model-studio/models) |
| `alibaba-coding-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://www.alibabacloud.com/help/en/model-studio/coding-plan) |
| `alibaba-token-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://www.alibabacloud.com/help/en/model-studio/token-plan-overview) |
| `alibaba-token-plan-cn` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://www.alibabacloud.com/help/zh/model-studio/token-plan-overview) |
| `amazon-bedrock` | 依赖账号发现 | AWS 公布端点与区域矩阵。Mantle 路径依型号，区域与访问以当前账号为准。 [入口或说明](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html) |
| `ambient` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://ambient.xyz) |
| `anthropic` | 已更新 | 依据 Messages API 的官方模型规格维护能力。 [依据](https://platform.claude.com/docs/en/models/fable-5-2/overview) |
| `anthropic-thirdparty` | 依赖账号发现 | 由用户配置的 Anthropic-compatible 实例验证候选，协议文档用于请求格式。 [入口或说明](https://platform.claude.com/docs/en/api/overview) |
| `anyapi` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.anyapi.ai) |
| `atomic-chat` | 依赖账号发现 | 本地服务决定安装与加载的模型。 [入口或说明](https://atomic.chat) |
| `auriko` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.auriko.ai) |
| `azure` | 依赖账号发现 | 核对 Foundry 型号与区域。当前 Chat 入口按配置部署验证，公开型号发布不能确认部署。 [入口或说明](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure) |
| `azure-cognitive-services` | 依赖账号发现 | 实际可用项由配置的 Azure 资源和部署验证。 [入口或说明](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure) |
| `bailian` | 依赖账号发现 | 核对百炼控制台入口，项目和账号暴露的目录决定可用项。 [入口或说明](https://bailian.console.aliyun.com/) |
| `bailian-coding-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://help.aliyun.com/zh/model-studio/coding-plan) |
| `bailing` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://alipaytbox.yuque.com/sxs0ba/ling/intro) |
| `baseten` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.baseten.co/inference/model-apis/overview) |
| `berget` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://api.berget.ai) |
| `blueclaw` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://blueclaw.network) |
| `cerebras` | 已核对 | 对照接入面公开目录，保留可追溯的结构记录。 [依据](https://inference-docs.cerebras.ai/models/overview) |
| `chatgpt-account` | 已更新 | Codex 登录面加入公开可证的模型基线，启用资格由账户返回。 [依据](https://learn.chatgpt.com/docs/models?surface=cli) |
| `chutes` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://llm.chutes.ai/v1/models) |
| `clarifai` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.clarifai.com/compute/inference/) |
| `claude-account` | 依赖账号发现 | 官方要求新版 Claude Code，现有 OAuth 客户端声明低于该版本。 [入口或说明](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan) |
| `claudinio` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://claudin.io) |
| `cline` | 依赖账号发现 | 当前项目或登录账号的目录决定可用项。 [入口或说明](https://docs.cline.bot/api/overview) |
| `cline-pass` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://docs.cline.bot/getting-started/clinepass) |
| `cloudferro-sherlock` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.sherlock.cloudferro.com/) |
| `cloudflare-ai-gateway` | 依赖账号发现 | 可用模型由区域、资源或租户目录确认。 [入口或说明](https://developers.cloudflare.com/ai-gateway/) |
| `cloudflare-workers-ai` | 依赖账号发现 | 可用模型由区域、资源或租户目录确认。 [入口或说明](https://developers.cloudflare.com/workers-ai/models/) |
| `cohere` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.cohere.com/docs/models) |
| `cortecs` | 缺公开依据 | 本轮未读到公开目录，已有 runtime observation 提供入口来源。 [来源线索](https://api.cortecs.ai/v1/models) |
| `crof` | 缺公开依据 | manifest 有历史运行观察，尚缺本轮可复核的公共模型细项。 [来源线索](https://crof.ai/docs) |
| `crossmodel` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://www.crossmodel.ai/docs) |
| `custom-endpoint` | 依赖账号发现 | 目录和执行协议由用户实例决定。 |
| `daoxe` | 缺公开依据 | manifest 有历史运行观察，尚缺本轮可复核的公共模型细项。 [来源线索](https://daoxe.com/pricing) |
| `databricks` | 依赖账号发现 | 可用模型由区域、资源或租户目录确认。 [入口或说明](https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis) |
| `deepinfra` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://deepinfra.com/models) |
| `deepseek` | 已更新 | 复核三个协议下的型号、能力和价目表，排除已退役转发名称。估算字段沿用公开低峰报价。 [依据](https://api-docs.deepseek.com/quick_start/pricing/) |
| `digitalocean` | 依赖账号发现 | 可用模型由区域、资源或租户目录确认。 [入口或说明](https://docs.digitalocean.com/products/inference/details/models/) |
| `dinference` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://dinference.com) |
| `drun` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.d.run/models/api-call) |
| `ebcloud` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.ebtech.com/ai/model-api.html) |
| `empiriolabs` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.empiriolabs.ai) |
| `evroc` | 缺公开依据 | 现有来源返回 404，尚缺可对照的区域路由与型号。 [来源线索](https://docs.evroc.com/products/think/overview.html) |
| `fastrouter` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://fastrouter.ai/models) |
| `fireworks-ai` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.fireworks.ai/) |
| `freemodel` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://freemodel.dev) |
| `friendli` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://friendli.ai/docs/guides/serverless_endpoints/introduction) |
| `frogbot` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.frogbot.ai) |
| `github-copilot` | 已更新 | 处理已确认退役项，新增公开名称由 OAuth 服务目录确认路由与能力。 [依据](https://docs.github.com/en/copilot/reference/ai-models/supported-models#model-retirement-history) |
| `github-models` | 依赖账号发现 | 当前项目或登录账号的目录决定可用项。 [入口或说明](https://docs.github.com/en/rest/models/catalog) |
| `gitlab` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://docs.gitlab.com/user/duo_agent_platform/) |
| `glm-cn` | 缺公开依据 | 中国接入面缺少可确认的精确限制，全球定价页不能作为该区域证据。 [来源线索](https://open.bigmodel.cn/) |
| `glm-cn-coding-plan` | 依赖账号发现 | 核对独立套餐条件，当前型号仍缺直接上下文证据。 [入口或说明](https://docs.bigmodel.cn/cn/coding-plan/overview) |
| `glm-global` | 已核对 | 对照国际 API 官方价格与型号文档。 [依据](https://docs.z.ai/guides/overview/pricing) |
| `glm-global-coding-plan` | 依赖账号发现 | 核对国际套餐范围，实际资格由该套餐验证。 [入口或说明](https://docs.z.ai/devpack/overview) |
| `gmicloud` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.gmicloud.ai/inference-engine/api-reference/llm-api-reference) |
| `google-ai-studio` | 已更新 | 核对 Interactions 官方模型及 Gemini API 迁移与退役。 [依据](https://aistudio.google.com/docs/interactions-overview) |
| `google-vertex` | 已更新 | 加入官方注明的条件记录，由项目及区域 discovery 决定当前可用项。 [依据](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions) |
| `google-vertex-anthropic` | 已更新 | 按 Vertex 合作伙伴模型文档建条件记录，仍需项目与区域确认。 [依据](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/fable-5-2) |
| `grok-account` | 已更新 | 去掉借用的公共 API 报价。订阅保留 Builder 目录和独立 Fast 目标。 [依据](https://docs.x.ai/x-subscription/usage-limits) |
| `groq` | 已核对 | 对照接入面公开目录，保留可追溯的结构记录。 [依据](https://console.groq.com/docs/models) |
| `helicone` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://helicone.ai/models) |
| `hpc-ai` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://www.hpc-ai.com/doc/docs/quickstart/) |
| `huggingface` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://huggingface.co/docs/inference-providers) |
| `iflow` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://platform.iflow.cn/en/docs) |
| `inception` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://platform.inceptionlabs.ai/docs) |
| `inceptron` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.inceptron.io) |
| `inference` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://inference.net/models) |
| `inferx` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://model.inferx.net/endpoints) |
| `io-net` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://io.net/docs/guides/intelligence/io-intelligence) |
| `jiekou` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.jiekou.ai/docs/support/quickstart?utm_source=github_models.dev) |
| `kenari` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://kenari.id/docs) |
| `kilo` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://kilo.ai) |
| `kimi-coding-plan` | 依赖账号发现 | 核对套餐、wire ID 及上下文。型号详表与概览对默认推理强度表述不同，保留原有默认与账号边界。 [入口或说明](https://www.kimi.com/code/docs/en/kimi-code/models.html) |
| `kuae-cloud-coding-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://docs.mthreads.com/kuaecloud/kuaecloud-doc-online/coding_plan/) |
| `lilac` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.getlilac.com/inference/models) |
| `litellm` | 依赖账号发现 | 模型名和路由由用户配置的 LiteLLM proxy 实例决定。 [入口或说明](https://docs.litellm.ai/docs/) |
| `llama` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://dev.meta.ai/docs/models.md) |
| `llmgateway` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://llmgateway.io/docs) |
| `llmtr` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://llmtr.com/docs) |
| `lm-studio` | 依赖账号发现 | 用户运行的本地服务列出模型及元数据。 [入口或说明](https://lmstudio.ai/docs/developer/openai-compat/models) |
| `longcat` | 已更新 | 补正式模型的 Chat Completions、Messages 和窗口。旧版本由 discovery 确认。官方 Responses 路由待验证实际请求和工具续聊。 [依据](https://longcat.chat/platform/docs/api/model-params) |
| `lucidquery` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://lucidquery.com/docs) |
| `lynkr` | 依赖账号发现 | 本地服务决定安装与加载的模型。 [入口或说明](https://github.com/Fast-Editor/Lynkr) |
| `manifest` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://app.manifest.build/) |
| `meganova` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.meganova.ai) |
| `merge-gateway` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.merge.dev/merge-gateway) |
| `meta` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://dev.meta.ai/docs/overview) |
| `minimax-cn` | 已核对 | 核对中国按量 API 和套餐边界。 [依据](https://platform.minimax.cn/subscribe/token-plan) |
| `minimax-cn-coding-plan` | 依赖账号发现 | 官方套餐名称更新，确切 wire ID 和协议细项仍待对应目录。 [入口或说明](https://platform.minimax.cn/docs/m-plan/intro) |
| `minimax-global` | 已核对 | 核对国际按量 API 与按上下文分段的公开计费。 [依据](https://platform.minimax.io/subscribe/token-plan) |
| `minimax-global-coding-plan` | 依赖账号发现 | 官方套餐名称更新，确切 wire ID 和协议细项仍待对应目录。 [入口或说明](https://platform.minimax.io/docs/m-plan/intro) |
| `mistral` | 已核对 | 对照接入面公开目录，保留可追溯的结构记录。 [依据](https://docs.mistral.ai/getting-started/models/) |
| `mixlayer` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.mixlayer.com) |
| `moark` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://moark.com/docs/openapi/v1#tag/%E6%96%87%E6%9C%AC%E7%94%9F%E6%88%90) |
| `model-oracle-ai` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://modeloracle.com/setup/) |
| `modelscope` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://modelscope.cn/docs/model-service/API-Inference/intro) |
| `moonshot` | 已更新 | 校准中国 API 上下文和推理档，移除明确下线型号，老账号独享型号由账号目录确认。 [依据](https://platform.kimi.com/docs/models) |
| `moonshotai` | 已更新 | 过滤国际 API 已退役 ID，持续按该地区账户查询模型。 [依据](https://platform.kimi.ai/docs/models) |
| `morph` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.morphllm.com/api-reference/introduction) |
| `nano-gpt` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.nano-gpt.com) |
| `nearai` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.near.ai/) |
| `nebius` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.tokenfactory.nebius.com/quickstart) |
| `neon` | 依赖账号发现 | 可用模型由区域、资源或租户目录确认。 [入口或说明](https://neon.com/docs) |
| `neuralwatt` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://portal.neuralwatt.com/docs) |
| `nous` | 依赖账号发现 | 模型可用性与权限由该登录账户决定。 [入口或说明](https://portal.nousresearch.com) |
| `nova` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://nova.amazon.com/dev/documentation) |
| `novita-ai` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.novita.ai/guides/introduction) |
| `nvidia-nim` | 依赖账号发现 | 可用模型由区域、资源或租户目录确认。 [入口或说明](https://docs.api.nvidia.com/nim/docs/introduction) |
| `ollama` | 依赖账号发现 | 本机安装模型及能力由 tags/show 返回。 [入口或说明](https://docs.ollama.com/api/tags) |
| `ollama-cloud` | 依赖账号发现 | 当前项目或登录账号的目录决定可用项。 [入口或说明](https://docs.ollama.com/cloud) |
| `openai` | 已更新 | 核对 Direct API Responses 模型与 Fast。 [依据](https://developers.openai.com/api/docs/guides/latest-model) |
| `openai-eu` | 已更新 | 按 EU 运行区域文档校准模型与 Fast。 [依据](https://developers.openai.com/api/docs/guides/data-residency) |
| `openai-us` | 已更新 | 按 US 运行区域文档校准模型与 Fast。 [依据](https://developers.openai.com/api/docs/guides/data-residency) |
| `opencode-go` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://opencode.ai/docs/go/) |
| `opencode-zen` | 已核对 | 对照接入面公开目录，保留可追溯的结构记录。 [依据](https://opencode.ai/docs/console/models/) |
| `openrouter` | 已核对 | 核对聚合目录字段与单模型托管页，继续以动态目录供给能力与可用路由。 [依据](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) |
| `orcarouter` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.orcarouter.ai) |
| `ovhcloud` | 依赖账号发现 | 当前项目或登录账号的目录决定可用项。 [入口或说明](https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog//) |
| `perplexity` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.perplexity.ai) |
| `perplexity-agent` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.perplexity.ai/docs/agent-api/models) |
| `pioneer` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://agent.pioneer.ai/llms.txt) |
| `poe` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://creator.poe.com/docs/external-applications/openai-compatible-api) |
| `poolside` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://platform.poolside.ai) |
| `privatemode-ai` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.privatemode.ai/api/overview) |
| `qihang-ai` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://www.qhaigc.net/docs) |
| `qiniu-ai` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://developer.qiniu.com/aitokenapi) |
| `qwen` | 已核对 | 对照 Model Studio 型号与能力，区域和部署以对应入口为准。 [依据](https://www.alibabacloud.com/help/en/model-studio/models) |
| `regolo-ai` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.regolo.ai/) |
| `requesty` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://www.requesty.ai/models) |
| `routing-run` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.routing.run/api-reference/models) |
| `sakana` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://console.sakana.ai/models) |
| `sap-ai-core` | 依赖账号发现 | 可用项受资源组、场景和实际 RUNNING deployment 约束。 [入口或说明](https://help.sap.com/docs/sap-ai-core) |
| `sarvam` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.sarvam.ai/api-reference-docs/getting-started/models) |
| `scaleway` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://www.scaleway.com/en/docs/generative-apis/) |
| `siliconflow` | 依赖账号发现 | 控制台目录要求登录，保留各地区接入面。 [入口或说明](https://siliconflow.cn/) |
| `siliconflow-cn` | 依赖账号发现 | 控制台目录要求登录，保留各地区接入面。 [入口或说明](https://cloud.siliconflow.com/models) |
| `snowflake-cortex` | 依赖账号发现 | 可用模型由区域、资源或租户目录确认。 [入口或说明](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api) |
| `stackit` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.stackit.cloud/products/data-and-ai/ai-model-serving/basics/available-shared-models) |
| `stepfun` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://platform.stepfun.com/docs/zh/guides/basic-concepts) |
| `stepfun-ai` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://platform.stepfun.ai/docs/en/guides/basic-concepts) |
| `stepfun-ai-step-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://platform.stepfun.ai/docs/en/step-plan/integrations/reasoning-api) |
| `stepfun-step-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://platform.stepfun.com/docs/zh/step-plan/integrations/reasoning-api) |
| `subconscious` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.subconscious.dev) |
| `submodel` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://submodel.gitbook.io) |
| `synthetic` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://synthetic.new/pricing) |
| `tencent-coding-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://cloud.tencent.com/document/product/1823/130092) |
| `tencent-token-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://cloud.tencent.com/document/product/1823/130060) |
| `tencent-tokenhub` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://cloud.tencent.com/document/product/1823/130050) |
| `the-grid-ai` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://thegrid.ai/docs) |
| `tinfoil` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.tinfoil.sh) |
| `together-ai` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.together.ai/docs/serverless/models) |
| `trustedrouter` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://trustedrouter.com/docs) |
| `umans-ai` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://app.umans.ai/offers/code/docs/orgs) |
| `umans-ai-coding-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://app.umans.ai/offers/code/docs) |
| `unorouter` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://unorouter.com/models) |
| `upstage` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://developers.upstage.ai/docs/apis/chat) |
| `v0` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://sdk.vercel.ai/providers/ai-sdk-providers/vercel) |
| `venice` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.venice.ai) |
| `vercel-ai-gateway` | 已核对 | 核对公开模型目录与独立的团队资格数据。 [依据](https://vercel.com/docs/ai-gateway/models-and-providers) |
| `vivgrid` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.vivgrid.com/models) |
| `volcengine` | 依赖账号发现 | 方舟项目和配置的推理接入点决定可用项。 [入口或说明](https://www.volcengine.com/docs/82379) |
| `volcengine-coding-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://docs.volcengine.com/docs/ark/coding-plan-personal-get-started?lang=zh) |
| `vultr` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://api.vultrinference.com/) |
| `wafer.ai` | 缺公开依据 | 现有套餐入口缺少可核对的 wire ID 或能力细项。 [来源线索](https://docs.wafer.ai/wafer-pass) |
| `wandb` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.wandb.ai/guides/integrations/inference/) |
| `xai` | 已更新 | 补直接 API 的别名、推理档和公开基础报价，过滤已退役 ID。API Priority 以实际回执确认。 [依据](https://docs.x.ai/developers/models) |
| `xiaomi-mimo` | 缺公开依据 | 现有公开控制台未返回可核对的具体模型条目与能力窗口。 [来源线索](https://platform.xiaomimimo.com/#/docs) |
| `xiaomi-mimo-token-plan` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://platform.xiaomimimo.com/#/console/plan-manage) |
| `xiaomi-token-plan-ams` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://platform.xiaomimimo.com/#/docs) |
| `xiaomi-token-plan-sgp` | 依赖账号发现 | 实际型号与额度由对应套餐的账户目录确认。 [入口或说明](https://platform.xiaomimimo.com/#/docs) |
| `xpersona` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://www.xpersona.co/docs) |
| `zeldoc` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.zeldoc.ai) |
| `zenifra` | 缺公开依据 | 现有 manifest/identity 记录接入入口，尚缺本轮可复核的公共模型细项。 [来源线索](https://docs.zenifra.com) |
| `zenmux` | 已核对 | 对照运营方接口或公开目录，型号继续由服务发现。 [依据](https://docs.zenmux.ai) |
