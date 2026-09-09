---
name: pixel-forensics
description: Diagnose pixel history, overdraw, and color errors from region-scoped visual evidence.
---

# Pixel Forensics

Use this skill when the wrong pixel, history, or overdraw is the question.

1. Name the expected color or event and the observed pixel region.
2. Collect before / after / diff artifacts plus the region. A prose summary is not enough.
3. Walk pixel history or attachments only through configured RDX actions and `read_image`.
4. When this region is the earliest divergence, write it as the Debugger First Bad Event (`$debugger-causal-method`): `EvidenceRecord` with `region.kind` in `{event, pixel}` and an optional `observed_fact` companion Claim. Do not call that Claim causal.
5. Write Evidence first. Causal claims wait for a qualifying Experiment.

Do not blame the driver without distinguishing evidence. Do not treat a thumbnail caption as a measurement. Do not raise visual narrative to a new epistemic rank.
