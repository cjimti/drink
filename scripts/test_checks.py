#!/usr/bin/env python3
"""Break every rule on purpose, and check that something notices.

A linter nobody has ever seen fail is indistinguishable from a linter
that passes everything. Every case below is a one-line fake source that
violates exactly one rule; the test asserts the matching checker reports
it, and that a clean version of the same line reports nothing.

The lexer gets a property test instead: strip the two real files and the
braces, parens and brackets must still balance. That is the whole basis
for reading brace depth as function size, so it is worth asserting on the
actual sources rather than on a fixture.
"""
import ast
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_assets                                          # noqa: E402
import check_code                                            # noqa: E402
import check_menu                                            # noqa: E402
import check_style                                           # noqa: E402
import cards                                                 # noqa: E402
import jslex                                                 # noqa: E402
import llms                                                  # noqa: E402
import pages                                                 # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

CSS_HEAD = (":root {\n  --ground: #121211;\n  --brass: #E0B86B;\n"
            "  --body: Lato, sans-serif;\n}\n")


def css_cases():
    """(name, css, should it be reported) for the stylesheet rules."""
    return [
        ("literal colour", ".a { color: #FF0000; }", True),
        ("token colour", ".a { color: var(--brass); }", False),
        ("literal in :root", ":root { --x: #FF0000; }", False),
        ("literal in print", "@media print {\n.a { color: #000; }\n}", False),
        ("box-shadow", ".a { box-shadow: 0 1px 2px var(--hair); }", True),
        ("no shadow", ".a { box-shadow: none; }", False),
        ("bare font stack", ".a { font-family: Helvetica, sans-serif; }",
         True),
        ("token font", ".a { font-family: var(--body); }", False),
        ("face being loaded", '@font-face { font-family: "Lato"; }',
         False),
        ("undefined token", ".a { color: var(--nope); }", True),
    ]


def js_cases():
    """(name, js, should it be reported) for the JavaScript foot-guns."""
    return [
        ("eval", "function f() { eval('1'); }", True),
        ("eval named in a string", "function f() { g('eval('); }", False),
        ("console", "function f() { console.log(1); }", True),
        ("console in a comment", "function f() { /* console.log(1) */ }",
         False),
        ("loose equality", "function f(a) { if (a == 1) { return 1; } }",
         True),
        ("null check", "function f(a) { if (a == null) { return 1; } }",
         False),
        ("radix-less parseInt", "function f(a) { return parseInt(a); }",
         True),
        ("parseInt with radix", "function f(a) { return parseInt(a, 16); }",
         False),
        ("debugger", "function f() { debugger; }", True),
        ("document.write", "function f() { document.write('x'); }", True),
    ]


def py_cases():
    """(name, python, should it be reported) for the Python traps."""
    return [
        ("bare except", '"""d."""\ntry:\n    x = 1\nexcept:\n    pass\n',
         True),
        ("named except", '"""d."""\ntry:\n    x = 1\nexcept ValueError:\n'
                         '    pass\n', True if False else False),
        ("mutable default", '"""d."""\ndef f(a=[]):\n    """d."""\n'
                            '    return a\n', True),
        ("immutable default", '"""d."""\ndef f(a=()):\n    """d."""\n'
                              '    return a\n', False),
        ("is on a value", '"""d."""\ndef f(a):\n    """d."""\n'
                          '    return a is 3\n', True),
        ("is on a singleton", '"""d."""\ndef f(a):\n    """d."""\n'
                              '    return a is None\n', False),
        ("no module docstring", "x = 1\n", True),
    ]


def size_cases():
    """A function past each limit is reported; one inside it is not."""
    long_body = "function f() {\n" + "  var x = 1;\n" * 100 + "}\n"
    deep = ("function f(a) {\n" + "".join(
        "  " * i + "if (a) {\n" for i in range(1, 8)) +
        "".join("  " * i + "}\n" for i in range(7, 0, -1)) + "}\n")
    branchy = ("function f(a) {\n" +
               "  if (a) { return 1; }\n" * 40 + "  return 0;\n}\n")
    return [
        ("long function", long_body, True),
        ("deep function", deep, True),
        ("branchy function", branchy, True),
        ("small function", "function f(a) {\n  return a;\n}\n", False),
    ]


