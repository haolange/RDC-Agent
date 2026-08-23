import * as fs from 'fs';
import * as path from 'path';
import { appendJsonl, assertNoJsonlDiagnostics, readJsonl } from '@shared/utils/jsonl';
import type { RunContextUsageSummary } from '@shared/types/session';
import type { SessionContextTurnEntry } from '../conversation/SessionContextJournal';
import {
  SESSION_CONTEXT_VIEW_MIGRATIONS,
  SESSION_SHELL_STATE_MIGRATIONS,
  SESSION_USAGE_MIGRATIONS,
  toSessionContextViewManifest,
  toSessionShellStateManifest,
  toSessionUsageManifest,
} from './storageSchema';


export class SessionContextStore {
  constructor(private readonly host: import('./storageHost').StorageHost) {}

  getSessionUsagePath(sessionId: string): string | null {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) return null;
    return path.join(location.sessionPath, 'usage.json');
  }

  readSessionUsage(sessionId: string): RunContextUsageSummary | null {
    if (sessionId.includes('::subagent::')) {
      return null;
    }
    const usagePath = this.getSessionUsagePath(sessionId);
    if (!usagePath) return null;
    return this.host.io.readJson(usagePath, SESSION_USAGE_MIGRATIONS)?.usage ?? null;
  }

  getSessionShellStatePath(sessionId: string): string | null {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) return null;
    return path.join(location.sessionPath, 'shell-state.json');
  }

  readSessionShellCwd(sessionId: string): string | null {
    if (sessionId.includes('::subagent::')) {
      return null;
    }
    const statePath = this.getSessionShellStatePath(sessionId);
    if (!statePath) return null;
    return this.host.io.readJson(statePath, SESSION_SHELL_STATE_MIGRATIONS)?.state.cwd ?? null;
  }

  writeSessionShellCwd(sessionId: string, cwd: string): void {
    if (sessionId.includes('::subagent::')) {
      return;
    }
    const statePath = this.getSessionShellStatePath(sessionId);
    if (!statePath) {
      throw new Error(`Session not found for shell state: ${sessionId}`);
    }
    this.host.io.writeJsonAtomic(statePath, toSessionShellStateManifest({ cwd }));
  }

  writeSessionUsage(sessionId: string, usage: RunContextUsageSummary): void {
    if (sessionId.includes('::subagent::')) {
      return;
    }
    const usagePath = this.getSessionUsagePath(sessionId);
    if (!usagePath) {
      throw new Error(`Session not found for usage snapshot: ${sessionId}`);
    }
    this.host.io.writeJsonAtomic(usagePath, toSessionUsageManifest(usage));
  }

  writeSessionContextJournal(sessionId: string, entries: SessionContextTurnEntry[]): void {
    this.host.io.writeJsonlAtomic(this.getSessionContextJournalPath(sessionId), entries);
  }

  clearSessionContextState(sessionId: string): void {
    this.writeSessionContextJournal(sessionId, []);
    this.clearSessionDerivedContextView(sessionId);
  }

  getSessionDerivedContextViewPath(sessionId: string): string {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) throw new Error(`Session not found for derived context view: ${sessionId}`);
    return path.join(location.sessionPath, 'context-view.json');
  }

  readSessionDerivedContextView(sessionId: string): import('@shared/types/semanticContext').DerivedContextView | null {
    const viewPath = this.getSessionDerivedContextViewPath(sessionId);
    if (!fs.existsSync(viewPath)) return null;
    return this.host.io.readJson(viewPath, SESSION_CONTEXT_VIEW_MIGRATIONS)?.view ?? null;
  }

  writeSessionDerivedContextView(
    sessionId: string,
    view: import('@shared/types/semanticContext').DerivedContextView,
  ): void {
    if (view.scope !== 'session' || view.sessionId !== sessionId) {
      throw new Error('Derived context view session ownership mismatch.');
    }
    this.host.io.writeJsonAtomic(
      this.getSessionDerivedContextViewPath(sessionId),
      toSessionContextViewManifest(view),
    );
  }

  clearSessionDerivedContextView(sessionId: string): void {
    fs.rmSync(this.getSessionDerivedContextViewPath(sessionId), { force: true });
  }

  getSessionContextJournalPath(sessionId: string): string {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) throw new Error(`Session not found for context journal: ${sessionId}`);
    return path.join(location.sessionPath, 'session-context.jsonl');
  }

  readSessionContextJournal(sessionId: string): SessionContextTurnEntry[] {
    const journalPath = this.getSessionContextJournalPath(sessionId);
    if (!fs.existsSync(journalPath)) return [];
    const result = readJsonl<SessionContextTurnEntry>(journalPath);
    assertNoJsonlDiagnostics(journalPath, result.diagnostics);
    return result.records;
  }

  appendSessionContextTurn(sessionId: string, entry: SessionContextTurnEntry): void {
    appendJsonl(this.getSessionContextJournalPath(sessionId), entry);
  }
}
