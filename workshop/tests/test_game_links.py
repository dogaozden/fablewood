from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from workshop import game_links
from workshop.publish import publish, preview, export_current
from workshop.tests import test_publication as fixtures


class GameLinkTests(unittest.TestCase):
    setUp = fixtures.WorkshopPublicationTests.setUp
    tearDown = fixtures.WorkshopPublicationTests.tearDown
    prepared = fixtures.WorkshopPublicationTests.prepared
    ingest = fixtures.WorkshopPublicationTests.ingest
    approve = fixtures.WorkshopPublicationTests.approve
    publication_files = staticmethod(fixtures.WorkshopPublicationTests.publication_files)

    def setup_match(self):
        text = "The copper bridge opens at dawn.\n"
        _, props = self.ingest(text, [{"statement": text.strip(), "quote": text.strip()}])
        prop = self.approve(props[0])
        fact = next(f for f in self.base_pack["facts"] if not any(
            f.get(k) for k in ("supersedes", "superseded_by", "duplicate_of")))
        fact["statement"] = text.strip()
        fact["source_ref"]["quote"] = text.strip()
        self.base_pack_path.write_text(json.dumps(self.base_pack))
        return prop, fact

    def review(self, prop, fact, **overrides):
        args = {"pack_id": self.base_pack["meta"]["id"], "fact_id": fact["id"],
                "fact_sha256": game_links.digest(fact), "proposition_sha256": game_links.proposition_digest(prop),
                "status": "confirmed", "by": "Fixture agent", "note": "Same scope and conditions.", "method": "agent"}
        args.update(overrides)
        return game_links.review(self.workshop, prop["id"], path=self.base_pack_path, **args)

    def test_advisory_matching_is_read_only_and_confirmed_match_reuses_existing_fact(self):
        prop, fact = self.setup_match()
        before = self.workshop._data_path.read_bytes()
        result = game_links.candidates(self.workshop, self.base_pack_path)
        self.assertTrue(any(m["fact_id"] == fact["id"] for m in result["matches"]))
        self.assertEqual(self.workshop._data_path.read_bytes(), before)
        review = self.review(prop, fact)
        before = self.workshop._data_path.read_bytes()
        self.assertEqual(self.review(prop, fact), review)
        self.assertEqual(self.workshop._data_path.read_bytes(), before)
        self.assertEqual(preview(self.workshop, self.base_pack_path)["counts"]["game_reused"], 1)
        first = publish(self.workshop, "Fixture agent", self.base_pack_path)
        outline, pack, _ = self.publication_files(first)
        self.assertEqual(pack["facts"], self.base_pack["facts"])
        self.assertEqual(pack["encounters"], self.base_pack["encounters"])
        self.assertEqual(outline["game_links"], [review])
        self.assertEqual(outline["propositions"][0]["evidence"], prop["evidence"])
        self.assertTrue(publish(self.workshop, "Fixture agent", self.base_pack_path)["duplicate"])
        self.assertEqual(self.history_path.read_bytes(), self.history_before)
        self.assertEqual(first["publication"]["game_proposition_ids"], [])
        self.workshop.review_proposition(prop["id"], "rejected", "Fixture agent", "Withdraw outline wording", method="agent")
        withdrawn = publish(self.workshop, "Fixture agent", self.base_pack_path)
        outline, pack, _ = self.publication_files(withdrawn)
        self.assertEqual(outline["propositions"], [])
        self.assertEqual(pack["facts"], self.base_pack["facts"])

    def test_existing_duplicate_retains_records_and_previous_release_bytes(self):
        prop, fact = self.setup_match()
        first = publish(self.workshop, "Fixture agent", self.base_pack_path)
        _, oldpack, directory = self.publication_files(first)
        before = {p.name: p.read_bytes() for p in directory.iterdir() if p.is_file()}
        self.review(prop, fact)
        second = publish(self.workshop, "Fixture agent", self.base_pack_path)
        _, pack, _ = self.publication_files(second)
        alias = next(f for f in pack["facts"] if f["id"] == "workshop." + prop["id"])
        self.assertEqual(alias["duplicate_of"], fact["id"])
        self.assertEqual({f["id"] for f in oldpack["facts"]}, {f["id"] for f in pack["facts"]})
        self.assertEqual(oldpack["encounters"], pack["encounters"])
        self.assertEqual(before, {p.name: p.read_bytes() for p in directory.iterdir() if p.is_file()})
        self.assertEqual(self.history_path.read_bytes(), self.history_before)

    def test_stale_target_and_claim_require_new_review_and_preserve_old_decision(self):
        prop, fact = self.setup_match()
        original = self.review(prop, fact)
        fact["statement"] += " during summer."
        self.base_pack_path.write_text(json.dumps(self.base_pack))
        with self.assertRaisesRegex(ValueError, "changed"):
            self.review(prop, fact, fact_sha256=original["fact_sha256"])
        matches = game_links.candidates(self.workshop, self.base_pack_path)["matches"]
        self.assertTrue(next(m for m in matches if m["fact_id"] == fact["id"])["stale"])
        before = self.workshop._data_path.read_bytes()
        with self.assertRaisesRegex(ValueError, "review it again"):
            publish(self.workshop, "Fixture agent", self.base_pack_path)
        self.assertEqual(before, self.workshop._data_path.read_bytes())
        self.review(prop, fact, status="dismissed", note="Season qualifier differs.")
        self.assertEqual(self.workshop.read_state(lambda s: s["audit"][-1]["prior"]), original)
        self.workshop.assign_proposition(prop["id"], "node.changed", "Fixture", "Retopic")
        with self.assertRaisesRegex(ValueError, "proposition changed"):
            self.review(prop, fact)

    def test_one_canonical_target_and_no_alias_or_supersession_target(self):
        prop, fact = self.setup_match()
        self.review(prop, fact)
        other = next(f for f in self.base_pack["facts"] if f["id"] != fact["id"] and not any(
            f.get(k) for k in ("supersedes", "superseded_by", "duplicate_of")))
        with self.assertRaisesRegex(ValueError, "Dismiss the previous"):
            self.review(prop, other)
        fact["duplicate_of"] = other["id"]
        self.base_pack_path.write_text(json.dumps(self.base_pack))
        with self.assertRaisesRegex(ValueError, "without maintenance"):
            self.review(prop, fact)

    def test_release_recurrence_preserves_cumulative_references_and_immediate_retry(self):
        self.setup_match()
        first = publish(self.workshop, "Fixture", self.base_pack_path)
        _, _, adir = self.publication_files(first)
        a_bytes = {str(p.relative_to(adir)): p.read_bytes() for p in adir.rglob("*") if p.is_file()}
        expanded = deepcopy(self.base_pack)
        extra = deepcopy(expanded["facts"][0])
        extra.update(id="fixture.extra", prereqs=[])
        for key in ("supersedes", "superseded_by", "duplicate_of"):
            extra.pop(key, None)
        expanded["facts"].append(extra)
        encounter = {"id": "fixture.extra.recall", "fact_ids": [extra["id"]], "kind": "free_recall",
                     "prompt": "Recall the extra marker.", "rubric": "Explain the marker.", "trap_notes": "Neutral fixture."}
        expanded["encounters"].append(encounter)
        self.base_pack_path.write_text(json.dumps(expanded))
        second = publish(self.workshop, "Fixture", self.base_pack_path)
        self.base_pack_path.write_text(json.dumps(self.base_pack))
        third = publish(self.workshop, "Fixture", self.base_pack_path)
        _, pack, _ = self.publication_files(third)
        self.assertEqual(first["publication"]["content_sha256"], third["publication"]["content_sha256"])
        self.assertEqual(len({r["publication"]["id"] for r in (first, second, third)}), 3)
        self.assertEqual(third["publication"]["previous_id"], second["publication"]["id"])
        self.assertIn(extra["id"], {f["id"] for f in pack["facts"]})
        self.assertIn(encounter, pack["encounters"])
        self.assertEqual(a_bytes, {str(p.relative_to(adir)): p.read_bytes() for p in adir.rglob("*") if p.is_file()})
        before = self.workshop._data_path.read_bytes()
        self.assertTrue(publish(self.workshop, "Fixture", self.base_pack_path)["duplicate"])
        self.assertEqual(before, self.workshop._data_path.read_bytes())
        for publication in self.workshop.snapshot()["publications"]:
            for name, checksum in publication["files_sha256"].items():
                self.assertEqual(hashlib.sha256((Path(publication["directory"]) / name).read_bytes()).hexdigest(), checksum)
        export_current(self.workshop, self.root / "export")

    def test_damaged_release_blocks_retry_and_export(self):
        self.setup_match()
        first = publish(self.workshop, "Fixture", self.base_pack_path)
        path = Path(first["publication"]["directory"]) / "outline.json"
        path.write_text(path.read_text() + " ")
        with self.assertRaisesRegex(ValueError, "artifact changed"):
            publish(self.workshop, "Fixture", self.base_pack_path)
        with self.assertRaisesRegex(ValueError, "artifact changed"):
            export_current(self.workshop, self.root / "export")

    def test_installed_release_is_recovered_after_ledger_commit_failure(self):
        self.setup_match()
        before = self.workshop._data_path.read_bytes()
        with patch.object(self.workshop, "_write_unlocked", side_effect=OSError("simulated ledger failure")):
            with self.assertRaisesRegex(OSError, "simulated ledger failure"):
                publish(self.workshop, "Fixture", self.base_pack_path)
        self.assertEqual(self.workshop._data_path.read_bytes(), before)
        directory = next((self.workshop.storage / "publications").glob("publication.*"))
        original = {str(p.relative_to(directory)): p.read_bytes() for p in directory.rglob("*") if p.is_file()}
        result = publish(self.workshop, "Fixture", self.base_pack_path)
        self.assertTrue(result["duplicate"])
        self.assertEqual(self.workshop.read_state(lambda s: s["audit"][-1]["action"]), "publish_recovered")
        self.assertEqual(original, {str(p.relative_to(directory)): p.read_bytes() for p in directory.rglob("*") if p.is_file()})
        self.assertEqual(len(self.workshop.snapshot()["publications"]), 1)

    def test_orphan_with_conflicting_lineage_cannot_be_adopted(self):
        self.setup_match()
        before = self.workshop._data_path.read_bytes()
        with patch.object(self.workshop, "_write_unlocked", side_effect=OSError("simulated ledger failure")):
            with self.assertRaises(OSError):
                publish(self.workshop, "Fixture", self.base_pack_path)
        directory = next((self.workshop.storage / "publications").glob("publication.*"))
        path = directory / "release.json"
        manifest = json.loads(path.read_text())
        manifest["previous_id"] = "publication.some-other-parent"
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "conflicts.*lineage"):
            publish(self.workshop, "Fixture", self.base_pack_path)
        self.assertEqual(before, self.workshop._data_path.read_bytes())
