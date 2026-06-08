# Android Remote CLI Smoke Prompt

Use this prompt for Android remote-only smoke through CLI transport. Start from [../README.md](../README.md), then keep [session-model.md](session-model.md), [agent-model.md](agent-model.md), [troubleshooting.md](troubleshooting.md), [doc-governance.md](doc-governance.md), and [../scripts/README.md](../scripts/README.md) aligned.

Core sequence:

```bat
rdx.bat --json doctor
rdx.bat call rd.remote.connect --args-file intermediate\logs\remote_connect_args.json --format json
rdx.bat call rd.remote.ping --args-file intermediate\logs\remote_ping_args.json --format json
rdx.bat call rd.capture.open_file --args-file intermediate\logs\remote_open_file_args.json --format json
rdx.bat call rd.capture.open_replay --args-file intermediate\logs\remote_open_replay_args.json --format json
rdx.bat call rd.session.get_context --format json
```

For Android, the connect args file must include `host`, `port`, and
`options.transport="adb_android"`; include `options.device_serial` when more
than one device may be attached. Keep `options.remote_id` explicit for
`rd.capture.open_replay` so remote replay never falls back to local.

Run `preview_geometry_smoke.py` when the Android remote smoke changes preview behavior.
