---
name: pixel-forensics
description: Diagnose pixel history, overdraw, and color errors from region-scoped visual evidence.
---

# Pixel Forensics

Use this skill when the wrong pixel, history, or overdraw is the question.

1. Name the expected color or event and the observed pixel region. If the user did not provide coordinates, first inspect an available capture export or event output with `read_image` and choose a provisional region from the reported visual feature. Label that choice as a candidate, record its image/source identity, and verify it against the native output texture and event before calling it observed. Missing user coordinates alone are not a stopping condition; if the image or mapping cannot be obtained, record the exact failed step and keep the region unknown.
2. Collect before / after / diff artifacts plus the region. A display screenshot may have different dimensions from the native texture: map the candidate only after checking the event, output resource, subresource and dimensions, then use native pixel/region/history reads to test it. A prose summary or an unverified screenshot coordinate is not enough.
3. Walk pixel history or attachments only through configured RDC actions and `read_image`.
   For a candidate pixel, first inspect the history's actual event ids and valid pre-mod / shader-out / post-mod fields; a missing pre-mod value is unknown, not zero. Use a valid neighboring event and a nearby unaffected control from the same capture to compare event-before / event-after color and surviving fragments. Discover event ids from the action search or history rather than guessing adjacent integers. If the external reference has different framing or exposure, keep that comparison unresolved but continue these within-capture read-only checks before concluding that no discriminating test is possible.
4. When this region is the earliest divergence, write it as the Debugger First Bad Event (`$debugger-causal-method`): `EvidenceRecord` with `region.kind` in `{event, pixel}` and an optional `observed_fact` companion Claim. Do not call that Claim causal.
5. Write Evidence first. Causal claims wait for a qualifying Experiment.

Do not blame the driver without distinguishing evidence. Do not treat a thumbnail caption as a measurement. Do not raise visual narrative to a new epistemic rank.
