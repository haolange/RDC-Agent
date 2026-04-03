from __future__ import annotations

import argparse
import asyncio

from rdx import cli as rdx_cli


def test_build_parser_accepts_vfs_tree_command() -> None:
    parser = rdx_cli._build_parser()
    args = parser.parse_args(["vfs", "tree", "--path", "/draws", "--depth", "3"])

    assert args.command == "vfs"
    assert args.vfs_cmd == "tree"
    assert args.path == "/draws"
    assert args.depth == 3


def test_vfs_command_routes_to_direct_exec(monkeypatch) -> None:
    captured: list[dict] = []

    def _fake_daemon_exec(operation: str, args: dict[str, object], *, remote: bool = False, context: str = "default"):  # type: ignore[no-untyped-def]
        assert operation == "rd.vfs.resolve"
        assert args == {"path": "/pipeline", "session_id": "sess_demo"}
        assert context == "default"
        return {"ok": True, "data": {"node": {"path": "/pipeline"}}, "projections": {}, "meta": {}}

    monkeypatch.setattr(rdx_cli, "_daemon_exec", _fake_daemon_exec)
    monkeypatch.setattr(rdx_cli, "_print_json", lambda payload: captured.append(payload))

    args = argparse.Namespace(
        command="vfs",
        vfs_cmd="resolve",
        path="/pipeline",
        session_id="sess_demo",
        format="json",
        daemon_context="default",
    )
    exit_code = asyncio.run(rdx_cli._main_async(args))

    assert exit_code == rdx_cli.EXIT_OK
    assert captured[0]["ok"] is True
    assert captured[0]["data"]["node"]["path"] == "/pipeline"


def test_vfs_command_routes_to_daemon_exec(monkeypatch) -> None:
    captured: list[dict] = []

    def _fake_daemon_exec(operation: str, args: dict[str, object], *, remote: bool = False, context: str = "default"):  # type: ignore[no-untyped-def]
        assert operation == "rd.vfs.tree"
        assert args == {"path": "/draws", "depth": 2}
        assert context == "ctx-vfs"
        return {"ok": True, "data": {"tree": {"path": "/draws"}}}

    monkeypatch.setattr(rdx_cli, "_daemon_exec", _fake_daemon_exec)
    monkeypatch.setattr(rdx_cli, "_print_json", lambda payload: captured.append(payload))

    args = argparse.Namespace(
        command="vfs",
        vfs_cmd="tree",
        path="/draws",
        session_id=None,
        depth=2,
        format="json",
        daemon_context="ctx-vfs",
    )
    exit_code = asyncio.run(rdx_cli._main_async(args))

    assert exit_code == rdx_cli.EXIT_OK
    assert captured[0]["ok"] is True
    assert captured[0]["data"]["tree"]["path"] == "/draws"


def test_vfs_ls_tsv_renders_daemon_projection(monkeypatch, capsys) -> None:
    def _fake_daemon_exec(operation: str, args: dict[str, object], *, remote: bool = False, context: str = "default"):  # type: ignore[no-untyped-def]
        assert operation == "rd.vfs.ls"
        assert args["projection"] == {"kind": "tabular", "include_tsv_text": True}
        return {
            "ok": True,
            "data": {"path": "/", "entries": []},
            "artifacts": [],
            "error": None,
            "meta": {},
            "projections": {
                "tabular": {
                    "format_version": "1.0.0",
                    "columns": ["format_version", "name", "path"],
                    "rows": [["1.0.0", "context", "/context"]],
                    "row_count": 1,
                    "tsv_text": "format_version\tname\tpath\n1.0.0\tcontext\t/context",
                }
            },
        }

    monkeypatch.setattr(rdx_cli, "_daemon_exec", _fake_daemon_exec)

    args = argparse.Namespace(
        command="vfs",
        vfs_cmd="ls",
        path="/",
        session_id=None,
        format="tsv",
        daemon_context="ctx-vfs",
    )

    exit_code = asyncio.run(rdx_cli._main_async(args))

    assert exit_code == rdx_cli.EXIT_OK
    assert "format_version\tname\tpath" in capsys.readouterr().out
