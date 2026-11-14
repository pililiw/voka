// Render the README animation: docs/hero.svg and docs/hero.zh-CN.svg.
//
//   npm run build:engine && node scripts/readme/hero.mjs
//
// Each scene is typed key by key through the bundled engine; every frame shows what the engine returned
// for that key (the text so far, the word being typed, its candidates and their meanings). Where the
// language model has a say, its scores are the reference scores in tests/data/lm-fixtures.json. The
// script stops if a scene does not end in the expected text, so the animation cannot drift from the
// product.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
(0, eval)(fs.readFileSync(path.join(ROOT, 'macos/Resources/engine.js'), 'utf8'));
const voka = globalThis.Voka;
voka.init(fs.readFileSync(path.join(ROOT, 'data/dict.json'), 'utf8'));
const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/data/lm-fixtures.json'), 'utf8')).cases;

const SCENES = [
  { keys: 'I definately recomend this resturant. ', expect: 'I definitely recommend this restaurant. ',
    en: 'Hard words, spelled roughly', zh: '难拼的词，大概拼对就行' },
  { keys: 'Thx, the bhvr is exactly what I expectd. ', expect: 'Thanks, the behavior is exactly what I expected. ',
    en: 'Skip the vowels', zh: '只打辅音也认得' },
  { keys: 'Yesterday he go to a interview ', expect: 'Yesterday he went to an interview ',
    en: 'Small grammar slips, fixed as you type', zh: '顺手改掉基础语法' },
  { keys: 'Because of the bad wether ', expect: 'Because of the bad weather ', model: true,
    en: 'Local AI reads the sentence', zh: '本地 AI 读懂整句' },
  { keys: 'I recom⇥this infras⇥', expect: 'I recommend this infrastructure ',
    en: 'Tab finishes long words', zh: 'Tab 补全长词' },
  { keys: 'Refactor getUserProfile v2 on github for ios. ', expect: 'Refactor getUserProfile v2 on GitHub for iOS. ',
    en: 'Names and code are left alone', zh: '人名、术语和代码原样保留' },
];

// ---------- type the scenes through the engine ----------
function modelScores(before, words) {
  const hit = fixtures.find((c) => c.before === before && words.every((w) => c.words.includes(w)));
  return hit ? Object.fromEntries(hit.words.map((w, i) => [w, hit.scores[i]])) : null;
}

function play(scene) {
  const sid = voka.newSession();
  const frames = [];
  let segments = []; // committed text: { text, fixed }
  let usedModel = false;
  const doc = () => segments.map((s) => s.text).join('');
  const drop = (n) => {
    while (n > 0 && segments.length) {
      const last = segments[segments.length - 1];
      const cut = Math.min(n, last.text.length);
      last.text = last.text.slice(0, last.text.length - cut);
      n -= cut;
      if (!last.text) segments.pop();
    }
  };
  let typed = '';
  // True while the model's scores have changed what Space commits for the word being typed.
  let modelLeads = false;
  for (const ch of scene.keys) {
    const key = ch === '⇥' ? 'Tab' : ch;
    const before = doc();
    const decidedByModel = modelLeads;
    let view = JSON.parse(voka.key(sid, key, false, false, false, false, before));
    modelLeads = false;
    if (view.lm) {
      const scores = modelScores(before, view.lm);
      if (scores) {
        const rescored = JSON.parse(voka.rescore(sid, JSON.stringify(scores)));
        modelLeads = rescored.candidates[0].word !== view.candidates[0].word;
        view = rescored;
      }
    }
    let fixed = false;
    if (view.handled && view.commit !== null) {
      const changed = view.deleteBack > 0 || view.commit.trim() !== typed;
      if (view.deleteBack) drop(view.deleteBack);
      const word = view.commit.replace(/\s+$/, '');
      if (word) segments.push({ text: word, fixed: changed });
      if (view.commit.length > word.length) segments.push({ text: view.commit.slice(word.length), fixed: false });
      fixed = changed;
    }
    if (!view.handled || view.passThrough) segments.push({ text: ch, fixed: false });
    typed = view.preedit;
    const special = key === 'Tab' ? 'Tab' : key === ' ' && fixed ? 'Space' : null;
    if (special === 'Space' && decidedByModel) usedModel = true;
    frames.push({
      segments: segments.map((s) => ({ ...s })),
      preedit: view.preedit,
      candidates: view.show ? view.candidates.slice(0, 5) : [],
      selected: view.selected,
      tabIndex: view.tabIndex,
      keycap: special,
      byModel: special === 'Space' && decidedByModel,
      hold: special ? 700 : 78 + ((frames.length * 37) % 34),
    });
  }
  voka.endSession(sid);
  if (doc() !== scene.expect) throw new Error(`scene "${scene.en}" ended in ${JSON.stringify(doc())}, expected ${JSON.stringify(scene.expect)}`);
  if (scene.model && !usedModel) throw new Error(`scene "${scene.en}" was not decided by the model`);
  frames[frames.length - 1].hold = 1900;
  frames[frames.length - 1].final = true;
  return frames;
}

