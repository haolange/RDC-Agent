import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { compileRdxProbe, type RdxProbeInput } from '@shared/constants/rdxProbe';
import { RdxCliInvokerService } from './RdxCliInvokerService';
import { ShellInvocationService } from './ShellInvocationService';
import { DEFAULT_RDX_CLI_INVOKER } from '../settings/settingsDefaults';

const root = process.env.RDX_NATIVE_TOOLS_ROOT;
const python = process.env.RDX_NATIVE_PYTHON;
describe.skipIf(!root || !python)('external native parser contract (explicit installation)', () => {
  it('parses production invoker argv for every supported probe; rejects fictional verbs', async () => {
    const calls: string[][] = [];
    class ParserCapture extends ShellInvocationService {
      override async invoke(request: Parameters<ShellInvocationService['invoke']>[0]) {
        calls.push(request.args ?? []);
        return { exitCode: 0, stdout: '{}', stderr: '', duration_ms: 0 };
      }
    }
    const invoker = new RdxCliInvokerService(new ParserCapture());
    const inputs: RdxProbeInput[] = [
      { action: 'version' }, { action: 'doctor' }, { action: 'enumerate' }, { action: 'preview_status' },
      { action: 'lease_open' }, { action: 'lease_close' },
      ...['context_status', 'event_list', 'event_show', 'pipeline_show', 'resource_list', 'vfs_ls', 'vfs_cat'].map((action) => ({
        action: 'probe' as const, args: { action: action as NonNullable<RdxProbeInput['args']>['action'],
          ...(action === 'event_show' || action === 'pipeline_show' ? { eventId: '1' } : {}),
          ...(action.startsWith('vfs_') ? { path: '/draws/1' } : {}) },
      })),
    ];
    for (const input of inputs) {
      const command = compileRdxProbe(input);
      await invoker.executeCLI(command.command, [...command.args, ...(command.needsContext ? ['--daemon-context', 'qa-parser-context'] : [])],
        { settings: { ...DEFAULT_RDX_CLI_INVOKER, enabled: true, command: python!, argsPrefix: ['--json'] } });
    }
    const code = [
      'import sys,json,contextlib,io',
      'sys.path.insert(0,sys.argv[1])',
      'from rdx.cli import _build_parser',
      'parser=_build_parser()',
      'for argv in json.loads(sys.argv[2]):',
      ' parsed=parser.parse_args(argv)',
      ' assert parsed.json is True, argv',
      'for argv in [["lease-open"],["lease-close"],["preview-status"],["probe"],["doctor","--session-id","app-id"]]:',
      ' try:',
      '  with contextlib.redirect_stderr(io.StringIO()): parser.parse_args(argv)',
      ' except SystemExit as e:',
      '  assert e.code != 0',
      ' else: raise AssertionError("invalid command accepted: " + str(argv))',
      'print("native parser cases passed")',
    ].join('\n');
    const result = spawnSync(python!, ['-c', code, path.resolve(root!), JSON.stringify(calls)], { encoding: 'utf8', windowsHide: true });
    expect(result.stderr).toBe('');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(calls).toHaveLength(inputs.length);
  });
});
