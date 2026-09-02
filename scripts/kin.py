#!/usr/bin/env python3
"""Shape, not bottles.

The printed card files drinks by the section they sit under — gin, rye,
apple brandy. That is `family`, and it stays that. This script cuts the
same menu the other way: by the job each bottle does and how much of it
gets poured. A Martini and a Manhattan share almost no bottles and share
almost the whole shape, and that is the point.

Two products, both written to data/kin.json:

- A **pattern** is a named family of that shape (Martini, Sour, Daisy).
  Named after the drink people already know, with the oldest parent
  mentioned in the blurb.
- **Kin** of a drink are the nearest others in that family — same pour
  in different bottles, or one bottle swapped. The why-line is the swap.

The classifier is the default. OVERRIDE is the handful of drinks where a
squeeze of lemon or a second brandy would fool a ratio; the build is
still the input, the override is just the filing.

`python3 scripts/kin.py` writes the file.
`python3 scripts/kin.py --check` refuses a drift, which is what verify
runs. Same bargain as code vs build.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "kin.json"

KIN_MAX = 8

# A liqueur or juice below this is an accent (barspoon, squeeze, rinse),
# not a pillar of the shape.
PILLAR = 0.35
# Campari at a quarter ounce is a film (Jasmine, Hat Tip). A Negroni
# pours it as a third of the drink.
CAMPARI_PILLAR = 0.4

# Drinks the ratio would file in the wrong family. Keep this small; if it
# grows, the classifier is the thing that is wrong.
OVERRIDE = {
    # A quarter ounce of lemon in a Martinez. The citrus is a squeeze,
    # the drink is still spirit-and-vermouth.
    "journalist": "martini",
    # Two bases, grenadine, and a quarter of absinthe. No juice, no
    # vermouth, no bitters — the classifier has nothing to hang a
    # family on. It drinks as a Fancy: spirit and a sweetener, dressed.
    "dempsey": "fancy",
    # A quarter ounce of Fernet reads as a liqueur pillar, so the
    # classifier files a Fancy. It is an Old-Fashioned: rye, sugar,
    # bitters, with Fernet in the bitter slot.
    "toronto": "old-fashioned",
}

# Modifier bottles play four different jobs, and `kind: modifier` cannot
# tell them apart. Campari is a pillar; absinthe is an accent; champagne
# is a top; the rest are liqueurs in the sugar slot.
MOD_ROLE = {
    "campari": "bitter",
    "absinthe": "absinthe",
    "champagne": "sparkling",
    "ginger-beer": "sparkling",
    "orange-liqueur": "liqueur",
    "maraschino": "liqueur",
    "benedictine": "liqueur",
    "apricot": "liqueur",
    "elderflower": "liqueur",
    "chartreuse": "liqueur",
    "fernet": "liqueur",
    "creme-de-cacao": "liqueur",
    "cream": "liqueur",
    "cynar": "bitter",
    "sherry": "vermouth",
}

KIND_ROLE = {
    "base": "spirit",
    "vermouth": "vermouth",
    "bitters": "bitters",
    "syrup": "syrup",
    "juice": "citrus",
    "other": "egg",
}

# Structural families, in the order the Families view prints them.
# `namesake` is the drink the family is named after, and the one that
# sorts first inside it.
PATTERNS = [
    {
        "id": "martini",
        "label": "Martini",
        "namesake": "martini",
        "blurb": "Spirit and vermouth. The Manhattan is this drink in whiskey; the Martinez is the parent with maraschino in it.",
    },
    {
        "id": "sour",
        "label": "Sour",
        "namesake": "daiquiri",
        "blurb": "Spirit, citrus, and sugar. The Daiquiri, the Gimlet, and the Whiskey Sour are the same pour.",
    },
    {
        "id": "daisy",
        "label": "Daisy",
        "namesake": "sidecar",
        "blurb": "A sour with a liqueur in the sugar slot. Sidecar, Margarita, White Lady.",
    },
    {
        "id": "negroni",
        "label": "Negroni",
        "namesake": "negroni",
        "blurb": "Spirit, Campari, and vermouth. The Boulevardier is this drink in bourbon.",
    },
    {
        "id": "old-fashioned",
        "label": "Old-Fashioned",
        "namesake": "old-fashioned",
        "blurb": "Spirit, sugar, and bitters. The Sazerac and the Improved Coctail dress it.",
    },
    {
        "id": "fancy",
        "label": "Fancy",
        "namesake": "fancy-cocktail",
        "blurb": "Spirit, a liqueur, and bitters. The sugar slot is the liqueur.",
    },
    {
        "id": "vermouth",
        "label": "Vermouth",
        "namesake": "duplex",
        "blurb": "Vermouth is the drink.",
    },
    {
        "id": "sparkling",
        "label": "Sparkling",
        "namesake": "french-75",
        "blurb": "A sour with champagne in it. The French 75 is the one people know.",
    },
]


def load(name):
    return json.loads((ROOT / "data" / name).read_text())


def dumps(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


# ── amounts ─────────────────────────────────────────────────

# Same tokens as notation.json / the JS decoder. Bitters have to be
# classified *before* the ounce table, or a `1` next to orange bitters
# reads as an ounce.
OZ = {
    "2": 2, "1": 1, "Q": 0.75, "h": 0.5, "q": 0.25,
    "1h": 1.5, "1q": 1.25, "1Q": 1.75, "2h": 2.5,
}
BARSPOON = 0.125


def to_oz(token, unit):
    """Ounces for ratio math. Dashes, rinses, and unmeasured things
    return 0 — they are flags, not volume. Ten dashes of Angostura is
    still bitters, not a third of a Manhattan."""
    if token is None:
        return 0.0
    if token == "r":
        return 0.0
    m = re.fullmatch(r"(\d*)b", token)
    if m:
        return int(m.group(1) or 1) * BARSPOON
    m = re.fullmatch(r"(\d*)d", token)
    if m:
        return 0.0
    if token.isdigit() and unit == "dash":
        return 0.0
    if token in OZ:
        return OZ[token]
    if token.isdigit():
        return float(token)
    raise ValueError(f"cannot read amount {token!r}")


def role_of(ing):
    kind = ing["kind"]
    if kind == "modifier":
        try:
            return MOD_ROLE[ing["id"]]
        except KeyError as e:
            raise SystemExit(
                f"kin: {ing['id']!r} is a modifier with no role — "
                f"add it to MOD_ROLE in scripts/kin.py"
            ) from e
    if kind == "garnish":
        return None
    return KIND_ROLE[kind]


def say(ing):
    """The word that goes in a why-line.

    Bases and vermouths take the lowercased name so the line reads
    `gin for bourbon`. Brands keep their capitals so it reads
    `Campari for Angostura`.
    """
    iid = ing["id"]
    if iid in ("campari", "benedictine", "champagne", "fernet", "cynar", "chartreuse"):
        return ing["name"]
    if iid == "orange-bitters":
        return "orange bitters"
    if ing["kind"] == "bitters":
        return ing["short"]
    return ing["name"].lower()


def snap(oz):
    """Quarter-ounce bins, so 1.5 and 1.75 do not look like different
    species and a barspoon does not look like a pour."""
    if oz <= 0:
        return 0
    return round(oz * 4) / 4


# ── per drink ───────────────────────────────────────────────

def analyse(d, by_id):
    bags = defaultdict(float)
    flags = set()
    bottles = []  # (id, role, oz)

    for entry in d["build"]:
        iid, amt = entry[0], entry[1]
        ing = by_id[iid]
        role = role_of(ing)
        if role is None:
            continue
        oz = to_oz(amt, ing.get("unit"))
        bags[role] += oz
        bottles.append((iid, role, oz))
        if role in ("bitters", "absinthe", "egg") or amt is None:
            flags.add(role)
        if amt == "r":
            flags.add("rinse")

    spirit = bags["spirit"]
    vermouth = bags["vermouth"]
    citrus = bags["citrus"]
    syrup = bags["syrup"]
    liqueur = bags["liqueur"]
    bitter = bags["bitter"]
    sparkling = bags["sparkling"]

    # Vermouth as the base (Duplex, Dry Vermouth Sour): there is no
    # spirit bottle, so the vermouth *is* the drink. Leave bags as they
    # are — the classifier branches on spirit==0 separately.

    if sparkling >= PILLAR:
        pattern = "sparkling"
    elif bitter >= CAMPARI_PILLAR and vermouth >= CAMPARI_PILLAR:
        pattern = "negroni"
    elif citrus >= 0.2 and liqueur >= 0.25 and vermouth < PILLAR:
        # A Crusta's lemon is a quarter ounce, still a daisy. Journalist
        # has the same squeeze but also a full pour of vermouth, so it
        # stays a Martini (and OVERRIDE says so).
        pattern = "daisy"
    elif citrus >= PILLAR:
        # A real juice pour takes the drink out of the Martini family
        # even if vermouth is in the glass (Derby, Scofflaw).
        if liqueur >= 0.25 and liqueur >= syrup:
            pattern = "daisy"
        else:
            pattern = "sour"
    elif vermouth >= PILLAR and spirit >= PILLAR:
        pattern = "martini"
    elif vermouth >= PILLAR and spirit < PILLAR:
        pattern = "vermouth"
    elif (syrup >= 0.05 or liqueur >= 0.1) and "bitters" in flags and citrus < PILLAR:
        # Barspoon of liqueur is an Improved Cocktail, still an
        # Old-Fashioned. A quarter ounce or more in the sugar slot is a
        # Fancy.
        if liqueur >= 0.25 and liqueur >= syrup:
            pattern = "fancy"
        else:
            pattern = "old-fashioned"
    elif liqueur >= 0.25 and citrus < PILLAR:
        pattern = "fancy"
    else:
        pattern = "other"

    skeleton = []
    for role in ("spirit", "vermouth", "bitter", "liqueur", "syrup",
                 "citrus", "sparkling"):
        q = snap(bags[role])
        if q:
            skeleton.append(f"{role}:{q:g}")
    for flag in ("bitters", "absinthe", "egg"):
        if flag in flags:
            skeleton.append(flag)
    skeleton = "+".join(skeleton) or "empty"

    vec = [
        snap(spirit), snap(vermouth), snap(bitter), snap(liqueur),
        snap(syrup), snap(citrus), snap(sparkling),
        1.0 if "bitters" in flags else 0.0,
        1.0 if "absinthe" in flags else 0.0,
        1.0 if "egg" in flags else 0.0,
    ]

    return {
        "id": d["id"],
        "name": d["name"],
        "pattern": OVERRIDE.get(d["id"], pattern),
        "classified": pattern,
        "skeleton": skeleton,
        "bags": dict(bags),
        "flags": flags,
        "bottles": bottles,
        "vec": vec,
        "build_ids": [p[0] for p in d["build"] if by_id[p[0]]["kind"] != "garnish"],
    }


def dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a["vec"], b["vec"])) ** 0.5


def bottle_set(row):
    return frozenset(row["build_ids"])


def one_swap(a, b):
    A, B = bottle_set(a), bottle_set(b)
    return len(A) == len(B) and len(A - B) == 1 and len(B - A) == 1


def phrase(ids, ingredients):
    names = [say(ingredients[i]) for i in ids]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return ", ".join(names[:-1]) + ", and " + names[-1]


def same_bottles_why(focus, other, ingredients):
    """Same set of bottles, different pour — say what actually moved."""
    f = {i: oz for i, _role, oz in focus["bottles"]}
    o = {i: oz for i, _role, oz in other["bottles"]}
    changes = sorted(
        ((abs(o[i] - f[i]), i) for i in f if i in o and abs(o[i] - f[i]) >= 0.2),
        reverse=True,
    )
    if not changes:
        return "the same pour"
    iid = changes[0][1]
    name = say(ingredients[iid])
    return f"more {name}" if o[iid] > f[iid] else f"less {name}"


def why(focus, other, ingredients):
    """`other` in terms of `focus`: what you swap to get there."""
    lost = [i for i in focus["build_ids"] if i not in other["build_ids"]]
    gained = [i for i in other["build_ids"] if i not in focus["build_ids"]]

    if not lost and not gained:
        return same_bottles_why(focus, other, ingredients)

    def roles(ids):
        g = defaultdict(list)
        for i in ids:
            g[role_of(ingredients[i])].append(i)
        return g

    lr, gr = roles(lost), roles(gained)
    order = ("spirit", "vermouth", "citrus", "liqueur", "syrup",
             "bitter", "sparkling", "absinthe", "bitters", "egg")
    # A true swap is the same job in both glasses (gin for bourbon).
    both = [r for r in order if r in lr and r in gr]
    big = [r for r in both if r not in ("bitters", "egg")]
    g_only = [r for r in order if r in gr and r not in lr
              and r not in ("bitters", "egg")]
    l_only = [r for r in order if r in lr and r not in gr
              and r not in ("bitters", "egg")]

    def swapped(roles_):
        g_parts, l_parts = [], []
        for r in roles_[:2]:
            g_parts.extend(gr[r])
            l_parts.extend(lr[r])
        return f"{phrase(g_parts, ingredients)} for {phrase(l_parts, ingredients)}"

    # Spirit/vermouth/juice first; a dash of bitters is not the story
    # when maraschino also walked in.
    if big:
        return swapped(big)
    if g_only:
        ids = []
        for r in g_only[:2]:
            ids.extend(gr[r])
        return f"with {phrase(ids, ingredients)}"
    if both:
        return swapped(both)
    if l_only:
        ids = []
        for r in l_only[:2]:
            ids.extend(lr[r])
        return f"without {phrase(ids, ingredients)}"
    if gained:
        return f"with {phrase(gained, ingredients)}"
    if lost:
        return f"without {phrase(lost, ingredients)}"
    return "same shape"


def kin_of(focus, rows, ingredients):
    scored = []
    for other in rows:
        if other["id"] == focus["id"]:
            continue
        same_sk = other["skeleton"] == focus["skeleton"]
        swap = one_swap(focus, other)
        same_pat = other["pattern"] == focus["pattern"]
        d = dist(focus, other)
        if same_sk:
            rank = (0, d, other["id"])
        elif swap and same_pat:
            rank = (1, d, other["id"])
        elif same_pat:
            rank = (2, d, other["id"])
        elif same_sk or (swap and d < 1.2):
            rank = (3, d, other["id"])
        else:
            continue
        scored.append((rank, other))
    scored.sort(key=lambda t: t[0])

    # Same family first, then fill from very near neighbours if the
    # family is tiny.
    out = []
    seen = set()
    for _, other in scored:
        if other["pattern"] != focus["pattern"]:
            continue
        out.append(other)
        seen.add(other["id"])
        if len(out) >= KIN_MAX:
            return out
    if len(out) < 3:
        for _, other in scored:
            if other["id"] in seen:
                continue
            out.append(other)
            if len(out) >= 3:
                break
    return out[:KIN_MAX]


def member_order(pattern_id, namesake, rows):
    family = [r for r in rows if r["pattern"] == pattern_id]
    by_id = {r["id"]: r for r in family}
    head = by_id.get(namesake)
    rest = [r for r in family if r["id"] != namesake]
    if head:
        rest.sort(key=lambda r: (r["skeleton"] != head["skeleton"],
                                 dist(head, r), r["name"].lower()))
        return [head] + rest
    rest.sort(key=lambda r: r["name"].lower())
    return rest


def build():
    bar = load("bar.json")
    menu = load("cocktails.json")
    ingredients = {i["id"]: i for i in bar["ingredients"]}
    cocktails = menu["cocktails"]
    cocktail_ids = {d["id"] for d in cocktails}

    for p in PATTERNS:
        if p["namesake"] not in cocktail_ids:
            raise SystemExit(f"kin: namesake {p['namesake']!r} is not on the menu")
    for cid, pat in OVERRIDE.items():
        if cid not in cocktail_ids:
            raise SystemExit(f"kin: OVERRIDE {cid!r} is not on the menu")
        if pat not in {p["id"] for p in PATTERNS} and pat != "other":
            raise SystemExit(f"kin: OVERRIDE {cid!r} points at unknown pattern {pat!r}")

    rows = [analyse(d, ingredients) for d in cocktails]
    by_row = {r["id"]: r for r in rows}

    others = [r for r in rows if r["pattern"] == "other"]
    if others:
        names = ", ".join(r["name"] for r in others)
        raise SystemExit(
            f"kin: unclassified drinks, add an OVERRIDE or fix the classifier: {names}"
        )

    patterns_out = []
    for p in PATTERNS:
        members = member_order(p["id"], p["namesake"], rows)
        if not members:
            continue
        patterns_out.append({
            "id": p["id"],
            "label": p["label"],
            "blurb": p["blurb"],
            "namesake": p["namesake"],
            "members": [r["id"] for r in members],
        })

    drinks_out = {}
    for d in cocktails:
        row = by_row[d["id"]]
        kin = kin_of(row, rows, ingredients)
        drinks_out[d["id"]] = {
            "pattern": row["pattern"],
            "kin": [{"id": k["id"], "why": why(row, k, ingredients)} for k in kin],
        }

    filed = {i for p in patterns_out for i in p["members"]}
    missing = [d["id"] for d in cocktails if d["id"] not in filed]
    if missing:
        raise SystemExit("kin: not filed: " + ", ".join(missing))
    for cid, info in drinks_out.items():
        for k in info["kin"]:
            if k["id"] not in cocktail_ids:
                raise SystemExit(f"kin: {cid} names unknown neighbour {k['id']!r}")

    return {
        "note": "Computed from the builds. Regenerated by scripts/kin.py; make verify refuses a drift.",
        "patterns": patterns_out,
        "drinks": drinks_out,
    }, rows


def report(obj, rows):
    by_pat = defaultdict(list)
    for r in rows:
        by_pat[r["pattern"]].append(r)
    n = len(rows)
    print(f"  kin     {n} drinks in {len(obj['patterns'])} families")
    for p in obj["patterns"]:
        xs = by_pat[p["id"]]
        print(f"          {p['label']:16s} {len(xs):3d}")
    over = [r for r in rows if r["id"] in OVERRIDE]
    if over:
        print(f"          {len(over)} override(s): " +
              ", ".join(f"{r['name']}→{r['pattern']}" for r in over))


def main(argv):
    check = "--check" in argv
    obj, rows = build()
    text = dumps(obj)

    if check:
        if not OUT.exists():
            print(f"  KIN    {OUT.relative_to(ROOT)} is missing — run python3 scripts/kin.py")
            return 1
        current = OUT.read_text()
        if current != text:
            print(f"  KIN    {OUT.relative_to(ROOT)} is stale — run python3 scripts/kin.py")
            return 1
        report(obj, rows)
        return 0

    OUT.write_text(text)
    report(obj, rows)
    print(f"          wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
