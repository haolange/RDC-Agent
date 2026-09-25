export function formatInvocation(invocation: string): string {
  try { return JSON.stringify(JSON.parse(invocation) as unknown, null, 2); }
  catch { return invocation; }
}
