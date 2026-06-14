/**
 * SentryService — 崩溃报告与错误追踪。
 */
export interface SentryConfig {
  dsn: string;
  environment?: string;
  release?: string;
}

export class SentryService {
  private initialized = false;

  init(config: SentryConfig): void {
    if (this.initialized) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sentry = require('@sentry/electron/main') as { init: (opts: Record<string, unknown>) => void };
      Sentry.init({
        dsn: config.dsn,
        environment: config.environment ?? process.env.NODE_ENV ?? 'production',
        release: config.release,
        integrations: [],
      });
      this.initialized = true;
    } catch {
      console.warn('[Sentry] @sentry/electron not installed; crash reporting disabled');
    }
  }

  captureException(error: Error, context?: Record<string, unknown>): void {
    if (!this.initialized) { console.error('[Sentry]', error.message, context); return; }
    try {
      const Sentry = require('@sentry/electron/main') as { captureException: (e: Error, opts?: Record<string, unknown>) => void };
      Sentry.captureException(error, { extra: context });
    } catch { /* silent */ }
  }

  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'error'): void {
    if (!this.initialized) return;
    try {
      const Sentry = require('@sentry/electron/main') as { captureMessage: (m: string, l: string) => void };
      Sentry.captureMessage(message, level);
    } catch { /* silent */ }
  }
}

export const sentryService = new SentryService();
