#!/usr/bin/env python3
"""Remote-only full contract smoke entry for catalog-defined rd.* tools."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parents[1]


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Remote-only Android contract smoke for all catalog-defined rd.* tools")
    parser.add_argument("--rdc", required=True, help="Replay sample used for both capture open_file and remote open_replay")
    parser.add_argument("--transport", choices=["mcp", "daemon", "both"], default="both")
    parser.add_argument("--daemon-context-prefix", default="rdx-remote-smoke")
    parser.add_argument("--artifact-dir", default="", help="Optional artifact root for this smoke run")
    parser.add_argument("--out-json", default="intermediate/logs/tool_contract_remote_smoke.json")
    parser.add_argument("--out-md", default="intermediate/logs/tool_contract_remote_smoke.md")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    cmd = [
        sys.executable,
        str(SCRIPT_ROOT / "scripts" / "tool_contract_check.py"),
        "--local-rdc",
        str(args.rdc),
        "--remote-rdc",
        str(args.rdc),
        "--transport",
        str(args.transport),
        "--daemon-context-prefix",
        str(args.daemon_context_prefix),
        "--remote-only",
        "--out-json",
        str(args.out_json),
        "--out-md",
        str(args.out_md),
    ]
    if str(args.artifact_dir or "").strip():
        cmd.extend(["--artifact-dir", str(args.artifact_dir)])
    proc = subprocess.run(cmd, cwd=str(SCRIPT_ROOT), check=False)
    return int(proc.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
