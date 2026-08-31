# drink.shoephone.net

Static site for one home bar's cocktail list. Sibling of
eat.shoephone.net, built the same way and sharing its conventions. No
build step, no framework, no database. Everything renders from three
JSON files.

This file is the working context. Read it before touching the menu.

## The bar

- One person's shelf, pouring for guests and for himself.
- The organising constraint is **range from few bottles**. The menu is
  large because the ingredients overlap, not because the bar is.
- Two methods, `stirred` and `shaken`, exactly as the printed card. A
  drink is shaken when juice, egg, or syrup carries it.
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
- The last token is the glass (`c` coupe, `r` rocks, `R` rocks with ice)
  followed by garnish letters, packed together. `ccin` is a coupe with
  grated cinnamon, not `c` + `i` + `n` — the decoder matches longest
  first, and that is load-bearing.

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
bowl. The checker fails on a stocked ingredient no drink uses, and a
garnish letter counts as use, so the bar cannot quietly drift.

### `data/notation.json`

The key tab, and the table the decoder reads from. Adding a garnish
letter here is what makes it decodable — there is no second list in the
JavaScript. `ingredient` on a garnish is the bottle it costs, and that
is the only place the mapping lives, so the same table that makes a
letter readable makes it countable.

## The marginal-gain engine

The Bar tab's number beside each unopened bottle is **drinks unlocked**,
computed by adding that bottle to the shelf and re-counting. It is not
how many recipes mention it. A bottle used in twelve drinks that unlocks
none reads `in 12`, greyed, and that is the honest answer.

This is the feature the site exists for. If it ever gets slow, memoise
it — do not replace it with a usage count.

The count is also the way in. Tapping it opens the Menu tab with the
shelf filter on, where the same list renders with a masthead and a print
button. A number that does not lead to the list it counts is trivia, so
if the tally ever stops being a button, that is a regression.

The print stylesheet forces the light palette outright. What theme a
phone happens to be in must never decide how much toner a menu costs.

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

## Conventions

- **Never commit, push, or deploy unless asked in that message.** Build,
  run `make verify`, then stop and show the diff. Enabling Pages, running
  `gh api` writes, and re-running a failed deploy are all the same
  category: not yours to decide.
- `make verify` before showing work. It is the whole pipeline.
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
- Taste describes what is in the glass. Do not define a pour by what it
  is not (`a real pour, not a ghost`, `grenadine is color, not a dessert`,
  `the sugar is a film, not a pour`). Say the amount and what it tastes
  like.
