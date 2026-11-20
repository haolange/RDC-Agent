import type { CompiledPolicy } from '@shared/types/rdcRuntime';
import { compilePolicySources } from '../agent-runtime/permissions/PolicyCompiler';

/** Compiles one policy document through the production policy pipeline. */
export function compileFixturePolicy(policy: unknown): CompiledPolicy {
  return compilePolicySources([{ raw: policy, sourcePath: 'fixture.policy.yml' }]);
}
