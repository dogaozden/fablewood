"""Durable Knowledge Workshop store.

The store owns a single locked JSON document.  Imported source text is retained in
immutable internal version records and deliberately removed from ``snapshot()``.
"""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Callable, Iterator, Mapping, TypeVar
import unicodedata
import uuid

from .evidence import verify_quote
from .jobs import bounded_chunks, process_is_alive


T = TypeVar("T")
SOURCE_KINDS = {"statute", "case", "lecture", "book", "outline", "observation", "document"}
RELATION_TYPES = {"contradicts", "supersedes", "refines", "related", "duplicate_of"}
RELATION_STATUSES = {"proposed", "confirmed", "dismissed"}
REVIEW_STATUSES = {"pending", "approved", "rejected"}
PROPOSITION_TYPES = {"rule", "concept", "advice", "do", "dont", "number", "story"}
STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is",
    "it", "of", "on", "or", "that", "the", "their", "this", "to", "was", "were", "with",
}
NEGATIONS = {"no", "not", "never", "none", "cannot", "without"}


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _hash_id(prefix: str, *parts: str, length: int = 24) -> str:
    material = "\0".join(parts).encode("utf-8")
    return f"{prefix}." + hashlib.sha256(material).hexdigest()[:length]


def _normal_statement(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return " ".join(normalized.casefold().split())


def _statement_terms(value: str) -> list[str]:
    """Return stable content terms for conservative relationship suggestions."""

    token_pattern = re.compile(r"[\w%-]+(?:\.\d+)?", re.UNICODE)
    return [
        token
        for token in token_pattern.findall(_normal_statement(value))
        if token not in STOP_WORDS
    ]


def _near_duplicate(left: str, right: str) -> bool:
    """Recognize close wording while refusing short, generic overlaps."""

    left_terms = set(_statement_terms(left))
    right_terms = set(_statement_terms(right))
    overlap = left_terms & right_terms
    union = left_terms | right_terms
    if len(overlap) < 4 or not union:
        return False
    shorter = min(len(left_terms), len(right_terms))
    longer = max(len(left_terms), len(right_terms))
    if shorter < 4 or shorter / longer < 0.75:
        return False
    return len(overlap) / len(union) >= 0.75


def _json_copy(value: T) -> T:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _initial_state() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "sources": [],
        "jobs": [],
        "propositions": [],
        "relations": [],
        "notes": [],
        "publications": [],
        "audit": [],
    }


