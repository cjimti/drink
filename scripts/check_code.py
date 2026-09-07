#!/usr/bin/env python3
"""Size, complexity and foot-guns, in JavaScript, Python and shell.

There is no bundler and no package.json, so there is no eslint either.
That is a deliberate constraint, not an oversight — but "no linter" and
"no standard" are different things, and the second one is how a one-file
app quietly becomes unreadable.

So the standard lives here, in the repo, with no network and no install:

  * every function is measured — lines, cyclomatic complexity, nesting,
    argument count — against one set of limits, whatever it is written in
  * the handful already over the line are written down in BUDGET with the
    reason. A budget entry is a ceiling, not a pass: it holds a function
    at exactly today's size, so it can shrink and never grow. New work
    goes in a new function. An entry naming a function that no longer
    exists fails too, so the list cannot rot.
  * the foot-guns a static site cannot afford — eval, a stray console.log
    shipped to somebody's phone, a radix-less parseInt — fail here.

`shellcheck` runs when it is installed and is skipped, loudly, when it is
not. Nothing else about this is optional.
"""
import ast
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jslex  # noqa: E402  (path set above; there is no package here)

ROOT = Path(__file__).resolve().parent.parent

JS_FILES = ["assets/app.js", "sw.js"]
SH_FILES = ["scripts/verify-sentinel.sh"]

MAX_LINES = 80
MAX_COMPLEXITY = 25
MAX_NESTING = 5
# Seven, because a rectangle is four numbers and a canvas, a width and a
# colour is what you draw it with.
MAX_ARGS = 7

# Frozen ceilings. Each of these is an algorithm that really is a single
# thing, and each is load-bearing enough that taking it apart is its own
# ticket with its own review. An entry names only the measures that are
# over — everything else still answers to the limits above — and the
# number is what it measures today: make one smaller and lower the entry,
# make one bigger and this check fails.
BUDGET = {
    "assets/app.js:qrMatrix": dict(
        lines=204, complexity=88,
        why="the QR spec written small — placement, masking and format "
            "bits in the order the standard states them"),
    "assets/app.js:<document click>": dict(
        lines=128, complexity=28,
        why="one delegated click handler for the whole app. A new control "
            "adds a branch that calls a named function; it does not grow "
            "the handler"),
    "scripts/check_menu.py:main": dict(
        lines=117, complexity=47,
        why="the menu checker's report, one paragraph per rule, in the "
            "order the failures are worth reading"),
    "scripts/kin.py:analyse": dict(
        lines=95, complexity=36, nesting=8,
        why="the shape classifier — one ladder of ratios, where the order "
            "of the tests is the definition"),
    "scripts/kin.py:build": dict(
        complexity=26,
        why="assembles data/kin.json in one pass over every drink"),
}


def js_units(path, src):
    """Every function worth measuring: named declarations and listeners.

    An anonymous callback inside a named function counts toward that
    function — a render function that maps over three arrays really is
    doing three things. The delegated event handlers have no name to
    count toward, so they are units in their own right.
    """
    s = jslex.strip(src)
    taken, units = [], []

    def measure(name, args, head, at):
        """One unit, from the '{' after `head` to its matching '}'."""
        b = s.find("{", head)
        if b < 0:
            return
        end = jslex.match_brace(s, b)
        if any(b >= o and end <= c for o, c in taken):
            return                      # nested inside a unit already taken
        taken.append((b, end))
        body, depth, nest = s[b:end], 0, 0
        for ch in body:
            if ch == "{":
                depth += 1
                nest = max(nest, depth)
            elif ch == "}":
                depth -= 1
        units.append(dict(
            key=f"{path}:{name}",
            line=src.count("\n", 0, at) + 1,
            lines=body.count("\n") + 1,
            complexity=1 + len(re.findall(
                r"\bif\s*\(|\bfor\s*\(|\bwhile\s*\(|\bcase\b|\bcatch\s*\(|"
                r"&&|\|\||\?[^.]|\?\?", body)),
            nesting=nest,
            args=len([a for a in args.split(",") if a.strip()]),
        ))

    for m in re.finditer(r"\bfunction\s+(\w+)\s*\(([^)]*)\)", s):
        measure(m.group(1), m.group(2), m.end(), m.start())
    for m in re.finditer(r"(?:([\w.$]+)\s*\.)?addEventListener\s*\("
                         r"\s*'\s*'\s*,\s*(?:async\s+)?function\s*"
                         r"\(([^)]*)\)", s):
        # The event name was blanked with the rest of the string, so read
        # it back off the real source at the same offset. The receiver
        # goes in the name too: three things listen for 'click' here, and
        # a budget entry has to say which one it means.
        event = re.search(r"'([\w-]*)'", src[m.start():m.end()])
        measure(f"<{m.group(1) or '?'} {event.group(1) if event else '?'}>",
                m.group(2), m.end(), m.start())
    return units


