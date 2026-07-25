export class ProviderConnectionError extends Error {}

export function parseProviderError(error: unknown): string {
  if (error instanceof ProviderConnectionError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '连接测试超时，请稍后重试';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return '连接测试失败';
}
