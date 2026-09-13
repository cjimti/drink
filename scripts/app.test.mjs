/* The JavaScript the browser runs, run by node.

   check_menu.py regenerates every code in Python and test_checks.py
   breaks the checkers on purpose, but neither executes app.js. This
   does, with node:test and nothing installed: the file is read, the
   IIFE around it is taken off so its functions land on a vm context,
   and a stub page stands in for the DOM. Boot then runs for real, on
   the real data, so every case below reads the same indexes a phone
   builds.

   The stub is only as wide as boot needs. A case that wants a real
   layout belongs in a browser, not here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const json = (name) => JSON.parse(read(name));

const MENU = json('data/cocktails.json');
const BAR = json('data/bar.json');
const NOTATION = json('data/notation.json');

const OPEN = "(function () {\n  'use strict';";
const CLOSE = '})();';

/* The body of the IIFE, as a script of its own. The wrapper is found by
   its exact text, so a change to it fails here loudly rather than
   loading half a file. */
function body() {
  const src = read('assets/app.js');
  const start = src.indexOf(OPEN);
  const end = src.lastIndexOf(CLOSE);
  assert.ok(start >= 0 && end > start, 'app.js is no longer one IIFE');
  return "'use strict';" + src.slice(start + OPEN.length, end);
}

/* An element that takes whatever boot writes and reads back empty. */
function element(name) {
  const attrs = {};
  return {
    id: name, hidden: false, innerHTML: '', textContent: '', value: '',
    scrollTop: 0, dataset: {}, style: {}, attributes: [],
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    hasAttribute(k) { return k in attrs; },
    removeAttribute(k) { delete attrs[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    focus() {}, blur() {}, scrollIntoView() {}, closest() { return null; },
    getBoundingClientRect() { return { top: 0, bottom: 0, height: 0 }; },
    getClientRects() { return []; }
  };
}

function memoryStore(seed) {
  const s = Object.assign({}, seed);
  return {
    getItem(k) { return k in s ? s[k] : null; },
    setItem(k, v) { s[k] = String(v); },
    removeItem(k) { delete s[k]; }
  };
}

/* A fetch that serves the tree. The ?v= the app puts on the data is the
   release, and the file on disk is the working copy of every release. */
function fetchTree(url) {
  const file = path.join(ROOT, url.split('?')[0]);
  const ok = fs.existsSync(file);
  const text = ok ? fs.readFileSync(file, 'utf8') : '';
  return Promise.resolve({
    ok, url,
    json: () => Promise.resolve(JSON.parse(text)),
    text: () => Promise.resolve(text)
  });
}

/* Boot app.js against the tree with this store. Resolves to the context
   once the loading line is hidden, or rejects with what it said. */
function boot(store) {
  const els = {};
  const $ = (sel) => (els[sel] = els[sel] || element(sel));
  const win = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, dataLayer: []
  };
  const ctx = {
    console, setTimeout, clearTimeout, URL, URLSearchParams,
    requestAnimationFrame: (fn) => fn(),
    localStorage: memoryStore(store),
    navigator: { userAgent: 'node', platform: 'node', maxTouchPoints: 0 },
    location: { protocol: 'http:', origin: 'http://localhost', pathname: '/',
                search: '', hash: '', reload() {} },
    history: { replaceState() {} },
    fetch: fetchTree,
    window: win,
    document: {
      title: 'few bottles', hidden: false, activeElement: null,
      body: element('body'),
      querySelector: $, querySelectorAll: () => [],
      getElementById: (id) => $('#' + id),
      addEventListener() {}, createElement: element
    }
  };
  win.window = win;
  vm.createContext(ctx);
  vm.runInContext(body(), ctx, { filename: 'assets/app.js' });
  return new Promise((resolve, reject) => {
    const loading = $('#loading');
    (function wait(n) {
      if (loading.hidden) return resolve(ctx);
      if (loading.textContent) return reject(new Error(loading.textContent));
      if (n > 2000) return reject(new Error('boot never finished in ten seconds'));
      setTimeout(() => wait(n + 1), 5);
    })(0);
  });
}

const app = await boot({});
const byId = Object.fromEntries(MENU.cocktails.map((d) => [d.id, d]));
const shelf = (...ids) => Object.fromEntries(ids.map((id) => [id, true]));
const ingredient = (id) => BAR.ingredients.find((i) => i.id === id);
/* What the app hands back was made in the vm's realm, and strict deep
   equality compares prototypes too. */
const plain = (v) => JSON.parse(JSON.stringify(v));

test('every build amount reads as words, never as its own token', () => {
  for (const d of MENU.cocktails) {
    for (const [id, token] of d.build) {
      const said = app.readAmount(token, ingredient(id));
      assert.ok(said, `${d.id}: ${token} read as nothing`);
      if (token !== null) assert.notEqual(said, token, `${d.id}: ${token} beside ${id} was not decoded`);
    }
  }
});

test('every serve token is a glass and garnishes, nothing left over', () => {
  const glasses = new Set(NOTATION.glasses.map((g) => g.code));
  for (const d of MENU.cocktails) {
    assert.equal(d.code.split(',').pop(), d.serve, `${d.id}: the code does not end in its serve`);
    assert.ok(glasses.has(d.serve[0]), `${d.id}: ${d.serve[0]} is no glass`);
    const found = app.readServe(d.serve).garnish.map((g) => g.code).join('');
    assert.equal(found, d.serve.slice(1), `${d.id}: ${d.serve} decodes as ${d.serve[0]}${found}`);
  }
});

test('longest garnish first: ccin is a cherry and cinnamon, Lw one lime wheel', () => {
  assert.deepEqual(plain(app.readServe('ccin').garnish.map((g) => g.code)), ['cin']);
  assert.deepEqual(plain(app.readServe('cccin').garnish.map((g) => g.code)), ['c', 'cin']);
  assert.deepEqual(plain(app.readServe('HLw').garnish.map((g) => g.code)), ['Lw']);
});

test('the key tab and the decoder say the same thing', () => {
  const gin = ingredient('gin');
  const bitters = ingredient('angostura');
  for (const row of NOTATION.amounts) {
    assert.equal(app.readAmount(row.code, gin), row.label, `amount ${row.code}`);
  }
  for (const row of NOTATION.counts) {
    assert.equal(app.readAmount(row.code, bitters), row.label, `count ${row.code}`);
  }
});

test('the contextual tokens', () => {
  const rye = ingredient('rye');
  const bitters = ingredient('angostura');
  assert.equal(app.readAmount('2', rye), '2 oz');
  assert.equal(app.readAmount('2', bitters), '2 dashes');
  assert.equal(app.readAmount('q', rye), '1/4 oz');
  assert.equal(app.readAmount('Q', rye), '3/4 oz');
  assert.equal(app.readAmount('1h', rye), '1 1/2 oz');
  assert.equal(app.readAmount('r', ingredient('absinthe')), 'rinse');
  assert.equal(app.readAmount(null, ingredient('egg-white')), '·');
  /* A top is however much the glass holds, and a doubled fraction is no
     measure: both come back as the token, which the build test refuses. */
  assert.equal(app.readAmount('2t', rye), '2t');
  assert.equal(app.readAmount('hh', rye), 'hh');
});

test('fold takes the accent off and nothing else', () => {
  assert.equal(app.fold('Bénédictine'), 'benedictine');
  assert.equal(app.fold('Crème de Cacao'), 'creme de cacao');
  assert.equal(app.fold('Rcl'), 'rcl');
});

test('a shelf code round-trips every named shelf and the whole bar', () => {
  const shelves = BAR.shelves.map((s) => s.ingredients)
    .concat([BAR.ingredients.map((i) => i.id)]);
  for (const ids of shelves) {
    const code = app.shelfCode(shelf(...ids));
    assert.match(code, /^\d+$/);
    assert.deepEqual(plain(Object.keys(app.shelfFromCode(code)).sort()), ids.slice().sort());
  }
});

test('a bad shelf code opens nothing', () => {
  const top = Math.max(...BAR.ingredients.map((i) => i.bit));
  const past = (BigInt(1) << BigInt(top + 1)).toString();
  const retired = (BAR.retired_bits || []).map((b) => (BigInt(1) << BigInt(b)).toString());
  const bad = [
    null, undefined, '', ' ', 'abc', '-5', '0', '00', '1e3', '1.0', '+1', '0x1f',
    '１２', ' 1', '1 ', '1\n', '12abc', '9'.repeat(401), '١',
    '1,2', past, ...retired
  ];
  for (const code of bad) {
    assert.equal(app.shelfFromCode(code), null, `${JSON.stringify(code)} opened a shelf`);
  }
  assert.ok(app.shelfFromCode('9'.repeat(400)), 'the longest code a link may carry');
});

test('a stand-in pours the drink the card writes with the other bottle', () => {
  const held = shelf('bourbon', 'simple', 'angostura');
  const old = byId['old-fashioned'];
  assert.ok(old.build.some(([id]) => id === 'demerara'), 'the card still writes demerara');
  assert.equal(app.canPour(old, held), true);
  assert.deepEqual(plain(app.standInFor(old, held)),
    [{ want: 'demerara', use: 'simple' }]);
  assert.equal(app.canPour(old, shelf('bourbon', 'angostura')), false);
});

test('garnish never gates, and bitters on the foam do', () => {
  const martini = byId.martini;
  const pours = martini.build.map(([id]) => id);
  assert.equal(app.canPour(martini, shelf(...pours)), true);
  const rail = byId['brass-rail'];
  const withoutFoam = rail.build.filter((p) => p[2] !== 'g').map(([id]) => id);
  assert.equal(app.canPour(rail, shelf(...withoutFoam)), false);
});

test('Benedictine opens three drinks on a gin and dry vermouth shelf', () => {
  const held = shelf('gin', 'dry-vermouth', 'orange-bitters', 'lemon');
  assert.equal(app.marginalGain('benedictine', held), 3);
  assert.equal(app.marginalGain('gin', held), 0, 'a bottle already held adds nothing');
  const names = app.unlockedBy(['benedictine'], held).map((d) => d.name).sort();
  assert.deepEqual(names, ['Ford Cocktail', 'Tip Top', 'Vancouver']);
});

test('next bottles: three rows, never more, singles before sets', () => {
  const empty = app.nextBottles({});
  assert.ok(empty.length <= 3);
  for (const held of [shelf('gin'), shelf('gin', 'tonic'), shelf('bourbon', 'simple', 'angostura')]) {
    const rows = app.nextBottles(held);
    assert.equal(rows.length, 3, Object.keys(held).join('+'));
    const sizes = rows.map((r) => r.ids.length);
    assert.deepEqual(sizes, sizes.slice().sort((a, b) => a - b));
    for (const r of rows) {
      assert.ok(r.gain > 0, `${r.ids} opens nothing`);
      assert.equal(r.gain, app.rowGain(r.ids, held));
      assert.ok(r.ids.every((id) => !held[id]), `${r.ids} is already on the shelf`);
    }
  }
});

test('the whole bar leaves nothing to buy', () => {
  const all = shelf(...BAR.ingredients.map((i) => i.id));
  assert.equal(app.pourableCount(all), MENU.cocktails.length);
  assert.equal(app.comboRows(all, 3).length, 0);
  assert.equal(app.nextBottles(all).length, 0);
});

/* Byte capacity at level M for versions 1 to 10, off the standard. */
const QR_BYTES_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

test('the QR version is the smallest that holds the text, and 10 is the ceiling', () => {
  QR_BYTES_M.forEach((cap, n) => {
    const ver = n + 1;
    assert.equal(app.qrMatrix('a'.repeat(cap)).length, ver * 4 + 17, `${cap} bytes`);
    if (ver < 10) assert.equal(app.qrMatrix('a'.repeat(cap + 1)).length, (ver + 1) * 4 + 17);
  });
  assert.equal(app.qrMatrix('a'.repeat(214)), null);
});

/* The fifteen format bits are the one part of a symbol a reader checks
   before anything else, and they are BCH-coded, so a wrong mask or level
   shows up here as a code that is not a codeword. */
function formatBits(grid) {
  const size = grid.length;
  const at = (x, y) => (grid[y][x] ? 1 : 0);
  let a = 0;
  let b = 0;
  const first = [];
  for (let i = 0; i < 6; i++) first.push([8, i]);
  first.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) first.push([14 - i, 8]);
  first.forEach(([x, y], i) => { a |= at(x, y) << i; });
  for (let i = 0; i < 8; i++) b |= at(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) b |= at(8, size - 15 + i) << i;
  return [a, b];
}

