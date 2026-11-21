#!/usr/bin/env python3
"""Check every data/oir/booklet-*.json file and rebuild data/oir/index.json.
Run from the repo root:  python3 tools/oir_index.py"""
import json, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / "data" / "oir"
sets, problems = [], []
for f in sorted(root.glob("booklet-*.json")):
    try: d = json.loads(f.read_text(encoding="utf-8"))
    except Exception as e: problems.append(f"{f.name}: not valid JSON ({e})"); continue
    if "no" not in d: problems.append(f"{f.name}: missing \"no\""); continue
    counts, minutes = [], 0
    for bi, b in enumerate(d.get("booklets", [])):
        qs = b.get("questions", []); minutes += int(b.get("minutes", 17)); counts.append(len(qs))
        for qi, q in enumerate(qs):
            where = f"{f.name} booklet {bi+1} Q{qi+1}"
            opts = q.get("options")
            if not isinstance(opts, list) or not 2 <= len(opts) <= 8: problems.append(f"{where}: needs 2-8 options"); continue
            a = q.get("answer")
            if not isinstance(a, int) or not 0 <= a < len(opts): problems.append(f"{where}: \"answer\" must be 0-{len(opts)-1}")
            for p in [q.get("img")] + [o.get("img") for o in opts if isinstance(o, dict)]:
                if p and not p.startswith("https://") and not (root / p).exists(): problems.append(f"{where}: image not found: {p}")
    if not counts or not sum(counts): problems.append(f"{f.name}: no questions"); continue
    sets.append({"no": d["no"], "title": d.get("title") or f"OIR Booklet {int(d['no']):02d}", "file": f.name,
                 "verbal": counts[0], "nonverbal": sum(counts[1:]), "minutes": minutes})
nos = [s["no"] for s in sets]
for n in set(nos):
    if nos.count(n) > 1: problems.append(f"booklet number {n} is used by more than one file")
sets.sort(key=lambda s: s["no"])
(root / "index.json").write_text(json.dumps({"note": "Built by tools/oir_index.py from the booklet-*.json files in this folder. Don't edit by hand.", "sets": sets}, indent=2) + "\n", encoding="utf-8")
print(f"{len(sets)} booklet(s) listed in data/oir/index.json")
for p in problems: print("  problem:", p)
sys.exit(1 if problems else 0)
