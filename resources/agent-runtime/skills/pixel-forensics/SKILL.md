---
name: pixel-forensics
description: Diagnose pixel history, overdraw, and color errors from region-scoped visual evidence.
---

# Pixel Forensics

Use this skill when a region of the image, a pixel's history, or overdraw is the question.

## 1. Anchor the region from two sides

A region is anchored when you can name the native texture, subresource, pixel rectangle and event, and say why it is the thing the user means. Work from both sides and let them confirm each other.

- **Image side.** Export the current output and inspect it with `read_image`; use a source-pixel `region` to enlarge areas that are too small to judge, and keep the returned source hash, dimensions and rectangle. Pick a candidate rectangle from the reported visual feature. A display screenshot can differ in size from the native texture, so map the candidate onto the native output (event, resource, subresource, dimensions) before reading values. Read a bounded rectangle of native values, the target point and a nearby unaffected control point, then take the pixel history to learn which events wrote there.
- **Object side.** For the events that wrote the candidate rectangle, look at what each draw actually paints: a draw-call overlay or the output difference across that event, the mesh it submits, and the textures and shader it binds. This tells you which object the pixels belong to.
- **Agreement.** The anchor is established when the image-side rectangle lies inside what an object-side draw covers and that draw's content matches the object the user described. With only one side, keep it a candidate and choose the next check that could confirm or refute it. A region the user points out or confirms is established by that confirmation; still map it to the native texture.

Missing coordinates are not a reason to stop. If the image or the mapping cannot be obtained, record the exact failed step. If the object or region stays ambiguous after looking, ask the user once.

## 2. Read history and values correctly

- Use the history's actual event ids and its valid pre-mod / shader-out / post-mod fields. A missing value is unknown, not zero. Find neighbouring events through action search or the history itself, not by guessing adjacent integers.
- Compare event-before and event-after values at the target and at the control point in the same native texture and subresource.
- Check the backend, output format and what the native fields mean before building a per-fragment blend account. Some backends zero shader-out channels beyond the target's component count, keep an event-final post-mod value on the last fragment, or reconstruct depth-test flags. When a channel or a fragment's attribution cannot be established on the active build, keep it unknown and corroborate with event-bound texture reads, pipeline state, shader outputs or a reversible experiment.
- Regional statistics and brightness describe the image; alone they establish neither an anomaly nor a cause.

## 3. Judge appearance

- Separate qualitative appearance from quantitative reference matching. Different framing or exposure rules out a pixel-error comparison against an external reference; it does not rule out same-capture before / after / control comparison.
- Judge over explicit bounded regions: the affected surface, representative areas where the quality constraint applies, and an unaffected control. State which structure or transitions remain, disappear or cannot be resolved. If the image cannot resolve the distinction, take a bounded native readback while that state is still active and keep its coordinates and sampling conditions.
- Inspect images already available in authorized material, including retrieved Knowledge cards via `knowledge_read`'s `readImageArgs`, before asking for new ones. Historical images are appearance leads with their own provenance, never evidence about the current capture.

## 4. Record

When the anchored region is the earliest divergence, write it as the Debugger First Bad Event (`$debugger-causal-method`): an `EvidenceRecord` with `region.kind` in `{event, pixel}` and an optional `observed_fact` Claim. Evidence comes first; causal claims wait for a qualifying Experiment.
