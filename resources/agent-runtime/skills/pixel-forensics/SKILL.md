---
name: pixel-forensics
description: Diagnose pixel history, overdraw, and color errors from region-scoped visual evidence.
---

# Pixel Forensics

Use this skill when a region of the image, a pixel's history, or overdraw is the question. Live steps belong to General; an analyst works on the granted images and records and returns any missing check in `unresolved`.

## 1. Anchor the region from two sides

Anchor the native texture, subresource, rectangle and event by agreeing image and object evidence.

- **Image side.** Export and inspect the output with `read_image`, enlarging a source-pixel `region` when needed; retain its hash, dimensions and rectangle. Map the candidate rectangle to the native output (event, resource, subresource, dimensions). Read bounded native values at the target and a nearby unaffected control, then inspect pixel history. When the writer is a full-screen composite, the region continues in its input at the same normalized position (scale by the two texture sizes): read there, confirm the feature is present, and repeat on that input until an object-producing draw. A feature absent from every input was created by that pass. If history is unavailable, compare the same native region before and after candidate events.
- **Object side.** Select a draw with passed fragments in the candidate's pixel history when available. Overlay it on its event-bound output, or compare that output before and after; inspect coverage, mesh, textures and shader to identify the object.
- **Agreement.** Anchor when the symptom region maps through intervening composites to a draw covering the described object. Cite history or before/after values and coverage, mesh or bindings; prefix Evidence `cross-validated` when both sides agree, `user-confirmed` on confirmation, or `candidate` while mapping is incomplete (choose the next check).
- **Record.** After anchored Evidence, write an `observed_fact` Claim mapping region to draw, even if expected appearance or First Bad Event is unknown.

If the image or the mapping cannot be obtained, record the exact failed step. If the object or region stays ambiguous after looking, ask the user once.

## 2. Read history and values correctly

- Use actual history event ids and valid pre-mod / shader-out / post-mod fields; missing is unknown, not zero. Find neighbours through action search or history.
- Compare event-before and event-after target/control values in the same native texture and subresource.
- For filtered/reprojected composites, read target/control regions in color inputs and outputs using active viewport extents. Matching localized features support region correspondence; leave exact taps unknown.
- Check backend, format and native field semantics for per-fragment blend. If channel or fragment attribution is unknown, corroborate with event-bound reads, pipeline, shader outputs or a reversible experiment.
- Brightness and regional statistics alone prove neither anomaly nor cause.

## 3. Judge appearance

- Separate qualitative appearance from quantitative reference matching. Different framing or exposure rules out a pixel-error comparison against an external reference; it does not rule out same-capture before / after / control comparison.
- Judge over explicit bounded regions: the affected surface, representative areas where the quality constraint applies, and an unaffected control. State which structure or transitions remain, disappear or cannot be resolved. If the image cannot resolve the distinction, take a bounded native readback while that state is still active and keep its coordinates and sampling conditions.
- Inspect images already available in authorized material, including retrieved Knowledge cards via `knowledge_read`'s `readImageArgs`, before asking for new ones. Historical images are appearance leads with their own provenance, never evidence about the current capture.

## 4. Record

When the anchored region is the earliest divergence, record the Debugger First Bad Event (`$debugger-causal-method`) as an `EvidenceRecord` with `region.kind` in `{event, pixel}` and an `observed_fact` Claim. Evidence comes first; causal Claims need a qualifying Experiment.
