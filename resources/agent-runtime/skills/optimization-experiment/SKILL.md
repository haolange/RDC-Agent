---
name: optimization-experiment
description: Run cost experiments with a real intervention, exclusive World State, and verified rollback.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read, rdx_context, shell]
---

# Optimization Experiment

Use this skill to change cost under an explicit correctness constraint.

1. Name the cost, the constraint that must not regress, and the measurement.
2. Write an `ExperimentRecord` with `intervention.type != none`, exclusive World State, and a rollback plan before mutating.
3. Run the intervention through the Settings-configured RDX CLI. Record results and verify evidence.
4. Rollback must set `rollback.executed === true`, `rollback.baselineRestored === true`, and at least one resolvable verify Evidence id.
5. Causal or counterfactual Claims must cite that Experiment (`S-CAUSAL-01`). Status must be `recorded` or `rolled_back`.

`intervention.type == none` is not a counterfactual. Ablation is not a shipping optimization. Do not mutate without Experiment + exclusive World State (`S-RDC-01`). Do not hardcode CLI paths.
