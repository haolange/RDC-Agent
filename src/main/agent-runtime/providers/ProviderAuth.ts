/**
 * ProviderAuth —— Provider 运行时凭证桥接层。
 *
 * 该文件不重新实现 OAuth / 设备码流程，而是为新版 Agent Runtime 提供一个
 * 统一的凭证查询入口。当前阶段的实现策略：
 *
 * 1. 优先从外部注入的 `resolver` 函数获取（通常由主进程在装配时
 *    桥接到 `SecretStorageService` / `ProviderAccountAuthService`）。
 * 2. 否则回退到环境变量（适合开发期 / 测试期）：
 *    - `OPENAI_API_KEY` / `OPENAI_BASE_URL`
 *    - `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`
 *    - `GEMINI_API_KEY` / `GEMINI_BASE_URL` (或 `GOOGLE_API_KEY`)
 *    - `OLLAMA_BASE_URL`
 *    - 通用：`<PROVIDER>_API_KEY` / `<PROVIDER>_BASE_URL`，其中 provider id 全部转大写、
 *      `-` 转 `_`。
 *
 * 后续接入旧版 `ProviderAccountAuthService` 时，仅需在主进程入口
 * 调用 `providerAuth.setResolver(...)` 注入即可，不需要修改 Provider 实现。
 */

/** Provider 运行时凭证。 */
export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
  /** 额外请求头，用于 OpenRouter 之类需要 attribution 的服务。 */
  headers?: Record<string, string>;
}

/** 自定义凭证解析器；返回 undefined 表示未知，调用方会回退到环境变量。 */
export type ProviderCredentialsResolver = (
  provider: string,
) => Promise<ProviderCredentials | undefined> | ProviderCredentials | undefined;

export class ProviderAuth {
  private resolver: ProviderCredentialsResolver | undefined;

  /** 注入外部凭证解析器；同一个 ProviderAuth 实例只保留最后一次注入。 */
  setResolver(resolver: ProviderCredentialsResolver | undefined): void {
    this.resolver = resolver;
  }

  /** 获取指定 provider 的运行时凭证。任何分支都会返回非空对象（字段可能缺省）。 */
  async getCredentials(provider: string): Promise<ProviderCredentials> {
    const fromResolver = await this.resolveExternal(provider);
    const fromEnv = readEnvCredentials(provider);

    return {
      apiKey: fromResolver?.apiKey || fromEnv.apiKey,
      baseUrl: fromResolver?.baseUrl || fromEnv.baseUrl,
      headers: mergeHeaders(fromEnv.headers, fromResolver?.headers),
    };
  }

  /** 检查 provider 是否已认证（同步快查，仅基于环境变量与 resolver 同步返回值）。 */
  isAuthenticated(provider: string): boolean {
    const env = readEnvCredentials(provider);
    if (env.apiKey) return true;
    if (this.resolver) {
      try {
        const result = this.resolver(provider);
        if (result && !(result instanceof Promise)) {
          return Boolean((result as ProviderCredentials).apiKey);
        }
      } catch {
        return false;
      }
    }
    return false;
  }

  private async resolveExternal(provider: string): Promise<ProviderCredentials | undefined> {
    if (!this.resolver) return undefined;
    try {
      const result = await this.resolver(provider);
      return result || undefined;
    } catch {
      return undefined;
    }
  }
}

/** 进程级单例，便于跨模块共享。 */
export const providerAuth = new ProviderAuth();

// =====================================================================
// 内部辅助
// =====================================================================

function readEnvCredentials(provider: string): ProviderCredentials {
  const envKeyName = toEnvKey(provider);
  const apiKey =
    pickEnv(`${envKeyName}_API_KEY`)
    ?? wellKnownApiKey(provider);
  const baseUrl =
    pickEnv(`${envKeyName}_BASE_URL`)
    ?? wellKnownBaseUrl(provider);
  return { apiKey, baseUrl };
}

function pickEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toEnvKey(provider: string): string {
  return provider
    .toUpperCase()
    .replace(/-/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
}

function wellKnownApiKey(provider: string): string | undefined {
  switch (provider) {
    case 'openai':
    case 'openai-us':
    case 'openai-eu':
      return pickEnv('OPENAI_API_KEY');
    case 'anthropic':
    case 'claude':
      return pickEnv('ANTHROPIC_API_KEY');
    case 'gemini':
    case 'google':
    case 'google-ai-studio':
      return pickEnv('GEMINI_API_KEY') ?? pickEnv('GOOGLE_API_KEY');
    case 'openrouter':
      return pickEnv('OPENROUTER_API_KEY');
    case 'deepseek':
      return pickEnv('DEEPSEEK_API_KEY');
    case 'ollama':
      return undefined;
    default:
      return undefined;
  }
}

function wellKnownBaseUrl(provider: string): string | undefined {
  switch (provider) {
    case 'openai':
    case 'openai-us':
      return pickEnv('OPENAI_BASE_URL');
    case 'anthropic':
    case 'claude':
      return pickEnv('ANTHROPIC_BASE_URL');
    case 'gemini':
    case 'google':
    case 'google-ai-studio':
      return pickEnv('GEMINI_BASE_URL');
    case 'openrouter':
      return pickEnv('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1';
    case 'deepseek':
      return pickEnv('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com/v1';
    case 'ollama':
      return pickEnv('OLLAMA_BASE_URL') ?? 'http://localhost:11434';
    default:
      return undefined;
  }
}

function mergeHeaders(
  base: Record<string, string> | undefined,
  override: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) };
}