function isFormatCodeword(bits) {
  const raw = bits ^ 0x5412;
  let rem = raw;
  for (let i = 14; i >= 10; i--) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  return rem === 0 && ((raw >> 13) & 3) === 0; /* 00 is level M */
}

test('the longest drink link and the full shelf link make readable symbols', () => {
  const longest = MENU.cocktails.map((d) => d.id).sort((x, y) => y.length - x.length)[0];
  const full = app.shelfCode(shelf(...BAR.ingredients.map((i) => i.id)));
  for (const url of [`https://fewbottles.com/drink/${longest}/`, `https://fewbottles.com/?s=${full}`]) {
    const grid = app.qrMatrix(url);
    assert.ok(grid, url);
    const size = grid.length;
    assert.equal((size - 17) % 4, 0);
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let i = 0; i < 7; i++) {
        assert.equal(grid[oy][ox + i], true, `${url}: finder edge`);
        assert.equal(grid[oy + 3][ox + 3], true, `${url}: finder centre`);
      }
    }
    const [a, b] = formatBits(grid);
    assert.equal(a, b, `${url}: the two format copies disagree`);
    assert.ok(isFormatCodeword(a), `${url}: format bits are not a level M codeword`);
    for (let i = 8; i < size - 8; i++) assert.equal(grid[6][i], i % 2 === 0, `${url}: timing`);
  }
});

