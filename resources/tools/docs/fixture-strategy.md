# External capture smoke strategy

`rdx-tools` does not bundle `.rdc` captures in the repository or release package.

Use test layers this way:

- `unit` and `contract` tests use fake controllers, mock payloads, schema checks, and catalog validation.
- Full local smoke passes an explicit external desktop capture to `bash scripts/smoke_cli.sh --rdc <path>`.
- Android remote smoke uses CLI transport and an explicit external capture path for `rd.capture.open_file` / `rd.capture.open_replay`.
- `gpu_live` checks depend on a real RenderDoc/GPU/remote environment and are not default clean-checkout gates.

Rules for external captures:

- Do not copy local, private, customer, or large captures into `tests/fixtures/`.
- Do not write developer-machine absolute paths into source, docs, tests, or release metadata.
- Record the capture path, size, SHA256, command sequence, and result in `intermediate/logs/tool_smoke_findings.md` when running local or remote smoke.
- If a capture exposes a product bug or environment blocker, keep the evidence log and open a focused follow-up task instead of weakening the release gate.

Release behavior:

- `bash scripts/smoke_cli.sh` without `--rdc` runs entry smoke only.
- `bash scripts/smoke_cli.sh --rdc <path>` runs the daemon-backed capture chain.
- `python scripts/release_gate.py --require-smoke-reports` checks only that `intermediate/logs/smoke_cli.log` contains `[smoke] PASS`.
- Release packages verify CLI contract after extraction and do not search for package-bundled `.rdc` captures.
