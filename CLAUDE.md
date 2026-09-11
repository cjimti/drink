# fewbottles.com

Static site for one home bar's cocktail list. No build step, no
framework, no database. Everything renders from three JSON files.

This file is the working context. Read it before touching the menu.

## The bar

- One person's shelf, pouring for guests and for himself.
- The organising constraint is **range from few bottles**. The menu is
  large because the ingredients overlap, not because the bar is.
- Three methods. `stirred` and `shaken` are the printed card: a drink is
  shaken when juice, egg, or syrup carries it. `built` is the long drinks
  added in 2026, made in the glass they are served in, ice first and the
  mixer last. Nothing counts methods by hand any more. The checker, the
  agent dumps and the segmented control all read `menu.methods`, so a
  fourth method costs one line of data.
- Drinks are grouped under a `family` — the section they print under.
  That is the menu's own filing, not a claim about the base spirit.
  So So Cocktail files under Apple Brandy and is mostly gin; Corpse
  Reviver No. 1 files there and leads with cognac. Leave it alone.
  Filtering works on what a drink actually contains, so the two never
  need to agree.

## The shorthand

The house code is the point of this project, so it is worth stating
precisely. It reads left to right in build order, base spirit first, and
ends with one token carrying glass plus garnish.

**It is contextual.** The same token means different things in different
slots, and the decoder resolves it against the ingredient:

- A bare number is **ounces** beside a spirit, **dashes** beside bitters.
  `2` is two ounces of rye or two dashes of Angostura.
- `h` `q` `Q` are 1/2, 1/4, 3/4 oz. Case is meaningful and always will
  be — `q` is a quarter, `Q` is three quarters.
- A digit and a fraction combine: `1h` is 1 1/2 oz.
- `b` is barspoons, `d` is dashes, bare `b`/`d` mean one.
- `r` in an amount slot is a **rinse**. `r` as the last token is a rocks
  glass with no ice. The Sazerac, `2,1b,4,r,r`, is both.
- `t` is a **top**: fill the glass with the mixer over the ice already in
  it. It never takes a number, because a top is however much the glass
  holds. `2t` is not a token and never will be.
- The last token is the glass (`c` coupe, `r` rocks, `R` rocks with ice,
  `h` highball for a fizz, `H` highball packed with ice) followed by
  garnish letters, packed together. `ccin` is a coupe with grated
  cinnamon, not `c` + `i` + `n` — the decoder matches longest first, and
  that is load-bearing. `h` is a half ounce everywhere except the last
  slot, where it is the tall glass. `r` already makes that bargain, and
  the serve token being last is what keeps it safe.

Garnish is on the shelf but never gates a drink. The letter for it
rides the serve token, and `notation.json` names the bottle it calls for
— a lemon twist costs a lemon — so the shelf stocks it and the Bar tab
counts who wants it. But **the build gates and the serve token does
not.** Garnish is optional; a Martini with no olive is still a Martini,
and the expanded recipe just strikes the missing twist through. `3` is
the exception that proves the line: those bitters sit in the build with
a `g` rather than in the serve token, which is why they still count.

Two things carry no amount token:

- **Egg white** is written into the build with `null`. It never had a
  measure in the shorthand and should not gain one.
- **Bitters dropped on the foam** live in the garnish token, not among
  the amounts. The Brass Rail's Angostura is the `3` in `c3`. Those get
  a third build element, `"g"`, so the drink still counts as needing
  them. They are a pour written into the garnish slot, not a garnish,
  which is why they gate when an olive does not.

## Data model

### `data/cocktails.json`

**IDs are stable keys — never rename or reuse one.** They key the
expanded-recipe state and any link anyone has sent.

Every drink carries both `code` and `build`. This is deliberate
duplication: `code` is transcribed from the paper menu and is the thing
being preserved, `build` is the same drink spelled out for the app.
`scripts/check_menu.py` regenerates the code from the build and refuses
any drink where the two disagree. That check is the only reason a
hundred-odd hand-typed shorthand strings can be trusted.

