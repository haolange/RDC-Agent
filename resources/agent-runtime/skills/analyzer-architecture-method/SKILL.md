---
name: analyzer-architecture-method
description: Write Analyzer Architecture Model versions on existing rdc.investigation.v1 kinds without crossing Observed / Reconstructed / Authoring layers.
---

# Analyzer Architecture Method

Use this skill during Analyzer execution. Do not invent a new kind, Profile, or TaskStore. Write only `rdc.investigation.v1` Session Artifacts.

## Three layers

`claimKind` must stay on its explanation layer. Crossing fails at write time (`ANALYZER-LAYER`).

| Layer | Content | Allowed `claimKind` | Epistemic / verification |
| --- | --- | --- | --- |
| Observed | Capture draws / dispatches / copies / barriers / presents | `observed_fact` | `observed` / `observed` |
| Reconstructed | Event / Resource / Pass structure derived from the capture | `derived_structure` | `derived` / `reconstructed` |
| Authoring | Engine / Material / RenderGraph hypothesis | `semantic_inference` or `hypothesis` | `inferred` or `unknown`; never `observed` |

Do not write engine semantics as `observed_fact`. Do not write an inferred label as `derived_structure`. Do not upgrade Authoring to Observed.

## Incremental Architecture Model

Shape: one `ClaimSet` (`kind: claim_set`) titled Architecture Model.

1. Collect Observed facts with `$capture-facts`, versions with `$resource-versioning`, pass topology with `$pass-graph-analysis`, shader fingerprints / blocks with `$shader-ir-analysis`, and traces with `$cross-capture-alignment`.
2. Write the model as a `claim_set` whose items stay on their layers. Include at least one Observed fact, one Reconstructed structure, and an explicit Unknown Frontier (`limitation` or Authoring hypothesis marked unknown).
3. Version by `supersedes` on the previous Architecture Model artifact. Do not silent-overwrite. The new version is a comparison Artifact: name what changed, what stayed, and what remains unknown.
4. Mark `ready` only with provenance (`$artifact-provenance`).

## Bounds

Do not persist Knowledge. Do not call `memory_write`. Do not write these fields into Tasks, Profiles, or Messages. RDX runs only through the Settings-configured CLI.
