from __future__ import annotations

from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from workshop import llm, sources
from workshop.store import Workshop


def write_lecture_fixture(root: Path) -> dict[str, object]:
    """Create a private-source-shaped canon using only neutral temporary text."""
    clip_id = "lect_fixture_seg-001_node.lecture"
    node_id = "node.lecture"
    corrected_relative = "output/Class_Fixture/transcript.corrected.json"
    processed = root / "private-processed"
    corrected = processed / corrected_relative
    corrected.parent.mkdir(parents=True)
    transcript = {
        "segments": [
            {
                "id": "seg-001",
                "start": 12.5,
                "end": 15.0,
                "text": "The violet dial",
                "review_status": "approved",
            },
            {
                "id": "seg-002",
                "start": 15.0,
                "end": 18.25,
                "text": "points east.",
                "review_status": "approved",
            },
        ]
    }
    corrected_bytes = json.dumps(transcript, sort_keys=True).encode("utf-8")
    corrected.write_bytes(corrected_bytes)
    original_sha256 = hashlib.sha256(corrected_bytes).hexdigest()

    lecture_dir = root / "secreg/layers/lecture"
    lecture_dir.mkdir(parents=True)
    clip = {
        "id": clip_id,
        "class_id": "fixture-class",
        "class_label": "Fixture Class",
        "stamp": "00:12–00:18",
        "date": "2026-01-02",
        "media": "Fixture Class.mp4",
        "seg_ids": ["seg-001", "seg-002"],
        "t_start": 12.5,
        "t_end": 18.25,
        "quote": "The violet dial points east.",
    }
    (lecture_dir / "clips.json").write_text(
        json.dumps({node_id: [clip]}, indent=2) + "\n", encoding="utf-8"
    )
    manifest = {
        "root": str(processed),
        "classes": [
            {
                "class_id": "fixture-class",
                "files": {"corrected_json": corrected_relative},
                "sha256_corrected_json": original_sha256,
            }
        ],
    }
    (lecture_dir / "canon-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return {
        "clip_id": clip_id,
        "node_id": node_id,
        "processed": processed,
        "corrected": corrected,
        "original_sha256": original_sha256,
        "text": "The violet dial points east.",
        "quote": clip["quote"],
    }


class WorkshopLLMReceiptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_fenced_json_result_is_parsed_and_receipted(self):
        envelope = {
            "result": (
                "```json\n"
                '{"propositions":[{"statement":"A dial points east.",'
                '"quote":"The dial points east.","detail":"A {nested} detail."}]}\n'
                "```"
            ),
            "session_id": "fixture-session",
            "modelUsage": {"fixture-model": {"inputTokens": 4}},
        }
        completed = subprocess.CompletedProcess(
            args=["fixture-cli"], returncode=0, stdout=json.dumps(envelope), stderr=""
        )
        receipt_dir = self.root / "attempt-1" / "draft"
        with patch.dict(os.environ, {"WORKSHOP_CLAUDE_BIN": "/fixture/subscription-cli"}), patch(
            "workshop.llm.subprocess.run", return_value=completed
        ) as run:
            candidates = llm._invoke("The dial points east.", "node.fixture", receipt_dir)

        self.assertEqual(candidates[0]["detail"], "A {nested} detail.")
        receipt = json.loads((receipt_dir / "receipt.json").read_text())
        self.assertEqual(receipt["status"], "completed")
        self.assertEqual(receipt["exit_code"], 0)
        self.assertEqual(receipt["candidate_count"], 1)
        self.assertEqual(receipt["session_id"], "fixture-session")
        self.assertEqual(json.loads((receipt_dir / "candidates.json").read_text()), candidates)
        self.assertEqual(run.call_args.kwargs["input"], (receipt_dir / "prompt.txt").read_text())

    def test_validated_exact_prompt_reuses_stdout_without_mutating_receipt(self):
        prompt = "Assess only this fixed fixture prompt."
        envelope = {"result": "```json\n{\"judgments\":[]}\n```", "modelUsage": {}}
        completed = subprocess.CompletedProcess(
            args=["fixture-cli"], returncode=0, stdout=json.dumps(envelope), stderr=""
        )
        old_dir = self.root / "attempt-old" / "assessment"
        with patch.dict(os.environ, {"WORKSHOP_CLAUDE_BIN": "/fixture/subscription-cli"}), patch(
            "workshop.llm.subprocess.run", return_value=completed
        ):
            self.assertEqual(
                llm._invoke(
                    "fixture text",
                    "node.fixture",
                    old_dir,
                    prompt,
                    result_validator=lambda parsed: None,
                ),
                {"judgments": []},
            )

        old_files = {path.name: path.read_bytes() for path in old_dir.iterdir() if path.is_file()}

        new_dir = self.root / "attempt-new" / "assessment"
        with patch.dict(os.environ, {"WORKSHOP_CLAUDE_BIN": "/fixture/subscription-cli"}), patch(
            "workshop.llm.subprocess.run", side_effect=AssertionError("CLI must not run on reuse")
        ) as run:
            parsed = llm._invoke(
                "fixture text",
                "node.fixture",
                new_dir,
                prompt,
                result_validator=lambda value: None,
            )

        self.assertEqual(parsed, {"judgments": []})
        run.assert_not_called()
        self.assertEqual(
            old_files,
            {path.name: path.read_bytes() for path in old_dir.iterdir() if path.is_file()},
        )
        reused_receipt = json.loads((new_dir / "receipt.json").read_text())
        self.assertEqual(reused_receipt["status"], "completed")
        self.assertTrue(reused_receipt["cache_validated"])
        self.assertEqual(reused_receipt["reused_from"], str(old_dir))
        self.assertEqual((new_dir / "stdout.json").read_bytes(), old_files["stdout.json"])

    def test_invalid_cli_result_fails_and_retains_inspectable_output(self):
        raw_result = "No structured result was returned."
        completed = subprocess.CompletedProcess(
            args=["fixture-cli"],
            returncode=0,
            stdout=json.dumps({"result": raw_result}),
            stderr="",
        )
        receipt_dir = self.root / "attempt-invalid" / "draft"
        with patch.dict(os.environ, {"WORKSHOP_CLAUDE_BIN": "/fixture/subscription-cli"}), patch(
            "workshop.llm.subprocess.run", return_value=completed
        ):
            with self.assertRaisesRegex(ValueError, "no JSON object"):
                llm._invoke("fixture text", "node.fixture", receipt_dir)

        receipt = json.loads((receipt_dir / "receipt.json").read_text())
        self.assertEqual(receipt["status"], "failed")
        self.assertEqual(receipt["exit_code"], 0)
        self.assertIn("no JSON object", receipt["error"])
        self.assertEqual((receipt_dir / "result.txt").read_text(), raw_result)
        self.assertFalse((receipt_dir / "candidates.json").exists())

        retry_envelope = {
            "result": '{"propositions":[{"statement":"A dial points east.","quote":"fixture text"}]}'
        }
        retry_result = subprocess.CompletedProcess(
            args=["fixture-cli"], returncode=0,
            stdout=json.dumps(retry_envelope), stderr="",
        )
        retry_dir = self.root / "attempt-valid" / "draft"
        with patch.dict(os.environ, {"WORKSHOP_CLAUDE_BIN": "/fixture/subscription-cli"}), patch(
            "workshop.llm.subprocess.run", return_value=retry_result
        ) as run:
            candidates = llm._invoke("fixture text", "node.fixture", retry_dir)
        run.assert_called_once()
        self.assertEqual(candidates[0]["statement"], "A dial points east.")
        self.assertNotIn("reused_from", json.loads((retry_dir / "receipt.json").read_text()))

    def test_invalid_assessment_is_refreshed_while_valid_draft_is_reused(self):
        draft = subprocess.CompletedProcess(
            args=["fixture-cli"], returncode=0,
            stdout=json.dumps({
                "result": '{"propositions":[{"statement":"A dial points east.",'
                          '"quote":"The dial points east."}]}'
            }), stderr="",
        )
        invalid_assessment = subprocess.CompletedProcess(
            args=["fixture-cli"], returncode=0,
            stdout=json.dumps({
                "result": '{"judgments":[{"id":"candidate.99","verdict":"accept"}]}'
            }), stderr="",
        )
        old_dir = self.root / "attempt-old"
        environment = {"WORKSHOP_CLAUDE_BIN": "/fixture/subscription-cli"}
        with patch.dict(os.environ, environment), patch(
            "workshop.llm.subprocess.run", side_effect=[draft, invalid_assessment]
        ):
            with self.assertRaisesRegex(ValueError, "omitted or changed candidate IDs"):
                llm.extract("The dial points east.", "node.fixture", old_dir)

        old_assessment = json.loads((old_dir / "assessment/receipt.json").read_text())
        self.assertEqual(old_assessment["status"], "failed")
        self.assertFalse(old_assessment["cache_validated"])

        valid_assessment = subprocess.CompletedProcess(
            args=["fixture-cli"], returncode=0,
            stdout=json.dumps({
                "result": '{"judgments":[{"id":"candidate.0","verdict":"accept"}]}'
            }), stderr="",
        )
        retry_dir = self.root / "attempt-retry"
        with patch.dict(os.environ, environment), patch(
            "workshop.llm.subprocess.run", return_value=valid_assessment
        ) as run:
            candidates = llm.extract("The dial points east.", "node.fixture", retry_dir)

        run.assert_called_once()
        self.assertEqual(candidates[0]["semantic_assessment"]["verdict"], "accept")
        retry_draft = json.loads((retry_dir / "draft/receipt.json").read_text())
        retry_assessment = json.loads((retry_dir / "assessment/receipt.json").read_text())
        self.assertEqual(retry_draft["reused_from"], str(old_dir / "draft"))
        self.assertNotIn("reused_from", retry_assessment)
        self.assertTrue(retry_assessment["cache_validated"])

    def test_changed_model_invalidates_draft_and_assessment_cache(self):
        def draft_result():
            return subprocess.CompletedProcess(
                args=["fixture-cli"], returncode=0,
                stdout=json.dumps({
                    "result": '{"propositions":[{"statement":"A dial points east.",'
                              '"quote":"The dial points east."}]}'
                }), stderr="",
            )

        def assessment_result():
            return subprocess.CompletedProcess(
                args=["fixture-cli"], returncode=0,
                stdout=json.dumps({
                    "result": '{"judgments":[{"id":"candidate.0","verdict":"accept"}]}'
                }), stderr="",
            )

        first_dir = self.root / "attempt-model-a"
        with patch.dict(os.environ, {
            "WORKSHOP_CLAUDE_BIN": "/fixture/subscription-cli", "WORKSHOP_MODEL": "model-a"
        }), patch("workshop.llm.subprocess.run", side_effect=[draft_result(), assessment_result()]):
            llm.extract("The dial points east.", "node.fixture", first_dir)

        second_dir = self.root / "attempt-model-b"
        with patch.dict(os.environ, {
            "WORKSHOP_CLAUDE_BIN": "/fixture/subscription-cli", "WORKSHOP_MODEL": "model-b"
        }), patch(
            "workshop.llm.subprocess.run", side_effect=[draft_result(), assessment_result()]
        ) as run:
            llm.extract("The dial points east.", "node.fixture", second_dir)

        self.assertEqual(run.call_count, 2)
        self.assertNotIn(
            "reused_from", json.loads((second_dir / "draft/receipt.json").read_text())
        )
        self.assertNotIn(
            "reused_from", json.loads((second_dir / "assessment/receipt.json").read_text())
        )


class WorkshopSourceAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_corpus_metadata_and_original_container_hash_flow_into_version_identity(self):
        pipeline_dir = self.root / "secreg/pipelines"
        nodes_dir = self.root / "secreg/atlas/nodes"
        pipeline_dir.mkdir(parents=True)
        nodes_dir.mkdir(parents=True)
        repository_root = Path(__file__).resolve().parents[2]
        shutil.copyfile(repository_root / "secreg/pipelines/corpuslib.py", pipeline_dir / "corpuslib.py")

        extracted_text = "(1) The violet dial points east."
        (nodes_dir / "node.fixture.yml").write_text(
            "\n".join(
                [
                    "id: node.fixture",
                    "kind: provision",
                    "title: Violet Dial",
                    "cite: Fixture section 1",
                    "controlling_text:",
                    "  source: corpus.json#s-fixture/(a)(1)",
                    f"  verbatim: {extracted_text}",
                    "  confidence: verbatim",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        metadata = {"usc_generated": "2026-01-03", "fixture_edition": "v7"}
        corpus_data = {
            "source": metadata,
            "acts": [
                {
                    "sections": [
                        {
                            "id": "s-fixture",
                            "content": [
                                {
                                    "num": "a",
                                    "children": [
                                        {"num": "1", "text": "The violet dial points east."}
                                    ],
                                }
                            ],
                        }
                    ]
                }
            ],
        }
        corpus_path = self.root / "corpus.json"
        corpus_bytes = (json.dumps(corpus_data, sort_keys=True) + "\n").encode("utf-8")
        corpus_path.write_bytes(corpus_bytes)
        original_digest = hashlib.sha256(corpus_bytes).hexdigest()

        with patch.dict(os.environ, {"WORKSHOP_CORPUS": str(corpus_path)}):
            prepared = sources.prepare(self.root, {"catalog_key": "atlas:node.fixture"})

        self.assertEqual(prepared["text"], extracted_text)
        self.assertEqual(prepared["original_sha256"], original_digest)
        self.assertEqual(prepared["derivation"]["original_sha256"], original_digest)
        self.assertEqual(prepared["derivation"]["corpus_source_metadata"], metadata)
        self.assertEqual(prepared["as_of"], metadata["usc_generated"])

        imported = Workshop(self.root, self.root / ".workshop-test").import_prepared(prepared)
        version = imported["source"]["versions"][0]
        selection_digest = hashlib.sha256(extracted_text.encode("utf-8")).hexdigest()
        identity_material = "\0".join(
            ("workshop-source-version-v1", selection_digest, original_digest)
        )
        expected_version = "sha256:" + hashlib.sha256(identity_material.encode("utf-8")).hexdigest()
        self.assertEqual(version["sha256"], selection_digest)
        self.assertEqual(version["original_sha256"], original_digest)
        self.assertEqual(version["id"], expected_version)
        self.assertEqual(imported["job"]["source_version"], expected_version)

    def test_lecture_selection_is_local_receipted_and_timestamp_checked(self):
        fixture = write_lecture_fixture(self.root)
        prepared = sources.prepare(
            self.root, {"catalog_key": f"lecture:{fixture['clip_id']}"}
        )
        self.assertEqual(prepared["text"], fixture["text"])
        self.assertEqual(prepared["original_sha256"], fixture["original_sha256"])
        self.assertEqual(prepared["locator"]["segment_ids"], ["seg-001", "seg-002"])
        self.assertEqual(prepared["locator"]["t_start"], 12.5)
        self.assertEqual(prepared["locator"]["t_end"], 18.25)
        self.assertFalse(prepared["crate_eligible"])

        receipt_dir = self.root / "receipts" / "lecture-attempt"
        candidates = sources.extract_local_lecture(
            self.root,
            fixture["clip_id"],
            prepared["text"],
            fixture["node_id"],
            receipt_dir,
        )
        receipt = json.loads((receipt_dir / "receipt.json").read_text())
        self.assertEqual(receipt["backend"], "local-canon-clip")
        self.assertFalse(receipt["network_used"])
        self.assertEqual(receipt["clip_id"], fixture["clip_id"])
        self.assertEqual(receipt["original_sha256"], fixture["original_sha256"])
        self.assertEqual(
            receipt["input_sha256"], hashlib.sha256(prepared["text"].encode()).hexdigest()
        )
        self.assertIsNotNone(datetime.fromisoformat(receipt["completed_at"]).tzinfo)
        self.assertEqual(candidates[0]["quote"], fixture["quote"])
        self.assertEqual(
            candidates[0]["semantic_assessment"]["method"],
            "local deterministic canon-clip reuse",
        )

        clips_path = self.root / "secreg/layers/lecture/clips.json"
        clips = json.loads(clips_path.read_text())
        clips[fixture["node_id"]][0]["t_end"] = 19.0
        clips_path.write_text(json.dumps(clips, indent=2) + "\n")
        with self.assertRaisesRegex(ValueError, "timestamps differ"):
            sources.prepare(self.root, {"catalog_key": f"lecture:{fixture['clip_id']}"})


if __name__ == "__main__":
    unittest.main()
