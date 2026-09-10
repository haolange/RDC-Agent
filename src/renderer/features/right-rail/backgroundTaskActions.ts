export async function stopBackgroundWork(sessionId: string): Promise<void> {
  const result = await window.electronAPI.conversation.cancelActiveTurn({ sessionId });
  if (!result.success) throw new Error(result.error || 'Unable to stop session work.');
}
