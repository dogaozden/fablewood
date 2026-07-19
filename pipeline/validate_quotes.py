#!/usr/bin/env python3
"""validate_quotes.py — Python-validate a staging fact file against source text.

The pack contract (Fable_SPEC §4): source_refs are validated against the source
text, never LLM-trusted. Facts that fail are not shipped. This script is that
gate. For every fact it checks:

  * source_ref.quote appears in source_ref.file, under a normalization that
    collapses whitespace runs to single spaces and folds curly quotes/
    apostrophes to straight (applied to BOTH sides);
  * ids are unique and well-formed (vc.econ.<topic>.<slug>);
  * type is a valid enum; difficulty is an int 1–5; as_of is YYYY-MM-DD;
  * required fields are present and non-empty;
  * every prereq id refers to a fact that exists in the set;
  * source_ref.file exists on disk.

Exits nonzero and lists every failure if any check fails.

Usage:
    python3 pipeline/validate_quotes.py [facts.json] [--root REPO_ROOT]
"""

import json
import os
import re
import sys

VALID_TYPES = {"rule", "concept", "advice", "do", "dont", "number", "story"}
ID_RE = re.compile(r"^vc\.econ\.[a-z0-9]+(\.[a-z0-9-]+)+$")
AS_OF_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Curly -> straight for quotes/apostrophes (both quote and source get folded).
QUOTE_FOLD = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "ʼ": "'", "´": "'", "`": "'",
}
_FOLD_TABLE = {ord(k): v for k, v in QUOTE_FOLD.items()}


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.translate(_FOLD_TABLE)).strip()


def load_source(path: str, root: str, cache: dict):
    full = path if os.path.isabs(path) else os.path.join(root, path)
    if full not in cache:
        if not os.path.exists(full):
            cache[full] = None
        else:
            with open(full, encoding="utf-8") as f:
                cache[full] = normalize(f.read())
    return cache[full]


def validate(facts_path: str, root: str):
    with open(facts_path, encoding="utf-8") as f:
        facts = json.load(f)

    failures = []
    if not isinstance(facts, list):
        return ["top-level JSON is not an array"], 0, 0

    ids = [fct.get("id") for fct in facts]
    seen, dupes = set(), set()
    for fid in ids:
        if fid in seen:
            dupes.add(fid)
        seen.add(fid)
    for fid in sorted(dupes):
        failures.append(f"[duplicate id] {fid}")
    id_set = set(ids)

    src_cache = {}
    required = ["id", "type", "statement", "detail", "source_ref",
                "as_of", "source_version", "tags", "difficulty", "prereqs"]

    passed = 0
    for i, fct in enumerate(facts):
        fid = fct.get("id", f"<index {i}>")
        errs = []

        for key in required:
            if key not in fct or fct[key] in (None, "", []):
                if not (key in ("prereqs",) and fct.get(key) == []):
                    errs.append(f"missing/empty field '{key}'")

        if fct.get("id") and not ID_RE.match(fct["id"]):
            errs.append(f"id not well-formed: {fct['id']}")
        if fct.get("type") not in VALID_TYPES:
            errs.append(f"invalid type: {fct.get('type')!r}")
        d = fct.get("difficulty")
        if not (isinstance(d, int) and 1 <= d <= 5):
            errs.append(f"difficulty not int 1-5: {d!r}")
        if not (isinstance(fct.get("as_of"), str) and AS_OF_RE.match(fct.get("as_of", ""))):
            errs.append(f"as_of not YYYY-MM-DD: {fct.get('as_of')!r}")
        if not (isinstance(fct.get("tags"), list) and fct["tags"]
                and all(isinstance(t, str) and t == t.lower() for t in fct["tags"])):
            errs.append(f"tags must be a non-empty list of lowercase strings: {fct.get('tags')!r}")

        for pid in fct.get("prereqs", []) or []:
            if pid not in id_set:
                errs.append(f"prereq id does not exist: {pid}")
            if pid == fct.get("id"):
                errs.append("fact lists itself as a prereq")

        sr = fct.get("source_ref") or {}
        if not all(k in sr for k in ("file", "loc", "quote")):
            errs.append("source_ref missing file/loc/quote")
        else:
            src = load_source(sr["file"], root, src_cache)
            if src is None:
                errs.append(f"source file not found: {sr['file']}")
            else:
                q = normalize(sr["quote"])
                if not q:
                    errs.append("empty quote")
                elif q not in src:
                    errs.append(f"quote not found verbatim in {sr['file']}\n"
                                f"        quote: {q[:160]}")

        if errs:
            for e in errs:
                failures.append(f"[{fid}] {e}")
        else:
            passed += 1

    return failures, passed, len(facts)


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    root = None
    for a in argv[1:]:
        if a.startswith("--root="):
            root = a.split("=", 1)[1]
    facts_path = args[0] if args else "packs/vc-law/facts.staging.json"
    if root is None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    failures, passed, total = validate(facts_path, root)

    print(f"Validated {facts_path}")
    print(f"Facts: {total} | Passed: {passed} | Failed: {total - passed}")
    if failures:
        print(f"\n{len(failures)} failure(s):")
        for f in failures:
            print("  -", f)
        print("\nVALIDATION FAILED")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
