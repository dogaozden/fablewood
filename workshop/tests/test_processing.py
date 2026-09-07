from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import workshop.__main__ as workshop_main
import workshop.http as workshop_http
from workshop import processing, sources
from workshop.store import Workshop
from workshop.tests.test_sources_llm import write_lecture_fixture


class WorkshopProcessingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()
        self.fixture = write_lecture_fixture(self.root)
        self.prepared = sources.prepare(
            self.root, {"catalog_key": f"lecture:{self.fixture['clip_id']}"}
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def new_store(self, name: str) -> tuple[Workshop, str]:
        store = Workshop(self.root, Path(self.temporary.name) / name)
        imported = store.import_prepared(self.prepared)
        return store, imported["job"]["id"]

    def assert_local_receipt(self, store: Workshop) -> None:
        receipts = list(store.storage.rglob("receipt.json"))
        self.assertEqual(len(receipts), 1)
        receipt = json.loads(receipts[0].read_text())
        self.assertEqual(receipt["backend"], "local-canon-clip")
        self.assertFalse(receipt["network_used"])

    def test_http_start_routes_lecture_to_local_canon_without_subscription_cli(self):
        store, job_id = self.new_store("http-storage")
        real_local = processing.sources.extract_local_lecture
        with patch.object(
            processing.llm, "extract", side_effect=AssertionError("subscription extractor called")
        ) as subscription, patch.object(
            processing.sources, "extract_local_lecture", wraps=real_local
        ) as local:
            workshop_http._start(store, job_id)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and store.get_job(job_id)["status"] not in {
                "completed",
                "failed",
            }:
                time.sleep(0.01)
            job = store.get_job(job_id)

        self.assertEqual(job["status"], "completed", job.get("error"))
        subscription.assert_not_called()
        local.assert_called_once()
        self.assert_local_receipt(store)

    def test_terminal_run_job_routes_lecture_to_local_canon_without_subscription_cli(self):
        store, job_id = self.new_store("terminal-storage")
        output = io.StringIO()
        real_local = processing.sources.extract_local_lecture
        argv = [
            "workshop",
            "--root",
            str(self.root),
            "--storage",
            str(store.storage),
            "--run-job",
            job_id,
        ]
        with patch.object(sys, "argv", argv), redirect_stdout(output), patch.object(
            processing.llm, "extract", side_effect=AssertionError("subscription extractor called")
        ) as subscription, patch.object(
            processing.sources, "extract_local_lecture", wraps=real_local
        ) as local:
            workshop_main.main()

        result = json.loads(output.getvalue())
        self.assertEqual(result["status"], "completed", result.get("error"))
        subscription.assert_not_called()
        local.assert_called_once()
        self.assert_local_receipt(store)

    def test_missing_lecture_clip_fails_durably_without_falling_through(self):
        malformed = {**self.prepared, "derivation": {"method": "fixture missing clip id"}}
        store = Workshop(self.root, Path(self.temporary.name) / "malformed-storage")
        imported = store.import_prepared(malformed)
        job_id = imported["job"]["id"]
        with patch.object(
            processing.llm, "extract", side_effect=AssertionError("subscription extractor called")
        ) as subscription, patch.object(
            processing.sources,
            "extract_local_lecture",
            side_effect=AssertionError("local adapter called without a clip id"),
        ) as local:
            with self.assertRaisesRegex(ValueError, "registered canon clip"):
                processing.run_job(store, job_id)

        subscription.assert_not_called()
        local.assert_not_called()
        failed = store.get_job(job_id)
        self.assertEqual(failed["status"], "failed")
        self.assertIn("registered canon clip", failed["error"])
        self.assertEqual(failed["chunks"][0]["attempts"][-1]["status"], "failed")


if __name__ == "__main__":
    unittest.main()
