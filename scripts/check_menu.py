#!/usr/bin/env python3
"""The menu has to agree with itself.

Every cocktail carries both a `code` (the house shorthand, exactly as it is
printed) and a `build` (the same drink spelled out). Those are two hands
writing the same thing, so they can drift. This regenerates the code from
the build and refuses any drink where the two disagree — which is the only
way a typo in a hundred-odd shorthand strings ever gets caught.

It also checks that every ingredient is a bottle the bar actually stocks,
and that every serve token decodes to a real glass and real garnishes.
A garnish is stocked like any other bottle: the letter is in the serve
token rather than the build, but the lemon it costs is a lemon either way,
so the bottle it calls for counts as used. Whether a missing garnish stops
you pouring is the app's question, not this one — here it only has to be a
bottle something wants.

`bottles` on an ingredient is the shopping list for that type. Brand ids
are unique across the bar. `catalog` marks a type that is on the shopping
list before any drink calls for it — those still need bottles, or they
are the same quiet drift the unused-ingredient check is for.

Taste, history, and refs are optional until the research tickets finish.
If they are present they have to be the right shape, and a fourth invention
on a cocktail object is a fail.
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

COCKTAIL_KEYS = {
    "id", "name", "method", "family", "code", "serve", "build",
    "taste", "history", "refs",
}
REF_KEYS = {"title", "url"}
INGREDIENT_KEYS = {
    "id", "name", "short", "kind", "unit", "staple", "shelf", "notes",
    "bottles", "catalog",
}
NOTES_KEYS = {"parts", "copy"}
PART_KEYS = {"amt", "item"}
BOTTLE_KEYS = {"id", "name", "size", "price", "tier"}
BOTTLE_TIERS = {
    "solid", "elevated", "excellent", "exceptional", "alternatives",
}
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
HTML = re.compile(r"<[^>]+>")
MD_LINK = re.compile(r"\[[^\]]+\]\([^)]+\)")


def load(name):
    return json.loads((ROOT / "data" / name).read_text())


def garnish_tokens(notation):
    """Longest first, so 'ccin' splits as cin and not c + i + n."""
    codes = [g["code"] for g in notation["garnishes"]]
    return sorted(codes, key=len, reverse=True)


def garnish_bottles(notation):
    """Which bottle each garnish letter calls for, where it calls for one.

    '3' is the exception and has none: those bitters are already written
    into the build with a "g" flag, and counting them here would count them
    twice.
    """
    return {g["code"]: g["ingredient"] for g in notation["garnishes"]
            if g.get("ingredient")}


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


def check_ingredient_notes(i, errs):
    """Optional house recipe on a bottle. The row still ticks the shelf."""
    who = i.get("id", "<no id>")
    extra = sorted(set(i) - INGREDIENT_KEYS)
    for k in extra:
        errs.append(f"bar {who}: unknown key {k!r}")

    catalog = i.get("catalog")
    if catalog is not None and catalog is not True:
        errs.append(f"bar {who}: catalog must be true if present")

    notes = i.get("notes")
    if notes is None:
        return
    if not isinstance(notes, dict):
        errs.append(f"bar {who}: notes must be an object")
        return
    extra = sorted(set(notes) - NOTES_KEYS)
    for k in extra:
        errs.append(f"bar {who}: notes unknown key {k!r}")

    copy = notes.get("copy")
    if not isinstance(copy, str) or not copy.strip():
        errs.append(f"bar {who}: notes.copy must be a non-empty string")
    elif HTML.search(copy):
        errs.append(f"bar {who}: notes.copy contains HTML")

    if "parts" not in notes:
        return
    parts = notes["parts"]
    if not isinstance(parts, list) or not parts:
        errs.append(f"bar {who}: notes.parts must be a non-empty array")
        return
    for n, p in enumerate(parts):
        if not isinstance(p, dict):
            errs.append(f"bar {who}: notes.parts[{n}] is not an object")
            continue
        extra = sorted(set(p) - PART_KEYS)
        for k in extra:
            errs.append(f"bar {who}: notes.parts[{n}] unknown key {k!r}")
        for field in ("amt", "item"):
            val = p.get(field)
            if not isinstance(val, str) or not val.strip():
                errs.append(f"bar {who}: notes.parts[{n}].{field} must be a non-empty string")


def check_ingredient_bottles(i, errs, seen_brands):
    """Optional shopping list. Brand ids are unique across the whole bar."""
    who = i.get("id", "<no id>")
    bottles = i.get("bottles")
    catalog = i.get("catalog") is True

    if catalog and not bottles:
        errs.append(f"bar {who}: catalog ingredient has no bottles")

    if bottles is None:
        return
    if not isinstance(bottles, list) or not bottles:
        errs.append(f"bar {who}: bottles must be a non-empty array")
        return

    for n, b in enumerate(bottles):
        loc = f"bar {who}: bottles[{n}]"
        if not isinstance(b, dict):
            errs.append(f"{loc} is not an object")
            continue
        extra = sorted(set(b) - BOTTLE_KEYS)
        for k in extra:
            errs.append(f"{loc} unknown key {k!r}")

        bid = b.get("id")
        if not isinstance(bid, str) or not SLUG.fullmatch(bid):
            errs.append(f"{loc}.id is not a slug")
        elif bid == who:
            errs.append(f"{loc}.id {bid!r} collides with the ingredient")
        elif bid in seen_brands:
            errs.append(f"{loc}.id {bid!r} is reused")
        else:
            seen_brands.add(bid)

        name = b.get("name")
        if not isinstance(name, str) or not name.strip():
            errs.append(f"{loc}.name must be a non-empty string")
        elif HTML.search(name):
            errs.append(f"{loc}.name contains HTML")

        tier = b.get("tier")
        if tier not in BOTTLE_TIERS:
            errs.append(f"{loc}.tier {tier!r} is not a known tier")

        if "size" in b:
            size = b["size"]
            if not isinstance(size, str) or not size.strip():
                errs.append(f"{loc}.size must be a non-empty string")

        if "price" in b:
            price = b["price"]
            if not isinstance(price, int) or isinstance(price, bool) or price < 0:
                errs.append(f"{loc}.price must be a non-negative integer")


def check_notes(d, who, errs):
    """Optional taste / history / refs, when present, have to be the contract.

    They are not required on every drink yet. A stray key is, because the
    research tickets write into these three and nowhere else.
    """
    extra = sorted(set(d) - COCKTAIL_KEYS)
    for k in extra:
        errs.append(f"{who}: unknown key {k!r}")

    for field in ("taste", "history"):
        if field not in d:
            continue
        val = d[field]
        if not isinstance(val, str) or not val.strip():
            errs.append(f"{who}: {field} must be a non-empty string")
            continue
        if HTML.search(val):
            errs.append(f"{who}: {field} contains HTML")
        if field == "history" and MD_LINK.search(val):
            errs.append(f"{who}: history contains a markdown link")

    if "refs" not in d:
        return
    refs = d["refs"]
    if not isinstance(refs, list):
        errs.append(f"{who}: refs must be an array")
        return
    for i, item in enumerate(refs):
        if not isinstance(item, dict):
            errs.append(f"{who}: refs[{i}] is not an object")
            continue
        extra = sorted(set(item) - REF_KEYS)
        for k in extra:
            errs.append(f"{who}: refs[{i}] unknown key {k!r}")
        title = item.get("title")
        url = item.get("url")
        if not isinstance(title, str) or not title.strip():
            errs.append(f"{who}: refs[{i}] title must be a non-empty string")
        if not isinstance(url, str) or not url.strip():
            errs.append(f"{who}: refs[{i}] url must be a non-empty string")
        elif not url.startswith("https://"):
            errs.append(f"{who}: refs[{i}] url must start with https://")


def main():
    bar = load("bar.json")
    notation = load("notation.json")
    menu = load("cocktails.json")

    stocked = {i["id"] for i in bar["ingredients"]}
    unmeasured = {i["id"] for i in bar["ingredients"] if i.get("unit") == "none"}
    families = {f["id"] for f in menu["families"]}
    methods = {m["id"] for m in menu["methods"]}
    gcodes = garnish_tokens(notation)
    gbottle = garnish_bottles(notation)

    errs = []
    copy = bar.get("bottles_copy")
    if copy is not None:
        if not isinstance(copy, str) or not copy.strip():
            errs.append("bar: bottles_copy must be a non-empty string")
        elif HTML.search(copy):
            errs.append("bar: bottles_copy contains HTML")

    seen_brands = set()
    for i in bar["ingredients"]:
        check_ingredient_notes(i, errs)
        check_ingredient_bottles(i, errs, seen_brands)
    for code, ingredient in sorted(gbottle.items()):
        if ingredient not in stocked:
            errs.append(f"notation: garnish {code!r} calls for {ingredient!r}, "
                        f"which is not in the bar")
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

        check_notes(d, who, errs)

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
        else:
            got = split_garnish(serve[1:], gcodes)
            if got is None:
                errs.append(f"{who}: cannot read garnish in serve {serve!r}")
            else:
                # The bottle a garnish calls for counts as used, or every
                # garnish on the shelf reads as one nothing asks for.
                used.update(gbottle[c] for c in got if c in gbottle)

        # ── the two hands agree ──────────────────────────────────
        rebuilt = ",".join(parts + [serve])
        if rebuilt != d["code"]:
            errs.append(f"{who}: code {d['code']!r} but build spells {rebuilt!r}")

    by_id = {i["id"]: i for i in bar["ingredients"]}
    for iid in sorted(stocked):
        catalog = by_id[iid].get("catalog") is True
        if iid in used:
            if catalog:
                errs.append(f"bar {iid}: catalog but a drink calls for it")
            continue
        if catalog:
            continue
        errs.append(f"bar: {iid} is stocked but no drink calls for it")

    for e in errs:
        print(f"  MENU  {e}")
    if errs:
        return 1

    n = len(menu["cocktails"])
    st = sum(1 for d in menu["cocktails"] if d["method"] == "stirred")
    ng = sum(1 for i in bar["ingredients"] if i["kind"] == "garnish")
    nb = sum(1 for i in bar["ingredients"] if i.get("bottles"))
    nc = sum(1 for i in bar["ingredients"] if i.get("catalog") is True)
    print(f"  menu    {n} drinks ({st} stirred, {n - st} shaken), "
          f"{len(stocked)} ingredients ({ng} garnish, {nc} catalog, "
          f"{nb} with bottles, {len(seen_brands)} brands, "
          f"{len(gbottle)} letters that call for one), every code checks out")
    return 0


if __name__ == "__main__":
    sys.exit(main())