# Every case that ran, counted where it runs. The tally used to be a sum
# of literals kept by hand, and it had drifted ten cases low: adding five
# to run_house left it printing the number it printed before. A count
# that does not count is worse than no count, because it reads like a
# receipt. The lexer is not in here on purpose; it gets the property test
# the docstring describes rather than a case.
CASES = []


def report(name, found, expected, failures):
    """Record one case; print only what went wrong."""
    CASES.append(name)
    if bool(found) != expected:
        failures.append(f"{name}: expected "
                        f"{'a finding' if expected else 'no finding'}, "
                        f"got {found or 'none'}")


def run_css(failures):
    """Each stylesheet rule, broken and then kept."""
    for name, css, expected in css_cases():
        full = CSS_HEAD + css
        errs, defined = check_style.check_css(full)
        _, dark, _ = check_style.check_themes(defined)
        errs += check_style.check_tokens(full, dark)
        report(f"css/{name}", errs, expected, failures)


def run_js(failures):
    """Each JavaScript foot-gun, and its innocent twin."""
    for name, js, expected in js_cases():
        report(f"js/{name}", check_code.check_js_practice("t.js", js),
               expected, failures)
    for name, js, expected in size_cases():
        report(f"size/{name}",
               check_code.check_size(check_code.js_units("t.js", js)),
               expected, failures)


def run_py(failures):
    """Each Python trap."""
    for name, src, expected in py_cases():
        tree = ast.parse(src)
        report(f"py/{name}", check_code.check_py_practice("t.py", tree),
               expected, failures)


def run_house(failures):
    """The app contracts: the ones a green pipeline would otherwise hide.

    Track keys, click wiring, the shelf BigInt, the method line's serve
    token, the case a code is searched in, the drink route, the em dash.
    """
    app = (ROOT / "assets" / "app.js").read_text()

    broken = app.replace("track('view_tab', { tab: view })",
                         "track('view_tab', { tab: view, nope: 1 })")
    report("house/track key", check_style.check_track(broken), True, failures)
    report("house/track clean", check_style.check_track(app), False, failures)

    broken = app.replace("[data-shared],", "")
    report("house/dead branch", check_style.check_delegation(broken), True,
           failures)
    report("house/wiring clean", check_style.check_delegation(app), False,
           failures)

    broken = app.replace("BigInt", "Number", 40)
    report("house/bigint", check_style.check_bigint(broken), True, failures)
    report("house/bigint clean", check_style.check_bigint(app), False,
           failures)

    broken = app.replace("function methodLine(id, serve) {",
                         "function methodLine(id) {")
    report("house/method line arity", check_style.check_method_line(broken),
           True, failures)
    broken = app.replace("methodLine(d.method, d.serve)", "methodLine(d.method)")
    report("house/method line call", check_style.check_method_line(broken),
           True, failures)
    report("house/method line clean", check_style.check_method_line(app),
           False, failures)

    broken = app.replace("d.code.indexOf(filter.code)",
                         "d.code.toLowerCase().indexOf(filter.q)")
    report("house/search folds the code",
           check_style.check_search_case(broken), True, failures)
    broken = app.replace("var hay = (d.name + ' ' + ingredientLine(d))"
                         ".toLowerCase();",
                         "var hay = (d.name + ' ' + ingredientLine(d)\n"
                         "        + ' ' + d.code)\n        .toLowerCase();")
    report("house/search folds over two lines",
           check_style.check_search_case(broken), True, failures)
    broken = app.replace(" && d.code.indexOf(filter.code) < 0", "")
    report("house/search drops the code",
           check_style.check_search_case(broken), True, failures)
    broken = app.replace('spellcheck="false" \' +\n'
                         "        'autocapitalize=\"off\" autocorrect=\"off\"",
                         'spellcheck="false"')
    report("house/search box capitalises",
           check_style.check_search_case(broken), True, failures)
    report("house/search case clean", check_style.check_search_case(app),
           False, failures)

    broken = app.replace("/^#drink\\/([a-z0-9-]+)$/", "/^#drink\\/([a-z]+)$/")
    report("house/drink route", check_style.check_drink_links(broken), True,
           failures)
    report("house/drink route clean", check_style.check_drink_links(app),
           False, failures)

    dash = "\u2014"
    report("house/em dash", check_style.check_dashes({"a.js": "/* a " + dash +
                                                     " b */"}), True, failures)
    report("house/em dash escaped",
           check_style.check_dashes({"a.json": '{"a": "b \\u2014 c"}'}), True,
           failures)
    report("house/em dash clean",
           check_style.check_dashes(check_style.shipped_files()), False,
           failures)


