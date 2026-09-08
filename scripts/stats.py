#!/usr/bin/env python3
"""The numbers the copy quotes, computed from the data that owns them.

A sentence with a figure in it goes stale the first time a drink is
added, and nothing in the pipeline notices, because a stale sentence is
still valid JSON and still valid prose. So the figures live here. Run
`make stats`, read the paragraph off the end, paste it into the README.

The shelf reported on is the README's own, written out below. The
pourable count is worked out the way the app works it out: a build entry
gates unless the shelf holds something written down as standing in for
it, and a garnish letter never gates at all. Gain is the same marginal
figure the Bar tab prints: add the bottle, count again, take the
difference.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kin   # noqa: E402  (path set above; there is no package here)
import llms  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# The shelf the README describes as "gin, bourbon, both vermouths, two
# bitters and the staples". Change the sentence, change this list.
# The README lede rounds down to the nearest fifty and says "over", so it
# stays true as drinks are added and only needs touching every fifty.
WORDS = {
    50: "fifty", 100: "a hundred", 150: "a hundred and fifty",
    200: "two hundred", 250: "two hundred and fifty", 300: "three hundred",
}

README_SHELF = [
    "gin", "bourbon", "sweet-vermouth", "dry-vermouth",
    "angostura", "orange-bitters",
    "lemon", "lime", "simple", "demerara",
    "sugar", "cherry", "orange", "olive",
]


def load(name):
    return json.loads((ROOT / "data" / name).read_text())


def pours_of(menu):
    """What each drink has to have in the glass: its build, and only that."""
    out = {}
    for d in menu["cocktails"]:
        ids = []
        for part in d["build"]:
            if part[0] not in ids:
                ids.append(part[0])
        out[d["id"]] = ids
    return out


def can_pour(ids, held, stand_in):
    for iid in ids:
        if iid in held:
            continue
        if any(sub in held for sub in stand_in.get(iid, ())):
            continue
        return False
    return True


def pourable(pours, held, stand_in):
    return sum(1 for ids in pours.values() if can_pour(ids, held, stand_in))


def gains(bar, pours, held, stand_in):
    """Every unstocked bottle, by what adding it would unlock."""
    base = pourable(pours, held, stand_in)
    out = []
    for i in bar["ingredients"]:
        if i["id"] in held:
            continue
        more = pourable(pours, held | {i["id"]}, stand_in) - base
        out.append((more, i))
    out.sort(key=lambda t: (-t[0], t[1]["name"].lower()))
    return base, out


# How a bottle is named in a sentence lives in one place, and kin.py's
# why-lines are that place: `orange liqueur` lowercase, `Bénédictine`
# with its capital.
say = kin.say


def sentence(base, top):
    """The README's own line, with today's figures in it."""
    best, rest = top[0], top[1:3]
    lead = "the best next bottle is "
    if best[1]["kind"] != "base":
        lead += "not a spirit at all but "
    tail = ", then " + " and ".join(
        f"{say(i)} at +{n}" for n, i in rest) if rest else ""
    return ("From gin, bourbon, both vermouths, two bitters and the staples "
            f"you can pour {base} drinks; {lead}{say(best[1])}, "
            f"at +{best[0]}{tail}.")


def main():
    bar = load("bar.json")
    menu = load("cocktails.json")
    stand_in = {i["id"]: i.get("stand_in", []) for i in bar["ingredients"]}
    by_id = {i["id"]: i for i in bar["ingredients"]}
    pours = pours_of(menu)

    missing = [iid for iid in README_SHELF if iid not in by_id]
    if missing:
        print("  STATS  not in the bar: " + ", ".join(missing))
        return 1

    held = set(README_SHELF)
    base, top = gains(bar, pours, held, stand_in)
    n = len(menu["cocktails"])
    counts = ", ".join(
        f"{sum(1 for d in menu['cocktails'] if d['method'] == m['id'])} {m['id']}"
        for m in menu["methods"])

    print(f"  stats   {n} drinks ({counts}), "
          f"{len(bar['ingredients'])} ingredients")
    print(f"          shelf of {len(held)}: " +
          ", ".join(by_id[i]["short"] for i in README_SHELF))
    print(f"          pours {base}; next " +
          ", ".join(f"{i['short']} +{n}" for n, i in top[:3]))
    print()
    floor = n // 50 * 50
    many = f"Over {WORDS[floor]}" if floor in WORDS else str(n)
    methods = llms.COUNT_WORDS.get(len(menu["methods"]),
                                   str(len(menu["methods"]))).lower()
    print(f"{many} classics, {methods} methods, one small bar")
    print(sentence(base, top))
    return 0


if __name__ == "__main__":
    sys.exit(main())
