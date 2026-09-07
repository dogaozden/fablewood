"""Read-only adapters. Existing corpus pins and lecture canon remain authoritative."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re

import yaml

MAX_SOURCE_BYTES = 12_000_000


def _module(root, name):
    path = Path(root) / "secreg" / "pipelines" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"workshop_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _read(path, max_bytes=MAX_SOURCE_BYTES):
    path = Path(path).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"Source does not exist: {path}")
    if path.stat().st_size > max_bytes:
        raise ValueError(f"Source exceeds the {max_bytes // 1_000_000} MB limit; select an excerpt first.")
    data = path.read_bytes()
    return path, data, hashlib.sha256(data).hexdigest()


def _nodes(root):
    return {n["id"]: n for p in sorted((Path(root) / "secreg/atlas/nodes").glob("*.yml"))
            if (n := yaml.safe_load(p.read_text()))}


def catalog(root):
    nodes = _nodes(root)
    sources = []
    priority = ["act33.s4a2", "rule.506b", "rule.506c", "rule.504", "rule.144"]
    for node_id in sorted(nodes, key=lambda n: (priority.index(n) if n in priority else 99, n)):
        n = nodes[node_id]
        pin = n.get("controlling_text", {})
        if pin.get("source", "").startswith("corpus.json#"):
            sources.append({"key": f"atlas:{node_id}", "title": f"{n.get('cite', '')} · {n['title']}",
                            "kind": "statute", "node_id": node_id})
    for node_id in ("case.ralston-purina", "case.chinese-consolidated", "case.howey"):
        if node_id in nodes:
            sources.append({"key": f"case:{node_id}", "title": f"Casebook · {nodes[node_id]['title']}",
                            "kind": "case", "node_id": node_id})
    clips_path = Path(root) / "secreg/layers/lecture/clips.json"
    if clips_path.exists():
        clips = json.loads(clips_path.read_text())
        for node_id in priority:
            if clips.get(node_id):
                clip = clips[node_id][0]
                sources.append({"key": f"lecture:{clip['id']}",
                                "title": f"{nodes[node_id]['title']} · {clip['class_label']} · {clip['stamp']}",
                                "kind": "lecture", "node_id": node_id})
    return {"nodes": [{"id": n["id"], "title": n["title"]} for n in nodes.values()], "sources": sources}


def prepare(root, request):
    """Return a content snapshot with original identity, never write original files."""
    root = Path(root).resolve()
    key = request.get("catalog_key", "")
    if key.startswith("atlas:"):
        return _statute(root, key[6:])
    if key.startswith("lecture:"):
        return _lecture(root, key[8:])
    if key.startswith("case:"):
        return _case(root, key[5:])
    if key:
        raise ValueError("Unknown source catalog entry")
    return _document(root, request)


def _base(path, digest, text, *, title, kind, node_id, source_ref, authority,
          locator=None, as_of=None, creator="Source author", crate_eligible=True):
    return {"uri": str(path), "title": title, "kind": kind, "node_id": node_id,
            "source_ref": source_ref, "text": text, "original_sha256": digest,
            "as_of": as_of, "locator": locator or {},
            "attribution": {"creator": creator, "layer_id": kind},
            "authority": {"level": authority, "label": kind.title()},
            "currency": {"status": "unverified", "note": "Local source edition; current legal status has not been independently checked."},
            "crate_eligible": crate_eligible}


def _statute(root, node_id):
    node = _nodes(root).get(node_id)
    if not node:
        raise ValueError("Unknown atlas node")
    pin = node.get("controlling_text", {})
    ref = pin.get("source", "")
    if not ref.startswith("corpus.json#") or pin.get("confidence") != "verbatim":
        raise ValueError("This node has no corpus pin eligible for import")
    corpuslib = _module(root, "corpuslib")
    path, data, digest = _read(Path(os.environ.get("WORKSHOP_CORPUS", str(corpuslib.LIVE_CORPUS))), 100_000_000)
    container = json.loads(data)
    corpus = corpuslib.Corpus(container)
    target = ref.split("#", 1)[1]
    sec, _, sub = target.partition("/")
    text = corpus.extract(sec, sub or None)
    if corpuslib._norm(pin.get("verbatim", "")) != text:
        raise ValueError("Atlas pin differs from original corpus. Reconcile the source version before importing.")
    metadata = container.get("source", {})
    source_date = metadata.get("ecfr_date" if sec.startswith("r-") else "usc_generated")
    prepared = _base(path, digest, text, title=f"{node.get('cite')} · {node['title']}",
                     kind="statute", node_id=node_id, source_ref=ref, authority="primary",
                     locator={"section": target}, creator="Statutory / regulatory source", as_of=source_date)
    prepared["derivation"] = {"method": "existing corpuslib structural extraction; exact atlas-pin comparison",
                               "original_sha256": digest, "source_ref": ref, "corpus_source_metadata": metadata}
    return prepared


def _lecture(root, clip_id):
    clip = node_id = None
    for nid, entries in json.loads((root / "secreg/layers/lecture/clips.json").read_text()).items():
        for item in entries:
            if item["id"] == clip_id:
                clip, node_id = item, nid
                break
    if clip is None:
        raise ValueError("Unknown lecture clip")
    manifest = json.loads((root / "secreg/layers/lecture/canon-manifest.json").read_text())
    entry = next((c for c in manifest["classes"] if c["class_id"] == clip["class_id"]), None)
    if entry is None:
        raise ValueError("Lecture absent from canon manifest")
    processed = Path(manifest.get("root") or Path.home() / "Downloads/secreg-processed").expanduser().resolve()
    path, data, digest = _read(processed / entry["files"]["corrected_json"])
    if digest != entry["sha256_corrected_json"]:
        raise ValueError("Lecture canon hash changed; import quarantined until canon is reconciled")
    segments = {s["id"]: s for s in json.loads(data)["segments"]}
    try:
        selected = [segments[s] for s in clip["seg_ids"]]
    except KeyError as exc:
        raise ValueError("Lecture segment is absent from registered canon") from exc
    if any(s.get("contested") or s.get("review_status") in {"pending", "contested", "unresolved"}
           for s in selected):
        raise ValueError("Unresolved lecture segment: publication is quarantined")
    text = " ".join(re.sub(r"\s+", " ", s["text"]).strip() for s in selected)
    if clip["quote"] not in text:
        raise ValueError("Lecture quote is not present in its original canon segments")
    if selected[0]["start"] != clip["t_start"] or selected[-1]["end"] != clip["t_end"]:
        raise ValueError("Lecture timestamps differ from original canon")
    prepared = _base(path, digest, text,
                     title=f"{clip['class_label']} · {clip['stamp']}", kind="lecture", node_id=node_id,
                     source_ref=f"{entry['files']['corrected_json']}#{','.join(clip['seg_ids'])}",
                     authority="lecture", as_of=clip.get("date"), creator="Lecture speaker (transcript attribution)",
                     crate_eligible=False,
                     locator={"segment_ids": clip["seg_ids"], "t_start": clip["t_start"],
                              "t_end": clip["t_end"], "media_uri": str(processed / clip["media"])})
    prepared["currency"] = {"status": "historical", "note": "Course lecture; transcript accuracy and legal currency are distinct. Canon hash matched."}
    prepared["derivation"] = {"method": "manifest sha256 + exact selected segments and timestamps",
                               "original_sha256": digest, "clip_id": clip_id}
    prepared["local_quote"] = clip["quote"]
    return prepared


def extract_local_lecture(root, clip_id, text, node_id, receipt_dir):
    """Reuse an existing canon clip without sending private transcript text anywhere."""
    from datetime import datetime, timezone
    prepared = _lecture(Path(root), clip_id)
    if prepared["text"] != text or prepared["node_id"] != node_id:
        raise ValueError("Registered clip text or assignment changed; reconcile canon before proceeding")
    quote = prepared["local_quote"]
    candidates = [{"statement": "The lecture speaker states: “" + quote + "”", "quote": quote,
                   "kind": "supported_proposition", "type": "concept", "difficulty": 2,
                   "tags": ["lecture-commentary"],
                   "detail": "Attributed historical commentary reused from the existing canon clip index; no new model interpretation.",
                   "semantic_assessment": {"verdict": "accept", "reason": "exact-attribution",
                       "method": "local deterministic canon-clip reuse", "note": "Statement attributes the exact existing clip to its speaker. This does not establish legal authority or currency."}}]
    receipt_dir = Path(receipt_dir)
    receipt_dir.mkdir(parents=True, exist_ok=True)
    receipt = {"backend": "local-canon-clip", "status": "completed", "clip_id": clip_id,
               "input_sha256": hashlib.sha256(text.encode()).hexdigest(),
               "original_sha256": prepared["original_sha256"], "network_used": False,
               "completed_at": datetime.now(timezone.utc).isoformat(), "candidates": candidates}
    (receipt_dir / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    return candidates


def _case(root, node_id):
    # Reuse the existing citation-to-case resolver, but enforce the casebook-only
    # crate boundary and verify against the original line range, not a model cite.
    from pipeline.secreg_from_atlas import find_case_source
    node = _nodes(root).get(node_id)
    if not node:
        raise ValueError("Unknown case node")
    found = find_case_source(node, str(root), case_files=["secreg/secreg_casebook_cases.md"])
    if not found:
        raise ValueError("No crate-eligible casebook excerpt for this node")
    match = re.search(r"Source: casebook.md lines (\d+)[–-](\d+)", found["text"])
    if not match:
        raise ValueError("Case excerpt has no original line-range provenance")
    start, end = int(match[1]), int(match[2])
    path, data, digest = _read(root / "secreg/casebook.md")
    original = data.decode("utf-8")
    lines = original.splitlines(keepends=True)
    text = "".join(lines[start - 1:end]).strip()
    body = found["text"][found["text"].index("##### "):].strip().removesuffix("---").strip()
    if body != text:
        raise ValueError("Case excerpt no longer matches its exact original casebook lines")
    prepared = _base(path, digest, text, title=found["title"], kind="case", node_id=node_id,
                     source_ref=f"secreg/casebook.md#L{start}-L{end}", authority="case",
                     creator="Court opinion reproduced in casebook",
                     locator={"section": f"casebook.md lines {start}–{end}",
                              "original_line_start": start,
                              "original_char_start": len("".join(lines[:start - 1]))})
    prepared["currency"] = {"status": "historical", "note": "Historical casebook excerpt; later treatment and current applicability have not been verified."}
    prepared["derivation"] = {"method": "casebook-only citation resolver + byte-equivalent original line range",
                               "excerpt_file": "secreg/secreg_casebook_cases.md", "original_sha256": digest}
    prepared["identity_uri"] = "repo:secreg/casebook.md"
    return prepared


def _document(root, request):
    value = request.get("path")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Choose a catalog source or enter a local Markdown/text path")
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = root / path
    path = path.resolve()
    blocked = {"state", ".git", ".codex", ".claude", ".agents", ".ssh", "node_modules"}
    if blocked.intersection(path.parts) or "realm.ledger.fablewood" in str(path) or path.name.endswith(".staging.json"):
        raise ValueError("Protected path cannot be imported")
    if path.suffix.lower() not in {".md", ".txt"}:
        raise ValueError("This importer supports Markdown and plain text. Use the catalog for statutes and canon lectures.")
    path, data, digest = _read(path)
    text = data.decode("utf-8")
    if not text.strip():
        raise ValueError("The source is empty")
    node_id = request.get("node_id") or ""
    if node_id and node_id not in _nodes(root):
        raise ValueError("Unknown node; choose an existing atlas topic")
    kind = request.get("kind", "document")
    if kind not in {"book", "outline", "document", "case", "observation"}:
        raise ValueError("Use the verified catalog for statutes or lectures")
    as_of = request.get("as_of")
    if as_of is not None:
        from datetime import date
        date.fromisoformat(as_of)
    supplemental = path.name == "secreg_supplemental_cases.md"
    # Historical rule: this reference file is not eligible for knowledge crates.
    prepared = _base(path, digest, text, title=request.get("title") or path.stem,
                     kind=kind, node_id=node_id, source_ref=request.get("source_ref") or str(path),
                     authority="personal" if kind == "observation" else "secondary",
                     as_of=as_of, crate_eligible=not supplemental and kind != "observation")
    if request.get("attribution"):
        prepared["attribution"] = request["attribution"]
    if supplemental:
        prepared["currency"]["note"] += " Supplemental cases are reference-only, not crate-eligible."
    return prepared