def pressed_cases():
    """(name, js, should it be reported) for the pressed-state rule."""
    chip = ("function f(on) {\n"
            "  return '<button class=\"chip' + (on ? ' is-on' : '') +\n"
            "    '\" data-family=\"gin\"%s>' + 'Gin' + '</button>';\n"
            "}\n")
    return [
        ("chip with no state", chip % "", True),
        ("chip that says pressed",
         chip % "' + ' aria-pressed=\"true\"' + '", False),
        ("tab that says selected",
         "function f(on) {\n"
         "  return '<button role=\"tab\" class=\"recipe-tab' +\n"
         "    (on ? ' is-on' : '') + '\" aria-selected=\"true\">x</button>';\n"
         "}\n", False),
        ("wrapper around the button",
         "function f(on) {\n"
         "  return '<div class=\"brand' + (on ? ' is-on' : '') + '\">' +\n"
         "    '<button aria-pressed=\"true\">x</button></div>';\n"
         "}\n", False),
        ("a button talked about in a comment",
         "function f() {\n"
         "  /* a <button> with is-on and no state would be wrong */\n"
         "  return 1;\n"
         "}\n", False),
    ]


def run_pressed(failures):
    """Selected state a screen reader can hear, on the fixtures and the app.

    The app itself is mutated as well as the fixtures: the fixtures say
    what the rule means, and stripping the real segment's aria-pressed
    says the rule is pointed at the file it claims to check.
    """
    for name, js, expected in pressed_cases():
        report(f"pressed/{name}", check_style.check_pressed(js), expected,
               failures)
    app = (ROOT / "assets" / "app.js").read_text()
    broken = app.replace(
        """'" data-method="' + s.id + '"' +\n"""
        """          ' aria-pressed="' + (on ? 'true' : 'false') + '">' +""",
        """'" data-method="' + s.id + '">' +""")
    report("pressed/segment stripped", check_style.check_pressed(broken),
           True, failures)
    report("pressed/clean", check_style.check_pressed(app), False, failures)


def run_menu(failures):
    """A top has to sit beside something that can fill a glass."""
    bar = check_menu.load("bar.json")
    by_id = {i["id"]: i for i in bar["ingredients"]}
    for iid, expected in (("gin", True), ("simple", True),
                          ("soda-water", False), ("champagne", False)):
        report(f"menu/top beside {iid}",
               check_menu.amount_errors("t", iid, by_id.get(iid)),
               expected, failures)
    report("menu/unreadable amount",
           check_menu.amount_errors("zz", "gin", by_id["gin"]), True, failures)


