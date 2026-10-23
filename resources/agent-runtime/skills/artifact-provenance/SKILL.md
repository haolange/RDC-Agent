---
name: artifact-provenance
description: Enforce ready provenance and cite investigation artifacts only by id and hash.
---

# Artifact Provenance

Use this skill when creating, promoting, or citing `rdc.investigation.v1` artifacts.

## Resolve record dependencies before writing

Observation collection and typed-record persistence have different orders. Collect raw tool output first, then persist a schema-valid WorldState for the state actually observed before writing Evidence that binds to its `worldStateId`. This reference must resolve even for draft Evidence. A draft WorldState may preserve unknown or unmeasured fields using the current schema; it must not invent safety, exclusivity, measurements, zero values, or completed future states merely to satisfy required fields. An old WorldState is not a substitute for the current state: keep historical lineage in source references, rather than binding fresh observations to an unrelated historical state to pass validation.

Check the required-reference graph while planning. Persist prerequisite WorldStates and hypothesis Claims before an Experiment that references their logical IDs. A designed Experiment's future-state anchors must be explicit, schema-valid unknown/unmeasured plans, not observed variant/restored results; actual observations require their own correctly timed versions. If the schema cannot represent a needed anchor, resolve that strategy conflict through the normal plan gate before intervention. Never use fabricated forward references or placeholder execution receipts. All design records required by the plan must persist successfully before formal signed baseline/intervention stages.

"Evidence first" means before a derived Claim, not before its required WorldState. A resolvable reference alone does not establish state equivalence or qualify a record as ready.

`ready` is legal only when all three hold:

1. `sourceRefs.length >= 1`, each `{ artifactId, expectedHash }`, and every `artifactId` resolves.
2. Each `expectedHash` matches the source's current sha256; this artifact's `contentHash` equals the sha256 of `contentRef` bytes.
3. `kind` resolves through the closed Kind Registry to `recordType + schema`, and the body passes that schema.

Cite with `session://` or `investigation_read` / `investigation_list`. Changing body bytes without changing hash makes the artifact `stale`. Version updates must mark the old artifact `superseded`.

## Prepare the exact material closure before delegation

A tool-result JSON wrapper and the image bytes referenced inside it are separate artifacts. For visual review, put each required image's exact URI from `Image evidence` and its hash in the Capsule, together with needed wrappers and records. Granting a wrapper never grants its referenced images, paths, or other artifacts. Check every required leaf before dispatch; do not intentionally send a reviewer an unreadable closure and rely on a later Challenge to supply missing access.

Small text reads normally stay inline. When a reviewer needs a small original diff or text window, request `read_file` with `pinEvidence: true`, read its returned durable URI/hash, and explicitly grant that reference. This persists the actual returned window, not unread file content. `totalLines` and the whole-file hash are identities, not proof that every line was delivered: inspect displayed range, truncation and continuation, then cover all required pages. Hash/equality statistics and bounded changed spans do not replace a complete diff. Budget the remaining pages and raw image reads before starting the review; preserve prior consumption and incomplete frontiers on correction.

If a historical native RDC output omits requested arguments after context compaction, the owning root General may read its exact URI/hash with `artifact_read.includeRecordedRequest=true`. The host matches its toolCallId in the owning session journal and returns a separate request-provenance URI/hash. Read and explicitly grant that new reference to an independent reviewer; the original output grant does not include it. Children cannot query the journal. Missing/conflicting requests stay unavailable; do not re-execute a native operation to reconstruct history. Recorded model requests are not resolved native defaults, signed execution receipts, or current replay evidence. New native outputs include main-validated CLI argument metadata and a fingerprint; sensitive argument keys are explicitly omitted.

Do not invent hashes. Do not mark `ready` on unresolved refs, kind mismatch, or schema failure. Do not store investigation records on Tasks, Profiles, or Messages.

For a coverage audit, root General may instead use `includeRecordedOperationIndex=true` on a hash-bound native output anchor (mutually exclusive with the single-request flag). Read the returned independent index URI/hash. It enumerates committed structured shell.rdc requests for that anchor's operation, not all native executions: check coverage gaps, excluded active turn, anchor presence and recorded errors, then independently verify outcome refs. Legacy/unstructured shell, other tools, UI lifecycle calls and uncommitted interrupted segments remain outside coverage. Do not infer an unused experiment allowance from this index or fill unmeasured fields. Reviewers need a new explicit index grant and cannot enumerate the journal themselves.

Index rows also preserve malformed argument shapes and recorded errors. `request` is the original recorded structured request; `argumentsShape` is only a shape label, not parameter/permission validation. Missing args remain missing. A recorded failed request is not a native execution. Same-call-id conflicts or sensitive argument keys reject the index rather than silently omitting rows.
