#!/usr/bin/env python3
"""The house rules in CLAUDE.md, enforced instead of remembered.

`check_code.py` asks whether the code is sane. This asks whether it is
*this* house's code. Every rule below is written down in CLAUDE.md and
every one of them has already been broken by somebody in a hurry:

  CSS   a literal hex outside the token blocks is wrong in one theme; a
        colour token without a light counterpart is wrong in the other;
        there are no shadows; the fonts come from three tokens.
  HTML  a page nobody can read with a screen reader is not finished —
        alt text, an accessible name on every control, unique ids.
  JS    a track() parameter missing from TRACK_KEYS goes stale silently.
        A delegated click branch whose data attribute is missing from the
        selector never fires: the button is simply dead. A shelf read
        with Number() instead of BigInt loses the 54th bottle. A method
        line that ignores the serve token told three people to build a
        Death in the Afternoon over ice.

None of this is taste. Each one is a specific bug that shipped, or would
have.
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jslex  # noqa: E402  (path set above; there is no package here)

ROOT = Path(__file__).resolve().parent.parent

COLOUR = re.compile(r"#[0-9A-Fa-f]{3,8}\b|\brgba?\(|\bhsla?\(")
# re.S because a value may wrap: a long gradient is still one
# declaration, and skipping it would be a hole in the palette rule.
DECL = re.compile(r"^\s*(--[\w-]+|[a-z-]+)\s*:\s*(.+)$", re.S)


def css_decls(css):
    """Walk the stylesheet, yielding (line, context stack, declaration).

    The context stack is the selectors and at-rules open at that point, so
    a declaration inside `@media print { :root { … } }` arrives with both.
    Declarations are yielded one at a time however the source is wrapped:
    a whole rule written on one line is read exactly like a rule spread
    over four, which is where a hand-rolled line scanner goes wrong.
    """
    css = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"),
                 css, flags=re.S)
    stack, buf, line, start = [], "", 1, 1
    for ch in css:
        if ch == "\n":
            line += 1
        if ch == "{":
            stack.append(buf.strip())
            buf, start = "", line
        elif ch in "};":
            if buf.strip():
                yield start, list(stack), buf.strip()
            if ch == "}" and stack:
                stack.pop()
            buf, start = "", line
        else:
            if not buf.strip():
                start = line
            buf += ch


def check_css(css):
    """Palette, both themes, no shadows, fonts from the three tokens."""
    errs, defined = [], {}
    for n, stack, decl in css_decls(css):
        m = DECL.match(decl)
        if not m:
            continue
        prop, value = m.group(1), " ".join(m.group(2).split())
        in_root = any(s.endswith(":root") for s in stack)
        in_print = any("print" in s for s in stack)
        # @font-face names the face it is loading, not a stack to
        # set type in. The three tokens are still the only way to
        # ask for one.
        in_face = any(s.startswith("@font-face") for s in stack)

        if prop.startswith("--"):
            defined.setdefault(" > ".join(stack), {})[prop] = value
        elif COLOUR.search(value) and not (in_root or in_print):
            errs.append(f"assets/app.css:{n} literal colour in `{prop}` — "
                        f"it will be wrong in one theme; use a token")

        if prop.endswith("shadow") and not re.fullmatch(
                r"[\d\spxeminset.-]*(none|transparent)[\d\spxeminset.-]*",
                value):
            errs.append(f"assets/app.css:{n} {prop} — the design has no "
                        f"shadows")

        if (prop == "font-family" and not (in_root or in_face)
                and "var(--" not in value):
            errs.append(f"assets/app.css:{n} font-family without a token — "
                        f"use var(--display), var(--body) or var(--mono)")
    return errs, defined


def check_themes(defined):
    """Every colour token is defined in both palettes, dark and light."""
    dark = next((v for k, v in defined.items() if k == ":root"), {})
    light = next((v for k, v in defined.items()
                  if "prefers-color-scheme: light" in k), {})
    errs = []
    for name, value in dark.items():
        if COLOUR.search(value) and name not in light:
            errs.append(f"assets/app.css --{name.lstrip('-')} has no light "
                        f"counterpart — light mode is not an inversion, it "
                        f"is written out")
    for name in light:
        if name not in dark:
            errs.append(f"assets/app.css --{name.lstrip('-')} is light-only")
    return errs, dark, light


def check_tokens(css, dark):
    """Every var(--x) names a token something actually defines."""
    errs = []
    for m in re.finditer(r"var\(\s*(--[\w-]+)", css):
        if m.group(1) not in dark:
            n = css.count("\n", 0, m.start()) + 1
            errs.append(f"assets/app.css:{n} var({m.group(1)}) is not "
                        f"defined on :root")
    return errs


class Page(HTMLParser):
    """A page, walked once for the accessibility rules that matter."""

    def __init__(self, name="index.html"):
        super().__init__(convert_charrefs=True)
        self.name = name
        self.errs, self.ids, self.open_ctrl, self.text = [], [], None, ""
        self.attrs_seen, self.refs = {}, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        n = self.getpos()[0]
        self.attrs_seen.setdefault(tag, []).append(a)
        if "id" in a:
            self.ids.append((a["id"], n))
        for key in a:
            if key.startswith("on"):
                self.errs.append(f"{self.name}:{n} inline {key}= handler — "
                                 f"the app wires its own events")
        if tag == "img" and "alt" not in a:
            self.errs.append(f"{self.name}:{n} <img> with no alt")
        if tag == "html" and not a.get("lang"):
            self.errs.append(f"{self.name}:{n} <html> with no lang")
        if tag == "a" and a.get("target") == "_blank" \
                and "noopener" not in a.get("rel", ""):
            self.errs.append(f"{self.name}:{n} target=_blank without "
                             f"rel=noopener")
        if tag == "button":
            if "type" not in a:
                self.errs.append(f"{self.name}:{n} <button> with no type — "
                                 f"it defaults to submit")
            self.open_ctrl = (n, a)
            self.text = ""
        if tag == "dialog" and not (a.get("aria-label")
                                    or a.get("aria-labelledby")):
            self.errs.append(f"{self.name}:{n} <dialog> with no accessible "
                             f"name")
        for key in ("aria-labelledby", "aria-controls", "aria-describedby"):
            for ref in a.get(key, "").split():
                self.refs.append((key, ref, n))

    def handle_data(self, data):
        self.text += data

    def handle_endtag(self, tag):
        if tag == "button" and self.open_ctrl:
            n, a = self.open_ctrl
            named = self.text.strip() or a.get("aria-label") \
                or a.get("aria-labelledby") or a.get("title")
            if not named:
                self.errs.append(f"{self.name}:{n} <button> with no "
                                 f"accessible name")
            self.open_ctrl = None


def check_html(html, js):
    """Landmarks, labels, one id per id, and every aria reference resolved."""
    p = Page()
    p.feed(html)
    errs = list(p.errs)

    rendered = set(re.findall(r'id="([\w-]+)"', js))
    for key, ref, n in p.refs:
        if ref not in {i for i, _ in p.ids} | rendered:
            errs.append(f"index.html:{n} {key}=\"{ref}\" points at nothing")

    seen = {}
    for name, n in p.ids:
        if name in seen:
            errs.append(f"index.html:{n} duplicate id #{name} "
                        f"(also line {seen[name]})")
        seen[name] = n

    metas = {m.get("name") or m.get("property"): m
             for m in p.attrs_seen.get("meta", [])}
    for want in ("viewport", "description"):
        if want not in metas:
            errs.append(f"index.html <meta name={want}> missing")
    if not p.attrs_seen.get("title") and "<title>" not in html:
        errs.append("index.html <title> missing")
    mains = len(p.attrs_seen.get("main", []))
    if mains != 1:
        errs.append(f"index.html {mains} <main> — the app shell has one")
    return errs


def check_page(name, html):
    """A drink page: the same walk, plus a title, a description, one main."""
    p = Page(name)
    p.feed(html)
    errs = list(p.errs)
    metas = {m.get("name") or m.get("property"): m
             for m in p.attrs_seen.get("meta", [])}
    if "description" not in metas:
        errs.append(f"{name} <meta name=description> missing")
    if not p.attrs_seen.get("title"):
        errs.append(f"{name} <title> missing")
    if len(p.attrs_seen.get("main", [])) != 1:
        errs.append(f"{name} needs exactly one <main>")
    seen = set()
    for i, n in p.ids:
        if i in seen:
            errs.append(f"{name}:{n} duplicate id #{i}")
        seen.add(i)
    return errs


def page_files():
    """The pages pages.py writes, the one GitHub serves for a miss, and
    the one the worker serves when there is no signal."""
    names = ["404.html", "offline.html"] + sorted(str(p.relative_to(ROOT))
                                  for p in (ROOT / "drink").glob("*/index.html"))
    return {n: (ROOT / n).read_text() for n in names}


def js_handler(src, stripped):
    """The delegated click handler's body, and the selector that feeds it."""
    m = re.search(r"document\.addEventListener\('\s*',\s*function \(e\) \{",
                  stripped)
    if not m:
        return None, None
    start = stripped.index("{", m.end() - 1)
    end = jslex.match_pair(stripped, start)
    sel = re.compile(r"e\.target\.closest\(").search(stripped, start, end)
    if not sel:
        return stripped[start:end], None
    # The selector is a run of string literals, so it has to be read off
    # the real source; the stripped copy has nothing left between the
    # quotes. The offsets are the same in both.
    close = jslex.match_pair(stripped, sel.end() - 1, "(", ")")
    return stripped[start:end], src[sel.end() - 1:close]