const MALFORMED = [
  'true', '1', '0', '"gin"', '[]', '["gin"]', 'null', '{', '', 'undefined',
  '{"gin":true,"no-such-bottle":true}', '{"__proto__":{"gin":true}}',
  '{"gin":"yes"}', '{"constructor":true}', '"\\u0000"', '1e999',
  JSON.stringify({ gin: { nested: true } }), '{"gin":true}'.repeat(2)
];

test('a malformed store boots to a shelf, and a store change reads it again', async () => {
  const keys = ['drink.bar.v1', 'drink.brands.v1', 'drink.menuTitle.v1', 'drink.print.v1', 'drink.intro.v1'];
  for (const raw of MALFORMED) {
    const ctx = await boot(Object.fromEntries(keys.map((k) => [k, raw])));
    /* A store that parsed to true or a string used to leave the next
       tick writing a property onto something that is not an object. */
    for (const name of ['have', 'own']) {
      assert.equal(Object.prototype.toString.call(ctx[name]), '[object Object]', `${name} from ${raw}`);
    }
    for (const k of keys) {
      assert.doesNotThrow(() => ctx.storesChanged({ key: k }), `${k} = ${raw}`);
    }
    assert.doesNotThrow(() => ctx.storesChanged({ key: null }), `cleared, after ${raw}`);
  }
});