// ---------- drawing ----------
const W = 1000;
const H = 372;
const C = { bg: '#03080a', deep: '#081317', raised: '#0c1a1f', line: '#1c3238', porcelain: '#f2f9f7', celadon: '#c4d8d4',
  mist: '#8aa3a7', dim: '#5d7479', glaze: '#6fd3e4', glazeDeep: '#2f8fa3' };
const MONO = `'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace`;
const SANS = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Width of text set in a monospaced face: Latin cells are 0.6 em, CJK cells 1 em. */
const width = (s, size) => [...s].reduce((sum, ch) => sum + (ch.codePointAt(0) > 0x2e7f ? size : size * 0.6), 0);
/** Text with its width fixed, so the layout does not depend on the fonts of whoever views it. */
const text = (x, y, s, size, fill, extra = '') =>
  s ? `<text x="${x.toFixed(1)}" y="${y}" font-size="${size}" fill="${fill}" textLength="${width(s, size).toFixed(1)}" lengthAdjust="spacingAndGlyphs"${extra}>${esc(s).replace(/ /g, '&#160;')}</text>` : '';

const MARGIN = 60;
const LINE = { x: MARGIN, y: 162, size: 31 };
const BAR = { y: 198, h: 58, pad: 10, gap: 6 };

function drawFrame(frame, scene, lang) {
  let out = '';
  let x = LINE.x;
  for (const seg of frame.segments) {
    out += text(x, LINE.y, seg.text, LINE.size, seg.fixed ? C.glaze : C.porcelain);
    x += width(seg.text, LINE.size);
  }
  const preeditX = x;
  if (frame.preedit) {
    const w = width(frame.preedit, LINE.size);
    out += text(x, LINE.y, frame.preedit, LINE.size, C.celadon);
    out += `<rect x="${x.toFixed(1)}" y="${LINE.y + 9}" width="${w.toFixed(1)}" height="2" rx="1" fill="${C.glazeDeep}"/>`;
    x += w;
  }
  out += `<rect class="caret" x="${(x + 2).toFixed(1)}" y="${LINE.y - 27}" width="2.5" height="34" rx="1" fill="${C.glaze}"/>`;

  if (frame.candidates.length) {
    const pills = frame.candidates.map((c, i) => {
      const selected = i === frame.selected;
      const gloss = selected ? c.gloss : c.gloss.split('；')[0];
      const mark = selected ? (lang === 'zh' ? '空格' : 'Space') : i === frame.tabIndex ? 'Tab' : '';
      const parts = [
        { s: String(i + 1), size: 13, role: 'num' },
        { s: c.word, size: 19, role: 'word' },
        { s: gloss, size: 14, role: 'gloss' },
        { s: mark, size: 12, role: 'mark' },
      ].filter((p) => p.s);
      parts.forEach((p, k) => { p.gap = k === parts.length - 1 ? 0 : p.role === 'gloss' ? 11 : 9; });
      const w = parts.reduce((sum, p) => sum + width(p.s, p.size) + p.gap, 0) + 24;
      return { parts, w, selected };
    });
    // As many candidates as fit the card.
    const span = () => pills.reduce((sum, p) => sum + p.w, 0) + BAR.gap * (pills.length - 1) + BAR.pad * 2;
    while (pills.length > 1 && span() > W - 2 * MARGIN + 20) pills.pop();
    const total = span();
    const bx = Math.max(LINE.x - 10, Math.min(preeditX - 14, W - MARGIN + 10 - total));
    out += `<rect x="${bx.toFixed(1)}" y="${BAR.y}" width="${total.toFixed(1)}" height="${BAR.h}" rx="15" fill="${C.raised}" stroke="${C.line}"/>`;
    let px = bx + BAR.pad;
    for (const pill of pills) {
      if (pill.selected) out += `<rect x="${px.toFixed(1)}" y="${BAR.y + 9}" width="${pill.w.toFixed(1)}" height="${BAR.h - 18}" rx="9" fill="${C.glaze}"/>`;
      let tx = px + 12;
      for (const p of pill.parts) {
        const fill = pill.selected
          ? p.role === 'word' ? C.bg : '#0f4a57'
          : p.role === 'word' ? C.porcelain : p.role === 'gloss' ? C.mist : p.role === 'mark' ? C.glaze : C.dim;
        const weight = p.role === 'word' ? ' font-weight="600"' : '';
        out += text(tx, BAR.y + 36, p.s, p.size, fill, weight);
        tx += width(p.s, p.size) + p.gap;
      }
      px += pill.w + BAR.gap;
    }
  }

  if (frame.keycap) {
    const key = frame.keycap === 'Space' && lang === 'zh' ? '空格' : frame.keycap;
    const label = frame.byModel ? `${key} · ${lang === 'zh' ? '本地 AI' : 'Local AI'}` : key;
    const w = width(label, 16) + 30;
    out += `<rect x="${(W - MARGIN - w).toFixed(1)}" y="${H - 72}" width="${w.toFixed(1)}" height="36" rx="9" fill="${C.deep}" stroke="${C.glazeDeep}"/>`;
    out += text(W - MARGIN - w + 15, H - 48, label, 16, C.glaze);
  }
  if (frame.final) {
    const typed = scene.keys.trim();
    const label = lang === 'zh' ? '输入的是' : 'you typed';
    out += `<text class="s" x="${LINE.x}" y="${H - 48}" font-size="16" fill="${C.dim}">${esc(label)}</text>`;
    out += text(LINE.x + (lang === 'zh' ? 78 : 84), H - 48, typed, 16, C.mist);
  }
  return out;
}

