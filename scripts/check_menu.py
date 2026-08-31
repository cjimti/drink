#!/usr/bin/env python3
"""The menu has to agree with itself.

Every cocktail carries both a `code` (the house shorthand, exactly as it is
printed) and a `build` (the same drink spelled out). Those are two hands
writing the same thing, so they can drift. This regenerates the code from
the build and refuses any drink where the two disagree — which is the only
way a typo in a hundred-odd shorthand strings ever gets caught.

It also checks that every ingredient is a bottle the bar actually stocks,
and that every serve token decodes to a real glass and real garnishes.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# An amount token. Order matters: the two-part forms must be tried first or
# "1h" reads as a bare 1 with trailing junk.
AMOUNT = re.compile(r"""
    ^(?:
        \d+[hqQ]      # 1h 1q 1Q 2h — whole ounces plus a fraction
      | [hqQ]         # h q Q       — a bare fraction
      | \d*[bd]       # 2b b 1d d   — barspoons, dashes
      | r             # r           — a rinse
      | \d+           # 2 10        — ounces, or dashes next to bitters
    )$
""", re.X)

GLASSES = set("crR")


def load(name):
    return json.loads((ROOT / "data" / name).read_text())


def garnish_tokens(notation):
    """Longest first, so 'ccin' splits as cin and not c + i + n."""
    codes = [g["code"] for g in notation["garnishes"]]
    return sorted(codes, key=len, reverse=True)


def split_garnish(rest, codes):
    out = []
    while rest:
        for c in codes:
            if rest.startswith(c):
                out.append(c)
                rest = rest[len(c):]
                break
        else:
            return None
    return out


def main():
    bar = load("bar.json")
    notation = load("notation.json")
    menu = load("cocktails.json")

    stocked = {i["id"] for i in bar["ingredients"]}
    unmeasured = {i["id"] for i in bar["ingredients"] if i.get("unit") == "none"}
    families = {f["id"] for f in menu["families"]}
    methods = {m["id"] for m in menu["methods"]}
    gcodes = garnish_tokens(notation)

    errs = []
    seen = set()
    used = set()

    for d in menu["cocktails"]:
        who = d.get("id", "<no id>")

        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", who):
            errs.append(f"{who}: id is not a slug")
        if who in seen:
            errs.append(f"{who}: duplicate id")
        seen.add(who)

        if d["method"] not in methods:
            errs.append(f"{who}: unknown method {d['method']!r}")
        if d["family"] not in families:
            errs.append(f"{who}: unknown family {d['family']!r}")

        # ── the build ────────────────────────────────────────────
        parts = []
        for entry in d["build"]:
            ing, amt = entry[0], entry[1]
            flag = entry[2] if len(entry) > 2 else None

            if ing not in stocked:
                errs.append(f"{who}: {ing!r} is not in the bar")
            used.add(ing)

            if amt is None:
                if ing not in unmeasured:
                    errs.append(f"{who}: {ing} needs an amount")
                continue
            if not AMOUNT.match(amt):
                errs.append(f"{who}: cannot read amount {amt!r} for {ing}")
            # A garnish-flagged pour is written into the serve token instead,
            # so it must not also appear among the comma-separated amounts.
            if flag != "g":
                parts.append(amt)

        # ── the serve token ──────────────────────────────────────
        serve = d["serve"]
        if not serve or serve[0] not in GLASSES:
            errs.append(f"{who}: serve {serve!r} does not start with a glass")
        elif split_garnish(serve[1:], gcodes) is None:
            errs.append(f"{who}: cannot read garnish in serve {serve!r}")

        # ── the two hands agree ──────────────────────────────────
        rebuilt = ",".join(parts + [serve])
        if rebuilt != d["code"]:
            errs.append(f"{who}: code {d['code']!r} but build spells {rebuilt!r}")

    for i in sorted(stocked - used):
        errs.append(f"bar: {i} is stocked but no drink calls for it")

    for e in errs:
        print(f"  MENU  {e}")
    if errs:
        return 1

    n = len(menu["cocktails"])
    st = sum(1 for d in menu["cocktails"] if d["method"] == "stirred")
    print(f"  menu    {n} drinks ({st} stirred, {n - st} shaken), "
          f"{len(stocked)} ingredients, every code checks out")
    return 0


if __name__ == "__main__":
    sys.exit(main())