test('a bottle the bar no longer lists is dropped on the way in', async () => {
  const ctx = await boot({ 'drink.bar.v1': '{"gin":true,"no-such-bottle":true}' });
  assert.equal(ctx.localStorage.getItem('drink.bar.v1'), '{"gin":true}');
});

test('a row links its name to the drink page, and the button comes first', () => {
  const html = app.renderDrink(byId.martini, {}, false);
  assert.match(html, /<a class="drink__name" href="\/drink\/martini\/"/);
  assert.ok(html.indexOf('<button') < html.indexOf('<a '), 'the link would answer a [data-drink] lookup');
  assert.match(html, /aria-labelledby="drink-text-martini"/);
  assert.match(html, /id="drink-text-martini"/);
});

test('a plain click on the name opens the row, a modified one leaves it to the browser', () => {
  let focused = 0;
  const hit = { focus() { focused++; } };
  const link = { tagName: 'A', dataset: { drink: 'martini' },
                 closest: () => ({ querySelector: () => hit }) };
  const click = (mods) => {
    let prevented = false;
    app.drinkClick(Object.assign({ button: 0, preventDefault() { prevented = true; } }, mods), link);
    return prevented;
  };
  for (const mods of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    assert.equal(click(mods), false, JSON.stringify(mods));
    assert.equal(app.open.martini, undefined, JSON.stringify(mods));
  }
  assert.equal(focused, 0, 'a click the browser takes moves no focus');
  assert.equal(click({}), true);
  assert.equal(app.open.martini, true);
  assert.equal(focused, 1, 'focus goes to the row button, not the hidden link');
  app.drinkClick({ button: 0, preventDefault() { throw new Error('a button click is not prevented'); } },
    { tagName: 'BUTTON', dataset: { drink: 'martini' } });
  assert.equal(app.open.martini, undefined);
});
