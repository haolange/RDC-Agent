import { describe, expect, it } from 'vitest';
import { reconcileHandoffReferences } from './VerifiedHandoffReferences';
import type { ModelHandoffSections } from './StructuredHandoffBuilder';

describe('verified compaction references', () => {
  it('corrects a generated URI/hash mismatch without changing independent hashes or authorizing other references', () => {
    const plan = 'session://plans/approved.md';
    const evidence = 'session://tool-outputs/observation.json';
    const missing = 'session://tool-outputs/not-granted.json';
    const actual = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    const mistaken = 'c'.repeat(64);
    const capture = 'd'.repeat(64);
    const input: ModelHandoffSections = {
      objective: `Inspect capture sha256:${capture}.`,
      constraints: [`Approved plan: \`${plan}\`, SHA-256 \`${mistaken}\`; read only.`],
      progress: { done: [`Evidence ${evidence} sha256:${other}`], inProgress: [], blocked: [] },
      decisions: [`capsule:sha256:${mistaken}`],
      failedAttempts: [`Attempted ${plan} hash ${mistaken} and was rejected.`],
      nextSteps: [`Read ${plan} hash ${mistaken}.`, `Unknown ${missing} hash ${mistaken}.`],
      criticalContext: [],
    };
    const result = reconcileHandoffReferences(input, [
      { uri: plan, hash: actual }, { uri: evidence, hash: `sha256:${other}` },
    ]);
    expect(result.corrected).toBe(3);
    expect(result.sections.constraints[0]).toContain(`authorized source sha256:${actual}`);
    expect(result.sections.constraints[0]).toContain('do not assume it is the same version');
    expect(result.sections.constraints[0]).not.toContain(mistaken);
    expect(result.sections.failedAttempts[0]).toContain('unverified summary hash omitted');
    expect(result.sections.nextSteps[0]).toContain(`authorized source sha256:${actual}`);
    expect(result.sections.nextSteps[1]).toBe(input.nextSteps[1]);
    expect(result.sections.progress.done).toEqual(input.progress.done);
    expect(result.sections.objective).toContain(capture);
    expect(result.sections.decisions).toEqual(input.decisions);
    expect(input.constraints[0]).toContain(mistaken);
  });

  it('does not choose between conflicting authority entries or repair malformed and unbound hashes', () => {
    const uri = 'session://plans/ambiguous.md';
    const original = `Read ${uri} hash ${'e'.repeat(64)} and compare ${'f'.repeat(65)}.`;
    const sections: ModelHandoffSections = {
      objective: original, constraints: [], progress: { done: [], inProgress: [], blocked: [] },
      decisions: [], failedAttempts: [], nextSteps: [], criticalContext: [],
    };
    const result = reconcileHandoffReferences(sections, [
      { uri, hash: 'a'.repeat(64) }, { uri, hash: 'b'.repeat(64) },
    ]);
    expect(result.corrected).toBe(0);
    expect(result.sections.objective).toBe(original);
    const malformed = `Read ${uri} hash ${'e'.repeat(65)}.`;
    const singleAuthority = reconcileHandoffReferences({ ...sections, objective: malformed }, [{ uri, hash: 'a'.repeat(64) }]);
    expect(singleAuthority.corrected).toBe(0);
    expect(singleAuthority.sections.objective).toBe(malformed);
  });
});
