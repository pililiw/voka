// Replay tests/data/parity.json through the bundled engine (macos/Resources/engine.js) in a bare global scope.
//   node eval/host-smoke.cjs
// Optional args: <engine.js> <dict.json> <parity.json>
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const [bundle, dict, parity] = [
  process.argv[2] || path.join(root, 'macos/Resources/engine.js'),
  process.argv[3] || path.join(root, 'data/dict.json'),
  process.argv[4] || path.join(root, 'tests/data/parity.json'),
];
(0, eval)(fs.readFileSync(bundle, 'utf8'));
const L = globalThis.Voka;
const t0 = Date.now();
console.log('init:', L.init(fs.readFileSync(dict, 'utf8')), `(${Date.now() - t0} ms wall)`);

const KEY_NAMES = { '⌫': 'Backspace', '⏎': 'Enter', '⇥': 'Tab', '⎋': 'Escape', '→': 'ArrowRight', '←': 'ArrowLeft', '↓': 'ArrowDown', '↑': 'ArrowUp' };
function type(keys, doc) {
  const sid = L.newSession();
  const chars = [...keys];
  let preedit = '';
  for (let i = 0; i < chars.length; i++) {
    let key = KEY_NAMES[chars[i]] || chars[i];
    let alt = false;
    if (chars[i] === '⌥' && i + 1 < chars.length) { alt = true; key = chars[++i]; }
    const v = JSON.parse(L.key(sid, key, false, alt, false, false, doc));
    if (v.handled) {
      if (v.deleteBack) doc = doc.slice(0, doc.length - v.deleteBack);
      if (v.commit) doc += v.commit;
    }
    if ((!v.handled || v.passThrough) && !alt) {
      if (key.length === 1) doc += key;
      else if (key === 'Backspace') doc = doc.slice(0, -1);
      else if (key === 'Enter') doc += '\n';
      else if (key === 'Tab') doc += '\t';
    }
    preedit = v.preedit;
  }
  return doc + (preedit ? `⟦${preedit}⟧` : '');
}

const items = JSON.parse(fs.readFileSync(parity, 'utf8'));
let bad = 0;
let keysTyped = 0;
const t1 = Date.now();
for (const it of items) {
  const got = type(it.keys, it.before);
  keysTyped += it.keys.length;
  if (got !== it.expect) {
    bad++;
    if (bad <= 10) console.log(`MISMATCH keys=${JSON.stringify(it.keys.slice(0, 60))}\n   expect ${JSON.stringify(it.expect.slice(-80))}\n   got    ${JSON.stringify(got.slice(-80))}`);
  }
}
const ms = Date.now() - t1;
console.log(`parity: ${items.length - bad}/${items.length} identical · ${keysTyped} keys in ${ms} ms (${(ms / keysTyped).toFixed(2)} ms/key) · lastError=${JSON.stringify(L.lastError())}`);
process.exit(bad ? 1 : 0);