class Workshop:
    """Locked, atomic repository for Workshop sources and review state."""

    def __init__(self, root: Path, storage: Path, read_only: bool = False):
        raw_storage = Path(storage).expanduser()
        if "state" in raw_storage.parts or "realm.ledger.fablewood" in raw_storage.parts:
            raise ValueError("Workshop storage cannot use a learning-state directory")
        self.root = Path(root).expanduser().resolve()
        self.storage = raw_storage.resolve()
        self.read_only = read_only
        self._validate_storage_path()
        self._data_path = self.storage / "workshop.json"
        self._lock_path = self.storage / ".workshop.lock"
        if read_only:
            return
        self.storage.mkdir(parents=True, exist_ok=True)
        if not self._data_path.exists():
            self.transaction(lambda state: None)
        self._recover_abandoned_jobs()

    def _validate_storage_path(self) -> None:
        if "state" in self.storage.parts or "realm.ledger.fablewood" in self.storage.parts:
            raise ValueError("Workshop storage cannot use a learning-state directory")
        forbidden = (self.root / "state").resolve()
        native = (
            Path.home() / "Library" / "Application Support" / "realm.ledger.fablewood"
        ).resolve()
        for protected, label in ((forbidden, "state/"), (native, "the native live-data directory")):
            try:
                self.storage.relative_to(protected)
            except ValueError:
                continue
            raise ValueError(f"Workshop storage cannot be rooted under {label}")
        if self.storage == self.root:
            raise ValueError("Workshop storage must be a dedicated directory")

    @contextmanager
    def _locked(self, exclusive: bool) -> Iterator[None]:
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock_path.open("a+", encoding="utf-8") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def _load_unlocked(self) -> dict[str, Any]:
        if not self._data_path.exists():
            return _initial_state()
        with self._data_path.open("r", encoding="utf-8") as handle:
            state = json.load(handle)
        if not isinstance(state, dict):
            raise ValueError("Workshop data is not a JSON object")
        return state

    def _write_unlocked(self, state: dict[str, Any]) -> None:
        payload = json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        fd, temporary = tempfile.mkstemp(prefix=".workshop.", suffix=".tmp", dir=self.storage)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self._data_path)
            directory_fd = os.open(self.storage, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def transaction(self, mutator: Callable[[dict[str, Any]], T]) -> T:
        """Run ``mutator(state)`` under one exclusive, atomic JSON transaction.

        The full internal state is passed to the callback.  A normal return writes it
        atomically; an exception writes nothing.  Callers must not retain the state.
        """

        if self.read_only:
            raise PermissionError("This Workshop store is read-only")
        with self._locked(exclusive=True):
            state = self._load_unlocked()
            before = json.dumps(state, ensure_ascii=False, sort_keys=True)
            result = mutator(state)
            # Validate serializability before replacing the previous good document.
            json.dumps(state, ensure_ascii=False)
            if not self._data_path.exists() or json.dumps(state, ensure_ascii=False, sort_keys=True) != before:
                self._write_unlocked(state)
            return _json_copy(result)

    def _read(self) -> dict[str, Any]:
        if self.read_only:
            # Writers replace the complete file atomically, so a read-only client
            # can read a consistent snapshot without creating a lock file.
            return _json_copy(self._load_unlocked())
        with self._locked(exclusive=False):
            return _json_copy(self._load_unlocked())

    def read_state(self, reader: Callable[[dict[str, Any]], T]) -> T:
        return reader(self._read())

    def snapshot(self) -> dict[str, Any]:
        state = self._read()
        for source in state["sources"]:
            for version in source.get("versions", []):
                version.pop("snapshot_text", None)
        for job in state["jobs"]:
            if job.get("status") == "running" and not process_is_alive(job.get("runner_pid")):
                job["status"] = "interrupted"
                job["error"] = "previous extractor process ended before completion"
            job.pop("runner_pid", None)
            job.pop("runner_started_at", None)
        return {key: state.get(key, []) for key in (
            "sources", "jobs", "propositions", "relations", "notes", "publications"
        )}

    def _recover_abandoned_jobs(self) -> None:
        def recover(state: dict[str, Any]) -> None:
            now = _now()
            for job in state["jobs"]:
                if job.get("status") == "running" and not process_is_alive(job.get("runner_pid")):
                    job["status"] = "interrupted"
                    job["updated_at"] = now
                    job["error"] = "previous extractor process ended before completion"
                    job.pop("runner_pid", None)
                    job.pop("runner_started_at", None)
                    for chunk in job.get("chunks", []):
                        if chunk.get("status") == "running":
                            chunk["status"] = "queued"
                            if chunk.get("attempts") and chunk["attempts"][-1].get("status") == "running":
                                chunk["attempts"][-1]["status"] = "interrupted"
                                chunk["attempts"][-1]["finished_at"] = now

        self.transaction(recover)

    @staticmethod
    def _source_version(state: dict[str, Any], source_id: str, version_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        source = next((item for item in state["sources"] if item["id"] == source_id), None)
        if source is None:
            raise KeyError(f"unknown source: {source_id}")
        version = next((item for item in source["versions"] if item["id"] == version_id), None)
        if version is None:
            raise KeyError(f"unknown source version: {version_id}")
        return source, version

    @staticmethod
    def _assert_snapshot(version: Mapping[str, Any]) -> None:
        snapshot_text = version.get("snapshot_text")
        if not isinstance(snapshot_text, str):
            raise ValueError(f"source version {version.get('id')} has no immutable text snapshot")
        actual = hashlib.sha256(snapshot_text.encode("utf-8")).hexdigest()
        if actual != version.get("sha256"):
            raise ValueError(f"source version {version.get('id')} snapshot checksum mismatch")
        original_digest = version.get("original_sha256", actual)
        if not isinstance(original_digest, str) or not original_digest:
            raise ValueError(f"source version {version.get('id')} has invalid original checksum metadata")
        legacy_id = "sha256:" + actual
        material = "\0".join(("workshop-source-version-v1", actual, original_digest))
        composite_id = "sha256:" + hashlib.sha256(material.encode("utf-8")).hexdigest()
        if version.get("id") not in {legacy_id, composite_id}:
            raise ValueError(f"source version {version.get('id')} provenance checksum mismatch")

    def import_prepared(self, prepared: dict[str, Any]) -> dict[str, Any]:
        required = ("uri", "title", "kind", "text")
        missing = [key for key in required if not isinstance(prepared.get(key), str) or not prepared[key]]
        if missing:
            raise ValueError("missing prepared fields: " + ", ".join(missing))
        if not isinstance(prepared.get("node_id", ""), str):
            raise ValueError("node_id must be text")
        prepared = {**prepared, "node_id": prepared.get("node_id", "")}
        identity_uri = prepared.get("identity_uri")
        if identity_uri is not None and (
            not isinstance(identity_uri, str) or not identity_uri.strip()
        ):
            raise ValueError("identity_uri must be non-blank text when provided")
        if isinstance(identity_uri, str):
            identity_uri = identity_uri.strip()
        if prepared["kind"] not in SOURCE_KINDS:
            raise ValueError(f"unsupported source kind: {prepared['kind']}")
        incoming_as_of = prepared.get("as_of")
        if incoming_as_of is not None:
            if not isinstance(incoming_as_of, str):
                raise ValueError("as_of must be an ISO date or null")
            try:
                date.fromisoformat(incoming_as_of)
            except ValueError as exc:
                raise ValueError("as_of must be a valid ISO date") from exc
        text = prepared["text"]
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        supplied_digest = prepared.get("original_sha256")
        if supplied_digest is not None and not isinstance(supplied_digest, str):
            raise ValueError("original_sha256 must be text when provided")
        uri = prepared["uri"]
        source_ref = prepared.get("source_ref")
        selection = source_ref if isinstance(source_ref, str) else ""
        proposed_source_id = _hash_id("source", identity_uri or uri, selection)
        container_digest = supplied_digest or digest
        version_material = "\0".join(("workshop-source-version-v1", digest, container_digest))
        proposed_version_id = "sha256:" + hashlib.sha256(version_material.encode("utf-8")).hexdigest()
        now = _now()

        def ingest(state: dict[str, Any]) -> dict[str, Any]:
            source = next(
                (item for item in state["sources"] if item["id"] == proposed_source_id),
                None,
            )
            migrated_identity = False
            if source is None and identity_uri is not None:
                logical_matches = [
                    candidate
                    for candidate in state["sources"]
                    if candidate.get("identity_uri") == identity_uri
                    and candidate.get("kind") == prepared["kind"]
                    and any(
                        version.get("source_ref") == source_ref
                        for version in candidate.get("versions", [])
                    )
                ]
                if len(logical_matches) > 1:
                    raise ValueError("identity_uri matches multiple sources for source_ref")
                if logical_matches:
                    source = logical_matches[0]
            if source is None and identity_uri is not None:
                repo_suffix = (
                    identity_uri[len("repo:") :].lstrip("/")
                    if identity_uri.startswith("repo:")
                    else ""
                )
                safe_suffix = bool(
                    repo_suffix
                    and not Path(repo_suffix).is_absolute()
                    and ".." not in Path(repo_suffix).parts
                )
                migration_matches = []
                if safe_suffix and isinstance(source_ref, str) and source_ref:
                    for candidate in state["sources"]:
                        candidate_uri = str(candidate.get("uri", "")).replace("\\", "/")
                        suffix_matches = (
                            candidate_uri == repo_suffix
                            or candidate_uri.endswith("/" + repo_suffix)
                        )
                        version_matches = any(
                            version.get("source_ref") == source_ref
                            and version.get("original_sha256", version.get("sha256"))
                            == container_digest
                            for version in candidate.get("versions", [])
                        )
                        if (
                            candidate.get("kind") == prepared["kind"]
                            and not candidate.get("identity_uri")
                            and suffix_matches
                            and version_matches
                        ):
                            migration_matches.append(candidate)
                if len(migration_matches) > 1:
                    raise ValueError("identity_uri matches multiple legacy sources")
                if migration_matches:
                    source = migration_matches[0]
                    source["identity_uri"] = identity_uri
                    migrated_identity = True
            if source is None:
                source = {
                    "id": proposed_source_id,
                    "title": prepared["title"],
                    "kind": prepared["kind"],
                    "uri": uri,
                    "attribution": deepcopy(prepared.get("attribution") or {}),
                    "authority": deepcopy(prepared.get("authority") or {"level": "unknown", "label": "Unknown"}),
                    "versions": [],
                }
                if identity_uri is not None:
                    source["identity_uri"] = identity_uri
                state["sources"].append(source)
            else:
                source_identity = source.get("identity_uri")
                identity_conflicts = (
                    source_identity != identity_uri
                    if identity_uri is not None
                    else source["uri"] != uri
                )
                if identity_conflicts or source["kind"] != prepared["kind"]:
                    raise ValueError("stable source identity conflicts with existing source metadata")
            source_id = source["id"]

            if migrated_identity:
                state["audit"].append(
                    {
                        "at": now,
                        "action": "source_identity_uri_adopted",
                        "source_id": source_id,
                        "identity_uri": identity_uri,
                        "uri": source["uri"],
                        "source_ref": source_ref,
                        "original_sha256": container_digest,
                    }
                )

            # Never let a re-import route around a corrupted historical record by
            # minting another version.  All immutable versions under this stable
            # source identity must remain independently verifiable.
            for historical_version in source["versions"]:
                self._assert_snapshot(historical_version)

            # Match by both immutable selection bytes and original-container
            # revision.  This also recognizes historical records minted before
            # composite version IDs without rewriting their IDs or evidence.
            version = next(
                (
                    item for item in source["versions"]
                    if item.get("sha256") == digest
                    and item.get("original_sha256", item.get("sha256")) == container_digest
                ),
                None,
            )
            if version is None:
                version = {
                    "id": proposed_version_id,
                    "sha256": digest,
                    "imported_at": now,
                    "as_of": prepared.get("as_of"),
                    "source_ref": source_ref,
                    "currency": deepcopy(prepared.get("currency") or {"status": "unverified", "note": ""}),
                    "locator": deepcopy(prepared.get("locator") or {}),
                    "crate_eligible": bool(prepared.get("crate_eligible", False)),
                    "original_sha256": supplied_digest or digest,
                    "derivation": deepcopy(prepared.get("derivation")),
                    "snapshot_text": text,
                }
                source["versions"].append(version)
            else:
                self._assert_snapshot(version)
                existing_as_of = version.get("as_of")
                if existing_as_of is not None and incoming_as_of is not None and existing_as_of != incoming_as_of:
                    raise ValueError(
                        f"source version already has conflicting as_of date {existing_as_of}"
                    )
                metadata_before = {
                    "as_of": existing_as_of,
                    "derivation": deepcopy(version.get("derivation")),
                }
                enriched = False
                if existing_as_of is None and incoming_as_of is not None:
                    version["as_of"] = incoming_as_of
                    enriched = True
                if version.get("derivation") is None and prepared.get("derivation") is not None:
                    version["derivation"] = deepcopy(prepared["derivation"])
                    enriched = True
                if enriched:
                    state["audit"].append(
                        {
                            "at": now,
                            "action": "source_version_metadata_enriched",
                            "source_id": source_id,
                            "source_version": version["id"],
                            "source_ref": source_ref,
                            "old": metadata_before,
                            "new": {
                                "as_of": version.get("as_of"),
                                "derivation": deepcopy(version.get("derivation")),
                            },
                        }
                    )

            version_id = version["id"]
            job_id = _hash_id("job", source_id, version_id, prepared["node_id"])

            existing_job = next((item for item in state["jobs"] if item["id"] == job_id), None)
            duplicate = existing_job is not None
            if existing_job is None:
                existing_job = {
                    "id": job_id,
                    "source_id": source_id,
                    "source_version": version_id,
                    "node_id": prepared["node_id"],
                    "status": "queued",
                    "progress": {"completed": 0, "total": 0},
                    "chunks": bounded_chunks(text),
                    "accepted_outputs": [],
                    "created_at": now,
                    "updated_at": now,
                    "error": None,
                }
                existing_job["progress"]["total"] = len(existing_job["chunks"])
                state["jobs"].append(existing_job)
            state["audit"].append({
                "at": now, "action": "source_imported", "source_id": source_id,
                "source_version": version_id, "job_id": job_id, "duplicate": duplicate,
                "import_uri": uri, "identity_uri": identity_uri,
            })
            return {"source": source, "job": existing_job, "duplicate": duplicate}

        result = self.transaction(ingest)
        for version in result["source"]["versions"]:
            version.pop("snapshot_text", None)
        return result

    def get_job(self, job_id: str) -> dict[str, Any]:
        job = next((item for item in self.snapshot()["jobs"] if item["id"] == job_id), None)
        if job is None:
            raise KeyError(f"unknown job: {job_id}")
        return job

    def get_proposition(self, proposition_id: str) -> dict[str, Any]:
        proposition = next(
            (item for item in self.snapshot()["propositions"] if item["id"] == proposition_id), None
        )
        if proposition is None:
            raise KeyError(f"unknown proposition: {proposition_id}")
        return proposition

    def _candidate_locator(self, candidate: Mapping[str, Any], chunk: Mapping[str, Any], text: str) -> dict[str, Any]:
        locator = deepcopy(candidate.get("locator") or {})
        requested = locator.get("char_start")
        quote = candidate.get("quote")
        if isinstance(requested, int) and not isinstance(requested, bool) and isinstance(quote, str):
            is_matching_absolute = (
                chunk["char_start"] <= requested < chunk["char_end"]
                and text[requested : requested + len(quote)] == quote
            )
            if not is_matching_absolute:
                relative = chunk["char_start"] + requested
                if text[relative : relative + len(quote)] == quote:
                    locator["char_start"] = relative
        return locator

    @staticmethod
    def _conflict(left: str, right: str) -> bool:
        token_pattern = re.compile(r"[\w.%-]+", re.UNICODE)
        left_tokens = [t for t in token_pattern.findall(left.casefold()) if t not in STOP_WORDS]
        right_tokens = [t for t in token_pattern.findall(right.casefold()) if t not in STOP_WORDS]
        left_words = {t for t in left_tokens if not re.fullmatch(r"\d+(?:\.\d+)?%?", t)}
        right_words = {t for t in right_tokens if not re.fullmatch(r"\d+(?:\.\d+)?%?", t)}
        overlap = left_words & right_words
        union = left_words | right_words
        if len(overlap) < 4 or not union or len(overlap) / len(union) < 0.75:
            return False
        left_numbers = {t for t in left_tokens if re.fullmatch(r"\d+(?:\.\d+)?%?", t)}
        right_numbers = {t for t in right_tokens if re.fullmatch(r"\d+(?:\.\d+)?%?", t)}
        numeric_conflict = bool(left_numbers and right_numbers and left_numbers != right_numbers)
        negation_conflict = bool(set(left_tokens) & NEGATIONS) != bool(set(right_tokens) & NEGATIONS)
        return numeric_conflict or negation_conflict

    def _ingest_candidates(
        self,
        state: dict[str, Any],
        job: dict[str, Any],
        chunk: dict[str, Any],
        candidates: list[dict[str, Any]],
    ) -> list[str]:
        source, version = self._source_version(state, job["source_id"], job["source_version"])
        self._assert_snapshot(version)
        now = _now()
        output_ids: list[str] = []
        for candidate in candidates:
            statement = candidate.get("statement")
            if not isinstance(statement, str) or not statement.strip():
                raise ValueError("extractor candidate statement must be non-empty text")
            normalized_statement = _normal_statement(statement)
            proposition_id = _hash_id("proposition", normalized_statement, job["node_id"])
            requested_locator = self._candidate_locator(candidate, chunk, version["snapshot_text"])
            evidence = verify_quote(
                source_id=source["id"],
                source_version=version["id"],
                snapshot_text=version["snapshot_text"],
                quote=candidate.get("quote"),
                base_locator=version.get("locator"),
                requested_locator=requested_locator,
                selection_start=chunk["char_start"],
                selection_end=chunk["char_end"],
                checked_at=now,
            )
            # A reviewed proposition keeps its durable ID after an audited topic
            # correction.  Match semantic identity at the corrected node before
            # considering the deterministic minting ID for a new proposition.
            proposition = next(
                (
                    p
                    for p in state["propositions"]
                    if p["node_id"] == job["node_id"]
                    and _normal_statement(p["statement"]) == normalized_statement
                ),
                None,
            )
            if proposition is None:
                proposition = next((p for p in state["propositions"] if p["id"] == proposition_id), None)
            created = proposition is None
            if proposition is None:
                proposition_kind = candidate.get("kind", "supported_proposition")
                if proposition_kind not in {"supported_proposition", "interpretation"}:
                    proposition_kind = "supported_proposition"
                proposition = {
                    "id": proposition_id,
                    "node_id": job["node_id"],
                    "statement": statement.strip(),
                    "kind": proposition_kind,
                    "evidence": [],
                    "assessments": [],
                    "confidence": {"support": "unsupported", "explanation": "awaiting attributed review"},
                    "review": {"status": "pending", "by": None, "at": None, "note": "", "method": None},
                    "publication": {"status": "draft"},
                    "created_at": now,
                }
                for key in ("type", "detail", "tags", "difficulty"):
                    if key in candidate:
                        proposition[key] = deepcopy(candidate[key])
                state["propositions"].append(proposition)
            # Evidence is additive. Never replace an earlier proof or its review.
            evidence_added = not any(
                item["id"] == evidence["id"] for item in proposition["evidence"]
            )
            if evidence_added:
                proposition["evidence"].append(evidence)
            if created:
                self._propose_conflicts(state, proposition)
            proposition.setdefault("assessments", [])
            if "semantic_assessment" in candidate:
                assessment_value = deepcopy(candidate["semantic_assessment"])
                assessment_material = json.dumps(assessment_value, ensure_ascii=False, sort_keys=True)
                assessment_id = _hash_id(
                    "assessment", proposition["id"], job["id"], str(chunk["index"]),
                    evidence["id"], assessment_material,
                )
                if not any(item["id"] == assessment_id for item in proposition["assessments"]):
                    proposition["assessments"].append(
                        {
                            "id": assessment_id,
                            "semantic_assessment": assessment_value,
                            "job_id": job["id"],
                            "chunk_index": chunk["index"],
                            "source_id": source["id"],
                            "source_version": version["id"],
                            "evidence_id": evidence["id"],
                            "created_at": now,
                        }
                    )
            self._refresh_confidence(state, proposition)
            output_ids.append(proposition["id"])
        return list(dict.fromkeys(output_ids))

    def _propose_conflicts(self, state: dict[str, Any], proposition: dict[str, Any]) -> None:
        for other in state["propositions"]:
            if other["id"] == proposition["id"]:
                continue

            same_topic = other["node_id"] == proposition["node_id"]
            if same_topic and self._conflict(proposition["statement"], other["statement"]):
                self._add_suggested_relation(
                    state,
                    proposition,
                    other,
                    relation_type="contradicts",
                    note=(
                        "Lexical numeric or negation conflict suspicion only; "
                        "requires review before it is a confirmed contradiction."
                    ),
                    basis="lexical_conflict_suspicion",
                )
                continue

            proposition_sources = {
                item["source_id"] for item in proposition.get("evidence", [])
            }
            other_sources = {item["source_id"] for item in other.get("evidence", [])}
            cross_source = bool(
                proposition_sources and other_sources and proposition_sources != other_sources
            )
            if not cross_source:
                continue

            exact_normalized_match = (
                _normal_statement(proposition["statement"])
                == _normal_statement(other["statement"])
            )
            enough_specific_terms = len(_statement_terms(proposition["statement"])) >= 3
            if not same_topic and exact_normalized_match and enough_specific_terms:
                self._add_suggested_relation(
                    state,
                    proposition,
                    other,
                    relation_type="duplicate_of",
                    note=(
                        "The normalized statements match across topics and sources; "
                        "review the topic assignments before confirming a duplicate."
                    ),
                    basis="cross_topic_normalized_match",
                )
            elif same_topic and _near_duplicate(
                proposition["statement"], other["statement"]
            ):
                self._add_suggested_relation(
                    state,
                    proposition,
                    other,
                    relation_type="duplicate_of",
                    note=(
                        "Lexically similar statements from different sources may be duplicates; "
                        "the wording match is a review candidate, not a semantic conclusion."
                    ),
                    basis="cross_source_lexical_similarity",
                )

    @staticmethod
    def _add_suggested_relation(
        state: dict[str, Any],
        proposition: Mapping[str, Any],
        other: Mapping[str, Any],
        *,
        relation_type: str,
        note: str,
        basis: str,
    ) -> None:
        relation_id = _hash_id(
            "relation", proposition["id"], other["id"], relation_type
        )
        if any(relation["id"] == relation_id for relation in state["relations"]):
            return
        state["relations"].append(
            {
                "id": relation_id,
                "from_id": proposition["id"],
                "to_id": other["id"],
                "type": relation_type,
                "status": "proposed",
                "note": note,
                "by": "deterministic-relationship-check",
                "basis": basis,
            }
        )

    @staticmethod
    def _refresh_confidence(state: dict[str, Any], proposition: dict[str, Any]) -> None:
        contested = any(
            relation["type"] == "contradicts"
            and relation["status"] == "confirmed"
            and proposition["id"] in {relation["from_id"], relation["to_id"]}
            for relation in state["relations"]
        )
        if contested:
            proposition["confidence"] = {
                "support": "contested", "explanation": "a confirmed contradiction remains unresolved"
            }
        elif proposition["review"]["status"] == "approved" and any(
            evidence["status"] == "exact" for evidence in proposition["evidence"]
        ):
            proposition["confidence"] = {
                "support": "source_supported",
                "explanation": "approved candidate with an exact snapshot quote; not legal validation",
            }
        else:
            proposition["confidence"] = {
                "support": "unsupported",
                "explanation": "exact evidence and attributed approval are both required",
            }

    def run_job(self, job_id: str, extractor: Callable[[str, str, Path], list[dict[str, Any]]]) -> dict[str, Any]:
        def claim(state: dict[str, Any]) -> None:
            job = next((j for j in state["jobs"] if j["id"] == job_id), None)
            if job is None:
                raise KeyError(f"unknown job: {job_id}")
            if job["status"] == "completed":
                return
            if job["status"] == "running" and process_is_alive(job.get("runner_pid")):
                raise RuntimeError("job already has an active extractor")
            job["status"] = "running"
            job["runner_pid"] = os.getpid()
            job["runner_started_at"] = _now()
            job["updated_at"] = _now()
            job["error"] = None

        self.transaction(claim)
        if self.get_job(job_id)["status"] == "completed":
            return self.get_job(job_id)

        try:
            while True:
                state = self._read()
                job = next(j for j in state["jobs"] if j["id"] == job_id)
                chunk = next((c for c in job["chunks"] if c["status"] != "completed"), None)
                if chunk is None:
                    break
                _, version = self._source_version(state, job["source_id"], job["source_version"])
                self._assert_snapshot(version)
                chunk_text = version["snapshot_text"][chunk["char_start"] : chunk["char_end"]]
                checkpoint = next(
                    (a for a in reversed(chunk["attempts"]) if a.get("status") == "checkpointed"), None
                )
                if checkpoint is None:
                    attempt_no = len(chunk["attempts"]) + 1
                    attempt_id = _hash_id("attempt", job_id, str(chunk["index"]), str(attempt_no))
                    receipt_dir = self.storage / "receipts" / job_id / f"chunk-{chunk['index']}" / attempt_id
                    receipt_dir.mkdir(parents=True, exist_ok=True)

                    def start_attempt(current: dict[str, Any]) -> None:
                        current_job = next(j for j in current["jobs"] if j["id"] == job_id)
                        current_chunk = current_job["chunks"][chunk["index"]]
                        current_chunk["status"] = "running"
                        current_chunk["attempts"].append({
                            "id": attempt_id,
                            "status": "running",
                            "started_at": _now(),
                            "input_sha256": chunk["sha256"],
                            "receipt_dir": str(receipt_dir),
                        })

                    self.transaction(start_attempt)
                    raw = extractor(chunk_text, job["node_id"], receipt_dir)
                    if not isinstance(raw, list) or not all(isinstance(item, dict) for item in raw):
                        raise ValueError("extractor must return a list of candidate objects")
                    parsed = _json_copy(raw)

                    def checkpoint_attempt(current: dict[str, Any]) -> None:
                        current_job = next(j for j in current["jobs"] if j["id"] == job_id)
                        current_chunk = current_job["chunks"][chunk["index"]]
                        attempt = next(a for a in current_chunk["attempts"] if a["id"] == attempt_id)
                        attempt["raw_output"] = _json_copy(raw)
                        attempt["parsed_candidates"] = parsed
                        attempt["checkpointed_at"] = _now()
                        attempt["status"] = "checkpointed"
                        current_chunk["status"] = "checkpointed"

                    self.transaction(checkpoint_attempt)
                    checkpoint = {"id": attempt_id, "parsed_candidates": parsed}

                def accept(current: dict[str, Any]) -> None:
                    current_job = next(j for j in current["jobs"] if j["id"] == job_id)
                    current_chunk = current_job["chunks"][chunk["index"]]
                    attempt = next(a for a in current_chunk["attempts"] if a["id"] == checkpoint["id"])
                    output_ids = self._ingest_candidates(
                        current, current_job, current_chunk, checkpoint["parsed_candidates"]
                    )
                    attempt["status"] = "accepted"
                    attempt["accepted_at"] = _now()
                    attempt["accepted_outputs"] = output_ids
                    current_chunk["status"] = "completed"
                    current_chunk["accepted_outputs"] = output_ids
                    current_job["accepted_outputs"] = list(dict.fromkeys(
                        current_job["accepted_outputs"] + output_ids
                    ))
                    completed = sum(c["status"] == "completed" for c in current_job["chunks"])
                    current_job["progress"] = {"completed": completed, "total": len(current_job["chunks"])}
                    current_job["updated_at"] = _now()

                self.transaction(accept)

            def complete(state: dict[str, Any]) -> None:
                job = next(j for j in state["jobs"] if j["id"] == job_id)
                job["status"] = "completed"
                job["updated_at"] = _now()
                job["error"] = None
                job.pop("runner_pid", None)
                job.pop("runner_started_at", None)

            self.transaction(complete)
        except Exception as exc:
            def fail(state: dict[str, Any]) -> None:
                job = next(j for j in state["jobs"] if j["id"] == job_id)
                job["status"] = "failed"
                job["updated_at"] = _now()
                job["error"] = f"{type(exc).__name__}: {exc}"
                job.pop("runner_pid", None)
                job.pop("runner_started_at", None)
                for chunk in job["chunks"]:
                    if chunk["status"] in {"running", "checkpointed"}:
                        chunk["status"] = "queued"
                        if chunk["attempts"] and chunk["attempts"][-1]["status"] in {"running", "checkpointed"}:
                            chunk["attempts"][-1]["status"] = "failed"
                            chunk["attempts"][-1]["error"] = f"{type(exc).__name__}: {exc}"
                            chunk["attempts"][-1]["finished_at"] = _now()

            self.transaction(fail)
            raise
        return self.get_job(job_id)

    def review_proposition(
        self, proposition_id: str, status: str, by: str, note: str, method: str = "human"
    ) -> dict[str, Any]:
        if status not in REVIEW_STATUSES:
            raise ValueError("review status must be pending, approved, or rejected")
        if not isinstance(by, str) or not by.strip():
            raise ValueError("review requires attribution")
        if not isinstance(note, str):
            raise ValueError("review note must be text")
        if method not in {"human", "agent"}:
            raise ValueError("review method must be human or agent")

        def review(state: dict[str, Any]) -> dict[str, Any]:
            proposition = next((p for p in state["propositions"] if p["id"] == proposition_id), None)
            if proposition is None:
                raise KeyError(f"unknown proposition: {proposition_id}")
            if status == "approved" and not any(e["status"] == "exact" for e in proposition["evidence"]):
                raise ValueError("cannot approve a proposition without exact evidence")
            prior = proposition["review"]
            if all(prior.get(key) == value for key, value in (
                ("status", status), ("by", by), ("note", note), ("method", method)
            )):
                return proposition
            now = _now()
            prior = deepcopy(prior)
            proposition["review"] = {"status": status, "by": by, "at": now, "note": note, "method": method}
            self._refresh_confidence(state, proposition)
            state["audit"].append({
                "at": now, "action": "proposition_reviewed", "proposition_id": proposition_id,
                "prior": prior, "review": deepcopy(proposition["review"]),
            })
            return proposition

        return self.transaction(review)

    def propose_revision(
        self,
        proposition_id: str,
        statement: str,
        quote: str,
        evidence_id: str,
        by: str,
        note: str,
        node_id: str | None = None,
        relation_type: str = "refines",
        method: str = "human",
        detail: str = "",
        proposition_type: str | None = None,
    ) -> dict[str, Any]:
        """Create an inspectable correction proposal without editing its original."""

        if not isinstance(statement, str) or not statement.strip():
            raise ValueError("revision requires a non-blank statement")
        if not isinstance(quote, str):
            raise ValueError("revision quote must be text")
        if not isinstance(evidence_id, str) or not evidence_id:
            raise ValueError("revision requires an existing evidence_id")
        if not isinstance(by, str) or not by.strip():
            raise ValueError("revision requires attribution")
        if not isinstance(note, str):
            raise ValueError("revision note must be text")
        if not isinstance(detail, str):
            raise ValueError("revision detail must be text")
        if method not in {"human", "agent"}:
            raise ValueError("revision method must be human or agent")
        if relation_type not in {"refines", "supersedes"}:
            raise ValueError("revision relation_type must be refines or supersedes")
        if proposition_type is not None and proposition_type not in PROPOSITION_TYPES:
            raise ValueError("revision proposition_type is invalid")
        if node_id is not None and (
            not isinstance(node_id, str) or not node_id.strip()
        ):
            raise ValueError("revision node_id must be non-blank when provided")

        normalized_statement = _normal_statement(statement)

        def propose(state: dict[str, Any]) -> dict[str, Any]:
            original = next(
                (p for p in state["propositions"] if p["id"] == proposition_id),
                None,
            )
            if original is None:
                raise KeyError(f"unknown proposition: {proposition_id}")
            original_evidence = next(
                (item for item in original.get("evidence", []) if item["id"] == evidence_id),
                None,
            )
            if original_evidence is None:
                raise ValueError(
                    "revision evidence_id must belong to the original proposition"
                )

            source, version = self._source_version(
                state,
                original_evidence["source_id"],
                original_evidence["source_version"],
            )
            self._assert_snapshot(version)
            now = _now()
            revised_evidence = verify_quote(
                source_id=source["id"],
                source_version=version["id"],
                snapshot_text=version["snapshot_text"],
                quote=quote,
                base_locator=version.get("locator"),
                checked_at=now,
            )

            target_node_id = original["node_id"] if node_id is None else node_id.strip()
            target_type = proposition_type or original.get("type", "concept")
            if target_type not in PROPOSITION_TYPES:
                raise ValueError(
                    "original proposition type is invalid; supply a valid proposition_type"
                )
            proposed_id = _hash_id(
                "proposition", normalized_statement, target_node_id
            )
            if proposed_id == original["id"]:
                raise ValueError(
                    "revision must change the statement or assign a different topic"
                )

            proposed = next(
                (p for p in state["propositions"] if p["id"] == proposed_id), None
            )
            duplicate = proposed is not None
            if proposed is None:
                proposed = {
                    "id": proposed_id,
                    "node_id": target_node_id,
                    "statement": statement.strip(),
                    "kind": original.get("kind", "supported_proposition"),
                    "evidence": [],
                    "assessments": [],
                    "confidence": {
                        "support": "unsupported",
                        "explanation": "awaiting attributed review",
                    },
                    "review": {
                        "status": "pending",
                        "by": None,
                        "at": None,
                        "note": "",
                        "method": None,
                    },
                    "publication": {"status": "draft"},
                    "created_at": now,
                    "type": target_type,
                    "detail": detail,
                    "provenance": {
                        "kind": "correction_proposal",
                        "original_id": original["id"],
                        "by": by.strip(),
                        "method": method,
                        "type": target_type,
                        "detail": detail,
                        "created_at": now,
                    },
                    "revision_history": [],
                }
                for key in ("tags", "difficulty"):
                    if key in original:
                        proposed[key] = deepcopy(original[key])
                state["propositions"].append(proposed)
            else:
                if (
                    proposed["node_id"] != target_node_id
                    or _normal_statement(proposed["statement"])
                    != normalized_statement
                ):
                    raise ValueError("revision ID conflicts with existing proposition")
                existing_original_ids = {
                    item.get("original_id")
                    for item in proposed.get("revision_history", [])
                }
                if proposition_id not in existing_original_ids:
                    raise ValueError(
                        "matching proposition already exists outside this revision history"
                    )
                if (
                    proposed.get("type", "concept") != target_type
                    or proposed.get("detail", "") != detail
                ):
                    raise ValueError(
                        "retry type and detail must match the existing revision proposal"
                    )
                proposed.setdefault("revision_history", [])

            if not any(
                item["id"] == revised_evidence["id"]
                for item in proposed.get("evidence", [])
            ):
                proposed.setdefault("evidence", []).append(revised_evidence)

            relation_id = _hash_id(
                "relation", proposed["id"], original["id"], relation_type
            )
            relation = next(
                (item for item in state["relations"] if item["id"] == relation_id),
                None,
            )
            if relation is None:
                if relation_type == "supersedes":
                    self._assert_supersedes_acyclic(
                        state, proposed["id"], original["id"]
                    )
                relation = {
                    "id": relation_id,
                    "from_id": proposed["id"],
                    "to_id": original["id"],
                    "type": relation_type,
                    "status": "proposed",
                    "note": note,
                    "by": by.strip(),
                    "provenance": {
                        "kind": "correction_proposal",
                        "method": method,
                    },
                }
                state["relations"].append(relation)

            history_id = _hash_id(
                "revision",
                original["id"],
                proposed["id"],
                evidence_id,
                revised_evidence["id"],
                by.strip(),
                method,
                note,
                relation_type,
            )
            history = {
                "id": history_id,
                "original_id": original["id"],
                "proposed_id": proposed["id"],
                "source_evidence_id": evidence_id,
                "evidence_id": revised_evidence["id"],
                "source_id": source["id"],
                "source_version": version["id"],
                "evidence_status": revised_evidence["status"],
                "relation_id": relation["id"],
                "relation_type": relation_type,
                "type": target_type,
                "detail": detail,
                "by": by.strip(),
                "method": method,
                "note": note,
                "at": now,
            }
            if not any(
                item["id"] == history_id for item in proposed["revision_history"]
            ):
                proposed["revision_history"].append(history)

            self._refresh_confidence(state, proposed)
            state["audit"].append(
                {
                    "at": now,
                    "action": "proposition_revision_proposed",
                    "original_id": original["id"],
                    "proposed_id": proposed["id"],
                    "relation_id": relation["id"],
                    "revision_history_id": history_id,
                    "duplicate": duplicate,
                    "by": by.strip(),
                    "method": method,
                }
            )
            return {
                "original_id": original["id"],
                "proposed_id": proposed["id"],
                "proposition": proposed,
                "relation": relation,
                "duplicate": duplicate,
            }

        return self.transaction(propose)

    @staticmethod
    def _assert_supersedes_acyclic(
        state: dict[str, Any], from_id: str, to_id: str
    ) -> None:
        graph: dict[str, set[str]] = {}
        for relation in state["relations"]:
            if relation["type"] == "supersedes" and relation["status"] != "dismissed":
                graph.setdefault(relation["from_id"], set()).add(relation["to_id"])
        frontier = [to_id]
        seen: set[str] = set()
        while frontier:
            current = frontier.pop()
            if current == from_id:
                raise ValueError("supersedes relation would create a cycle")
            if current not in seen:
                seen.add(current)
                frontier.extend(graph.get(current, ()))

    def assign_proposition(
        self, proposition_id: str, node_id: str, by: str, note: str
    ) -> dict[str, Any]:
        if not isinstance(node_id, str) or not node_id.strip():
            raise ValueError("topic assignment requires a non-blank node_id")
        if not isinstance(by, str) or not by.strip():
            raise ValueError("topic assignment requires attribution")

        def assign(state: dict[str, Any]) -> dict[str, Any]:
            proposition = next((p for p in state["propositions"] if p["id"] == proposition_id), None)
            if proposition is None:
                raise KeyError(f"unknown proposition: {proposition_id}")
            previous_node = proposition["node_id"]
            if previous_node == node_id:
                return proposition
            collision = next(
                (
                    p for p in state["propositions"]
                    if p["id"] != proposition_id and p["node_id"] == node_id
                    and _normal_statement(p["statement"]) == _normal_statement(proposition["statement"])
                ),
                None,
            )
            if collision is not None:
                raise ValueError(
                    f"topic already contains the same proposition under durable id {collision['id']}"
                )
            now = _now()
            prior_review = deepcopy(proposition["review"])
            proposition["node_id"] = node_id
            if proposition["review"]["status"] != "pending":
                proposition["review"] = {
                    "status": "pending",
                    "by": None,
                    "at": None,
                    "note": "Topic changed after a decision; review again before publication.",
                    "method": None,
                }
                self._refresh_confidence(state, proposition)
            state["audit"].append(
                {
                    "at": now,
                    "action": "proposition_assigned",
                    "proposition_id": proposition_id,
                    "from_node_id": previous_node,
                    "to_node_id": node_id,
                    "by": by,
                    "note": note,
                    "prior_review": prior_review,
                    "review": deepcopy(proposition["review"]),
                }
            )
            return proposition

        return self.transaction(assign)

    def add_relation(
        self, from_id: str, to_id: str, type: str, status: str, note: str, by: str
    ) -> dict[str, Any]:
        if type not in RELATION_TYPES or status not in RELATION_STATUSES:
            raise ValueError("invalid relation type or status")
        if from_id == to_id:
            raise ValueError("relation endpoints must differ")

        def add(state: dict[str, Any]) -> dict[str, Any]:
            proposition_ids = {p["id"] for p in state["propositions"]}
            if from_id not in proposition_ids or to_id not in proposition_ids:
                raise ValueError("relation endpoints must be existing propositions")
            if type == "supersedes" and status != "dismissed":
                self._assert_supersedes_acyclic(state, from_id, to_id)
            relation_id = _hash_id("relation", from_id, to_id, type)
            relation = next((r for r in state["relations"] if r["id"] == relation_id), None)
            prior = deepcopy(relation)
            if relation is None:
                relation = {"id": relation_id, "from_id": from_id, "to_id": to_id, "type": type}
                state["relations"].append(relation)
            relation.update({"status": status, "note": note, "by": by})
            if type == "contradicts":
                for proposition in state["propositions"]:
                    if proposition["id"] in {from_id, to_id}:
                        self._refresh_confidence(state, proposition)
            state["audit"].append(
                {
                    "at": _now(),
                    "action": "relation_reviewed",
                    "relation_id": relation_id,
                    "by": by,
                    "prior": prior,
                    "relation": deepcopy(relation),
                }
            )
            return relation

        return self.transaction(add)

    @staticmethod
    def _assert_note_contract(note: Mapping[str, Any]) -> None:
        if not isinstance(note, Mapping):
            raise ValueError("note must be an object")
        node_id = note.get("node_id")
        text = note.get("text")
        attribution = note.get("attribution")
        if not isinstance(node_id, str) or not node_id.strip():
            raise ValueError("note requires a non-blank node_id")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("note requires non-blank text")
        if not isinstance(attribution, dict):
            raise ValueError("note attribution must be an object")
        for key in ("creator", "layer_id"):
            value = attribution.get(key)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"note attribution requires a non-blank {key}")

    def add_note(self, node_id: str, text: str, attribution: dict[str, Any]) -> dict[str, Any]:
        candidate = {"node_id": node_id, "text": text, "attribution": attribution}
        self._assert_note_contract(candidate)
        normalized_attribution = deepcopy(attribution)
        normalized_attribution["creator"] = attribution["creator"].strip()
        normalized_attribution["layer_id"] = attribution["layer_id"].strip()
        now = _now()
        note = {
            "id": "note." + uuid.uuid4().hex,
            "node_id": node_id.strip(),
            "text": text,
            "attribution": normalized_attribution,
            "created_at": now,
            "updated_at": now,
            "review": {"status": "pending", "by": None, "at": None, "note": "", "method": None},
            "publication": {"status": "draft"},
        }

        def add(state: dict[str, Any]) -> dict[str, Any]:
            state["notes"].append(note)
            return note

        return self.transaction(add)

    def review_note(self, note_id: str, status: str, by: str, note: str, method: str = "human") -> dict[str, Any]:
        if (status not in REVIEW_STATUSES or method not in {"human", "agent"}
                or not isinstance(by, str) or not by.strip() or not isinstance(note, str)):
            raise ValueError("invalid attributed note review")

        def review(state: dict[str, Any]) -> dict[str, Any]:
            item = next((n for n in state["notes"] if n["id"] == note_id), None)
            if item is None:
                raise KeyError(f"unknown note: {note_id}")
            if status == "approved":
                self._assert_note_contract(item)
            prior = item["review"]
            if all(prior.get(key) == value for key, value in (
                ("status", status), ("by", by), ("note", note), ("method", method)
            )):
                return item
            now = _now()
            prior = deepcopy(prior)
            item["review"] = {"status": status, "by": by, "at": now, "note": note, "method": method}
            item["updated_at"] = now
            state["audit"].append(
                {
                    "at": now,
                    "action": "note_reviewed",
                    "note_id": note_id,
                    "by": by,
                    "prior": prior,
                    "review": deepcopy(item["review"]),
                }
            )
            return item

        return self.transaction(review)

    def get_evidence(self, evidence_id: str) -> dict[str, Any]:
        state = self._read()
        for proposition in state["propositions"]:
            evidence = next((e for e in proposition["evidence"] if e["id"] == evidence_id), None)
            if evidence is None:
                continue
            source, version = self._source_version(state, evidence["source_id"], evidence["source_version"])
            public_source = deepcopy(source)
            for item in public_source["versions"]:
                item.pop("snapshot_text", None)
            return {
                "evidence": deepcopy(evidence),
                "proposition_id": proposition["id"],
                "source": public_source,
                "version": next(v for v in public_source["versions"] if v["id"] == version["id"]),
            }
        raise KeyError(f"unknown evidence: {evidence_id}")
