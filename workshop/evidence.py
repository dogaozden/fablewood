"""Deterministic evidence validation for Knowledge Workshop snapshots."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from typing import Any, Mapping


CONTEXT_CHARS = 180
def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _evidence_id(
    source_id: str,
    source_version: str,
    quote: str,
    status: str,
    char_start: int | None,
) -> str:
    material = "\0".join(
        (source_id, source_version, quote, status, "" if char_start is None else str(char_start))
    )
    return "evidence." + hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]


def verify_quote(
    *,
    source_id: str,
    source_version: str,
    snapshot_text: str,
    quote: str | None,
    base_locator: Mapping[str, Any] | None = None,
    requested_locator: Mapping[str, Any] | None = None,
    selection_start: int = 0,
    selection_end: int | None = None,
    checked_at: str | None = None,
) -> dict[str, Any]:
    """Return immutable evidence derived only from an imported text snapshot.

    Exact matches are ambiguous when a quote appears more than once.  A caller can
    disambiguate with ``requested_locator.char_start``; the offset must identify an
    exact occurrence and is never trusted without checking the source text.
    """

    checked_at = checked_at or utc_now()
    quote = quote if isinstance(quote, str) else ""
    base_locator = dict(base_locator or {})
    requested_locator = dict(requested_locator or {})

    # Every prepared-source locator field is trusted provenance.  Candidate
    # locator metadata is untrusted and may only select an exact char offset.
    preserved = {
        key: deepcopy_value
        for key, deepcopy_value in base_locator.items()
        if key not in {"line_start", "line_end", "char_start", "char_end"}
        and deepcopy_value is not None
    }
    selection_end = len(snapshot_text) if selection_end is None else selection_end
    if selection_start < 0 or selection_end < selection_start or selection_end > len(snapshot_text):
        raise ValueError("invalid source selection bounds")

    start: int | None = None
    reason: str
    if not quote:
        status = "unavailable"
        reason = "candidate supplied no quote"
    else:
        occurrences: list[int] = []
        cursor = selection_start
        while True:
            match = snapshot_text.find(quote, cursor, selection_end)
            if match < 0 or match + len(quote) > selection_end:
                break
            occurrences.append(match)
            cursor = match + 1

        requested_start = requested_locator.get("char_start")
        if requested_start is not None:
            if isinstance(requested_start, bool) or not isinstance(requested_start, int):
                status = "unsupported"
                reason = "requested char_start is not an integer offset"
            elif requested_start in occurrences:
                status = "exact"
                start = requested_start
                reason = "quote exactly matches the selected source snapshot at char_start"
            else:
                status = "unsupported"
                reason = "quote does not match the selected source chunk at char_start"
        elif len(occurrences) == 1:
            status = "exact"
            start = occurrences[0]
            reason = "quote occurs exactly once in the selected source chunk"
        elif not occurrences:
            status = "unsupported"
            reason = "quote does not occur in the selected source chunk"
        else:
            status = "ambiguous"
            reason = f"quote occurs {len(occurrences)} times; supply char_start to disambiguate"

    locator = dict(preserved)
    context = ""
    if start is not None:
        end = start + len(quote)
        snapshot_line_start = _line_number(snapshot_text, start)
        snapshot_line_end = _line_number(snapshot_text, end - 1 if end > start else end)
        source_line_origin = base_locator.get("original_line_start")
        source_char_origin = base_locator.get("original_char_start")
        if isinstance(source_line_origin, int) and not isinstance(source_line_origin, bool):
            locator["selection_original_line_start"] = source_line_origin
            locator["original_line_start"] = source_line_origin + snapshot_line_start - 1
            locator["original_line_end"] = source_line_origin + snapshot_line_end - 1
        if isinstance(source_char_origin, int) and not isinstance(source_char_origin, bool):
            locator["selection_original_char_start"] = source_char_origin
            locator["original_char_start"] = source_char_origin + start
            locator["original_char_end"] = source_char_origin + end
        locator.update(
            {
                "line_start": snapshot_line_start,
                "line_end": snapshot_line_end,
                "char_start": start,
                "char_end": end,
            }
        )
        context = snapshot_text[max(0, start - CONTEXT_CHARS) : min(len(snapshot_text), end + CONTEXT_CHARS)]

    return {
        "id": _evidence_id(source_id, source_version, quote, status, start),
        "source_id": source_id,
        "source_version": source_version,
        "quote": quote,
        "status": status,
        "locator": locator,
        "context": context,
        "validation": {
            "method": "exact_snapshot_match",
            "checked_at": checked_at,
            "reason": reason,
        },
    }
