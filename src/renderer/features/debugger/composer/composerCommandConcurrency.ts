export function isConcurrentModelSwitchCommand(input: string): boolean {
  return /^\/model(?:\s|$)/i.test(input.trim());
}

export function shouldClearSubmittedPrompt(currentPrompt: string, submittedPrompt: string): boolean {
  return currentPrompt.trim() === submittedPrompt;
}