### `data/bar.json`

Every bottle any drink can call for, grouped by `kind` for the shelf.
`unit: "dash"` is what tells the decoder a bare number counts dashes;
`unit: "none"` marks the unmeasured ones. `shelf` overrides the name on
the Bar tab where the bottle and the pour want different words for the
same thing — one lemon is `Lemon juice` in a recipe and `Lemons` in a
bowl. `notes` is optional: a house recipe for making that bottle
(`parts` weighed amounts, `copy` the method). `bottles` is the shopping
list for that type, grouped by quality (`solid`, `elevated`, `excellent`,
`exceptional`, `alternatives`). The checkbox ticks the shelf; the rest of
the row reveals notes and the brand list when either is there, and does
nothing when there is neither. Ticking a brand ticks the parent; the last
brand unticked unticks it. An unknown bottle still ticks the parent on
its own. Homemade syrups are
weighed — a kitchen scale is required. The checker fails on a stocked ingredient no
drink uses, and a garnish letter counts as use, so the bar cannot
quietly drift. `catalog` is the exception: a type on the shopping list
before any drink calls for it. Those still need bottles.

`kind: mixer` is soda water, tonic, and ginger beer: the bottles that
fill the rest of the glass. They get no chip in the filter row, because
a guest chooses by spirit and the search box finds `soda`. Every mixer
counts as a highball in `kin.py`, whether the card writes it as `t` or
as four ounces.

`mint` carries `unit: "none"` and stays `kind: garnish`, and both are
true at once. The `m` in a serve token is a garnish and gates nothing;
the Mojito muddles mint into the build with no amount, and a build entry
always gates. Egg white already worked this way.

`stand_in` is the short list of bottles the house will pour in place of
this one. It is a hard gate turned soft where soft is honest: the card
writes the Old-Fashioned with demerara, and a shelf holding simple pours
it. A drink standing in counts as pourable, so the Bar tab's figure for
demerara drops to nothing once simple is ticked — buying it unlocks
nothing new, and that is the true answer. The list is tiny on purpose;
simple and demerara are the whole of it. Each direction is written out
and the checker refuses a stand-in of a different `kind`, so nothing
infers the reverse and no syrup ever stands in for a gin. The recipe
still says demerara, with what is standing in beside it, because the
card calls for demerara.

### `data/notation.json`

The key tab, and the table the decoder reads from. Adding a garnish
letter here is what makes it decodable — there is no second list in the
JavaScript. `ingredient` on a garnish is the bottle it costs, and that
is the only place the mapping lives, so the same table that makes a
letter readable makes it countable.

### `data/kin.json`

Generated. `scripts/kin.py` reads every build, files the drink under a
named shape (Martini, Sour, Daisy, Negroni, Old-Fashioned, Fancy,
Vermouth, Sparkling), and lists the nearest others of that shape with
the bottle that changed. The app does not recompute this.

`family` on a cocktail is still the printed-card section. Kin is a
second filing: the Martini and the Manhattan sit under gin and bourbon
on the card, and in the same pattern here. Do not write a `pattern`
onto the cocktail object — the generated file is the one source, and
`make verify` refuses a drift the same way it refuses a code that does
not match its build.

Adding a drink means running `python3 scripts/kin.py` (or `make kin`)
so the new one joins its family, then `make llms` so it appears in the
agent dumps. `make verify` refuses a stale copy of either. A handful of
drinks the ratio would misfile live as `OVERRIDE` at the top of the
script; keep that list small.

### Agent files

`llms.txt` and `llms-full.txt` are generated from the same JSON the app
reads. The first is the map (what this is, where the source lives, one
line per drink). The second is the menu spelled out, so an agent does
not have to run the decoder. Do not edit them by hand.

## The marginal-gain engine

The Bar tab's number beside each unopened bottle is **drinks unlocked**,
computed by adding that bottle to the shelf and re-counting. It is not
how many recipes mention it. A bottle used in twelve drinks that unlocks
none reads `in 12`, greyed, and that is the honest answer.

