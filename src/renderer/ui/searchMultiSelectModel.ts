export interface SearchMultiSelectOption {
  id: string;
  label: string;
  source?: string;
  disabled?: boolean;
}

export function filterMultiSelectOptions(options: readonly SearchMultiSelectOption[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.id)) return false;
    seen.add(option.id);
    return `${option.label} ${option.id} ${option.source ?? ''}`.toLocaleLowerCase().includes(needle);
  });
}

export function toggleMultiSelectId(value: readonly string[], id: string, selected: boolean): string[] {
  const unique = [...new Set(value)];
  return selected ? (unique.includes(id) ? unique : [...unique, id]) : unique.filter((item) => item !== id);
}
