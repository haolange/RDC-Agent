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
  /** Current mode/agent context. */
  currentMode?: string;
  /** Current model ID. */
  currentModelId?: string;
  /** Current theme. */
  currentTheme?: string;
}

/** Result of executing a command. */
export interface CommandResult {
  /** Whether the command executed successfully. */
  success: boolean;
  /** Human-readable output message. */
  message: string;
  /** Optional structured data payload. */
  data?: unknown;
  /** Optional system message content to insert into the conversation. */
  systemMessage?: string;
  /** UI action to trigger after command execution. */
  uiAction?: CommandUiAction;
  /** Stores that need to be invalidated after command execution. */
  invalidateStores?: Array<'session' | 'project' | 'settings' | 'conversation'>;
}

/**
 * Structured UI actions emitted by slash commands.
 * Commands no longer use the removed string side-effect channel.
 */
export type CommandUiAction =
  | { type: 'none' }
  | { type: 'open-settings'; payload?: { section?: string } }
  | { type: 'switch-mode'; payload: { agentId: string } }
  | { type: 'switch-model'; payload: { modelId: string } }
  | { type: 'switch-theme'; payload: { theme: string } }
  | { type: 'switch-permissions'; payload: { mode: string } }
  | { type: 'change-workspace'; payload: { path: string } }
  | { type: 'resume-session'; payload: { sessionId: string } }
  | { type: 'export-session'; payload: { sessionId: string; format?: 'markdown' | 'json' } }
  | { type: 'compact-session'; payload: { sessionId: string } }
  | { type: 'undo-session'; payload: { sessionId: string } }
  | { type: 'clear-session'; payload: { sessionId: string } }
  | { type: 'run-skill'; payload: { skillId: string } };

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
  category: 'workflow' | 'navigation' | 'system' | 'debug' | 'edit' | 'session';
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