def method_cases(menu):
    """(name, methods, should it be reported) for the method table.

    `how` is the line a single drink prints and the blurb over the
    section is not it, so every method carries one. The method made in
    the serving glass carries the dry line as well.
    """
    clean = menu["methods"]
    built = next(m for m in clean if m["id"] == "built")
    return [
        ("clean", clean, False),
        ("no how", [{k: v for k, v in m.items() if k != "how"}
                    for m in clean], True),
        ("empty how", [dict(m, how="  ") for m in clean], True),
        ("built with no how_dry",
         [{k: v for k, v in m.items() if k != "how_dry"} for m in clean],
         True),
        ("empty how_dry", [dict(built, how_dry="")], True),
        ("a key nobody reads", [dict(built, howe="typo")], True),
    ]


def run_methods(failures):
    """Every method carries its instruction, and the dry one carries two."""
    menu = check_menu.load("cocktails.json")
    for name, methods, expected in method_cases(menu):
        errs = []
        check_menu.check_methods(dict(menu, methods=methods), errs)
        report(f"method/{name}", errs, expected, failures)


def run_mixer_method(failures):
    """A mixer filling a glass of ice is built, and a fizz is not."""
    menu = check_menu.load("cocktails.json")
    bar = check_menu.load("bar.json")
    by_id = {i["id"]: i for i in bar["ingredients"]}
    drinks = {d["id"]: d for d in menu["cocktails"]}

    for did in ("fernet-and-ginger", "gin-fizz", "martini"):
        errs = []
        check_menu.check_mixer_method(drinks[did], did, by_id, errs)
        report(f"mixer/{did}", errs, False, failures)

    # The bug this rule is for: a highball over ice, filed stirred.
    errs = []
    misfiled = dict(drinks["fernet-and-ginger"], method="stirred")
    check_menu.check_mixer_method(misfiled, "fernet-and-ginger", by_id, errs)
    report("mixer/stirred over ice", errs, True, failures)

    # A fizz is shaken and strained into a dry glass, then topped. Pack
    # that glass with ice and it is a built drink wearing a fizz's name.
    errs = []
    iced = dict(drinks["gin-fizz"], serve="H")
    check_menu.check_mixer_method(iced, "gin-fizz", by_id, errs)
    report("mixer/shaken over ice", errs, True, failures)


def run_method_line(failures):
    """The line a drink prints reads off the glass, not off the section."""
    menu = check_menu.load("cocktails.json")
    methods = llms.methods_by_id(menu)
    drinks = {d["id"]: d for d in menu["cocktails"]}
    for did, want in (("champagne-cocktail", "no ice"),
                      ("gin-and-tonic", "over ice"),
                      ("fernet-and-ginger", "over ice"),
                      ("martini", "Stir with ice"),
                      ("brass-rail", "Shake hard")):
        line = llms.method_line(drinks[did], methods)
        report(f"how/{did}", "" if want in line else line, False, failures)

    # Drop the dry line and the Champagne Cocktail is built over ice,
    # which is the wrong instruction the strings were moved to fix.
    bare = {k: {i: v for i, v in m.items() if i != "how_dry"}
            for k, m in methods.items()}
    report("how/dry glass with no how_dry",
           "over ice" in llms.method_line(drinks["champagne-cocktail"], bare),
           True, failures)

    # An amount the shorthand does not write is not read as one either.
    report("amount/egg white has none",
           llms.read_amount(None, {}), False, failures)
    report("amount/egg white reads as itself",
           "" if llms.pour_text(["egg-white", None], {}) == "egg-white"
           else "an amount word arrived from somewhere", False, failures)


def run_glasses(failures):
    """Every drawing a serve token can reach is on disk and fetched."""
    app = (ROOT / "assets" / "app.js").read_text()
    report("glass/clean", check_assets.check_glasses(app)[0], False, failures)

    broken = app.replace(", 'highball-pick'", "")
    report("glass/never fetched", check_assets.check_glasses(broken)[0], True,
           failures)

    broken = app.replace(
        "    if (g === 'h') return extra ? 'highball-' + extra : 'highball';",
        "    if (g === 'j') return extra ? 'julep-' + extra : 'julep';")
    report("glass/no drawing", check_assets.check_glasses(broken)[0], True,
           failures)


