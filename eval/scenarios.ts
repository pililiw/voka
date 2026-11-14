// Scenario evaluation: does typing with Voka give people what they meant, across kinds of text, kinds of
// typist and ways of using it?
//   bash eval/run.sh eval/scenarios.ts            summary tables
//   bash eval/run.sh eval/scenarios.ts -v         + every unexpected outcome, grouped
//   bash eval/run.sh eval/scenarios.ts -n 40      lines per genre (default: all)
//
// Every sentence exists as INTENDED tokens (what the person means) and TYPED tokens (what their fingers
// produce). It is typed key by key through a real session; the document that results is compared with the
// intention, word by word:
//   ok       typed right, came out right
//   norm     typed right, came out differing only in capitalisation / apostrophe (i -> I, dont -> don't)
//   DAMAGE   typed right, came out as something else            <- the engine broke correct text
//   fixed    typed wrong, came out as intended                  <- the engine helped
//   left     typed wrong, came out as typed                     (no surprise; "tab" = Tab had the intended word)
//   WRONG    typed wrong, came out as a third thing             <- a wrong "correction"
// surprise = DAMAGE + WRONG: the engine changed text into something the person did not mean.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, engine } from './harness';
import { ImeSessionController } from '../src/engine/session';
import { FIX } from './sets';

const args = process.argv.slice(2);
const verbose = args.includes('-v');
// Parallel runs (see scenarios.sh): --shard i/n types every n-th sentence variant and --dump writes the raw
// counts; --merge reads such dumps back and prints the report.
const argOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const SHARD = (argOf('--shard') ?? '0/1').split('/').map(Number) as [number, number];
const DUMP = argOf('--dump');
const MERGE = args.includes('--merge') ? args.slice(args.indexOf('--merge') + 1).filter((a) => !a.startsWith('-')) : null;
const LIMIT = args.includes('-n') ? Number(args[args.indexOf('-n') + 1]) : Infinity;
const DIR = path.join(ROOT, 'tests/data/scenarios');

// ---------- deterministic randomness ----------
let seed = 20261114;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

// ---------- data ----------
interface Item { genre: string; persona: string; typed: string[]; intended: string[] }

function readLines(file: string): string[] {
  const p = path.join(DIR, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()) : [];
}
const GENRES: [string, string[]][] = [
  ['news', readLines('news.txt')],
  ['article', readLines('article.txt')],
  ['academic', readLines('academic.txt')],
  ['email', readLines('email.txt')],
  ['work-chat', readLines('work-chat.txt')],
  ['dev', readLines('dev.txt')],
  ['im', readLines('im.txt')],
  ['social', readLines('social.txt')],
];

// Common misspellings: right -> wrongs (non-words only).
const humanWrongs = new Map<string, string[]>();
for (const [wrong, right] of Object.entries(FIX)) {
  if (engine.lexicon.exactMap.has(wrong)) continue;
  if (!humanWrongs.has(right)) humanWrongs.set(right, []);
  humanWrongs.get(right)!.push(wrong);
}

