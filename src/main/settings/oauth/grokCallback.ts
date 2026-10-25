import { createServer } from 'http';
import type { OAuthFlowState } from './oauthTypes';

/** The listener belongs to one login attempt, never to the application's Browser bridge. */
export async function listenGrokCallback(
  flow: OAuthFlowState,
  complete: (code: string) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', flow.redirectUri);
    const reply = (status: number, text: string) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(text);
    };
    if (request.method !== 'GET' || url.pathname !== '/callback') return reply(404, 'Not found.');
    if (flow.abortController?.signal.aborted || Date.now() > flow.expiresAt || flow.exchanging) {
      return reply(410, 'This sign-in attempt is no longer active.');
    }
    if (!url.searchParams.get('state') || url.searchParams.get('state') !== flow.state) {
      return reply(400, 'The sign-in state did not match.');
    }
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error') || !code) {
      flow.error = 'Grok authorization was declined or returned no code. Try signing in again.';
      reply(400, flow.error);
      flow.abortController?.abort();
      return;
    }
    flow.exchanging = true;
    void complete(code).then(() => reply(200, 'Grok sign-in complete. Return to RDC-Agent.'))
      .catch(() => reply(400, 'Grok sign-in failed. Return to RDC-Agent for details.'))
      .finally(() => { server.close(); clearTimeout(flow.timeout); });
  });
  flow.server = server;
  const close = () => { clearTimeout(flow.timeout); server.close(); server.closeIdleConnections(); };
  flow.abortController?.signal.addEventListener('abort', close, { once: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Grok callback port is unavailable.'));
      flow.redirectUri = `http://127.0.0.1:${address.port}/callback`;
      resolve();
    });
  });
  if (flow.abortController?.signal.aborted) { close(); throw new Error('Sign-in was cancelled.'); }
  flow.timeout = setTimeout(() => {
    flow.error = 'Grok sign-in timed out. Try signing in again.';
    flow.abortController?.abort();
  }, Math.max(0, flow.expiresAt - Date.now()));
  flow.timeout.unref();
}
