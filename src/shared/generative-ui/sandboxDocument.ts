import type { GenerativeUiSource } from '../types/generativeUi';

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'", "style-src 'unsafe-inline'", "script-src 'unsafe-inline'",
  "img-src data: blob:", "font-src data:", "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
].join('; ');

export const GENERATIVE_UI_IFRAME_SANDBOX = 'allow-scripts' as const;

export function buildGenerativeUiSandboxDocument(source: GenerativeUiSource, instrument = true): string {
  const css = source.css.replace(/<\/style/gi, '<\\/style');
  const javascript = source.javascript.replace(/<\/script/gi, '<\\/script');
  const observer = `(function(){const channel=new MessageChannel();parent.postMessage({source:'rdc-generative-ui-channel'},'*',[channel.port2]);const send=(eventType,data={})=>channel.port1.postMessage({eventType,...data});addEventListener('error',e=>send('runtime_error',{message:e.message||'Runtime error'}));addEventListener('unhandledrejection',e=>send('unhandled_rejection',{message:String(e.reason||'Unhandled rejection')}));addEventListener('DOMContentLoaded',e=>{if(e.isTrusted)send('ready',{latencyMs:Math.max(0,Math.round(performance.now()))})});for(const type of ['click','input','change','submit'])addEventListener(type,e=>{if(e.isTrusted)send('interaction',{interactionType:type,message:(e.target?.tagName||'')+(e.target?.id?'#'+e.target.id:'')})},true)})();`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${source.html}${instrument ? `<script>${observer}</script>` : ''}<script>${javascript}</script></body></html>`;
}