This is the feature the site exists for. If it ever gets slow, memoise
it — do not replace it with a usage count.

The count is also the way in. Tapping it opens the Menu tab with the
shelf filter on, where the same list renders with a Print menu reveal
on it. Closed, that is a row; open, it is the card title, ticks for
icon / recipe / taste / history / Barline, and the way onto paper.
Empty title stays “Your menu”. A number that does not lead to the list
it counts is trivia, so if the tally ever stops being a button, that is
a regression.

Same rule on a drink's Kin pane: the neighbour is a button that opens
that drink, and the count of the family opens the Families view of the
list it is counting. If either stops being a way through, that is a
regression.

**Next bottles** is the same figure lifted: the three best unopened
bottles, each naming the drinks it actually opens and what the solid
tier costs. Three, never more, and never ranked by usage count. It waits
for a shelf worth improving on — from nothing every figure is zero, and
a heading over three `+0` rows is worse than no heading.

**Three rows, always, while anything is still short.** Single bottles run
out long before the menu does: gin and tonic pour the Gin and Tonic, and
from there no one bottle opens a thing. The rows that singles leave empty
go to the smallest sets that do open something, and a set is selected in
one tap like a bottle. The candidates are the drinks themselves, since a
set worth naming is exactly what some drink is short of; any other set is
one of those with a bottle nobody needed added on top. Fewest bottles
first, then the biggest unlock, then what the rest of the menu wants,
which is the tie-break doing the real work: from one spirit almost every
pair opens exactly one drink, and without it the row is whichever drink
the card happens to print first. The heading says `One more bottle` while
every row is one bottle and `What to buy next` once a row names a set,
because a heading that says one bottle over a pair is a lie about what it
is asking you to buy.

The print stylesheet forces the light palette outright. What theme a
phone happens to be in must never decide how much toner a menu costs.
Paper is US Letter (8.5 × 11), two columns, a small QR to
fewbottles.com on the bottom of the sheet. The glass icon prints unless
you turn it off. Recipe, taste, and history print only when their ticks
are on; Barline, when ticked, is its own sheet after the drinks, the
same instructions as the Key tab. Kin never does. The named title is
the letterspaced cap.

The two columns are CSS multicol, which WebKit has never honoured on
paper (WebKit bug 15546, open since 2007): every browser on iOS, and
Safari on a Mac, would print one long column. So on WebKit `app.js`
renders the list already cut in two — `PRINT_SPLIT` — as two floated
halves balanced by a rough weight per row, and the screen CSS hides the
seam. Chrome and Firefox keep real columns, which balance per sheet.
Do not replace multicol with the split everywhere: a float pair reads
down the whole left half and then the whole right, so on a two-sheet
menu the order is wrong; multicol gets it right where it works.

## Sharing

A menu leaves the phone as one number: `fewbottles.com/?s=281474976710655`.
The shelf is a bitmask. Every ingredient in `bar.json` carries a `bit`,
and bit N set means that ingredient is stocked. Brands are never in the
code — a guest needs to know there is gin, not which gin.

**A bit is a stable key, like a cocktail id.** The links live in other
people's message threads, so a bit is assigned once and never moved or
reused. A new ingredient takes the next unused bit, wherever it sits in
the file. Dropping an ingredient means moving its bit into
`retired_bits`, and the checker refuses a duplicate or a retired bit.
There is no ceiling in the code itself: the number is a decimal string
read with `BigInt`, never `Number`, because a double is exact to 53 bits
and the fifty-fourth bottle would round the whole shelf. The QR encoder
in `app.js` stops at version 10, which leaves room for bits 0–621.

Share menu is the reveal above Print on the pourable list: a QR of the
link, the link itself, Copy, Send by text (`sms:` with the link in the
body), and the native share sheet where there is one. The QR encoder is
the standard written small — byte mode, level M — and is checked against
a reference library module for module; do not swap it for a CDN.

