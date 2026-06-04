"""AIVDB Python wrapper.

Python owns ingestion, chunking, lightweight local embeddings, and result shaping.
The C CPU kernel owns keyword/vector/hybrid search hot paths.
"""

from __future__ import annotations

import argparse
import ctypes as C
import json
import math
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, List, Optional


@dataclass
class Hit:
    chunk_id: int
    score: float
    path: str
    text: str


@dataclass
class Document:
    id: int
    path: str
    title: str
    lang: str
    active: bool
    chunks: int


class _CHit(C.Structure):
    _fields_ = [("chunk_id", C.c_uint32), ("score", C.c_float)]


class AIVDB:
    def __init__(self, path: str | Path, dim: int = 128, *, reset: bool = False) -> None:
        self.path = Path(path)
        self.dim = dim
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lib = self._load_kernel()
        self._db = C.c_void_p()
        self._chunk_meta: list[tuple[str, str]] = []
        self._legacy_manifest_path = Path(str(self.path) + ".manifest.json")
        self._manifest: dict[str, Any] = self._empty_manifest()
        self._chunk_to_doc: dict[int, dict[str, Any]] = {}
        self._active_chunks: set[int] = set()
        self._dirty = False
        self._manifest_dirty = False
        self._created_new = reset or not self.path.exists()

        if self._created_new:
            self._check(self._lib.aivdb_create(self._b(self.path), C.c_uint32(dim)), "create")
            self._manifest = self._empty_manifest()
            self._manifest_dirty = True
        rc = self._lib.aivdb_open(self._b(self.path), C.byref(self._db))
        if rc != 0 and not reset:
            self._check(self._lib.aivdb_create(self._b(self.path), C.c_uint32(dim)), "create")
            self._created_new = True
            rc = self._lib.aivdb_open(self._b(self.path), C.byref(self._db))
        self._check(rc, "open")
        self.dim = int(self._lib.aivdb_dim(self._db))
        self._load_chunk_meta()

    def close(self) -> None:
        if getattr(self, "_db", None) and self._db.value:
            if self._dirty or self._manifest_dirty:
                self.flush()
            self._lib.aivdb_close(self._db)
            self._db = C.c_void_p()

    def flush(self) -> None:
        self._save_manifest(persist=False)
        self._check(self._lib.aivdb_flush(self._db, self._b(self.path)), "flush")
        self._dirty = False
        self._manifest_dirty = False
        self._remove_legacy_manifest()

    def __enter__(self) -> "AIVDB":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def add_text(
        self,
        title: str,
        text: str,
        *,
        path: str = "",
        lang: str = "text",
        chunk_chars: int = 900,
        overlap: int = 120,
    ) -> int:
        """Chunk text, create local deterministic vectors, and add chunks to the C index."""
        doc_id = C.c_uint32()
        self._check(
            self._lib.aivdb_add_document(self._db, self._b(path), self._b(title), C.byref(doc_id)),
            "add_document",
        )

        chunks = self._chunk_markdown(text, max_chars=chunk_chars) if lang == "markdown" else self._chunk(text, max_chars=chunk_chars, overlap=overlap)
        chunk_ids = self._add_chunks(doc_id.value, path or title or lang, chunks)
        if chunk_ids:
            self._register_document(title, path or title, lang, chunk_ids, source="text")
        return len(chunk_ids)

    def _add_chunks(self, c_doc_id: int, display_path: str, chunks: Iterable[str]) -> list[int]:
        chunk_ids: list[int] = []
        for chunk in chunks:
            vec = self._embed(chunk)
            arr = (C.c_float * self.dim)(*vec)
            encoded = chunk.encode("utf-8")
            out_chunk_id = C.c_uint32()
            token_count = max(1, len(self._tokens(chunk)))
            self._check(
                self._lib.aivdb_add_chunk(
                    self._db,
                    c_doc_id,
                    encoded,
                    C.c_uint32(len(encoded)),
                    arr,
                    C.c_uint32(token_count),
                    C.byref(out_chunk_id),
                ),
                "add_chunk",
            )
            cid = int(out_chunk_id.value)
            while len(self._chunk_meta) <= cid:
                self._chunk_meta.append(("", ""))
            self._chunk_meta[cid] = (display_path, chunk)
            chunk_ids.append(cid)
        if chunk_ids:
            self._dirty = True
        return chunk_ids

    def add_file(self, file_path: str | Path, *, replace: bool = False, **kwargs: object) -> int:
        p = Path(file_path)
        if replace:
            self.delete_document(p, compact=False)
        text = p.read_text(encoding="utf-8", errors="ignore")
        return self.add_text(p.name, text, path=str(p), lang=self._lang(p), **kwargs)

    def add_files(self, files: Iterable[str | Path], *, max_bytes_per_file: int | None = None, **kwargs: object) -> int:
        total = 0
        for file_path in files:
            p = Path(file_path)
            if not p.is_file():
                continue
            if max_bytes_per_file is not None and p.stat().st_size > max_bytes_per_file:
                continue
            total += self.add_file(p, **kwargs)
        return total

    def add_folder(
        self,
        root: str | Path,
        *,
        exts: tuple[str, ...] = (".md", ".txt", ".py", ".c", ".h", ".cpp", ".hpp", ".json", ".yaml", ".yml"),
        recursive: bool = True,
        max_files: int | None = None,
        max_bytes_per_file: int | None = 5_000_000,
        **kwargs: object,
    ) -> int:
        base = Path(root)
        iterator = base.rglob("*") if recursive else base.glob("*")
        files: list[Path] = []
        allowed = {e.lower() for e in exts}
        for p in iterator:
            if p.is_file() and p.suffix.lower() in allowed:
                files.append(p)
                if max_files is not None and len(files) >= max_files:
                    break
        return self.add_files(files, max_bytes_per_file=max_bytes_per_file, **kwargs)

    def list_documents(self, *, active_only: bool = True) -> list[Document]:
        docs: list[Document] = []
        for doc in self._manifest.get("documents", []):
            if active_only and not doc.get("active", True):
                continue
            docs.append(
                Document(
                    id=int(doc["id"]),
                    path=str(doc.get("path", "")),
                    title=str(doc.get("title", "")),
                    lang=str(doc.get("lang", "text")),
                    active=bool(doc.get("active", True)),
                    chunks=len(doc.get("chunks", [])),
                )
            )
        return docs

    def delete_document(self, target: int | str | Path, *, compact: bool = False) -> int:
        """Mark matching document(s) inactive. Pass compact=True to physically rebuild the DB."""
        matched = 0
        target_key = None if isinstance(target, int) else self._path_key(target)
        for doc in self._manifest.get("documents", []):
            if not doc.get("active", True):
                continue
            same_id = isinstance(target, int) and int(doc.get("id", -1)) == target
            same_path = target_key is not None and (
                self._path_key(doc.get("path", "")) == target_key or self._path_key(doc.get("title", "")) == target_key
            )
            if same_id or same_path:
                doc["active"] = False
                doc["deleted_at"] = time.time()
                matched += 1
        if matched:
            self._manifest_dirty = True
            self._refresh_manifest_indexes()
            self._save_manifest()
            if compact:
                self.compact()
        return matched

    def delete_path(self, path: str | Path, *, compact: bool = False) -> int:
        return self.delete_document(path, compact=compact)

    def update_file(self, file_path: str | Path, *, compact: bool = False, **kwargs: object) -> int:
        """Replace active entries for path with the current file contents."""
        p = Path(file_path)
        self.delete_document(p, compact=False)
        added = self.add_file(p, **kwargs)
        if compact:
            self.compact()
        return added

    def upsert_file(self, file_path: str | Path, **kwargs: object) -> int:
        return self.update_file(file_path, **kwargs)

    def compact(self) -> None:
        """Physically rebuild the DB with only active documents, reclaiming deleted chunks."""
        active_docs = self._collect_active_documents()
        self.flush()
        if self._db.value:
            self._lib.aivdb_close(self._db)
            self._db = C.c_void_p()

        tmp_path = self.path.with_name(self.path.name + ".compact.tmp")
        self._check(self._lib.aivdb_create(self._b(tmp_path), C.c_uint32(self.dim)), "create_compact")
        self._check(self._lib.aivdb_open(self._b(tmp_path), C.byref(self._db)), "open_compact")

        self._chunk_meta = []
        self._manifest = self._empty_manifest()
        self._active_chunks = set()
        self._chunk_to_doc = {}
        self._dirty = False
        self._manifest_dirty = True

        for doc in active_docs:
            c_doc_id = C.c_uint32()
            self._check(
                self._lib.aivdb_add_document(
                    self._db,
                    self._b(doc["path"]),
                    self._b(doc["title"]),
                    C.byref(c_doc_id),
                ),
                "compact_add_document",
            )
            chunk_ids = self._add_chunks(c_doc_id.value, doc["path"] or doc["title"], doc["chunks_text"])
            self._register_document(doc["title"], doc["path"], doc["lang"], chunk_ids, source=doc.get("source", "compact"))

        self._check(self._lib.aivdb_flush(self._db, self._b(tmp_path)), "flush_compact")
        self._lib.aivdb_close(self._db)
        self._db = C.c_void_p()
        tmp_path.replace(self.path)
        self._check(self._lib.aivdb_open(self._b(self.path), C.byref(self._db)), "reopen_compact")
        self._dirty = False
        self._save_manifest()
        self._load_chunk_meta()

    def search(self, query: str, topk: int = 20) -> List[Hit]:
        raw_topk = self._raw_topk(topk)
        hits = (_CHit * raw_topk)()
        n = self._lib.aivdb_search_keyword(self._db, self._b(query), C.c_uint32(raw_topk), hits)
        return self._rerank(query, self._convert_hits(hits, n))[:topk]

    def search_vector(self, embedding: Iterable[float], topk: int = 20) -> List[Hit]:
        vec = list(embedding)
        if len(vec) != self.dim:
            raise ValueError(f"embedding dim mismatch: expected {self.dim}, got {len(vec)}")
        arr = (C.c_float * self.dim)(*vec)
        raw_topk = self._raw_topk(topk)
        hits = (_CHit * raw_topk)()
        n = self._lib.aivdb_search_vector(self._db, arr, C.c_uint32(raw_topk), hits)
        return self._convert_hits(hits, n)[:topk]

    def search_hybrid(
        self,
        query: str,
        embedding: Optional[Iterable[float]] = None,
        topk: int = 20,
        *,
        min_score: float | None = 0.45,
        require_text_match: bool | None = None,
    ) -> List[Hit]:
        vec = list(embedding) if embedding is not None else self._embed(query)
        arr = (C.c_float * self.dim)(*vec)
        raw_topk = self._raw_topk(topk)
        hits = (_CHit * raw_topk)()
        n = self._lib.aivdb_search_hybrid(
            self._db,
            self._b(query),
            arr,
            C.c_float(0.65),
            C.c_float(0.35),
            C.c_uint32(raw_topk),
            hits,
        )
        ranked = self._rerank(query, self._convert_hits(hits, n))
        if require_text_match is None:
            require_text_match = bool(query.strip())
        return self._filter_relevant(query, ranked, min_score=min_score, require_text_match=require_text_match)[:topk]

    def search_code(self, query: str, topk: int = 10) -> List[Hit]:
        return self.search(query, topk=topk)

    def chunk_count(self) -> int:
        return int(self._lib.aivdb_chunk_count(self._db))

    def _convert_hits(self, hits: C.Array[_CHit], n: int) -> List[Hit]:
        if n <= 0:
            return []
        out: list[Hit] = []
        for i in range(n):
            cid = int(hits[i].chunk_id)
            if not self._is_active_chunk(cid):
                continue
            path, text = self._chunk_meta[cid] if cid < len(self._chunk_meta) else ("", "")
            out.append(Hit(cid, float(hits[i].score), path, text))
        return out

    def _rerank(self, query: str, hits: List[Hit]) -> List[Hit]:
        q = query.strip()
        if not q:
            return hits
        seen = {hit.chunk_id for hit in hits}
        if len(q) >= 2:
            for cid in sorted(self._active_chunks):
                if cid >= len(self._chunk_meta):
                    continue
                path, text = self._chunk_meta[cid]
                if cid not in seen and q in text:
                    hits.append(Hit(cid, 0.0, path, text))
                    seen.add(cid)
        for hit in hits:
            exact = hit.text.count(q)
            heading = 1 if re.search(rf"^##\s+{re.escape(q)}\s*$", hit.text, re.MULTILINE) else 0
            starts = 1 if hit.text.lstrip().startswith(f"## {q}") else 0
            hit.score += exact * 0.25 + heading * 2.0 + starts * 1.0
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits

    def _filter_relevant(
        self,
        query: str,
        hits: List[Hit],
        *,
        min_score: float | None,
        require_text_match: bool,
    ) -> List[Hit]:
        if not query.strip() and min_score is None:
            return hits
        out: list[Hit] = []
        for hit in hits:
            text_match = self._has_text_match(query, hit.text)
            if require_text_match:
                if text_match:
                    out.append(hit)
                continue
            if text_match or min_score is None or hit.score >= min_score:
                out.append(hit)
        return out

    def _has_text_match(self, query: str, text: str) -> bool:
        q = query.strip()
        if not q:
            return True
        if len(q) >= 2 and q in text:
            return True

        text_lower = text.lower()
        words = [m.group(0).lower() for m in re.finditer(r"[A-Za-z0-9_]+", q)]
        if any(len(word) >= 3 and word in text_lower for word in words):
            return True

        cjk = [ch for ch in q if "\u3400" <= ch <= "\u9fff"]
        if len(cjk) >= 2:
            return any((a + b) in text for a, b in zip(cjk, cjk[1:]))
        if len(cjk) == 1 and not words:
            return cjk[0] in text
        return False

    def _chunk(self, text: str, max_chars: int = 900, overlap: int = 120) -> Iterator[str]:
        text = text.replace("\r\n", "\n")
        i = 0
        n = len(text)
        step = max(1, max_chars - overlap)
        while i < n:
            end = min(n, i + max_chars)
            if end < n:
                newline = text.rfind("\n\n", i + max_chars // 2, end)
                if newline > i:
                    end = newline
            chunk = text[i:end].strip()
            if chunk:
                yield chunk
            if end >= n:
                break
            i = max(i + 1, end - overlap)

    def _chunk_markdown(self, text: str, max_chars: int = 900) -> Iterator[str]:
        sections: list[str] = []
        current: list[str] = []
        for line in text.replace("\r\n", "\n").splitlines():
            if line.startswith("## ") and current:
                sections.append("\n".join(current).strip())
                current = [line]
            else:
                current.append(line)
        if current:
            sections.append("\n".join(current).strip())

        for section in sections:
            if len(section) <= max_chars * 2:
                if section:
                    yield section
                continue
            heading = section.splitlines()[0]
            body = "\n".join(section.splitlines()[1:])
            for chunk in self._chunk(body, max_chars=max_chars, overlap=120):
                yield f"{heading}\n\n{chunk}".strip()

    def _embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for tok in self._tokens(text):
            h = self._fnv1a(tok.encode("utf-8"))
            idx = h % self.dim
            sign = 1.0 if (h & 0x80000000) == 0 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(v * v for v in vec))
        return [v / norm for v in vec] if norm else vec

    def _tokens(self, text: str) -> list[str]:
        tokens: list[str] = [m.group(0).lower() for m in re.finditer(r"[A-Za-z0-9_]+", text)]
        cjk = [ch for ch in text if "\u3400" <= ch <= "\u9fff"]
        tokens.extend(cjk)
        tokens.extend(a + b for a, b in zip(cjk, cjk[1:]))
        return tokens[:2048]

    def _lang(self, path: Path) -> str:
        return {
            ".py": "python",
            ".c": "c",
            ".h": "c",
            ".cpp": "cpp",
            ".md": "markdown",
            ".txt": "text",
        }.get(path.suffix.lower(), "text")

    def _load_kernel(self) -> C.CDLL:
        base = Path(__file__).resolve().parent
        if sys.platform.startswith("win"):
            names = ("aivdb_kernel.dll", "dist/windows-x86_64/aivdb_kernel.dll")
        elif sys.platform == "darwin":
            names = ("libaivdb_kernel.dylib", "libaivdb_kernel.so", "dist/macos/libaivdb_kernel.dylib")
        else:
            machine = getattr(__import__("platform"), "machine")().lower()
            dist_names = []
            if machine in {"aarch64", "arm64"}:
                dist_names.append("dist/linux-aarch64-raspi/libaivdb_kernel.so")
                dist_names.append("dist/linux-aarch64/libaivdb_kernel.so")
            elif machine in {"x86_64", "amd64"}:
                dist_names.append("dist/linux-x86_64/libaivdb_kernel.so")
            dist_names.extend(("dist/linux-x86_64/libaivdb_kernel.so", "dist/linux/libaivdb_kernel.so"))
            names = ("libaivdb_kernel.so", "aivdb_kernel.so", *dist_names)

        candidates = [base / name for name in names]
        existing = [p for p in candidates if p.exists()]
        if not existing:
            self._try_build_kernel(base)
            existing = [p for p in candidates if p.exists()]
        if not existing:
            tried = ", ".join(str(p) for p in candidates)
            raise FileNotFoundError(f"missing AIVDB kernel shared library; tried: {tried}")

        errors: list[str] = []
        for kernel in existing:
            try:
                return self._bind_kernel(C.CDLL(str(kernel)))
            except (OSError, AttributeError) as exc:
                errors.append(f"{kernel}: {exc}")
        raise RuntimeError("no compatible AIVDB kernel shared library found; " + "; ".join(errors))

    def _bind_kernel(self, lib: C.CDLL) -> C.CDLL:
        lib.aivdb_create.argtypes = [C.c_char_p, C.c_uint32]
        lib.aivdb_create.restype = C.c_int
        lib.aivdb_flush.argtypes = [C.c_void_p, C.c_char_p]
        lib.aivdb_flush.restype = C.c_int
        lib.aivdb_open.argtypes = [C.c_char_p, C.POINTER(C.c_void_p)]
        lib.aivdb_open.restype = C.c_int
        lib.aivdb_close.argtypes = [C.c_void_p]
        lib.aivdb_close.restype = C.c_int
        lib.aivdb_add_document.argtypes = [C.c_void_p, C.c_char_p, C.c_char_p, C.POINTER(C.c_uint32)]
        lib.aivdb_add_document.restype = C.c_int
        lib.aivdb_add_chunk.argtypes = [
            C.c_void_p,
            C.c_uint32,
            C.c_char_p,
            C.c_uint32,
            C.POINTER(C.c_float),
            C.c_uint32,
            C.POINTER(C.c_uint32),
        ]
        lib.aivdb_add_chunk.restype = C.c_int
        lib.aivdb_search_keyword.argtypes = [C.c_void_p, C.c_char_p, C.c_uint32, C.POINTER(_CHit)]
        lib.aivdb_search_keyword.restype = C.c_int
        lib.aivdb_search_vector.argtypes = [C.c_void_p, C.POINTER(C.c_float), C.c_uint32, C.POINTER(_CHit)]
        lib.aivdb_search_vector.restype = C.c_int
        lib.aivdb_search_hybrid.argtypes = [
            C.c_void_p,
            C.c_char_p,
            C.POINTER(C.c_float),
            C.c_float,
            C.c_float,
            C.c_uint32,
            C.POINTER(_CHit),
        ]
        lib.aivdb_search_hybrid.restype = C.c_int
        lib.aivdb_chunk_count.argtypes = [C.c_void_p]
        lib.aivdb_chunk_count.restype = C.c_uint32
        lib.aivdb_dim.argtypes = [C.c_void_p]
        lib.aivdb_dim.restype = C.c_uint32
        lib.aivdb_chunk_text.argtypes = [C.c_void_p, C.c_uint32]
        lib.aivdb_chunk_text.restype = C.c_char_p
        lib.aivdb_set_metadata.argtypes = [C.c_void_p, C.c_char_p, C.c_uint64]
        lib.aivdb_set_metadata.restype = C.c_int
        lib.aivdb_metadata.argtypes = [C.c_void_p]
        lib.aivdb_metadata.restype = C.c_void_p
        lib.aivdb_metadata_size.argtypes = [C.c_void_p]
        lib.aivdb_metadata_size.restype = C.c_uint64
        return lib

    def _try_build_kernel(self, base: Path) -> None:
        if os.environ.get("AIVDB_AUTO_BUILD", "1") == "0":
            return
        try:
            if sys.platform.startswith("win"):
                script = base / "build_windows.ps1"
                if script.exists():
                    subprocess.run(
                        ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(script)],
                        cwd=base,
                        check=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
            else:
                script = base / "build_linux.sh"
                if script.exists():
                    subprocess.run(
                        ["sh", str(script)],
                        cwd=base,
                        check=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
        except Exception:
            return

    def _load_chunk_meta(self) -> None:
        count = int(self._lib.aivdb_chunk_count(self._db))
        self._chunk_meta = []
        for cid in range(count):
            ptr = self._lib.aivdb_chunk_text(self._db, C.c_uint32(cid))
            text = ptr.decode("utf-8", errors="ignore") if ptr else ""
            self._chunk_meta.append((str(self.path), text))
        self._load_manifest()
        self._refresh_manifest_indexes()

    def _empty_manifest(self) -> dict[str, Any]:
        return {"version": 2, "storage": "embedded", "dim": self.dim, "next_doc_id": 1, "documents": []}

    def _load_manifest(self) -> None:
        embedded = self._read_manifest_metadata()
        if embedded is not None:
            self._manifest = embedded
            self._manifest_dirty = False
            self._remove_legacy_manifest()
        elif (not self._created_new) and self._legacy_manifest_path.exists():
            try:
                self._manifest = json.loads(self._legacy_manifest_path.read_text(encoding="utf-8"))
                self._manifest_dirty = True
                self._save_manifest()
            except Exception:
                self._manifest = self._empty_manifest()
        else:
            self._manifest = self._empty_manifest()
            if self._chunk_meta:
                self._manifest["documents"].append(
                    {
                        "id": 0,
                        "title": self.path.name,
                        "path": str(self.path),
                        "path_key": self._path_key(self.path),
                        "lang": "aivdb",
                        "source": "inferred",
                        "active": True,
                        "created_at": time.time(),
                        "updated_at": time.time(),
                        "chunks": list(range(len(self._chunk_meta))),
                    }
                )
                self._manifest["next_doc_id"] = 1
                self._manifest_dirty = True
                self._save_manifest()
        if "documents" not in self._manifest:
            self._manifest["documents"] = []
        if "next_doc_id" not in self._manifest:
            existing = [int(d.get("id", -1)) for d in self._manifest["documents"]]
            self._manifest["next_doc_id"] = (max(existing) + 1) if existing else 1

    def _read_manifest_metadata(self) -> dict[str, Any] | None:
        size = int(self._lib.aivdb_metadata_size(self._db))
        if size <= 0:
            return None
        ptr = self._lib.aivdb_metadata(self._db)
        if not ptr:
            return None
        try:
            raw = C.string_at(ptr, size).decode("utf-8")
            data = json.loads(raw)
        except Exception:
            return None
        return data if isinstance(data, dict) else None

    def _save_manifest(self, *, persist: bool = True) -> None:
        self._manifest["version"] = 2
        self._manifest["storage"] = "embedded"
        self._manifest["dim"] = self.dim
        encoded = json.dumps(self._manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._check(
            self._lib.aivdb_set_metadata(self._db, C.c_char_p(encoded), C.c_uint64(len(encoded))),
            "set_metadata",
        )
        if persist:
            self._check(self._lib.aivdb_flush(self._db, self._b(self.path)), "flush_metadata")
            self._dirty = False
            self._remove_legacy_manifest()
        self._manifest_dirty = False

    def _remove_legacy_manifest(self) -> None:
        try:
            if self._legacy_manifest_path.exists():
                self._legacy_manifest_path.unlink()
        except OSError:
            pass

    def _register_document(
        self,
        title: str,
        path: str,
        lang: str,
        chunk_ids: list[int],
        *,
        source: str,
    ) -> dict[str, Any]:
        doc_id = int(self._manifest.get("next_doc_id", 1))
        self._manifest["next_doc_id"] = doc_id + 1
        now = time.time()
        doc = {
            "id": doc_id,
            "title": title,
            "path": path,
            "path_key": self._path_key(path),
            "lang": lang,
            "source": source,
            "active": True,
            "created_at": now,
            "updated_at": now,
            "chunks": chunk_ids,
        }
        self._manifest.setdefault("documents", []).append(doc)
        self._manifest_dirty = True
        self._refresh_manifest_indexes()
        return doc

    def _refresh_manifest_indexes(self) -> None:
        self._active_chunks = set()
        self._chunk_to_doc = {}
        for doc in self._manifest.get("documents", []):
            if not doc.get("active", True):
                continue
            doc_path = str(doc.get("path") or doc.get("title") or self.path)
            for cid in doc.get("chunks", []):
                cid = int(cid)
                self._active_chunks.add(cid)
                self._chunk_to_doc[cid] = doc
                if cid < len(self._chunk_meta):
                    self._chunk_meta[cid] = (doc_path, self._chunk_meta[cid][1])
        if not self._manifest.get("documents") and self._chunk_meta:
            self._active_chunks = set(range(len(self._chunk_meta)))

    def _is_active_chunk(self, cid: int) -> bool:
        if not self._manifest.get("documents"):
            return True
        return cid in self._active_chunks

    def _raw_topk(self, topk: int) -> int:
        active = max(1, len(self._active_chunks) if self._active_chunks else self.chunk_count())
        return min(active, max(topk, topk * 8, 64))

    def _path_key(self, path: str | Path) -> str:
        s = str(path)
        try:
            p = Path(s)
            if p.exists():
                s = str(p.resolve())
        except Exception:
            pass
        return s.replace("\\", "/").lower() if sys.platform.startswith("win") else s

    def _collect_active_documents(self) -> list[dict[str, Any]]:
        docs: list[dict[str, Any]] = []
        for doc in self._manifest.get("documents", []):
            if not doc.get("active", True):
                continue
            chunks_text: list[str] = []
            for cid in doc.get("chunks", []):
                cid = int(cid)
                if cid < len(self._chunk_meta):
                    chunks_text.append(self._chunk_meta[cid][1])
            if chunks_text:
                docs.append(
                    {
                        "title": str(doc.get("title", "")),
                        "path": str(doc.get("path", "")),
                        "lang": str(doc.get("lang", "text")),
                        "source": str(doc.get("source", "compact")),
                        "chunks_text": chunks_text,
                    }
                )
        return docs

    def _check(self, rc: int, op: str) -> None:
        if rc != 0:
            raise RuntimeError(f"aivdb kernel {op} failed: rc={rc}")

    def _b(self, value: str | Path) -> bytes:
        return str(value).encode("utf-8")

    def _fnv1a(self, data: bytes) -> int:
        h = 2166136261
        for b in data:
            h ^= b
            h = (h * 16777619) & 0xFFFFFFFF
        return h


def bench_markdown(md_path: Path, *, dim: int = 128, iters: int = 1000) -> None:
    queries = ["半夏厚朴汤", "失眠", "糖尿病", "前列腺炎", "桂枝汤", "小儿哮喘"]
    db_path = md_path.with_name("_python_bench.aivdb")
    with AIVDB(db_path, dim=dim, reset=True) as db:
        t0 = time.perf_counter()
        chunks = db.add_file(md_path)
        t1 = time.perf_counter()
        print("AIVDB Python/C Index Benchmark")
        print("==============================")
        print(f"file={md_path.name} chunks={chunks} dim={dim}")
        print(f"index_time_ms={(t1 - t0) * 1000:.2f}")

        for query in queries:
            db.search(query, topk=5)
            t0 = time.perf_counter()
            for _ in range(iters):
                hits = db.search(query, topk=5)
            t1 = time.perf_counter()
            avg_us = (t1 - t0) * 1_000_000 / iters
            best = hits[0].text.splitlines()[0][:60] if hits else ""
            print(f"keyword query={query} avg_us={avg_us:.2f} hits={len(hits)} best={best}")

        for query in queries[:3]:
            db.search_hybrid(query, topk=5)
            t0 = time.perf_counter()
            for _ in range(iters):
                hits = db.search_hybrid(query, topk=5)
            t1 = time.perf_counter()
            avg_us = (t1 - t0) * 1_000_000 / iters
            best = hits[0].text.splitlines()[0][:60] if hits else ""
            print(f"hybrid  query={query} avg_us={avg_us:.2f} hits={len(hits)} best={best}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bench", type=Path, default=None)
    parser.add_argument("--dim", type=int, default=128)
    parser.add_argument("--iter", type=int, default=1000)
    args = parser.parse_args()
    if args.bench:
        bench_markdown(args.bench, dim=args.dim, iters=args.iter)
    else:
        default_db = Path("knowledge.aivdb")
        if not default_db.exists() and Path("data/knowledge.aivdb").exists():
            default_db = Path("data/knowledge.aivdb")
        db = AIVDB(default_db)
        print(f"AIVDB wrapper ready: {db.path}")
        db.close()


if __name__ == "__main__":
    main()
