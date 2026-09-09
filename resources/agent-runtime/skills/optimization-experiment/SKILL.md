---
name: optimization-experiment
description: Run cost experiments with a real intervention, exclusive World State, and verified rollback.
---

# Optimization Experiment

Use this skill to change cost under an explicit correctness constraint.

1. Name the cost, the constraint that must not regress, and the measurement. Qualify the baseline and the noise floor first.
2. Write Frame Breakdown, then Cost / Limiter / Mechanism as separate Claims. The slowest pass is not automatically the root bottleneck.
3. Choose one action class before mutating: Ablation (`C` / diagnostic), Equivalent (semantics-preserving), or Trade-off (explicit quality/scope concession). Ablation is not a shipping optimization.
4. Write an `ExperimentRecord` with `intervention.type != none`, exclusive World State, and a rollback plan before mutating.
5. Run the intervention through the Settings-configured RDX CLI. Use Replay Benchmark protocol `A-B-A` (or `ABABAB` when the plan requires it). Record metrics and visual before / after / diff.
6. Rollback must set `rollback.executed === true`, `rollback.baselineRestored === true`, and at least one resolvable verify Evidence id. Optimizer `status` `recorded` / `rolled_back` is refused without that rollback (`S-RDC-01`).
7. Causal or counterfactual Claims must cite that Experiment (`S-CAUSAL-01`). A Debugger Counterfactual Artifact is exactly this pair: qualifying Experiment + Claim with `claimKind: causal_conclusion` and/or `declaresCounterfactual: true`. Write Debugger counterfactuals through `$debugger-causal-method` after rollback verify. An Optimizer recommendation stays `optimization_recommendation` and still needs the qualifying Experiment.

`intervention.type == none` is not a counterfactual and cannot close an Optimizer experiment. Do not mutate without Experiment + exclusive World State (`S-RDC-01`). Do not hardcode CLI paths. Visual / numerical regression must be checked before claiming a gain.
