import { createHash, randomBytes } from 'crypto';
import { REQUEST_TIMEOUT_MS } from './oauthConstants';

export const isTestMode = (): boolean => process.env.RDC_AGENT_TEST_MODE === '1';
export const shouldOpenSystemBrowser = (): boolean => !isTestMode() && process.env.RDC_AGENT_HEADLESS !== '1';

export const base64Url = (buffer: Buffer): string =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const createPkce = (): { verifier: string; challenge: string } => {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

export const appendParams = (baseUrl: string, params: Record<string, string>): string => {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

export const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export const readStringArray = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
);

export const parseProviderError = (error: unknown): string => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Connection test timed out.';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Provider connection failed.';
};

export const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const fetchJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : {};
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchOAuthJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : {};
    if (!response.ok && !(payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string')) {
      throw new Error(`HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

export const createFormBody = (params: Record<string, string>): string => new URLSearchParams(params).toString();

export const parseJwtPayload = (token?: string): Record<string, unknown> | null => {
  const payload = token?.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

export const extractChatGptAccountId = (idToken?: string): string | undefined => {
  const claims = parseJwtPayload(idToken);
  if (!claims) {
    return undefined;
  }

  const authClaim = claims['https://api.openai.com/auth'];
  const authRecord = authClaim && typeof authClaim === 'object' && !Array.isArray(authClaim)
    ? authClaim as Record<string, unknown>
    : {};
  const organizations = Array.isArray(claims.organizations) ? claims.organizations : [];
  const firstOrganization = organizations[0] && typeof organizations[0] === 'object'
    ? organizations[0] as Record<string, unknown>
    : {};

  return readString(authRecord.chatgpt_account_id)
    ?? readString(authRecord.account_id)
    ?? readString(claims['https://api.openai.com/auth.chatgpt_account_id'])
    ?? readString(claims.chatgpt_account_id)
    ?? readString(claims.account_id)
    ?? readString(firstOrganization.id);
};
