---
name: artifact-provenance
description: Enforce ready provenance and cite investigation artifacts only by id and hash.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read, shell, task_create, subagent]
---

# Artifact Provenance

Use this skill when creating, promoting, or citing `rdc.investigation.v1` artifacts.

`ready` is legal only when all three hold:

1. `sourceRefs.length >= 1`, each `{ artifactId, expectedHash }`, and every `artifactId` resolves.
2. Each `expectedHash` matches the source's current sha256; this artifact's `contentHash` equals the sha256 of `contentRef` bytes.
3. `kind` resolves through the closed Kind Registry to `recordType + schema`, and the body passes that schema.

Cite with `session://` or `investigation_read` / `investigation_list`. Changing body bytes without changing hash makes the artifact `stale`. Version updates must mark the old artifact `superseded`.

Do not invent hashes. Do not mark `ready` on unresolved refs, kind mismatch, or schema failure. Do not store investigation records on Tasks, Profiles, or Messages.
