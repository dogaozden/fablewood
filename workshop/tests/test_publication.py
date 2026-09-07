from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from workshop.publish import export_current, preview, publish
from workshop.store import Workshop


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class WorkshopPublicationTests(unittest.TestCase):
    """Exercise publication through the real pack validator with neutral additions."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "fixture-repository"
        (self.root / "pipeline").mkdir(parents=True)
        (self.root / "app/src/packs").mkdir(parents=True)
        (self.root / "packs/base").mkdir(parents=True)
        (self.root / "state").mkdir(parents=True)

        shutil.copyfile(
            REPOSITORY_ROOT / "pipeline/validate_pack.mjs",
            self.root / "pipeline/validate_pack.mjs",
        )
        shutil.copyfile(
            REPOSITORY_ROOT / "app/src/packs/pack.schema.json",
            self.root / "app/src/packs/pack.schema.json",
        )
        existing_pack = next(iter(sorted((REPOSITORY_ROOT / "packs").glob("*/pack.json"))))
        shutil.copyfile(existing_pack, self.root / "packs/base/pack.json")
        os.symlink(REPOSITORY_ROOT / "node_modules", self.root / "node_modules")

        self.base_pack_path = self.root / "packs/base/pack.json"
        self.base_pack = json.loads(self.base_pack_path.read_text())
        self.history_path = self.root / "state/srs.json"
        self.history_path.write_bytes(
            b'{"version":1,"facts":{"fixture.base":{"interval":7,"reps":3}}}\n'
        )
        self.history_before = self.history_path.read_bytes()
        self.source_path = self.root / "neutral-source.txt"
        self.workshop = Workshop(self.root, self.root / ".workshop-test")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_last_note_can_be_withdrawn_without_mutating_old_release(self):
        note = self.workshop.add_note("node.neutral", "An attributed observation.",
                                      {"creator": "Fixture", "layer_id": "personal"})
        self.workshop.review_note(note["id"], "approved", "Fixture", "checked")
        first = publish(self.workshop, "Fixture", self.base_pack_path)
        first_path = Path(first["publication"]["directory"]) / "outline.json"
        first_bytes = first_path.read_bytes()
        self.workshop.review_note(note["id"], "rejected", "Fixture", "withdraw")
        second = publish(self.workshop, "Fixture", self.base_pack_path)
        current = json.loads((Path(second["publication"]["directory"]) / "outline.json").read_text())
        self.assertEqual(current["notes"], [])
        self.assertEqual(current["propositions"], [])
        self.assertNotEqual(first["publication"]["id"], second["publication"]["id"])
        self.assertEqual(first_path.read_bytes(), first_bytes)
        self.assertTrue(publish(self.workshop, "Fixture", self.base_pack_path)["duplicate"])
        self.assertEqual(self.history_path.read_bytes(), self.history_before)

    def test_current_base_metadata_is_used_after_prior_publication(self):
        note = self.workshop.add_note(
            "node.neutral", "A note.", {"creator": "Fixture", "layer_id": "personal"}
        )
        self.workshop.review_note(note["id"], "approved", "Fixture", "checked")
        first = publish(self.workshop, "Fixture", self.base_pack_path)
        changed = deepcopy(self.base_pack)
        changed["meta"]["title"] = "Updated base title"
        changed["meta"]["version"] = "2.0.0"
        self.base_pack_path.write_text(json.dumps(changed))
        second = publish(self.workshop, "Fixture", self.base_pack_path)
        pack = json.loads((Path(second["publication"]["directory"]) / "pack.json").read_text())
        self.assertEqual(pack["meta"]["title"], "Updated base title")
        self.assertTrue(pack["meta"]["version"].startswith("2.0.0+"))
        self.assertEqual(pack["facts"], changed["facts"])
        self.assertEqual(pack["encounters"], changed["encounters"])
        self.assertNotEqual(first["publication"]["base_sha256"], second["publication"]["base_sha256"])

    def prepared(self, text: str, *, as_of: str | None = "2026-08-31") -> dict:
        self.source_path.write_text(text)
        return {
            "uri": str(self.source_path),
            "title": "Neutral Reference",
            "kind": "document",
            "source_ref": "chapter-neutral",
            "as_of": as_of,
            "attribution": {"creator": "Fixture Author", "layer_id": "fixture"},
            "authority": {"level": "secondary", "label": "Neutral fixture"},
            "text": text,
            "node_id": "node.neutral",
            "locator": {"section": "Chapter Neutral"},
            "currency": {"status": "verified", "note": "fixture edition checked"},
            "crate_eligible": True,
            "original_sha256": hashlib.sha256(text.encode()).hexdigest(),
            "derivation": {"method": "neutral test fixture"},
        }

    def test_malformed_approved_legacy_note_is_blocked_at_publication_boundary(self):
        def insert_malformed(state):
            state["notes"].append({
                "id": "note.legacy-malformed",
                "node_id": "node.neutral",
                "text": "Legacy note without an attribution layer.",
                "attribution": {"creator": "Fixture"},
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
                "review": {
                    "status": "approved", "by": "Fixture",
                    "at": "2026-01-01T00:00:00Z", "note": "legacy",
                    "method": "human",
                },
                "publication": {"status": "draft"},
            })

        self.workshop.transaction(insert_malformed)
        with self.assertRaisesRegex(ValueError, "non-blank layer_id"):
            preview(self.workshop)
        with self.assertRaisesRegex(ValueError, "non-blank layer_id"):
            publish(self.workshop, "fixture-publisher", self.base_pack_path)

    def test_identical_review_retries_preserve_publication_identity(self):
        text = "The quartz dial points south.\n"
        _, propositions = self.ingest(
            text,
            [{"statement": "The dial points south.", "quote": text.strip()}],
        )
        proposition = propositions[0]
        review_args = (
            proposition["id"], "approved", "fixture-reviewer", "exact quote checked"
        )
        self.workshop.review_proposition(*review_args, method="human")
        note = self.workshop.add_note(
            "node.neutral", "Compare the quartz dial later.",
            {"creator": "Fixture", "layer_id": "personal"},
        )
        note_review_args = (
            note["id"], "approved", "fixture-reviewer", "personal note checked"
        )
        self.workshop.review_note(*note_review_args, method="human")
        first = publish(self.workshop, "fixture-publisher", self.base_pack_path)

        self.workshop.review_proposition(*review_args, method="human")
        self.workshop.review_note(*note_review_args, method="human")
        repeated = publish(self.workshop, "fixture-publisher", self.base_pack_path)

        self.assertTrue(repeated["duplicate"])
        self.assertEqual(repeated["publication"]["id"], first["publication"]["id"])
        self.assertEqual(len(self.workshop.snapshot()["publications"]), 1)

    def ingest(self, text: str, candidates: list[dict]) -> tuple[dict, list[dict]]:
        imported = self.workshop.import_prepared(self.prepared(text))
        job = self.workshop.run_job(imported["job"]["id"], lambda *_: candidates)
        snapshot = self.workshop.snapshot()
        propositions = [
            next(item for item in snapshot["propositions"] if item["id"] == proposition_id)
            for proposition_id in job["accepted_outputs"]
        ]
        return imported, propositions

    def approve(self, proposition: dict, note: str = "source and scope checked") -> dict:
        return self.workshop.review_proposition(
            proposition["id"], "approved", "fixture-reviewer", note, method="human"
        )

    @staticmethod
    def publication_files(result: dict) -> tuple[dict, dict, Path]:
        directory = Path(result["publication"]["directory"])
        return (
            json.loads((directory / "outline.json").read_text()),
            json.loads((directory / "pack.json").read_text()),
            directory,
        )

    @staticmethod
    def version_id(snapshot_text: str, original_sha256: str | None = None) -> str:
        snapshot_sha256 = hashlib.sha256(snapshot_text.encode()).hexdigest()
        material = "\0".join(
            (
                "workshop-source-version-v1",
                snapshot_sha256,
                original_sha256 or snapshot_sha256,
            )
        )
        return "sha256:" + hashlib.sha256(material.encode()).hexdigest()

    def test_publication_passes_real_validator_and_only_adds_eligible_material(self):
        text = (
            "The amber dial points north.\n"
            "The silver gauge reads ten units.\n"
            "The silver gauge reads twenty units.\n"
            "The pattern may suggest a seasonal change.\n"
        )
        _, propositions = self.ingest(
            text,
            [
                {
                    "statement": "The amber dial points north.",
                    "quote": "The amber dial points north.",
                    "kind": "supported_proposition",
                    "type": "concept",
                    "source_ref": "model-invented-locator",
                },
                {
                    "statement": "The silver gauge reads ten units.",
                    "quote": "The silver gauge reads ten units.",
                    "kind": "supported_proposition",
                    "type": "number",
                },
                {
                    "statement": "The silver gauge reads twenty units.",
                    "quote": "The silver gauge reads twenty units.",
                    "kind": "supported_proposition",
                    "type": "number",
                },
                {
                    "statement": "The observations may indicate a seasonal change.",
                    "quote": "The pattern may suggest a seasonal change.",
                    "kind": "interpretation",
                    "type": "concept",
                },
            ],
        )
        reviewed = {item["id"]: self.approve(item) for item in propositions}
        eligible, conflict_left, conflict_right, interpretation = propositions
        relation = self.workshop.add_relation(
            conflict_left["id"],
            conflict_right["id"],
            "contradicts",
            "confirmed",
            "both readings remain unresolved",
            "fixture-reviewer",
        )
        note = self.workshop.add_note(
            "node.neutral",
            "Remember to compare the dial before and after calibration.",
            {"creator": "Fixture Author", "layer_id": "personal"},
        )
        self.workshop.review_note(
            note["id"], "approved", "fixture-reviewer", "retain as a personal note"
        )

        result = publish(self.workshop, "fixture-publisher", self.base_pack_path)
        outline, pack, directory = self.publication_files(result)

        self.assertEqual(pack["facts"][: len(self.base_pack["facts"])], self.base_pack["facts"])
        self.assertEqual(
            pack["encounters"][: len(self.base_pack["encounters"])],
            self.base_pack["encounters"],
        )
        self.assertEqual(len(pack["facts"]), len(self.base_pack["facts"]) + 1)
        self.assertEqual(len(pack["encounters"]), len(self.base_pack["encounters"]) + 1)
        self.assertEqual(pack["facts"][-1]["id"], "workshop." + eligible["id"])
        self.assertEqual(pack["facts"][-1]["source_ref"]["loc"], "chapter-neutral")
        self.assertEqual(pack["facts"][-1]["as_of"], "2026-08-31")
        self.assertEqual(pack["encounters"][-1]["id"], "workshop." + eligible["id"] + ".recall")

        excluded_ids = {
            "workshop." + conflict_left["id"],
            "workshop." + conflict_right["id"],
            "workshop." + interpretation["id"],
        }
        self.assertTrue(excluded_ids.isdisjoint({fact["id"] for fact in pack["facts"]}))
        self.assertNotIn(note["text"], json.dumps(pack))
        self.assertEqual({item["id"] for item in outline["propositions"]}, set(reviewed))
        self.assertEqual(outline["notes"][0]["id"], note["id"])
        published_relation = next(item for item in outline["relations"] if item["id"] == relation["id"])
        self.assertEqual(
            {key: published_relation[key] for key in relation},
            relation,
        )
        self.assertEqual(published_relation["from_summary"]["review"], reviewed[conflict_left["id"]]["review"])
        self.assertEqual(published_relation["to_summary"]["review"], reviewed[conflict_right["id"]]["review"])
        for item in outline["propositions"]:
            self.assertEqual(item["review"], reviewed[item["id"]]["review"])
        self.assertEqual((directory / "pack-validation.txt").read_text().splitlines()[-1], "All pack checks passed.")
        self.assertEqual(self.history_path.read_bytes(), self.history_before)

    def test_publication_rejects_snapshot_and_evidence_tampering_by_checksum(self):
        original = "The amber dial points north.\n"
        _, propositions = self.ingest(
            original,
            [{"statement": "The dial points north.", "quote": original.strip()}],
        )
        self.approve(propositions[0])
        tampered_quote = "The altered dial points south."

        def tamper(state: dict) -> None:
            version = state["sources"][0]["versions"][0]
            version["snapshot_text"] = tampered_quote + "\n"
            evidence = state["propositions"][0]["evidence"][0]
            evidence["quote"] = tampered_quote
            evidence["locator"].update(
                {"char_start": 0, "char_end": len(tampered_quote), "line_start": 1, "line_end": 1}
            )

        self.workshop.transaction(tamper)
        before = self.workshop.snapshot()
        with self.assertRaisesRegex(ValueError, "checksum|digest|hash|source version"):
            publish(self.workshop, "fixture-publisher", self.base_pack_path)
        self.assertEqual(self.workshop.snapshot(), before)
        self.assertEqual(self.history_path.read_bytes(), self.history_before)

    def test_publication_rejects_original_container_identity_tampering(self):
        original = "The amber dial points north.\n"
        _, propositions = self.ingest(
            original,
            [{"statement": "The dial points north.", "quote": original.strip()}],
        )
        self.approve(propositions[0])

        def tamper(state: dict) -> None:
            state["sources"][0]["versions"][0]["original_sha256"] = "0" * 64

        self.workshop.transaction(tamper)
        before = self.workshop.snapshot()
        with self.assertRaisesRegex(ValueError, "checksum|digest|hash|source version"):
            publish(self.workshop, "fixture-publisher", self.base_pack_path)
        self.assertEqual(self.workshop.snapshot(), before)
        self.assertEqual(self.history_path.read_bytes(), self.history_before)

    def test_new_source_version_keeps_ids_reviews_and_prior_publication_entries_stable(self):
        first_text = "The copper bridge opens at dawn.\n"
        first_import, first_props = self.ingest(
            first_text,
            [{"statement": "The bridge opens at dawn.", "quote": first_text.strip()}],
        )
        approved = self.approve(first_props[0], "first edition checked")
        first_result = publish(self.workshop, "fixture-publisher", self.base_pack_path)
        _, first_pack, _ = self.publication_files(first_result)
        first_fact = deepcopy(first_pack["facts"][-1])
        first_encounter = deepcopy(first_pack["encounters"][-1])

        expanded_text = first_text + "The glass gate closes at dusk.\n"
        second_import, second_props = self.ingest(
            expanded_text,
            [
                {"statement": "The bridge opens at dawn.", "quote": first_text.strip()},
                {"statement": "The glass gate closes at dusk.", "quote": "The glass gate closes at dusk."},
            ],
        )
        stable, added = second_props
        self.assertEqual(second_import["source"]["id"], first_import["source"]["id"])
        self.assertEqual(len(second_import["source"]["versions"]), 2)
        self.assertEqual(
            {version["id"] for version in second_import["source"]["versions"]},
            {
                self.version_id(first_text),
                self.version_id(expanded_text),
            },
        )
        self.assertEqual(
            {version["sha256"] for version in second_import["source"]["versions"]},
            {
                hashlib.sha256(first_text.encode()).hexdigest(),
                hashlib.sha256(expanded_text.encode()).hexdigest(),
            },
        )
        self.assertEqual(
            {version["original_sha256"] for version in second_import["source"]["versions"]},
            {
                hashlib.sha256(first_text.encode()).hexdigest(),
                hashlib.sha256(expanded_text.encode()).hexdigest(),
            },
        )
        self.assertTrue(
            all(
                version["source_ref"] == "chapter-neutral"
                for version in second_import["source"]["versions"]
            )
        )
        self.assertTrue(
            all(
                version["as_of"] == "2026-08-31"
                for version in second_import["source"]["versions"]
            )
        )
        self.assertEqual(stable["id"], first_props[0]["id"])
        self.assertEqual(stable["review"], approved["review"])
        self.assertEqual(len(stable["evidence"]), 2)
        self.approve(added, "expanded edition checked")

        duplicate = self.workshop.import_prepared(self.prepared(expanded_text))
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["job"]["id"], second_import["job"]["id"])
        self.assertEqual(
            [version["id"] for version in duplicate["source"]["versions"]],
            [version["id"] for version in second_import["source"]["versions"]],
        )

        second_result = publish(self.workshop, "fixture-publisher", self.base_pack_path)
        _, second_pack, second_directory = self.publication_files(second_result)
        first_fact_id = "workshop." + stable["id"]
        first_encounter_id = first_fact_id + ".recall"
        second_fact = next(f for f in second_pack["facts"] if f["id"] == first_fact_id)
        # The portable source path is rooted in each publication directory; the
        # fact identity and all source semantics remain stable across revisions.
        self.assertEqual(
            {**second_fact, "source_ref": {**second_fact["source_ref"], "file": "<publication>"}},
            {**first_fact, "source_ref": {**first_fact["source_ref"], "file": "<publication>"}},
        )
        self.assertEqual(
            next(e for e in second_pack["encounters"] if e["id"] == first_encounter_id),
            first_encounter,
        )
        self.assertIn("workshop." + added["id"], {fact["id"] for fact in second_pack["facts"]})
        self.assertEqual((second_directory / "pack-validation.txt").read_text().splitlines()[-1], "All pack checks passed.")
        self.assertEqual(self.history_path.read_bytes(), self.history_before)
        self.assertEqual(self.source_path.read_text(), expanded_text)

    def test_source_metadata_changes_mint_immutable_publications_and_use_truthful_dates(self):
        text = "The copper bridge opens at dawn.\n"
        imported, propositions = self.ingest(
            text,
            [{"statement": "The bridge opens at dawn.", "quote": text.strip()}],
        )
        self.approve(propositions[0])

        def clear_source_date(state: dict) -> None:
            version = state["sources"][0]["versions"][0]
            version["as_of"] = None
            version["derivation"] = None

        self.workshop.transaction(clear_source_date)
        first = publish(self.workshop, "fixture-publisher", self.base_pack_path)
        first_outline, first_pack, first_directory = self.publication_files(first)
        first_fact = first_pack["facts"][-1]
        import_date = imported["source"]["versions"][0]["imported_at"][:10]
        self.assertEqual(first_fact["as_of"], import_date)
        self.assertIn("Source date: unknown", first_fact["detail"])
        self.assertIn(f"falls back to import date {import_date}", first_fact["detail"])
        first_bytes = {
            "outline": (first_directory / "outline.json").read_bytes(),
            "pack": (first_directory / "pack.json").read_bytes(),
        }

        mutations = [
            ("as_of", "2026-08-15"),
            ("currency", {"status": "historical", "note": "later status review"}),
            ("derivation", {"method": "recovered original metadata"}),
        ]
        publication_ids = [first["publication"]["id"]]
        latest = first
        for key, value in mutations:
            def update_metadata(state: dict, key=key, value=value) -> None:
                state["sources"][0]["versions"][0][key] = deepcopy(value)

            self.workshop.transaction(update_metadata)
            latest = publish(self.workshop, "fixture-publisher", self.base_pack_path)
            self.assertFalse(latest["duplicate"])
            publication_ids.append(latest["publication"]["id"])

        self.assertEqual(len(set(publication_ids)), len(publication_ids))
        self.assertEqual((first_directory / "outline.json").read_bytes(), first_bytes["outline"])
        self.assertEqual((first_directory / "pack.json").read_bytes(), first_bytes["pack"])
        latest_outline, latest_pack, _ = self.publication_files(latest)
        latest_fact = next(
            fact for fact in latest_pack["facts"] if fact["id"] == "workshop." + propositions[0]["id"]
        )
        self.assertEqual(latest_fact["as_of"], "2026-08-15")
        self.assertIn("records the source date supplied with this snapshot", latest_fact["detail"])
        self.assertNotIn("records this source snapshot's import date", latest_fact["detail"])
        version = latest_outline["sources"][0]["versions"][0]
        self.assertEqual(version["currency"], mutations[1][1])
        self.assertEqual(version["derivation"], mutations[2][1])

    def test_confirmed_supersession_preserves_old_ids_and_retires_old_fact(self):
        text = "The copper bridge opens at dawn.\nThe copper bridge opens at noon.\n"
        _, propositions = self.ingest(
            text,
            [
                {"statement": "The bridge opens at dawn.", "quote": "The copper bridge opens at dawn."},
                {"statement": "The bridge opens at noon.", "quote": "The copper bridge opens at noon."},
            ],
        )
        old, new = propositions
        self.approve(old, "original schedule checked")
        first = publish(self.workshop, "fixture-publisher", self.base_pack_path)
        _, first_pack, first_directory = self.publication_files(first)
        first_pack_bytes = (first_directory / "pack.json").read_bytes()
        old_fact_id = "workshop." + old["id"]
        old_encounter_id = old_fact_id + ".recall"

        self.approve(new, "replacement schedule checked")
        self.workshop.add_relation(
            new["id"], old["id"], "supersedes", "confirmed",
            "the noon schedule replaces the dawn schedule", "fixture-reviewer",
        )
        second = publish(self.workshop, "fixture-publisher", self.base_pack_path)
        _, second_pack, second_directory = self.publication_files(second)
        new_fact_id = "workshop." + new["id"]
        facts = {fact["id"]: fact for fact in second_pack["facts"]}
        encounters = {encounter["id"]: encounter for encounter in second_pack["encounters"]}

        self.assertIn(old_fact_id, facts)
        self.assertIn(old_encounter_id, encounters)
        self.assertEqual(facts[old_fact_id]["superseded_by"], new_fact_id)
        self.assertEqual(facts[new_fact_id]["supersedes"], old_fact_id)
        self.assertEqual(second["publication"]["game_proposition_ids"], [new["id"]])
        self.assertEqual((first_directory / "pack.json").read_bytes(), first_pack_bytes)
        self.assertEqual((second_directory / "pack-validation.txt").read_text().splitlines()[-1], "All pack checks passed.")
        self.assertEqual(self.history_path.read_bytes(), self.history_before)

    def test_pending_supersession_excludes_both_and_confirmation_allows_successor(self):
        text = "The amber dial points north.\nThe amber indicator points north.\n"
        _, propositions = self.ingest(
            text,
            [
                {"statement": "The dial points north.", "quote": "The amber dial points north."},
                {"statement": "The indicator points north.", "quote": "The amber indicator points north."},
            ],
        )
        old, successor = propositions
        self.approve(old)
        self.approve(successor)
        self.workshop.add_relation(
            successor["id"], old["id"], "supersedes", "proposed",
            "replacement requires review", "fixture-reviewer",
        )
        self.assertEqual(preview(self.workshop)["game_proposition_ids"], [])

        self.workshop.add_relation(
            successor["id"], old["id"], "supersedes", "confirmed",
            "replacement confirmed", "fixture-reviewer",
        )
        self.assertEqual(preview(self.workshop)["game_proposition_ids"], [successor["id"]])

    def test_relation_summary_keeps_unapproved_endpoint_out_of_proposition_list(self):
        text = "The amber dial points north.\nThe amber indicator points north.\n"
        _, propositions = self.ingest(
            text,
            [
                {"statement": "The dial points north.", "quote": "The amber dial points north."},
                {"statement": "The indicator points north.", "quote": "The amber indicator points north."},
            ],
        )
        duplicate, canonical = propositions
        rejected = self.workshop.review_proposition(
            duplicate["id"], "rejected", "fixture-reviewer",
            "duplicate wording is not canonical", method="human",
        )
        approved = self.approve(canonical)
        relation = self.workshop.add_relation(
            duplicate["id"], canonical["id"], "duplicate_of", "confirmed",
            "canonical wording selected", "fixture-reviewer",
        )

        result = publish(self.workshop, "fixture-publisher", self.base_pack_path)
        outline, _, _ = self.publication_files(result)
        self.assertEqual([item["id"] for item in outline["propositions"]], [canonical["id"]])
        published_relation = outline["relations"][0]
        self.assertEqual(published_relation["id"], relation["id"])
        self.assertEqual(
            published_relation["from_summary"],
            {
                "id": duplicate["id"],
                "node_id": duplicate["node_id"],
                "statement": duplicate["statement"],
                "review": rejected["review"],
            },
        )
        self.assertEqual(published_relation["to_summary"]["review"], approved["review"])

    def test_previously_published_duplicate_stays_blocked_without_retirement_contract(self):
        text = "The amber dial points north.\nThe amber indicator points north.\n"
        _, propositions = self.ingest(
            text,
            [
                {"statement": "The dial points north.", "quote": "The amber dial points north."},
                {"statement": "The indicator points north.", "quote": "The amber indicator points north."},
            ],
        )
        duplicate, canonical = propositions
        self.approve(duplicate)
        first = publish(self.workshop, "fixture-publisher", self.base_pack_path)
        _, _, first_directory = self.publication_files(first)
        first_pack_bytes = (first_directory / "pack.json").read_bytes()

        self.approve(canonical)
        self.workshop.add_relation(
            duplicate["id"], canonical["id"], "duplicate_of", "confirmed",
            "canonical wording selected", "fixture-reviewer",
        )
        self.assertEqual(preview(self.workshop)["game_proposition_ids"], [canonical["id"]])
        with self.assertRaisesRegex(ValueError, "no duplicate-retirement metadata"):
            publish(self.workshop, "fixture-publisher", self.base_pack_path)
        self.assertEqual((first_directory / "pack.json").read_bytes(), first_pack_bytes)
        self.assertEqual(self.history_path.read_bytes(), self.history_before)

    def test_portable_export_revalidates_rewritten_pack_without_mutating_publication(self):
        text = "The amber dial points north.\n"
        _, propositions = self.ingest(
            text,
            [{"statement": "The dial points north.", "quote": text.strip()}],
        )
        self.approve(propositions[0])
        result = publish(self.workshop, "fixture-publisher", self.base_pack_path)
        _, published_pack, publication_directory = self.publication_files(result)
        original_pack_bytes = (publication_directory / "pack.json").read_bytes()
        destination = self.root / "derived-export"

        exported = export_current(self.workshop, destination)
        exported_pack = json.loads((exported / "pack.json").read_text())
        exported_fact = next(
            fact for fact in exported_pack["facts"] if fact["id"] == "workshop." + propositions[0]["id"]
        )
        exported_source = Path(exported_fact["source_ref"]["file"])
        if not exported_source.is_absolute():
            exported_source = self.root / exported_source

        self.assertTrue(exported_source.is_file())
        self.assertEqual((exported / "pack-validation.txt").read_text().splitlines()[-1], "All pack checks passed.")
        self.assertEqual((publication_directory / "pack.json").read_bytes(), original_pack_bytes)
        self.assertEqual(
            exported_pack["facts"][: len(self.base_pack["facts"])],
            published_pack["facts"][: len(self.base_pack["facts"])],
        )
        self.assertEqual(self.history_path.read_bytes(), self.history_before)


if __name__ == "__main__":
    unittest.main()
