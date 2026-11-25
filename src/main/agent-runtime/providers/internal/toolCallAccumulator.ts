import type { AssistantStreamBuilder } from './AssistantStreamBuilder';
import type { ProviderOutputRef } from '../../core/types';

interface ToolCallState {
  open: boolean;
  hasArguments: boolean;
}

/**
 * Assembles tool calls whose parts arrive across frames, keyed by the wire's call index or item id. The builder keeps
 * the argument text and parses it when the call closes; this tracks which calls started, which are still open and
 * whether any argument text arrived, so a closing frame that repeats the whole arguments fills them only when nothing
 * streamed.
 *
 * Each operation takes the output ref the frame addresses, so a frame that names a call the stream never started, or
 * already closed, reaches the builder and fails there as a protocol violation.
 */
export class ToolCallAccumulator<Key> {
  private readonly calls = new Map<Key, ToolCallState>();

  constructor(private readonly builder: AssistantStreamBuilder) {}

  /** Number of calls started so far, open or closed. */
  get count(): number {
    return this.calls.size;
  }

  isOpen(key: Key): boolean {
    return this.calls.get(key)?.open === true;
  }

  /** Whether any argument text arrived for the call, streamed or whole. */
  hasArguments(key: Key): boolean {
    return this.calls.get(key)?.hasArguments === true;
  }

  /** Starts a call the wire announces exactly once; a second announcement is a violation the builder reports. */
  start(key: Key, ref: ProviderOutputRef, id: string, name: string): void {
    this.builder.startToolCall(ref, id, name);
    this.calls.set(key, { open: true, hasArguments: false });
  }

  /** Starts the call on first sight; a later sighting only fills an id or name the start lacked. */
  open(key: Key, ref: ProviderOutputRef, id: string, name: string): void {
    if (this.calls.has(key)) this.builder.updateToolCall(ref, id, name);
    else this.start(key, ref, id, name);
  }

  /** Appends argument text: one streamed fragment of the JSON arguments, or all of them at once. */
  appendArguments(key: Key, ref: ProviderOutputRef, text: string): void {
    if (!text) return;
    const call = this.calls.get(key);
    if (call) call.hasArguments = true;
    this.builder.appendToolCallArgs(ref, text);
  }

  close(key: Key, ref: ProviderOutputRef): void {
    this.builder.endToolCall(ref);
    const call = this.calls.get(key);
    if (call) call.open = false;
  }

  /** A call the wire delivers whole in one frame: started, given its arguments and closed at once. */
  addComplete(key: Key, ref: ProviderOutputRef, id: string, name: string, argumentsText: string): void {
    this.start(key, ref, id, name);
    this.appendArguments(key, ref, argumentsText);
    this.close(key, ref);
  }
}
