const UNITS = [['gigabyte', 1024 ** 3], ['megabyte', 1024 ** 2], ['kilobyte', 1024], ['byte', 1]] as const;

/** A file size in the interface language's own number and unit formatting (12 KB, 1.4 MB, 3,2 Go…). */
export function formatBytes(size: number, language: string): string {
  const [unit, scale] = UNITS.find(([, threshold]) => size >= threshold) ?? UNITS[3];
  return new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: scale === 1 ? 0 : 1 })
    .format(size / scale);
}
