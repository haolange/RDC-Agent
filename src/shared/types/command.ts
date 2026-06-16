/**
 * Command system shared types.
 */

/** Command execution context passed from the renderer/main process. */
export interface CommandContext {
  /** Current session ID, if any. */
  sessionId?: string;
  /** Current project ID, if any. */
  projectId?: string;
  /** Current workspace root. */
  workspaceRoot?: string;
  /** Agent ID that invoked the command, if applicable. */
  agentId?: string;
}

/** Result of executing a command. */
export interface CommandResult {
  /** Whether the command executed successfully. */
  success: boolean;
  /** Human-readable output message. */
  message: string;
  /** Optional structured data payload. */
  data?: unknown;
  /** If the command caused a side effect, describe what happened. */
  sideEffect?: string;
}

/** Definition of a slash command. */
export interface CommandDefinition {
  /** Unique command ID (kebab-case, e.g. "help", "clear", "git-commit"). */
  id: string;
  /** Primary command name (without leading slash). */
  name: string;
  /** Short description shown in the command list popover. */
  description: string;
  /** Alternative names that trigger this command. */
  aliases?: string[];
  /** Category for grouping in the UI. */
  category: 'workflow' | 'navigation' | 'system' | 'debug' | 'edit';
  /** Execute the command. Receives parsed arguments and context. */
  execute: (args: string[], context: CommandContext) => Promise<CommandResult>;
}

/** IPC request to execute a slash command. */
export interface CommandExecuteRequest {
  /** The raw input string (including leading slash). */
  input: string;
  /** Execution context. */
  context?: CommandContext;
}

/** IPC response from command list. */
export interface CommandListResult {
  commands: Array<{
    id: string;
    name: string;
    description: string;
    aliases: string[];
    category: string;
  }>;
}
