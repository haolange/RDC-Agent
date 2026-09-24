export function summarizeDelegationTask(task: string): string {
  const normalized = task.replace(/\s+/g, ' ').trim();
  const firstSentence = normalized.split(/[。！？]|(?<=[.!?])\s+|[\r\n]+/u)[0] ?? normalized;
  const action = firstSentence.replace(/\s+and (?:report|return|respond|stop)\b.*$/i, '').trim();
  const concise = action || firstSentence;
  return concise.length > 64 ? `${concise.slice(0, 63).trimEnd()}…` : concise;
}

export function formatInvocation(invocation: string): string {
  try { return JSON.stringify(JSON.parse(invocation) as unknown, null, 2); }
  catch { return invocation; }
}
