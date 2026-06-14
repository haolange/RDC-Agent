/**
 * MCPOAuth — MCP OAuth 2.0 认证流程。
 *
 * 支持:
 *  - OAuth 2.0 Authorization Code grant
 *  - Token 存储与自动刷新
 */

export interface MCPOAuthConfig {
  /** OAuth 授权端点 URL。 */
  authorizationUrl: string;
  /** OAuth Token 端点 URL。 */
  tokenUrl: string;
  /** Client ID。 */
  clientId: string;
  /** 授权范围。 */
  scopes?: string[];
  /** 本地回调端口（默认 18923）。 */
  redirectPort?: number;
}

export interface MCPOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
}

export class MCPOAuthClient {
  private tokens: MCPOAuthTokens | null = null;

  constructor(private config: MCPOAuthConfig) {}

  /** 检查 token 是否过期。 */
  isTokenExpired(): boolean {
    if (!this.tokens?.expiresAt) return false;
    return Date.now() > this.tokens.expiresAt - 60_000; // 1 min buffer
  }

  /** 获取有效 access token（必要时刷新）。 */
  async getAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (this.isTokenExpired() && this.tokens.refreshToken) {
      await this.refreshToken();
    }
    return this.tokens?.accessToken ?? null;
  }

  /** 启动授权流程（返回浏览器打开 URL）。 */
  getAuthorizationUrl(): string {
    const scopes = (this.config.scopes ?? ['openid']).join(' ');
    const redirectUri = `http://localhost:${this.config.redirectPort ?? 18923}/callback`;
    const state = Math.random().toString(36).slice(2);
    return `${this.config.authorizationUrl}?response_type=code&client_id=${encodeURIComponent(this.config.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}`;
  }

  /** 用授权码兑换 token。 */
  async exchangeCode(code: string): Promise<MCPOAuthTokens> {
    const redirectUri = `http://localhost:${this.config.redirectPort ?? 18923}/callback`;
    const res = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.config.clientId,
      }),
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    this.tokens = {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresAt: Date.now() + ((data.expires_in as number) ?? 3600) * 1000,
      tokenType: (data.token_type as string) ?? 'Bearer',
    };
    return this.tokens;
  }

  /** 刷新 token。 */
  private async refreshToken(): Promise<void> {
    if (!this.tokens?.refreshToken) return;
    const res = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
        client_id: this.config.clientId,
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    this.tokens = {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string) ?? this.tokens.refreshToken,
      expiresAt: Date.now() + ((data.expires_in as number) ?? 3600) * 1000,
      tokenType: (data.token_type as string) ?? 'Bearer',
    };
  }
}
