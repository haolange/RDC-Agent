/** Extract a bounded visible opening; the stored body is unchanged. */
export function delegationTextPreview(source: string): string {
  const lines = source.trimStart().split(/\r?\n/u);
  const opening: string[] = [];
  let code = false;
  for (const line of lines) {
    if (/^\s*(`{3,}|~{3,})/u.test(line)) { if (opening.length) break; code = !code; continue; }
    if (!line.trim()) { if (opening.length) break; continue; }
    if (!code && /^\s*(?:[-*_]\s*){3,}$/u.test(line)) continue;
    const text = code ? line : line
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/u, '')
      .replace(/^\[[ xX]\]\s*/u, '')
      .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/gu, '$1')
      .replace(/(`+)(.*?)\1/gu, '$2')
      .replace(/(\*\*|__|~~)(.*?)\1/gu, '$2')
      .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|[.,!?]|$)/gu, '$1$2')
      .replace(/\\([\\`*{}[\]()#+.!_>~-])/gu, '$1');
    if (text.trim()) opening.push(text.trim());
    if (code || /^\s*(?:#{1,6}\s|[-+*]\s|\d+[.)]\s)/u.test(line) || opening.join(' ').length >= 480) break;
  }
  return opening.join(' ').replace(/\s+/gu, ' ').slice(0, 480);
}