def camel(name):
    """`data-see-pattern` as app.js reads it: `dataset.seePattern`."""
    head, *tail = name.split("-")
    return head + "".join(w.capitalize() for w in tail)


def check_delegation(src):
    """Every branch of the click handler can actually be reached.

    The handler picks its target with one long `closest()` selector and
    then asks which data attribute is set. An attribute the selector does
    not name never arrives, so the branch is dead and the control does
    nothing — silently, and only on the device you did not test on.

    Branches are counted wherever they are written, not only inside the
    handler: the delegate hands `t` to named functions, and a branch that
    moved out of the switch is still a branch.
    """
    stripped = jslex.strip(src)
    _, sel = js_handler(src, stripped)
    if sel is None:
        return ["assets/app.js the delegated click handler moved — "
                "check_style.py cannot find it any more"]

    named = {camel(n) for n in re.findall(r"\[data-([a-z-]+)\]", sel)}
    guarded = set()
    for m in re.finditer(r"\bif\s*\(", stripped):
        cond = stripped[m.end() - 1:
                        jslex.match_pair(stripped, m.end() - 1, "(", ")")]
        guarded |= set(re.findall(r"\bt\.dataset\.(\w+)", cond))

    errs = []
    for key in sorted(guarded - named):
        errs.append(f"assets/app.js the click handler branches on "
                    f"t.dataset.{key} but closest() never selects it — "
                    f"that branch can never run")
    for key in sorted(named - guarded):
        errs.append(f"assets/app.js closest() selects [data-{key}] but no "
                    f"branch reads it — dead weight in the selector")
    return errs