**One drink shares the same way.** A drink has its own address,
`fewbottles.com/drink/<id>/`, and the Share tab — last in the recipe
strip, after Kin — is the same card at a smaller size: the QR for
somebody standing in front of you with their own phone, the link for a
thread. A cocktail id is a stable key precisely because these links live
in other people's messages, exactly like a shelf bit.

**That address is a page, not a hash.** A hash never leaves the phone:
iMessage, Messages, X, Slack and Googlebot all fetch the address before
the `#` and read the meta tags they find there, with no JavaScript run.
So `scripts/pages.py` writes `drink/<id>/index.html` for every drink,
and `scripts/cards.py` draws `assets/cards/<id>.png`, the 1200 by 630
picture the link unfurls into: name, ingredient lines, method and glass,
the shorthand, and the glass art the serve token calls for. The page
carries the drink's title and description, the card in its og and
twitter tags, a Recipe block of JSON-LD on the same `#person` and
`#website` ids `index.html` uses, the recipe in the HTML, links to its
kin, and a link into the app at `#drink/<id>`. It does not redirect,
because a redirect is what makes a crawler index the front page
instead. Both are generated and committed, like `kin.json`: `make pages`
and `make cards` regenerate, `make verify` refuses a stale, missing or
orphaned one. Each card carries a hash of what it was drawn from in a
PNG text chunk, so the check reads 174 headers without Pillow and CI
holds the line with nothing installed; rendering needs Pillow and
rsvg-convert, like `make icons`. `sitemap.xml` is written by the same
script and lists every page. `404.html` is what GitHub serves for an
address nothing answers to, a drink dropped from the menu included.

The old `#drink/<id>` form still opens the drink and always will; the
page is what the Share tab hands out now. The tab title follows the one
drink that is open, so a bookmark says which. The address does not.

Opening `#drink/<id>` is a **way in, not state.** It shows the Menu with
that drink expanded and centred, dropping any filter that would hide it,
and then replaces the hash with `#menu` so the tab bar keeps working and
the back button does not bounce. An id nothing answers to opens the Menu
and says nothing. A kin link lands on the Kin pane, because that is the
pane you were reading; a drink link lands on the recipe, because
somebody sent you a drink. Nothing else writes the address: tapping a
row in the list does not.

Opening a shared link is **reading, not adopting**. The sender's shelf is
held in memory for the session and the list opens gated on it, with a
banner over the top. The chip row then carries a fourth menu, Shared
menu, the list their shelf pours, beside the three it always has (see
The chip row below). The guest's own shelf in
`localStorage` is not touched until they tap Make this my shelf, which
replaces it (brand ticks included, since brands do not travel) and
drops the parameter from the address. The service worker matches
navigations with `ignoreSearch` so a shared link opens offline from the
cached shell.

## The chip row

The last row of chips over the Menu list is one choice: which shelf the
list is gated on. `All bottles` is the whole card and where a first
visit lands. `My Shelf` is what your bottles pour. The third chip is
`Starter Shelves` until a named shelf is loaded, and takes you to that
list on the Bar tab; once one is loaded it is that shelf, so the row
reads All bottles, My Shelf, Gin shelf. A shared link adds `Shared
menu` for the session. They select rather than toggle, since with All
bottles on the row there is always a way off a menu. Each chip carries
the drinks it counts.

The two tab badges read the same choice. Menu is the drinks on the
selected menu and Bar is the bottles it is made from: every drink and
every bottle under All bottles, what a shelf pours and what it holds
otherwise. Print, Share and Big type follow the same choice, so under
All bottles the sheet is the whole card and the link is the bare
address. `Clear` drops the other filters and keeps the menu you chose.
`selectMenu` is the only place the two gate flags are written.

## Families

A fourth segment after All / Stirred / Shaken. It regroups the same
menu by shape instead of by method and printed section. Pattern chips
appear only in that view. Print still hides the Kin pane; a Families
print is the list under those headings, light palette, same as any
other menu.

## Design

