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

`bit` on an ingredient is its place in a shared shelf code — the decimal
integer in a fewbottles.com/?s= link, bit N set meaning ingredient N is on
the shelf. Those links live in other people's message threads, so a bit is
assigned once and never moved or reused. A dropped ingredient's bit goes
into `retired_bits` so it cannot be handed out again.

`bottles` on an ingredient is the shopping list for that type. Brand ids
are unique across the bar. `catalog` marks a type that is on the shopping
list before any drink calls for it — those still need bottles, or they
are the same quiet drift the unused-ingredient check is for.

`stand_in` on an ingredient is the short list of bottles the house will pour
in its place. It is a hard gate turned soft where soft is honest: the card
writes the Old-Fashioned with demerara, and a beginner holding simple syrup
can still pour it. The list is tiny on purpose and every direction is written
out on its own, so it never gets inferred back the other way by accident.

`shelves` are the named starting points on the Bar tab. Each is a list of
ingredient ids and nothing more — what a preset pours is counted live by the
app — so the only thing here that can rot is a name that no longer exists.

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
      | t             # t           — top with the mixer
      | \d+           # 2 10        — ounces, or dashes next to bitters
    )$
""", re.X)

GLASSES = set("crRhH")

# What a `t` is allowed to sit beside. Mixers are the whole point of the
# token. Champagne is the exception because it is filed as a modifier: the
# French 75 and the Air Mail pour it by the ounce into a shaken drink, so
# it cannot be a mixer, yet a Sbagliato does top with it.
TOPPABLE = {"champagne"}
TOPPABLE_KINDS = {"mixer"}

COCKTAIL_KEYS = {
    "id", "name", "method", "family", "code", "serve", "build",
    "taste", "history", "refs",
}
REF_KEYS = {"title", "url"}
INGREDIENT_KEYS = {
    "id", "name", "short", "kind", "unit", "staple", "shelf", "notes",
    "bottles", "catalog", "bit", "stand_in",
}
NOTES_KEYS = {"parts", "copy"}
PART_KEYS = {"amt", "item"}
BOTTLE_KEYS = {"id", "name", "size", "price", "tier"}
BOTTLE_TIERS = {
    "solid", "elevated", "excellent", "exceptional", "alternatives",
}
SHELF_KEYS = {"id", "label", "blurb", "ingredients"}
METHOD_KEYS = {"id", "label", "blurb", "how", "how_dry"}

# The glass letters that arrive packed with ice, as app.js reads them.
ICED_GLASSES = {"R", "H"}

# The method made in the glass it is served in, which is the only one
# whose instruction changes with the glass: a Gin and Tonic is built over
# ice and a Champagne Cocktail into a dry flute. Stirred and shaken keep
# their ice in the mixing glass, so one line covers both for them. A
# fourth in-glass method joins the set here and brings a `how_dry`.
IN_GLASS = {"built"}
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


def check_bits(bar, errs):
    """Every ingredient has a bit, no two share one, none is retired.

    The bit is what a shared link encodes, so this is the same kind of
    promise as a cocktail id: stable forever. Gaps are fine — a retired
    bit is a gap on purpose.
    """
    retired = bar.get("retired_bits")
    if not isinstance(retired, list) or any(
            not isinstance(b, int) or isinstance(b, bool) or b < 0 for b in retired):
        errs.append("bar: retired_bits must be an array of non-negative integers")
        retired = []
    retired = set(retired)

    seen = {}
    for i in bar["ingredients"]:
        who = i.get("id", "<no id>")
        bit = i.get("bit")
        if not isinstance(bit, int) or isinstance(bit, bool) or bit < 0:
            errs.append(f"bar {who}: bit must be a non-negative integer")
            continue
        if bit in retired:
            errs.append(f"bar {who}: bit {bit} is retired")
        if bit in seen:
            errs.append(f"bar {who}: bit {bit} is already {seen[bit]}'s")
        seen[bit] = who


def check_stand_ins(bar, errs):
    """What the house will pour in place of what the card asks for.

    A stand-in is close enough that the drink is still the drink, which is
    why it has to be the same kind of bottle: a syrup for a syrup, never a
    syrup for a gin. Each direction is its own line. Simple and demerara
    happen to name each other today, but the day one of them stands in and
    the reverse does not, the file says so rather than the code inferring it.
    """
    kinds = {i["id"]: i.get("kind") for i in bar["ingredients"]}

    for i in bar["ingredients"]:
        who = i.get("id", "<no id>")
        subs = i.get("stand_in")
        if subs is None:
            continue
        if not isinstance(subs, list) or not subs:
            errs.append(f"bar {who}: stand_in must be a non-empty array")
            continue
        seen = set()
        for sid in subs:
            if not isinstance(sid, str):
                errs.append(f"bar {who}: stand_in must be ingredient ids")
                continue
            if sid == who:
                errs.append(f"bar {who}: stand_in names itself")
            elif sid not in kinds:
                errs.append(f"bar {who}: stand_in {sid!r} is not in the bar")
            elif kinds[sid] != kinds.get(who):
                errs.append(f"bar {who}: stand_in {sid} is a "
                            f"{kinds[sid]}, not a {kinds.get(who)}")
            if sid in seen:
                errs.append(f"bar {who}: stand_in {sid} is listed twice")
            seen.add(sid)


def check_shelves(bar, errs):
    """Named starting points on the Bar tab, when the file carries any.

    A preset is a list of ingredient ids and nothing else: how many drinks
    it pours is the app's live count, never a number written down here. So
    the only thing that can rot is a name, and a preset that ticks a bottle
    the bar does not have would silently tick nothing.
    """
    shelves = bar.get("shelves")
    if shelves is None:
        return
    if not isinstance(shelves, list) or not shelves:
        errs.append("bar: shelves must be a non-empty array")
        return

    stocked = {i["id"] for i in bar["ingredients"]}
    seen = set()
    for s in shelves:
        if not isinstance(s, dict):
            errs.append("bar shelves: every entry must be an object")
            continue
        who = s.get("id", "<no id>")
        for k in sorted(SHELF_KEYS - set(s)):
            errs.append(f"bar shelf {who}: missing {k!r}")
        for k in sorted(set(s) - SHELF_KEYS):
            errs.append(f"bar shelf {who}: unknown key {k!r}")

        if not isinstance(who, str) or not SLUG.fullmatch(who):
            errs.append(f"bar shelf {who!r}: id is not a slug")
        elif who in seen:
            errs.append(f"bar shelf {who}: duplicate id")
        else:
            seen.add(who)

        for k in ("label", "blurb"):
            v = s.get(k)
            if k in s and (not isinstance(v, str) or not v.strip()):
                errs.append(f"bar shelf {who}: {k} must be a non-empty string")
            elif isinstance(v, str) and HTML.search(v):
                errs.append(f"bar shelf {who}: {k} contains HTML")

        want = s.get("ingredients")
        if "ingredients" not in s:
            continue
        if not isinstance(want, list) or not want:
            errs.append(f"bar shelf {who}: ingredients must be a non-empty array")
            continue
        held = set()
        for iid in want:
            if not isinstance(iid, str):
                errs.append(f"bar shelf {who}: ingredients must be ids")
                continue
            if iid not in stocked:
                errs.append(f"bar shelf {who}: {iid!r} is not in the bar")
            elif iid in held:
                errs.append(f"bar shelf {who}: {iid} is listed twice")
            held.add(iid)


def check_bottles_copy(bar, errs):
    """The paragraph over the shopping list, where there is one."""
    copy = bar.get("bottles_copy")
    if copy is None:
        return
    if not isinstance(copy, str) or not copy.strip():
        errs.append("bar: bottles_copy must be a non-empty string")
    elif HTML.search(copy):
        errs.append("bar: bottles_copy contains HTML")


def check_used(by_id, used, errs):
    """Every bottle on the shelf is one some drink wants.

    A garnish letter counts as use, so the bar cannot quietly drift.
    `catalog` is the exception, a type on the shopping list before any
    drink calls for it, and it fails the other way round: once a drink
    wants it, it is not a catalog entry any more.
    """
    for iid in sorted(by_id):
        catalog = by_id[iid].get("catalog") is True
        if iid in used:
            if catalog:
                errs.append(f"bar {iid}: catalog but a drink calls for it")
        elif not catalog:
            errs.append(f"bar: {iid} is stocked but no drink calls for it")


def iced_glass(serve):
    """Whether this glass arrives with ice in it. `icedGlass` in app.js."""
    return serve[:1] in ICED_GLASSES


def check_methods(menu, errs):
    """A method carries the line a single drink prints, not just a blurb.

    `blurb` is the heading over that section of the card and reads like
    one. `how` is the instruction you follow at the bar, and the app, the
    drink pages and the agent dump all print it, so it is required and a
    fourth method cannot arrive without one.

    `how_dry` is the second line, for a glass with no ice. The method
    made in the serving glass needs it: nearly every built drink is
    packed with ice, and the Champagne Cocktail, the Seelbach and Death
    in the Afternoon are poured dry. One sentence cannot be right for
    both.
    """
    for m in menu["methods"]:
        who = m.get("id", "<no id>")
        extra = sorted(set(m) - METHOD_KEYS)
        if extra:
            errs.append(f"method {who}: unexpected key(s) {', '.join(extra)}")
        for key in ("label", "blurb", "how"):
            if not isinstance(m.get(key), str) or not m.get(key, "").strip():
                errs.append(f"method {who}: {key} must be a non-empty string")
        if who in IN_GLASS and not m.get("how_dry"):
            errs.append(f"method {who}: made in the serving glass, so it "
                        f"needs how_dry; `how` alone would tell somebody to "
                        f"build a dry drink over ice")
        dry = m.get("how_dry")
        if dry is not None and (not isinstance(dry, str) or not dry.strip()):
            errs.append(f"method {who}: how_dry must be a non-empty string")


def check_mixer_method(d, who, by_id, errs):
    """A mixer poured into a glass of ice is built in that glass.

    Soda, tonic and ginger beer fill the rest of the glass over the ice
    already in it. There is nothing to stir and nothing to shake, so a
    drink like that filed anywhere but `built` prints a wrong
    instruction: Fernet and Ginger shipped as `stirred`, and the app
    told a guest to stir a highball and strain it.

    The dry glass is the exception that has to stay. A Gin Fizz is
    shaken with lemon and syrup, strained into an empty highball, and
    topped from there, which is why the card writes it `h` and not `H`.
    The ice in the serving glass is what says the drink was made in it.
    """
    if d["method"] in IN_GLASS or not iced_glass(d["serve"]):
        return
    for entry in d["build"]:
        if (by_id.get(entry[0]) or {}).get("kind") == "mixer":
            errs.append(f"{who}: {entry[0]} fills a glass that already has "
                        f"ice in it, so the drink is built, not {d['method']}")
            return


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


def amount_errors(amt, iid, ing):
    """What is wrong with one amount token, if anything.

    Two rules. It has to be a token the notation defines, and a `t` has to
    sit beside something that can fill a glass. A top beside a spirit reads
    as `top Gin` in the recipe and hands kin.py a base spirit weighing
    nothing, which files the drink under the wrong shape without anything
    going red.
    """
    if not AMOUNT.match(amt):
        return [f"cannot read amount {amt!r} for {iid}"]
    if amt != "t":
        return []
    kind = (ing or {}).get("kind")
    if kind in TOPPABLE_KINDS or iid in TOPPABLE:
        return []
    return [f"{iid} cannot be topped; `t` is for a mixer"]


def method_tally(menu):
    """`74 stirred, 59 shaken, 19 built`, counted off the file's own list.

    The card had two methods and then it had three, so the sentence is
    built from `methods` and nobody has to retype it. A method nothing is
    filed under is left off instead of printing a zero.
    """
    counts = []
    for m in menu["methods"]:
        n = sum(1 for d in menu["cocktails"] if d["method"] == m["id"])
        if n:
            counts.append(f"{n} {m['id']}")
    return ", ".join(counts)


def main():
    bar = load("bar.json")
    notation = load("notation.json")
    menu = load("cocktails.json")

    by_id = {i["id"]: i for i in bar["ingredients"]}
    unmeasured = {i["id"] for i in bar["ingredients"] if i.get("unit") == "none"}
    families = {f["id"] for f in menu["families"]}
    methods = {m["id"] for m in menu["methods"]}
    gcodes = garnish_tokens(notation)
    gbottle, stocked = garnish_bottles(notation), set(by_id)

    errs = []
    check_bottles_copy(bar, errs)
    check_methods(menu, errs)
    check_bits(bar, errs)
    check_stand_ins(bar, errs)
    check_shelves(bar, errs)
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
        check_mixer_method(d, who, by_id, errs)

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
            for bad in amount_errors(amt, ing, by_id.get(ing)):
                errs.append(f"{who}: {bad}")
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

    check_used(by_id, used, errs)

    for e in errs:
        print(f"  MENU  {e}")
    if errs:
        return 1

    n = len(menu["cocktails"])
    ng = sum(1 for i in bar["ingredients"] if i["kind"] == "garnish")
    nb = sum(1 for i in bar["ingredients"] if i.get("bottles"))
    nc = sum(1 for i in bar["ingredients"] if i.get("catalog") is True)
    hi = max(i["bit"] for i in bar["ingredients"])
    print(f"  menu    {n} drinks ({method_tally(menu)}), "
          f"{len(stocked)} ingredients ({ng} garnish, {nc} catalog, "
          f"bits 0–{hi}, {len(bar['retired_bits'])} retired, "
          f"{nb} with bottles, {len(seen_brands)} brands, "
          f"{len(gbottle)} letters that call for one), every code checks out")
    return 0


if __name__ == "__main__":
    sys.exit(main())
