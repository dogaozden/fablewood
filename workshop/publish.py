"""Atomic, reviewed publication into the existing outline and game contracts."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from .evidence import verify_quote


def _now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _version(state, evidence):
    source = next(s for s in state["sources"] if s["id"] == evidence["source_id"])
    version = next(v for v in source["versions"] if v["id"] == evidence["source_version"])
    return source, version


def _selected(state):
    selected = []
    for prop in state["propositions"]:
        if prop["review"]["status"] != "approved":
            continue
        exact = []
        for ev in prop["evidence"]:
            if ev["status"] != "exact":
                continue
            source, version = _version(state, ev)
            from .store import Workshop
            Workshop._assert_snapshot(version)
            checked = verify_quote(source_id=source["id"], source_version=version["id"],
                                   snapshot_text=version["snapshot_text"], quote=ev["quote"],
                                   base_locator=version.get("locator"), requested_locator=ev.get("locator"))
            if checked["status"] != "exact":
                raise ValueError(f"Evidence no longer verifies for {prop['id']}; review before publishing")
            exact.append(ev)
        if not exact:
            raise ValueError(f"Approved proposition {prop['id']} has no exact evidence")
        selected.append(prop)
    return selected


def _selected_notes(state):
    from .store import Workshop
    notes = [note for note in state["notes"] if note["review"]["status"] == "approved"]
    for note in notes:
        Workshop._assert_note_contract(note)
    return notes


def _published_sources(state, selected):
    """Return the source metadata that becomes part of the published outline."""
    used = {e["source_id"] for p in selected for e in p["evidence"]}
    sources = deepcopy([s for s in state["sources"] if s["id"] in used])
    from .store import Workshop
    for source in sources:
        for version in source["versions"]:
            # Every version copied into the outline must still match its immutable
            # snapshot, even if this revision cites a different version directly.
            Workshop._assert_snapshot(version)
            version.pop("snapshot_text", None)
    return sources


def _published_relations(state, selected):
    """Publish relation context without promoting an unapproved endpoint."""
    selected_ids = {prop["id"] for prop in selected}
    propositions = {prop["id"]: prop for prop in state["propositions"]}
    relations = []
    for stored in state["relations"]:
        if stored["from_id"] not in selected_ids and stored["to_id"] not in selected_ids:
            continue
        relation = deepcopy(stored)
        for endpoint in ("from", "to"):
            prop = propositions[relation[f"{endpoint}_id"]]
            relation[f"{endpoint}_summary"] = {
                "id": prop["id"],
                "node_id": prop.get("node_id"),
                "statement": prop["statement"],
                "review": deepcopy(prop["review"]),
            }
        relations.append(relation)
    return relations


def _game_eligible(state, prop):
    if prop.get("kind") != "supported_proposition" or prop["confidence"]["support"] != "source_supported":
        return False
    for relation in state["relations"]:
        if relation["status"] == "dismissed" or prop["id"] not in {
            relation["from_id"], relation["to_id"]
        }:
            continue
        if relation["type"] not in {"contradicts", "supersedes", "duplicate_of"}:
            continue
        # Proposed conflicts are unresolved, so neither endpoint may teach.
        # Once directional maintenance is confirmed, only the replaced or
        # duplicate endpoint is excluded; the supported successor/canonical
        # proposition may teach unless another relation blocks it.
        if relation["status"] != "confirmed" or relation["type"] == "contradicts":
            return False
        if relation["type"] == "supersedes" and prop["id"] == relation["to_id"]:
            return False
        if relation["type"] == "duplicate_of" and prop["id"] == relation["from_id"]:
            return False
    return any(e["status"] == "exact" and _version(state, e)[1].get("crate_eligible", False)
               and _version(state, e)[0]["kind"] != "observation" for e in prop["evidence"])


def _confirmed_supersessions(state, eligible_ids, previous_ids):
    """Map previously published old proposition ids to eligible successors."""
    pairs = {}
    for relation in state["relations"]:
        if relation["type"] != "supersedes" or relation["status"] != "confirmed":
            continue
        old_id = relation["to_id"]
        new_id = relation["from_id"]
        if old_id in previous_ids and new_id in eligible_ids:
            pairs[old_id] = new_id
    return pairs


def preview(store):
    def build(state):
        selected = _selected(state)
        if any(not p.get("node_id") for p in selected):
            raise ValueError("Assign every approved proposition to an outline topic before publishing")
        eligible = [p for p in selected if _game_eligible(state, p)]
        notes = _selected_notes(state)
        return {"propositions": deepcopy(selected), "notes": deepcopy(notes),
                "game_proposition_ids": [p["id"] for p in eligible],
                "counts": {"outline_propositions": len(selected), "notes": len(notes),
                           "game_additions": len(eligible), "game_excluded": len(selected) - len(eligible)},
                "rule": "Only approved, exactly quoted, uncontested source propositions enter new game content. Existing pack entries are preserved."}
    return store.read_state(build)


def publish(store, by, base_pack=None):
    if not isinstance(by, str) or not by.strip():
        raise ValueError("Publication requires an attributed publisher")
    base_pack = Path(base_pack or store.root / "packs/secreg/pack.json").resolve()
    if not base_pack.is_file():
        raise ValueError("Select an existing compatible base pack before publishing")
    base = json.loads(base_pack.read_text())

    def commit(state):
        selected = _selected(state)
        if any(not p.get("node_id") for p in selected):
            raise ValueError("Assign every approved proposition to an outline topic before publishing")
        notes = _selected_notes(state)
        previous = state["publications"][-1] if state["publications"] else None
        if not selected and not notes and not previous:
            raise ValueError("No approved propositions or notes are ready to publish")
        eligible = [p for p in selected if _game_eligible(state, p)]
        sources = _published_sources(state, selected)
        relations = _published_relations(state, selected)
        if previous:
            previous_ids = set(previous.get("game_proposition_ids", []))
            missing = previous_ids - {p["id"] for p in eligible}
            safe_supersessions = _confirmed_supersessions(
                state, {p["id"] for p in eligible}, previous_ids
            )
            unresolved = missing - set(safe_supersessions)
            if unresolved:
                duplicate_ids = {
                    relation["from_id"]
                    for relation in state["relations"]
                    if relation["type"] == "duplicate_of"
                    and relation["status"] == "confirmed"
                    and relation["from_id"] in unresolved
                }
                if duplicate_ids:
                    raise ValueError(
                        "Previously published duplicate game knowledge cannot be retired safely: "
                        "the pack contract has no duplicate-retirement metadata. Existing game "
                        "references will not be removed."
                    )
                raise ValueError("Previously published game knowledge now needs reconciliation. Resolve its review/conflict before publishing; existing game references will not be removed.")
        else:
            safe_supersessions = {}
        # Ignore the publication annotation itself in the content identity.
        identity = {"base": _hash(base), "propositions": [{k: v for k, v in p.items() if k != "publication"} for p in selected],
                    "notes": [{k: v for k, v in n.items() if k != "publication"} for n in notes],
                    "relations": relations, "sources": sources}
        publication_id = "publication." + _hash(identity)[:24]
        if previous and previous["id"] == publication_id:
            return {"publication": previous, "outline_url": "/workshop/published/outline.json",
                    "pack_url": "/workshop/published/pack.json", "counts": previous["counts"], "duplicate": True}
        when = _now()
        dest = store.storage / "publications" / publication_id
        dest.mkdir(parents=True, exist_ok=True)
        source_dir = dest / "sources"
        source_dir.mkdir(exist_ok=True)
        previous_directory = Path(previous["directory"]) if previous else None
        if previous_directory:
            pack = json.loads((previous_directory / "pack.json").read_text())
            prior_sources = deepcopy(pack["meta"]["sources"])
            # Preserve reference-bearing records below, but take all other base
            # content from the supplied current version. Recording its checksum
            # while retaining old quests or metadata would misdescribe the output.
            for key in list(pack):
                if key not in {"facts", "encounters"}:
                    del pack[key]
            pack.update({key: deepcopy(value) for key, value in base.items()
                         if key not in {"facts", "encounters"}})
            workshop_source_ids = {s["id"] for s in state["sources"]}
            current_source_ids = {s.get("id") for s in pack["meta"]["sources"]}
            pack["meta"]["sources"].extend(s for s in prior_sources
                if s.get("id") in workshop_source_ids and s.get("id") not in current_source_ids)
            # Keep prior publications self-contained instead of leaving source
            # references pointing into an older publication directory.
            for fact in pack["facts"]:
                source_file = Path(fact["source_ref"]["file"])
                if source_file.parent == previous_directory / "sources":
                    copied_source = source_dir / source_file.name
                    shutil.copyfile(source_file, copied_source)
                    fact["source_ref"]["file"] = str(copied_source)
        else:
            pack = deepcopy(base)
        existing_facts = {f["id"]: f for f in pack["facts"]}
        existing_encounters = {e["id"]: e for e in pack["encounters"]}
        for entry in base["facts"]:
            existing = existing_facts.get(entry["id"])
            if existing is not None and existing != entry:
                raise ValueError(f"Base fact {entry['id']} conflicts with the previous publication")
            if existing is None:
                pack["facts"].append(deepcopy(entry))
                existing_facts[entry["id"]] = pack["facts"][-1]
        for entry in base["encounters"]:
            existing = existing_encounters.get(entry["id"])
            if existing is not None and existing != entry:
                raise ValueError(f"Base encounter {entry['id']} conflicts with the previous publication")
            if existing is None:
                pack["encounters"].append(deepcopy(entry))
                existing_encounters[entry["id"]] = pack["encounters"][-1]
        teaching = []
        for prop in eligible:
            ev = next(e for e in prop["evidence"] if e["status"] == "exact" and _version(state, e)[1].get("crate_eligible", False))
            source, version = _version(state, ev)
            snapshot_file = source_dir / f"{source['id']}-{version['id'].replace(':', '-')}.txt"
            snapshot_file.write_text(version["snapshot_text"])
            fid = "workshop." + prop["id"]
            eid = fid + ".recall"
            source_date = version.get("as_of")
            as_of = source_date or version["imported_at"][:10]
            if source_date:
                date_detail = (
                    f"Source date: {source_date}. The as_of field records the source date "
                    "supplied with this snapshot; it does not by itself verify current law. "
                )
            else:
                date_detail = (
                    f"Source date: unknown; as_of falls back to import date {as_of}. "
                    "No source date was supplied, so the as_of field uses the snapshot import "
                    "date; it does not verify current law. "
                )
            detail = (f"Source: {source['title']}. " + date_detail
                      + f"Currency: {version.get('currency', {}).get('status', 'unverified')}. "
                      + (prop.get("detail") or ""))
            fact = {"id": fid, "type": prop.get("type", "concept"),
                    "statement": "According to the imported source: " + prop["statement"], "detail": detail,
                    "source_ref": {"file": str(snapshot_file),
                                   "loc": version.get("source_ref") or source["uri"], "quote": ev["quote"]},
                    "as_of": as_of,
                    "source_version": version["id"], "tags": prop.get("tags") or ["workshop"],
                    "difficulty": prop.get("difficulty", 2), "prereqs": []}
            encounter = {"id": eid, "fact_ids": [fid], "kind": "free_recall",
                         "prompt": f"From {source['title']}, explain the proposition about {prop.get('node_id') or 'this topic'}.\nSource cue: “{ev['quote']}”",
                         "rubric": "Accept a faithful explanation with the source's conditions and limits: " + prop["statement"],
                         "trap_notes": "Practice derived from an imported source. Do not infer current legal authority from the quotation."}
            if fid not in existing_facts:
                pack["facts"].append(fact)
                existing_facts[fid] = pack["facts"][-1]
            else:
                # A stable fact id may acquire corrected source metadata in a
                # later immutable publication. Preserve any already-ratified
                # maintenance pointers while refreshing its source semantics.
                existing = existing_facts[fid]
                for key in ("supersedes", "superseded_by"):
                    if key in existing:
                        fact[key] = existing[key]
                existing.clear()
                existing.update(fact)
            if eid not in existing_encounters:
                pack["encounters"].append(encounter)
                existing_encounters[eid] = pack["encounters"][-1]
            teaching.append({"proposition_id": prop["id"], "fact_id": fid, "encounter_id": eid,
                             "kind": "teaching_material", "method": "deterministic source recall template",
                             "review": deepcopy(prop["review"])})
            if not any(s.get("id") == source["id"] for s in pack["meta"]["sources"]):
                pack["meta"]["sources"].append({"id": source["id"], "title": source["title"],
                                               "file": source["uri"], "loc": version.get("source_ref", ""),
                                               "version": version["id"]})
        for old_prop_id, new_prop_id in safe_supersessions.items():
            old_fact_id = "workshop." + old_prop_id
            new_fact_id = "workshop." + new_prop_id
            old_fact = existing_facts.get(old_fact_id)
            new_fact = existing_facts.get(new_fact_id)
            if old_fact is None or new_fact is None:
                raise ValueError("Confirmed supersession cannot preserve both stable game fact ids")
            old_fact["superseded_by"] = new_fact_id
            new_fact["supersedes"] = old_fact_id
        # Assert the preservation contract before invoking the real pack validator.
        for entry in base["facts"]:
            if next(f for f in pack["facts"] if f["id"] == entry["id"]) != entry:
                raise ValueError("Base fact changed during publication")
        for entry in base["encounters"]:
            if next(e for e in pack["encounters"] if e["id"] == entry["id"]) != entry:
                raise ValueError("Base encounter changed during publication")
        pack["meta"]["version"] = base["meta"]["version"] + "+" + publication_id
        pack_path = dest / "pack.json"
        pack_path.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
        result = subprocess.run(["node", str(store.root / "pipeline/validate_pack.mjs"), str(pack_path)],
                                cwd=store.root, text=True, capture_output=True, timeout=60)
        (dest / "pack-validation.txt").write_text(result.stdout + result.stderr)
        if result.returncode:
            raise ValueError("Pack validation failed; the previous publication remains active. " + (result.stdout + result.stderr)[-1500:])
        published_props = deepcopy(selected)
        published_notes = deepcopy(notes)
        for p in published_props + published_notes:
            p["publication"] = {"status": "published", "publication_id": publication_id}
        envelope = {"schema_version": 1, "publication_id": publication_id, "generated_at": when,
                    "sources": sources, "propositions": published_props, "relations": relations,
                    "notes": published_notes, "teaching_material": teaching}
        (dest / "outline.json").write_text(json.dumps(envelope, ensure_ascii=False, indent=2) + "\n")
        counts = {"outline_propositions": len(selected), "notes": len(notes), "game_additions": len(eligible),
                  "game_excluded": len(selected) - len(eligible), "pack_facts": len(pack["facts"]),
                  "pack_encounters": len(pack["encounters"])}
        publication = {"id": publication_id, "generated_at": when, "by": by, "directory": str(dest),
                       "base_pack": str(base_pack), "base_sha256": _hash(base), "counts": counts,
                       "game_proposition_ids": [p["id"] for p in eligible], "validation": "passed"}
        state["publications"].append(publication)
        for p in state["propositions"] + state["notes"]:
            p["publication"] = {"status": "published" if p["review"]["status"] == "approved" else "draft",
                                "publication_id": publication_id}
        state["audit"].append({"action": "publish", "at": when, "by": by, "publication_id": publication_id})
        return {"publication": publication, "outline_url": "/workshop/published/outline.json",
                "pack_url": "/workshop/published/pack.json", "counts": counts, "duplicate": False}
    return store.transaction(commit)


def export_current(store, destination):
    """Export the current publication as a portable, read-only consumer snapshot."""
    raw_destination = Path(destination).expanduser()
    if {"state", "realm.ledger.fablewood"}.intersection(raw_destination.parts):
        raise ValueError("Export destination is protected")
    destination = raw_destination.resolve()
    if {"state", "realm.ledger.fablewood"}.intersection(destination.parts):
        raise ValueError("Export destination is protected")
    # The explicit export is for derived output only, never a pack installation.
    for protected in (store.root / "state", store.root / "packs", store.root / "raw", store.root / ".git"):
        if destination == protected or protected in destination.parents:
            raise ValueError("Export destination is protected; choose a derived-output directory")
    publications = store.snapshot()["publications"]
    if not publications:
        raise ValueError("Nothing has been published")
    publication = publications[-1]
    source = Path(publication["directory"])
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source / "sources", destination / "sources", dirs_exist_ok=True)
    pack = json.loads((source / "pack.json").read_text())
    for fact in pack["facts"]:
        ref = fact["source_ref"]
        if Path(ref["file"]).parent == source / "sources":
            path = destination / "sources" / Path(ref["file"]).name
            try:
                ref["file"] = str(path.relative_to(store.root))
            except ValueError:
                ref["file"] = str(path)
    (destination / "pack.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
    shutil.copyfile(source / "outline.json", destination / "outline.json")
    result = subprocess.run(
        ["node", str(store.root / "pipeline/validate_pack.mjs"), str(destination / "pack.json")],
        cwd=store.root, text=True, capture_output=True, timeout=60
    )
    (destination / "pack-validation.txt").write_text(result.stdout + result.stderr)
    if result.returncode:
        raise ValueError(
            "Portable export pack validation failed after source-path rewrite. "
            + (result.stdout + result.stderr)[-1500:]
        )
    return destination
