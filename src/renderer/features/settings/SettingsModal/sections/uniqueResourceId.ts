export function uniqueResourceId(base: string, existing: Iterable<string>): string {
  const ids = new Set(existing);
  let candidate = base;
  let suffix = 2;
  while (ids.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}
