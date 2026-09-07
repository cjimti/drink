#!/usr/bin/env python3
"""A JavaScript lexer small enough to read, honest enough to lint with.

There is no bundler here and there never will be, so the checkers cannot
lean on a parser from npm. What they actually need is narrower than a
parser: the ability to tell code from a string, a comment, or a regex
literal. `esc(s)` inside a comment is not a call, `'if ('` inside a
string is not a branch, and `/if/` is neither.

`strip(src)` returns the source with every string body, comment body and
regex body blanked to spaces. Offsets and line counts survive untouched,
so a match found in the stripped text reports against the real file, and
brace depth in the stripped text is the real brace depth. Both files in
this repo strip to a perfectly balanced tree, which is the check that
says the heuristics below are holding.
"""

# A '/' can only open a regex literal where a value is expected. After a
# name, a number or a closing bracket it is division. This is the same
# rule every syntax highlighter uses.
_RE_OK = set("(,=:[!&|?{};+-*%~^<>") | {"\n"}
_RE_WORDS = ("return", "typeof", "case", "in", "of", "delete", "void",
             "instanceof", "do", "else", "yield", "await", "new")


def _regex_allowed(src, i):
    """True when the '/' at i opens a regex rather than dividing."""
    j = i - 1
    while j >= 0 and src[j] in " \t\r\n":
        j -= 1
    if j < 0 or src[j] in _RE_OK:
        return True
    k = j
    while k >= 0 and (src[k].isalnum() or src[k] == "_"):
        k -= 1
    return src[k + 1:j + 1] in _RE_WORDS


def _end_of_string(src, i):
    """Offset just past the closing quote of the string opening at i."""
    quote, j, n = src[i], i + 1, len(src)
    while j < n and src[j] != quote:
        j += 2 if src[j] == "\\" else 1
    return min(j + 1, n)


def _end_of_regex(src, i):
    """Offset just past the closing '/' of the regex opening at i."""
    j, n, klass = i + 1, len(src), False
    while j < n and src[j] != "\n":
        if src[j] == "\\":
            j += 2
            continue
        if src[j] == "[":
            klass = True
        elif src[j] == "]":
            klass = False
        elif src[j] == "/" and not klass:
            return j + 1
        j += 1
    return j


def _end_of_comment(src, i):
    """Offset just past the comment opening at i, either kind."""
    if src[i + 1] == "/":
        j = src.find("\n", i)
        return len(src) if j < 0 else j
    j = src.find("*/", i + 2)
    return len(src) if j < 0 else j + 2


def strip(src):
    """Blank out string, comment and regex bodies; keep every offset.

    The delimiters stay: a blanked string is still quotes with nothing
    between them, so `f('x')` still reads as a call with one argument.
    A comment goes entirely, delimiters and all, because it is not code
    in any sense. Newlines are never touched, in either case.
    """
    out, i, n = list(src), 0, len(src)
    while i < n:
        c = src[i]
        if c in "'\"`":
            end, keep = _end_of_string(src, i), 1
        elif c == "/" and i + 1 < n and src[i + 1] in "/*":
            end, keep = _end_of_comment(src, i), 0
        elif c == "/" and _regex_allowed(src, i):
            end, keep = _end_of_regex(src, i), 1
        else:
            i += 1
            continue
        for k in range(i + keep, min(end, n) - keep):
            if out[k] != "\n":
                out[k] = " "
        i = end
    return "".join(out)


def match_pair(text, start, opener="{", closer="}"):
    """Offset just past the bracket matching the one at start.

    `text` must already be stripped — an unbalanced brace inside a string
    would otherwise walk the scan off the end of the function.
    """
    depth = 0
    for i in range(start, len(text)):
        if text[i] == opener:
            depth += 1
        elif text[i] == closer:
            depth -= 1
            if depth == 0:
                return i + 1
    return len(text)


def match_brace(text, start):
    """Offset just past the '}' matching the '{' at start (text stripped)."""
    return match_pair(text, start)
