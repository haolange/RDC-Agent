import type { TranslationKey } from '../../i18n/messages';
import type { BuiltinAgentToolId } from '@shared/constants/agentToolTokens';
import type {
  WorkProcessIconKey,
  WorkProcessToolFamily,
  WorkProcessToolGroupKind,
} from './workProcessTypes';

export interface WorkProcessToolDisplay {
  /** The Work Process card family that renders this tool. */
  family: WorkProcessToolFamily;
  icon: WorkProcessIconKey;
  groupKind: WorkProcessToolGroupKind;
  category: TranslationKey;
  groupTitle: TranslationKey;
  groupUnit: TranslationKey;
  completeVerb: TranslationKey;
  runningVerb: TranslationKey;
  pendingVerb?: TranslationKey;
  mutation?: boolean;
  approval?: boolean;
  errorAccent?: boolean;
}

export const WORK_PROCESS_TOOL_DISPLAY_CATALOG: Record<BuiltinAgentToolId, WorkProcessToolDisplay> = {
  read_file: { family: 'file', icon: 'fileRead', groupKind: 'explore', category: 'chat.toolDisplay.read_file.category', groupTitle: 'chat.toolDisplay.read_file.groupTitle', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.readComplete', runningVerb: 'chat.workProcessVerb.readRunning' },
  artifact_read: { family: 'file', icon: 'artifactRead', groupKind: 'explore', category: 'chat.toolDisplay.artifact_read.category', groupTitle: 'chat.toolDisplay.read_file.groupTitle', groupUnit: 'chat.workProcessGroupArtifact', completeVerb: 'chat.toolDisplay.artifact_read.completeVerb', runningVerb: 'chat.toolDisplay.artifact_read.runningVerb' },
  read_image: { family: 'file', icon: 'imageRead', groupKind: 'explore', category: 'chat.toolDisplay.read_image.category', groupTitle: 'chat.toolDisplay.read_file.groupTitle', groupUnit: 'chat.toolDisplay.read_image.groupUnit', completeVerb: 'chat.workProcessVerb.imageComplete', runningVerb: 'chat.workProcessVerb.imageRunning' },
  glob: { family: 'search', icon: 'fileGlob', groupKind: 'explore', category: 'chat.toolDisplay.glob.category', groupTitle: 'chat.toolDisplay.read_file.groupTitle', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.globComplete', runningVerb: 'chat.workProcessVerb.globRunning' },
  grep: { family: 'search', icon: 'codeSearch', groupKind: 'search', category: 'chat.toolDisplay.grep.category', groupTitle: 'chat.workProcessGroupSearch', groupUnit: 'chat.toolDisplay.grep.groupUnit', completeVerb: 'chat.workProcessVerb.grepComplete', runningVerb: 'chat.workProcessVerb.grepRunning' },
  web_fetch: { family: 'web', icon: 'webFetch', groupKind: 'web', category: 'chat.toolDisplay.web_fetch.category', groupTitle: 'chat.toolDisplay.web_fetch.groupTitle', groupUnit: 'chat.toolDisplay.web_fetch.groupUnit', completeVerb: 'chat.workProcessVerb.webFetchComplete', runningVerb: 'chat.workProcessVerb.webFetchRunning', approval: true },
  web_search: { family: 'web', icon: 'webSearch', groupKind: 'search', category: 'chat.toolDisplay.web_search.category', groupTitle: 'chat.workProcessGroupSearch', groupUnit: 'chat.toolDisplay.grep.groupUnit', completeVerb: 'chat.workProcessVerb.webSearchComplete', runningVerb: 'chat.workProcessVerb.webSearchRunning', approval: true },
  shell: { family: 'shell', icon: 'terminal', groupKind: 'command', category: 'chat.workProcessGroupCommand', groupTitle: 'chat.workProcessGroupCommand', groupUnit: 'chat.workProcessGroupCommand', completeVerb: 'chat.workProcessVerb.shellComplete', runningVerb: 'chat.workProcessVerb.shellRunning', approval: true, errorAccent: true },
  write_file: { family: 'file', icon: 'fileWrite', groupKind: 'change', category: 'chat.toolDisplay.write_file.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.writeComplete', runningVerb: 'chat.workProcessVerb.writeRunning', mutation: true, approval: true },
  edit_file: { family: 'file', icon: 'fileEdit', groupKind: 'change', category: 'chat.toolDisplay.edit_file.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.editComplete', runningVerb: 'chat.workProcessVerb.editRunning', mutation: true, approval: true },
  delete_file: { family: 'file', icon: 'fileDelete', groupKind: 'change', category: 'chat.toolDisplay.delete_file.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.deleteComplete', runningVerb: 'chat.workProcessVerb.deleteRunning', mutation: true, approval: true, errorAccent: true },
  move_file: { family: 'file', icon: 'fileMove', groupKind: 'change', category: 'chat.toolDisplay.move_file.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.moveComplete', runningVerb: 'chat.workProcessVerb.moveRunning', mutation: true, approval: true },
  copy_file: { family: 'file', icon: 'fileCopy', groupKind: 'change', category: 'chat.toolDisplay.copy_file.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.copyComplete', runningVerb: 'chat.workProcessVerb.copyRunning', mutation: true, approval: true },
  notebook_edit: { family: 'file', icon: 'notebookEdit', groupKind: 'change', category: 'chat.toolDisplay.notebook_edit.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.notebook_edit.category', completeVerb: 'chat.workProcessVerb.notebookComplete', runningVerb: 'chat.workProcessVerb.notebookRunning', mutation: true },
  git_status: { family: 'git', icon: 'gitStatus', groupKind: 'git', category: 'chat.toolDisplay.git_status.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_status.groupUnit', completeVerb: 'chat.workProcessVerb.gitStatusComplete', runningVerb: 'chat.workProcessVerb.gitStatusRunning' },
  git_diff: { family: 'git', icon: 'gitDiff', groupKind: 'git', category: 'chat.toolDisplay.git_diff.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_diff.groupUnit', completeVerb: 'chat.workProcessVerb.gitDiffComplete', runningVerb: 'chat.workProcessVerb.gitDiffRunning' },
  git_log: { family: 'git', icon: 'gitLog', groupKind: 'git', category: 'chat.toolDisplay.git_log.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_log.groupUnit', completeVerb: 'chat.workProcessVerb.gitLogComplete', runningVerb: 'chat.workProcessVerb.gitLogRunning' },
  git_add: { family: 'git', icon: 'gitAdd', groupKind: 'git', category: 'chat.toolDisplay.git_add.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_add.groupUnit', completeVerb: 'chat.workProcessVerb.gitAddComplete', runningVerb: 'chat.workProcessVerb.gitAddRunning', mutation: true, approval: true },
  git_unstage: { family: 'git', icon: 'gitUnstage', groupKind: 'git', category: 'chat.toolDisplay.git_unstage.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_unstage.groupUnit', completeVerb: 'chat.workProcessVerb.gitUnstageComplete', runningVerb: 'chat.workProcessVerb.gitUnstageRunning', mutation: true, approval: true },
  git_commit: { family: 'git', icon: 'gitCommit', groupKind: 'git', category: 'chat.toolDisplay.git_commit.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_commit.groupUnit', completeVerb: 'chat.workProcessVerb.gitCommitComplete', runningVerb: 'chat.workProcessVerb.gitCommitRunning', mutation: true, approval: true },
  ask_user: { family: 'generic', icon: 'question', groupKind: 'interaction', category: 'chat.toolDisplay.ask_user.category', groupTitle: 'chat.workProcessGroupAsk', groupUnit: 'chat.toolDisplay.ask_user.groupUnit', completeVerb: 'chat.workProcessUserAnswered', runningVerb: 'chat.workProcessUserWaiting' },
  tool_search: { family: 'runtime', icon: 'toolSearch', groupKind: 'runtime', category: 'chat.workProcessGroupToolSearch', groupTitle: 'chat.workProcessGroupToolSearch', groupUnit: 'chat.toolDisplay.grep.groupUnit', completeVerb: 'chat.workProcessVerb.toolSearchComplete', runningVerb: 'chat.workProcessVerb.toolSearchRunning' },
  code_interpreter: { family: 'interpreter', icon: 'interpreter', groupKind: 'command', category: 'chat.toolDisplay.code_interpreter.category', groupTitle: 'chat.toolDisplay.code_interpreter.category', groupUnit: 'chat.toolDisplay.code_interpreter.groupUnit', completeVerb: 'chat.workProcessVerb.interpreterComplete', runningVerb: 'chat.workProcessVerb.interpreterRunning', approval: true, errorAccent: true },
  plan_artifact: { family: 'runtime', icon: 'planArtifact', groupKind: 'runtime', category: 'chat.toolDisplay.plan_artifact.category', groupTitle: 'chat.workProcessGroupArtifact', groupUnit: 'chat.workProcessGroupArtifact', completeVerb: 'chat.toolDisplay.plan_artifact.completeVerb', runningVerb: 'chat.toolDisplay.plan_artifact.runningVerb' },
  output_register: { family: 'runtime', icon: 'outputPublish', groupKind: 'runtime', category: 'chat.toolDisplay.output_register.category', groupTitle: 'chat.toolDisplay.output_register.groupTitle', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.outputRegisterComplete', runningVerb: 'chat.workProcessVerb.outputRegisterRunning', mutation: true },
  memory_search: { family: 'memory', icon: 'memorySearch', groupKind: 'memory', category: 'chat.toolDisplay.memory_search.category', groupTitle: 'chat.toolDisplay.memory_search.groupTitle', groupUnit: 'chat.workProcessGroupSearch', completeVerb: 'chat.workProcessVerb.memorySearchComplete', runningVerb: 'chat.workProcessVerb.memorySearchRunning' },
  memory_read: { family: 'memory', icon: 'memoryRead', groupKind: 'memory', category: 'chat.toolDisplay.memory_read.category', groupTitle: 'chat.toolDisplay.memory_search.groupTitle', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.memoryReadComplete', runningVerb: 'chat.workProcessVerb.memoryReadRunning' },
  memory_write: { family: 'memory', icon: 'memoryWrite', groupKind: 'memory', category: 'chat.toolDisplay.memory_write.category', groupTitle: 'chat.toolDisplay.memory_search.groupTitle', groupUnit: 'chat.toolDisplay.memory_write.groupUnit', completeVerb: 'chat.workProcessVerb.memoryWriteComplete', runningVerb: 'chat.workProcessVerb.memoryWriteRunning', mutation: true },
  memory_delete: { family: 'memory', icon: 'memoryDelete', groupKind: 'memory', category: 'chat.toolDisplay.memory_delete.category', groupTitle: 'chat.toolDisplay.memory_search.groupTitle', groupUnit: 'chat.toolDisplay.memory_delete.groupUnit', completeVerb: 'chat.workProcessVerb.memoryDeleteComplete', runningVerb: 'chat.workProcessVerb.memoryDeleteRunning', mutation: true },
  skills: { family: 'skill', icon: 'skillsList', groupKind: 'runtime', category: 'chat.toolDisplay.skills.category', groupTitle: 'chat.workProcessGroupSkills', groupUnit: 'chat.toolDisplay.grep.groupUnit', completeVerb: 'chat.workProcessVerb.skillsComplete', runningVerb: 'chat.workProcessVerb.skillsRunning' },
  skill_read: { family: 'skill', icon: 'skillRead', groupKind: 'runtime', category: 'chat.toolDisplay.skill_read.category', groupTitle: 'chat.workProcessGroupSkills', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.skillReadComplete', runningVerb: 'chat.workProcessVerb.skillReadRunning' },
  mcp: { family: 'mcp', icon: 'plug', groupKind: 'mcp', category: 'chat.workProcessGroupMcp', groupTitle: 'chat.workProcessGroupMcp', groupUnit: 'chat.toolDisplay.mcp.groupUnit', completeVerb: 'chat.workProcessVerb.mcpComplete', runningVerb: 'chat.workProcessVerb.mcpRunning' },
  runtime_context: { family: 'runtime', icon: 'monitor', groupKind: 'runtime', category: 'chat.toolDisplay.runtime_context.category', groupTitle: 'chat.workProcessGroupRdc', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.runtimeContextComplete', runningVerb: 'chat.workProcessVerb.runtimeContextRunning' },
  rdc_probe: { family: 'runtime', icon: 'rdcProbe', groupKind: 'runtime', category: 'chat.toolDisplay.runtime_context.category', groupTitle: 'chat.toolDisplay.rdc_probe.groupTitle', groupUnit: 'chat.toolDisplay.rdc_probe.groupUnit', completeVerb: 'chat.toolDisplay.rdc_probe.completeVerb', runningVerb: 'chat.toolDisplay.rdc_probe.runningVerb' },
  subagent: { family: 'generic', icon: 'brain', groupKind: 'collaboration', category: 'chat.workProcessGroupSubagent', groupTitle: 'chat.workProcessGroupSubagent', groupUnit: 'chat.toolDisplay.subagent.groupUnit', completeVerb: 'chat.workProcessVerb.subagentComplete', runningVerb: 'chat.workProcessVerb.subagentRunning' },
  subagent_report: { family: 'generic', icon: 'subagentReport', groupKind: 'collaboration', category: 'chat.toolDisplay.subagent_report.category', groupTitle: 'chat.workProcessGroupSubagent', groupUnit: 'chat.toolDisplay.subagent_report.groupUnit', completeVerb: 'chat.toolDisplay.subagent_report.completeVerb', runningVerb: 'chat.toolDisplay.subagent_report.runningVerb' },
  task_create: { family: 'generic', icon: 'taskCreate', groupKind: 'task', category: 'chat.toolDisplay.task_create.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.task_create.groupUnit', completeVerb: 'chat.workProcessVerb.taskCreateComplete', runningVerb: 'chat.workProcessVerb.taskCreateRunning', mutation: true },
  task_update: { family: 'generic', icon: 'taskUpdate', groupKind: 'task', category: 'chat.toolDisplay.task_update.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.task_update.groupUnit', completeVerb: 'chat.workProcessVerb.taskUpdateComplete', runningVerb: 'chat.workProcessVerb.taskUpdateRunning', mutation: true },
  task_get: { family: 'generic', icon: 'taskGet', groupKind: 'task', category: 'chat.toolDisplay.task_get.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.taskGetComplete', runningVerb: 'chat.workProcessVerb.taskGetRunning' },
  task_list: { family: 'generic', icon: 'taskList', groupKind: 'task', category: 'chat.toolDisplay.task_list.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.task_list.groupUnit', completeVerb: 'chat.workProcessVerb.taskListComplete', runningVerb: 'chat.workProcessVerb.taskListRunning' },
  task_stop: { family: 'generic', icon: 'taskStop', groupKind: 'task', category: 'chat.toolDisplay.task_stop.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.task_stop.groupUnit', completeVerb: 'chat.workProcessVerb.taskStopComplete', runningVerb: 'chat.workProcessVerb.taskStopRunning', mutation: true, errorAccent: true },
  turn_complete: { family: 'generic', icon: 'turnComplete', groupKind: 'task', category: 'chat.toolDisplay.turn_complete.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.turn_complete.groupUnit', completeVerb: 'chat.toolOutcomeRecorded', runningVerb: 'chat.toolOutcomeRecording' },
  background_query: { family: 'generic', icon: 'backgroundQuery', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.git_status.groupUnit', completeVerb: 'chat.toolDisplay.background_query.completeVerb', runningVerb: 'chat.toolDisplay.background_query.runningVerb' },
  background_wait: { family: 'generic', icon: 'backgroundWait', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.background_wait.groupUnit', completeVerb: 'chat.toolDisplay.background_wait.completeVerb', runningVerb: 'chat.toolDisplay.background_wait.runningVerb' },
  background_result: { family: 'generic', icon: 'backgroundResult', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.background_result.groupUnit', completeVerb: 'chat.toolDisplay.background_result.completeVerb', runningVerb: 'chat.toolDisplay.background_result.runningVerb' },
  background_message: { family: 'generic', icon: 'backgroundMessage', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.background_message.groupUnit', completeVerb: 'chat.toolDisplay.background_message.completeVerb', runningVerb: 'chat.toolDisplay.background_message.runningVerb', mutation: true },
  background_cancel: { family: 'generic', icon: 'backgroundCancel', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.background_cancel.groupUnit', completeVerb: 'chat.toolDisplay.background_cancel.completeVerb', runningVerb: 'chat.toolDisplay.background_cancel.runningVerb', mutation: true, errorAccent: true },
  background_join: { family: 'generic', icon: 'backgroundJoin', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.background_join.groupUnit', completeVerb: 'chat.toolDisplay.background_join.completeVerb', runningVerb: 'chat.toolDisplay.background_join.runningVerb' },
  knowledge_browse: { family: 'runtime', icon: 'knowledgeBrowse', groupKind: 'runtime', category: 'chat.toolDisplay.knowledge_browse.category', groupTitle: 'chat.toolDisplay.knowledge_browse.groupTitle', groupUnit: 'chat.toolDisplay.knowledge_browse.groupUnit', completeVerb: 'chat.workProcessVerb.knowledgeBrowseComplete', runningVerb: 'chat.workProcessVerb.knowledgeBrowseRunning' },
  knowledge_search: { family: 'runtime', icon: 'knowledgeSearch', groupKind: 'runtime', category: 'chat.toolDisplay.knowledge_search.category', groupTitle: 'chat.toolDisplay.knowledge_browse.groupTitle', groupUnit: 'chat.workProcessGroupSearch', completeVerb: 'chat.workProcessVerb.knowledgeSearchComplete', runningVerb: 'chat.workProcessVerb.knowledgeSearchRunning' },
  knowledge_read: { family: 'runtime', icon: 'knowledgeRead', groupKind: 'runtime', category: 'chat.toolDisplay.knowledge_read.category', groupTitle: 'chat.toolDisplay.knowledge_browse.groupTitle', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.knowledgeReadComplete', runningVerb: 'chat.workProcessVerb.knowledgeReadRunning' },
  knowledge_compile: { family: 'runtime', icon: 'knowledgeCompile', groupKind: 'runtime', category: 'chat.toolDisplay.knowledge_compile.category', groupTitle: 'chat.toolDisplay.knowledge_browse.groupTitle', groupUnit: 'chat.toolDisplay.knowledge_compile.groupUnit', completeVerb: 'chat.workProcessVerb.knowledgeCompileComplete', runningVerb: 'chat.workProcessVerb.knowledgeCompileRunning' },
  knowledge_candidate_create: { family: 'runtime', icon: 'knowledgeCandidate', groupKind: 'runtime', category: 'chat.toolDisplay.knowledge_candidate_create.category', groupTitle: 'chat.toolDisplay.knowledge_browse.groupTitle', groupUnit: 'chat.toolDisplay.knowledge_candidate_create.groupUnit', completeVerb: 'chat.workProcessVerb.knowledgeCandidateComplete', runningVerb: 'chat.workProcessVerb.knowledgeCandidateRunning', mutation: true },
  investigation_schema: { family: 'runtime', icon: 'investigationSchema', groupKind: 'runtime', category: 'chat.toolDisplay.investigation_schema.category', groupTitle: 'chat.toolDisplay.investigation_schema.groupTitle', groupUnit: 'chat.toolDisplay.investigation_schema.groupUnit', completeVerb: 'chat.workProcessVerb.investigationSchemaComplete', runningVerb: 'chat.workProcessVerb.investigationSchemaRunning' },
  investigation_read: { family: 'runtime', icon: 'investigationRead', groupKind: 'runtime', category: 'chat.toolDisplay.investigation_read.category', groupTitle: 'chat.toolDisplay.investigation_schema.groupTitle', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.investigationReadComplete', runningVerb: 'chat.workProcessVerb.investigationReadRunning' },
  investigation_write: { family: 'runtime', icon: 'investigationWrite', groupKind: 'runtime', category: 'chat.toolDisplay.investigation_write.category', groupTitle: 'chat.toolDisplay.investigation_schema.groupTitle', groupUnit: 'chat.toolDisplay.memory_write.groupUnit', completeVerb: 'chat.workProcessVerb.investigationWriteComplete', runningVerb: 'chat.workProcessVerb.investigationWriteRunning', mutation: true },
  investigation_list: { family: 'runtime', icon: 'investigationList', groupKind: 'runtime', category: 'chat.toolDisplay.investigation_list.category', groupTitle: 'chat.toolDisplay.investigation_schema.groupTitle', groupUnit: 'chat.toolDisplay.task_list.groupUnit', completeVerb: 'chat.workProcessVerb.investigationListComplete', runningVerb: 'chat.workProcessVerb.investigationListRunning' },
};

const GENERIC_TOOL_DISPLAY: WorkProcessToolDisplay = {
  family: 'generic',
  icon: 'tool',
  groupKind: 'runtime',
  category: 'chat.toolDisplay.genericCategory',
  groupTitle: 'chat.toolDisplay.genericCategory',
  groupUnit: 'chat.toolDisplay.mcp.groupUnit',
  completeVerb: 'chat.workProcessToolGenericComplete',
  runningVerb: 'chat.workProcessToolGenericRunning',
  pendingVerb: 'chat.workProcessToolGenericPending',
};

export const normalizeToolName = (toolName: string): string => toolName.trim().toLowerCase().replace(/[.-]/g, '_');

const getMcpParts = (normalizedToolName: string): { server: string; tool: string } | null => {
  if (!normalizedToolName.startsWith('mcp__')) return null;
  const [, server = '', ...toolParts] = normalizedToolName.split('__');
  const tool = toolParts.join('__');
  if (!server || !tool) return null;
  return { server, tool };
};

export const getToolDisplay = (toolName: string): WorkProcessToolDisplay => {
  const normalized = normalizeToolName(toolName);
  if (normalized.startsWith('mcp__')) return WORK_PROCESS_TOOL_DISPLAY_CATALOG.mcp;
  return Object.hasOwn(WORK_PROCESS_TOOL_DISPLAY_CATALOG, normalized)
    ? WORK_PROCESS_TOOL_DISPLAY_CATALOG[normalized as BuiltinAgentToolId] : GENERIC_TOOL_DISPLAY;
};

export const formatMcpTarget = (toolName: string): string => {
  const parts = getMcpParts(normalizeToolName(toolName));
  return parts ? `${parts.server}/${parts.tool}` : '';
};

/** The Work Process card family for a tool: the catalog entry's, MCP tools share one, others are generic. */
export const getToolFamily = (toolName: string): WorkProcessToolFamily => getToolDisplay(toolName).family;
