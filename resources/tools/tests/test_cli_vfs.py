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


def test_build_parser_accepts_cli_first_doctor_and_tools() -> None:
    parser = rdx_cli._build_parser()

    doctor = parser.parse_args(["--json", "doctor"])
    tools_list = parser.parse_args(["tools", "list", "--json", "--limit", "3"])
    tools_search = parser.parse_args(["tools", "search", "pipeline", "--json"])

    assert doctor.command == "doctor"
    assert doctor.json is True
    assert tools_list.command == "tools"
    assert tools_list.tools_cmd == "list"
    assert tools_list.limit == 3
    assert tools_search.command == "tools"
    assert tools_search.tools_cmd == "search"
    assert tools_search.query == "pipeline"


def test_doctor_reports_cli_only_contract(monkeypatch) -> None:
    captured: list[dict] = []

    monkeypatch.setattr(rdx_cli, "_print_json", lambda payload: captured.append(payload))
    monkeypatch.setattr(rdx_cli, "_daemon_status_payload", lambda context: {"ok": True, "data": {"running": False, "context_id": context}})
    monkeypatch.setattr(rdx_cli, "missing_dependencies", lambda: [])
    monkeypatch.setattr(
        rdx_cli,
        "validate_bundled_python_layout",
        lambda: (True, [], {"bundled_python": {"python_version": "test", "python_entry": "python.exe"}}),
    )

    args = argparse.Namespace(command="doctor", daemon_context="ctx-doctor", json=True)
    exit_code = asyncio.run(rdx_cli._main_async(args))

    assert exit_code == rdx_cli.EXIT_OK
    assert captured[0]["ok"] is True
    details = captured[0]["data"]
    assert details["context_id"] == "ctx-doctor"
    assert details["mcp"]["supported"] is False
    assert details["launchers"]["python_cli_exists"] is True


def test_tools_list_and_search_emit_catalog_summaries(monkeypatch) -> None:
    captured: list[dict] = []
    fake_catalog = [
        {
            "name": "rd.pipeline.get_state",
            "namespace": "pipeline",
            "group": "Pipeline",
            "description": "Get pipeline state",
            "param_names": ["session_id"],
        },
        {
            "name": "rd.capture.status",
            "namespace": "capture",
            "group": "Capture",
            "description": "Get capture status",
            "param_names": [],
        },
    ]

    monkeypatch.setattr(rdx_cli, "_print_json", lambda payload: captured.append(payload))
    monkeypatch.setattr(rdx_cli, "load_tool_catalog", lambda: fake_catalog)

    list_code = asyncio.run(
        rdx_cli._main_async(argparse.Namespace(command="tools", tools_cmd="list", namespace="", limit=0, daemon_context="default")),
    )
    search_code = asyncio.run(
        rdx_cli._main_async(argparse.Namespace(command="tools", tools_cmd="search", query="pipeline", limit=20, daemon_context="default")),
    )

    assert list_code == rdx_cli.EXIT_OK
    assert search_code == rdx_cli.EXIT_OK
    assert captured[0]["result_kind"] == "rdx.tools.list"
    assert captured[0]["data"]["tool_count"] == 2
    assert captured[1]["result_kind"] == "rdx.tools.search"
    assert captured[1]["data"]["tool_count"] == 1
    assert captured[1]["data"]["tools"][0]["name"] == "rd.pipeline.get_state"


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