def check_track(src):
    """Every track() parameter is a key the dataLayer already resets."""
    stripped = jslex.strip(src)
    block = re.search(r"var TRACK_KEYS = \[(.*?)\];", src, re.S)
    if not block:
        return ["assets/app.js TRACK_KEYS is gone"]
    known = set(re.findall(r"'([a-z_]+)'", block.group(1)))

    errs = []
    for m in re.finditer(r"\btrack\(\s*'[^']*'\s*,\s*\{", src):
        start = src.index("{", m.end() - 1)
        params = stripped[start:jslex.match_pair(stripped, start)]
        for key in re.findall(r"(\w+)\s*:", params):
            if key not in known:
                n = src.count("\n", 0, m.start()) + 1
                errs.append(f"assets/app.js:{n} track() sends `{key}`, which "
                            f"is not in TRACK_KEYS — it would keep the last "
                            f"event's value")
    return errs


def check_bigint(src):
    """The shelf code is a BigInt. A double is exact to 53 bits."""
    m = re.search(r"function shelfFromCode\b", src)
    if not m:
        return ["assets/app.js shelfFromCode is gone"]
    stripped = jslex.strip(src)
    start = stripped.index("{", m.end())
    body = stripped[start:jslex.match_pair(stripped, start)]
    if "BigInt" not in body:
        return ["assets/app.js shelfFromCode no longer uses BigInt"]
    for bad in ("Number(", "parseInt(", "parseFloat("):
        if bad in body:
            return [f"assets/app.js shelfFromCode uses {bad} — a double is "
                    f"exact to 53 bits and the 54th bottle would round"]
    return []


