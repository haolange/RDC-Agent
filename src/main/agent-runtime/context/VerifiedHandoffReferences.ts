import type { ModelHandoffSections } from './StructuredHandoffBuilder';

const URI_HASH_PAIR = /(session:\/\/[^\s`"'<>()[\]{}（）,，;；]+)([\s`"'()\[\]{}（）,，;；:：]*(?:sha[-_\s]?256|(?:expected|content)?hash|摘要|哈希)[\s`"'()\[\]{}（）,，;；:：=]*)([a-f\d]{64})(?![a-f\d])/giu;

export function reconcileHandoffReferences(
  sections: ModelHandoffSections,
  references: Array<{ uri: string; hash: string }>,
): { sections: ModelHandoffSections; corrected: number } {
  const verified = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const ref of references) {
    const hash = ref.hash.replace(/^sha256:/iu, '').toLowerCase();
    if (!ref.uri.startsWith('session://') || !/^[a-f\d]{64}$/u.test(hash) || ambiguous.has(ref.uri)) continue;
    const previous = verified.get(ref.uri);
    if (previous && previous !== hash) {
      verified.delete(ref.uri);
      ambiguous.add(ref.uri);
    } else verified.set(ref.uri, hash);
  }
  let corrected = 0;
  const reconcile = (text: string): string => text.replace(URI_HASH_PAIR, (pair, uri: string, label: string, hash: string) => {
    const expected = verified.get(uri);
    if (!expected || expected === hash.toLowerCase()) return pair;
    corrected += 1;
    return `${uri}${label}[unverified summary hash omitted; available authorized source sha256:${expected}; do not assume it is the same version, reread the original]`;
  });
  const apply = (items: string[]): string[] => items.map(reconcile);
  const reconciled: ModelHandoffSections = {
    objective: reconcile(sections.objective),
    constraints: apply(sections.constraints),
    progress: {
      done: apply(sections.progress.done), inProgress: apply(sections.progress.inProgress), blocked: apply(sections.progress.blocked),
    },
    decisions: apply(sections.decisions), failedAttempts: apply(sections.failedAttempts),
    nextSteps: apply(sections.nextSteps), criticalContext: apply(sections.criticalContext),
  };
  return { sections: reconciled, corrected };
}
