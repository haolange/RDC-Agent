from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from rdx import runtime_materializer
from rdx.daemon import worker as daemon_worker


ROOT = Path(__file__).resolve().parents[1]


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def _prepare_runtime_source(tmp_path: Path) -> Path:
    bin_root = tmp_path / "source" / "binaries" / "windows" / "x64"
    pymod_root = bin_root / "pymodules"
    pymod_root.mkdir(parents=True, exist_ok=True)
    files = {
        "renderdoc.dll": b"fake-runtime-dll",
        "renderdoc.json": b"{}",
        "pymodules/renderdoc.pyd": b"fake-runtime-pyd",
    }
    entries = []
    for rel, content in files.items():
        path = bin_root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        entries.append(
            {
                "path": rel.replace("\\", "/"),
                "size": len(content),
                "sha256": _sha256(path),
            }
        )
    (bin_root / "manifest.runtime.json").write_text(
        json.dumps({"file_count": len(entries), "files": entries}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return bin_root


def test_worker_uses_materialized_cache_and_does_not_lock_source_binaries(tmp_path: Path, monkeypatch) -> None:
    source_root = _prepare_runtime_source(tmp_path)
    cache_root = tmp_path / "cache"
    monkeypatch.setenv("RDX_TOOLS_ROOT", str(ROOT))
    monkeypatch.setattr(runtime_materializer, "binaries_root", lambda: source_root)
    monkeypatch.setattr(runtime_materializer, "pymodules_dir", lambda: source_root / "pymodules")
    monkeypatch.setattr(runtime_materializer, "worker_cache_dir", lambda: cache_root)
    materialized = runtime_materializer.materialize_runtime()
    monkeypatch.setattr(daemon_worker, "materialize_runtime", lambda: materialized)

    worker = daemon_worker.RuntimeWorkerProcess(context_id="pytest-worker")
    try:
        status = worker.request("status", {})
        assert status["ok"] is True

        response = worker.request(
            "exec",
            {
                "operation": "rd.session.get_context",
                "args": {},
                "transport": "test",
                "remote": False,
                "context_id": "pytest-worker",
            },
        )
        payload = response["result"]
        assert payload["ok"] is True

        renamed = source_root.with_name("x64_moved")
        os.replace(source_root, renamed)
        assert renamed.is_dir()
        assert materialized.cache_root.is_dir()
    finally:
        worker.stop()