def js_markup(src):
    """The HTML app.js writes, with everything that is not a string blanked.

    Only the inside of a string literal survives, so a tag named in a
    comment is not markup and `a > b` is not the end of a tag. Offsets
    are kept, so a line counted off this text is the line in the file,
    and the run of literals that builds one element reads as one string
    with the expressions between them blanked out.
    """
    stripped = jslex.strip(src)
    out = [c if c == "\n" else " " for c in src]
    i, n = 0, len(src)
    while i < n:
        if stripped[i] not in "'\"`":
            i += 1
            continue
        end = stripped.find(stripped[i], i + 1)
        if end < 0:
            break
        for k in range(i + 1, end):
            if src[k] != "\n":
                out[k] = src[k]
        i = end + 1
    return "".join(out)


# A toggle says pressed; a tab in a tablist says selected. Either is a
# state a screen reader reads out; a class is not.
STATE_ATTRS = ("aria-pressed", "aria-selected")


def check_pressed(src):
    """A button that goes on says so to a screen reader, not just to CSS.

    `is-on` is the whole of selected state on the segments, the bottle
    chips, the shape chips and the shelf chips. Sighted, that is a brass
    fill; with VoiceOver it is nothing at all, so the Stirred segment
    reads exactly like the Shaken one beside it. The recipe tabs and the
    print ticks already carried their state, which is why this was easy
    to miss: the pattern was here, just not everywhere.

    So: wherever a `<button>` this file writes takes ` is-on`, the same
    open tag carries `aria-pressed` (or `aria-selected`, for the tabs).
    A `<div>` that takes the class is skipped, because the button inside
    it is the control and carries the state itself.
    """
    markup = js_markup(src)
    errs = []
    for m in re.finditer(r"\sis-on\b", markup):
        open_at = markup.rfind("<", 0, m.start())
        if open_at < 0 or not re.match(r"<button\b", markup[open_at:open_at + 8]):
            continue
        close_at = markup.find(">", m.end())
        tag = markup[open_at:close_at if close_at > 0 else len(markup)]
        if any(a in tag for a in STATE_ATTRS):
            continue
        n = src.count("\n", 0, m.start()) + 1
        errs.append(f"assets/app.js:{n} a button takes `is-on` with no "
                    f"aria-pressed on the same tag — selected state a "
                    f"screen reader cannot hear")
    return errs


def check_method_line(src):
    """The instruction has to agree with the glass it is poured into.

    Sixteen built drinks are packed with ice and three are not, and the
    serve token is the only thing that knows which. `methodLine` shipped
    reading the method alone, so the Champagne Cocktail, the Seelbach and
    Death in the Afternoon all said `over ice` in a dry glass. That is a
    wrong instruction, not a wrong shade of grey, and nothing here caught
    it. So: the function takes the serve, and every call hands it over.
    """
    m = re.search(r"function methodLine\((.*?)\)", src)
    if not m:
        return ["assets/app.js methodLine is gone"]
    if len(m.group(1).split(",")) < 2:
        return ["assets/app.js methodLine no longer takes the serve token — "
                "a built drink in a dry glass would say `over ice`"]
    stripped = jslex.strip(src)
    calls = re.findall(r"methodLine\(([^)]*)\)", stripped)
    for args in calls:
        if args.strip().startswith("function") or "," in args:
            continue
        return [f"assets/app.js methodLine({args.strip()}) drops the serve "
                f"token — the built line would ignore the glass"]
    return []


def check_search_case(src):
    """A code is searched with the case the visitor typed, on a phone too.

    The shorthand spends case instead of a second letter: `q` is a
    quarter and `Q` three quarters, `h` a half ounce and `H` a packed
    highball. The search box folded the code in with the name and the
    ingredients, so `Q` returned every quarter-ounce drink on the menu
    and the three-quarter pours were unfindable.

    Two halves, and either one alone is worthless. The matcher has to
    compare `d.code` without folding it, and the box has to carry
    `autocapitalize="off"`, because a phone capitalises the first letter
    of a field by default and `q,h,q` typed would arrive as `Q,h,q`. The
    second is the one that breaks silently: it is right on the desk and
    wrong in the hand, which is where this menu is read.
    """
    errs = []
    m = re.search(r"function matches\(", src)
    if not m:
        return ["assets/app.js matches is gone"]
    stripped = jslex.strip(src)
    start = stripped.index("{", m.end())
    body = stripped[start:jslex.match_pair(stripped, start)]
    # By statement rather than by line, so folding the code over two
    # lines is caught the same as folding it on one.
    for stmt in body.split(";"):
        if "d.code" in stmt and "toLowerCase" in stmt:
            errs.append("assets/app.js matches() folds d.code — `Q` would "
                        "return every quarter-ounce drink on the menu")
            break
    if "d.code" not in body:
        errs.append("assets/app.js matches() no longer searches the code")

    tag = re.search(r"<input class=\\?\"search\\?\"(.*?)>", js_markup(src), re.S)
    if not tag:
        return errs + ["assets/app.js the search box is gone"]
    if "autocapitalize=" not in tag.group(1):
        errs.append("assets/app.js the search box has no autocapitalize — a "
                    "phone would capitalise the first letter and search a "
                    "code nobody typed")
    return errs


