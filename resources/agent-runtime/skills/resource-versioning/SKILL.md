---
name: resource-versioning
description: Trace resource producers, consumers, and versions across the current World State.
---

# Resource Versioning

Use this skill to follow a resource across creates, writes, and binds.

1. Identify the resource and the World State that owns the current version.
2. Record producer and consumer events with artifact refs and hashes.
3. After any mutate, mark prior Evidence `stale` unless an Experiment restored the baseline (`S-RDC-01`).
4. Prefer versioned `superseded` artifacts over silent overwrite.
5. For Analyzer, producer / consumer topology is Reconstructed: write `derived_structure` with `epistemic: derived` and `verification: reconstructed`. Do not label a bind as Engine semantics. These records feed `$analyzer-architecture-method`.

Do not mix versions from different World States. Do not treat a later bind as proof the earlier content is unchanged. Do not write resource identity into Task or Message fields.

When a claim requires a direct value dependency between a producer and consumer, inspect the actual usage history for that resource over the intervening event interval, including the relevant subresource or region when observable. Follow pagination and truncation; consider writes, clears, copies, discards and aliasing where the available records expose them. A later write can change the version without proving that every pixel was overwritten. If the interval, subresource, or write status is incomplete or binding-only, retain the competing explanations and qualify the edge. Resource identity, endpoint bindings and event order alone do not establish an uninterrupted value dependency. Preserve the relevant history, including contrary observations, for independent review.

In `rd.resource.get_usage`, each usage classification concerns the requested resource; the row's color/depth attachments describe that event's outputs and may be different resources. A recorded shader-resource read remains a recorded read when the output attachment differs, but it does not by itself prove a particular pixel's value or an uninterrupted producer-to-consumer dependency.