The printed menu is pure black and white: a heavy rule under a
letterspaced cap, italic ingredient lines, the shorthand set small and
grey in the margin. This is that page after dark.

On screen the shorthand is the exception: it reads in full-strength ink,
not grey, because the code is the thing this project exists to preserve.
The print stylesheet puts it back to grey, so paper still looks like the
card.

Dark is the default because a menu gets read in a dim room. **Light mode
is not an inversion** — it is the printed page, near enough to hold the
two side by side.

One accent. Brass carries every earned state: a filter that is on, a
drink you can actually pour, the count that goes up when you buy a
bottle. Nothing else is allowed to be gold.

Type is Montserrat (display, tracked caps, as on the card), Lato (body
and the italic ingredient lines), DM Mono (codes and quantities).
Mobile-first, safe-area aware, no shadows.

Every colour is a token on `:root` with a light counterpart. A literal
hex outside those two blocks is a bug — it will be wrong in one theme.
`--on-brass` exists because brass goes dark in light mode, so text
sitting on the brass fill has to flip with it.

## The gate

`make verify` is the whole pipeline, and there is no build step for it to
hide behind. It runs, in order:

- `json` — every data file and the manifest parse.
- `syntax` — `node --check` on `app.js` and `sw.js`, `py_compile` on
  every script.
- `lint` — `check_code.py` and `check_style.py`, below.
- `test` — `test_checks.py` breaks every rule on purpose and fails if a
  checker sleeps through it. A linter nobody has seen fail passes
  everything.
- `menu` — codes match builds, `kin.json` matches the builds, the agent
  dumps, the drink pages and the share cards match the menu.
- `assets` — every file `index.html` asks for exists, every id the app
  reaches for is rendered, the worker safeguards are still in place.

**`scripts/check_code.py`** is the linter this repo has instead of eslint,
because there is no `package.json` and there is not going to be one. It
measures every function — JavaScript and Python alike — for length,
cyclomatic complexity, nesting and argument count, and it fails on the
foot-guns a static site cannot afford: `eval`, a `console.log` shipped to
somebody's phone, a radix-less `parseInt`, `==`, a bare `except`, a
mutable default. `scripts/jslex.py` is what lets it tell code from a
string, a comment or a regex without a parser from npm.

Five functions are already over the line and live in `BUDGET` at the top
of the file with the reason. **A budget entry is a ceiling, not a pass:**
it holds a function at exactly today's size, so it can shrink and never
grow, and an entry naming a function that no longer exists fails too.
When the delegated click handler needs a new branch, the branch calls a
named function; it does not grow the handler.

**`scripts/check_style.py`** enforces this file: a literal colour outside
the token blocks, a colour token with no light counterpart, a shadow, a
font stack that is not one of the three tokens, an `<img>` with no `alt`,
a control with no accessible name, a duplicate id, an `aria-controls`
pointing at nothing. It also holds the three contracts the app would
otherwise break silently — a `track()` parameter missing from
`TRACK_KEYS`, a click branch whose `data-` attribute is missing from the
delegation selector (a dead button, on the device you did not test), and
the shelf code read with anything but `BigInt`.

Adding a check is cheap and adding a case to `test_checks.py` beside it
is the price. Do not raise a limit to make a new function fit.

## Conventions

- **Never commit, push, or deploy unless asked in that message.** Build,
  run `make verify`, then stop and show the diff. Enabling Pages, running
  `gh api` writes, and re-running a failed deploy are all the same
  category: not yours to decide. **Tagging is in that category too.**
  Cutting a tag now publishes the site and creates a release, so it is
  the user's call, never the model's.
- **Only a tag ships.** A push to `main` runs `make check` and deploys
  nothing; pushing a `v*` tag runs the checks, stamps the tag into
  `sw.js` and `assets/app.js`, deploys Pages, and then creates the
  GitHub release from generated notes, so a release cannot exist for
  something that never went live. The tag is the only place a version is
  written: no `VERSION` file, nothing in `manifest.webmanifest`. `sw.js`
  keys its cache on `__BUILD__` and `app.js` prints `__VERSION__`, each
  of which appears exactly once in its file because the deploy `sed`s
  for it. Unstamped is a working copy and reads `dev`.
