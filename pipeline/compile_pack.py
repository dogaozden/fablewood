#!/usr/bin/env python3
"""compile_pack.py — the compile-pack stage (Fable_SPEC §5).

Assembles packs/vc-law/pack.json from two staging inputs that stay the source
of truth:
  * facts.staging.json   — the Python-citation-validated facts (never clobbered)
  * content.staging.json — meta + encounters + quests + npcs + metaphor_map

Keys are emitted in schema order (meta, facts, encounters, quests, npcs,
metaphor_map). Unicode (×, curly quotes) is preserved so downstream quote
validation still matches the source markdown.

Usage:
    python3 pipeline/compile_pack.py [--pack-dir packs/vc-law]
"""

import json
import os
import sys


def main(argv):
    pack_dir = "packs/vc-law"
    for i, a in enumerate(argv):
        if a == "--pack-dir" and i + 1 < len(argv):
            pack_dir = argv[i + 1]

    facts_path = os.path.join(pack_dir, "facts.staging.json")
    content_path = os.path.join(pack_dir, "content.staging.json")
    out_path = os.path.join(pack_dir, "pack.json")

    with open(facts_path, encoding="utf-8") as f:
        facts = json.load(f)
    with open(content_path, encoding="utf-8") as f:
        content = json.load(f)

    pack = {
        "meta": content["meta"],
        "facts": facts,
        "encounters": content["encounters"],
        "quests": content["quests"],
        "metaphor_map": content["metaphor_map"],
    }
    if content.get("npcs"):
        # keep schema order: npcs sits between quests and metaphor_map
        pack = {
            "meta": content["meta"],
            "facts": facts,
            "encounters": content["encounters"],
            "quests": content["quests"],
            "npcs": content["npcs"],
            "metaphor_map": content["metaphor_map"],
        }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Compiled {out_path}")
    print(f"  facts:      {len(pack['facts'])}")
    print(f"  encounters: {len(pack['encounters'])}")
    print(f"  quests:     {len(pack['quests'])}")
    print(f"  npcs:       {len(pack.get('npcs', []))}")
    mm = pack["metaphor_map"]
    print(f"  metaphor_map entries: {len(mm) if isinstance(mm, (list, dict)) else 'n/a'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
