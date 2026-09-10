/* fewbottles.com: the cocktail menu.

   Two ideas carry the whole app.

   The first is that the house shorthand is decodable. Every code on the
   printed menu is contextual, so a bare number is ounces beside a spirit
   and dashes beside bitters. The decoder reads each amount against
   the ingredient it belongs to. That is what turns a margin note into a
   recipe without anyone having to type the recipe twice.

   The second is that the menu is a function of the shelf. The point of
   this bar is range from few bottles, so the Bar tab is not a checklist
   for its own sake: it computes what each unopened bottle would add, in
   drinks, and that number is the whole reason to buy one.

   Kin is the third cut: drinks of the same shape in different bottles.
   The Martini and the Manhattan share almost no ingredients and share
   almost the whole pour. scripts/kin.py works that out; this file only
   renders it. */

(function () {
  'use strict';

  var STORE = 'drink.bar.v1';
  var BRAND_STORE = 'drink.brands.v1';
  var TITLE_STORE = 'drink.menuTitle.v1';
  var PRINT_STORE = 'drink.print.v1';
  var INTRO_STORE = 'drink.intro.v1';
  var SHARE_PARAM = 's';  /* fewbottles.com/?s=<shelf code> */

  /* Stamped with the tag at deploy time, the way sw.js is. Unstamped is a
     working copy, and says so. The test is a shape rather than the token
     spelled out a second time, because the deploy seds for that token and
     it must appear exactly once. */
  var VERSION = '__VERSION__';
  var versionLabel = /^v\d/.test(VERSION) ? VERSION : 'dev';

  var FRACTION = { h: '1/2', q: '1/4', Q: '3/4' };

  var data = {};
  var ing = {};          /* id -> ingredient */
  var standInBy = {};    /* id -> bottles that may be poured in its place */
  var cocktailBy = {};   /* id -> cocktail */
  var methodBy = {};     /* id -> method */
  var patternBy = {};    /* id -> kin pattern */
  var garnishCodes = []; /* longest first */
  var glassBy = {};
  var garnishBy = {};

  var have = {};         /* id -> true, what is on the shelf */
  var own = {};          /* brand id -> true, which listed bottles you have */
  var open = {};         /* id -> true, which recipes are expanded */
  var noteOpen = {};     /* id -> true, which bottle notes are expanded */
  var recipePane = {};   /* id -> recipe|taste|history|kin; resets on open */
  var glassMarkup = {};  /* art id -> inline svg */

  var filter = emptyFilter();
  var searchTimer = null;
  var menuTitle = '';     /* name on the printed card; empty is "Your menu" */
  var printOpen = false;  /* Print menu reveal, session only */
  var shareOpen = false;  /* Share menu reveal, session only */
  var chipsOpen = false;  /* the whole bottle-filter row, wide screens only */
  var tonight = false;    /* big type for the bar, session only, never saved */
  var shared = null;      /* { have, code } once a shared link has been opened; stays for the session */
  var introDone = false;  /* the first-run strip has been dismissed, for good */
  var shelfView = 'mine'; /* 'mine' or a named shelf id; session only, never saved */
  var shelfOpen = null;   /* named shelf whose Switch / Add choice is open, session only */
  var startersOpen = false; /* Starter Shelves reveal on the Bar tab, session only */
  var printOpts = { icon: true, recipe: false, taste: false, history: false, barline: false };

  /* WebKit has never paginated CSS multicol (WebKit bug 15546, open
     since 2007), so every browser on iOS, and Safari on a Mac, prints the
     two-column card as one long column. Those get the list cut in two by
     hand and floated side by side, which every engine paginates. Chrome
     and Firefox keep real columns: they balance per sheet and read down
     the left then the right of each page, which a float cannot. */
  var PRINT_SPLIT = (function () {
    var ua = navigator.userAgent;
    var ios = /iP(hone|ad|od)/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var safari = /AppleWebKit/.test(ua) &&
      !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
    return ios || safari;
  })();

  /* Wide enough for the list and the open recipe to sit side by side.
     Below this the app is the phone column it has always been, and the
     recipe unfolds under the row it belongs to. */
  var WIDE = window.matchMedia('(min-width: 900px)');

  /* Where the open recipe goes. Tonight is one column of big type on any
     screen, so the aside stands down for it. */
  function asideLive() { return WIDE.matches && !tonight; }

  function emptyFilter() {
    /* pourable is the My Shelf chip: the list gated by your shelf, or by
       the named shelf you are looking at. shared is Shared menu: the same
       gate against the shelf someone sent. One at a time. */
    return { method: 'all', family: null, pattern: null, pourable: false, shared: false, q: '' };
  }

  /* The shelf's running order, fixed on the way into the tab. See
     renderBar. */
  var barOrder = null;
  var lastCan = null;    /* what the tally said last time, to move it */
  var lastRail = null;   /* the same, for the count in the Menu's rail */

  /* ── helpers ───────────────────────────────────────────── */

  function $(s) { return document.querySelector(s); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* Named events for Google Tag Manager. The snippet in index.html
     owns dataLayer; we only push. Each event is one thing a person
     did, with the ids the reports will group by. Skip http so a
     localhost session does not pollute production. In GTM, a GA4
     Event tag that fires on these Custom Event names is enough;
     the params ride along as event parameters.

     The dataLayer is a merged model, not a payload per event: a key
     left out of a push keeps its last value, so a share_copy after a
     drink_open would still carry that drink's id. Every push therefore
     resets every key any event can send. undefined clears a key from
     the model; null does not, GA4 would send it. TRACK_KEYS is the
     whole set, so a new parameter goes here or it goes stale, and the
     container's regex and variables need the new name too. */
  var TRACK_KEYS = [
    'tab',
    'drink_id', 'drink_name', 'pane', 'from_id',
    'filter_type', 'filter_value', 'search_term', 'pattern',
    'bottle_id', 'brand_id', 'stocked', 'open', 'action',
    'bottles', 'drinks',
    'named', 'icon', 'recipe', 'taste', 'history', 'barline',
    'opt', 'on'
  ];

  function track(name, params) {
    if (location.protocol !== 'https:') return;
    var payload = { event: name };
    TRACK_KEYS.forEach(function (k) { payload[k] = undefined; });
    if (params) {
      Object.keys(params).forEach(function (k) {
        if (params[k] !== undefined && params[k] !== null) payload[k] = params[k];
      });
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
  }

  function drinkName(id) {
    return (cocktailBy[id] && cocktailBy[id].name) || id;
  }

  /* The lowercase form a bottle takes inside a sentence. `short` is the
     field for it, and the shelf already reads that way in "Need simple". */
  function shortName(id) {
    var i = ing[id] || {};
    return i.short || i.name || id;
  }

  /* Escape first, then promote `backticked` spans to mono. Case carries
     meaning in this notation, and a proportional face makes l/L and o/O
     a guess. */
  function lit(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code class="lit">$1</code>');
  }

  /* ── the decoder ───────────────────────────────────────── */

  /* An amount is read against its ingredient, because the same token
     means different things in different slots. `2` is two ounces of rye
     and two dashes of Angostura, and only the ingredient knows which. */
  function readAmount(token, ingredient) {
    if (token === null || token === undefined) {
      return { text: '\u00b7', note: 'one' };
    }
    if (token === 'r') return { text: 'rinse', note: '' };
    if (token === 't') return { text: 'top', note: '' };

    var m;

    if ((m = /^(\d*)b$/.exec(token))) {
      var b = m[1] === '' ? 1 : +m[1];
      return { text: plural(b, 'barspoon', 'barspoons'), note: '' };
    }

    if ((m = /^(\d*)d$/.exec(token))) {
      var d = m[1] === '' ? 1 : +m[1];
      return { text: plural(d, 'dash', 'dashes'), note: '' };
    }

    /* A bare number beside bitters counts dashes, not ounces. */
    if (/^\d+$/.test(token) && ingredient && ingredient.unit === 'dash') {
      return { text: plural(+token, 'dash', 'dashes'), note: '' };
    }

    if ((m = /^(\d+)([hqQ])$/.exec(token))) {
      return { text: m[1] + ' ' + FRACTION[m[2]] + ' oz', note: '' };
    }

    if (FRACTION[token]) return { text: FRACTION[token] + ' oz', note: '' };

    if (/^\d+$/.test(token)) return { text: token + ' oz', note: '' };

    return { text: token, note: '' };
  }

  /* The last token of a code is one word: a glass, then any garnishes
     packed onto it. Longest match first, or `ccin` reads as c + i + n. */
  function readServe(serve) {
    var glass = glassBy[serve[0]];
    var rest = serve.slice(1);
    var found = [];

    while (rest) {
      var hit = null;
      for (var i = 0; i < garnishCodes.length; i++) {
        if (rest.indexOf(garnishCodes[i]) === 0) { hit = garnishCodes[i]; break; }
      }
      if (!hit) break;
      found.push(garnishBy[hit]);
      rest = rest.slice(hit.length);
    }

    return {
      glass: glass ? glass.label : serve[0],
      gloss: glass ? glass.gloss : '',
      garnish: found
    };
  }

  /* ── the shelf ─────────────────────────────────────────── */

  function loadHave() {
    try { have = JSON.parse(localStorage.getItem(STORE)) || {}; }
    catch (e) { have = {}; }
  }

  function saveHave() {
    try { localStorage.setItem(STORE, JSON.stringify(have)); } catch (e) { /* private mode */ }
  }

  function loadOwn() {
    try { own = JSON.parse(localStorage.getItem(BRAND_STORE)) || {}; }
    catch (e) { own = {}; }
  }

  function saveOwn() {
    try { localStorage.setItem(BRAND_STORE, JSON.stringify(own)); } catch (e) { /* private mode */ }
  }

  function loadMenuTitle() {
    try {
      menuTitle = (localStorage.getItem(TITLE_STORE) || '').replace(/\s+/g, ' ').trim();
    } catch (e) { menuTitle = ''; }
  }

  function saveMenuTitle() {
    try {
      if (menuTitle) localStorage.setItem(TITLE_STORE, menuTitle);
      else localStorage.removeItem(TITLE_STORE);
    } catch (e) { /* private mode */ }
  }

  /* What actually prints. Empty stays "Your menu" so a nameless card
     is still a card, not a blank rule. */
  function cardTitle() {
    var t = (menuTitle || '').replace(/\s+/g, ' ').trim();
    return t || 'Your menu';
  }

  function syncPrintTitle() {
    var el = document.querySelector('.tonight__print-title');
    if (el) el.textContent = cardTitle();
  }

  function loadPrintOpts() {
    try {
      var o = JSON.parse(localStorage.getItem(PRINT_STORE) || 'null');
      if (o && typeof o === 'object') {
        printOpts.icon = o.icon !== false;
        printOpts.recipe = !!o.recipe;
        printOpts.taste = !!o.taste;
        printOpts.history = !!o.history;
        printOpts.barline = !!o.barline;
      }
    } catch (e) { /* private mode */ }
  }

  function savePrintOpts() {
    try { localStorage.setItem(PRINT_STORE, JSON.stringify(printOpts)); }
    catch (e) { /* private mode */ }
  }

  /* The first-run strip. An empty shelf is the only thing that asks for
     it, so it goes on its own the moment a bottle is ticked; the flag is
     only for the visitor who says no while the shelf is still empty. */
  function loadIntro() {
    try { introDone = !!localStorage.getItem(INTRO_STORE); }
    catch (e) { introDone = false; }
  }

  function saveIntro() {
    try { localStorage.setItem(INTRO_STORE, '1'); } catch (e) { /* private mode */ }
  }

  /* Body classes are what the print stylesheet keys off, so a tick
     has to land before window.print, not on the next repaint. */
  function applyPrintFlags() {
    document.body.classList.toggle('is-print-icon', printOpts.icon !== false);
    document.body.classList.toggle('is-print-recipe', !!printOpts.recipe);
    document.body.classList.toggle('is-print-taste', !!printOpts.taste);
    document.body.classList.toggle('is-print-history', !!printOpts.history);
    document.body.classList.toggle('is-print-barline', !!printOpts.barline);
  }

  function bottleHasBrands(i) {
    return !!(i && i.bottles && i.bottles.length);
  }

  /* A listed brand is enough to stock the type. Unknown bottles still
     tick the parent on their own, so this only turns a parent *on*. */
  function syncHaveFromBrands() {
    data.bar.ingredients.forEach(function (i) {
      if (!bottleHasBrands(i)) return;
      var any = i.bottles.some(function (b) { return own[b.id]; });
      if (any) have[i.id] = true;
    });
  }

  function clearBrandsFor(id) {
    var i = ing[id];
    if (!bottleHasBrands(i)) return;
    i.bottles.forEach(function (b) { delete own[b.id]; });
  }

  function stocked(held) {
    held = held || have;
    return Object.keys(held).filter(function (k) { return held[k] && ing[k]; });
  }

  /* The shelf the menu reads. A named shelf is a view: it does not
     overwrite My Shelf. Shared menu is the sender's, in memory. */
  function viewingShared() { return !!(shared && filter.shared); }

  function presetById(id) {
    return (data.bar.shelves || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  function namedHave(id) {
    var preset = presetById(id);
    var h = {};
    if (!preset) return h;
    preset.ingredients.forEach(function (sid) { if (ing[sid]) h[sid] = true; });
    return h;
  }

  /* The shelf the Bar tab and the shelf chip are on, whatever a shared
     link is doing: yours, or the named one you are looking at. */
  function viewHave() { return shelfView === 'mine' ? have : namedHave(shelfView); }

  function viewName() {
    var p = shelfView === 'mine' ? null : presetById(shelfView);
    return p ? p.label : 'My Shelf';
  }

  function heldNow() {
    return viewingShared() ? shared.have : viewHave();
  }

  /* Only My Shelf can be edited. A named shelf and a shelf someone sent
     are things you read, so every control that would add a bottle is
     disabled while one of them is up. A tick that silently landed on
     your own shelf while you were reading another is worse than a tick
     that does not happen. */
  function editing() { return shelfView === 'mine' && !viewingShared(); }

  /* Either menu gates the list on a shelf; only which shelf differs. */
  function shelfGate() { return filter.pourable || filter.shared; }

  /* Two lists, because there are two different questions.

     What a drink *pours* is its build, and missing one of those is the
     end of it. What it *needs* adds whatever the serve token garnishes
     it with, a real call on the shelf since a lemon twist costs a
     lemon, but never a reason to say no. A Martini with no olive is
     still a Martini.

     So the line is the whole rule: the build gates, the serve token does
     not. The bitters dropped on a sour's foam are in the build with a
     "g" flag rather than in the serve token, which is exactly why those
     still count.

     Worked out once per drink at boot: marginalGain asks these a few
     thousand times per render of the Bar tab. */
  var poursBy = {};
  var needsBy = {};

  function buildNeeds() {
    data.menu.cocktails.forEach(function (d) {
      var pours = [];
      var all = [];

      function add(list, id) { if (id && list.indexOf(id) < 0) list.push(id); }

      d.build.forEach(function (p) { add(pours, p[0]); add(all, p[0]); });
      readServe(d.serve).garnish.forEach(function (g) { add(all, g.ingredient); });

      poursBy[d.id] = pours;
      needsBy[d.id] = all;
    });
  }

  /* Everything a bottle is wanted for, garnish included. This answers
     "who calls for this", which is the shelf's question. */
  function needs(d) { return needsBy[d.id]; }

  /* Only what has to end up in the glass. This is the one that gates. */
  function pours(d) { return poursBy[d.id]; }

  /* A stand-in is a bottle the house will pour in place of another, close
     enough that the drink is still the drink. The table is in bar.json and
     it is tiny on purpose; each direction is written out there, so nothing
     here infers the reverse.

     It is a hard gate turned soft where soft is honest. The card writes the
     Old-Fashioned with demerara, and a beginner holding a bottle of simple
     reads a hard gate as a bug. It is not a bug, but it is not the truth
     either: that shelf pours the drink. */
  function standInHeld(id, held) {
    var subs = standInBy[id];
    if (!subs) return null;
    for (var n = 0; n < subs.length; n++) {
      if (held[subs[n]]) return subs[n];
    }
    return null;
  }

  function missingFor(d, held) {
    var out = [];
    pours(d).forEach(function (id) {
      if (held[id] || standInHeld(id, held)) return;
      if (out.indexOf(id) < 0) out.push(id);
    });
    return out;
  }

  /* Which bottle is doing the standing in, once missingFor has already
     said the drink pours. Display only; the gate is answered elsewhere. */
  function standInFor(d, held) {
    var out = [];
    pours(d).forEach(function (id) {
      if (held[id]) return;
      var use = standInHeld(id, held);
      if (use) out.push({ want: id, use: use });
    });
    return out;
  }

  function canPour(d, held) { return missingFor(d, held).length === 0; }

  function pourableCount(held) {
    return data.menu.cocktails.filter(function (d) { return canPour(d, held); }).length;
  }

  /* This shelf with those bottles added. The answer to every figure on
     the Bar tab is a diff against it. */
  function withBottles(held, ids) {
    var out = {};
    Object.keys(held).forEach(function (k) { out[k] = held[k]; });
    ids.forEach(function (id) { out[id] = true; });
    return out;
  }

  /* What one more bottle is worth, in drinks. This is the number the
     whole bar is organised around, so it is the number on the shelf. */
  function marginalGain(id, held) {
    if (held[id]) return 0;
    return rowGain([id], held);
  }

  /* The same question put to a set rather than a bottle. */
  function rowGain(ids, held) {
    return pourableCount(withBottles(held, ids)) - pourableCount(held);
  }

  function subsetOf(small, big) {
    return small.every(function (id) { return big.indexOf(id) >= 0; });
  }

  /* Every drink this shelf cannot pour, each as the bottles it is short
     of. Sorted so two drinks short of the same pair read as one set. */
  function shortOf(held) {
    var out = [];
    data.menu.cocktails.forEach(function (d) {
      var miss = missingFor(d, held);
      if (miss.length) out.push(miss.slice().sort());
    });
    return out;
  }

  /* How many drinks this named shelf pours on its own. The figure is
     the shelf, not what it would add on top of My Shelf. */
  function shelfGain(preset) {
    var held = {};
    preset.ingredients.forEach(function (id) { if (ing[id]) held[id] = true; });
    return pourableCount(held);
  }

  function usageCount(id) {
    return data.menu.cocktails.filter(function (d) {
      return needs(d).indexOf(id) >= 0;
    }).length;
  }

  /* ── QR ────────────────────────────────────────────────── */

  /* A byte-mode QR encoder, error level M, versions 1 to 10. That is
     enough for a URL a few hundred characters long, which is more than
     a shelf code will ever need. Nothing here is specific to the menu;
     it is the standard, written small. */

  /* Per version, 1 to 10: error codewords in each block, and how many
     blocks. Both at level M. */
  var QR_ECC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var QR_BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

  function qrRawModules(ver) {
    var n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var align = Math.floor(ver / 7) + 2;
      n -= (25 * align - 10) * align - 55;
      if (ver >= 7) n -= 36;
    }
    return n;
  }

  function qrDataBytes(ver) {
    return Math.floor(qrRawModules(ver) / 8) - QR_ECC[ver - 1] * QR_BLOCKS[ver - 1];
  }

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  /* Reed-Solomon remainder of `data` against a generator of `degree`. */
  function rsRemainder(data, degree) {
    var gen = [1];
    var root = 1;
    var i, j;
    for (i = 0; i < degree; i++) {
      var next = [];
      for (j = 0; j <= gen.length; j++) next.push(0);
      for (j = 0; j < gen.length; j++) {
        next[j] ^= gen[j];
        next[j + 1] ^= gfMul(gen[j], root);
      }
      gen = next;
      root = gfMul(root, 2);
    }
    gen.shift();
    var rem = [];
    for (i = 0; i < degree; i++) rem.push(0);
    data.forEach(function (b) {
      var factor = b ^ rem.shift();
      rem.push(0);
      for (j = 0; j < degree; j++) rem[j] ^= gfMul(gen[j], factor);
    });
    return rem;
  }

  /* Bytes to send, as codewords: segment header, data, terminator,
     padding, then the error blocks interleaved the way the spec wants. */
  function qrCodewords(bytes, ver) {
    var cap = qrDataBytes(ver);
    var bits = [];
    function put(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }
    put(4, 4);
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    for (var pad = 0xEC; bits.length < cap * 8; pad ^= 0xEC ^ 0x11) put(pad, 8);

    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      data.push(b);
    }

    var nb = QR_BLOCKS[ver - 1];
    var ecc = QR_ECC[ver - 1];
    var total = Math.floor(qrRawModules(ver) / 8);
    var shortBlocks = nb - (total % nb);
    var shortLen = Math.floor(total / nb) - ecc;
    var blocks = [];
    var at = 0;
    for (var n = 0; n < nb; n++) {
      var len = shortLen + (n < shortBlocks ? 0 : 1);
      var chunk = data.slice(at, at + len);
      at += len;
      var rem = rsRemainder(chunk, ecc);
      if (n < shortBlocks) chunk.push(0);
      blocks.push(chunk.concat(rem));
    }

    var out = [];
    for (var col = 0; col < blocks[0].length; col++) {
      for (var row = 0; row < nb; row++) {
        if (col === shortLen && row < shortBlocks) continue;
        out.push(blocks[row][col]);
      }
    }
    return out;
  }

  function qrAlignPositions(ver) {
    if (ver === 1) return [];
    var count = Math.floor(ver / 7) + 2;
    var size = ver * 4 + 17;
    var step = Math.floor((ver * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
    var out = [6];
    for (var pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  /* Build the symbol. Returns the module grid: rows of booleans, true
     is dark. `forceMask` is only for the test harness. */
  function qrMatrix(text, forceMask) {
    var bytes = [];
    var enc = encodeURI(text);
    for (var i = 0; i < enc.length; i++) {
      var c = enc.charAt(i);
      if (c === '%') { bytes.push(parseInt(enc.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(enc.charCodeAt(i));
    }
    /* Mode nibble plus a count of 8 bits through version 9, 16 after. */
    function needed(v) { return Math.ceil((4 + (v < 10 ? 8 : 16) + bytes.length * 8) / 8); }
    var ver = 1;
    while (ver <= 10 && qrDataBytes(ver) < needed(ver)) ver++;
    if (ver > 10) return null;

    var size = ver * 4 + 17;
    var grid = [];
    var fixed = [];
    var y, x;
    for (y = 0; y < size; y++) {
      grid.push([]); fixed.push([]);
      for (x = 0; x < size; x++) { grid[y].push(false); fixed[y].push(false); }
    }
    function set(xx, yy, dark) {
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) return;
      grid[yy][xx] = dark;
      fixed[yy][xx] = true;
    }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var d = Math.max(Math.abs(dx), Math.abs(dy));
          set(cx + dx, cy + dy, d !== 2 && d !== 4);
        }
      }
    }
    function align(cx, cy) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    for (i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    var pos = qrAlignPositions(ver);
    for (i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var corner = (i === 0 && j === 0) || (i === 0 && j === pos.length - 1) ||
          (i === pos.length - 1 && j === 0);
        if (!corner) align(pos[i], pos[j]);
      }
    }

    function formatBits(mask) {
      var d = (0 << 3) | mask; /* level M is 00 */
      var rem = d;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((d << 10) | rem) ^ 0x5412;
      for (k = 0; k <= 5; k++) set(8, k, ((bits >>> k) & 1) === 1);
      set(8, 7, ((bits >>> 6) & 1) === 1);
      set(8, 8, ((bits >>> 7) & 1) === 1);
      set(7, 8, ((bits >>> 8) & 1) === 1);
      for (k = 9; k < 15; k++) set(14 - k, 8, ((bits >>> k) & 1) === 1);
      for (k = 0; k < 8; k++) set(size - 1 - k, 8, ((bits >>> k) & 1) === 1);
      for (k = 8; k < 15; k++) set(8, size - 15 + k, ((bits >>> k) & 1) === 1);
      set(8, size - 8, true);
    }
    function versionBits() {
      if (ver < 7) return;
      var rem = ver;
      for (var k = 0; k < 12; k++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var bits = (ver << 12) | rem;
      for (k = 0; k < 18; k++) {
        var bit = ((bits >>> k) & 1) === 1;
        var a = size - 11 + (k % 3);
        var b = Math.floor(k / 3);
        set(a, b, bit);
        set(b, a, bit);
      }
    }
    formatBits(0);
    versionBits();

    /* Data, zigzagged up and down in two-module columns. */
    var words = qrCodewords(bytes, ver);
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var k = 0; k < 2; k++) {
          var xx = right - k;
          var up = ((right + 1) & 2) === 0;
          var yy = up ? size - 1 - vert : vert;
          if (!fixed[yy][xx] && bi < words.length * 8) {
            grid[yy][xx] = ((words[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1;
            bi++;
          }
        }
      }
    }

    function maskBit(m, xx, yy) {
      switch (m) {
        case 0: return (xx + yy) % 2 === 0;
        case 1: return yy % 2 === 0;
        case 2: return xx % 3 === 0;
        case 3: return (xx + yy) % 3 === 0;
        case 4: return (Math.floor(xx / 3) + Math.floor(yy / 2)) % 2 === 0;
        case 5: return (xx * yy) % 2 + (xx * yy) % 3 === 0;
        case 6: return ((xx * yy) % 2 + (xx * yy) % 3) % 2 === 0;
        default: return ((xx + yy) % 2 + (xx * yy) % 3) % 2 === 0;
      }
    }
    function applyMask(m) {
      for (var yy = 0; yy < size; yy++) {
        for (var xx = 0; xx < size; xx++) {
          if (!fixed[yy][xx] && maskBit(m, xx, yy)) grid[yy][xx] = !grid[yy][xx];
        }
      }
    }

    /* The standard's four penalties. A mask is chosen for the lowest. */
    function finderRuns(hist) {
      var n = hist[1];
      var core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
      return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) +
        (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
    }
    function pushRun(run, hist) {
      if (hist[0] === 0) run += size;
      hist.pop();
      hist.unshift(run);
    }
    function endRuns(color, run, hist) {
      if (color) { pushRun(run, hist); run = 0; }
      pushRun(run + size, hist);
      return finderRuns(hist);
    }
    function penalty() {
      var score = 0;
      var yy, xx, color, run, hist;
      for (yy = 0; yy < size; yy++) {
        color = false; run = 0; hist = [0, 0, 0, 0, 0, 0, 0];
        for (xx = 0; xx < size; xx++) {
          if (grid[yy][xx] === color) {
            run++;
            if (run === 5) score += 3; else if (run > 5) score++;
          } else {
            pushRun(run, hist);
            if (!color) score += finderRuns(hist) * 40;
            color = grid[yy][xx]; run = 1;
          }
        }
        score += endRuns(color, run, hist) * 40;
      }
      for (xx = 0; xx < size; xx++) {
        color = false; run = 0; hist = [0, 0, 0, 0, 0, 0, 0];
        for (yy = 0; yy < size; yy++) {
          if (grid[yy][xx] === color) {
            run++;
            if (run === 5) score += 3; else if (run > 5) score++;
          } else {
            pushRun(run, hist);
            if (!color) score += finderRuns(hist) * 40;
            color = grid[yy][xx]; run = 1;
          }
        }
        score += endRuns(color, run, hist) * 40;
      }
      var dark = 0;
      for (yy = 0; yy < size - 1; yy++) {
        for (xx = 0; xx < size - 1; xx++) {
          var c = grid[yy][xx];
          if (c === grid[yy][xx + 1] && c === grid[yy + 1][xx] && c === grid[yy + 1][xx + 1]) score += 3;
        }
      }
      for (yy = 0; yy < size; yy++) for (xx = 0; xx < size; xx++) if (grid[yy][xx]) dark++;
      var total = size * size;
      score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return score;
    }

    var best = 0;
    if (typeof forceMask === 'number') {
      best = forceMask;
    } else {
      var low = Infinity;
      for (var m = 0; m < 8; m++) {
        applyMask(m); formatBits(m);
        var p = penalty();
        if (p < low) { low = p; best = m; }
        applyMask(m);
      }
    }
    applyMask(best);
    formatBits(best);
    return grid;
  }

  /* The grid as an SVG, one path, a two-module quiet zone, drawn in
     currentColor so the pane decides the ink. */
  function qrSvg(text, label) {
    var grid = qrMatrix(text);
    if (!grid) return '';
    var size = grid.length;
    var pad = 2;
    var d = '';
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (!grid[y][x]) continue;
        var w = 1;
        while (x + w < size && grid[y][x + w]) w++;
        d += 'M' + (x + pad) + ' ' + (y + pad) + 'h' + w + 'v1h-' + w + 'z';
        x += w - 1;
      }
    }
    var box = size + pad * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + box + ' ' + box + '"' +
      ' shape-rendering="crispEdges" role="img" aria-label="' +
        esc(label || 'QR code for this menu') + '">' +
      '<path fill="currentColor" d="' + d + '"/></svg>';
  }

  /* ── sharing ───────────────────────────────────────────── */

  /* A shelf is one integer. Bit N set means the ingredient whose `bit`
     is N is stocked, and bar.json owns those bits and never moves one,
     so a link sent today decodes the same after the bar grows: a new
     bottle takes a new bit, and an old code simply has it unset. Only
     the type is carried, never the brand. A guest needs to know there
     is gin, not which gin.

     Decimal, because a number is the thing a person can read back over
     the phone. BigInt, not Number: a double is exact to 53 bits, and the
     fifty-fourth bottle would otherwise round the whole shelf. */
  function shelfCode(held) {
    if (typeof BigInt !== 'function') return '';
    var n = BigInt(0);
    data.bar.ingredients.forEach(function (i) {
      if (held[i.id] && typeof i.bit === 'number') n = n | (BigInt(1) << BigInt(i.bit));
    });
    return n.toString();
  }

  function shelfFromCode(code) {
    if (typeof BigInt !== 'function' || !/^\d{1,400}$/.test(code || '')) return null;
    var n = BigInt(code);
    var out = {};
    var any = false;
    data.bar.ingredients.forEach(function (i) {
      if (typeof i.bit !== 'number') return;
      if ((n >> BigInt(i.bit)) & BigInt(1)) { out[i.id] = true; any = true; }
    });
    return any ? out : null;
  }

  function shareUrl(code) {
    return location.origin + location.pathname + '?' + SHARE_PARAM + '=' + code;
  }

  function shareTitle() {
    return cardTitle() === 'Your menu' ? 'Tonight\u2019s menu' : cardTitle();
  }

  /* Read ?s= on the way in. A good code opens the menu as the sender
     sees it, shelf filter on; a bad one is dropped from the address and
     otherwise ignored. */
  function openSharedLink() {
    var code = new URLSearchParams(location.search).get(SHARE_PARAM);
    if (code === null) return;
    var h = shelfFromCode(code);
    if (!h) { dropSharedLink(); return; }
    shared = { have: h, code: BigInt(code).toString() };
    filter = emptyFilter();
    filter.shared = true;
    track('share_open', { bottles: stocked(h).length, drinks: pourableCount(h) });
  }

  function dropSharedLink() {
    try { history.replaceState(null, '', location.pathname + location.hash); }
    catch (e) { /* file:// */ }
  }

  /* Say what just happened, then go back to saying what the button does.
     The label to revert to is passed in rather than read off the button:
     a second tap while it still reads "Copied" would otherwise stick. */
  function flashLabel(el, said, back) {
    el.textContent = said;
    setTimeout(function () { el.textContent = back; }, 1600);
  }

  /* One drink, addressable: fewbottles.com/#drink/<id>. A hash never
     reaches the server and the worker matches navigations ignoring the
     query, so a drink link opens offline from the cached shell like any
     other address here. */
  function drinkUrl(id) {
    return location.origin + location.pathname + '#drink/' + id;
  }

  /* Fallback for a clipboard that says no: leave the link selected. */
  function selectShareUrl(from) {
    var box = from.closest('.share');
    var el = box && box.querySelector('.share__url');
    if (!el || !window.getSelection) return;
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ── menu view ─────────────────────────────────────────── */

  function ingredientLine(d) {
    return d.build.map(function (p) {
      var i = ing[p[0]];
      return i ? i.short : p[0];
    }).join(', ');
  }

  /* The shelf chip is named for the shelf it gates on, so on a named
     shelf nothing on the row says your own bottles are still there. One
     more chip on its left, carrying what those bottles pour, and the way
     back is a tap from the list rather than a trip to the Bar tab. It
     carries no tick because it is the way out, not the gate that is on.

     A shared menu already has its own second chip and leaves the first
     one reading My Shelf, so this is only for a named shelf. */
  function mineChip() {
    if (shelfView === 'mine') return '';
    var n = stocked().length ? pourableCount(have) : null;
    return '<button class="chip chip--pour" data-shelf-mine="1">My Shelf' +
      (n === null ? '' : ' \u00b7 ' + n) + '</button>';
  }

  /* Which bottles get a chip in the filter row. Anything else can still be
     a family filter, but nothing on screen would show it was on, and a
     filter you cannot see is a filter you cannot turn off. */
  function hasChip(i) {
    return i.kind === 'base' || i.kind === 'vermouth' || i.kind === 'modifier';
  }

  /* Two segments of the control are not methods: All and Families. Those
     two get named here, and every method passes. That is why the card
     could go from two methods to three without this line moving. */
  function methodFilterOn() {
    return filter.method !== 'all' && filter.method !== 'families';
  }

  function matches(d, held) {
    if (methodFilterOn() && d.method !== filter.method) return false;
    if (filter.family && needs(d).indexOf(filter.family) < 0) return false;
    if (filter.pattern && patternIdOf(d) !== filter.pattern) return false;
    if (shelfGate() && !canPour(d, held)) return false;
    if (filter.q) {
      var hay = (d.name + ' ' + ingredientLine(d) + ' ' + d.code).toLowerCase();
      if (hay.indexOf(filter.q) < 0) return false;
    }
    return true;
  }

  function kinRow(d) {
    return (data.kin && data.kin.drinks[d.id]) || { pattern: null, kin: [] };
  }

  function patternIdOf(d) { return kinRow(d).pattern; }

  function patternOf(d) {
    var id = patternIdOf(d);
    return id ? patternBy[id] : null;
  }

  function paneOf(d) {
    var pane = recipePane[d.id] || 'recipe';
    if (pane === 'taste' && !d.taste) return 'recipe';
    if (pane === 'history' && !d.history) return 'recipe';
    if (pane === 'kin' && !data.kin) return 'recipe';
    return pane;
  }

  function applyRecipePane(recipe, pane) {
    recipe.querySelectorAll('.recipe-tab').forEach(function (tab) {
      var on = tab.getAttribute('data-recipe-tab') === pane;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    recipe.querySelectorAll('.recipe-panel').forEach(function (panel) {
      var on = panel.getAttribute('data-pane') === pane;
      panel.classList.toggle('is-on', on);
      panel.hidden = !on;
    });
  }

  function setRecipePane(id, pane, recipe) {
    recipePane[id] = pane;
    applyRecipePane(recipe, pane);
    track('recipe_pane', { drink_id: id, drink_name: drinkName(id), pane: pane });
  }

  /* First pass of garnish art. Combinations we do not have a drawing
     for yet fall back to the empty glass of that type. */
  function garnishArt(rest) {
    if (!rest) return '';
    if (rest === 'Lw') return 'wheel';
    if (rest === 'c' || rest === 'O' || (rest.charAt(0) === 'c' && rest.indexOf('cin') !== 0)) {
      return 'pick';
    }
    if (rest === 'l' || rest === 'L' || rest === 'o' || rest === 'fo') return 'twist';
    return '';
  }

  function pickGlassArt(serve) {
    var g = serve[0];
    var rest = serve.slice(1);
    var extra = garnishArt(rest);
    if (g === 'c') return extra ? 'nick-nora-' + extra : 'nick-nora';
    if (g === 'r') return extra ? 'rocks-' + extra : 'rocks';
    if (g === 'R') return extra ? 'rocks-cube-' + extra : 'rocks-cube';
    if (g === 'h') return extra ? 'highball-' + extra : 'highball';
    if (g === 'H') return extra ? 'highball-ice-' + extra : 'highball-ice';
    return null;
  }

  /* Cropped to the tumbler and centred on it (x = 100). A rocks glass is
     shorter than a Nick & Nora and a highball is taller, so each one crops
     to the box its drawing fills and the CSS scales that box down to
     match. Stretch them all to one row height and they stop looking like
     glasses. Garnishes that stick out still draw, because overflow is
     visible. */
  var GLASS_CROP = {
    rocks: { box: '45 118 110 146', cls: ' drink__glass--rocks' },
    highball: { box: '45 64 110 200', cls: ' drink__glass--tall' }
  };

  function renderGlass(serve) {
    var id = pickGlassArt(serve);
    var svg = id && glassMarkup[id];
    if (!svg) return '';
    var crop = GLASS_CROP[id.split('-')[0]];
    var cls = 'drink__glass';
    if (crop) {
      svg = svg.replace('viewBox="0 0 200 270"', 'viewBox="' + crop.box + '"');
      cls += crop.cls;
    }
    return '<span class="' + cls + '" aria-hidden="true">' + svg + '</span>';
  }

  /* The instruction you follow at the bar. The blurb in cocktails.json is
     the heading over that section of the menu and reads like one, so the
     sentence for a single drink lives here with the decoder. A method
     with no line here falls back to its blurb, so a fourth one still
     says something. */
  var METHOD_HOW = {
    stirred: 'Stir with ice until cold, then strain.',
    shaken: 'Shake hard with ice, then strain.',
    built: 'Build in the glass over ice, then lift once with a barspoon.'
  };

  /* Most built drinks are packed with ice, but the Champagne Cocktail,
     the Seelbach and Death in the Afternoon are poured into a dry glass,
     and telling somebody to build those over ice is a wrong instruction,
     not a rounding error. The uppercase glass letter is the one carrying
     ice, so the line reads off the serve token the same way the drawing
     does, rather than off a list of ids that would go stale. */
  var BUILT_DRY = 'Build in the glass with no ice, then top.';

  function icedGlass(serve) {
    return serve[0] === 'R' || serve[0] === 'H';
  }

  function methodLine(id, serve) {
    if (id === 'built' && !icedGlass(serve)) return BUILT_DRY;
    var m = methodBy[id];
    return METHOD_HOW[id] || (m ? m.blurb : id);
  }

  function renderPours(d, held) {
    var shelfInUse = stocked().length > 0;
    var html = '';

    d.build.forEach(function (p) {
      var i = ing[p[0]] || { name: p[0] };
      var a = readAmount(p[1], i);
      var isGarnish = p[2] === 'g';
      var absent = shelfInUse && !held[p[0]];
      /* The card calls for demerara, so the row still says demerara. What
         is on the shelf goes beside it, not over it. */
      var use = absent ? standInHeld(p[0], held) : null;

      html += '<div class="pour">' +
        '<div class="pour__amt' + (p[1] === null ? ' pour__amt--none' : '') + '">' + esc(a.text) + '</div>' +
        '<div class="pour__ing' + (absent && !use ? ' is-out' : '') + '">' + esc(i.name) +
        (use ? '<span class="pour__sub">' + esc(shortName(use)) + ' stands in</span>' : '') +
        (isGarnish ? '<span class="pour__tag">on top</span>' : '') +
        (a.note ? '<span class="pour__tag">' + esc(a.note) + '</span>' : '') +
        '</div></div>';
    });

    var s = readServe(d.serve);
    html += '<div class="serve">' +
      '<div class="serve__row"><span class="serve__k">Method</span><span>' +
        esc(methodLine(d.method, d.serve)) +
      '</span></div>' +
      '<div class="serve__row"><span class="serve__k">Glass</span><span>' +
        esc(s.glass) + (s.gloss ? ' (' + esc(s.gloss) + ')' : '') +
      '</span></div>' +
      (s.garnish.length
        ? '<div class="serve__row"><span class="serve__k">Garnish</span><span>' +
            s.garnish.map(function (g) {
              var gone = shelfInUse && g.ingredient && !held[g.ingredient];
              return '<span class="serve__g' + (gone ? ' is-out' : '') + '">' +
                esc(g.label) + '</span>';
            }).join(', ') +
          '</span></div>'
        : '') +
      '</div>';

    return html;
  }

  function renderRecipeTabs(d, current) {
    var panes = [{ id: 'recipe', label: 'Recipe' }];
    if (d.taste) panes.push({ id: 'taste', label: 'Taste' });
    if (d.history) panes.push({ id: 'history', label: 'History' });
    if (data.kin) panes.push({ id: 'kin', label: 'Related' });
    panes.push({ id: 'share', label: 'Share' });

    var html = '<div class="recipe-tabs" role="tablist" aria-label="' +
      esc(d.name) + '">';
    panes.forEach(function (p) {
      var on = p.id === current;
      html += '<button type="button" class="recipe-tab' + (on ? ' is-on' : '') + '"' +
        ' role="tab"' +
        ' id="rtab-' + esc(d.id) + '-' + p.id + '"' +
        ' aria-selected="' + (on ? 'true' : 'false') + '"' +
        ' aria-controls="rpanel-' + esc(d.id) + '-' + p.id + '"' +
        ' tabindex="' + (on ? '0' : '-1') + '"' +
        ' data-recipe-tab="' + p.id + '"' +
        ' data-recipe-for="' + esc(d.id) + '">' + p.label + '</button>';
    });
    return html + '</div>';
  }

  function renderRefs(refs) {
    if (!refs || !refs.length) return '';
    var html = '<ul class="recipe-refs">';
    refs.forEach(function (r) {
      if (!r || !r.title || !r.url) return;
      html += '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(r.title) + '</a></li>';
    });
    return html + '</ul>';
  }

  function renderPanel(d, pane, current, inner) {
    var on = pane === current;
    return '<div class="recipe-panel recipe-panel--' + pane + (on ? ' is-on' : '') + '"' +
      ' role="tabpanel"' +
      ' id="rpanel-' + esc(d.id) + '-' + pane + '"' +
      ' aria-labelledby="rtab-' + esc(d.id) + '-' + pane + '"' +
      ' data-pane="' + pane + '"' +
      (on ? '' : ' hidden') + '>' + inner + '</div>';
  }

  function renderKin(d) {
    var row = kinRow(d);
    var pat = patternOf(d);
    var html = '<div class="kin">';
    if (pat) {
      html += '<div class="kin__k">' + esc(pat.label) + '</div>' +
        '<p class="kin__blurb">' + esc(pat.blurb) + '</p>';
    }
    if (row.kin && row.kin.length) {
      html += '<div class="kin-list">';
      row.kin.forEach(function (k) {
        var other = cocktailBy[k.id];
        if (!other) return;
        html += '<button type="button" class="kin-item" data-kin="' + esc(k.id) + '">' +
          '<span class="kin-item__name">' + esc(other.name) + '</span>' +
          '<span class="kin-item__why">' + esc(k.why) + '</span>' +
          '</button>';
      });
      html += '</div>';
    }
    if (pat && pat.members && pat.members.length > 1) {
      html += '<button type="button" class="kin-more" data-see-pattern="' + esc(pat.id) + '">' +
        plural(pat.members.length, 'drink', 'drinks') + ' of this shape' +
        ' <span aria-hidden="true">&rarr;</span></button>';
    }
    return html + '</div>';
  }

  /* One drink, to give away. The same card as the shelf's Share menu,
     because it is the same act in a smaller frame: the QR is for someone
     standing in front of you holding their own phone, the link is for a
     thread. Both open this drink, expanded, wherever they land. */
  function renderDrinkShare(d) {
    var url = drinkUrl(d.id);
    var qr = qrSvg(url, 'QR code for the ' + d.name);
    return '<p class="recipe-copy">Scan it, or send the link. Either one ' +
        'opens this drink on their phone. No app, nothing to install.</p>' +
      '<div class="share">' +
        (qr ? '<div class="share__qr">' + qr + '</div>' : '') +
        '<div class="share__side">' +
          '<p class="share__url">' + esc(url.replace(/^https?:\/\//, '')) + '</p>' +
          '<div class="tonight__acts">' +
            '<button type="button" class="btn" data-drink-link="' +
              esc(d.id) + '">Copy link</button>' +
            '<a class="btn" href="sms:?&body=' +
              encodeURIComponent(d.name + ' ' + url) + '"' +
              ' data-drink-sms="' + esc(d.id) + '">Send by text</a>' +
            (navigator.share
              ? '<button type="button" class="btn" data-drink-share="' +
                  esc(d.id) + '">Share\u2026</button>'
              : '') +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderRecipe(d, held) {
    var current = paneOf(d);
    var html = '<div class="recipe">' + renderRecipeTabs(d, current);
    html += renderPanel(d, 'recipe', current, renderPours(d, held));
    if (d.taste) {
      html += renderPanel(d, 'taste', current,
        '<p class="recipe-copy">' + esc(d.taste) + '</p>');
    }
    if (d.history) {
      html += renderPanel(d, 'history', current,
        '<p class="recipe-copy">' + esc(d.history) + '</p>' + renderRefs(d.refs));
    }
    if (data.kin) html += renderPanel(d, 'kin', current, renderKin(d));
    html += renderPanel(d, 'share', current, renderDrinkShare(d));
    return html + '</div>';
  }

  /* Name, code, ingredient line, and whatever the shelf has to say about
     them. A row is one of these behind a button and the wide-screen aside
     is the same block above the recipe, so a drink is described once. */
  function renderDrinkText(d, held, showShelf) {
    var missing = missingFor(d, held);
    var html = '<span class="drink__text">' +
      '<span class="drink__name">' + esc(d.name) + '</span>' +
      '<span class="drink__code">' + esc(d.code) + '</span>' +
      '<span class="drink__line">' + esc(ingredientLine(d)) + '</span>';

    if (showShelf && missing.length) {
      html += '<span class="drink__missing">Need ' + esc(missing.map(function (m) {
        return (ing[m] || {}).short || m;
      }).join(', ')) + '</span>';
    }

    /* Pourable, but not on the bottle the card names. Say which, quietly:
       this is a note about the shelf, not an earned state, so no brass. */
    if (showShelf && !missing.length) {
      var subs = standInFor(d, held);
      if (subs.length) {
        html += '<span class="drink__standin">' + esc(subs.map(function (s) {
          return shortName(s.use) + ' for ' + shortName(s.want);
        }).join(', ')) + '</span>';
      }
    }
    return html + '</span>';
  }

  function renderDrink(d, held, showShelf) {
    var missing = missingFor(d, held);
    var cls = 'drink';
    if (showShelf) cls += missing.length ? ' is-short' : ' is-pourable';
    if (open[d.id]) cls += ' is-open';

    var html = '<div class="' + cls + '" id="drink-' + esc(d.id) + '">' +
      '<button class="drink__head" data-drink="' + esc(d.id) + '" ' +
        'aria-expanded="' + (open[d.id] ? 'true' : 'false') + '">' +
        renderGlass(d.serve) + renderDrinkText(d, held, showShelf) +
      '</button>';

    /* On a wide screen the recipe reads in the aside beside the list, so
       the row stays a row. Paper is not a viewport, so the print blocks go
       in either way, which is what actually prints. */
    if (open[d.id] && !asideLive()) html += renderRecipe(d, held);
    html += renderPrintExtras(d, held);
    return html + '</div>';
  }

  /* Paper-only blocks, always in the DOM so a tick can show them
     without rewriting the list. Hidden on screen; body classes
     decide which ones print. */
  function renderPrintExtras(d, held) {
    var html = '<div class="print-extras">';
    html += '<div class="print-card print-card--recipe">' + renderPours(d, held) + '</div>';
    if (d.taste) {
      html += '<div class="print-card print-card--taste">' +
        '<div class="print-card__k">Taste</div>' +
        '<p class="recipe-copy">' + esc(d.taste) + '</p></div>';
    }
    if (d.history) {
      html += '<div class="print-card print-card--history">' +
        '<div class="print-card__k">History</div>' +
        '<p class="recipe-copy">' + esc(d.history) + '</p></div>';
    }
    return html + '</div>';
  }

  /* An empty list has more than one cause, and saying the wrong one sends
     people to the Bar tab to fix a shelf that was never the problem. Work
     out which filter is actually doing the excluding and say so. */
  function renderEmpty(held) {
    var canNow = pourableCount(held);

    if (shelfGate() && canNow > 0) {
      /* Each clause is a full predicate, so they read as a sentence
         however many of them there happen to be. */
      var blocking = [];
      if (filter.family) {
        blocking.push('use ' + ((ing[filter.family] || {}).short || filter.family));
      }
      if (methodFilterOn()) blocking.push('are ' + filter.method);
      if (filter.pattern) {
        var pat = patternBy[filter.pattern];
        blocking.push('are the ' + (pat ? pat.label : filter.pattern) + ' shape');
      }
      if (filter.q) blocking.push('match “' + filter.q + '”');

      return '<div class="empty empty--clash">' +
        '<p>You can pour <b>' + canNow + '</b> ' +
          (canNow === 1 ? 'drink' : 'drinks') + ' with what is on the shelf, but ' +
          (blocking.length
            ? 'none of them ' + esc(blocking.join(', nor ')) + '.'
            : 'none of them match the other filters.') +
        '</p>' +
        '<button class="btn" data-clearothers="1">Drop the other filters</button>' +
        '</div>';
    }

    if (viewingShared()) {
      return '<p class="empty">This shelf pours nothing on the menu yet.</p>';
    }

    if (filter.pourable) {
      return '<p class="empty">Nothing yet. Select a few more bottles on the ' +
             '<a href="#bar">Bar tab</a> and the menu fills in.</p>';
    }

    return '<p class="empty">Nothing on the menu matches that.</p>';
  }

  /* With the shelf filter on, this stops being a filtered list and starts
     being a menu. Print menu is a reveal on that list: closed it is a
     row, open it is the card title, the include ticks, and the way onto
     paper. */
  function printOptBtn(id, label) {
    var on = !!printOpts[id];
    return '<button type="button" class="tonight__opt' + (on ? ' is-on' : '') + '"' +
      ' data-print-opt="' + id + '"' +
      ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="bottle__box"></span>' + esc(label) +
      '</button>';
  }

  /* Share menu is the reveal above Print. The QR and the link are the
     same thing, the shelf as one number on the end of the address, so
     whoever scans or taps opens this list live, on their own phone. */
  function renderSharePane(held) {
    var code = shelfCode(held);
    if (!code || code === '0') return '';
    var url = shareUrl(code);
    var qr = qrSvg(url);
    var body = shareTitle() + ' ' + url;
    return '<div class="tonight__pane" id="share-pane"' + (shareOpen ? '' : ' hidden') + '>' +
      '<p class="tonight__note">Scan it, or send the link. It carries the shelf ' +
        'but not the brands, so they get this same list on their own phone.</p>' +
      '<div class="share">' +
        (qr ? '<div class="share__qr">' + qr + '</div>' : '') +
        '<div class="share__side">' +
          '<p class="share__url">' + esc(url.replace(/^https?:\/\//, '')) + '</p>' +
          '<div class="tonight__acts">' +
            '<button class="btn" data-share-copy="1">Copy link</button>' +
            '<a class="btn" href="sms:?&body=' + encodeURIComponent(body) + '"' +
              ' data-share-sms="1">Send by text</a>' +
            (navigator.share ? '<button class="btn" data-share-native="1">Share\u2026</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '</div>';
  }

  /* One row of the masthead. Share and Print expand a pane under them and
     carry the chevron that says so; Tonight has nothing to expand, so it
     takes neither. A button claiming to control a pane that is not there
     is a lie a screen reader reads out loud. */
  function hitRow(cls, attrs, label, hint, more) {
    return '<button type="button" class="tonight__hit' + cls + '"' + attrs + '>' +
      '<span class="tonight__k">' + esc(label) + '</span>' +
      '<span class="tonight__count">' + esc(hint) + '</span>' +
      (more ? '<span class="bottle__more" aria-hidden="true"></span>' : '') +
      '</button>';
  }

  function revealHit(kind, label, hint, on) {
    return hitRow(on ? ' is-open' : '',
      ' data-' + kind + '-open="1"' +
      ' aria-expanded="' + (on ? 'true' : 'false') + '"' +
      ' aria-controls="' + kind + '-pane"', label, hint, true);
  }

  /* On paper a nameless card is "Your menu". A phone propped against the
     bottles is saying what tonight is, so it says Tonight. */
  function nightTitle() {
    return (menuTitle || '').replace(/\s+/g, ' ').trim() || 'Tonight';
  }

  function renderMasthead(n, held) {
    var bottles = stocked(held).length;
    var shown = printOpen;
    var drinks = n + ' ' + (n === 1 ? 'drink' : 'drinks');
    return '<div class="tonight">' +
      '<div class="tonight__print">' +
        '<h1 class="tonight__print-title">' +
          esc(tonight ? nightTitle() : cardTitle()) + '</h1>' +
        '<p class="tonight__print-of">' + drinks + '</p>' +
      '</div>' +
      hitRow('', ' data-tonight="open"', 'Big type', 'for a phone by the bottles', false) +
      revealHit('share', 'Share menu', 'QR code or link', shareOpen) +
      renderSharePane(held) +
      revealHit('print', 'Print menu', drinks, shown) +
      '<div class="tonight__pane" id="print-pane"' + (shown ? '' : ' hidden') + '>' +
        '<label class="tonight__field" for="menu-title">Menu title</label>' +
        '<input class="tonight__title" id="menu-title" type="text" maxlength="72" ' +
          'placeholder="Home St. Bar" autocomplete="off" ' +
          'spellcheck="true" enterkeyhint="done" value="' + esc(menuTitle) + '">' +
        '<p class="tonight__note">Every drink the ' + plural(bottles, 'bottle', 'bottles') +
          ' on ' + (viewingShared() ? 'this' : 'your') + ' shelf will pour, written out in ' +
          'full. Garnish where ' + (viewingShared() ? 'they have' : 'you have') + ' it.</p>' +
        '<div class="tonight__opts">' +
          printOptBtn('icon', 'Icon') +
          printOptBtn('recipe', 'Recipe') +
          printOptBtn('taste', 'Taste') +
          printOptBtn('history', 'History') +
          printOptBtn('barline', 'Shorthand key') +
        '</div>' +
        '<div class="tonight__acts">' +
          '<button class="btn" data-print="1">Print or save as PDF</button>' +
          '<button class="btn" data-pourable="1">Show all ' + data.menu.cocktails.length + '</button>' +
        '</div>' +
      '</div></div>';
  }

  /* What a guest sees over a shared list. Their own shelf, if they have
     one, is not touched until they say so; the My Shelf chip is the way
     back to it. */
  function renderSharedBanner(held) {
    var b = stocked(held).length;
    var n = pourableCount(held);
    var mine = stocked().length > 0;
    return '<div class="shared">' +
      '<p class="shared__k">Shared menu</p>' +
      '<p class="shared__copy">Someone sent you their bar: ' +
        plural(b, 'bottle', 'bottles') + ', ' + plural(n, 'drink', 'drinks') + '.' +
        (mine ? ' Your own shelf is untouched.' : '') + '</p>' +
      '<div class="tonight__acts">' +
        '<button class="btn" data-share-adopt="1">Make this my shelf</button>' +
      '</div></div>';
  }

  /* The list as sections of rows, so it can be joined straight or cut
     in two. A row's weight is a rough height in printed drink lines:
     enough to find the middle without measuring paper. */
  var HEAD_WEIGHT = { method: 2.6, family: 1.3 };

  function drinkWeight() {
    var w = 1;
    if (printOpts.recipe) w += 2.6;
    if (printOpts.taste) w += 1.2;
    if (printOpts.history) w += 1.6;
    return w;
  }

  function sectionHead(label, blurb) {
    return '<h2 class="method__title">' + esc(label) + '</h2>' +
      '<div class="method__rule"></div>' +
      '<p class="method__blurb">' + esc(blurb) + '</p>';
  }

  function menuSections(list, held, showShelf) {
    var secs = [];
    var w = drinkWeight();

    if (filter.method === 'families' && data.kin) {
      data.kin.patterns.forEach(function (p) {
        var inPat = p.members.map(function (id) { return cocktailBy[id]; })
          .filter(function (d) { return d && list.indexOf(d) >= 0; });
        if (!inPat.length) return;
        var sec = { attrs: ' id="pattern-' + esc(p.id) + '"', head: sectionHead(p.label, p.blurb), rows: [] };
        inPat.forEach(function (d) {
          sec.rows.push({ html: renderDrink(d, held, showShelf), w: w, head: false });
        });
        secs.push(sec);
      });
      return secs;
    }

    data.menu.methods.forEach(function (m) {
      var inMethod = list.filter(function (d) { return d.method === m.id; });
      if (!inMethod.length) return;
      var sec = { attrs: '', head: sectionHead(m.label, m.blurb), rows: [] };
      data.menu.families.forEach(function (f) {
        var inFamily = inMethod.filter(function (d) { return d.family === f.id; });
        if (!inFamily.length) return;
        sec.rows.push({ html: '<h3 class="family">' + esc(f.label) + '</h3>', w: HEAD_WEIGHT.family, head: true });
        inFamily.forEach(function (d) {
          sec.rows.push({ html: renderDrink(d, held, showShelf), w: w, head: false });
        });
      });
      secs.push(sec);
    });
    return secs;
  }

  function joinSections(secs) {
    return secs.map(function (s) {
      return '<section class="method"' + s.attrs + '>' + s.head +
        s.rows.map(function (r) { return r.html; }).join('') + '</section>';
    }).join('');
  }

  /* Two floated columns, cut where the weights balance. The cut never
     lands right after a heading, and a section that straddles it goes on
     in the second column without repeating its title. On screen the two
     halves simply stack, and the CSS hides the seam. */
  function splitSections(secs) {
    var rows = [];
    secs.forEach(function (s, i) {
      rows.push({ sec: i, open: true, html: '', w: HEAD_WEIGHT.method, head: true });
      s.rows.forEach(function (r) { rows.push({ sec: i, open: false, html: r.html, w: r.w, head: r.head }); });
    });

    var total = 0;
    rows.forEach(function (r) { total += r.w; });
    var cut = rows.length;
    var bestDiff = Infinity;
    var run = 0;
    for (var i = 0; i < rows.length; i++) {
      run += rows[i].w;
      if (rows[i].head) continue;
      var diff = Math.abs(run - total / 2);
      if (diff < bestDiff) { bestDiff = diff; cut = i + 1; }
    }

    function part(from, to) {
      var html = '';
      var openSec = -1;
      for (var k = from; k < to; k++) {
        var r = rows[k];
        if (r.sec !== openSec) {
          if (openSec >= 0) html += '</section>';
          html += r.open
            ? '<section class="method"' + secs[r.sec].attrs + '>' + secs[r.sec].head
            : '<section class="method method--cont">';
          openSec = r.sec;
        }
        html += r.html;
      }
      if (openSec >= 0) html += '</section>';
      return html;
    }

    return '<div class="pcols">' +
      '<div class="pcol">' + part(0, cut) + '</div>' +
      '<div class="pcol">' + part(cut, rows.length) + '</div>' +
      '</div>';
  }

  /* `allGains` re-counts the whole menu once per bottle. That is fine on
     the Bar tab, where it runs on a selection, and not fine on the Menu,
     where the list repaints on every keystroke in the search box. The
     shelf is the only input, so its code is the whole cache key. */
  var gainsMemo = { key: null, val: null };

  function gainsFor(held) {
    var key = shelfCode(held);
    if (gainsMemo.key !== key) gainsMemo = { key: key, val: allGains(held) };
    return gainsMemo.val;
  }

  /* Two bottles worth nothing apart can be worth a drink together, and a
     shelf reaches that state early: gin and tonic pour the Gin and Tonic,
     and from there not one bottle on the shelf opens anything on its own.
     The list used to go quiet there, which is a dead end on the one panel
     whose job is to say what to buy. So when single bottles run out, the
     smallest sets that do open something take the empty rows.

     The candidates are the drinks. A set worth naming is exactly what
     some drink is short of, because any other set is one of those with a
     bottle nobody needed added on top. So take each short drink's missing
     bottles as a candidate set, and count the drinks that set pours.
     Fewest bottles first, then the biggest unlock: the cheapest way out
     of the dead end leads. */
  function comboRows(held, want) {
    if (want < 1) return [];
    var short = shortOf(held);
    var seen = {};
    var out = [];
    short.forEach(function (miss) {
      var key = miss.join(',');
      if (miss.length < 2 || seen[key]) return;
      seen[key] = true;
      out.push({ ids: miss, gain: 0, uses: 0, n: out.length });
    });
    out.forEach(function (c) {
      c.gain = short.filter(function (m) { return subsetOf(m, c.ids); }).length;
      c.uses = c.ids.reduce(function (n, id) { return n + usageCount(id); }, 0);
    });
    /* Fewest bottles, then the biggest unlock, then the bottles the rest
       of the menu wants most. That last one is doing the real work here:
       a shelf holding one spirit is two bottles away from a hundred
       drinks and nearly all of those pairs open exactly one, so without
       it the row is whichever drink the card happens to print first.
       Lime and simple syrup beat Benedictine and bourbon because the
       next drink after them wants lime and simple syrup too. */
    return out.sort(function (a, b) {
      if (a.ids.length !== b.ids.length) return a.ids.length - b.ids.length;
      if (b.gain !== a.gain) return b.gain - a.gain;
      if (b.uses !== a.uses) return b.uses - a.uses;
      return a.n - b.n;
    }).slice(0, want);
  }

  /* The three buys worth making next: biggest unlock first, then the one
     more drinks already want, then the order the shelf is written in.
     Single bottles fill the list, and sets fill what they leave.
     The Bar tab and the Menu's rail both read this, so the two lists
     cannot rank the same shelf differently. */
  function nextBottles(held) {
    var gains = gainsFor(held);
    var top = data.bar.ingredients.filter(function (i) {
      return !held[i.id] && gains[i.id] > 0;
    }).map(function (i, n) {
      return { ids: [i.id], gain: gains[i.id], uses: usageCount(i.id), n: n };
    }).sort(function (a, b) {
      if (b.gain !== a.gain) return b.gain - a.gain;
      if (b.uses !== a.uses) return b.uses - a.uses;
      return a.n - b.n;
    }).slice(0, 3);
    return top.concat(comboRows(held, 3 - top.length));
  }

  /* A row is one bottle or a set of them, and reads the same either way. */
  function rowName(r) {
    return r.ids.map(function (id) {
      return ing[id].shelf || ing[id].name;
    }).join(' + ');
  }

  function rowBuyLines(r) {
    return r.ids.map(function (id) { return nextBuyLine(ing[id]); })
      .filter(function (b) { return !!b; });
  }

  /* One suggestion: the shelf's own checkbox, the name, what it would
     add, and the drinks it would open. Selecting it here counts the
     bottle in without a trip to the Bar tab. The figure above moves, and
     the list behind it re-gates. */
  function renderRailNext(r, held) {
    var name = rowName(r);
    return '<div class="card__next">' +
      '<div class="card__buy">' +
        '<button type="button" class="bottle__stock card__box"' +
          ' data-next-jump="' + esc(r.ids.join(',')) + '" aria-pressed="false"' +
          (editing() ? '' : ' disabled') +
          ' aria-label="' + esc('Select ' + name) + '">' +
          '<span class="bottle__box"></span>' +
        '</button>' +
        '<span class="card__buy-name">' + esc(name) + '</span>' +
        '<span class="card__buy-n">+' + r.gain + '</span>' +
      '</div>' +
      '<p class="card__opens">' + esc(unlockedLine(unlockedBy(r.ids, held))) + '</p>' +
      '</div>';
  }

  /* A first visit has a whole column and nothing to put in it yet, so it
     gets the thing a first visit actually needs: what this is and what to
     do with it. Three steps, in the Key tab's own numbered treatment,
     because that is what this site already looks like when it explains
     itself. The strip above the list on a phone says the short version;
     up here there is room for the whole of it. */
  var STEPS = [
    {
      h: 'The menu',
      t: 'Everything on the left is what this bar pours, most of it from a ' +
         'handful of bottles. Filter the list by bottle, or search for a name, ' +
         'an ingredient, or a code.'
    },
    {
      h: 'Your bottles',
      t: 'Open the Bar tab and select what you own. The figure next to a bottle ' +
         'you have not selected is how many more drinks it would let you pour, ' +
         'not how many recipes mention it.'
    },
    {
      h: 'My Shelf',
      t: 'Narrows the list to the drinks your own bottles make. Print that for ' +
         'the counter, or send your shelf to a guest as a link.'
    }
  ];

  function renderRailIntro() {
    var html = '<div class="card">' +
      '<h2 class="card__h">' + data.menu.cocktails.length +
        ' drinks, from a few bottles.</h2>' +
      '<p class="card__k card__k--top">How this works</p>' +
      '<ol class="rules">';
    STEPS.forEach(function (r) {
      html += '<li class="rule">' +
        '<div class="rule__h">' + esc(r.h) + '</div>' +
        '<p class="rule__t">' + esc(r.t) + '</p>' +
        '</li>';
    });
    return html + '</ol><div class="card__acts">' +
      '<a class="btn" href="#bar">Open the Bar tab</a>' +
      '</div></div>';
  }

  /* Whose bottles the rail is counting. Yours, a sender's, or the named
     shelf you are looking at. */
  function whoseShelf() {
    if (viewingShared()) return 'their shelf';
    return editing() ? 'your shelf' : viewName();
  }

  /* What the shelf pours right now, and the one bottle that would move
     that number most. The figure is the same one the Bar tab prints, in
     the same treatment, and it leads to the list it counts. */
  function renderRailCard(held) {
    var bottles = stocked(held).length;
    if (!bottles) return renderRailIntro();

    var can = pourableCount(held);
    var total = data.menu.cocktails.length;
    var up = lastRail !== null && can > lastRail;
    lastRail = can;
    var figure = '<span class="card__n' + (up ? ' is-up' : '') + '">' + can + '</span>' +
      '<span class="card__of">drinks ' + (viewingShared() ? 'they' : 'you') +
        ' can pour<br>of ' + total + '</span>';

    var html = '<div class="card">' +
      (can && !shelfGate()
        ? '<button type="button" class="card__fig" data-seemenu="1">' + figure + '</button>'
        : '<div class="card__fig">' + figure + '</div>') +
      '<p class="card__note">' + esc(plural(bottles, 'bottle', 'bottles') +
        ' on ' + whoseShelf() + '.') + '</p>';

    var next = viewingShared() ? [] : nextBottles(held);
    if (next.length) {
      html += '<p class="card__k">Next bottle suggestions</p>' +
        (editing() ? '' : '<p class="card__note card__note--lock">' +
          esc('Selecting one changes My Shelf, so go back to it first.') + '</p>');
      next.forEach(function (r) { html += renderRailNext(r, held); });
      html += '<div class="card__acts"><a class="btn" href="#bar">Open the Bar tab</a></div>';
    }
    return html + '</div>';
  }

  /* The open drink, beside the list instead of inside it. Same pieces a
     row is made of, over the same recipe. The placeholder is there so the
     column keeps its width and the list does not reflow every time a
     drink opens and closes. */
  function renderAside(held, showShelf) {
    var el = $('#menu-aside');
    el.hidden = !asideLive();
    if (!asideLive()) { el.innerHTML = ''; return; }

    var id = Object.keys(open).filter(function (k) {
      return cocktailBy[k] && matches(cocktailBy[k], held);
    }).pop();
    /* One aside holds one drink. Anything else left open, from a phone
       width, or from Tonight, where the list has always let you unfold
       several, would put a brass rule on rows it is not answering to. */
    if (id) { open = {}; open[id] = true; }
    if (!id) {
      el.removeAttribute('data-open-drink');
      el.innerHTML = renderRailCard(held);
      return;
    }
    var d = cocktailBy[id];
    el.setAttribute('data-open-drink', d.id);
    /* The way back to the shelf. Tapping the row again closes it too, but
       the row may be a screen away by the time you have read the recipe,
       and a panel you cannot dismiss from inside is a panel that has taken
       the column. It is the drink's own toggle, so it counts as a close
       and puts the row's `aria-expanded` back. */
    el.innerHTML = '<div class="menu-aside__head">' + renderGlass(d.serve) +
      renderDrinkText(d, held, showShelf) +
      '<button type="button" class="menu-aside__close" data-drink="' +
        esc(d.id) + '" aria-label="' + esc('Close the ' + d.name) + '">Close</button>' +
      '</div>' + renderRecipe(d, held);
  }

  /* The only chrome Tonight has. Everything else on screen is the menu. */
  function renderNightBar() {
    return '<div class="night"><button type="button" class="night__done" ' +
      'data-tonight="done">Done</button></div>';
  }

  function renderMenu() {
    var held = heldNow();
    var showShelf = stocked(held).length > 0;
    var list = data.menu.cocktails.filter(function (d) { return matches(d, held); });
    var pre = viewingShared() ? renderSharedBanner(held) : '';
    renderAside(held, showShelf);
    var night = tonight ? renderNightBar() : '';

    if (!list.length) {
      $('#menu-body').innerHTML = pre + renderEmpty(held) + night;
      return;
    }

    var html = pre + (shelfGate() ? renderMasthead(list.length, held) : '');
    var secs = menuSections(list, held, showShelf);
    html += PRINT_SPLIT ? splitSections(secs) : joinSections(secs);

    html += '<div class="print-qr" aria-hidden="true">' +
      '<img src="assets/qr.svg" alt="">' +
      '<span>fewbottles.com</span>' +
      '</div>';
    html += renderPrintBarline() + night;

    $('#menu-body').innerHTML = html;
  }

  /* A first visit is 132 drinks and no reason given. The strip is the
     one place the premise gets stated on the way past: it shows on an
     empty shelf, goes when a bottle is ticked, and never comes back
     once it has been waved off. A shared link is its own onboarding,
     so it stays out of the way of one. */
  function showIntro() {
    return !introDone && !shared && stocked().length === 0 && !asideLive();
  }

  function renderIntro() {
    if (!showIntro()) return '';
    return '<div class="intro">' +
      '<h2 class="intro__h">Select your bottles, and this becomes your menu.</h2>' +
      '<p class="intro__p">Open the Bar tab, select what you own, and the list ' +
        'shrinks to what you can pour tonight. Every bottle you have not ' +
        'selected shows how many drinks it would add.</p>' +
      '<div class="intro__acts">' +
        '<button type="button" class="btn intro__go" data-intro-open="1">Open the Bar tab</button>' +
        '<button type="button" class="intro__no" data-intro-dismiss="1">Not now</button>' +
      '</div>' +
      '</div>';
  }

  /* Spirits first, because they are how anyone actually chooses a drink, then
     the modifiers that decide the rest of the menu.

     On a phone this row is a scroller you swipe. A pointer cannot swipe
     it, so on a wide screen it wraps instead. Twenty-seven chips
     wrapped is half the fold gone before the first drink, so it is
     clamped to two rows with a word under it that opens the rest. A chip
     that is on is never hidden behind that word. */
  function renderBottleChips() {
    var chipped = data.bar.ingredients.filter(hasChip);
    var all = chipsOpen || !!filter.family;
    var html = '<div class="chips chips--bottle' + (all ? ' is-all' : '') + '">';
    chipped.forEach(function (i) {
      html += '<button class="chip' + (filter.family === i.id ? ' is-on' : '') +
        '" data-family="' + esc(i.id) + '">' + esc(i.short) + '</button>';
    });
    return html + '</div>' +
      '<button type="button" class="chips__more" data-chips="1"' +
      ' aria-expanded="' + (all ? 'true' : 'false') + '">' +
      (all ? 'Fewer filters' : 'All ' + chipped.length + ' bottle filters') +
      '</button>';
  }

  function renderFilters() {
    var held = heldNow();
    var n = data.menu.cocktails.filter(function (d) { return matches(d, held); }).length;

    /* The chip row is a horizontal scroller. Rebuilding it from innerHTML
       drops you back at the start, so the chip you just tapped is gone
       and toggling it off means scrolling the whole row again. */
    var chipX = [];
    document.querySelectorAll('#filters .chips').forEach(function (el) {
      chipX.push(el.scrollLeft);
    });

    var seg = [{ id: 'all', label: 'All' }].concat(data.menu.methods.map(function (m) {
      return { id: m.id, label: m.label };
    }));
    if (data.kin) seg.push({ id: 'families', label: 'Shapes' });

    var html = renderIntro() + '<div class="filters">' +
      '<div class="seg' + (seg.length > 3 ? ' seg--wide' : '') + '">' + seg.map(function (s) {
        return '<button class="seg__b' + (filter.method === s.id ? ' is-on' : '') +
          '" data-method="' + s.id + '">' + esc(s.label) + '</button>';
      }).join('') + '</div>' +
      '<input class="search" id="q" type="search" placeholder="Name, ingredient, or code…" ' +
        'value="' + esc(filter.q) + '" autocomplete="off" spellcheck="false">';

    if (filter.method === 'families' && data.kin) {
      html += '<div class="chips">';
      data.kin.patterns.forEach(function (p) {
        html += '<button class="chip' + (filter.pattern === p.id ? ' is-on' : '') +
          '" data-pattern="' + esc(p.id) + '">' + esc(p.label) + '</button>';
      });
      html += '</div>';
    }

    html += renderBottleChips() + '<div class="chips">';

    /* Carry the shelf count on the control itself. The Bar tab shows the
       same number, and the two disagreeing with no explanation is exactly
       how this filter looked broken.

       The chip is named for the shelf it gates on, so a named shelf says
       its own name here. Reading the Gin shelf while the chip says My
       Shelf is the same disagreement, in words. */
    var mine = viewHave();
    var canNow = stocked(mine).length ? pourableCount(mine) : null;

    html += mineChip();
    html += '<button class="chip chip--pour' + (filter.pourable ? ' is-on' : '') +
        '" data-pourable="1">' + (filter.pourable ? '✓ ' : '') + esc(viewName()) +
        (canNow === null ? '' : ' · ' + canNow) + '</button>';

    /* Once a shared link has been opened its menu is a second chip for
       the rest of the session, so the two are a switch, not a detour. */
    if (shared) {
      html += '<button class="chip chip--pour' + (filter.shared ? ' is-on' : '') +
        '" data-shared="1">' + (filter.shared ? '✓ ' : '') + 'Shared menu · ' +
        pourableCount(shared.have) + '</button>';
    }

    html +=
      (filter.family || filter.pattern || filter.q || filter.method !== 'all' || shelfGate()
        ? '<button class="chip" data-clear="1">Clear</button>' : '') +
      '</div>' +
      '<p class="filters__note"><b>' + n + '</b> of ' + data.menu.cocktails.length + ' shown</p>' +
      '</div>';

    $('#filters').innerHTML = html;

    document.querySelectorAll('#filters .chips').forEach(function (el, i) {
      if (i < chipX.length) el.scrollLeft = chipX[i];
    });
  }

  /* ── bar view ──────────────────────────────────────────── */

  /* The checkbox ticks the shelf. The rest of the row reveals notes
     and the shopping list when the bottle has either, and does
     nothing when it does not. */
  var TIER_ORDER = ['solid', 'elevated', 'excellent', 'exceptional', 'alternatives'];
  var TIER_LABEL = {
    solid: 'Solid',
    elevated: 'Elevated',
    excellent: 'Excellent',
    exceptional: 'Exceptional',
    alternatives: 'Alternatives'
  };

  function bottleHasNotes(i) {
    return !!(i.notes && (i.notes.copy || (i.notes.parts && i.notes.parts.length)));
  }

  function bottleHasPane(i) {
    return bottleHasNotes(i) || bottleHasBrands(i);
  }

  function brandMeta(b) {
    var bits = [];
    if (b.size) bits.push(b.size);
    if (b.price != null) bits.push('~$' + b.price);
    return bits.join(' · ');
  }

  function renderBrands(i) {
    var byTier = {};
    i.bottles.forEach(function (b) {
      (byTier[b.tier] || (byTier[b.tier] = [])).push(b);
    });
    var lock = !editing();
    var html = '<div class="brands">';
    TIER_ORDER.forEach(function (tier) {
      var list = byTier[tier];
      if (!list) return;
      html += '<h3 class="brands__tier">' + esc(TIER_LABEL[tier]) + '</h3>';
      list.forEach(function (b) {
        var on = !lock && !!own[b.id];
        var meta = brandMeta(b);
        html += '<div class="brand' + (on ? ' is-on' : '') + '">' +
          '<button type="button" class="brand__hit" data-brand="' + esc(b.id) +
            '" data-parent="' + esc(i.id) + '"' + (lock ? ' disabled' : '') +
            ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
            ' aria-label="' + esc(b.name) + '">' +
            '<span class="bottle__box"></span>' +
            '<span class="brand__name">' + esc(b.name) + '</span>' +
            (meta ? '<span class="brand__meta">' + esc(meta) + '</span>' : '') +
          '</button>' +
          '</div>';
      });
    });
    return html + '</div>';
  }

  function renderBottleNote(i, shown) {
    var html = '<div class="bottle__note" id="note-' + esc(i.id) + '"' +
      (shown ? '' : ' hidden') + '>';
    if (bottleHasBrands(i)) html += renderBrands(i);
    if (bottleHasNotes(i)) {
      var n = i.notes;
      if (n.parts && n.parts.length) {
        n.parts.forEach(function (p) {
          html += '<div class="pour">' +
            '<div class="pour__amt">' + esc(p.amt) + '</div>' +
            '<div class="pour__ing">' + esc(p.item) + '</div>' +
            '</div>';
        });
      }
      if (n.copy) {
        html += '<p class="bottle__copy">' + esc(n.copy) + '</p>';
      }
    }
    return html + '</div>';
  }

  function renderBottleStat(on, gain, uses) {
    if (!uses) return '';
    return on
      ? '<span class="bottle__in">in ' + uses + '</span>'
      : '<span class="bottle__gain' + (gain ? '' : ' bottle__gain--flat') + '">' +
          (gain ? '+' + gain : 'in ' + uses) + '</span>';
  }

  function revealLabel(i, name) {
    if (bottleHasNotes(i) && i.notes.parts && i.notes.parts.length) return 'How to make ' + name;
    if (bottleHasBrands(i)) return 'Bottles of ' + name;
    return 'Notes on ' + name;
  }

  function renderBottle(i, held, gain, uses) {
    var on = !!held[i.id];
    var hasPane = bottleHasPane(i);
    var shown = !!(hasPane && noteOpen[i.id]);
    var name = i.shelf || i.name;
    var html = '<div class="bottle' + (on ? ' is-on' : '') +
      (shown ? ' is-open' : '') + (hasPane ? ' has-note' : '') + '">' +
      '<div class="bottle__row">' +
      '<button type="button" class="bottle__stock" data-bottle="' + esc(i.id) + '"' +
        (editing() ? '' : ' disabled') +
        ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
        ' aria-label="' + esc(name) + '">' +
        '<span class="bottle__box"></span>' +
      '</button>';
    if (hasPane) {
      html += '<button type="button" class="bottle__hit" data-note="' + esc(i.id) + '"' +
        ' aria-expanded="' + (shown ? 'true' : 'false') + '"' +
        ' aria-controls="note-' + esc(i.id) + '"' +
        ' aria-label="' + esc(revealLabel(i, name)) + '">' +
        '<span class="bottle__name">' + esc(name) + '</span>' +
        renderBottleStat(on, gain, uses) +
        '<span class="bottle__more" aria-hidden="true"></span>' +
        '</button>';
    } else {
      html += '<div class="bottle__hit">' +
        '<span class="bottle__name">' + esc(name) + '</span>' +
        renderBottleStat(on, gain, uses) +
        '</div>';
    }
    html += '</div>';
    if (hasPane) html += renderBottleNote(i, shown);
    return html + '</div>';
  }

  /* The running order of the shelf, worked out once on the way into the
     tab and then held.

     Sorting live is what made this tab hard to use: the moment you tick
     a bottle its gain drops to nothing and the row you just touched
     jumps somewhere else, so the next tick lands on whatever slid into
     its place. Freezing the order on entry keeps the best buys at the
     top where they are worth seeing, and keeps the list still while you
     work down it. Only the numbers move. */
  function freezeBarOrder(held, gains) {
    barOrder = {};
    data.bar.ingredients.map(function (i) {
      return { id: i.id, gain: gains[i.id], uses: usageCount(i.id) };
    }).sort(function (a, b) {
      if (b.gain !== a.gain) return b.gain - a.gain;
      return b.uses - a.uses;
    }).forEach(function (r, n) { barOrder[r.id] = n; });
  }

  /* Every figure on this tab is the same question asked of one bottle, and
     the tab asks it of every bottle two or three times over. Ask once per
     render and hand the answers around. */
  function allGains(held) {
    var out = {};
    data.bar.ingredients.forEach(function (i) {
      out[i.id] = marginalGain(i.id, held);
    });
    return out;
  }

  /* Which drinks a bottle actually opens, not how many. The number beside
     a row is the whole point of this tab, but "+7" says how many and never
     which, so the three best get their names read out. Counted the same
     way the figure is: pour the menu with the bottle on the shelf and diff
     it against the menu without. */
  function unlockedBy(ids, held) {
    var withIt = withBottles(held, ids);
    return data.menu.cocktails.filter(function (d) {
      return canPour(d, withIt) && !canPour(d, held);
    });
  }

  function unlockedLine(list) {
    var names = list.slice(0, 3).map(function (d) { return d.name; });
    var rest = list.length - names.length;
    return names.join(', ') + (rest ? ' and ' + rest + ' more' : '');
  }

  /* What it costs to say yes. The solid tier is the house answer to "which
     one should I buy"; a bottle with no brands is one you make. The price
     is what the shelf paid, not what the shop is charging today, so it
     says so. */
  function nextBuyLine(i) {
    if (bottleHasBrands(i)) {
      var pick = null;
      TIER_ORDER.forEach(function (tier) {
        if (pick) return;
        pick = i.bottles.filter(function (b) { return b.tier === tier; })[0] || null;
      });
      if (!pick) return '';
      return pick.name + (pick.price != null ? ', est. $' + pick.price : '');
    }
    if (bottleHasNotes(i)) return 'house recipe on the shelf';
    return '';
  }

  /* The three bottles worth buying next, named, with what each one opens.
     The figures are already down the page, one per row, in the frozen
     order, but nobody reads a shelf top to bottom to find the best three,
     and the shelf is long. This is the same number, lifted.

     Not before there is a shelf to improve on: from nothing, everything is
     zero and a heading over three +0 rows is worse than no heading. */
  function renderNext(held) {
    if (!stocked(held).length || viewingShared()) return '';

    var top = nextBottles(held);
    if (!top.length) return '';

    /* The figures are true of the shelf on screen, so they stay legible
       on a named shelf. Tapping one selects a bottle, which is an edit,
       so that half of the row stands down with the ticks below it. */
    var lock = !editing();
    var html = '<section class="next' + (lock ? ' is-locked' : '') +
      '"><h2 class="next__h">' + esc(nextHead(top)) + '</h2>' +
      '<p class="next__lead">Choose from recommended bottles to grow ' +
      'your menu.</p>';

    top.forEach(function (r) { html += nextRow(r, held, lock); });

    return html + nextLock(lock) + '</section>';
  }

  /* Greyed rows with nothing saying why is how this panel looks broken.
     A named shelf is somebody else's arithmetic, so the box sits over the
     figures and hands back the one shelf they could be bought for. */
  function nextLock(lock) {
    if (!lock) return '';
    return '<div class="next__lock">' +
      '<div class="next__lock-box">' +
        '<p class="next__lock-copy">' + esc('You are viewing ' + viewName()) +
          '</p>' +
        '<button type="button" class="btn" data-shelf-mine="1">' +
        'Switch to My Shelf</button>' +
      '</div></div>';
  }

  /* One bottle each is the usual answer and says so. A row naming a pair
     under a heading that says one bottle is the panel lying about what it
     is asking you to buy. */
  function nextHead(top) {
    var set = top.some(function (r) { return r.ids.length > 1; });
    return set ? 'What to buy next' : 'One more bottle';
  }

  /* A bottle's figure leads to the drinks it opens, filtered to that
     bottle. A set has no single chip to filter on, and the drinks it
     opens are named on the row already, so its figure is just a figure. */
  function nextGain(r, name) {
    if (r.ids.length > 1) {
      return '<span class="next__gain bottle__gain">+' + r.gain + '</span>';
    }
    return '<button type="button" class="next__gain bottle__gain" ' +
      'data-next-see="' + esc(r.ids[0]) + '" ' +
      'aria-label="' + esc('See the ' + name + ' drinks') + '">+' + r.gain + '</button>';
  }

  function nextRow(r, held, lock) {
    var name = rowName(r);
    var jump = r.ids.join(',');
    var buys = rowBuyLines(r).map(function (b) {
      return '<p class="next__buy">' + esc(b) + '</p>';
    }).join('');
    return '<div class="next__row"' +
        (lock ? '' : ' data-next-jump="' + esc(jump) + '"') + '>' +
      '<div class="next__top">' +
        '<button type="button" class="next__name" data-next-jump="' + esc(jump) + '"' +
          (lock ? ' disabled' : '') + '>' +
          esc(name) + '</button>' +
        nextGain(r, name) +
      '</div>' +
      '<p class="next__what">' + esc(unlockedLine(unlockedBy(r.ids, held))) + '</p>' +
      buys +
      '</div>';
  }

  /* My Shelf is what is ticked and is kept when you look at another
     shelf. Named shelves open Switch or Add; Switch does not write. */
  function renderMine() {
    var n = stocked().length;
    var can = pourableCount(have);
    var blurb = n ? plural(n, 'bottle', 'bottles') : 'Nothing ticked yet.';
    var on = shelfView === 'mine';
    var inner = '<span class="starter__text">' +
        '<span class="starter__label">My Shelf</span>' +
        '<span class="starter__blurb">' + esc(blurb) + '</span>' +
      '</span>' +
      '<span class="starter__gain' + (can ? '' : ' starter__gain--flat') + '">' +
        can + '</span>';
    if (on) {
      return '<div class="starter starter--mine is-on">' + inner + '</div>';
    }
    return '<button type="button" class="starter starter--mine" ' +
      'data-shelf-mine="1" aria-label="Switch to My Shelf">' + inner + '</button>';
  }

  function renderNamedShelf(p) {
    var gain = shelfGain(p);
    var open = shelfOpen === p.id;
    var current = shelfView === p.id;
    var html = '<div class="starter-block' + (open ? ' is-open' : '') +
      (current ? ' is-current' : '') + '">' +
      '<button type="button" class="starter" data-shelf="' + esc(p.id) + '"' +
        ' aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="starter__text">' +
          '<span class="starter__label">' + esc(p.label) + '</span>' +
          '<span class="starter__blurb">' + esc(p.blurb) + '</span>' +
        '</span>' +
        '<span class="starter__gain' + (gain ? '' : ' starter__gain--flat') + '">' +
          gain + '</span>' +
      '</button>';
    if (open) {
      html += '<div class="starter__choice">' +
        '<button type="button" class="btn" data-shelf-switch="' + esc(p.id) +
          '">Switch shelves</button>' +
        '<button type="button" class="btn" data-shelf-add="' + esc(p.id) +
          '">Add bottles</button>' +
        '</div>';
    }
    return html + '</div>';
  }

  function renderShelves() {
    var presets = data.bar.shelves;
    if (!presets || !presets.length || viewingShared()) return '';

    var html = '<section class="starters">' +
      '<h2 class="starters__h">Shelves</h2>' +
      '<p class="starters__note">My Shelf stays yours. Open a starter shelf ' +
      'to look at it, or to add its bottles.</p>' +
      renderMine() +
      revealHit('starters', 'Starter Shelves',
        plural(presets.length, 'shelf', 'shelves'), startersOpen) +
      '<div class="tonight__pane" id="starters-pane"' +
        (startersOpen ? '' : ' hidden') + '>';
    presets.forEach(function (p) { html += renderNamedShelf(p); });
    return html + '</div></section>';
  }

  function renderBar() {
    var held = heldNow();
    var can = pourableCount(held);
    var total = data.menu.cocktails.length;
    var bottles = stocked(held).length;
    var gains = gainsFor(held);

    if (!barOrder) freezeBarOrder(held, gains);

    var note;
    if (!editing()) {
      note = 'Looking at ' + (viewingShared() ? 'a shelf someone sent you' : viewName()) +
             '. My Shelf keeps its own bottles, and nothing below can be ' +
             'selected until you go back to it.';
    } else if (!bottles) {
      note = 'Select what is on the shelf, or open Starter Shelves below ' +
             'and start from one. Every bottle then shows what it would add.';
    } else if (!can) {
      note = 'Not enough yet. The figures below are drinks a bottle would ' +
             'unlock, not drinks that only use it.';
    } else {
      note = plural(bottles, 'bottle', 'bottles') + ' on the shelf. The count ' +
             'above follows you down the page, so you can watch it move.';
    }

    /* The count is only worth reading if it leads to the list it counts,
       so the whole figure is the way through to that menu. */
    var up = lastCan !== null && can > lastCan;
    lastCan = can;

    var figure = '<span class="tally__n' + (up ? ' is-up' : '') + '">' + can + '</span>' +
      '<span class="tally__of">drinks you can pour<br>of ' + total + '</span>';

    var html = '<div class="bar-rail"><div class="tally">' +
      (can
        ? '<button class="tally__hit" data-seemenu="1">' + figure +
            '<span class="tally__cta">See the menu <span aria-hidden="true">&rarr;</span></span>' +
          '</button>'
        : '<div class="tally__fig">' + figure + '</div>') +
      '</div>' +
      '<div class="tally__body">' +
      '<p class="tally__note">' + esc(note) + '</p>' +
      renderNext(held) +
      renderShelves() +
      '</div></div><div class="bar-shelves">' + renderViewNote();

    data.bar.kinds.forEach(function (k) {
      var rows = data.bar.ingredients.filter(function (i) { return i.kind === k.id; });
      if (!rows.length) return;

      html += '<section class="shelf"><h2 class="shelf__h">' + esc(k.label) + '</h2>' +
        (k.blurb ? '<p class="shelf__blurb">' + esc(k.blurb) + '</p>' : '') +
        (k.id === 'base' && data.bar.bottles_copy
          ? '<p class="shelf__copy">' + esc(data.bar.bottles_copy) + '</p>'
          : '');

      /* Biggest unlock first, in the order frozen on the way in, so a row
         never moves out from under the finger that just ticked it. */
      rows.map(function (i) {
        return { i: i, gain: gains[i.id], uses: usageCount(i.id) };
      }).sort(function (a, b) {
        return barOrder[a.i.id] - barOrder[b.i.id];
      }).forEach(function (r) {
        html += renderBottle(r.i, held, r.gain, r.uses);
      });

      html += '</section>';
    });

    $('#bar-body').innerHTML = html + renderResetActs() + '</div>';
  }

  /* Foot of the shelf, not the rail: on a laptop these sit under the
     last section, not beside it. */
  function renderResetActs() {
    var lock = editing() ? '' : ' disabled';
    return '<section class="shelf bar-reset">' +
      '<h2 class="shelf__h">Reset the shelf</h2>' +
      '<div class="tally__acts">' +
        '<button class="btn" data-bar="all"' + lock + '>Stock everything</button>' +
        '<button class="btn" data-bar="none"' + lock + '>Clear the shelf</button>' +
      '</div></section>';
  }

  /* The same message where the greyed ticks are. The rail says it too,
     but on a phone the rail is a screen above the bottles, so a guest
     who scrolled down to select one would find no reason for the grey. */
  function renderViewNote() {
    if (editing()) return '';
    var who = viewingShared() ? 'a shelf someone sent you' : viewName();
    return '<div class="bar-view">' +
      '<p class="bar-view__copy">You are looking at ' + esc(who) +
        '. Selecting a bottle changes My Shelf, so go back to it first.</p>' +
      '<button type="button" class="btn" data-shelf-mine="1">Back to My Shelf</button>' +
      '</div>';
  }

  /* ── key view ──────────────────────────────────────────── */

  function defs(rows) {
    return '<div class="defs">' + rows.map(function (r) {
      return '<div class="def">' +
        '<div class="def__c">' + esc(r.code) + '</div>' +
        '<div class="def__l">' + esc(r.label) + '</div>' +
        (r.gloss ? '<div class="def__g">' + esc(r.gloss) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  /* Shared by the Key tab and the printed Barline sheet. */
  function renderBarlineBody() {
    var n = data.notation;
    var sys = n.system;
    var html = '<div class="sys">' +
      '<h1 class="sys__name">' + esc(sys.name) + '</h1>' +
      '<div class="sys__tag">' + esc(sys.tagline) + '</div>' +
      '<p class="sys__lead">' + esc(sys.lead) + '</p>' +
      '</div>' +

      '<h2 class="key__h">How it works</h2>' +
      '<ol class="rules">' + sys.principles.map(function (r) {
        return '<li class="rule">' +
          '<div class="rule__h">' + esc(r.h) + '</div>' +
          '<p class="rule__t">' + lit(r.t) + '</p>' +
          '</li>';
      }).join('') + '</ol>' +
      '<p class="sys__foot">' + esc(sys.footnote) + '</p>' +

      '<h2 class="key__h">Reading order</h2>' +
      '<p class="key__lead key__lead--tight">' + esc(n.note) + '</p>' +

      '<h2 class="key__h">Ounces</h2>' +
      '<p class="key__sub">Lowercase is small, uppercase is large. So <em>q</em> is a quarter and <em>Q</em> is three quarters.</p>' +
      defs(n.amounts) +

      '<h2 class="key__h">Dashes, spoons, rinses</h2>' +
      defs(n.counts) +

      '<h2 class="key__h">Glass</h2>' +
      '<p class="key__sub">The first letter of the last token.</p>' +
      defs(n.glasses) +

      '<h2 class="key__h">Garnish</h2>' +
      '<p class="key__sub">Whatever letters follow the glass. Case matters: <em>l</em> is lemon, <em>L</em> is lime.</p>' +
      defs(n.garnishes) +

      '<h2 class="key__h">Reading one straight through</h2>' +
      '<div class="examples">';

    n.examples.forEach(function (ex) {
      html += '<div class="example">' +
        '<div class="example__n">' + esc(ex.name) + '</div>' +
        '<div class="example__c">' + esc(ex.code) + '</div>' +
        '<pre class="example__l">' + esc(ex.lines.join('\n')) + '</pre>' +
        '</div>';
    });
    return html + '</div>';
  }

  function renderPrintBarline() {
    return '<div class="print-barline">' + renderBarlineBody() + '</div>';
  }

  function renderKey() {
    $('#key-body').innerHTML = renderBarlineBody() +
      '<p class="colophon">' +
      esc(data.menu.cocktails.length + ' drinks, ' + data.bar.ingredients.length +
          ' ingredients. The codes are the ones off the printed menu, with the ' +
          'long drinks written in the same shorthand; every recipe is generated ' +
          'from its code, so the two cannot drift apart.') +
      '</p>' +
      '<p class="sign">© 2026 <a href="https://imti.co/resume/" ' +
        'rel="noopener">Craig Johnston</a></p>';
  }

  /* ── routing ───────────────────────────────────────────── */

  var VIEWS = ['menu', 'bar', 'key', 'info'];

  function show(view) {
    if (VIEWS.indexOf(view) < 0) view = 'menu';
    VIEWS.forEach(function (v) { $('#view-' + v).hidden = v !== view; });
    document.querySelectorAll('.tab, .toptab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === view);
    });
    /* Every view repaints on the way in. The menu depends on the shelf,
       and the shelf is edited on another tab. Rendering it once at boot
       and again only when a filter is touched leaves it frozen at
       whatever the bar looked like earlier, still claiming nothing is
       pourable while the badge says otherwise. */
    if (view === 'menu') repaintMenu();
    if (view === 'bar') {
      /* Re-sort on the way in, and only here. Within a visit the shelf
         holds still under your finger; arriving is when it is fair to
         put the best buys back on top. */
      barOrder = null;
      renderBar();
    }
    if (view === 'key') renderKey();
    /* The shell is viewport-tall and #main is what scrolls, so the
       window has nowhere to go. */
    $('#main').scrollTop = 0;
    track('view_tab', { tab: view });
  }

  /* #drink/<id> is a way in, not state. It opens the Menu with that drink
     expanded and then takes itself back out of the address, so the tab
     bar keeps working and the back button does not bounce between the
     drink and the menu it is already showing. An id nothing answers to
     opens the Menu and says nothing. */
  var DRINK_HASH = /^#drink\/([a-z0-9-]+)$/;

  function route() {
    var deep = DRINK_HASH.exec(location.hash);
    if (!deep) {
      show((location.hash || '#menu').slice(1));
      return;
    }
    show('menu');
    revealDrink(deep[1], 'recipe');
    try {
      history.replaceState(null, '',
        location.pathname + location.search + '#menu');
    } catch (e) { /* file:// */ }
  }

  /* ── wiring ────────────────────────────────────────────── */

  /* Open a drink and put it on screen. If the current filters hide it,
     drop whatever is hiding it. A kin link that does not lead to the
     drink it names is trivia.

     A kin link lands on Kin, because that is the pane you were reading.
     A drink link lands on the recipe, because somebody sent you a drink,
     so the caller says which. */
  function revealDrink(id, pane) {
    var d = cocktailBy[id];
    if (!d) return;
    if (!matches(d, heldNow())) {
      filter.family = null;
      filter.q = '';
      if (filter.pattern && patternIdOf(d) !== filter.pattern) filter.pattern = null;
      if (methodFilterOn() && d.method !== filter.method) filter.method = 'all';
      if (shelfGate() && !canPour(d, heldNow())) { filter.pourable = false; filter.shared = false; }
    }
    open = {};
    open[id] = true;
    recipePane[id] = pane || (data.kin ? 'kin' : 'recipe');
    repaintMenu();
    var el = document.getElementById('drink-' + id);
    if (el) el.scrollIntoView({ block: 'center' });
  }

  /* The same figure on the phone tab bar and on the wide-screen top bar,
     both on Menu. It counts drinks, not bottles, so it belongs on the tab
     that holds the drinks: the badge is the answer, and the Bar tab is
     where you go to change it. One of the two is always hidden, and a
     badge that disagrees with the Bar tab is how the pourable filter last
     looked broken. */
  function refreshCount() {
    var held = heldNow();
    var can = pourableCount(held);
    var on = stocked(held).length > 0;
    [$('#tab-count'), $('#top-count')].forEach(function (badge) {
      if (on) badge.textContent = can;
      badge.hidden = !on;
    });
  }

  function repaintMenu() {
    renderFilters();
    renderMenu();
  }

  /* Everything that puts a link somewhere else: the shelf out of the
     Share pane, and one drink out of its recipe. These live here rather
     than in the click delegate because the delegate is a switch, and a
     switch that grows bodies stops being readable. Returns true when it
     handled the click. */
  function shareAction(t) {
    if (t.dataset.shareCopy) {
      var url = shareUrl(shelfCode(heldNow()));
      var said = function () { flashLabel(t, 'Copied', 'Copy link'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(said, function () { selectShareUrl(t); });
      } else {
        selectShareUrl(t);
      }
      track('share_copy');
      return true;
    }

    /* The anchor does the work; this only counts it. */
    if (t.dataset.shareSms) {
      track('share_sms');
      return true;
    }

    if (t.dataset.shareNative) {
      navigator.share({ title: shareTitle(), url: shareUrl(shelfCode(heldNow())) })
        .catch(function () { /* dismissed */ });
      track('share_native');
      return true;
    }

    if (t.dataset.shareAdopt) {
      if (!shared) return true;
      have = {};
      Object.keys(shared.have).forEach(function (k) { have[k] = true; });
      own = {};
      saveHave(); saveOwn();
      track('share_adopt', { bottles: stocked().length });
      shared = null;
      dropSharedLink();
      filter = emptyFilter();
      filter.pourable = true;
      shelfView = 'mine';
      barOrder = null;
      afterShelf(false);
      $('#main').scrollTop = 0;
      return true;
    }

    return drinkAction(t);
  }

  /* Which drink a click came out of. Inside the list that is the row it
     sits in; in the wide-screen aside the recipe has been lifted out of
     its row, so the aside says which drink it is holding. */
  /* A row unfolds its recipe under it. On a wide screen the recipe is
     read in the aside instead, and there is only one of those, so opening
     one drink closes the rest. On a phone the list has always let you
     leave several open, and nothing below 900px changes. */
  function toggleDrink(id) {
    if (open[id]) {
      delete open[id];
      delete recipePane[id];
      track('drink_close', { drink_id: id, drink_name: drinkName(id) });
    } else {
      if (asideLive()) { open = {}; recipePane = {}; }
      open[id] = true;
      recipePane[id] = 'recipe';
      track('drink_open', { drink_id: id, drink_name: drinkName(id) });
    }
    renderMenu();
  }

  var wakeLock = null;

  /* A phone propped against the bottles should not go dark mid-pour. This
     is a bonus, not a requirement: every way it can say no is ignored. */
  function nightWake(on) {
    try {
      if (!on || !navigator.wakeLock) {
        if (wakeLock) wakeLock.release().catch(function () { /* already gone */ });
        wakeLock = null;
        return;
      }
      navigator.wakeLock.request('screen').then(function (lock) { wakeLock = lock; },
        function () { /* denied, or the document is not visible */ });
    } catch (e) { /* not allowed in this context */ }
  }

  /* Big type, the pourable list, and nothing else. The phone against the
     bottles at a party, and the tablet on the bar. Nothing is persisted:
     a reload comes back as the app, which is the point of a display. */
  function setTonight(on) {
    tonight = on;
    document.body.classList.toggle('is-tonight', on);
    /* Tonight shows the Recipe pane and hides the tabs that would change
       it, so a drink left open on Kin has to come back to the pour. */
    if (on) Object.keys(recipePane).forEach(function (id) { recipePane[id] = 'recipe'; });
    nightWake(on);
    track('tonight', { action: on ? 'open' : 'close', drinks: pourableCount(heldNow()) });
    repaintMenu();
    $('#main').scrollTop = 0;
  }

  document.addEventListener('visibilitychange', function () {
    if (tonight) nightWake(!document.hidden);
  });

  function fromDrinkId(t) {
    var row = t.closest('.drink');
    if (row && row.id) return row.id.replace(/^drink-/, '');
    var aside = t.closest('[data-open-drink]');
    return aside ? aside.getAttribute('data-open-drink') : '';
  }

  function countDrinkLink(id, action) {
    track('drink_link', {
      drink_id: id, drink_name: drinkName(id), action: action
    });
    return true;
  }

  /* The same three acts on one drink instead of on the whole shelf. The
     clipboard fallback is the shelf's, and here it is a real answer
     rather than a shrug: the address is on screen in the Share pane, so
     failing to copy it leaves it selected. */
  function drinkAction(t) {
    if (t.dataset.drinkLink) {
      var id = t.dataset.drinkLink;
      var said = function () { flashLabel(t, 'Copied', 'Copy link'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(drinkUrl(id))
          .then(said, function () { selectShareUrl(t); });
      } else {
        selectShareUrl(t);
      }
      return countDrinkLink(id, 'copy');
    }

    if (t.dataset.drinkShare) {
      navigator.share({
        title: drinkName(t.dataset.drinkShare),
        url: drinkUrl(t.dataset.drinkShare)
      }).catch(function () { /* dismissed */ });
      return countDrinkLink(t.dataset.drinkShare, 'share');
    }

    /* The sms: anchor does the work; this only counts it. */
    if (t.dataset.drinkSms) return countDrinkLink(t.dataset.drinkSms, 'sms');

    return false;
  }

  /* The two reveals in the masthead, the paper ticks, and the dialog
     itself. All of it is about what leaves the phone as a page. */
  function printAction(t) {
    if (t.dataset.printOpen || t.dataset.shareOpen) {
      var isPrint = !!t.dataset.printOpen;
      var on = isPrint ? (printOpen = !printOpen) : (shareOpen = !shareOpen);
      t.classList.toggle('is-open', on);
      t.setAttribute('aria-expanded', on ? 'true' : 'false');
      var pane = document.getElementById(t.getAttribute('aria-controls'));
      if (pane) pane.hidden = !on;
      track(isPrint ? 'print_reveal' : 'share_reveal', { open: on });
      return true;
    }

    if (t.dataset.printOpt) {
      var opt = t.dataset.printOpt;
      printOpts[opt] = !printOpts[opt];
      savePrintOpts();
      applyPrintFlags();
      t.classList.toggle('is-on', !!printOpts[opt]);
      t.setAttribute('aria-pressed', printOpts[opt] ? 'true' : 'false');
      track('print_opt', { opt: opt, on: !!printOpts[opt] });
      return true;
    }

    if (!t.dataset.print) return false;

    /* The print dialog's header and the saved PDF name should be the card,
       not the site. Restore after the dialog closes. */
    var prev = document.title;
    document.title = cardTitle();
    var restore = function () {
      document.title = prev;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    track('print_menu', {
      named: cardTitle() !== 'Your menu',
      icon: printOpts.icon !== false,
      recipe: !!printOpts.recipe,
      taste: !!printOpts.taste,
      history: !!printOpts.history,
      barline: !!printOpts.barline
    });
    window.print();
    return true;
  }

  /* Every figure the Bar tab prints is a way through to the list it is
     counting. A number that does not lead anywhere is trivia. */
  function jumpAction(t) {
    /* The suggestion selects the bottle. The list it names is already on
       the row, so a trip to the shelf to tick the same box is a tap this
       already knows the answer to. Only My Shelf takes it. */
    if (t.dataset.nextJump) {
      if (!editing()) return true;
      var ids = t.dataset.nextJump.split(',');
      track('bar_next', {
        bottle_id: t.dataset.nextJump,
        drinks: rowGain(ids, have)
      });
      ids.forEach(function (id) { have[id] = true; });
      saveHave();
      afterShelf(true);
      return true;
    }

    /* The figure goes to the drinks it counts, filtered to that bottle. */
    if (t.dataset.nextSee) {
      var id = t.dataset.nextSee;
      track('bar_next', { bottle_id: id, drinks: marginalGain(id, heldNow()) });
      filter = emptyFilter();
      filter.pourable = true;
      filter.family = hasChip(ing[id] || {}) ? id : null;
      /* A bottle whose unlocks are all drinks it does not itself lead
         filters the list to nothing. Drop the chip and land on the menu. */
      var seen = heldNow();
      if (!data.menu.cocktails.some(function (d) { return matches(d, seen); })) {
        filter.family = null;
      }
    } else if (t.dataset.seemenu) {
      /* From the count on the Bar tab to the menu it is counting. */
      filter = emptyFilter();
      filter.pourable = true;
      track('see_pourable');
    } else {
      return false;
    }
    repaintMenu();
    location.hash = '#menu';
    return true;
  }

  /* A bottle can now be selected from the Menu's rail as well as from the
     shelf, so what a selection repaints is whichever tab is on screen. On
     the Menu that is the list re-gating and the rail naming the next
     bottle; the Bar, hidden, catches up on the way in. */
  function afterShelf(keepScroll) {
    if (!$('#view-bar').hidden) {
      repaintBar(keepScroll);
      return;
    }
    var y = $('#main').scrollTop;
    refreshCount();
    repaintMenu();
    $('#main').scrollTop = y;
  }

  /* Every figure on the shelf is relative to what is stocked, so selecting
     one rewrites the whole list. Put the scroll back where it was, or the
     row you just selected leaves the screen under your finger. */
  function railPane() {
    return document.querySelector('.bar-rail .tally__body') ||
      document.querySelector('.bar-rail');
  }

  function repaintBar(keepScroll) {
    var y = $('#main').scrollTop;
    /* The rail list is `.tally__body` on a wide screen; the rail
       itself no longer scrolls. Put that pane back or opening a shelf
       dumps you at the top of a panel you did not leave. */
    var pane = railPane();
    var paneY = pane ? pane.scrollTop : 0;
    renderBar();
    pane = railPane();
    if (pane) pane.scrollTop = paneY;
    if (keepScroll) $('#main').scrollTop = y;
    refreshCount();
  }

  /* Reveal a bottle's notes and its shopping list. The checkbox ticks the
     shelf; this is the rest of the row. */
  function noteAction(t) {
    var id = t.dataset.note;
    if (noteOpen[id]) delete noteOpen[id];
    else noteOpen[id] = true;
    var bottle = t.closest('.bottle');
    if (!bottle) return true;
    var shown = !!noteOpen[id];
    bottle.classList.toggle('is-open', shown);
    t.setAttribute('aria-expanded', shown ? 'true' : 'false');
    var pane = bottle.querySelector('.bottle__note');
    if (pane) pane.hidden = !shown;
    track('bar_note', { bottle_id: id, open: shown });
    return true;
  }

  /* Ticking a listed brand ticks the type it belongs to; unticking the
     last one unticks it again. An unknown bottle still ticks the type on
     its own, which is what the row's own checkbox is for. */
  function brandAction(t) {
    if (!editing()) return true;
    var brand = t.dataset.brand;
    var parent = t.dataset.parent;
    own[brand] = !own[brand];
    if (!own[brand]) delete own[brand];
    if (ing[parent].bottles.some(function (b) { return own[b.id]; })) have[parent] = true;
    else delete have[parent];
    saveOwn();
    saveHave();
    afterShelf(true);
    track('bar_brand', { brand_id: brand, bottle_id: parent, stocked: !!own[brand] });
    return true;
  }

  function bottleAction(t) {
    if (!editing()) return true;
    var id = t.dataset.bottle;
    have[id] = !have[id];
    if (!have[id]) {
      delete have[id];
      clearBrandsFor(id);
      saveOwn();
    }
    saveHave();
    afterShelf(true);
    track('bar_stock', { bottle_id: id, stocked: !!have[id] });
    return true;
  }

  /* Five ways to replace your shelf, on screen every time, is the wrong
     weight for something you use once. The row says how many are behind
     it and stays closed until you want one. Session only: coming back to
     the tab comes back to the shelf, not to the shortcuts. */
  function toggleStarters() {
    startersOpen = !startersOpen;
    afterShelf(true);
    track('bar_starters', { open: startersOpen });
    return true;
  }

  /* Opening the choice does not edit the shelf. */
  function revealShelf(t) {
    var id = t.dataset.shelf;
    shelfOpen = shelfOpen === id ? null : id;
    afterShelf(true);
    return true;
  }

  /* Back to your own bottles, from a named shelf or from a shelf someone
     sent. A shared link is a view the same way, so this drops that gate
     too and leaves the list on the menu your shelf pours. */
  function switchToMine() {
    shelfView = 'mine';
    shelfOpen = null;
    barOrder = null;
    if (filter.shared) {
      filter.shared = false;
      filter.pourable = true;
    }
    afterShelf(false);
    return true;
  }

  /* Choosing a shelf is choosing a menu, so the list is gated on it
     without a second tap. A shelf that pours nothing gates too, since the
     list already says so in words: Staples only reading nothing yet is
     the answer, and a menu of 174 drinks beside a Bar tab saying Staples
     only is the two tabs disagreeing again. */
  function gateMenuOnShelf() {
    filter.pourable = true;
    filter.shared = false;
  }

  function applyShelf(id, how) {
    var preset = presetById(id);
    if (!preset) return true;
    shelfOpen = null;
    if (how === 'add') {
      var wasEmpty = !stocked().length;
      preset.ingredients.forEach(function (sid) { if (ing[sid]) have[sid] = true; });
      saveHave();
      if (wasEmpty) barOrder = null;
      shelfView = 'mine';
    } else {
      shelfView = id;
      barOrder = null;
    }
    gateMenuOnShelf();
    afterShelf(false);
    track('bar_preset', {
      action: preset.id,
      bottles: stocked(heldNow()).length,
      drinks: pourableCount(heldNow())
    });
    return true;
  }

  /* Everything that edits the shelf, out of the switch and into one
     place, because the delegate is a switch and a switch that grows
     bodies stops being readable. */
  function barAction(t) {
    if (t.dataset.note) return noteAction(t);
    if (t.dataset.brand) return brandAction(t);
    if (t.dataset.bottle) return bottleAction(t);
    if (t.dataset.startersOpen) return toggleStarters();
    if (t.dataset.shelfMine) return switchToMine();
    if (t.dataset.shelfSwitch) return applyShelf(t.dataset.shelfSwitch, 'switch');
    if (t.dataset.shelfAdd) return applyShelf(t.dataset.shelfAdd, 'add');
    if (t.dataset.shelf) return revealShelf(t);

    /* Stocking everything says nothing about which brands are on the
       shelf, so the brand ticks stand. Clearing the shelf clears them. */
    if (t.dataset.bar && !editing()) return true;
    if (t.dataset.bar === 'all') {
      data.bar.ingredients.forEach(function (i) { have[i.id] = true; });
      saveHave();
    } else if (t.dataset.bar === 'none') {
      have = {};
      own = {};
      saveHave(); saveOwn();
    } else {
      return false;
    }
    barOrder = null;
    afterShelf(false);
    track('bar_bulk', { action: t.dataset.bar });
    return true;
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-recipe-tab],[data-drink],[data-method],[data-family],[data-pattern],' +
      '[data-pourable],[data-shared],[data-clear],[data-clearothers],[data-bottle],[data-brand],[data-note],[data-bar],[data-shelf],[data-starters-open],[data-seemenu],' +
      '[data-next-jump],[data-next-see],' +
      '[data-print],[data-print-open],[data-print-opt],[data-kin],[data-see-pattern],' +
      '[data-share-open],[data-share-copy],[data-share-sms],[data-share-native],' +
      '[data-drink-link],[data-drink-share],[data-drink-sms],' +
      '[data-share-adopt],[data-shelf-mine],[data-shelf-switch],[data-shelf-add],[data-intro-open],[data-intro-dismiss],[data-tonight],[data-chips]');
    if (!t) return;

    if (t.dataset.recipeTab) {
      setRecipePane(t.dataset.recipeFor, t.dataset.recipeTab, t.closest('.recipe'));
      return;
    }

    if (t.dataset.chips) {
      chipsOpen = !chipsOpen;
      renderFilters();
      return;
    }

    if (t.dataset.tonight) {
      setTonight(t.dataset.tonight === 'open');
      return;
    }

    if (t.dataset.drink) {
      toggleDrink(t.dataset.drink);
      return;
    }

    if (t.dataset.method) {
      filter.method = t.dataset.method;
      if (filter.method !== 'families') filter.pattern = null;
      track('filter', { filter_type: 'method', filter_value: filter.method });
      repaintMenu();
      return;
    }

    if (t.dataset.family) {
      filter.family = filter.family === t.dataset.family ? null : t.dataset.family;
      track('filter', { filter_type: 'family', filter_value: filter.family || '' });
      repaintMenu();
      return;
    }

    if (t.dataset.pattern) {
      filter.pattern = filter.pattern === t.dataset.pattern ? null : t.dataset.pattern;
      track('filter', { filter_type: 'pattern', filter_value: filter.pattern || '' });
      repaintMenu();
      return;
    }

    if (t.dataset.kin) {
      track('kin_follow', {
        from_id: fromDrinkId(t),
        drink_id: t.dataset.kin,
        drink_name: drinkName(t.dataset.kin)
      });
      revealDrink(t.dataset.kin);
      return;
    }

    if (t.dataset.seePattern) {
      filter.method = 'families';
      filter.pattern = t.dataset.seePattern;
      filter.family = null;
      filter.q = '';
      track('see_pattern', { pattern: t.dataset.seePattern });
      repaintMenu();
      $('#main').scrollTop = 0;
      return;
    }

    if (t.dataset.introOpen) {
      track('intro', { action: 'open' });
      location.hash = '#bar';
      return;
    }

    if (t.dataset.introDismiss) {
      introDone = true;
      saveIntro();
      track('intro', { action: 'dismiss' });
      renderFilters();
      return;
    }

    if (t.dataset.pourable) {
      filter.pourable = !filter.pourable;
      filter.shared = false;
      track('filter', { filter_type: 'pourable', filter_value: filter.pourable ? 'on' : 'off' });
      repaintMenu();
      return;
    }

    if (t.dataset.shared) {
      filter.shared = !filter.shared;
      filter.pourable = false;
      track('filter', { filter_type: 'shared', filter_value: filter.shared ? 'on' : 'off' });
      repaintMenu();
      return;
    }

    if (jumpAction(t)) return;

    if (printAction(t)) return;
    if (shareAction(t)) return;

    /* Keep the shelf filter, drop whatever else was excluding things. */
    if (t.dataset.clearothers) {
      var keepShared = filter.shared;
      filter = emptyFilter();
      if (keepShared) filter.shared = true; else filter.pourable = true;
      track('filter', { filter_type: 'clear', filter_value: 'others' });
      repaintMenu();
      return;
    }

    if (t.dataset.clear) {
      filter = emptyFilter();
      track('filter', { filter_type: 'clear', filter_value: 'all' });
      repaintMenu();
      return;
    }

    barAction(t);
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.id === 'menu-title' && e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
      return;
    }

    /* Escape dismisses the rail, the way it dismisses any other panel.
       Not from inside a field, where the browser has its own meaning for
       it. */
    if (e.key === 'Escape' && asideLive()
        && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName || '')) {
      var open1 = Object.keys(open)[0];
      if (open1) toggleDrink(open1);
      return;
    }

    var tab = e.target.closest('[data-recipe-tab]');
    if (!tab) return;
    var list = tab.parentNode.querySelectorAll('[data-recipe-tab]');
    var i = Array.prototype.indexOf.call(list, tab);
    var next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    var ntab = list[next];
    setRecipePane(ntab.dataset.recipeFor, ntab.dataset.recipeTab, ntab.closest('.recipe'));
    ntab.focus();
  });

  document.addEventListener('change', function (e) {
    if (e.target.id !== 'menu-title') return;
    menuTitle = e.target.value.replace(/\s+/g, ' ').trim();
    e.target.value = menuTitle;
    saveMenuTitle();
    syncPrintTitle();
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'menu-title') {
      menuTitle = e.target.value;
      saveMenuTitle();
      syncPrintTitle();
      return;
    }

    if (e.target.id !== 'q') return;
    filter.q = e.target.value.trim().toLowerCase();
    /* Repaint the list but leave the field alone, or the caret jumps. */
    renderMenu();
    var note = document.querySelector('.filters__note');
    if (note) {
      var n = data.menu.cocktails.filter(function (d) { return matches(d, heldNow()); }).length;
      note.innerHTML = '<b>' + n + '</b> of ' + data.menu.cocktails.length + ' shown';
    }
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      if (filter.q) track('search', { search_term: filter.q });
    }, 700);
  });

  /* ── version ───────────────────────────────────────────── */

  /* The same label in the top bar and in the Info sentence, so a working
     copy reads dev in both and a deploy reads the tag in both. */
  function showVersion() {
    $('#top-version').textContent = versionLabel;
    $('#info-version').textContent = versionLabel;
  }

  window.addEventListener('hashchange', route);

  /* Crossing 900px moves the open recipe between the row and the aside.
     Nothing about the drink changes; only where it is read. */
  WIDE.addEventListener('change', function () {
    if (!$('#view-menu').hidden) repaintMenu();
  });

  /* ── boot ──────────────────────────────────────────────── */

  var GLASS_FILES = [
    'nick-nora', 'nick-nora-twist', 'nick-nora-pick', 'nick-nora-wheel',
    'rocks', 'rocks-twist', 'rocks-pick', 'rocks-wheel',
    'rocks-cube', 'rocks-cube-twist', 'rocks-cube-pick', 'rocks-cube-wheel',
    'rocks-ice',
    'highball', 'highball-twist', 'highball-wheel', 'highball-pick',
    'highball-ice', 'highball-ice-twist', 'highball-ice-wheel',
    'highball-ice-pick'
  ];

  function loadGlassArt() {
    return Promise.all(GLASS_FILES.map(function (id) {
      return fetch('assets/glasses/' + id + '.svg').then(function (r) {
        if (!r.ok) return;
        return r.text().then(function (t) { glassMarkup[id] = t; });
      }).catch(function () { /* art is decorative */ });
    }));
  }

  Promise.all([
    fetch('data/cocktails.json').then(function (r) { return r.json(); }),
    fetch('data/bar.json').then(function (r) { return r.json(); }),
    fetch('data/notation.json').then(function (r) { return r.json(); }),
    fetch('data/kin.json').then(function (r) { return r.json(); }),
    loadGlassArt()
  ]).then(function (res) {
    data.menu = res[0];
    data.bar = res[1];
    data.notation = res[2];
    data.kin = res[3];

    data.bar.ingredients.forEach(function (i) {
      ing[i.id] = i;
      if (i.stand_in) standInBy[i.id] = i.stand_in;
    });
    data.menu.cocktails.forEach(function (d) { cocktailBy[d.id] = d; });
    data.menu.methods.forEach(function (m) { methodBy[m.id] = m; });
    data.kin.patterns.forEach(function (p) { patternBy[p.id] = p; });
    data.notation.glasses.forEach(function (g) { glassBy[g.code] = g; });
    data.notation.garnishes.forEach(function (g) { garnishBy[g.code] = g; });
    garnishCodes = data.notation.garnishes.map(function (g) { return g.code; })
      .sort(function (a, b) { return b.length - a.length; });

    buildNeeds();
    loadHave();
    loadOwn();
    loadMenuTitle();
    loadPrintOpts();
    loadIntro();
    applyPrintFlags();
    document.body.classList.toggle('is-print-split', PRINT_SPLIT);
    syncHaveFromBrands();
    saveHave();
    openSharedLink();

    $('#loading').hidden = true;
    showVersion();
    repaintMenu();
    refreshCount();
    route();
  }).catch(function (err) {
    $('#loading').textContent = 'Could not load the menu. ' + err;
  });

  /* Service worker: production only, and actively evicted anywhere else.

     A worker registered on http://localhost:8000 owns that whole origin,
     and every static site here serves './', 'index.html' and
     'assets/app.js' from it. So a worker installed by one project will
     answer for the next one, cache-first, and keep answering after the
     dev server is dead. A page that loads with nothing listening on the
     port is the tell.

     Skipping registration is not enough to undo that: the stale worker
     is already serving the old app.js, so the guard never gets to run.
     Off https, this actively unregisters whatever is there, drops the
     caches, and reloads once into a clean origin.

     iOS home-screen WebViews resume without navigating, so they will
     not check for a new worker on their own. updateViaCache: 'none'
     stops Safari using the four-hour CDN copy of sw.js, and a poke on
     foreground is the check the resume never made. */
  if ('serviceWorker' in navigator) {
    if (location.protocol === 'https:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
          .then(function (reg) {
            function poke() { reg.update(); }
            document.addEventListener('visibilitychange', function () {
              if (!document.hidden) poke();
            });
            window.addEventListener('pageshow', poke);
          })
          .catch(function () { /* offline is a bonus */ });
      });
    } else {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        if (!regs.length) return null;
        return Promise.all(regs.map(function (r) { return r.unregister(); }))
          .then(function () { return caches.keys(); })
          .then(function (keys) {
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          })
          .then(function () {
            /* Only reload if a worker was actually answering for us. The
               next load finds no registration and falls straight through,
               so this cannot loop. */
            if (navigator.serviceWorker.controller) location.reload();
          });
      }).catch(function () { /* nothing to clean up */ });
    }
  }
})();
