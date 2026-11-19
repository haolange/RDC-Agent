/** OS primitives behind the process contract in ./process. */
export interface ProcessBackend {
  /** Whether a live (non-zombie) process has `pid`; throws when the host cannot tell. */
  isRunning(pid: number): boolean;
  /** Birth token of the live process with `pid`; null when none is alive; throws when unreadable. */
  readBirth(pid: number): string | null;
  /** Raw command line of a live process, or null when it cannot be read. */
  readCommandLine(pid: number): string | null;
  /** Force-kills `pid` with its descendants; true when the kill was delivered. */
  killTree(pid: number, timeoutMs: number): boolean;
  /** Signals an owned child and its descendants; the caller observes the exit. */
  signalChildTree(pid: number, signal: NodeJS.Signals, timeoutMs: number): void;
  /** Spawn options that give an isolated child its own killable tree. */
  readonly childGroupOptions: { readonly detached?: boolean };
}
