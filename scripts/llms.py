#!/usr/bin/env python3
"""Markdown for agents, generated from the same JSON the app reads.

llms.txt is the map (llmstxt.org): what this is, where the source lives,
and a one-line index of every drink. llms-full.txt is the menu spelled
out — amounts, glass, garnish, taste, history — so an agent does not
have to execute the decoder.

`python3 scripts/llms.py` writes both files.
`python3 scripts/llms.py --check` refuses a drift. Same bargain as kin.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = "https://fewbottles.com"
LLMS = ROOT / "llms.txt"
FULL = ROOT / "llms-full.txt"

FRACTION = {"h": "1/2", "q": "1/4", "Q": "3/4"}


def load(name):
    return json.loads((ROOT / "data" / name).read_text())


def plural(n, one, many):
    return f"{n} {one if n == 1 else many}"


def garnish_codes(notation):
    return sorted((g["code"] for g in notation["garnishes"]), key=len, reverse=True)


def split_garnish(rest, codes):
    out = []
    while rest:
        hit = next((c for c in codes if rest.startswith(c)), None)
        if not hit:
            return None
        out.append(hit)
        rest = rest[len(hit):]
    return out


def read_amount(token, ingredient):
    if token is None:
        return "one"
    if token == "r":
        return "rinse"
    m = re.fullmatch(r"(\d*)b", token)
    if m:
        n = int(m.group(1) or "1")
        return plural(n, "barspoon", "barspoons")
    m = re.fullmatch(r"(\d*)d", token)
    if m:
        n = int(m.group(1) or "1")
        return plural(n, "dash", "dashes")
    if token.isdigit() and ingredient.get("unit") == "dash":
        n = int(token)
        return plural(n, "dash", "dashes")
    m = re.fullmatch(r"(\d+)([hqQ])", token)
    if m:
        return f"{m.group(1)} {FRACTION[m.group(2)]} oz"
    if token in FRACTION:
        return f"{FRACTION[token]} oz"
    if token.isdigit():
        return f"{token} oz"
    return token


def ingredient_line(drink, by_id):
    names = []
    for part in drink["build"]:
        i = by_id.get(part[0])
        names.append(i["short"] if i else part[0])
    return ", ".join(names)


def serve_line(drink, notation, codes):
    glasses = {g["code"]: g for g in notation["glasses"]}
    garnishes = {g["code"]: g for g in notation["garnishes"]}
    serve = drink["serve"]
    glass = glasses.get(serve[0], {"label": serve[0]})
    bits = [glass["label"]]
    found = split_garnish(serve[1:], codes) or []
    bits.extend(garnishes[c]["label"] for c in found if c in garnishes)
    return ", ".join(bits)


def decode_build(drink, by_id):
    lines = []
    for part in drink["build"]:
        iid, token = part[0], part[1]
        flag = part[2] if len(part) > 2 else None
        i = by_id.get(iid, {"name": iid})
        amt = read_amount(token, i)
        extra = " (on top)" if flag == "g" else ""
        lines.append(f"- {amt} {i['name']}{extra}")
    return lines


def write_llms(menu, bar, notation, kin):
    n = len(menu["cocktails"])
    stirred = sum(1 for d in menu["cocktails"] if d["method"] == "stirred")
    by_id = {i["id"]: i for i in bar["ingredients"]}
    families = {f["id"]: f["label"] for f in menu["families"]}
    lines = [
        "# drink.shoephone",
        "",
        "> The house cocktail menu from one small bar. Classic drinks in",
        "> house shorthand, decoded in the browser, with a shelf that shows",
        "> what you can pour tonight.",
        "",
        "One person's shelf, pouring for guests and for himself. Two methods,",
        "stirred and shaken. The menu is large because the bottles overlap,",
        "not because the bar is. "
        + f"{n} drinks ({stirred} stirred, {n - stirred} shaken), "
        + f"{len(bar['ingredients'])} ingredients.",
        "",
        "The printed card writes a contextual shorthand called Barline. A",
        "bare number is ounces beside a spirit and dashes beside bitters;",
        "`q` is a quarter ounce and `Q` is three quarters; the last token is",
        "glass plus garnish, matched longest-first. Each drink in the JSON",
        "carries both `code` (the card) and `build` (the same drink spelled",
        "out). Ids are stable — never renamed, never reused.",
        "",
        "## Start here",
        "",
        f"- [The app]({ORIGIN}/): interactive menu, Bar tab, and the Barline key",
        f"- [Full menu]({ORIGIN}/llms-full.txt): every drink decoded — amounts, glass, garnish, taste, history",
        f"- [Cocktails JSON]({ORIGIN}/data/cocktails.json): source of truth for the menu",
        f"- [The bar]({ORIGIN}/data/bar.json): every bottle a drink can call for",
        f"- [Barline]({ORIGIN}/data/notation.json): the shorthand table the decoder reads from",
        f"- [Kin]({ORIGIN}/data/kin.json): drinks of the same shape in different bottles",
        "",
    ]
    for method in menu["methods"]:
        in_method = [d for d in menu["cocktails"] if d["method"] == method["id"]]
        if not in_method:
            continue
        lines.append(f"## {method['label']}")
        lines.append("")
        for family in menu["families"]:
            in_family = [d for d in in_method if d["family"] == family["id"]]
            if not in_family:
                continue
            for d in in_family:
                line = ingredient_line(d, by_id)
                fam = families.get(d["family"], d["family"])
                lines.append(
                    f"- [{d['name']}]({ORIGIN}/llms-full.txt): `{d['code']}` — {fam}; {line}"
                )
        lines.append("")
    lines += [
        "## Optional",
        "",
    ]
    if kin and kin.get("patterns"):
        lines.append(
            "- [Kin patterns](" + ORIGIN + "/data/kin.json): "
            + ", ".join(p["label"] for p in kin["patterns"])
        )
    lines += [
        "- [shoephone.net](https://shoephone.net/): the house",
        "- [Craig Johnston](https://imti.co/): who pours",
        "- [Source](https://github.com/cjimti/drink): the repository",
        "",
    ]
    return "\n".join(lines)


def write_full(menu, bar, notation, kin):
    n = len(menu["cocktails"])
    stirred = sum(1 for d in menu["cocktails"] if d["method"] == "stirred")
    by_id = {i["id"]: i for i in bar["ingredients"]}
    families = {f["id"]: f["label"] for f in menu["families"]}
    codes = garnish_codes(notation)
    pattern_of = {}
    pattern_label = {}
    if kin:
        pattern_label = {p["id"]: p["label"] for p in kin.get("patterns", [])}
        for did, row in (kin.get("drinks") or {}).items():
            pattern_of[did] = row.get("pattern")

    lines = [
        "# drink.shoephone — the cocktail menu",
        "",
        "> Classic drinks from one small home bar, decoded from the house",
        "> shorthand on the printed card.",
        "",
        f"{n} drinks, {stirred} stirred, {n - stirred} shaken, "
        f"{len(bar['ingredients'])} ingredients. "
        "The interactive app is " + ORIGIN + "/. "
        "This file is the same menu spelled out, so nothing has to run JavaScript.",
        "",
        "Barline reads left to right in build order, base spirit first, and",
        "ends with one token for glass plus garnish. A bare number is ounces",
        "beside a spirit and dashes beside bitters. `h` `q` `Q` are 1/2, 1/4,",
        "3/4 oz. The last token is matched longest-first, so `ccin` is a coupe",
        "with grated cinnamon. Garnish is optional; it never gates a drink.",
        "Egg white takes no measure.",
        "",
    ]

    for method in menu["methods"]:
        in_method = [d for d in menu["cocktails"] if d["method"] == method["id"]]
        if not in_method:
            continue
        lines.append(f"## {method['label']}")
        lines.append("")
        if method.get("blurb"):
            lines.append(method["blurb"])
            lines.append("")

        for family in menu["families"]:
            in_family = [d for d in in_method if d["family"] == family["id"]]
            if not in_family:
                continue
            lines.append(f"### {family['label']}")
            lines.append("")
            for d in in_family:
                shape = pattern_label.get(pattern_of.get(d["id"]) or "")
                meta = [d["method"], families.get(d["family"], d["family"])]
                if shape:
                    meta.append(shape + " family")
                lines.append(f"#### {d['name']}")
                lines.append("")
                lines.append(f"`{d['code']}` · " + " · ".join(meta))
                lines.append("")
                lines.extend(decode_build(d, by_id))
                lines.append(f"- {serve_line(d, notation, codes)}")
                lines.append("")
                if d.get("taste"):
                    lines.append(d["taste"])
                    lines.append("")
                if d.get("history"):
                    lines.append(d["history"])
                    lines.append("")
                refs = d.get("refs") or []
                for r in refs:
                    if r.get("title") and r.get("url"):
                        lines.append(f"- [{r['title']}]({r['url']})")
                if refs:
                    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render():
    menu = load("cocktails.json")
    bar = load("bar.json")
    notation = load("notation.json")
    kin = load("kin.json")
    return write_llms(menu, bar, notation, kin), write_full(menu, bar, notation, kin)


def main():
    llms, full = render()
    check = "--check" in sys.argv[1:]
    if check:
        errs = []
        for path, body, name in ((LLMS, llms, "llms.txt"), (FULL, full, "llms-full.txt")):
            try:
                current = path.read_text()
            except FileNotFoundError:
                errs.append(f"{name} is missing — run python3 scripts/llms.py")
                continue
            if current != body:
                errs.append(f"{name} is stale — run python3 scripts/llms.py")
        for e in errs:
            print(f"  LLMS  {e}")
        if errs:
            return 1
        n = full.count("\n#### ")
        print(f"  llms    {n} drinks in llms.txt and llms-full.txt")
        return 0

    LLMS.write_text(llms)
    FULL.write_text(full)
    print(f"  llms    wrote {LLMS.relative_to(ROOT)} and {FULL.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