def check_size(units):
    """Nothing over the limits, and nothing in BUDGET over its entry."""
    errs = []
    fields = (("lines", MAX_LINES), ("complexity", MAX_COMPLEXITY),
              ("nesting", MAX_NESTING), ("args", MAX_ARGS))
    for u in units:
        cap = BUDGET.get(u["key"])
        for field, limit in fields:
            ceiling = cap.get(field, limit) if cap else limit
            if u[field] > ceiling:
                errs.append(
                    f"{u['key']}:{u['line']} {field} {u[field]} over "
                    + (f"its budget of {ceiling}" if cap else
                       f"{ceiling} — split it, or write it into BUDGET "
                       f"with a reason"))
    return errs


def check_budget(units):
    """A budget entry for a function that is gone is a rotting list.

    Two functions sharing a key is the other way the list rots: the entry
    would quietly cover both, and the second one would never be measured.
    """
    live, twice = set(), set()
    for u in units:
        (twice if u["key"] in live else live).add(u["key"])
    errs = [f"{key} names two functions — one of them would inherit the "
            f"other's budget" for key in sorted(twice)]
    return errs + [f"{key} is in BUDGET and no longer exists — drop the entry"
                   for key in BUDGET if key not in live]


JS_BANNED = [
    (r"\beval\s*\(", "eval()"),
    (r"\bnew\s+Function\s*\(", "new Function()"),
    (r"\bdocument\.write\b", "document.write"),
    (r"\bdebugger\b", "debugger"),
    (r"\bconsole\.\w+\s*\(", "console.* — a phone is not a terminal"),
    (r"\balert\s*\(|\bconfirm\s*\(|\bwindow\.prompt\s*\(",
     "a modal dialog — it blocks the page and the page has its own"),
    (r"\bparseInt\s*\([^),]*\)", "parseInt without a radix"),
    (r"(?<![=!<>])==(?!=)(?!\s*null)", "== — use === (or == null)"),
    (r"(?<![!<>=])!=(?!=)(?!\s*null)", "!= — use !== (or != null)"),
    (r"\bsetTimeout\s*\(\s*'", "setTimeout on a string — it is eval"),
    (r"\bwith\s*\(", "with()"),
]


def check_js_practice(path, src):
    """The foot-guns, looked for in code only — not in strings or comments."""
    s, errs = jslex.strip(src), []
    for pattern, label in JS_BANNED:
        for m in re.finditer(pattern, s):
            errs.append(f"{path}:{s.count(chr(10), 0, m.start()) + 1} {label}")
    return errs


def check_whitespace(path, src):
    """No tabs, no trailing spaces, in any language."""
    errs = []
    for n, line in enumerate(src.splitlines(), 1):
        if line != line.rstrip():
            errs.append(f"{path}:{n} trailing whitespace")
        if "\t" in line:
            errs.append(f"{path}:{n} tab — this repo indents with spaces")
    return errs


BRANCHES = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler,
            ast.IfExp, ast.Match, ast.ListComp, ast.SetComp, ast.DictComp,
            ast.GeneratorExp)
BLOCKS = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.With, ast.Try,
          ast.ExceptHandler)


