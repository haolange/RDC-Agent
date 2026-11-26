import { describe, expect, it } from 'vitest';
import { shellTool } from '../tools/primitives/ShellTool';
import { writeFileTool } from '../tools/primitives/WriteFileTool';
import { editFileTool } from '../tools/primitives/EditFileTool';
import { createTaskCreateTool, createTaskStopTool, createTaskUpdateTool } from '../tasks/TaskTools';
import { createOutputRegistrationTool } from '../../reports/OutputRegistrationTool';
import { createInvestigationTools } from '../../investigation/InvestigationTools';
import { RDC_PROBE_TOOL_SPEC } from '../orchestration/RdcProbeTool';
import { RuntimeToolAssembly } from '../orchestration/RuntimeToolAssembly';
import { RUNTIME_CONTEXT_TOOL_SPEC } from '../orchestration/TurnControlTools';
import { createAskUserTool } from '../orchestration/WorkbenchTools';
import { MCP_TOOL_SPEC } from './MCPManager';
import {
  countSubagentDispatches,
  isConcurrencySafeSpec,
  partitionConsecutiveSafeGroups,
  resourceClaimOf,
} from './toolConcurrency';
import type { AgentToolSpec } from './AgentTool';

const spec = (concurrency: AgentToolSpec['concurrency'], extra: Partial<AgentToolSpec> = {}): AgentToolSpec => ({
  concurrency,
  isReadOnly: true,
  isDestructive: false,
  ...extra,
});

describe('toolConcurrency', () => {
  it('treats a missing spec as unsafe and only parallel classes as safe', () => {
    expect(isConcurrencySafeSpec(undefined)).toBe(false);
    expect(isConcurrencySafeSpec(spec('shared'))).toBe(true);
    expect(isConcurrencySafeSpec(spec('orchestration-parallel'))).toBe(true);
    expect(isConcurrencySafeSpec(spec('exclusive'))).toBe(false);
    expect(isConcurrencySafeSpec(spec('orchestration-serial'))).toBe(false);
  });

  it('takes no resource claim for orchestration and the declared claim otherwise', () => {
    expect(resourceClaimOf(spec('shared'))).toBe('shared');
    expect(resourceClaimOf(spec('exclusive'))).toBe('exclusive');
    expect(resourceClaimOf(spec('orchestration-parallel'))).toBe('none');
    expect(resourceClaimOf(spec('orchestration-serial'))).toBe('none');
  });

  it('keeps shell, write, RDC, MCP, ask, plan, output, investigation write and task mutation serial by declaration', () => {
    const investigationWrite = createInvestigationTools('session').find((tool) => tool.name === 'investigation_write');
    const assembly = new RuntimeToolAssembly({} as never);
    const serial: Array<[string, AgentToolSpec | undefined]> = [
      ['shell', shellTool.spec],
      ['write_file', writeFileTool.spec],
      ['edit_file', editFileTool.spec],
      ['task_create', createTaskCreateTool({} as never).spec],
      ['task_update', createTaskUpdateTool({} as never).spec],
      ['task_stop', createTaskStopTool({} as never).spec],
      ['runtime_context', RUNTIME_CONTEXT_TOOL_SPEC],
      ['rdc_probe', RDC_PROBE_TOOL_SPEC],
      ['ask_user', createAskUserTool('general').spec],
      ['plan_artifact', assembly.createPlanArtifactTool('session').spec],
      [
        'output_register',
        createOutputRegistrationTool({ sessionId: 'session', runId: undefined, projectRootPath: undefined }).spec,
      ],
      ['investigation_write', investigationWrite?.spec],
      ['mcp__fs__read', MCP_TOOL_SPEC],
    ];
    for (const [name, declared] of serial) {
      expect(declared, name).toBeDefined();
      expect(isConcurrencySafeSpec(declared), name).toBe(false);
    }
  });

  it('counts only calls whose tool declares a subagent dispatch', () => {
    const dispatch = spec('orchestration-parallel', { dispatchesSubagent: true });
    expect(countSubagentDispatches([dispatch, spec('orchestration-parallel'), undefined])).toBe(1);
  });

  it('splits consecutive safe groups around unsafe calls', () => {
    const groups = partitionConsecutiveSafeGroups([true, true, false, true, false, true, true]);
    expect(groups).toEqual([
      { callIndexes: [0, 1], parallel: true },
      { callIndexes: [2], parallel: false },
      { callIndexes: [3], parallel: true },
      { callIndexes: [4], parallel: false },
      { callIndexes: [5, 6], parallel: true },
    ]);
  });
});