SHIPPED = ["index.html", "assets/app.css", "assets/app.js", "sw.js",
           "llms.txt", "llms-full.txt"]


def shipped_files():
    """Everything the site actually serves, as {name: text}."""
    names = SHIPPED + sorted(str(p.relative_to(ROOT))
                             for p in (ROOT / "data").glob("*.json"))
    out = {n: (ROOT / n).read_text() for n in names}
    out.update(page_files())
    return out


def check_dashes(texts):
    """No em dash in anything the site serves.

    A dash standing in for a pause is the surest tell of prose nobody
    edited, and it is banned here on the house's say-so rather than on
    taste. Comments count: they ship inside the file. The escaped
    spelling counts too, because JSON writes it that way and no reader
    can tell which spelling it arrived in.
    """
    errs = []
    for name, text in sorted(texts.items()):
        for n, line in enumerate(text.splitlines(), 1):
            if "\u2014" in line or "\\u2014" in line:
                errs.append(f"{name}:{n} em dash in a served file; a comma, "
                            f"a colon or a full stop says it")
    return errs


def check_drink_links(src):
    """Every drink id is reachable at the address its page links back to.

    `#drink/<id>` is the way into the app from a drink page, and the
    form older links still carry; the route that reads it back is one
    regex in app.js. Tighten that regex, or loosen
    the slug rule in check_menu.py, and some drink quietly stops opening
    from its own link. So the check runs the app's own pattern over the
    real menu rather than restating it here.
    """
    m = re.search(r"var DRINK_HASH = /\^#drink\\/\((.+?)\)\$/;", src)
    if not m:
        return ["assets/app.js DRINK_HASH is gone — the drink address no "
                "longer has a route"]
    # JavaScript and Python agree on this much of a character class.
    route = re.compile(m.group(1).replace("\\d", "[0-9]") + r"\Z")
    menu = json.loads((ROOT / "data" / "cocktails.json").read_text())
    return [f"data/cocktails.json {d['id']} cannot be opened by "
            f"#drink/{d['id']} — the route pattern does not match it"
            for d in menu["cocktails"] if not route.match(d["id"])]


def main():
    """The stylesheet, the page and the app, against CLAUDE.md."""
    css = (ROOT / "assets" / "app.css").read_text()
    html = (ROOT / "index.html").read_text()
    js = (ROOT / "assets" / "app.js").read_text()

    errs, defined = check_css(css)
    theme_errs, dark, light = check_themes(defined)
    errs += theme_errs
    errs += check_tokens(css, dark)
    errs += check_html(html, js)
    pages = page_files()
    for name, text in pages.items():
        errs += check_page(name, text)
    errs += check_delegation(js)
    errs += check_track(js)
    errs += check_bigint(js)
    errs += check_pressed(js)
    errs += check_method_line(js)
    errs += check_search_case(js)
    errs += check_drink_links(js)
    errs += check_dashes(shipped_files())

    for e in errs:
        print(f"  STYLE   {e}")
    if errs:
        return 1

    print(f"  style   {len(dark)} token(s), {len(light)} with a light "
          f"counterpart, no literal colour outside them")
    print(f"  a11y    labels, alt text and unique ids in index.html and "
          f"{len(pages)} static page(s)")
    print("  wiring  every click branch reachable, every track() key known, "
          "every drink id addressable")
    print("  search  a code keeps the case it was typed in, on a phone too")
    print("  state   every button that goes on says so, not just in CSS")
    print(f"  copy    no em dash in the {len(shipped_files())} file(s) the "
          f"site serves")
    return 0


if __name__ == "__main__":
    sys.exit(main())