def run_plates(failures):
    """Every tool plate is converted, shown on the Info tab, and cached."""
    html = (ROOT / "index.html").read_text()
    sw = (ROOT / "sw.js").read_text()
    plates = check_assets.plate_headers()
    report("plate/clean", check_assets.check_plates(html, sw, plates), False,
           failures)

    raw = dict(plates, **{"barspoon.png": (832, 1248, 2)})
    report("plate/unconverted", check_assets.check_plates(html, sw, raw),
           True, failures)

    spare = dict(plates, **{"muddler.png": check_assets.PLATE})
    report("plate/shown nowhere", check_assets.check_plates(html, sw, spare),
           True, failures)

    broken = sw.replace("  'assets/tools/barspoon.png',\n", "")
    report("plate/not cached", check_assets.check_plates(html, broken, plates),
           True, failures)


def run_fonts(failures):
    """Every face is here, cached, and nothing reaches Google for type."""
    css = (ROOT / "assets" / "app.css").read_text()
    sw = (ROOT / "sw.js").read_text()
    report("font/clean", check_assets.check_fonts(css, sw)[0], False, failures)

    gone = css.replace("fonts/lato-400-latin.woff2",
                       "fonts/lato-400-nowhere.woff2")
    report("font/no file", check_assets.check_fonts(gone, sw)[0], True,
           failures)

    adrift = sw.replace("  'assets/fonts/lato-400-latin.woff2',\n", "")
    report("font/not cached", check_assets.check_fonts(css, adrift)[0], True,
           failures)

    # A face dropped from the stylesheet and left in assets/fonts is
    # weight every install pays for and nobody reads.
    spare = css.replace("url(fonts/lato-700-latin.woff2)", "url()")
    report("font/on disk, unnamed", check_assets.check_fonts(spare, sw)[0],
           True, failures)

    report("font/clean off-origin",
           check_assets.check_offsite({"index.html": "<html></html>"}), False,
           failures)
    report("font/loads from Google", check_assets.check_offsite(
        {"index.html": '<link href="https://fonts.googleapis.com/css2">'}),
        True, failures)


def run_manifest(failures):
    """The manifest installs, and loses each reason it does on purpose."""
    sw = (ROOT / "sw.js").read_text()
    man = check_assets.manifest()
    report("icon/clean", check_assets.check_manifest(man, sw), False, failures)

    adrift = sw.replace("  'assets/icon-512.png',\n", "")
    report("icon/not cached", check_assets.check_manifest(man, adrift), True,
           failures)

    gone = dict(man, icons=[dict(i, src="assets/icon-nowhere.png")
                            for i in man["icons"]])
    report("icon/no file", check_assets.check_manifest(gone, sw), True,
           failures)

    small = dict(man, icons=[i for i in man["icons"]
                             if i.get("sizes") != "512x512"])
    report("icon/no 512", check_assets.check_manifest(small, sw), True,
           failures)

    plain = dict(man, icons=[dict(i, purpose="any") for i in man["icons"]])
    report("icon/no maskable", check_assets.check_manifest(plain, sw), True,
           failures)

    locked = dict(man, orientation="portrait")
    report("icon/orientation locked", check_assets.check_manifest(locked, sw),
           True, failures)


def run_worker(failures):
    """The worker keeps every safeguard, and loses each one on purpose."""
    js = (ROOT / "assets" / "app.js").read_text()
    sw = (ROOT / "sw.js").read_text()
    report("worker/clean", check_assets.check_worker(js, sw), False, failures)

    stale = sw.replace("fetch(fresh(path), { cache: 'reload' })",
                       "fetch(path, { cache: 'reload' })")
    report("worker/shell not fresh", check_assets.check_worker(js, stale),
           True, failures)

    blind = sw.replace("if (res.ok) {", "if (true) {")
    report("worker/caches a 404", check_assets.check_worker(js, blind),
           True, failures)

    adrift = sw.replace("  'offline.html',\n", "")
    report("worker/no offline page", check_assets.check_worker(js, adrift),
           True, failures)

    unrouted = sw.replace("req.mode !== 'navigate'", "false")
    report("worker/offline page never served",
           check_assets.check_worker(js, unrouted), True, failures)


