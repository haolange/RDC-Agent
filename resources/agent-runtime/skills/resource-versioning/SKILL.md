---
name: resource-versioning
description: Trace resource producers, consumers, and versions across the current World State.
allowed-tools: [investigation_read, investigation_write, investigation_list, artifact_read, rdx_context]
---

# Resource Versioning

Use this skill to follow a resource across creates, writes, and binds.

1. Identify the resource and the World State that owns the current version.
2. Record producer and consumer events with artifact refs and hashes.
3. After any mutate, mark prior Evidence `stale` unless an Experiment restored the baseline (`S-RDC-01`).
4. Prefer versioned `superseded` artifacts over silent overwrite.

Do not mix versions from different World States. Do not treat a later bind as proof the earlier content is unchanged. Do not write resource identity into Task or Message fields.
