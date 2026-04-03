"""Runtime-agnostic tool catalog helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from rdx.runtime_paths import tools_root


def tool_catalog_path() -> Path:
    return tools_root() / "spec" / "tool_catalog.json"


def load_tool_catalog() -> List[Dict[str, Any]]:
    path = tool_catalog_path()
    data = json.loads(path.read_text(encoding="utf-8"))
    tools = list(data.get("tools", []))
    declared_count = int(data.get("tool_count") or len(tools))
    if len(tools) != declared_count:
        raise RuntimeError(f"Catalog tool_count mismatch: declared {declared_count}, got {len(tools)} entries")
    names = [str(t.get("name", "")).strip() for t in tools]
    if len(set(names)) != len(names):
        raise RuntimeError("Catalog contains duplicate tool names")
    if any(not name.startswith("rd.") for name in names):
        raise RuntimeError("Catalog contains invalid tool name prefixes")
    return tools
