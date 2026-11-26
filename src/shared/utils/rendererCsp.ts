/**
 * The renderer's Content-Security-Policy: the one source for the desktop session header, the Browser QA bridge and
 * the meta tag in `src/renderer/index.html` (a test keeps them equal). The renderer reaches the main process over IPC
 * (or the same-origin bridge) only, and remote images come through main, so production `connect-src` is `'self'`;
 * development adds the Vite dev server and its HMR socket.
 */
export type RendererCspProfile = 'production' | 'development';

export function buildRendererCsp(profile: RendererCspProfile): string {
  const development = profile === 'development';
  return [
    "default-src 'self'",
    development ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:*" : "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    development ? "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
