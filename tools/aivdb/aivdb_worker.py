#!/usr/bin/env python3
import json
import os
import sys
import traceback
import glob
from pathlib import Path


DEFAULT_EXTS = (
    ".md",
    ".txt",
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".json",
    ".yaml",
    ".yml",
    ".html",
    ".css",
)

SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".ssh",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
}

SKIP_FILES = {
    ".env",
    "piweb.config.json",
    "memory.json",
    "authorized_keys",
    "id_rsa",
    "id_ed25519",
}


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def read_request() -> dict:
    raw = sys.stdin.buffer.read()
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8-sig"))


def load_aivdb(aivdb_root: Path):
    if not (aivdb_root / "aivdb.py").exists():
        raise FileNotFoundError(f"AIVDB root missing aivdb.py: {aivdb_root}")
    sys.path.insert(0, str(aivdb_root))
    from aivdb import AIVDB  # type: ignore

    return AIVDB


def hit_to_dict(hit) -> dict:
    return {
        "chunkId": int(hit.chunk_id),
        "score": float(hit.score),
        "path": str(hit.path or ""),
        "text": str(hit.text or ""),
    }


def is_sensitive(path: Path) -> bool:
    parts = {p.lower() for p in path.parts}
    if parts.intersection(SKIP_DIRS):
        return True
    name = path.name.lower()
    if name in SKIP_FILES or name.startswith(".env."):
        return True
    return False


def collect_files(root: Path, exts: tuple[str, ...], recursive: bool, max_files: int | None) -> list[Path]:
    iterator = root.rglob("*") if recursive else root.glob("*")
    allowed = {e.lower() if e.startswith(".") else f".{e.lower()}" for e in exts}
    files: list[Path] = []
    for path in iterator:
        if is_sensitive(path):
            continue
        if not path.is_file():
            continue
        if path.suffix.lower() not in allowed:
            continue
        files.append(path)
        if max_files is not None and len(files) >= max_files:
            break
    return files


def split_scope(scope: object) -> list[str]:
    if isinstance(scope, list):
        raw = []
        for item in scope:
            raw.extend(str(item).replace("\r", "\n").replace(";", "\n").split("\n"))
    else:
        raw = str(scope or "").replace("\r", "\n").replace(";", "\n").split("\n")
    return [item.strip() for item in raw if item.strip()]


def is_allowed_ext(path: Path, exts: tuple[str, ...]) -> bool:
    allowed = {e.lower() if e.startswith(".") else f".{e.lower()}" for e in exts}
    return path.suffix.lower() in allowed


def collect_scope_files(
    root_dir: Path,
    scope: object,
    exts: tuple[str, ...],
    recursive: bool,
    max_files: int | None,
) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    for pattern in split_scope(scope):
        pattern_path = Path(pattern)
        search_pattern = str(pattern_path if pattern_path.is_absolute() else root_dir / pattern)
        matches = glob.glob(search_pattern, recursive=True)
        if not matches and not any(ch in pattern for ch in "*?["):
            target = Path(search_pattern)
            if target.exists():
                matches = [str(target)]
        for raw in matches:
            path = Path(raw).resolve()
            if is_sensitive(path):
                continue
            if path.is_dir():
                for item in collect_files(path, exts, recursive, None):
                    item = item.resolve()
                    if item in seen:
                        continue
                    seen.add(item)
                    files.append(item)
                    if max_files is not None and len(files) >= max_files:
                        return files
                continue
            if not path.is_file() or not is_allowed_ext(path, exts):
                continue
            if path in seen:
                continue
            seen.add(path)
            files.append(path)
            if max_files is not None and len(files) >= max_files:
                return files
    return files


