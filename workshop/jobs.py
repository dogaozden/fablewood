"""Deterministic chunking and job recovery helpers."""

from __future__ import annotations

import hashlib
import os
from typing import Any


CHUNK_CHARS = 6000


def bounded_chunks(text: str, limit: int = CHUNK_CHARS) -> list[dict[str, Any]]:
    """Split text at line boundaries where possible, preserving every character."""

    if limit <= 0:
        raise ValueError("chunk limit must be positive")
    if not text:
        pieces = [""]
    else:
        pieces: list[str] = []
        cursor = 0
        while cursor < len(text):
            tentative = min(len(text), cursor + limit)
            if tentative < len(text):
                newline = text.rfind("\n", cursor, tentative + 1)
                if newline >= cursor:
                    tentative = newline + 1
                # A single long line is cut at the hard bound.  Extractor runs must
                # remain bounded even for minified or malformed input.
            pieces.append(text[cursor:tentative])
            cursor = tentative

    chunks = []
    offset = 0
    for index, piece in enumerate(pieces):
        end = offset + len(piece)
        chunks.append(
            {
                "index": index,
                "char_start": offset,
                "char_end": end,
                "sha256": hashlib.sha256(piece.encode("utf-8")).hexdigest(),
                "status": "queued",
                "attempts": [],
            }
        )
        offset = end
    return chunks


def process_is_alive(pid: Any) -> bool:
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        return False
    if pid == os.getpid():
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True