// ---------- personas: how the fingers distort the intention ----------
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function neighbourKey(c: string): string {
  for (const row of ROWS) {
    const i = row.indexOf(c);
    if (i >= 0) return rnd() < 0.5 ? row[i - 1] ?? row[i + 1] : row[i + 1] ?? row[i - 1];
  }
  return c;
}
/** One realistic slip of the hand (independent of the engine's own slip model). */
function slip(w: string): string {
  const i = 1 + Math.floor(rnd() * (w.length - 1)); // rarely the first letter
  const r = rnd();
  if (r < 0.28 && i < w.length - 1 && w[i] !== w[i + 1]) return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2); // swap
  if (r < 0.56) return w.slice(0, i) + w.slice(i + 1); // dropped letter
  if (r < 0.80) return w.slice(0, i) + neighbourKey(w[i]) + w.slice(i + 1); // neighbouring key
  if (r < 0.90) return w.slice(0, i) + w[i] + w.slice(i); // doubled
  return w.slice(0, i) + neighbourKey(w[i]) + w.slice(i); // brushed an extra key
}
const CORE = /^([("']*)([A-Za-z]+(?:'[a-z]+)?)([)"'.,!?;:]*)$/;

type Persona = (tokens: string[]) => string[];
const PERSONAS: [string, Persona][] = [
  ['careful', (t) => t.slice()],
  // fast touch typist: about one word in 22 gets a slip of the hand
  ['fast', (t) => t.map((tok) => {
    const m = CORE.exec(tok);
    if (!m || m[2].length < 3 || !/^[a-z]+$/.test(m[2]) || rnd() > 0.045) return tok;
    for (let k = 0; k < 4; k++) {
      const s = slip(m[2]);
      if (s !== m[2] && s.length >= 2 && !engine.lexicon.exactMap.has(s) && engine.lexicon.known.tier(s) < 2) return m[1] + s + m[3];
    }
    return tok;
  })],
  // shaky speller: commonly misspelled words, misspelled the common way
  ['speller', (t) => {
    let budget = 2;
    const order = t.map((_, i) => i).sort(() => rnd() - 0.5);
    const out = t.slice();
    for (const i of order) {
      if (!budget) break;
      const m = CORE.exec(t[i]);
      if (!m || !humanWrongs.has(m[2])) continue;
      out[i] = m[1] + pick(humanWrongs.get(m[2])!) + m[3];
      budget--;
    }
    return out;
  }],
  // lazy chatter: no shift key, no apostrophes
  ['lazy', (t) => t.map((tok, i) => {
    let s = tok;
    if (i === 0 && /^[A-Z][a-z]/.test(s)) s = s[0].toLowerCase() + s.slice(1);
    s = s.replace(/^I('|$|[.,!?])/, (_, a) => 'i' + a);
    if (/^[A-Za-z]+'(t|s|re|ve|ll|d|m)\b/.test(s) && rnd() < 0.7) s = s.replace("'", '');
    return s;
  })],
];

// ---------- typing ----------
type Style = 'space' | 'tab' | 'enter';
interface Typed { out: string; tabHad: boolean[] }

/** Type the tokens with one session. `tab`: an attentive user takes Tab when it offers exactly what they mean. */
function typeTokens(typed: string[], intended: string[], style: Style): Typed {
  const s = new ImeSessionController(engine);
  let doc = '';
  const tabHad: boolean[] = typed.map(() => false);
  const feed = (key: string) => {
    const name = key === '\n' ? 'Enter' : key === '\t' ? 'Tab' : key;
    const r = s.handleKeyDown({ key: name }, doc, false);
    if (r.handled) {
      if (r.deleteBackChars) doc = doc.slice(0, doc.length - r.deleteBackChars);
      if (r.commitText) doc += r.commitText;
    }
    if (!r.handled || r.passThrough) {
      if (name.length === 1) doc += name;
      else if (name === 'Enter') doc += '\n';
      else if (name === 'Tab') doc += '\t';
    }
  };
  for (let i = 0; i < typed.length; i++) {
    const want = (CORE.exec(intended[i])?.[2] ?? intended[i]);
    const chars = [...typed[i], i === typed.length - 1 && style === 'enter' ? '\n' : ' '];
    let skipSpace = false;
    for (let k = 0; k < chars.length; k++) {
      const ch = chars[k];
      const commits = !/[A-Za-z0-9']/.test(ch);
      if (commits && s.preedit) {
        const res = s.lastQueryResult;
        const tabIdx = s.tabTargetIndex;
        const spaceWord = res?.candidates[s.selectedIndex]?.word;
        const tabWord = tabIdx >= 0 ? res?.candidates[tabIdx]?.word : undefined;
        if (tabWord === want && spaceWord !== want) {
          tabHad[i] = true;
          if (style === 'tab') {
            feed('\t'); // commits the suggestion and adds its own space
            if (ch === ' ') { skipSpace = true; continue; }
          }
        }
      }
      if (ch === ' ' && skipSpace) continue;
      feed(ch);
    }
  }
  return { out: doc, tabHad };
}

// ---------- scoring ----------
/** Case, apostrophes and British / American spelling do not make two words different. */
const plain = (w: string) =>
  w.toLowerCase().replace(/'/g, '').replace(/is(e|es|ed|ing|ation|ations)\b/g, 'iz$1').replace(/ys(e|es|ed|ing)\b/g, 'yz$1').replace(/our/g, 'or');
const benign = (a: string, b: string) => plain(a) === plain(b);
// Shorthand the engine expands by design (`thx` -> thanks) is counted on its own line, not as damage.
const SHORTHAND = new Set(['tmrw', 'tmr', 'ystd', 'pls', 'plz', 'thx', 'bc', 'bcz', 'wld', 'shld', 'cld']);
const isShorthand = (typed: string) => SHORTHAND.has(typed.toLowerCase().replace(/[^a-z]/g, ''));
interface Cell { words: number; ok: number; norm: number; expand: number; damage: number; typos: number; fixed: number; left: number; leftTab: number; wrong: number; sent: number; sentIntended: number; sentNoSurprise: number; misaligned: number }
const newCell = (): Cell => ({ words: 0, ok: 0, norm: 0, expand: 0, damage: 0, typos: 0, fixed: 0, left: 0, leftTab: 0, wrong: 0, sent: 0, sentIntended: 0, sentNoSurprise: 0, misaligned: 0 });
const cells = new Map<string, Cell>();
const cell = (k: string) => cells.get(k) ?? (cells.set(k, newCell()), cells.get(k)!);
const surprises = new Map<string, { n: number; where: Set<string>; ctx: string }>();
const lefts = new Map<string, { n: number; tab: boolean }>();

function score(item: Item, style: Style): void {
  const { out, tabHad } = typeTokens(item.typed, item.intended, style);
  const got = out.replace(/\n$/, '').trimEnd().split(' ');
  const keys = [`${item.genre}|${item.persona}|${style}`, `ALL|${item.persona}|${style}`, `${item.genre}|ALL|${style}`];
  const cs = keys.map(cell);
  for (const c of cs) c.sent++;
  if (got.length !== item.intended.length) {
    for (const c of cs) c.misaligned++;
    const k = `MISALIGNED  ${item.typed.join(' ').slice(0, 70)} → ${out.trim().slice(0, 70)}`;
    surprises.set(k, { n: 1, where: new Set([item.genre]), ctx: '' });
    return;
  }
  let intendedAll = true;
  let surprise = false;
  for (let i = 0; i < got.length; i++) {
    const t = item.typed[i], w = item.intended[i], o = got[i];
    for (const c of cs) c.words++;
    let kind: 'ok' | 'norm' | 'expand' | 'damage' | 'fixed' | 'left' | 'wrong';
    if (t === w) kind = o === w ? 'ok' : benign(o, w) ? 'norm' : isShorthand(t) ? 'expand' : 'damage';
    else kind = o === w || benign(o, w) ? 'fixed' : o === t ? 'left' : 'wrong';
    for (const c of cs) {
      if (t !== w) c.typos++;
      if (kind === 'left') { c.left++; if (tabHad[i]) c.leftTab++; }
      else (c as unknown as Record<string, number>)[kind]++;
    }
    if (kind === 'damage' || kind === 'wrong') {
      surprise = true;
      const k = `${kind.toUpperCase().padEnd(6)} ${t}${t === w ? '' : ` (meant ${w})`} → ${o}`;
      const e = surprises.get(k) ?? { n: 0, where: new Set<string>(), ctx: item.typed.slice(Math.max(0, i - 3), i).join(' ') };
      e.n++; e.where.add(`${item.genre}/${item.persona}`);
      surprises.set(k, e);
    }
    if (kind === 'left' && style === 'space') {
      const k = `${t} (meant ${w})`;
      const e = lefts.get(k) ?? { n: 0, tab: tabHad[i] };
      e.n++; lefts.set(k, e);
    }
    if (kind !== 'ok' && kind !== 'fixed' && kind !== 'norm' && kind !== 'expand') intendedAll = false;
  }
  for (const c of cs) { if (intendedAll) c.sentIntended++; if (!surprise) c.sentNoSurprise++; }
}

// ---------- build items ----------
const items: Item[] = [];
for (const [genre, lines] of GENRES) {
  for (const line of lines.slice(0, LIMIT)) {
    const intended = line.split(' ');
    for (const [persona, distort] of PERSONAS) {
      const typed = distort(intended);
      if (persona !== 'careful' && typed.join(' ') === intended.join(' ')) continue; // nothing to distort here
      items.push({ genre, persona, typed, intended });
    }
  }
}
const learner = readLines('learner.tsv').map((l) => l.split('\t')).filter((f) => f.length === 5 && f[3].split(' ').length === f[4].split(' ').length);
for (const [level, l1, , typed, intended] of learner) {
  items.push({ genre: `L1:${l1}`, persona: `learner-${level}`, typed: typed.split(' '), intended: intended.split(' ') });
}

const t0 = Date.now();
if (MERGE) {
  for (const file of MERGE) {
    const d = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      cells: [string, Cell][]; surprises: [string, { n: number; where: string[]; ctx: string }][]; lefts: [string, { n: number; tab: boolean }][];
    };
    for (const [k, c] of d.cells) { const t = cell(k) as unknown as Record<string, number>; for (const [f, v] of Object.entries(c)) t[f] += v as number; }
    for (const [k, e] of d.surprises) { const t = surprises.get(k) ?? { n: 0, where: new Set<string>(), ctx: e.ctx }; t.n += e.n; e.where.forEach((w) => t.where.add(w)); surprises.set(k, t); }
    for (const [k, e] of d.lefts) { const t = lefts.get(k) ?? { n: 0, tab: e.tab }; t.n += e.n; lefts.set(k, t); }
  }
} else {
  items.forEach((it, idx) => {
    if (idx % SHARD[1] !== SHARD[0]) return;
    score(it, 'space');
    if (it.persona !== 'careful' && it.persona !== 'lazy') score(it, 'tab');
    if (['im', 'work-chat', 'social'].includes(it.genre) || it.genre.startsWith('L1:')) score(it, 'enter');
  });
  if (DUMP) {
    fs.writeFileSync(DUMP, JSON.stringify({
      cells: [...cells],
      surprises: [...surprises].map(([k, e]) => [k, { n: e.n, where: [...e.where], ctx: e.ctx }]),
      lefts: [...lefts],
    }));
    process.exit(0);
  }
}

// ---------- report ----------
const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1).padStart(5) + '%' : '    - ');
const per1k = (a: number, b: number) => (b ? ((1000 * a) / b).toFixed(1).padStart(5) : '    -');
function row(label: string, c: Cell): string {
  return `${label.padEnd(26)} ${String(c.sent).padStart(4)} sent ${String(c.words).padStart(6)} words | surprise/1k ${per1k(c.damage + c.wrong, c.words)} (damage ${String(c.damage).padStart(3)}, wrong ${String(c.wrong).padStart(3)})${c.expand ? ` +${c.expand} shorthand expanded` : ''} | typos ${String(c.typos).padStart(4)}: fixed ${pct(c.fixed, c.typos)} left ${pct(c.left, c.typos)} (Tab had ${pct(c.leftTab, c.typos)}) wrong ${pct(c.wrong, c.typos)} | sentences: no surprise ${pct(c.sentNoSurprise, c.sent)} as intended ${pct(c.sentIntended, c.sent)}${c.misaligned ? ` | misaligned ${c.misaligned}` : ''}`;
}
const section = (title: string, filter: (k: string) => boolean, label: (k: string) => string) => {
  console.log(`\n== ${title}`);
  for (const [k, c] of [...cells].filter(([k]) => filter(k)).sort()) console.log(row(label(k), c));
};
console.log(`${items.length} sentence variants, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
section('by typist, Space only (all genres)', (k) => k.startsWith('ALL|') && k.endsWith('|space'), (k) => k.split('|')[1]);
section('by typist, attentive (takes Tab when it shows the intended word)', (k) => k.startsWith('ALL|') && k.endsWith('|tab'), (k) => k.split('|')[1]);
section('by typist, message sent with Enter', (k) => k.startsWith('ALL|') && k.endsWith('|enter'), (k) => k.split('|')[1]);
section('learners by level, Space only', (k) => k.startsWith('ALL|learner') && k.endsWith('|space'), (k) => k.split('|')[1]);
section('learners by first language, Space only', (k) => k.startsWith('L1:') && k.includes('|ALL|space'), (k) => k.split('|')[0]);
section('by genre, all typists, Space only', (k) => k.includes('|ALL|space') && !k.startsWith('L1:'), (k) => k.split('|')[0]);
section('correct text only (careful typist), by genre', (k) => k.includes('|careful|space') && !k.startsWith('ALL'), (k) => k.split('|')[0]);

const top = [...surprises].sort((a, b) => b[1].n - a[1].n);
console.log(`\n== unexpected outcomes: ${top.length} distinct (${top.reduce((s, [, e]) => s + e.n, 0)} occurrences over all runs)`);
for (const [k, e] of top.slice(0, verbose ? 400 : 45)) console.log(`  ${String(e.n).padStart(3)}× ${k}   [${[...e.where].slice(0, 3).join(', ')}]${e.ctx ? `  …${e.ctx}` : ''}`);
const topLeft = [...lefts].sort((a, b) => b[1].n - a[1].n);
console.log(`\n== typos left as typed (Space only): ${topLeft.length} distinct`);
for (const [k, e] of topLeft.slice(0, verbose ? 300 : 40)) console.log(`  ${String(e.n).padStart(3)}× ${k}${e.tab ? '   (Tab had it)' : ''}`);
