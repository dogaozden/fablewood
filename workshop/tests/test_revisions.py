from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from workshop.store import Workshop


class WorkshopRevisionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()
        self.workshop = Workshop(self.root, self.root / ".workshop-test")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @staticmethod
    def prepared(
        text: str,
        *,
        uri: str = "/neutral/original.txt",
        node_id: str = "node.alpha",
    ) -> dict:
        return {
            "uri": uri,
            "title": "Neutral Reference",
            "kind": "document",
            "source_ref": "part-a",
            "as_of": None,
            "attribution": {"creator": "Fixture Author", "layer_id": "fixture"},
            "authority": {"level": "unknown", "label": "Neutral fixture"},
            "text": text,
            "node_id": node_id,
            "locator": {"section": "Part A"},
            "currency": {"status": "unverified", "note": "fixture"},
            "crate_eligible": True,
            "original_sha256": "f" * 64,
            "derivation": {"method": "test fixture"},
        }

    def ingest(
        self,
        text: str,
        statement: str,
        quote: str,
        *,
        uri: str = "/neutral/original.txt",
        node_id: str = "node.alpha",
        candidate_fields: dict | None = None,
    ) -> dict:
        imported = self.workshop.import_prepared(
            self.prepared(text, uri=uri, node_id=node_id)
        )
        job = self.workshop.run_job(
            imported["job"]["id"],
            lambda *_: [
                {"statement": statement, "quote": quote, **(candidate_fields or {})}
            ],
        )
        return self.workshop.get_proposition(job["accepted_outputs"][0])

    def test_revision_keeps_approved_original_stable_and_points_new_to_original(self):
        text = "The amber gate opens after the northern bell rings.\n"
        original = self.ingest(
            text,
            "The amber gate opens at the signal.",
            text.strip(),
        )
        approved = self.workshop.review_proposition(
            original["id"], "approved", "reviewer", "checked", method="human"
        )
        original_before = deepcopy(approved)

        result = self.workshop.propose_revision(
            original["id"],
            "The amber gate opens after the northern bell rings.",
            text.strip(),
            original["evidence"][0]["id"],
            "correction-agent",
            "Adds the condition present in the source.",
            method="agent",
        )

        self.assertNotEqual(result["original_id"], result["proposed_id"])
        self.assertEqual(self.workshop.get_proposition(original["id"]), original_before)
        proposed = result["proposition"]
        self.assertEqual(proposed["node_id"], original["node_id"])
        self.assertEqual(proposed["review"]["status"], "pending")
        self.assertEqual(proposed["evidence"][0]["status"], "exact")
        self.assertEqual(proposed["provenance"]["kind"], "correction_proposal")
        self.assertEqual(proposed["provenance"]["method"], "agent")
        self.assertEqual(proposed["revision_history"][0]["by"], "correction-agent")
        self.assertEqual(proposed["revision_history"][0]["method"], "agent")
        self.assertEqual(result["relation"]["from_id"], result["proposed_id"])
        self.assertEqual(result["relation"]["to_id"], result["original_id"])
        self.assertEqual(result["relation"]["type"], "refines")
        self.assertEqual(result["relation"]["status"], "proposed")

    def test_unsupported_revision_quote_is_quarantined_and_cannot_be_approved(self):
        text = "The glass marker belongs in the upper tray.\n"
        original = self.ingest(
            text,
            "The marker belongs in a tray.",
            text.strip(),
        )
        result = self.workshop.propose_revision(
            original["id"],
            "The glass marker belongs in the lower tray.",
            "The glass marker belongs in the lower tray.",
            original["evidence"][0]["id"],
            "Ada",
            "Proposed from memory; source must decide.",
            method="human",
        )

        proposed = result["proposition"]
        self.assertEqual(proposed["evidence"][0]["status"], "unsupported")
        self.assertEqual(proposed["confidence"]["support"], "unsupported")
        self.assertEqual(
            proposed["revision_history"][0]["evidence_status"], "unsupported"
        )
        with self.assertRaisesRegex(ValueError, "without exact evidence"):
            self.workshop.review_proposition(
                proposed["id"], "approved", "reviewer", "unsupported"
            )

    def test_retry_reuses_revision_without_resetting_review_or_relation(self):
        text = "The copper bridge opens after the morning signal.\n"
        original = self.ingest(
            text,
            "The copper bridge opens in the morning.",
            text.strip(),
        )
        arguments = (
            original["id"],
            "The copper bridge opens after the morning signal.",
            text.strip(),
            original["evidence"][0]["id"],
            "editor",
            "Source states a condition.",
        )
        first = self.workshop.propose_revision(*arguments, method="agent")
        rejected = self.workshop.review_proposition(
            first["proposed_id"], "rejected", "reviewer", "wording too broad"
        )
        confirmed_relation = self.workshop.add_relation(
            first["relation"]["from_id"],
            first["relation"]["to_id"],
            "refines",
            "confirmed",
            "direction checked",
            "reviewer",
        )

        retried = self.workshop.propose_revision(*arguments, method="agent")

        self.assertTrue(retried["duplicate"])
        self.assertEqual(retried["proposed_id"], first["proposed_id"])
        self.assertEqual(retried["proposition"]["review"], rejected["review"])
        self.assertEqual(retried["relation"], confirmed_relation)
        self.assertEqual(len(retried["proposition"]["revision_history"]), 1)
        self.assertEqual(len(retried["proposition"]["evidence"]), 1)

    def test_explicit_supersedes_can_change_topic_without_changing_original(self):
        text = "A violet token is stored beside the clock.\n"
        original = self.ingest(
            text,
            "A token is stored nearby.",
            text.strip(),
        )
        result = self.workshop.propose_revision(
            original["id"],
            "A violet token is stored beside the clock.",
            text.strip(),
            original["evidence"][0]["id"],
            "Ada",
            "Correct statement and classification.",
            node_id="node.beta",
            relation_type="supersedes",
            method="human",
        )

        self.assertEqual(result["proposition"]["node_id"], "node.beta")
        self.assertEqual(result["relation"]["type"], "supersedes")
        self.assertEqual(result["relation"]["from_id"], result["proposed_id"])
        self.assertEqual(result["relation"]["to_id"], original["id"])
        self.assertEqual(self.workshop.get_proposition(original["id"])["node_id"], "node.alpha")

    def test_revision_detail_and_type_are_explicit_and_supersedes_cycle_is_blocked(self):
        text = "The violet lamp dims after the final chime.\n"
        original = self.ingest(
            text,
            "The violet lamp changes at night.",
            text.strip(),
            candidate_fields={
                "type": "rule",
                "detail": "Unsupported original inference to remove.",
            },
        )
        original_before = deepcopy(original)
        defaulted = self.workshop.propose_revision(
            original["id"],
            "The violet lamp dims after the final chime.",
            text.strip(),
            original["evidence"][0]["id"],
            "editor",
            "Remove unsupported explanation.",
            method="agent",
        )
        self.assertEqual(defaulted["proposition"]["type"], "rule")
        self.assertEqual(defaulted["proposition"]["detail"], "")
        self.assertEqual(defaulted["proposition"]["provenance"]["detail"], "")
        self.assertEqual(defaulted["proposition"]["revision_history"][0]["type"], "rule")

        with self.assertRaisesRegex(ValueError, "retry type and detail"):
            self.workshop.propose_revision(
                original["id"],
                "The violet lamp dims after the final chime.",
                text.strip(),
                original["evidence"][0]["id"],
                "editor",
                "Remove unsupported explanation.",
                method="agent",
                detail="New detail silently changing a reviewed proposal.",
            )
        with self.assertRaisesRegex(ValueError, "proposition_type is invalid"):
            self.workshop.propose_revision(
                original["id"],
                "A distinct correction.",
                text.strip(),
                original["evidence"][0]["id"],
                "editor",
                "Invalid type.",
                proposition_type="mystery",
            )

        self.workshop.add_relation(
            original["id"],
            defaulted["proposed_id"],
            "supersedes",
            "confirmed",
            "Existing direction",
            "reviewer",
        )
        with self.assertRaisesRegex(ValueError, "would create a cycle"):
            self.workshop.propose_revision(
                original["id"],
                "The violet lamp dims after the final chime.",
                text.strip(),
                original["evidence"][0]["id"],
                "editor",
                "Reverse direction",
                relation_type="supersedes",
                method="agent",
            )
        self.assertEqual(self.workshop.get_proposition(original["id"]), original_before)

    def test_cross_source_near_duplicate_is_suggested_without_merging(self):
        first = self.ingest(
            "The amber bridge opens after the northern bell rings.\n",
            "The amber bridge opens after the northern bell rings.",
            "The amber bridge opens after the northern bell rings.",
            uri="/neutral/first.txt",
        )
        second = self.ingest(
            "The amber bridge opens after the northern bell rings each dawn.\n",
            "The amber bridge opens after the northern bell rings each dawn.",
            "The amber bridge opens after the northern bell rings each dawn.",
            uri="/neutral/second.txt",
        )

        snapshot = self.workshop.snapshot()
        self.assertEqual(len(snapshot["propositions"]), 2)
        relation = next(
            item
            for item in snapshot["relations"]
            if item.get("basis") == "cross_source_lexical_similarity"
        )
        self.assertEqual(relation["type"], "duplicate_of")
        self.assertEqual(relation["status"], "proposed")
        self.assertEqual(relation["from_id"], second["id"])
        self.assertEqual(relation["to_id"], first["id"])
        self.assertIn("not a semantic conclusion", relation["note"])

    def test_exact_normalized_match_across_topics_is_suggested_conservatively(self):
        first = self.ingest(
            "The silver archive opens after the eastern chime.\n",
            "The silver archive opens after the eastern chime.",
            "The silver archive opens after the eastern chime.",
            uri="/neutral/topic-one.txt",
            node_id="node.one",
        )
        second = self.ingest(
            "Again: the silver archive opens after the eastern chime.\n",
            "  THE silver archive opens after the eastern chime.  ",
            "the silver archive opens after the eastern chime.",
            uri="/neutral/topic-two.txt",
            node_id="node.two",
        )

        relation = next(
            item
            for item in self.workshop.snapshot()["relations"]
            if item.get("basis") == "cross_topic_normalized_match"
        )
        self.assertEqual(relation["from_id"], second["id"])
        self.assertEqual(relation["to_id"], first["id"])
        self.assertEqual(relation["type"], "duplicate_of")

    def test_relation_and_note_review_audits_preserve_before_and_after(self):
        first = self.ingest("First proof.\n", "First claim.", "First proof.")
        second = self.ingest(
            "Second proof.\n",
            "Second claim.",
            "Second proof.",
            uri="/neutral/second.txt",
        )
        relation = self.workshop.add_relation(
            first["id"], second["id"], "related", "proposed", "inspect", "Ada"
        )
        self.workshop.add_relation(
            first["id"], second["id"], "related", "confirmed", "checked", "Grace"
        )
        note = self.workshop.add_note(
            "node.alpha", "Personal reminder.", {"creator": "Ada", "layer_id": "ada"}
        )
        self.workshop.review_note(note["id"], "approved", "Ada", "mine")
        self.workshop.review_note(note["id"], "rejected", "Grace", "reconsidered")

        audit = self.workshop.read_state(lambda state: deepcopy(state["audit"]))
        relation_audits = [
            item
            for item in audit
            if item["action"] == "relation_reviewed"
            and item["relation_id"] == relation["id"]
        ]
        self.assertIsNone(relation_audits[0]["prior"])
        self.assertEqual(relation_audits[1]["prior"]["status"], "proposed")
        self.assertEqual(relation_audits[1]["relation"]["status"], "confirmed")
        self.assertEqual(relation_audits[1]["by"], "Grace")
        note_audits = [
            item
            for item in audit
            if item["action"] == "note_reviewed" and item["note_id"] == note["id"]
        ]
        self.assertEqual(note_audits[1]["prior"]["status"], "approved")
        self.assertEqual(note_audits[1]["review"]["status"], "rejected")
        self.assertEqual(note_audits[1]["by"], "Grace")

    def test_identity_uri_adopts_matching_legacy_source_across_relocation(self):
        text = "The portable case record retains its cited language.\n"
        first_prepared = self.prepared(
            text,
            uri="/private/tmp/checkout-one/secreg/casebook.md",
        )
        first_prepared["source_ref"] = "case-7"
        first = self.workshop.import_prepared(first_prepared)
        completed = self.workshop.run_job(
            first["job"]["id"],
            lambda *_: [
                {
                    "statement": "The case record retains its cited language.",
                    "quote": text.strip(),
                }
            ],
        )
        proposition_id = completed["accepted_outputs"][0]
        approved = self.workshop.review_proposition(
            proposition_id, "approved", "reviewer", "checked"
        )

        relocated = self.prepared(
            text,
            uri="/private/tmp/checkout-two/secreg/casebook.md",
        )
        relocated["source_ref"] = "case-7"
        relocated["identity_uri"] = "repo:secreg/casebook.md"
        repeated = self.workshop.import_prepared(relocated)

        self.assertTrue(repeated["duplicate"])
        self.assertEqual(repeated["source"]["id"], first["source"]["id"])
        self.assertEqual(repeated["job"]["id"], first["job"]["id"])
        self.assertEqual(repeated["job"]["source_version"], first["job"]["source_version"])
        self.assertEqual(
            repeated["source"]["uri"],
            "/private/tmp/checkout-one/secreg/casebook.md",
        )
        self.assertEqual(repeated["source"]["identity_uri"], "repo:secreg/casebook.md")
        self.assertEqual(
            self.workshop.get_proposition(proposition_id)["review"], approved["review"]
        )
        third = self.workshop.import_prepared(relocated)
        self.assertTrue(third["duplicate"])
        self.assertEqual(third["source"]["id"], first["source"]["id"])
        self.assertEqual(len(self.workshop.snapshot()["sources"]), 1)

        unrelated = self.prepared(
            text,
            uri="/private/tmp/checkout-three/secreg/casebook.md",
        )
        unrelated["source_ref"] = "case-8"
        unrelated["identity_uri"] = "repo:secreg/casebook.md"
        separate = self.workshop.import_prepared(unrelated)
        self.assertNotEqual(separate["source"]["id"], first["source"]["id"])


if __name__ == "__main__":
    unittest.main()
