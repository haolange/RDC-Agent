let enabled = false;

/** Turns on pseudo-localization for layout QA; only the Browser QA entry calls this, behind an explicit URL flag. */
export function enablePseudoLocale(): void {
  enabled = true;
}

export const pseudoLocaleEnabled = (): boolean => enabled;

const ACCENTED: Record<string, string> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', c: 'ç', n: 'ñ', y: 'ý',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', C: 'Ç', N: 'Ñ', Y: 'Ý',
};

/**
 * The English template, accented so an untranslated literal stands out, and 40% longer so a layout that only fits
 * English shows it. Placeholders are kept intact for interpolation.
 */
export function pseudoLocalize(template: string): string {
  const body = template.split(/(\{\w+\})/u)
    .map((part) => (/^\{\w+\}$/u.test(part) ? part : [...part].map((char) => ACCENTED[char] ?? char).join('')))
    .join('');
  return `[${body}${'~'.repeat(Math.ceil(template.length * 0.4))}]`;
}
