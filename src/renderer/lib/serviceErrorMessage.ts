export function serviceErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; code?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (typeof record.code === 'string' && record.code.trim()) return record.code;
  }
  return String(error);
}
