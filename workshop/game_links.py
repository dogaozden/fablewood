"""Advisory base-pack matches and explicit, attributed canonical-fact reviews."""
from copy import deepcopy
from difflib import SequenceMatcher
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def proposition_digest(prop):
    # Extra evidence enriches an unchanged claim without invalidating its match.
    return digest({key: prop.get(key) for key in ("statement", "detail", "kind", "type", "node_id")})


def base_pack(store, path=None, *, required=True):
    path = Path(path or store.root / "packs/secreg/pack.json")
    if not path.is_file():
        if required:
            raise ValueError("Select an existing compatible base pack before matching")
        return None
    return json.loads(path.read_text())


@lru_cache(maxsize=4096)
def _normal(text):
    return " ".join(re.findall(r"\w+", text.lower()))


def _score(prop, fact):
    statement, target = _normal(prop["statement"]), _normal(fact["statement"])
    quote = _normal(fact.get("source_ref", {}).get("quote", ""))
    shared_quote = any(
        ev.get("status") == "exact" and len(quote) >= 30
        and (quote in _normal(ev["quote"]) or _normal(ev["quote"]) in quote)
        and len(_normal(ev["quote"])) >= 30 for ev in prop.get("evidence", [])
    )
    left, right = set(statement.split()), set(target.split())
    overlap = len(left & right) / max(1, len(left | right))
    # Avoid quadratic character comparisons for unrelated long pack statements.
    similarity = SequenceMatcher(None, statement, target).ratio() if overlap >= 0.25 else 0
    score = max(similarity, overlap, 0.9 if shared_quote else 0)
    return score, "Shared source wording" if shared_quote else "Similar statement wording"


def _target_valid(fact):
    return fact is not None and not any(fact.get(key) for key in ("duplicate_of", "supersedes", "superseded_by"))


def candidates(store, path=None):
    """Compute matches without persisting proposals or changing review history."""
    base = base_pack(store, path, required=False)
    if base is None:
        return {"pack_id": None, "matches": [], "available": False}
    pack_id = base["meta"]["id"]
    facts = {fact["id"]: fact for fact in base["facts"]}
    def read(state):
        matches = []
        for prop in state["propositions"]:
            reviews = {link["fact_id"]: link for link in state.get("game_links", [])
                       if link["proposition_id"] == prop["id"] and link["pack_id"] == pack_id}
            ranked = []
            for fact in facts.values():
                score, reason = _score(prop, fact)
                if score >= 0.62 and _target_valid(fact):
                    ranked.append((score, fact["id"], reason))
            chosen = {fid: (score, reason) for score, fid, reason in sorted(ranked, reverse=True)[:3]}
            chosen.update({fid: chosen.get(fid, (0, "Previously reviewed match")) for fid in reviews})
            for fid, (score, reason) in chosen.items():
                fact, review = facts.get(fid), reviews.get(fid)
                stale = bool(review and (not _target_valid(fact)
                    or review["fact_sha256"] != digest(fact)
                    or review.get("proposition_sha256") != proposition_digest(prop)))
                matches.append({"proposition_id": prop["id"], "proposition_sha256": proposition_digest(prop),
                    "pack_id": pack_id, "fact_id": fid, "fact_sha256": digest(fact) if fact else None,
                    "fact": deepcopy(fact), "reason": reason, "score": round(score, 3),
                    "review": deepcopy(review), "stale": stale})
        return {"pack_id": pack_id, "matches": matches, "available": True}
    return store.read_state(read)


def review(store, proposition_id, *, pack_id, fact_id, fact_sha256, proposition_sha256,
           status, by, note, method="human", path=None):
    if status not in {"confirmed", "dismissed"}:
        raise ValueError("Game match status must be confirmed or dismissed")
    if not isinstance(by, str) or not by.strip() or not isinstance(note, str) or not note.strip():
        raise ValueError("Game match review requires attribution and a reason")
    if method not in {"human", "agent"}:
        raise ValueError("Game match review method must be human or agent")
    base = base_pack(store, path)
    if base["meta"]["id"] != pack_id:
        raise ValueError("The selected base pack changed; refresh the comparison")
    fact = next((f for f in base["facts"] if f["id"] == fact_id), None)
    if status == "confirmed" and not _target_valid(fact):
        raise ValueError("Choose an existing canonical fact without maintenance pointers")
    if fact_sha256 != (digest(fact) if fact else None):
        raise ValueError("The canonical fact changed; refresh and review again")
    def commit(state):
        from .store import _now
        prop = next((p for p in state["propositions"] if p["id"] == proposition_id), None)
        if prop is None:
            raise KeyError("Unknown proposition")
        if proposition_sha256 != proposition_digest(prop):
            raise ValueError("The proposition changed; refresh and review again")
        links = state.setdefault("game_links", [])
        link_id = "game-link." + digest([proposition_id, pack_id, fact_id])[:24]
        previous = next((link for link in links if link["id"] == link_id), None)
        proposed = {"id": link_id, "proposition_id": proposition_id, "pack_id": pack_id,
            "fact_id": fact_id, "fact_sha256": fact_sha256, "proposition_sha256": proposition_sha256,
            "status": status, "by": by, "note": note, "method": method}
        if previous and all(previous.get(k) == v for k, v in proposed.items()):
            return previous
        if status == "confirmed" and any(link["status"] == "confirmed"
            and link["proposition_id"] == proposition_id and link["id"] != link_id for link in links):
            raise ValueError("Dismiss the previous canonical match before choosing a different fact")
        proposed["at"] = _now()
        state["audit"].append({"action": "game_match_reviewed", "at": proposed["at"],
                               "prior": deepcopy(previous), "review": deepcopy(proposed)})
        if previous:
            previous.clear()
            previous.update(proposed)
        else:
            links.append(proposed)
        return proposed
    return store.transaction(commit)


def confirmed(state, selected, base):
    """Fail closed on stale reviews; a GET may show them, publication cannot use them."""
    props = {p["id"]: p for p in selected}
    links = [link for link in state.get("game_links", [])
             if link["status"] == "confirmed" and link["proposition_id"] in props]
    facts = {fact["id"]: fact for fact in base["facts"]} if base else {}
    result = {}
    for link in links:
        fact = facts.get(link["fact_id"])
        if (not base or link["pack_id"] != base["meta"]["id"] or not _target_valid(fact)
            or link["fact_sha256"] != digest(fact)
            or link.get("proposition_sha256") != proposition_digest(props[link["proposition_id"]])):
            raise ValueError("An existing game match changed; review it again before publishing")
        if link["proposition_id"] in result:
            raise ValueError("A proposition has multiple confirmed game matches")
        result[link["proposition_id"]] = link
    return result
