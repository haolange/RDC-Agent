/**
 * Main-issued, single-use approval tokens for sensitive IPC mutations.
 * Renderer must obtain a token from Main and cannot self-assert approved/confirmed.
 */
import { randomBytes } from 'crypto';

export type IpcApprovalAction = 'memory.write' | 'memory.delete';

export interface IpcApprovalTokenIssueRequest {
  action: IpcApprovalAction;
  scope: 'user' | 'project';
  name?: string;
  projectRoot?: string;
}

export interface IpcApprovalTokenConsumeRequest {
  token: string;
  action: IpcApprovalAction;
  scope: 'user' | 'project';
  name?: string;
  projectRoot?: string;
}

interface StoredApprovalToken {
  action: IpcApprovalAction;
  scope: 'user' | 'project';
  name?: string;
  projectRoot?: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;

export class IpcApprovalTokenService {
  private readonly tokens = new Map<string, StoredApprovalToken>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  issue(request: IpcApprovalTokenIssueRequest): string {
    this.pruneExpired();
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, {
      action: request.action,
      scope: request.scope,
      name: request.name?.trim() || undefined,
      projectRoot: request.projectRoot?.trim() || undefined,
      expiresAt: Date.now() + this.ttlMs,
    });
    return token;
  }

  consume(request: IpcApprovalTokenConsumeRequest): boolean {
    this.pruneExpired();
    const entry = this.tokens.get(request.token);
    if (!entry) return false;
    this.tokens.delete(request.token);
    if (entry.expiresAt < Date.now()) return false;
    if (entry.action !== request.action) return false;
    if (entry.scope !== request.scope) return false;
    if ((entry.name ?? '') !== (request.name?.trim() ?? '')) return false;
    if ((entry.projectRoot ?? '') !== (request.projectRoot?.trim() ?? '')) return false;
    return true;
  }

  /** Test helper — current outstanding token count. */
  size(): number {
    this.pruneExpired();
    return this.tokens.size;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt < now) this.tokens.delete(token);
    }
  }
}

export const ipcApprovalTokenService = new IpcApprovalTokenService();
