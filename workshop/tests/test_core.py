from __future__ import annotations

import tempfile
from pathlib import Path
import unittest
from copy import deepcopy

from workshop.jobs import bounded_chunks
from workshop.store import Workshop


class WorkshopCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()
        self.workshop = Workshop(self.root, self.root / ".workshop-test")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def prepared(self, *, text: str, uri: str = "/neutral/source.txt", source_ref: str = "part-a", node: str = "node.alpha"):
        return {
            "uri": uri,
            "title": "Neutral Reference",
            "kind": "document",
            "source_ref": source_ref,
            "as_of": None,
            "attribution": {"creator": "Fixture Author", "layer_id": "fixture"},
            "authority": {"level": "unknown", "label": "Neutral fixture"},
            "text": text,
            "node_id": node,
            "locator": {"section": "Part A", "original_line_start": 40, "original_char_start": 900},
            "currency": {"status": "unverified", "note": "fixture"},
            "crate_eligible": True,
            # The original container may be larger than this selected snapshot.
            "original_sha256": "f" * 64,
            "derivation": {"method": "test fixture"},
        }

    def test_repeat_import_after_review_reuses_job_and_preserves_approval(self):
        text = "Header\nThe amber dial points north.\nFooter\n"
        imported = self.workshop.import_prepared(self.prepared(text=text))
        calls = []

        def extractor(chunk, node_id, receipt_dir):
            calls.append((chunk, node_id, receipt_dir))
            return [{"statement": "The dial points north.", "quote": "The amber dial points north."}]

        completed = self.workshop.run_job(imported["job"]["id"], extractor)
        proposition_id = completed["accepted_outputs"][0]
        reviewed = self.workshop.review_proposition(proposition_id, "approved", "reviewer", "checked")
        self.assertEqual(reviewed["confidence"]["support"], "source_supported")

        duplicate = self.workshop.import_prepared(self.prepared(text=text))
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["job"]["id"], imported["job"]["id"])
        self.workshop.run_job(imported["job"]["id"], lambda *_: self.fail("completed job re-extracted"))
        final = next(p for p in self.workshop.snapshot()["propositions"] if p["id"] == proposition_id)
        self.assertEqual(final["review"]["status"], "approved")
        self.assertEqual(len(final["evidence"]), 1)
        evidence = final["evidence"][0]
        self.assertEqual(evidence["locator"]["line_start"], 2)
        self.assertEqual(evidence["locator"]["original_line_start"], 41)
        self.assertEqual(evidence["locator"]["section"], "Part A")
        self.assertEqual(duplicate["source"]["versions"][0]["original_sha256"], "f" * 64)
        self.assertNotIn("snapshot_text", str(self.workshop.snapshot()))

    def test_new_source_version_retains_historical_evidence_and_stable_proposition(self):
        first_text = "The copper bridge opens at dawn.\n"
        first = self.workshop.import_prepared(self.prepared(text=first_text))
        first_job = self.workshop.run_job(
            first["job"]["id"],
            lambda *_: [{"statement": "The bridge opens at dawn.", "quote": first_text.strip()}],
        )
        proposition_id = first_job["accepted_outputs"][0]
        self.workshop.review_proposition(proposition_id, "approved", "reviewer", "first proof")

        second_text = "Preface\nThe copper bridge opens at dawn.\n"
        second = self.workshop.import_prepared(self.prepared(text=second_text))
        self.assertEqual(second["source"]["id"], first["source"]["id"])
        self.assertEqual(len(second["source"]["versions"]), 2)
        second_job = self.workshop.run_job(
            second["job"]["id"],
            lambda *_: [{"statement": "The bridge opens at dawn.", "quote": first_text.strip()}],
        )
        self.assertEqual(second_job["accepted_outputs"], [proposition_id])
        proposition = next(p for p in self.workshop.snapshot()["propositions"] if p["id"] == proposition_id)
        self.assertEqual(proposition["review"]["status"], "approved")
        self.assertEqual(len(proposition["evidence"]), 2)
        self.assertEqual(len({e["source_version"] for e in proposition["evidence"]}), 2)

    def test_topic_correction_keeps_identity_and_later_import_deduplicates_to_it(self):
        first_text = "The silver marker belongs in the upper tray.\n"
        first = self.workshop.import_prepared(self.prepared(text=first_text, node="node.wrong"))
        completed = self.workshop.run_job(
            first["job"]["id"],
            lambda *_: [{
                "statement": "The marker belongs in the upper tray.",
                "quote": first_text.strip(),
                "kind": "interpretation",
                "semantic_assessment": {"verdict": "faithful", "reason": "Direct paraphrase"},
            }],
        )
        proposition_id = completed["accepted_outputs"][0]
        self.workshop.review_proposition(proposition_id, "approved", "reviewer", "checked")
        evidence_before = self.workshop.get_proposition(proposition_id)["evidence"]

        reassigned = self.workshop.assign_proposition(
            proposition_id, "node.correct", "editor", "Corrected topic classification"
        )
        self.assertEqual(reassigned["id"], proposition_id)
        self.assertEqual(reassigned["kind"], "interpretation")
        self.assertEqual(reassigned["review"]["status"], "pending")
        self.assertEqual(reassigned["publication"]["status"], "draft")
        self.assertEqual(reassigned["evidence"], evidence_before)
        self.assertEqual(reassigned["confidence"]["support"], "unsupported")
        self.assertEqual(reassigned["assessments"][0]["semantic_assessment"]["verdict"], "faithful")
        self.assertEqual(reassigned["assessments"][0]["job_id"], first["job"]["id"])
        with self.assertRaisesRegex(ValueError, "non-blank"):
            self.workshop.assign_proposition(proposition_id, "  ", "editor", "bad")

        second_text = "Preface.\nThe silver marker belongs in the upper tray.\n"
        second = self.workshop.import_prepared(
            self.prepared(text=second_text, uri="/neutral/revised.txt", node="node.correct")
        )
        rerun = self.workshop.run_job(
            second["job"]["id"],
            lambda *_: [{
                "statement": "  THE marker belongs in the upper tray.  ",
                "quote": first_text.strip(),
                "semantic_assessment": {"verdict": "faithful", "reason": "Second source"},
            }],
        )
        self.assertEqual(rerun["accepted_outputs"], [proposition_id])
        final = self.workshop.get_proposition(proposition_id)
        self.assertEqual(len(final["evidence"]), 2)
        self.assertEqual(len(final["assessments"]), 2)
        self.assertEqual(final["review"]["status"], "pending")

    def test_rejected_topic_correction_requires_fresh_review_and_same_topic_is_noop(self):
        text = "The indigo marker belongs in the lower tray.\n"
        imported = self.workshop.import_prepared(self.prepared(text=text, node="node.wrong"))
        completed = self.workshop.run_job(
            imported["job"]["id"],
            lambda *_: [{"statement": "The marker belongs below.", "quote": text.strip()}],
        )
        proposition_id = completed["accepted_outputs"][0]
        rejected = self.workshop.review_proposition(
            proposition_id, "rejected", "reviewer", "wrong topic"
        )
        before_noop = self.workshop.read_state(lambda state: deepcopy(state))
        self.assertEqual(
            self.workshop.assign_proposition(
                proposition_id, "node.wrong", "editor", "same topic"
            )["review"],
            rejected["review"],
        )
        self.assertEqual(
            self.workshop.read_state(lambda state: deepcopy(state)), before_noop
        )

        reassigned = self.workshop.assign_proposition(
            proposition_id, "node.correct", "editor", "corrected rejected assignment"
        )
        self.assertEqual(reassigned["review"]["status"], "pending")
        self.assertIsNone(reassigned["review"]["by"])
        self.assertIsNone(reassigned["review"]["at"])
        self.assertEqual(reassigned["confidence"]["support"], "unsupported")

    def test_identical_proposition_and_note_review_retries_are_state_idempotent(self):
        text = "The gold dial points west.\n"
        imported = self.workshop.import_prepared(self.prepared(text=text))
        completed = self.workshop.run_job(
            imported["job"]["id"],
            lambda *_: [{"statement": "The dial points west.", "quote": text.strip()}],
        )
        proposition_id = completed["accepted_outputs"][0]
        first_proposition = self.workshop.review_proposition(
            proposition_id, "approved", "reviewer", "exact quote checked", method="human"
        )
        before_proposition_retry = self.workshop.read_state(lambda state: deepcopy(state))
        second_proposition = self.workshop.review_proposition(
            proposition_id, "approved", "reviewer", "exact quote checked", method="human"
        )
        self.assertEqual(second_proposition, first_proposition)
        self.assertEqual(
            self.workshop.read_state(lambda state: deepcopy(state)), before_proposition_retry
        )

        note = self.workshop.add_note(
            "node.alpha", "Remember the western dial.",
            {"creator": "Ada", "layer_id": "personal"},
        )
        first_note = self.workshop.review_note(
            note["id"], "approved", "Ada", "personal note checked", method="human"
        )
        before_note_retry = self.workshop.read_state(lambda state: deepcopy(state))
        second_note = self.workshop.review_note(
            note["id"], "approved", "Ada", "personal note checked", method="human"
        )
        self.assertEqual(second_note, first_note)
        self.assertEqual(self.workshop.read_state(lambda state: deepcopy(state)), before_note_retry)

    def test_note_contract_rejects_blank_or_malformed_fields(self):
        valid = {"creator": "Ada", "layer_id": "personal"}
        invalid = [
            ("", "A note.", valid, "node_id"),
            ("node.alpha", "   ", valid, "text"),
            ("node.alpha", "A note.", "Ada", "object"),
            ("node.alpha", "A note.", {"creator": " ", "layer_id": "personal"}, "creator"),
            ("node.alpha", "A note.", {"creator": "Ada", "layer_id": ""}, "layer_id"),
        ]
        for node_id, text, attribution, message in invalid:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.workshop.add_note(node_id, text, attribution)

    def test_container_revision_creates_distinct_version_for_same_selected_text(self):
        text = "The fixed selection remains identical.\n"
        first_prepared = self.prepared(text=text)
        first = self.workshop.import_prepared(first_prepared)
        repeated = self.workshop.import_prepared(first_prepared)
        self.assertTrue(repeated["duplicate"])
        self.assertEqual(repeated["job"]["id"], first["job"]["id"])
        self.assertEqual(len(repeated["source"]["versions"]), 1)

        revised_container = self.prepared(text=text)
        revised_container["original_sha256"] = "e" * 64
        revised_container["derivation"] = {"method": "same selection from revised container"}
        second = self.workshop.import_prepared(revised_container)
        self.assertFalse(second["duplicate"])
        self.assertNotEqual(second["job"]["source_version"], first["job"]["source_version"])
        self.assertEqual(len(second["source"]["versions"]), 2)
        self.assertEqual(
            {version["sha256"] for version in second["source"]["versions"]},
            {__import__("hashlib").sha256(text.encode()).hexdigest()},
        )
        self.assertEqual(
            {version["original_sha256"] for version in second["source"]["versions"]},
            {"e" * 64, "f" * 64},
        )

        first_done = self.workshop.run_job(
            first["job"]["id"],
            lambda *_: [{"statement": "The selection remains identical.", "quote": text.strip()}],
        )
        second_done = self.workshop.run_job(
            second["job"]["id"],
            lambda *_: [{"statement": "The selection remains identical.", "quote": text.strip()}],
        )
        self.assertEqual(first_done["accepted_outputs"], second_done["accepted_outputs"])
        proposition = self.workshop.get_proposition(first_done["accepted_outputs"][0])
        self.assertEqual(len(proposition["evidence"]), 2)

    def test_snapshot_checksum_mismatch_blocks_job_before_extraction(self):
        imported = self.workshop.import_prepared(self.prepared(text="Untampered snapshot.\n"))

        def tamper(state):
            state["sources"][0]["versions"][0]["snapshot_text"] = "Tampered snapshot.\n"

        self.workshop.transaction(tamper)
        with self.assertRaisesRegex(ValueError, "snapshot checksum mismatch"):
            self.workshop.run_job(
                imported["job"]["id"], lambda *_: self.fail("extractor saw tampered text")
            )
        self.assertEqual(self.workshop.get_job(imported["job"]["id"])["status"], "failed")

    def test_original_checksum_or_composite_id_corruption_is_detected_but_legacy_id_is_accepted(self):
        text = "Integrity-bound snapshot.\n"
        imported = self.workshop.import_prepared(self.prepared(text=text, source_ref="integrity-a"))

        def tamper_original(state):
            source = next(s for s in state["sources"] if s["id"] == imported["source"]["id"])
            source["versions"][0]["original_sha256"] = "0" * 64

        self.workshop.transaction(tamper_original)
        with self.assertRaisesRegex(ValueError, "provenance checksum mismatch"):
            self.workshop.run_job(imported["job"]["id"], lambda *_: [])

        second = self.workshop.import_prepared(
            self.prepared(text=text, source_ref="integrity-b", uri="/neutral/other.txt")
        )

        def tamper_id(state):
            source = next(s for s in state["sources"] if s["id"] == second["source"]["id"])
            bad_id = "sha256:" + "1" * 64
            source["versions"][0]["id"] = bad_id
            next(j for j in state["jobs"] if j["id"] == second["job"]["id"])["source_version"] = bad_id

        self.workshop.transaction(tamper_id)
        with self.assertRaisesRegex(ValueError, "provenance checksum mismatch"):
            self.workshop.run_job(second["job"]["id"], lambda *_: [])

        digest = __import__("hashlib").sha256(text.encode()).hexdigest()
        Workshop._assert_snapshot(
            {"id": "sha256:" + digest, "sha256": digest, "original_sha256": "a" * 64,
             "snapshot_text": text}
        )

    def test_duplicate_import_enriches_missing_date_and_derivation_without_losing_review(self):
        text = "The dated record remains fixed.\n"
        initial = self.prepared(text=text, source_ref="dated")
        initial["as_of"] = None
        initial["derivation"] = None
        first = self.workshop.import_prepared(initial)
        done = self.workshop.run_job(
            first["job"]["id"],
            lambda *_: [{"statement": "The record remains fixed.", "quote": text.strip()}],
        )
        proposition_id = done["accepted_outputs"][0]
        self.workshop.review_proposition(proposition_id, "approved", "reviewer", "checked")

        corrected = self.prepared(text=text, source_ref="dated")
        corrected["as_of"] = "2025-04-03"
        corrected["derivation"] = {"method": "date recovered from original publication metadata"}
        repeated = self.workshop.import_prepared(corrected)
        self.assertTrue(repeated["duplicate"])
        self.assertEqual(repeated["job"]["id"], first["job"]["id"])
        self.assertEqual(repeated["job"]["source_version"], first["job"]["source_version"])
        version = repeated["source"]["versions"][0]
        self.assertEqual(version["as_of"], "2025-04-03")
        self.assertEqual(version["derivation"], corrected["derivation"])
        self.assertEqual(self.workshop.get_proposition(proposition_id)["review"]["status"], "approved")
        audit = self.workshop.transaction(lambda state: state["audit"])
        correction = next(item for item in audit if item["action"] == "source_version_metadata_enriched")
        self.assertEqual(correction["old"], {"as_of": None, "derivation": None})
        self.assertEqual(correction["new"]["as_of"], "2025-04-03")
        self.assertEqual(correction["source_ref"], "dated")

        conflict = dict(corrected)
        conflict["as_of"] = "2025-04-04"
        with self.assertRaisesRegex(ValueError, "conflicting as_of"):
            self.workshop.import_prepared(conflict)
        preserved = self.workshop.snapshot()["sources"][0]["versions"][0]
        self.assertEqual(preserved["as_of"], "2025-04-03")

    def test_failed_job_resumes_without_repeating_completed_chunks(self):
        first_line = "A" * 5900 + " first proof.\n"
        second_line = "B" * 5900 + " second proof.\n"
        imported = self.workshop.import_prepared(self.prepared(text=first_line + second_line))
        calls = []

        def fails_second(chunk, *_):
            calls.append(chunk[-20:])
            if len(calls) == 2:
                raise RuntimeError("simulated extractor crash")
            return [{"statement": "The first proof exists.", "quote": "first proof."}]

        with self.assertRaisesRegex(RuntimeError, "simulated extractor crash"):
            self.workshop.run_job(imported["job"]["id"], fails_second)
        failed = self.workshop.get_job(imported["job"]["id"])
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["progress"]["completed"], 1)

        retried = []
        completed = self.workshop.run_job(
            imported["job"]["id"],
            lambda chunk, *_: retried.append(chunk[-20:]) or [
                {"statement": "The second proof exists.", "quote": "second proof."}
            ],
        )
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(len(retried), 1)
        self.assertIn("second proof.", retried[0])
        self.assertEqual(completed["progress"], {"completed": 2, "total": 2})

    def test_unsupported_and_ambiguous_quotes_are_quarantined_but_disambiguation_works(self):
        text = "Repeated proof.\nMiddle.\nRepeated proof.\n"
        imported = self.workshop.import_prepared(self.prepared(text=text))
        result = self.workshop.run_job(
            imported["job"]["id"],
            lambda *_: [
                {"statement": "Ambiguous candidate.", "quote": "Repeated proof."},
                {"statement": "Fabricated candidate.", "quote": "Absent proof."},
                {"statement": "Disambiguated candidate.", "quote": "Repeated proof.",
                 "locator": {"char_start": 24, "section": "model invented section"}},
            ],
        )
        propositions = {p["statement"]: p for p in self.workshop.snapshot()["propositions"]}
        self.assertEqual(propositions["Ambiguous candidate."]["evidence"][0]["status"], "ambiguous")
        self.assertEqual(propositions["Fabricated candidate."]["evidence"][0]["status"], "unsupported")
        self.assertEqual(propositions["Disambiguated candidate."]["evidence"][0]["status"], "exact")
        self.assertEqual(propositions["Disambiguated candidate."]["evidence"][0]["locator"]["section"], "Part A")
        with self.assertRaisesRegex(ValueError, "without exact evidence"):
            self.workshop.review_proposition(
                propositions["Ambiguous candidate."]["id"], "approved", "reviewer", "no"
            )
        approved = self.workshop.review_proposition(
            propositions["Disambiguated candidate."]["id"], "approved", "reviewer", "located"
        )
        self.assertEqual(approved["confidence"]["support"], "source_supported")
        self.assertEqual(set(result["accepted_outputs"]), {p["id"] for p in propositions.values()})

    def test_confirmed_contradiction_keeps_both_candidates_and_marks_contested(self):
        text = "First observation.\nSecond observation.\n"
        imported = self.workshop.import_prepared(self.prepared(text=text))
        self.workshop.run_job(
            imported["job"]["id"],
            lambda *_: [
                {
                    "statement": "The blue lantern remains lit for 10 measured days.",
                    "quote": "First observation.",
                },
                {
                    "statement": "The blue lantern remains lit for 20 measured days.",
                    "quote": "Second observation.",
                },
            ],
        )
        snapshot = self.workshop.snapshot()
        self.assertEqual(len(snapshot["propositions"]), 2)
        proposed = next(r for r in snapshot["relations"] if r["type"] == "contradicts")
        self.workshop.add_relation(
            proposed["from_id"], proposed["to_id"], "contradicts", "confirmed", "both retained", "reviewer"
        )
        final = self.workshop.snapshot()
        self.assertEqual(len(final["propositions"]), 2)
        self.assertTrue(all(p["confidence"]["support"] == "contested" for p in final["propositions"]))

    def test_notes_retain_personal_attribution_and_review_method(self):
        note = self.workshop.add_note("node.alpha", "My durable observation.", {"creator": "Ada", "layer_id": "ada"})
        reviewed = self.workshop.review_note(note["id"], "approved", "Ada", "mine", method="human")
        self.assertEqual(reviewed["attribution"], {"creator": "Ada", "layer_id": "ada"})
        self.assertEqual(reviewed["review"]["method"], "human")

    def test_storage_guards_and_hard_chunk_limit(self):
        with self.assertRaisesRegex(ValueError, "state"):
            Workshop(self.root, self.root / "state" / "workshop")
        chunks = bounded_chunks("x" * 12001, limit=6000)
        self.assertEqual([c["char_end"] - c["char_start"] for c in chunks], [6000, 6000, 1])
        unassigned = self.prepared(text="Unassigned material.\n", node="")
        self.assertEqual(self.workshop.import_prepared(unassigned)["job"]["node_id"], "")

    def test_recovery_leaves_live_runner_alone_and_interrupts_abandoned_runner(self):
        imported = self.workshop.import_prepared(self.prepared(text="One proof.\n"))
        job_id = imported["job"]["id"]

        def live(state):
            job = next(j for j in state["jobs"] if j["id"] == job_id)
            job["status"] = "running"
            job["runner_pid"] = __import__("os").getpid()

        self.workshop.transaction(live)
        second_request = Workshop(self.root, self.root / ".workshop-test")
        self.assertEqual(second_request.get_job(job_id)["status"], "running")

        def abandoned(state):
            job = next(j for j in state["jobs"] if j["id"] == job_id)
            job["runner_pid"] = 999_999_999
            job["chunks"][0]["status"] = "running"
            job["chunks"][0]["attempts"] = [{"id": "attempt.fixture", "status": "running"}]

        self.workshop.transaction(abandoned)
        recovered = Workshop(self.root, self.root / ".workshop-test")
        self.assertEqual(recovered.get_job(job_id)["status"], "interrupted")
        self.assertEqual(recovered.get_job(job_id)["chunks"][0]["attempts"][0]["status"], "interrupted")


if __name__ == "__main__":
    unittest.main()
