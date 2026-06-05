import {
  specialistRecipeRunner,
  type SpecialistRecipeResult,
  type SpecialistRunContext,
} from './SpecialistRecipeRunner';
import type { AgentRole } from '@shared/types/agent';

type SurfacePreparationResult = Awaited<ReturnType<typeof specialistRecipeRunner.prepareSurface>>;

export class DeterministicSpecialistExecutor {
  prepareSurface(context: SpecialistRunContext): Promise<SurfacePreparationResult> {
    return specialistRecipeRunner.prepareSurface(context);
  }

  run(
    specialist: AgentRole,
    context: SpecialistRunContext,
    surface: SurfacePreparationResult,
  ): Promise<SpecialistRecipeResult> {
    return specialistRecipeRunner.run(specialist, context, surface);
  }
}

export const deterministicSpecialistExecutor = new DeterministicSpecialistExecutor();
export type { SpecialistRecipeResult };
