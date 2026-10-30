import type { TranslationKey } from '../../i18n/messages';
import type { BuiltinAgentToolId } from '@shared/constants/agentToolTokens';
import type {
  WorkProcessIconKey,
  WorkProcessToolFamily,
  WorkProcessToolGroupKind,
} from './workProcessTypes';

export interface WorkProcessToolDisplay {
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
  read_file: { icon: 'fileRead', groupKind: 'explore', category: 'chat.toolDisplay.read_file.category', groupTitle: 'chat.toolDisplay.read_file.groupTitle', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.readComplete', runningVerb: 'chat.workProcessVerb.readRunning' },
  artifact_read: { icon: 'artifactRead', groupKind: 'explore', category: 'chat.toolDisplay.artifact_read.category', groupTitle: 'chat.toolDisplay.read_file.groupTitle', groupUnit: 'chat.workProcessGroupArtifact', completeVerb: 'chat.toolDisplay.artifact_read.completeVerb', runningVerb: 'chat.toolDisplay.artifact_read.runningVerb' },
  read_image: { icon: 'imageRead', groupKind: 'explore', category: 'chat.toolDisplay.read_image.category', groupTitle: 'chat.toolDisplay.read_file.groupTitle', groupUnit: 'chat.toolDisplay.read_image.groupUnit', completeVerb: 'chat.workProcessVerb.imageComplete', runningVerb: 'chat.workProcessVerb.imageRunning' },
  glob: { icon: 'fileGlob', groupKind: 'explore', category: 'chat.toolDisplay.glob.category', groupTitle: 'chat.toolDisplay.read_file.groupTitle', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.globComplete', runningVerb: 'chat.workProcessVerb.globRunning' },
  grep: { icon: 'codeSearch', groupKind: 'search', category: 'chat.toolDisplay.grep.category', groupTitle: 'chat.workProcessGroupSearch', groupUnit: 'chat.toolDisplay.grep.groupUnit', completeVerb: 'chat.workProcessVerb.grepComplete', runningVerb: 'chat.workProcessVerb.grepRunning' },
  web_fetch: { icon: 'webFetch', groupKind: 'web', category: 'chat.toolDisplay.web_fetch.category', groupTitle: 'chat.toolDisplay.web_fetch.groupTitle', groupUnit: 'chat.toolDisplay.web_fetch.groupUnit', completeVerb: 'chat.workProcessVerb.webFetchComplete', runningVerb: 'chat.workProcessVerb.webFetchRunning', approval: true },
  web_search: { icon: 'webSearch', groupKind: 'search', category: 'chat.toolDisplay.web_search.category', groupTitle: 'chat.workProcessGroupSearch', groupUnit: 'chat.toolDisplay.grep.groupUnit', completeVerb: 'chat.workProcessVerb.webSearchComplete', runningVerb: 'chat.workProcessVerb.webSearchRunning', approval: true },
  shell: { icon: 'terminal', groupKind: 'command', category: 'chat.workProcessGroupCommand', groupTitle: 'chat.workProcessGroupCommand', groupUnit: 'chat.workProcessGroupCommand', completeVerb: 'chat.workProcessVerb.shellComplete', runningVerb: 'chat.workProcessVerb.shellRunning', approval: true, errorAccent: true },
  write_file: { icon: 'fileWrite', groupKind: 'change', category: 'chat.toolDisplay.write_file.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.writeComplete', runningVerb: 'chat.workProcessVerb.writeRunning', mutation: true, approval: true },
  edit_file: { icon: 'fileEdit', groupKind: 'change', category: 'chat.toolDisplay.edit_file.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.editComplete', runningVerb: 'chat.workProcessVerb.editRunning', mutation: true, approval: true },
  delete_file: { icon: 'fileDelete', groupKind: 'change', category: 'chat.toolDisplay.delete_file.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.deleteComplete', runningVerb: 'chat.workProcessVerb.deleteRunning', mutation: true, approval: true, errorAccent: true },
  move_file: { icon: 'fileMove', groupKind: 'change', category: 'chat.toolDisplay.move_file.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.moveComplete', runningVerb: 'chat.workProcessVerb.moveRunning', mutation: true, approval: true },
  copy_file: { icon: 'fileCopy', groupKind: 'change', category: 'chat.toolDisplay.copy_file.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.copyComplete', runningVerb: 'chat.workProcessVerb.copyRunning', mutation: true, approval: true },
  notebook_edit: { icon: 'notebookEdit', groupKind: 'change', category: 'chat.toolDisplay.notebook_edit.category', groupTitle: 'chat.workProcessGroupChange', groupUnit: 'chat.toolDisplay.notebook_edit.category', completeVerb: 'chat.workProcessVerb.notebookComplete', runningVerb: 'chat.workProcessVerb.notebookRunning', mutation: true },
  git_status: { icon: 'gitStatus', groupKind: 'git', category: 'chat.toolDisplay.git_status.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_status.groupUnit', completeVerb: 'chat.workProcessVerb.gitStatusComplete', runningVerb: 'chat.workProcessVerb.gitStatusRunning' },
  git_diff: { icon: 'gitDiff', groupKind: 'git', category: 'chat.toolDisplay.git_diff.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_diff.groupUnit', completeVerb: 'chat.workProcessVerb.gitDiffComplete', runningVerb: 'chat.workProcessVerb.gitDiffRunning' },
  git_log: { icon: 'gitLog', groupKind: 'git', category: 'chat.toolDisplay.git_log.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_log.groupUnit', completeVerb: 'chat.workProcessVerb.gitLogComplete', runningVerb: 'chat.workProcessVerb.gitLogRunning' },
  git_add: { icon: 'gitAdd', groupKind: 'git', category: 'chat.toolDisplay.git_add.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_add.groupUnit', completeVerb: 'chat.workProcessVerb.gitAddComplete', runningVerb: 'chat.workProcessVerb.gitAddRunning', mutation: true, approval: true },
  git_unstage: { icon: 'gitUnstage', groupKind: 'git', category: 'chat.toolDisplay.git_unstage.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_unstage.groupUnit', completeVerb: 'chat.workProcessVerb.gitUnstageComplete', runningVerb: 'chat.workProcessVerb.gitUnstageRunning', mutation: true, approval: true },
  git_commit: { icon: 'gitCommit', groupKind: 'git', category: 'chat.toolDisplay.git_commit.category', groupTitle: 'chat.workProcessGroupGit', groupUnit: 'chat.toolDisplay.git_commit.groupUnit', completeVerb: 'chat.workProcessVerb.gitCommitComplete', runningVerb: 'chat.workProcessVerb.gitCommitRunning', mutation: true, approval: true },
  ask_user: { icon: 'question', groupKind: 'interaction', category: 'chat.toolDisplay.ask_user.category', groupTitle: 'chat.workProcessGroupAsk', groupUnit: 'chat.toolDisplay.ask_user.groupUnit', completeVerb: 'chat.workProcessUserAnswered', runningVerb: 'chat.workProcessUserWaiting' },
  tool_search: { icon: 'toolSearch', groupKind: 'runtime', category: 'chat.workProcessGroupToolSearch', groupTitle: 'chat.workProcessGroupToolSearch', groupUnit: 'chat.toolDisplay.grep.groupUnit', completeVerb: 'chat.workProcessVerb.toolSearchComplete', runningVerb: 'chat.workProcessVerb.toolSearchRunning' },
  code_interpreter: { icon: 'interpreter', groupKind: 'command', category: 'chat.toolDisplay.code_interpreter.category', groupTitle: 'chat.toolDisplay.code_interpreter.category', groupUnit: 'chat.toolDisplay.code_interpreter.groupUnit', completeVerb: 'chat.workProcessVerb.interpreterComplete', runningVerb: 'chat.workProcessVerb.interpreterRunning', approval: true, errorAccent: true },
  plan_artifact: { icon: 'planArtifact', groupKind: 'runtime', category: 'chat.toolDisplay.plan_artifact.category', groupTitle: 'chat.workProcessGroupArtifact', groupUnit: 'chat.workProcessGroupArtifact', completeVerb: 'chat.toolDisplay.plan_artifact.completeVerb', runningVerb: 'chat.toolDisplay.plan_artifact.runningVerb' },
  output_register: { icon: 'outputPublish', groupKind: 'runtime', category: 'chat.toolDisplay.output_register.category', groupTitle: 'chat.toolDisplay.output_register.groupTitle', groupUnit: 'chat.toolDisplay.read_file.groupUnit', completeVerb: 'chat.workProcessVerb.outputRegisterComplete', runningVerb: 'chat.workProcessVerb.outputRegisterRunning', mutation: true },
  memory_search: { icon: 'memorySearch', groupKind: 'memory', category: 'chat.toolDisplay.memory_search.category', groupTitle: 'chat.toolDisplay.memory_search.groupTitle', groupUnit: 'chat.workProcessGroupSearch', completeVerb: 'chat.workProcessVerb.memorySearchComplete', runningVerb: 'chat.workProcessVerb.memorySearchRunning' },
  memory_read: { icon: 'memoryRead', groupKind: 'memory', category: 'chat.toolDisplay.memory_read.category', groupTitle: 'chat.toolDisplay.memory_search.groupTitle', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.memoryReadComplete', runningVerb: 'chat.workProcessVerb.memoryReadRunning' },
  memory_write: { icon: 'memoryWrite', groupKind: 'memory', category: 'chat.toolDisplay.memory_write.category', groupTitle: 'chat.toolDisplay.memory_search.groupTitle', groupUnit: 'chat.toolDisplay.memory_write.groupUnit', completeVerb: 'chat.workProcessVerb.memoryWriteComplete', runningVerb: 'chat.workProcessVerb.memoryWriteRunning', mutation: true },
  memory_delete: { icon: 'memoryDelete', groupKind: 'memory', category: 'chat.toolDisplay.memory_delete.category', groupTitle: 'chat.toolDisplay.memory_search.groupTitle', groupUnit: 'chat.toolDisplay.memory_delete.groupUnit', completeVerb: 'chat.workProcessVerb.memoryDeleteComplete', runningVerb: 'chat.workProcessVerb.memoryDeleteRunning', mutation: true },
  skills: { icon: 'skillsList', groupKind: 'runtime', category: 'chat.toolDisplay.skills.category', groupTitle: 'chat.workProcessGroupSkills', groupUnit: 'chat.toolDisplay.grep.groupUnit', completeVerb: 'chat.workProcessVerb.skillsComplete', runningVerb: 'chat.workProcessVerb.skillsRunning' },
  skill_read: { icon: 'skillRead', groupKind: 'runtime', category: 'chat.toolDisplay.skill_read.category', groupTitle: 'chat.workProcessGroupSkills', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.skillReadComplete', runningVerb: 'chat.workProcessVerb.skillReadRunning' },
  mcp: { icon: 'plug', groupKind: 'mcp', category: 'chat.workProcessGroupMcp', groupTitle: 'chat.workProcessGroupMcp', groupUnit: 'chat.toolDisplay.mcp.groupUnit', completeVerb: 'chat.workProcessVerb.mcpComplete', runningVerb: 'chat.workProcessVerb.mcpRunning' },
  rdc_context: { icon: 'monitor', groupKind: 'runtime', category: 'chat.toolDisplay.rdc_context.category', groupTitle: 'chat.workProcessGroupRdc', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.rdcContextComplete', runningVerb: 'chat.workProcessVerb.rdcContextRunning' },
  rdc_probe: { icon: 'rdcProbe', groupKind: 'runtime', category: 'chat.toolDisplay.rdc_context.category', groupTitle: 'chat.toolDisplay.rdc_probe.groupTitle', groupUnit: 'chat.toolDisplay.rdc_probe.groupUnit', completeVerb: 'chat.toolDisplay.rdc_probe.completeVerb', runningVerb: 'chat.toolDisplay.rdc_probe.runningVerb' },
  subagent: { icon: 'brain', groupKind: 'collaboration', category: 'chat.workProcessGroupSubagent', groupTitle: 'chat.workProcessGroupSubagent', groupUnit: 'chat.toolDisplay.subagent.groupUnit', completeVerb: 'chat.workProcessVerb.subagentComplete', runningVerb: 'chat.workProcessVerb.subagentRunning' },
  subagent_report: { icon: 'subagentReport', groupKind: 'collaboration', category: 'chat.toolDisplay.subagent_report.category', groupTitle: 'chat.workProcessGroupSubagent', groupUnit: 'chat.toolDisplay.subagent_report.groupUnit', completeVerb: 'chat.toolDisplay.subagent_report.completeVerb', runningVerb: 'chat.toolDisplay.subagent_report.runningVerb' },
  task_create: { icon: 'taskCreate', groupKind: 'task', category: 'chat.toolDisplay.task_create.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.task_create.groupUnit', completeVerb: 'chat.workProcessVerb.taskCreateComplete', runningVerb: 'chat.workProcessVerb.taskCreateRunning', mutation: true },
  task_update: { icon: 'taskUpdate', groupKind: 'task', category: 'chat.toolDisplay.task_update.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.task_update.groupUnit', completeVerb: 'chat.workProcessVerb.taskUpdateComplete', runningVerb: 'chat.workProcessVerb.taskUpdateRunning', mutation: true },
  task_get: { icon: 'taskGet', groupKind: 'task', category: 'chat.toolDisplay.task_get.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.taskGetComplete', runningVerb: 'chat.workProcessVerb.taskGetRunning' },
  task_list: { icon: 'taskList', groupKind: 'task', category: 'chat.toolDisplay.task_list.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.task_list.groupUnit', completeVerb: 'chat.workProcessVerb.taskListComplete', runningVerb: 'chat.workProcessVerb.taskListRunning' },
  task_stop: { icon: 'taskStop', groupKind: 'task', category: 'chat.toolDisplay.task_stop.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.task_stop.groupUnit', completeVerb: 'chat.workProcessVerb.taskStopComplete', runningVerb: 'chat.workProcessVerb.taskStopRunning', mutation: true, errorAccent: true },
  turn_complete: { icon: 'turnComplete', groupKind: 'task', category: 'chat.toolDisplay.turn_complete.category', groupTitle: 'chat.workProcessGroupTask', groupUnit: 'chat.toolDisplay.turn_complete.groupUnit', completeVerb: 'chat.toolOutcomeRecorded', runningVerb: 'chat.toolOutcomeRecording' },
  background_query: { icon: 'backgroundQuery', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.git_status.groupUnit', completeVerb: 'chat.toolDisplay.background_query.completeVerb', runningVerb: 'chat.toolDisplay.background_query.runningVerb' },
  background_wait: { icon: 'backgroundWait', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.background_wait.groupUnit', completeVerb: 'chat.toolDisplay.background_wait.completeVerb', runningVerb: 'chat.toolDisplay.background_wait.runningVerb' },
  background_result: { icon: 'backgroundResult', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.background_result.groupUnit', completeVerb: 'chat.toolDisplay.background_result.completeVerb', runningVerb: 'chat.toolDisplay.background_result.runningVerb' },
  background_message: { icon: 'backgroundMessage', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.background_message.groupUnit', completeVerb: 'chat.toolDisplay.background_message.completeVerb', runningVerb: 'chat.toolDisplay.background_message.runningVerb', mutation: true },
  background_cancel: { icon: 'backgroundCancel', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.background_cancel.groupUnit', completeVerb: 'chat.toolDisplay.background_cancel.completeVerb', runningVerb: 'chat.toolDisplay.background_cancel.runningVerb', mutation: true, errorAccent: true },
  background_join: { icon: 'backgroundJoin', groupKind: 'task', category: 'chat.toolDisplay.background_query.category', groupTitle: 'chat.toolDisplay.background_query.category', groupUnit: 'chat.toolDisplay.background_join.groupUnit', completeVerb: 'chat.toolDisplay.background_join.completeVerb', runningVerb: 'chat.toolDisplay.background_join.runningVerb' },
  knowledge_browse: { icon: 'knowledgeBrowse', groupKind: 'runtime', category: 'chat.toolDisplay.knowledge_browse.category', groupTitle: 'chat.toolDisplay.knowledge_browse.groupTitle', groupUnit: 'chat.toolDisplay.knowledge_browse.groupUnit', completeVerb: 'chat.workProcessVerb.knowledgeBrowseComplete', runningVerb: 'chat.workProcessVerb.knowledgeBrowseRunning' },
  knowledge_search: { icon: 'knowledgeSearch', groupKind: 'runtime', category: 'chat.toolDisplay.knowledge_search.category', groupTitle: 'chat.toolDisplay.knowledge_browse.groupTitle', groupUnit: 'chat.workProcessGroupSearch', completeVerb: 'chat.workProcessVerb.knowledgeSearchComplete', runningVerb: 'chat.workProcessVerb.knowledgeSearchRunning' },
  knowledge_read: { icon: 'knowledgeRead', groupKind: 'runtime', category: 'chat.toolDisplay.knowledge_read.category', groupTitle: 'chat.toolDisplay.knowledge_browse.groupTitle', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.knowledgeReadComplete', runningVerb: 'chat.workProcessVerb.knowledgeReadRunning' },
  knowledge_compile: { icon: 'knowledgeCompile', groupKind: 'runtime', category: 'chat.toolDisplay.knowledge_compile.category', groupTitle: 'chat.toolDisplay.knowledge_browse.groupTitle', groupUnit: 'chat.toolDisplay.knowledge_compile.groupUnit', completeVerb: 'chat.workProcessVerb.knowledgeCompileComplete', runningVerb: 'chat.workProcessVerb.knowledgeCompileRunning' },
  knowledge_candidate_create: { icon: 'knowledgeCandidate', groupKind: 'runtime', category: 'chat.toolDisplay.knowledge_candidate_create.category', groupTitle: 'chat.toolDisplay.knowledge_browse.groupTitle', groupUnit: 'chat.toolDisplay.knowledge_candidate_create.groupUnit', completeVerb: 'chat.workProcessVerb.knowledgeCandidateComplete', runningVerb: 'chat.workProcessVerb.knowledgeCandidateRunning', mutation: true },
  investigation_schema: { icon: 'investigationSchema', groupKind: 'runtime', category: 'chat.toolDisplay.investigation_schema.category', groupTitle: 'chat.toolDisplay.investigation_schema.groupTitle', groupUnit: 'chat.toolDisplay.investigation_schema.groupUnit', completeVerb: 'chat.workProcessVerb.investigationSchemaComplete', runningVerb: 'chat.workProcessVerb.investigationSchemaRunning' },
  investigation_read: { icon: 'investigationRead', groupKind: 'runtime', category: 'chat.toolDisplay.investigation_read.category', groupTitle: 'chat.toolDisplay.investigation_schema.groupTitle', groupUnit: 'chat.toolDisplay.memory_read.groupUnit', completeVerb: 'chat.workProcessVerb.investigationReadComplete', runningVerb: 'chat.workProcessVerb.investigationReadRunning' },
  investigation_write: { icon: 'investigationWrite', groupKind: 'runtime', category: 'chat.toolDisplay.investigation_write.category', groupTitle: 'chat.toolDisplay.investigation_schema.groupTitle', groupUnit: 'chat.toolDisplay.memory_write.groupUnit', completeVerb: 'chat.workProcessVerb.investigationWriteComplete', runningVerb: 'chat.workProcessVerb.investigationWriteRunning', mutation: true },
  investigation_list: { icon: 'investigationList', groupKind: 'runtime', category: 'chat.toolDisplay.investigation_list.category', groupTitle: 'chat.toolDisplay.investigation_schema.groupTitle', groupUnit: 'chat.toolDisplay.task_list.groupUnit', completeVerb: 'chat.workProcessVerb.investigationListComplete', runningVerb: 'chat.workProcessVerb.investigationListRunning' },
};

const GENERIC_TOOL_DISPLAY: WorkProcessToolDisplay = {
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

const FILE_FAMILY_TOOLS = new Set([
  'read_file',
  'artifact_read',
  'write_file',
  'edit_file',
  'delete_file',
  'move_file',
  'copy_file',
  'notebook_edit',
  'read_image',
]);

const SEARCH_FAMILY_TOOLS = new Set(['glob', 'grep']);

const GIT_FAMILY_TOOLS = new Set([
  'git_status',
  'git_diff',
  'git_log',
  'git_add',
  'git_unstage',
  'git_commit',
]);

/** Map a tool name onto the unified Work Process card family. */
export const getToolFamily = (toolName: string): WorkProcessToolFamily => {
  const normalized = normalizeToolName(toolName);
  if (FILE_FAMILY_TOOLS.has(normalized) || normalized === 'read') return 'file';
  if (SEARCH_FAMILY_TOOLS.has(normalized)) return 'search';
  if (normalized === 'shell' || normalized.includes('shell')) return 'shell';
  if (normalized === 'code_interpreter') return 'interpreter';
  if (GIT_FAMILY_TOOLS.has(normalized) || normalized.startsWith('git_')) return 'git';
  if (normalized === 'web_search' || normalized === 'web_fetch') return 'web';
  if (normalized.startsWith('memory_')) return 'memory';
  if (normalized === 'skills' || normalized === 'skill_read') return 'skill';
  if (normalized === 'mcp' || normalized.startsWith('mcp__')) return 'mcp';
  if (
    normalized === 'tool_search'
    || normalized === 'plan_artifact'
    || normalized === 'output_register'
    || normalized === 'rdc_context'
    || normalized === 'rdc_probe'
    || normalized.startsWith('knowledge_')
    || normalized.startsWith('investigation_')
  ) return 'runtime';
  return 'generic';
};
