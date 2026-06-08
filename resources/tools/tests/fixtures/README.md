# `tests/fixtures/`

This directory intentionally does not contain `.rdc` captures.

Default tests use mocks, fake controllers, schema checks, and catalog validation. Full smoke must pass an explicit external capture path to the CLI smoke commands:

```bash
bash scripts/smoke_cli.sh --rdc "C:/path/sample.rdc" --context cli-smoke
```

Do not copy developer-local, private, customer, or large `.rdc` files into this repository.
