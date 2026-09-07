from __future__ import annotations

from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import workshop.http as workshop_http
import workshop.processing as workshop_processing
from workshop.store import Workshop


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not workshop_http.handle_request(self):
            self.send_error(404)

    def do_POST(self):
        if not workshop_http.handle_request(self):
            self.send_error(404)

    def log_message(self, format, *args):
        pass


class WorkshopHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()
        self.storage = Path(self.temporary.name) / "workshop-data"
        self.source = self.root / "neutral-source.txt"
        self.source.write_text("The violet dial points east.\n", encoding="utf-8")
        nodes = self.root / "secreg/atlas/nodes"
        nodes.mkdir(parents=True)
        (nodes / "node.fixture.yml").write_text(
            "id: node.fixture\ntitle: Fixture topic\n", encoding="utf-8"
        )
        self.original_extractor = workshop_processing.llm.extract

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.assertGreaterEqual(self.server.server_port, 5400)
        self.server.repo_root = self.root
        self.server.workshop_dir = self.storage
        self.server.workshop_read_only = False
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        workshop_processing.llm.extract = self.original_extractor
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temporary.cleanup()

    def request(self, method, path, body=None, headers=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request_headers = dict(headers or {})
        if body is not None:
            request_headers.setdefault("Content-Type", "application/json")
        request = Request(self.base + path, data=data, headers=request_headers, method=method)
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, dict(response.headers), json.loads(response.read())
        except HTTPError as error:
            return error.code, dict(error.headers), json.loads(error.read())

    def wait_for_job(self, job_id, status, timeout=5):
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            code, _, last = self.request("GET", f"/api/workshop/jobs/{job_id}")
            self.assertEqual(code, 200)
            if last["status"] == status:
                return last
            time.sleep(0.02)
        self.fail(f"job did not reach {status}; last response was {last}")

    def test_local_api_import_async_failure_resume_and_evidence_lookup(self):
        code, _, imported = self.request(
            "POST",
            "/api/workshop/import",
            {"path": str(self.source), "title": "Neutral Source", "kind": "document"},
        )
        self.assertEqual(code, 201)
        self.assertFalse(imported["duplicate"])
        job_id = imported["job"]["id"]

        def labelled_failing_stub(text, node_id, receipt_dir):
            raise RuntimeError("safe-stub extractor failure")

        workshop_processing.llm.extract = labelled_failing_stub
        code, _, started = self.request("POST", f"/api/workshop/jobs/{job_id}/run", {})
        self.assertEqual(code, 202)
        self.assertIn(started["status"], {"queued", "running", "failed"})
        failed = self.wait_for_job(job_id, "failed")
        self.assertIn("safe-stub extractor failure", failed["error"])

        def labelled_success_stub(text, node_id, receipt_dir):
            return [{
                "statement": "The dial points east.",
                "quote": "The violet dial points east.",
                "semantic_assessment": {"backend": "safe-test-stub", "verdict": "fixture"},
            }]

        workshop_processing.llm.extract = labelled_success_stub
        code, _, _ = self.request("POST", f"/api/workshop/jobs/{job_id}/run", {})
        self.assertEqual(code, 202)
        completed = self.wait_for_job(job_id, "completed")
        self.assertEqual(completed["progress"], {"completed": 1, "total": 1})

        code, _, snapshot = self.request("GET", "/api/workshop")
        self.assertEqual(code, 200)
        proposition = snapshot["propositions"][0]
        evidence_id = proposition["evidence"][0]["id"]
        self.assertEqual(proposition["assessments"][0]["semantic_assessment"]["backend"], "safe-test-stub")
        code, _, evidence = self.request("GET", f"/api/workshop/evidence/{evidence_id}")
        self.assertEqual(code, 200)
        self.assertEqual(evidence["evidence"]["source_version"], imported["job"]["source_version"])
        self.assertEqual(evidence["evidence"]["status"], "exact")
        self.assertNotIn("snapshot_text", json.dumps(evidence["source"]))

    def test_read_only_foreign_origin_host_and_json_errors(self):
        self.server.workshop_read_only = True
        code, _, error = self.request(
            "POST", "/api/workshop/import", {"path": str(self.source)}
        )
        self.assertEqual(code, 403)
        self.assertIn("read-only", error["error"])

        self.server.workshop_read_only = False
        code, _, error = self.request(
            "POST",
            "/api/workshop/import",
            {"path": str(self.source)},
            {"Origin": "https://foreign.example"},
        )
        self.assertEqual(code, 403)
        self.assertIn("Foreign-origin", error["error"])

        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.putrequest("GET", "/api/workshop", skip_host=True)
            connection.putheader("Host", "foreign.example")
            connection.endheaders()
            response = connection.getresponse()
            self.assertEqual(response.status, 403)
            self.assertEqual(response.getheader("Content-Type"), "application/json; charset=utf-8")
            self.assertIn("loopback", json.loads(response.read())["error"])
        finally:
            connection.close()

        code, headers, error = self.request("GET", "/api/workshop/jobs/missing")
        self.assertEqual(code, 404)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertIn("Unknown job", error["error"])

        request = Request(
            self.base + "/api/workshop/import",
            data=b"not-json",
            headers={"Content-Type": "text/plain"},
            method="POST",
        )
        with self.assertRaises(HTTPError) as captured:
            urlopen(request, timeout=5)
        self.assertEqual(captured.exception.code, 400)
        self.assertIn("Content-Type", json.loads(captured.exception.read())["error"])

    def test_note_api_requires_catalog_node_and_complete_attribution(self):
        code, _, error = self.request("POST", "/api/workshop/notes", {
            "node_id": "node.missing", "text": "A personal observation.",
            "attribution": {"creator": "Fixture", "layer_id": "personal"},
        })
        self.assertEqual(code, 400)
        self.assertIn("existing outline topic", error["error"])

        code, _, error = self.request("POST", "/api/workshop/notes", {
            "node_id": "node.fixture", "text": "A personal observation.",
            "attribution": {"creator": "Fixture"},
        })
        self.assertEqual(code, 400)
        self.assertIn("non-blank layer_id", error["error"])

        code, _, created = self.request("POST", "/api/workshop/notes", {
            "node_id": "node.fixture", "text": "A personal observation.",
            "attribution": {"creator": "Fixture", "layer_id": "personal"},
        })
        self.assertEqual(code, 201)
        self.assertEqual(created["node_id"], "node.fixture")
        self.assertEqual(created["attribution"]["layer_id"], "personal")


class WorkshopRecoveryAndStorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()
        self.storage = Path(self.temporary.name) / "workshop-data"

    def tearDown(self):
        self.temporary.cleanup()

    def test_real_process_crash_resumes_after_completed_chunk_and_retains_review(self):
        first_line = "A" * 5800 + " first proof.\n"
        second_line = "B" * 5800 + " second proof.\n"
        store = Workshop(self.root, self.storage)
        imported = store.import_prepared({
            "uri": "/neutral/process-crash.txt",
            "title": "Process Crash Fixture",
            "kind": "document",
            "source_ref": "two-chunks",
            "text": first_line + second_line,
            "node_id": "node.fixture",
            "attribution": {"creator": "Fixture", "layer_id": "fixture"},
            "authority": {"level": "unknown", "label": "Fixture"},
            "crate_eligible": False,
        })
        job_id = imported["job"]["id"]
        marker = Path(self.temporary.name) / "second-extractor-waiting"
        child_code = r'''
from pathlib import Path
import sys
import time
from workshop.store import Workshop

root, storage, job_id, marker = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4])
calls = 0
def extractor(text, node_id, receipt_dir):
    global calls
    calls += 1
    if calls == 1:
        return [{"statement": "The first proof exists.", "quote": "first proof."}]
    marker.write_text("waiting", encoding="utf-8")
    while True:
        time.sleep(0.1)

Workshop(root, storage).run_job(job_id, extractor)
'''
        child = subprocess.Popen(
            [sys.executable, "-c", child_code, str(self.root), str(self.storage), job_id, str(marker)],
            cwd=Path(__file__).resolve().parents[2],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and not marker.exists() and child.poll() is None:
                time.sleep(0.02)
            if not marker.exists():
                stdout, stderr = child.communicate(timeout=2)
                self.fail(f"child did not reach second extractor: stdout={stdout!r} stderr={stderr!r}")

            active_view = Workshop(self.root, self.storage)
            active_job = active_view.get_job(job_id)
            self.assertEqual(active_job["status"], "running")
            self.assertEqual(active_job["progress"], {"completed": 1, "total": 2})
            first_proposition = active_view.snapshot()["propositions"][0]
            active_view.review_proposition(
                first_proposition["id"], "approved", "fixture-reviewer", "before crash"
            )
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
            if child.stdout is not None:
                child.stdout.close()
            if child.stderr is not None:
                child.stderr.close()

        recovered = Workshop(self.root, self.storage)
        interrupted = recovered.get_job(job_id)
        self.assertEqual(interrupted["status"], "interrupted")
        self.assertEqual(interrupted["progress"], {"completed": 1, "total": 2})
        self.assertEqual(
            recovered.get_proposition(first_proposition["id"])["review"]["status"], "approved"
        )

        retry_inputs = []
        completed = recovered.run_job(
            job_id,
            lambda text, *_: retry_inputs.append(text) or [
                {"statement": "The second proof exists.", "quote": "second proof."}
            ],
        )
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(len(retry_inputs), 1)
        self.assertIn("second proof.", retry_inputs[0])
        self.assertNotIn("first proof.", retry_inputs[0])
        self.assertEqual(
            recovered.get_proposition(first_proposition["id"])["review"]["status"], "approved"
        )

    def test_storage_rejects_any_state_component_and_native_live_data(self):
        foreign_state = Path(self.temporary.name) / "other-root" / "state" / "workshop"
        with self.assertRaisesRegex(ValueError, "state"):
            Workshop(self.root, foreign_state)
        native = Path.home() / "Library" / "Application Support" / "realm.ledger.fablewood" / "workshop"
        with self.assertRaisesRegex(ValueError, "native|learning-state"):
            Workshop(self.root, native)


if __name__ == "__main__":
    unittest.main()
