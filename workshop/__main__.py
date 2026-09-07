"""Launch the local Workshop or operate its durable pipeline from a terminal."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path

from .http import handle_request
from .processing import run_job
from .sources import prepare
from .store import Workshop


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--storage", type=Path)
    parser.add_argument("--port", type=int, default=5413)
    parser.add_argument("--import-catalog")
    parser.add_argument("--run-job")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    storage = args.storage or Path(os.environ.get("WORKSHOP_DIR", root / ".workshop"))
    store = Workshop(root, storage, read_only=args.status)
    if args.import_catalog:
        print(json.dumps(store.import_prepared(prepare(root, {"catalog_key": args.import_catalog})), indent=2))
        return
    if args.run_job:
        print(json.dumps(run_job(store, args.run_job), indent=2))
        return
    if args.status:
        print(json.dumps(store.snapshot(), indent=2))
        return
    if args.port < 5400:
        parser.error("Scratch servers must use a port at or above 5400")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/":
                self.send_response(302)
                self.send_header("Location", "/workshop/")
                self.end_headers()
            elif not handle_request(self):
                self.send_error(404)

        def do_POST(self):
            if not handle_request(self):
                self.send_error(404)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.repo_root = root
    server.workshop_dir = storage
    print(f"Knowledge Workshop: http://127.0.0.1:{args.port}/workshop/", flush=True)
    print(f"Durable workspace: {storage}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
