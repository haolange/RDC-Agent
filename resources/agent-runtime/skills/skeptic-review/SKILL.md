---
name: skeptic-review
description: Challenge Claims from Evidence, Experiments, negatives, and unknowns. Do not rewrite the Generator narrative.
allowed-tools: [investigation_read, investigation_write, investigation_list, knowledge_search, knowledge_read]
---

# Skeptic Review

Use this skill in an independent context after a Generator has written Claims.

Input: Claim, Evidence, Experiment, Negative, Alternative, Scope, Unknown.

Output: `ChallengeRecord` entries. Do not rewrite the Generator's long narrative.

1. Read the cited Claims, Evidence, and Experiments. Prefer negatives and contradictions from Knowledge.
2. Ask whether each Claim is supported, scoped, and (if causal) backed by a qualifying Experiment.
3. Write Challenges that name the gap, the conflicting evidence, or the illegal upgrade.
4. Leave accepted Claims untouched. Request more evidence instead of inventing a new story.

Do not raise or lower Claim rank here. Do not persist Knowledge. Do not treat this skill as report writing. Confirmation bias is a defect: keep alternatives and unknowns visible.
