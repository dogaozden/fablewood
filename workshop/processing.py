"""One processing boundary for both HTTP and terminal entry points."""
from __future__ import annotations

import fcntl
import os
from pathlib import Path
import tempfile

from . import llm, sources


def run_job(store, job_id):
    job = store.get_job(job_id)

    def extract(text, node_id, receipt_dir):
        # Resolve inside the extractor so failures receive the normal durable job
        # failure record. A malformed lecture can never fall through to a CLI.
        state = store.snapshot()
        source = next(s for s in state["sources"] if s["id"] == job["source_id"])
        version = next(v for v in source["versions"] if v["id"] == job["source_version"])
        if source["kind"] == "lecture":
            clip_id = (version.get("derivation") or {}).get("clip_id")
            if not clip_id:
                raise ValueError("Lecture imports require a registered canon clip")
            return sources.extract_local_lecture(store.root, clip_id, text, node_id, receipt_dir)
        # Both servers and terminal invocations share a per-user CLI lock. This
        # avoids concurrent subscription refreshes while keeping local reads free.
        lock_path = Path(tempfile.gettempdir()) / f"knowledge-workshop-cli-{os.getuid()}.lock"
        with lock_path.open("a+") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                return llm.extract(text, node_id, receipt_dir)
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    return store.run_job(job_id, extract)