def py_complexity(node):
    """Cyclomatic complexity of one function, from its own AST."""
    n = 1
    for sub in ast.walk(node):
        if isinstance(sub, BRANCHES):
            n += 1
        elif isinstance(sub, ast.BoolOp):
            n += len(sub.values) - 1
    return n


def py_nesting(node, depth=0):
    """Deepest block nesting inside a function."""
    worst = depth
    for child in ast.iter_child_nodes(node):
        step = 1 if isinstance(child, BLOCKS) else 0
        worst = max(worst, py_nesting(child, depth + step))
    return worst


def py_units(path, tree):
    """Every def in the file, measured the same way the JavaScript is."""
    units = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            units.append(dict(
                key=f"{path}:{node.name}",
                line=node.lineno,
                lines=(node.end_lineno or node.lineno) - node.lineno + 1,
                complexity=py_complexity(node),
                nesting=py_nesting(node),
                args=len(node.args.args) + len(node.args.kwonlyargs),
            ))
    return units


def check_py_practice(path, tree):
    """The Python traps: bare except, a mutable default, `is` on a value."""
    errs = []
    if not ast.get_docstring(tree):
        errs.append(f"{path}:1 no module docstring — say what it is for")
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            defaults = node.args.defaults + [
                d for d in node.args.kw_defaults if d is not None]
            if any(isinstance(d, (ast.List, ast.Dict, ast.Set))
                   for d in defaults):
                errs.append(f"{path}:{node.lineno} mutable default argument")
        elif isinstance(node, ast.ExceptHandler) and node.type is None:
            errs.append(f"{path}:{node.lineno} bare except")
        elif isinstance(node, ast.Compare) and _is_on_a_value(node):
            errs.append(f"{path}:{node.lineno} `is` against a value — use ==")
    return errs


def _is_on_a_value(node):
    """True for `x is 3`. `is True` and `is None` are singletons, and are
    how a tri-state gets read; identity on a number or a string is a bug
    waiting for a different interpreter."""
    for op, cmp in zip(node.ops, node.comparators):
        if (isinstance(op, (ast.Is, ast.IsNot))
                and isinstance(cmp, ast.Constant)
                and isinstance(cmp.value, (int, str, bytes))
                and not isinstance(cmp.value, bool)):
            return True
    return False


def check_shell():
    """shellcheck when it is installed; a loud skip when it is not."""
    if not shutil.which("shellcheck"):
        print("  shell   SKIPPED — shellcheck not installed "
              "(brew install shellcheck)")
        return []
    errs = []
    for f in SH_FILES:
        r = subprocess.run(["shellcheck", "-x", f], cwd=ROOT,
                           capture_output=True, text=True)
        if r.returncode:
            errs.append(f"{f}\n{r.stdout.strip()}")
    return errs


def main():
    """Every source file in the repo, measured and inspected."""
    errs, units = [], []
    py_files = sorted(f"scripts/{p.name}" for p in (ROOT / "scripts").glob("*.py"))

    for f in JS_FILES:
        src = (ROOT / f).read_text()
        units += js_units(f, src)
        errs += check_js_practice(f, src)
        errs += check_whitespace(f, src)

    for f in py_files:
        src = (ROOT / f).read_text()
        try:
            tree = ast.parse(src, filename=f)
        except SyntaxError as e:
            errs.append(f"{f}:{e.lineno} {e.msg}")
            continue
        units += py_units(f, tree)
        errs += check_py_practice(f, tree)
        errs += check_whitespace(f, src)

    errs += check_size(units)
    errs += check_budget(units)
    errs += check_shell()

    for e in errs:
        print(f"  CODE    {e}")
    if errs:
        return 1

    print(f"  code    {len(units)} function(s) across "
          f"{len(JS_FILES) + len(py_files)} file(s) inside the limits "
          f"({MAX_LINES} lines, {MAX_COMPLEXITY} complexity, {MAX_NESTING} "
          f"deep, {MAX_ARGS} args); {len(BUDGET)} held at a written ceiling")
    return 0


if __name__ == "__main__":
    sys.exit(main())
