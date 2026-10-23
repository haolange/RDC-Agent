export function isBrowserAppSession(): boolean {
  return Boolean((window as Window & { __RDC_AGENT_BROWSER_APP_BRIDGE__?: true }).__RDC_AGENT_BROWSER_APP_BRIDGE__);
}