PAGE = ('<html lang="en"><head><title>t</title>'
        '<meta name="description" content="d"></head>'
        '<body><main><img src="a" alt="a"></main></body></html>')


def run_pages(failures):
    """A drink page is a real page, and every page and card is current."""
    report("page/clean", check_style.check_page("x.html", PAGE), False,
           failures)
    report("page/no alt", check_style.check_page(
        "x.html", PAGE.replace(' alt="a"', "")), True, failures)
    report("page/no description", check_style.check_page(
        "x.html", PAGE.replace('<meta name="description" content="d">', "")),
        True, failures)
    report("page/two mains", check_style.check_page(
        "x.html", PAGE.replace("</main>", "</main><main></main>")), True,
        failures)

    texts, present = pages.render(), pages.on_disk()
    report("pages/clean", pages.check_texts(texts, present), False, failures)

    # The page prints the drink's own instruction. A built drink in a dry
    # glass saying `over ice` is a wrong instruction, on the page a
    # shared link lands on.
    dry = texts["drink/champagne-cocktail/index.html"]
    report("pages/dry built over ice", "over ice" in dry, False, failures)
    report("pages/dry built line",
           "" if 'page__method">Build in the glass with no ice' in dry
           else "the method line is not the drink's own", False, failures)
    iced = texts["drink/gin-and-tonic/index.html"]
    report("pages/iced built line",
           "" if 'page__method">Build in the glass over ice' in iced
           else "the method line is not the drink's own", False, failures)
    report("pages/no amount word",
           "one Egg white" in texts["drink/brass-rail/index.html"], False,
           failures)

    stale = dict(texts, **{next(iter(texts)): "not what pages.py writes\n"})
    report("pages/stale", pages.check_texts(stale, present), True, failures)
    report("pages/orphan", pages.check_texts(
        texts, present | {"drink/nothing-here/index.html"}), True, failures)

    want, have = cards.wanted(), cards.on_disk()
    report("cards/clean", cards.check_cards(want, have), False, failures)
    first = next(iter(want))
    stale = dict(want, **{first: (want[first][0], "0000000000000000")})
    report("cards/stale", cards.check_cards(stale, have), True, failures)
    report("cards/orphan", cards.check_cards(
        want, dict(have, **{"nothing-here": ROOT / "assets" / "og.png"})),
        True, failures)


def run_lexer(failures):
    """Stripping the real files leaves every bracket balanced."""
    for f in ("assets/app.js", "sw.js"):
        src = (ROOT / f).read_text()
        out = jslex.strip(src)
        if len(out) != len(src) or out.count("\n") != src.count("\n"):
            failures.append(f"lexer/{f}: offsets moved")
        for opener, closer in (("{", "}"), ("(", ")"), ("[", "]")):
            if out.count(opener) != out.count(closer):
                failures.append(f"lexer/{f}: {opener}{closer} unbalanced "
                                f"after stripping")
        if "//" in out or "/*" in out:
            failures.append(f"lexer/{f}: a comment survived stripping")


def main():
    """Every case, then the count."""
    failures = []
    for run in (run_css, run_js, run_py, run_house, run_pressed,
                run_menu, run_methods, run_mixer_method, run_method_line,
                run_glasses, run_fonts, run_manifest,
                run_plates, run_pages, run_lexer, run_worker):
        run(failures)
    for f in failures:
        print(f"  TEST    {f}")
    if failures:
        return 1
    print(f"  test    {len(CASES)} case(s): every rule fails when it "
          f"is broken")
    return 0


if __name__ == "__main__":
    sys.exit(main())