def main() -> int:
    req = read_request()
    action = str(req.get("action") or "").strip()
    aivdb_root = Path(req.get("aivdb_root") or os.environ.get("AIVDB_ROOT") or ".").resolve()
    db_path = Path(req.get("db_path") or "").resolve()
    dim = int(req.get("dim") or 128)

    if not action:
        raise ValueError("action is required")
    if not str(db_path):
        raise ValueError("db_path is required")

    AIVDB = load_aivdb(aivdb_root)

    if action == "prepare":
        with AIVDB(db_path, dim=dim, reset=False) as db:
            emit({
                "ok": True,
                "exists": db_path.exists(),
                "dbPath": str(db_path),
                "aivdbRoot": str(aivdb_root),
                "dim": db.dim,
                "chunks": db.chunk_count(),
                "size": db_path.stat().st_size if db_path.exists() else 0,
            })
        return 0

    if action == "status":
        exists = db_path.exists()
        size = db_path.stat().st_size if exists else 0
        chunks = 0
        actual_dim = dim
        if exists:
            with AIVDB(db_path, dim=dim, reset=False) as db:
                chunks = db.chunk_count()
                actual_dim = db.dim
        emit({
            "ok": True,
            "exists": exists,
            "dbPath": str(db_path),
            "aivdbRoot": str(aivdb_root),
            "dim": actual_dim,
            "chunks": chunks,
            "size": size,
        })
        return 0

    if action == "search":
        if not db_path.exists():
            emit({"ok": False, "error": f"index database does not exist: {db_path}", "hits": []})
            return 0
        query = str(req.get("query") or "").strip()
        if not query:
            raise ValueError("query is required")
        topk = max(1, min(int(req.get("topk") or 8), 50))
        mode = str(req.get("mode") or "hybrid")
        with AIVDB(db_path, dim=dim, reset=False) as db:
            if mode == "keyword":
                hits = db.search(query, topk=topk)
            elif mode == "code":
                hits = db.search_code(query, topk=topk)
            else:
                hits = db.search_hybrid(query, topk=topk)
            emit({
                "ok": True,
                "query": query,
                "topk": topk,
                "dbPath": str(db_path),
                "chunks": db.chunk_count(),
                "hits": [hit_to_dict(hit) for hit in hits],
            })
        return 0

    if action == "index_path":
        target = Path(req.get("path") or "").resolve()
        if not target.exists():
            emit({"ok": False, "error": f"path does not exist: {target}"})
            return 0
        if is_sensitive(target):
            emit({"ok": False, "error": f"path is sensitive and cannot be indexed: {target}"})
            return 0

        reset = bool(req.get("reset"))
        recursive = bool(req.get("recursive", True))
        max_files_raw = req.get("maxFiles")
        max_files = int(max_files_raw) if max_files_raw is not None else None
        max_bytes_raw = req.get("maxBytesPerFile")
        max_bytes = int(max_bytes_raw) if max_bytes_raw is not None else 5_000_000
        exts_raw = req.get("exts")
        exts = tuple(str(e).strip().lower() for e in exts_raw if str(e).strip()) if isinstance(exts_raw, list) else DEFAULT_EXTS

        with AIVDB(db_path, dim=dim, reset=reset) as db:
            before = db.chunk_count()
            if target.is_file():
                if target.suffix.lower() not in {e if e.startswith(".") else f".{e}" for e in exts}:
                    indexed = 0
                    files = []
                elif target.stat().st_size > max_bytes:
                    indexed = 0
                    files = []
                else:
                    indexed = db.add_file(target)
                    files = [target]
            else:
                files = collect_files(target, exts, recursive, max_files)
                indexed = db.add_files(files, max_bytes_per_file=max_bytes)
            after = db.chunk_count()
            emit({
                "ok": True,
                "path": str(target),
                "dbPath": str(db_path),
                "files": len(files),
                "indexedChunks": indexed,
                "beforeChunks": before,
                "afterChunks": after,
                "reset": reset,
            })
        return 0

    if action == "index_pattern":
        reset = bool(req.get("reset", True))
        recursive = bool(req.get("recursive", True))
        root_dir = Path(req.get("root_dir") or os.getcwd()).resolve()
        max_files_raw = req.get("maxFiles")
        max_files = int(max_files_raw) if max_files_raw is not None else None
        max_bytes_raw = req.get("maxBytesPerFile")
        max_bytes = int(max_bytes_raw) if max_bytes_raw is not None else 5_000_000
        exts_raw = req.get("exts")
        exts = tuple(str(e).strip().lower() for e in exts_raw if str(e).strip()) if isinstance(exts_raw, list) else DEFAULT_EXTS
        files = collect_scope_files(root_dir, req.get("scope"), exts, recursive, max_files)

        with AIVDB(db_path, dim=dim, reset=reset) as db:
            before = db.chunk_count()
            indexed = db.add_files(files, max_bytes_per_file=max_bytes)
            after = db.chunk_count()
            emit({
                "ok": True,
                "scope": req.get("scope"),
                "rootDir": str(root_dir),
                "dbPath": str(db_path),
                "files": len(files),
                "indexedChunks": indexed,
                "beforeChunks": before,
                "afterChunks": after,
                "reset": reset,
            })
        return 0

    raise ValueError(f"unknown action: {action}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit({"ok": False, "error": str(exc), "trace": traceback.format_exc(limit=5)})
        raise SystemExit(1)