- `make verify` before showing work. It is the whole pipeline.
- **Adversarially review your own diff before you call it done.** After
  `make verify` passes and before the diff goes up, read the change back
  as somebody trying to break it, not as the person who wrote it. A green
  pipeline says the rules you thought of are unbroken; it says nothing
  about the ones you did not. Walk the change once for each of:

  - **The empty and the enormous.** No shelf, one bottle, every bottle. A
    drink with no taste, no history, no kin. A menu title of nothing and
    a menu title of two hundred characters. First visit, and a visit with
    stale `localStorage` from three versions ago.
  - **The other three renderings.** Light as well as dark, 390px as well
    as 1280, and print preview whenever the Menu list is touched. A rule
    that reads fine on screen can cost a page of toner.
  - **The paths that are not the happy one.** Offline with the worker
    serving, a clipboard that says no, `navigator.share` absent, a hash
    naming a drink that does not exist, a shared code with a retired bit.
  - **What the change quietly assumes.** Every id, bit and `data-`
    attribute is a stable key somebody may already hold a link to. Ask
    what breaks for the person who saved a link last week.
  - **The claim you are about to make.** If you are going to write "this
    works", name what you actually ran. Anything you did not check is
    said out loud in the summary, not left for review to find.

  Fix what this turns up, then run `make verify` again. Report what the
  pass found — including "nothing" — rather than leaving it implied.
- **A service worker owns an origin, not a project.** Every static site
  in this workspace serves `./`, `index.html` and `assets/app.js`, so a
  worker registered on `http://localhost:8000` will answer for whichever
  project runs there next, cache-first, and go on answering after that
  dev server is gone. This repo serves on **8010** for that reason — one
  port per project, so the origins never overlap.
- **Declining to register is not a fix.** A worker already installed
  keeps serving the old `app.js`, so a guard added later never executes.
  Off https, `app.js` actively unregisters and drops caches, and `sw.js`
  takes itself out if it ever wakes up off https. `check_assets.py`
  fails the build if either safeguard goes missing.
- An iOS home-screen WebView resumes without navigating, so it will not
  check for a new worker on its own, and a worker that merely claims
  still leaves the old shell on screen. Production registration uses
  `updateViaCache: 'none'` and pokes `update()` on foreground; a worker
  that drops an old cache navigates its clients onto the new one.
  `check_assets.py` fails the build if those are missing.
- Symptom to recognise: the page loads, or shows stale content, with
  nothing listening on the port. Check `lsof -nP -iTCP:<port>` before
  believing anything the browser shows you. `make unstick` prints the
  manual recovery.
- Keep it dependency-free. Vanilla JS, no bundler, no package.json.
- Transcribe the paper menu faithfully, including its own typos —
  `Improved Coctail` is spelled that way on the card. Fix a recipe only
  when the user says to, not because a reference book disagrees.
- If a transcribed amount looks way off — half the spirit every sibling
  pours, a 1 oz Old-Fashioned — ask before writing notes around it. Do
  not silently correct it, and do not treat an obvious typing error as
  the card.
- **No em dash in anything the site serves.** `check_style.py` fails on
  one, in `index.html`, `app.css`, `app.js`, `sw.js`, the data files and
  the agent dumps, comments included, and on the escaped `\u2014` spelling
  too. A dash standing in for a pause is the surest tell of prose nobody
  edited. A comma, a colon or a full stop says the same thing.
- Copy a visitor reads is plain and first person where it is Craig
  speaking. No word does promotional work, nothing "serves as" anything,
  and a thing is what it is rather than what it represents.
- Taste describes what is in the glass. Do not define a pour by what it
  is not (`a real pour, not a ghost`, `grenadine is color, not a dessert`,
  `the sugar is a film, not a pour`). Say the amount and what it tastes
  like.
