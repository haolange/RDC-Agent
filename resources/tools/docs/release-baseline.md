# Release Baseline

Before release, run:

```bat
python spec/validate_catalog.py
python -m pytest tests -q
python scripts/check_markdown_health.py
python scripts/release_gate.py --require-smoke-reports
```

Run smoke directly through bash before the release gate when smoke evidence is required:

```bash
bash scripts/smoke_cli.sh --rdc "C:/path/sample.rdc" --context release-smoke
```

Agent platforms should see each CLI command and result in the bash output. The smoke entry writes `intermediate/logs/smoke_cli.log`; `release_gate.py --require-smoke-reports` checks that log for `[smoke] PASS` and no longer depends on Python smoke report JSON files.
