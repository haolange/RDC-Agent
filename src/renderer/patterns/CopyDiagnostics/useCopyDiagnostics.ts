import { useCallback } from 'react';
import { useCopyText } from '../../lib/clipboard';

/** One technical fact for support: a readable label and its exact value. */
export interface DiagnosticFact {
  label: string;
  value: string | number | null | undefined;
}

/** The facts as plain text, one per line, skipping the ones that have no value. */
export function formatDiagnostics(facts: readonly DiagnosticFact[]): string {
  return facts
    .filter((fact) => fact.value !== null && fact.value !== undefined && String(fact.value).trim() !== '')
    .map((fact) => `${fact.label}: ${String(fact.value)}`)
    .join('\n');
}

/**
 * Technical facts never sit on a product surface. They leave through one action, 复制诊断信息, usually an item in
 * the object's ⋯ menu, which copies them as text for whoever needs them.
 */
export function useCopyDiagnostics(facts: readonly DiagnosticFact[]): () => Promise<boolean> {
  const copyText = useCopyText();
  return useCallback(() => copyText(formatDiagnostics(facts)), [copyText, facts]);
}