function render(lang) {
  const scenes = SCENES.map((scene) => ({ scene, frames: play(scene) }));
  const total = scenes.reduce((sum, s) => sum + 450 + s.frames.reduce((t, f) => t + f.hold, 0), 0);
  const pct = (ms) => ((100 * ms) / total).toFixed(3);
  let css = '';
  let body = '';
  let clock = 0;
  let id = 0;
  const show = (start, end, content) => {
    const name = `f${id++}`;
    // Visible for [start, end) of the loop.
    css += `@keyframes ${name}{0%,${pct(start)}%{visibility:hidden}${pct(start)}%,${pct(end)}%{visibility:visible}${pct(end)}%,100%{visibility:hidden}}`;
    body += `<g style="animation:${name} ${total}ms steps(1,end) infinite">${content}</g>\n`;
  };
  scenes.forEach(({ scene, frames }, index) => {
    const start = clock;
    // An empty line with the caret before the first key.
    show(clock, clock + 450, drawFrame({ segments: [], preedit: '', candidates: [] }, scene, lang));
    clock += 450;
    for (const frame of frames) {
      show(clock, clock + frame.hold, drawFrame(frame, scene, lang));
      clock += frame.hold;
    }
    const title = lang === 'zh' ? scene.zh : scene.en;
    let head = `<text x="${LINE.x}" y="70" font-size="15" letter-spacing="1.5" fill="${C.glaze}">0${index + 1}</text>`;
    head += `<text class="s" x="${LINE.x + 38}" y="70" font-size="20" font-weight="600" fill="${C.porcelain}">${esc(title)}</text>`;
    SCENES.forEach((_, dot) => {
      head += `<rect x="${W - MARGIN - (SCENES.length - dot) * 24 + 8}" y="61" width="16" height="5" rx="2.5" fill="${dot === index ? C.glaze : C.line}"/>`;
    });
    show(start, clock, head);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${
    lang === 'zh' ? 'Voka 演示：边输入边把拼错或没打完的词变成正确的英文' : 'Voka demo: misspelled and unfinished words become correct English as they are typed'
  }">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.deep}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
<radialGradient id="glow" cx="0.82" cy="0.05" r="0.75"><stop offset="0" stop-color="${C.glaze}" stop-opacity="0.16"/><stop offset="1" stop-color="${C.glaze}" stop-opacity="0"/></radialGradient>
</defs>
<style>
text{font-family:${MONO}}
.s{font-family:${SANS}}
.caret{animation:blink 1.06s steps(1,end) infinite}
@keyframes blink{0%,55%{opacity:1}55%,100%{opacity:0}}
${css}
</style>
<rect width="${W}" height="${H}" rx="22" fill="url(#bg)"/>
<rect width="${W}" height="${H}" rx="22" fill="url(#glow)"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="21.5" fill="none" stroke="${C.line}"/>
<line x1="${MARGIN}" y1="98" x2="${W - MARGIN}" y2="98" stroke="${C.line}"/>
${body}</svg>
`;
}

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
for (const [lang, file] of [['en', 'hero.svg'], ['zh', 'hero.zh-CN.svg']]) {
  const svg = render(lang);
  fs.writeFileSync(path.join(ROOT, 'docs', file), svg);
  console.log(`docs/${file}: ${(svg.length / 1024).toFixed(0)} KB`);
}
