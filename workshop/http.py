"""Local-only HTTP adapter, shared by standalone Workshop and Living Outline."""
from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
import threading
from urllib.parse import unquote, urlsplit

from .store import Workshop
from . import game_links, processing, publish, sources

_run_lock = threading.Lock()
_threads_lock = threading.Lock()
_threads = {}
MAX_BODY = 128_000


def _json(handler, status, value):
    body = json.dumps(value, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.end_headers()
    handler.wfile.write(body)


def _file(handler, path):
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError("The requested publication or asset is not available")
    body = path.read_bytes()
    handler.send_response(200)
    handler.send_header("Content-Type", (mimetypes.guess_type(path)[0] or "application/octet-stream") + ("; charset=utf-8" if path.suffix in {".html", ".js", ".css", ".json"} else ""))
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    if path.suffix == ".html":
        handler.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
    handler.end_headers()
    handler.wfile.write(body)


def _body(handler):
    if handler.headers.get("Content-Type", "").split(";", 1)[0].lower() != "application/json":
        raise ValueError("Use Content-Type: application/json")
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError as exc:
        raise ValueError("Invalid Content-Length") from exc
    if length < 0 or length > MAX_BODY:
        raise ValueError("Request is too large")
    value = json.loads(handler.rfile.read(length) or b"{}")
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    return value


def _local(handler):
    host = urlsplit("http://" + handler.headers.get("Host", "")).hostname
    if host not in {"localhost", "127.0.0.1", "::1"}:
        raise PermissionError("Workshop is available only through a loopback host")
    origin = handler.headers.get("Origin")
    if origin and origin != "http://" + handler.headers.get("Host", ""):
        raise PermissionError("Foreign-origin requests cannot access the Workshop")


def _store(handler):
    root = Path(handler.server.repo_root).resolve()
    storage = Path(getattr(handler.server, "workshop_dir", os.environ.get("WORKSHOP_DIR", root / ".workshop")))
    return Workshop(root, storage, read_only=handler.command == "GET" or getattr(handler.server, "workshop_read_only", False))


def _start(store, job_id):
    key = (str(store.storage), job_id)
    job = next((j for j in store.snapshot()["jobs"] if j["id"] == job_id), None)
    if job is None:
        raise KeyError("Unknown job")
    with _threads_lock:
        if key in _threads and _threads[key].is_alive():
            return job
        def run():
            try:
                # A single CLI at a time in this process avoids subscription-auth races.
                with _run_lock:
                    processing.run_job(store, job_id)
            except Exception:
                # run_job records the full failure; callers poll its durable status.
                pass
        worker = threading.Thread(target=run, daemon=True, name=f"workshop-{job_id}")
        _threads[key] = worker
        worker.start()
    return next(j for j in store.snapshot()["jobs"] if j["id"] == job_id)


def handle_request(handler):
    """Return False for another application's routes; fully handle our routes otherwise."""
    path = unquote(urlsplit(handler.path).path)
    if not (path in {"/workshop", "/api/workshop"} or path.startswith(("/workshop/", "/api/workshop/"))):
        return False
    try:
        _local(handler)
        if handler.command == "GET" and path in {"/workshop", "/workshop/", "/workshop/index.html", "/workshop/workshop.css", "/workshop/workshop.js"}:
            name = path.rsplit("/", 1)[-1]
            _file(handler, Path(__file__).parent / "web" / (name if name in {"workshop.css", "workshop.js"} else "index.html"))
            return True
        store = _store(handler)
        if handler.command == "GET":
            if path == "/api/workshop":
                _json(handler, 200, store.snapshot())
            elif path == "/api/workshop/catalog":
                _json(handler, 200, sources.catalog(store.root))
            elif path == "/api/workshop/preview":
                _json(handler, 200, publish.preview(store))
            elif path == "/api/workshop/game-matches":
                _json(handler, 200, game_links.candidates(store))
            elif path.startswith("/api/workshop/jobs/"):
                job_id = path.rsplit("/", 1)[-1]
                job = next((j for j in store.snapshot()["jobs"] if j["id"] == job_id), None)
                if job is None:
                    raise KeyError("Unknown job")
                _json(handler, 200, job)
            elif path.startswith("/api/workshop/evidence/"):
                _json(handler, 200, store.get_evidence(path.rsplit("/", 1)[-1]))
            elif path in {"/workshop/published/outline.json", "/workshop/published/pack.json"}:
                name = path.rsplit("/", 1)[-1]
                publications = store.snapshot()["publications"]
                if publications:
                    directory = Path(publications[-1]["directory"]).resolve()
                    allowed = (store.storage / "publications").resolve()
                    if directory == allowed or allowed not in directory.parents:
                        raise PermissionError("Publication is outside the Workshop publication directory")
                    _file(handler, directory / name)
                else:
                    _file(handler, store.root / "secreg/workshop/published" / name)
            else:
                raise KeyError("Unknown Workshop route")
        elif handler.command == "POST":
            if getattr(handler.server, "workshop_read_only", False):
                raise PermissionError("This Workshop instance is read-only")
            body = _body(handler)
            if path == "/api/workshop/import":
                _json(handler, 201, store.import_prepared(sources.prepare(store.root, body)))
            elif path.startswith("/api/workshop/jobs/") and path.endswith("/run"):
                _json(handler, 202, _start(store, path.split("/")[-2]))
            elif path.startswith("/api/workshop/propositions/") and path.endswith("/review"):
                _json(handler, 200, store.review_proposition(path.split("/")[-2], **body))
            elif path.startswith("/api/workshop/propositions/") and path.endswith("/game-link"):
                _json(handler, 200, game_links.review(store, path.split("/")[-2], **body))
            elif path.startswith("/api/workshop/propositions/") and path.endswith("/assign"):
                if body.get("node_id") not in {n["id"] for n in sources.catalog(store.root)["nodes"]}:
                    raise ValueError("Choose an existing outline topic")
                _json(handler, 200, store.assign_proposition(path.split("/")[-2], **body))
            elif path.startswith("/api/workshop/propositions/") and path.endswith("/revise"):
                if body.get("node_id") and body["node_id"] not in {n["id"] for n in sources.catalog(store.root)["nodes"]}:
                    raise ValueError("Choose an existing outline topic")
                _json(handler, 201, store.propose_revision(path.split("/")[-2], **body))
            elif path == "/api/workshop/relations":
                _json(handler, 201, store.add_relation(**body))
            elif path == "/api/workshop/notes":
                if body.get("node_id") not in {n["id"] for n in sources.catalog(store.root)["nodes"]}:
                    raise ValueError("Choose an existing outline topic")
                _json(handler, 201, store.add_note(**body))
            elif path.startswith("/api/workshop/notes/") and path.endswith("/review"):
                _json(handler, 200, store.review_note(path.split("/")[-2], **body))
            elif path == "/api/workshop/publish":
                _json(handler, 201, publish.publish(store, body.get("by")))
            else:
                raise KeyError("Unknown Workshop route")
        else:
            _json(handler, 405, {"error": "Use GET or POST"})
    except PermissionError as exc:
        _json(handler, 403, {"error": str(exc)})
    except (KeyError, FileNotFoundError) as exc:
        _json(handler, 404, {"error": str(exc)})
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        _json(handler, 400, {"error": str(exc)})
    except RuntimeError as exc:
        _json(handler, 409, {"error": str(exc)})
    except Exception as exc:
        _json(handler, 500, {"error": f"Workshop operation failed: {exc}"})
    return True
