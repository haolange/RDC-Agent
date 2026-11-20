import { compilePolicySources } from '../agent-runtime/permissions/PolicyCompiler';
import type { CompiledPolicy } from '@shared/types/rdcRuntime';

/** Compiles one policy document through the production policy pipeline. */
export function compileFixturePolicy(policy: unknown): CompiledPolicy {
  return compilePolicySources([{ raw: policy, sourcePath: 'fixture.policy.yml' }]);
}
