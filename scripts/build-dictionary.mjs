import fs from 'node:fs';
import path from 'node:path';
import { dictionary as cmuDict } from 'cmu-pronouncing-dictionary';
import pluralize from 'pluralize';
import irregularPlurals from 'irregular-plurals';

/**
 * Dictionary compiler: builds `data/dict.json` from the sources in `scripts/raw/`, `scripts/lexicon/` and a few npm data packages.
 *
 * Inflections are taken from data rather than derived by suffix rules:
 *   1. UniMorph English (`scripts/raw/unimorph.eng.tsv`): verb paradigms and noun countability
 *   2. WordNet (`wordnet-db`): parts of speech and SemCor sense-tag counts
 *   3. `scripts/lexicon/irregular-verbs.tsv`: the past forms of the common irregular verbs
 *   4. `irregular-plurals`, `pluralize` and the word counts in `scripts/raw/word-counts.tsv`
 *
 * The `morphology` section of the output:
 *   - `verbs`: { lemma: [past, pastParticiple, thirdSingular, presentParticiple, isPureVerb] }
 *   - `plurals`: { singular: plural } (`person` -> `people`, `criterion` -> `criteria`)
 *   - `inflectionToLemma`: { inflectedForm: lemma }
 *   - `pastVerbs`: past-tense verb forms, used to recognise a clause that is in the past
 */

const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, 'scripts/raw');
const LEXICON_DIR = path.join(ROOT, 'scripts/lexicon');
const OUT_FILE = path.join(ROOT, 'data/dict.json');

const FLAG_CORE = 1;
const FLAG_VOWEL = 2;
const FLAG_NO_SUGGEST = 4;
const FLAG_POS_VERB = 8;
const FLAG_POS_NOUN = 16;
const FLAG_POS_ADJ = 32;
const FLAG_POS_ADV = 64;

function dedup(str) {
  if (str.length <= 1) return str;
  let out = str[0];
  for (let i = 1; i < str.length; i++) {
    if (str[i] !== str[i - 1]) out += str[i];
  }
  return out;
}

function isArpabetVowel(token) {
  if (!token) return false;
  return /^(AA|AE|AH|AO|AW|AX|AY|EH|ER|AXR|EY|IH|IX|IY|OW|OY|UH|UW)$/.test(token);
}

function arpabetToPhonetic(arpabet) {
  const tokens = arpabet
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[0-9]/g, ''));

  let coarse = '';
  let altCoarse = '';
  let fine = '';
  let startsWithVowel = false;

  for (let i = 0; i < tokens.length; i++) {
    const p = tokens[i];
    const isFirst = i === 0;
    switch (p) {
      case 'AA': case 'AE': case 'AH': case 'AO': case 'AW': case 'AX':
        if (isFirst) { startsWithVowel = true; coarse += 'A'; altCoarse += 'A'; }
        fine += 'a'; break;
      case 'AY':
        if (isFirst) { startsWithVowel = true; coarse += 'A'; altCoarse += 'A'; }
        fine += 'ay'; break;
      case 'EH': case 'EY':
        if (isFirst) { startsWithVowel = true; coarse += 'A'; altCoarse += 'A'; }
        fine += 'e'; break;
      case 'IH': case 'IY': case 'IX':
        if (isFirst) { startsWithVowel = true; coarse += 'A'; altCoarse += 'A'; }
        fine += 'i'; break;
      case 'OW': case 'OY': case 'UH': case 'UW':
        if (isFirst) { startsWithVowel = true; coarse += 'A'; altCoarse += 'A'; }
        fine += 'u'; break;
      case 'ER': case 'AXR':
        if (isFirst) { startsWithVowel = true; coarse += 'AR'; altCoarse += 'A'; }
        else {
          coarse += 'R';
          altCoarse += (i === tokens.length - 1 || !isArpabetVowel(tokens[i + 1])) ? '' : 'R';
        }
        fine += 'er'; break;
      case 'Y':
        if (isFirst) { coarse += 'Y'; altCoarse += 'A'; }
        fine += 'y'; break;
      case 'W':
        coarse += 'W'; altCoarse += 'V'; fine += 'w'; break;
      case 'HH':
        if (isFirst) { coarse += 'H'; altCoarse += 'H'; fine += 'h'; }
        break;
      case 'B': coarse += 'B'; altCoarse += 'B'; fine += 'b'; break;
      case 'P': coarse += 'P'; altCoarse += 'P'; fine += 'p'; break;
      case 'M': coarse += 'M'; altCoarse += 'M'; fine += 'm'; break;
      case 'F': coarse += 'F'; altCoarse += 'F'; fine += 'f'; break;
      case 'V': coarse += 'V'; altCoarse += 'V'; fine += 'v'; break;
      case 'T': coarse += 'T'; altCoarse += 'T'; fine += 't'; break;
      case 'D': coarse += 'D'; altCoarse += 'D'; fine += 'd'; break;
      case 'TH': coarse += 'T'; altCoarse += 'S'; fine += 's'; break;
      case 'DH': coarse += 'D'; altCoarse += 'S'; fine += 'z'; break;
      case 'S': coarse += 'S'; altCoarse += 'S'; fine += 's'; break;
      case 'Z': coarse += 'S'; altCoarse += 'S'; fine += 'z'; break;
      case 'SH': coarse += 'S'; altCoarse += 'C'; fine += 's'; break;
      case 'CH': coarse += 'C'; altCoarse += 'S'; fine += 'c'; break;
      case 'JH': case 'ZH': coarse += 'J'; altCoarse += 'S'; fine += 'j'; break;
      case 'K': coarse += 'K'; altCoarse += 'K'; fine += 'k'; break;
      case 'G': coarse += 'G'; altCoarse += 'J'; fine += 'g'; break;
      case 'N': case 'NG': coarse += 'N'; altCoarse += 'N'; fine += 'n'; break;
      case 'L': coarse += 'L'; altCoarse += 'L'; fine += 'l'; break;
      case 'R': coarse += 'R'; altCoarse += 'R'; fine += 'r'; break;
    }
  }
  return {
    coarse: dedup(coarse),
    altCoarse: dedup(altCoarse),
    fine: dedup(fine),
    startsWithVowel,
  };
}

const BRITISH_ALT_COARSE = {
  schedule: 'SJL',
  schedules: 'SJLS',
  scheduled: 'SJLD',
  scheduling: 'SJLN',
  privacy: 'PRVS',
  lieutenant: 'LFTNNT',
  clerk: 'KLK',
  herb: 'HB',
  garage: 'GRJ',
};

function parsePosFlagsFromText(posText) {
  if (!posText) return 0;
  let mask = 0;
  if (/(^|[^a-z])(v|vt|vi)\b/i.test(posText)) mask |= FLAG_POS_VERB;
  if (/(^|[^a-z])n\b/i.test(posText)) mask |= FLAG_POS_NOUN;
  if (/(^|[^a-z])(adj|a)\b/i.test(posText)) mask |= FLAG_POS_ADJ;
  if (/(^|[^a-z])(adv|ad)\b/i.test(posText)) mask |= FLAG_POS_ADV;
  return mask;
}

// --- Linguistic sources: word counts, WordNet, UniMorph, irregular verbs ---
const wordCount = new Map();
// scripts/raw/word-counts.tsv (see build-word-counts.mjs): word, how common it is, how often it is seen
// in subtitles; both per 50 million words. `wordCount` ranks words; `seenCount` is the evidence that a
// token is a word, and below RARE it only says that the token has occurred.
const RARE = 4;
// A token that only the written counts have must occur this often to be taken for a word.
const WRITTEN_ONLY = 20;
const seenCount = new Map();
for (const line of fs.readFileSync(path.join(RAW_DIR, 'word-counts.tsv'), 'utf8').split('\n')) {
  const [word, count, seen] = line.split('\t');
  if (!word || !/^[a-z]+$/.test(word)) continue;
  if (Number(count) >= RARE) wordCount.set(word, Number(count));
  if (Number(seen) >= 1) seenCount.set(word, Number(seen));
}
function loadWordNetIndex(file) {
  const m = new Map();
  const full = path.join(ROOT, 'node_modules/wordnet-db/dict', file);
  if (!fs.existsSync(full)) return m;
  for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const parts = line.split(' ');
    const w = parts[0];
    if (!/^[a-z]+$/.test(w)) continue;
    const synsets = Number(parts[2] || 0);
    const pCnt = Number(parts[3] || 0);
    const tagCnt = Number(parts[4 + pCnt + 1] || 0);
    m.set(w, { synsets, tagCnt });
  }
  return m;
}

const wnVerb = loadWordNetIndex('index.verb');
const wnNoun = loadWordNetIndex('index.noun');
const wnAdj = loadWordNetIndex('index.adj');
const wnAdv = loadWordNetIndex('index.adv');

// The source that is not an npm package. Without it the result would be a different, smaller
// dictionary, so the build stops instead of quietly replacing data/dict.json.
if (!fs.existsSync(path.join(RAW_DIR, 'unimorph.eng.tsv'))) {
  console.error('Missing scripts/raw/unimorph.eng.tsv (the file `eng` of https://github.com/unimorph/eng). See CONTRIBUTING.md, "Dictionary".');
  process.exit(1);
}

const unimorphVerbs = new Map(); // lemma -> { pst: Set, ptcp: Set, prs3: Set, vbg: Set }
const uniPlurals = new Map();    // lemma -> Set
const uniAllForms = new Map();   // lemma -> Set of every attested inflected form (for the known-token tiers)
const uniUncountable = new Set();
const unimorphPath = path.join(RAW_DIR, 'unimorph.eng.tsv');
if (fs.existsSync(unimorphPath)) {
  for (const line of fs.readFileSync(unimorphPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [lemma, form, feats] = line.split('\t');
    if (!lemma || !form || !feats) continue;
    const l = lemma.toLowerCase();
    if (!/^[a-z]+$/.test(l)) continue;

    if (/^[a-z]+$/i.test(form) && form !== 'countable' && form !== 'uncountable') {
      const lf = form.toLowerCase();
      if (lf !== l) {
        let set = uniAllForms.get(l);
        if (!set) uniAllForms.set(l, (set = new Set()));
        set.add(lf);
      }
    }

    if (feats.startsWith('V;') && /^[a-z]+$/i.test(form)) {
      let v = unimorphVerbs.get(l);
      if (!v) {
        v = { pst: new Set(), ptcp: new Set(), prs3: new Set(), vbg: new Set() };
        unimorphVerbs.set(l, v);
      }
      const f = form.toLowerCase();
      if (feats === 'V;PST') v.pst.add(f);
      else if (feats === 'V;V.PTCP;PST') v.ptcp.add(f);
      else if (feats === 'V;PRS;3;SG') v.prs3.add(f);
      else if (feats === 'V;V.PTCP;PRS') v.vbg.add(f);
    } else if (feats === 'N;PL') {
      if (form === 'uncountable') uniUncountable.add(l);
      else if (form !== 'countable' && /^[a-z]+$/i.test(form)) {
        if (!uniPlurals.has(l)) uniPlurals.set(l, new Set());
        uniPlurals.get(l).add(form.toLowerCase());
      }
    }
  }
}

// scripts/lexicon/irregular-verbs.tsv: base, past, past participle. UniMorph lists only the regular forms of
// some homographs (`lead -> leaded`) and has no paradigm for some very common verbs (`find`, `run`).
const irregularVerbs = new Map();
for (const line of fs.readFileSync(path.join(LEXICON_DIR, 'irregular-verbs.tsv'), 'utf8').split('\n')) {
  const [base, past, participle] = line.split('\t');
  if (base && past && participle) irregularVerbs.set(base, [past, participle]);
}
for (const [lemma, [past, participle]] of irregularVerbs) {
  const uv = unimorphVerbs.get(lemma);
  if (!uv) continue;
  uv.pst = new Set([past]);
  uv.ptcp = new Set([participle]);
}

const isConsonant = (ch) => Boolean(ch) && !'aeiou'.includes(ch);
/** The regular spellings of a verb's forms; `-ed` and `-ing` without and with a doubled final consonant. */
function regularVerbForms(w) {
  const last = w[w.length - 1];
  const prev = w[w.length - 2];
  return {
    s: /(s|x|z|ch|sh|o)$/.test(w) ? w + 'es' : last === 'y' && isConsonant(prev) ? w.slice(0, -1) + 'ies' : w + 's',
    ed: [last === 'e' ? w + 'd' : last === 'y' && isConsonant(prev) ? w.slice(0, -1) + 'ied' : w + 'ed', w + last + 'ed'],
    ing: [last === 'e' && prev !== 'e' ? w.slice(0, -1) + 'ing' : w + 'ing', w + last + 'ing'],
  };
}

// Where UniMorph has only a rare past form (`fix -> fixt`, `bless -> blest`), add the regular one when it
// is far more frequent - unless that spelling belongs to another verb (`star`: `stared` is from `stare`).
for (const [lemma, uv] of unimorphVerbs) {
  if (irregularVerbs.has(lemma) || uv.pst.size === 0 || wnVerb.has(lemma + 'e')) continue;
  const listed = Math.max(...Array.from(uv.pst, (f) => wordCount.get(f) ?? 0));
  for (const f of regularVerbForms(lemma).ed) {
    if (!uv.pst.has(f) && (wordCount.get(f) ?? 0) > listed * 2) {
      uv.pst.add(f);
      uv.ptcp.add(f);
    }
  }
}

// --- Chinese glosses and frequency floors ---
const zhMap = new Map();
const posMaskMap = new Map();
const vocabWordSet = new Set();
const writtenTierFloor = new Map();

// --- Glosses ---------------------------------------------------------------------------------------
// A gloss is one or two short senses, `pos. sense；pos. sense`. It is built from whole units and never
// cut by length: notes in brackets are dropped as a whole, a sense ends at the first separator, and a
// sense that does not fit is left out rather than truncated.
const GLOSS_MAX = 16;
function stripNotes(text) {
  return String(text ?? '')
    .replace(/[（(\[〔【][^（(\[〔【）)\]〕】]*[）)\]〕】]/g, '')
    .replace(/[（(\[〔【][^）)\]〕】]*$/, '') // a note that was never closed
    .replace(/[）)\]〕】]/g, '');
}
function joinSenses(parts) {
  const kept = [];
  for (const part of parts) {
    if (!part || kept.includes(part)) continue;
    if (kept.length > 0 && [...kept.join('；'), ...part].length + 1 > GLOSS_MAX) break;
    kept.push(part);
  }
  return kept.join('；');
}
/** Bring any gloss (curated or derived) to the same shape. Balanced short notes in curated glosses stay. */
function normaliseGloss(gloss) {
  if (!gloss) return '';
  const balanced = (g) => (g.match(/[（(\[〔【]/g) ?? []).length === (g.match(/[）)\]〕】]/g) ?? []).length;
  const senses = gloss
    .split(/[；;]/)
    .map((sense) => (balanced(sense) ? sense.trim() : stripNotes(sense).trim()))
    .filter((sense) => sense && !/^[a-z./]+\.?$/i.test(sense)); // a bare part-of-speech tag says nothing
  return joinSenses(senses);
}

// scripts/lexicon/glosses.zh-Hans.tsv: word, learner level (1 = beginner ... 7 = rare, 0 = not general vocabulary), gloss.
// The level sets a frequency floor, so that words learners are taught are not ranked by how often they
// occur in film subtitles alone.
const LEVEL_FLOORS = [0, 645, 605, 585, 565, 560, 550, 535];
// A gloss is one or two senses joined by `；`, starts with a part of speech, has no brackets and fits
// the candidate window. Lines are sorted by word, one line per word.
const GLOSS_POS = '(?:n|v|adj|adv|prep|conj|pron|det|num|int|abbr|aux)';
const GLOSS_SENSE = new RegExp(`^(?:${GLOSS_POS}\\.(?:/${GLOSS_POS}\\.)* )?[^；;()（）\\[\\]【】]+$`);
const GLOSS_START = new RegExp(`^${GLOSS_POS}\\.`);
let lastGlossWord = '';
function glossProblem(w, level, gloss, line) {
  if (line.split('\t').length !== 3) return 'expected word, level and gloss separated by tabs';
  if (w <= lastGlossWord) return 'words must be unique and sorted';
  lastGlossWord = w;
  if (!/^[0-7]$/.test(level)) return 'level must be 0-7';
  if (!gloss) return null;
  if ([...gloss].length > 16) return 'gloss is longer than 16 characters';
  const senses = gloss.split('；');
  if (senses.length > 2) return 'more than two senses';
  if (!GLOSS_START.test(gloss) || !senses.every((sense) => GLOSS_SENSE.test(sense))) return 'bad gloss format';
  if (!/[\u4e00-\u9fff]/.test(gloss)) return 'gloss has no Chinese';
  return null;
}
for (const line of fs.readFileSync(path.join(LEXICON_DIR, 'glosses.zh-Hans.tsv'), 'utf8').split('\n')) {
  const [w, level, gloss] = line.split('\t');
  if (!w) continue;
  const problem = glossProblem(w, level, gloss, line);
  if (problem) throw new Error(`glosses.zh-Hans.tsv: ${problem}: ${line}`);
  const floor = LEVEL_FLOORS[Number(level)] ?? 0;
  if (floor) {
    vocabWordSet.add(w);
    writtenTierFloor.set(w, floor);
  }
  if (gloss) {
    zhMap.set(w, gloss);
    const mask = parsePosFlagsFromText(gloss);
    if (mask) posMaskMap.set(w, mask);
  }
}

const curatedEntries = [
  ['complement', 590, 'v./n. 补充；相辅相成'],
  ['compliment', 585, 'v./n. 称赞；恭维'],
  ['complementary', 560, 'adj. 互补的；补充的'],
  ['complimentary', 545, 'adj. 赞美的；免费的'],
  ['affect', 690, 'v. 影响；打动'],
  ['effect', 745, 'n. 效果；影响'],
  ['principal', 630, 'adj. 主要的；n. 校长/本金'],
  ['principle', 665, 'n. 原则；原理'],
  ['stationary', 520, 'adj. 静止的；固定的'],
  ['stationery', 495, 'n. 文具；信纸'],
  ['discrete', 540, 'adj. 离散的；互不相连的'],
  ['discreet', 525, 'adj. 谨慎的；言行得体的'],
  ['statute', 530, 'n. 法规；法令'],
  ['statue', 590, 'n. 雕像；塑像'],
  ['stature', 510, 'n. 身高；声望'],
  ['elicit', 515, 'v. 引出；诱出'],
  ['illicit', 505, 'adj. 非法的；违禁的'],
  ['eminent', 520, 'adj. 杰出的；显赫的'],
  ['imminent', 535, 'adj. 迫在眉睫的；即将发生的'],
  ['immanent', 430, 'adj. 内在的；固有的'],
  ['ingenuous', 460, 'adj. 天真坦率的'],
  ['ingenious', 545, 'adj. 巧妙的；独创的'],
  ['adapt', 640, 'v. 适应；改编'],
  ['adopt', 650, 'v. 采用；收养'],
  ['adept', 520, 'adj. 熟练的；内行的'],
  ['perspective', 670, 'n. 视角；观点；透视'],
  ['prospective', 575, 'adj. 潜在的；未来的'],
  ['precede', 545, 'v. 先于；在…之前'],
  ['proceed', 635, 'v. 继续进行；前进'],
  ['conscience', 610, 'n. 良心；良知'],
  ['conscious', 645, 'adj. 有意识的；清醒的'],
  ['consciousness', 605, 'n. 意识；知觉'],
  ['conscientious', 575, 'adj. 认真负责的；一丝不苟的'],
  ['thorough', 625, 'adj. 彻底的；周密的'],
  ['thoroughly', 615, 'adv. 彻底地；完全地'],
  ['through', 860, 'prep./adv. 通过；穿过'],
  ['though', 835, 'conj./adv. 虽然；不过'],
  ['thought', 820, 'n. 想法；v. 认为(think过去式)'],
  ['desert', 615, 'n. 沙漠；v. 抛弃'],
  ['dessert', 585, 'n. 甜点；餐后甜食'],
  ['loose', 640, 'adj. 松散的；宽松的'],
  ['lose', 775, 'v. 失去；输掉'],
  ['breath', 655, 'n. 呼吸；气息'],
  ['breathe', 640, 'v. 呼吸'],
  ['advice', 705, 'n. 建议；忠告(不可数)'],
  ['advise', 650, 'v. 建议；劝告'],
  ['ensure', 695, 'v. 确保；保证'],
  ['insure', 575, 'v. 投保；给…上保险'],
  ['assure', 635, 'v. 向…保证；使确信'],
  ['allusion', 490, 'n. 暗指；典故'],
  ['illusion', 600, 'n. 错觉；幻觉'],
  ['emigrate', 495, 'v. 移居国外(迁出)'],
  ['immigrate', 510, 'v. 移居入境(迁入)'],
  ['kernel', 565, 'n. 果仁；核心；内核'],
  ['colonel', 575, 'n. 陆军上校'],
  ['choir', 565, 'n. 合唱团；唱诗班'],
  ['receipt', 620, 'n. 收据；发票；收到'],
  ['resist', 625, 'v. 抵抗；抵制；忍住'],
  ['recipe', 615, 'n. 食谱；秘诀'],
  ['rendezvous', 530, 'n./v. 约会；会合；集合点'],
  ['entrepreneur', 640, 'n. 企业家；创业者'],
  ['entrepreneurial', 555, 'adj. 创业的；企业家的'],
  ['physiological', 575, 'adj. 生理学的；生理的'],
  ['psychology', 645, 'n. 心理学；心理'],
  ['psychological', 625, 'adj. 心理的；精神上的'],
  ['bureaucracy', 565, 'n. 官僚主义；官僚机构'],
  ['questionnaire', 580, 'n. 调查问卷'],
  ['acknowledge', 665, 'v. 承认；确认收到；致谢'],
  ['acknowledgment', 585, 'n. 承认；确认；致谢'],
  ['acknowledgement', 580, 'n. 承认；确认；致谢'],
  ['definitely', 775, 'adv. 绝对；肯定地；明确地'],
  ['separate', 710, 'adj. 分开的；v. 分离'],
  ['necessary', 745, 'adj. 必要的；必需的'],
  ['occurrence', 575, 'n. 发生；出现；事件'],
  ['accommodate', 595, 'v. 容纳；提供住宿；适应'],
  ['accommodation', 585, 'n. 住处；膳宿；调解'],
  ['privilege', 625, 'n. 特权；荣幸'],
  ['maintenance', 640, 'n. 维护；保养；维持'],
  ['pronunciation', 595, 'n. 发音；读法'],
  ['miscellaneous', 565, 'adj. 混杂的；各种各样的'],
  ['millennium', 535, 'n. 一千年；千禧年'],
  ['liaison', 525, 'n. 联络；联络人'],
  ['guarantee', 675, 'v./n. 保证；担保；保修'],
  ['maneuver', 545, 'n./v. 机动；策略；巧妙移动'],
  ['hierarchy', 615, 'n. 层级；等级制度'],
  ['redundant', 625, 'adj. 冗余的；多余的'],
  ['redundancy', 585, 'n. 冗余；备份'],
  ['ambiguous', 615, 'adj. 模棱两可的；有歧义的'],
  ['vulnerable', 620, 'adj. 脆弱的；易受攻击的'],
  ['spontaneous', 595, 'adj. 自发的；自然的'],
  ['simultaneous', 590, 'adj. 同时发生的'],
  ['simultaneously', 595, 'adv. 同时地'],
  ['exaggerate', 595, 'v. 夸大；夸张'],
  ['catastrophe', 585, 'n. 大灾难；惨败'],
  ['deteriorate', 575, 'v. 恶化；退化'],
  ['prerequisite', 585, 'n. 先决条件；前提'],
  ['ubiquitous', 565, 'adj. 无处不在的'],
  ['criterion', 575, 'n. 标准；准则(单数)'],
  ['criteria', 610, 'n. 标准；准则(复数)'],
  ['phenomenon', 605, 'n. 现象(单数)'],
  ['phenomena', 575, 'n. 现象(复数)'],
  ['zombie', 580, 'n. 僵尸'],
  ['bourgeois', 505, 'adj./n. 中产阶级的；资产阶级'],
  ['camouflage', 530, 'n./v. 伪装；掩饰'],
  ['silhouette', 520, 'n. 剪影；轮廓'],
  ['chauffeur', 505, 'n. 专职司机'],
  ['champagne', 585, 'n. 香槟酒'],
  ['broccoli', 555, 'n. 西兰花'],
  ['zucchini', 505, 'n. 西葫芦'],
  ['pneumonia', 535, 'n. 肺炎'],
  ['asthma', 535, 'n. 哮喘'],
  ['diarrhea', 515, 'n. 腹泻'],
  ['rhythm', 615, 'n. 节奏；韵律'],
  ['subtle', 625, 'adj. 微妙的；精细的'],
  ['indict', 515, 'v. 起诉；控告'],
  ['mortgage', 605, 'n./v. 按揭；抵押贷款'],
  ['schedule', 715, 'n. 日程表；v. 安排'],
  ['colleague', 650, 'n. 同事；同僚'],
  ['colleagues', 645, 'n. 同事(复数)'],
  ['embarrass', 575, 'v. 使尴尬；使难堪'],
  ['embarrassing', 605, 'adj. 令人尴尬的'],
  ['recommend', 715, 'v. 推荐；建议'],
  ['recommendation', 645, 'n. 推荐；建议'],
];

for (const [w, , zh] of curatedEntries) {
  zhMap.set(w, zh);
  posMaskMap.set(w, parsePosFlagsFromText(zh));
  vocabWordSet.add(w);
}

let collocations = { bigrams: {}, trigrams: {} };
const collocationsPath = path.join(LEXICON_DIR, 'collocations.json');
if (fs.existsSync(collocationsPath)) {
  const rawCol = JSON.parse(fs.readFileSync(collocationsPath, 'utf8'));
  collocations = {
    bigrams: rawCol.bigrams ?? {},
    trigrams: rawCol.trigrams ?? {},
  };
}

const VALID_1_LETTER = new Set(['a', 'i']);
const VALID_2_LETTER = new Set([
  'am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'hi',
  'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'oh', 'ok',
  'on', 'or', 'so', 'to', 'up', 'us', 'we',
]);

const STOP_FRAGMENTS = new Set([
  've', 'll', 're', 'nt', 'em', 'na', 'ta', 'ya', 'uh', 'um', 'eh', 'ah',
  'hm', 'hmm', 'huh', 'nah', 'yep', 'yup', 'uhh', 'umm', 'aaa', 'ooo', 'shh',
  'mgmt', 'tmrw', 'tmr', 'ystd', 'thx', 'pls', 'plz',
  'bcz', 'wld', 'shld', 'cld', 'approx', 'govt', 'dept', 'intl', 'msg', 'pkg',
]);

const wordFreq = new Map();

// The lexicon is the set of words Voka has a meaning for (a gloss of its own or of the word it is a
// form of). The counts only say how common a word is: a token that merely
// occurs in subtitles - a character's name, a slip - is not offered as a correction.
const lemmasOfForm = new Map();
for (const [lemma, forms] of uniAllForms) {
  for (const form of forms) {
    if (!lemmasOfForm.has(form)) lemmasOfForm.set(form, []);
    lemmasOfForm.get(form).push(lemma);
  }
}
for (const line of fs.readFileSync(path.join(LEXICON_DIR, 'irregular-verbs.tsv'), 'utf8').split('\n')) {
  const [base, ...forms] = line.split(/[\t/, ]+/).filter(Boolean);
  for (const form of forms) {
    if (!lemmasOfForm.has(form)) lemmasOfForm.set(form, []);
    lemmasOfForm.get(form).push(base);
  }
}
/** A word that can carry inflections: one with a meaning of its own, or a form of such a word. */
const isBaseWord = (w) => zhMap.has(w) || (lemmasOfForm.get(w) ?? []).some((lemma) => zhMap.has(lemma));
/** `w` is the regular plural (or -s form) of a base word. */
const isPluralOfKnownNoun = (w) => {
  const singular = pluralize.singular(w);
  return singular !== w && isBaseWord(singular) && pluralize.plural(singular) === w;
};
/** `w` is a regular -ed / -ing / -er / -est / -ly form of a word that has a meaning. */
const isFormOfKnownWord = (w) => {
  const m = /^(.{2,}?)(ed|ing|er|est|ly)$/.exec(w);
  if (!m) return false;
  const [, stem, suffix] = m;
  const stems = [stem, `${stem}e`];
  if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) stems.push(stem.slice(0, -1)); // stopped
  if (stem.endsWith('i')) stems.push(`${stem.slice(0, -1)}y`); // tried, happier, happily
  if (suffix === 'ly' && stem.endsWith('al')) stems.push(stem.slice(0, -2)); // basically
  return stems.some(isBaseWord);
};
const IRREGULAR_COMPARATIVES = new Set(['better', 'best', 'worse', 'worst', 'more', 'most', 'less', 'least', 'further', 'furthest', 'farther', 'farthest', 'elder', 'eldest']);
const hasMeaning = (w) =>
  isFormOfKnownWord(w) ||
  IRREGULAR_COMPARATIVES.has(w) ||
  zhMap.has(w) ||
  vocabWordSet.has(w) ||
  (lemmasOfForm.get(w) ?? []).some((lemma) => zhMap.has(lemma)) ||
  isPluralOfKnownNoun(w);

// --- Capitalisation ----------------------------------------------------------------------------------
// Which words are written with capitals (`Monday`, `Japan`, `API`, `iPhone`) is derived from two sources:
//   - WordNet keeps the capitals of its lemmas (`Monday`, `Japan`) and counts how often each sense was
//     tagged in SemCor;
//   - the vocabulary of the language model (`data/lm-tokenizer.json`) holds every frequent word as it is
//     written in running text, the most frequent spelling first (`API` before `api`).
// A proper noun is capitalised only where the two agree; an acronym, where the text is clear on its own.
// Everything else stays as typed.
const brandCasingMap = {};
const slotFloor = new Map();
const casedShortWords = new Set(); // capitalised words exempt from the 2-letter whitelist
const passthroughCandidates = new Set();
const PASSTHROUGH_WORDS = new Set(); // resolved below: only words that are not ordinary vocabulary
{
  const WN_DIR = path.join(ROOT, 'node_modules/wordnet-db/dict');
  const SS_TYPE = { noun: '1', verb: '2', adj: '3', adv: '4' };
  const lemmaOfSense = new Map(); // "<ss_type> <offset> <lowercase lemma>" -> lemma as written
  const wnCased = new Map(); // lowercase -> Set of capitalised spellings
  const wnPlain = new Set(); // lemmas written in lowercase
  for (const [pos, type] of Object.entries(SS_TYPE)) {
    for (const line of fs.readFileSync(path.join(WN_DIR, `data.${pos}`), 'latin1').split('\n')) {
      if (!line || line.startsWith('  ')) continue;
      const f = line.slice(0, line.indexOf(' | ')).split(' ');
      const n = parseInt(f[3], 16);
      for (let i = 0; i < n; i++) {
        const lemma = f[4 + 2 * i].replace(/\(.*\)$/, '');
        if (!/^[A-Za-z]+$/.test(lemma)) continue;
        const lower = lemma.toLowerCase();
        const sense = `${type} ${f[0]} ${lower}`;
        // A synset that writes the word both ways (`sun, Sun`) counts for the plain spelling.
        if (lemma === lower || !lemmaOfSense.has(sense)) lemmaOfSense.set(sense, lemma);
        if (lemma === lower) wnPlain.add(lower);
        else {
          if (!wnCased.has(lower)) wnCased.set(lower, new Set());
          wnCased.get(lower).add(lemma);
        }
      }
    }
  }
  const tagged = new Map(); // spelling -> SemCor tag count over its senses
  for (const line of fs.readFileSync(path.join(WN_DIR, 'index.sense'), 'latin1').split('\n')) {
    const [key, offset, , count] = line.split(' ');
    if (!count) continue;
    const [lemma, rest] = key.split('%');
    const type = rest[0] === '5' ? '3' : rest[0];
    const written = lemmaOfSense.get(`${type} ${offset} ${lemma}`);
    if (written) tagged.set(written, (tagged.get(written) ?? 0) + Number(count));
  }

  // Whole words of the model vocabulary, per lowercase word, most frequent spelling first.
  const lmForms = new Map();
  const lmVocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/lm-tokenizer.json'), 'utf8')).model.vocab;
  for (const [token, id] of Object.entries(lmVocab)) {
    if (!/^Ġ[A-Za-z]{2,}$/.test(token)) continue;
    const word = token.slice(1);
    const lower = word.toLowerCase();
    if (!lmForms.has(lower)) lmForms.set(lower, []);
    lmForms.get(lower).push([id, word]);
  }
  for (const forms of lmForms.values()) forms.sort((a, b) => a[0] - b[0]);

  const isTitle = (w) => w === w[0].toUpperCase() + w.slice(1).toLowerCase();
  const written = new Set(Array.from(lmForms.values()).flatMap((forms) => forms.map(([, word]) => word)));
  const pieces = new Set();
  for (const word of written) {
    for (let i = 2; i < word.length; i++) if (written.has(word.slice(0, i))) pieces.add(word.slice(0, i));
  }
  const capitalised = (w) => {
    // The plural or another form of an ordinary word is that word (`windows`).
    if (isPluralOfKnownNoun(w) || isFormOfKnownWord(w) || (lemmasOfForm.get(w) ?? []).some((l) => l !== w && zhMap.has(l))) return null;
    const first = lmForms.get(w)?.[0][1];
    if (!first || first === w) return null;
    const cased = wnCased.get(w);
    if (cased) {
      // A proper noun: WordNet and running text must agree on the spelling (`Europe`; not `may` -> `May`).
      if (!cased.has(first)) return null;
      // Two letters are too easily something else (`ca`, `ms`): only spellings attested in tagged text.
      if (w.length === 2 && !(tagged.get(first) > 0)) return null;
      // A word that is also a common noun or verb (`china`, `march`) follows its more frequent sense.
      if (wnPlain.has(w) && (tagged.get(first) ?? 0) <= (tagged.get(w) ?? 0)) return null;
      return first;
    }
    // Acronyms and names with inner capitals that WordNet does not have: `API`, `JSON`, `iPhone`.
    if (isTitle(first) || w.length < 3) return null;
    // The beginning of longer names (`McC` of `McCoy`) is a piece of the vocabulary, not a word.
    if (first !== first.toUpperCase() && pieces.has(first)) return null;
    if (wnPlain.has(w) || writtenTierFloor.has(w) || (wordCount.get(w) ?? 0) < 20) return null;
    return first;
  };

  for (const w of lmForms.keys()) {
    if (w.length < 2 || !wordCount.has(w)) continue;
    const form = capitalised(w);
    if (!form) continue;
    brandCasingMap[w] = form;
    // Without a meaning of its own the word is only kept as typed, in its capitalised form.
    if (!zhMap.has(w)) passthroughCandidates.add(w);
    else {
      vocabWordSet.add(w);
      casedShortWords.add(w);
      slotFloor.set(w, 500); // like the words that are only kept as typed
    }
  }
}

for (const [w, count] of wordCount) {
  if (!hasMeaning(w)) continue;
  // A capitalised word without a meaning stays "valid as typed, never suggested".
  if (passthroughCandidates.has(w) && !writtenTierFloor.has(w)) continue;
  if (STOP_FRAGMENTS.has(w)) continue;
  if (w.length === 1 && !VALID_1_LETTER.has(w)) continue;
  if (w.length === 2 && !VALID_2_LETTER.has(w)) continue;

  const inCmu = Object.prototype.hasOwnProperty.call(cmuDict, w);
  const inVocab = vocabWordSet.has(w);
  if (!inCmu && !inVocab) continue;
  if (w.length === 3 && count < 180 && !inVocab) continue;

  const spokenScore = Math.min(995, Math.max(240, Math.round(115 * Math.log10(count + 1) + 185)));
  const tierFloor = writtenTierFloor.get(w) ?? 0;
  const blended = tierFloor > spokenScore ? Math.round(spokenScore * 0.35 + tierFloor * 0.65) : spokenScore;

  const prev = wordFreq.get(w) ?? 0;
  if (blended > prev) wordFreq.set(w, blended);
}

for (const w of vocabWordSet) {
  if (STOP_FRAGMENTS.has(w)) continue;
  if (w.length === 1 && !VALID_1_LETTER.has(w)) continue;
  if (w.length === 2 && !VALID_2_LETTER.has(w) && !casedShortWords.has(w)) continue;
  if (!wordFreq.has(w)) {
    wordFreq.set(w, writtenTierFloor.get(w) ?? 480);
  }
}

for (const [w, boostScore] of curatedEntries) {
  wordFreq.set(w, Math.max(wordFreq.get(w) ?? 0, boostScore));
}

for (const [w, boostScore] of slotFloor.entries()) {
  wordFreq.set(w, Math.max(wordFreq.get(w) ?? 0, boostScore));
}

// Passthrough words: only those that did not make it in as ordinary vocabulary become
// "valid as typed, never suggested" entries (so `dude` stays a normal word, `hmm` is passthrough).
for (const w of passthroughCandidates) {
  if (w.length < 2) continue;
  if (wordFreq.has(w)) continue;
  wordFreq.set(w, 500);
  PASSTHROUGH_WORDS.add(w);
}

// The irregular plural of a noun that is in the lexicon (`analyses`, `matrices`, `criteria`) must be in
// `wordFreq` before the list is cut to size.
for (const [sg, plRaw] of irregularPlurals.entries()) {
  const sgKey = sg.toLowerCase();
  const plKey = plRaw.toLowerCase();
  if (plKey !== sgKey && /^[a-z]+$/.test(plKey) && wordFreq.has(sgKey)) {
    const minPlFreq = Math.max(465, (wordFreq.get(sgKey) ?? 500) - 45);
    if ((wordFreq.get(plKey) ?? 0) < minPlFreq) {
      wordFreq.set(plKey, minPlFreq);
    }
  }
}

const sortedWords = Array.from(wordFreq.entries())
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 35200);

// A verb takes the regular endings. Where a form occurs in text it is an entry next to its verb, so that
// it is completed and explained like the verb itself (`conforming`, `sifted`), however rare the form is.
// Of the two spellings of -ed and -ing, with and without a doubled consonant, the one the counts
// prefer is the word.
const regularFormOf = new Map();
{
  const listed = new Set(sortedWords.map(([w]) => w));
  for (const [w] of sortedWords) {
    if (w.length < 3 || irregularVerbs.has(w)) continue;
    if (!((posMaskMap.get(w) ?? 0) & FLAG_POS_VERB) && !wnVerb.has(w)) continue;
    const forms = regularVerbForms(w);
    // A noun with a plural of its own keeps it: `leafs` is first of all a wrong `leaves`.
    const ownPlural = irregularPlurals.get(w);
    const takesS = !ownPlural || ownPlural.toLowerCase() === forms.s;
    for (const spellings of [takesS ? [forms.s] : [], forms.ed, forms.ing]) {
      if (spellings.length === 0) continue;
      const best = spellings.reduce((x, y) => ((wordCount.get(y) ?? 0) > (wordCount.get(x) ?? 0) ? y : x));
      if (!wordCount.has(best) || listed.has(best) || regularFormOf.has(best)) continue;
      regularFormOf.set(best, w);
    }
  }
  for (const form of regularFormOf.keys()) {
    const count = wordCount.get(form);
    sortedWords.push([form, Math.min(995, Math.max(240, Math.round(115 * Math.log10(count + 1) + 185)))]);
  }
}

const lexiconWordSet = new Set(sortedWords.map(([w]) => w));

// --- Morphology: verb paradigms, noun plurals, uncountable nouns, non-standard plurals ---
const allIrregValues = new Set(Array.from(irregularPlurals.values()).map((v) => v.toLowerCase()));

function pickBestInflectedForm(candidatesSet, preferParticipleEn = false) {
  if (!candidatesSet || candidatesSet.size === 0) return '';
  const arr = Array.from(candidatesSet);
  if (arr.length === 1) return arr[0];

  arr.sort((a, b) => {
    // After have/has/had the `-en` participle is preferred when it is well attested (`written`, `chosen`, `broken`).
    if (preferParticipleEn) {
      const aEn = a.endsWith('en') || a.endsWith('wn') || a === 'gone' || a === 'been' || a === 'done' || a === 'sung' || a === 'swum' || a === 'shrunk' || a === 'begun' || a === 'drunk' || a === 'sunk' || a === 'rung';
      const bEn = b.endsWith('en') || b.endsWith('wn') || b === 'gone' || b === 'been' || b === 'done' || b === 'sung' || b === 'swum' || b === 'shrunk' || b === 'begun' || b === 'drunk' || b === 'sunk' || b === 'rung';
      if (aEn && !bEn && (wordCount.get(a) ?? 0) >= 30) return -1;
      if (bEn && !aEn && (wordCount.get(b) ?? 0) >= 30) return 1;
    }
    const cntA = wordCount.get(a) ?? 0;
    const cntB = wordCount.get(b) ?? 0;
    return cntB - cntA;
  });
  return arr[0];
}

function synthesizeVerbParadigm(w, existing) {
  const count = (f) => wordCount.get(f) ?? 0;
  const attested = (f) => count(f) >= 1 || lexiconWordSet.has(f);
  // Of two spellings the more frequent one is the word (`visiting`, not `visitting`), unless the plain
  // spelling belongs to another verb (`ridding`: `riding` is from `ride`).
  const best = ([plain, doubled]) =>
    attested(doubled) && (!attested(plain) || count(doubled) > count(plain) || lexiconWordSet.has(w + 'e')) ? doubled : attested(plain) ? plain : '';
  const forms = regularVerbForms(w);
  const s3 = forms.s;
  const regular = best(forms.ed);
  const [pst, ptcp] = irregularVerbs.get(w) ?? [regular, regular];
  if (!pst || !attested(s3)) return existing;
  const out = existing ?? { pst: new Set(), ptcp: new Set(), prs3: new Set(), vbg: new Set() };
  if (out.pst.size === 0) out.pst.add(pst);
  if (out.ptcp.size === 0) out.ptcp.add(ptcp);
  if (out.prs3.size === 0) out.prs3.add(s3);
  // An `-ing` form that is not attested is still regular, except where the consonant may double (`rid`).
  const vbg = best(forms.ing) || (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(w) ? '' : forms.ing[0]);
  if (out.vbg.size === 0 && vbg) out.vbg.add(vbg);
  return out;
}

function resolveCanonicalNounPlural(w) {
  if (!wnNoun.has(w) && !irregularPlurals.has(w) && !uniPlurals.has(w)) return null;
  if (uniUncountable.has(w)) return null;
  // Already an irregular plural (`people`, `children`, `mice`, `criteria`, `police`): no plural of a plural.
  if (allIrregValues.has(w) && !irregularPlurals.has(w)) return null;
  if (!pluralize.isSingular(w) && pluralize.isPlural(w)) return null;

  // 1. Irregular, zero-plural and uncountable nouns (`person -> people`, `sheep -> sheep`, `information -> information`)
  if (irregularPlurals.has(w)) {
    const ip = irregularPlurals.get(w).toLowerCase();
    return ip === w ? null : ip;
  }

  // 2. The plural listed by UniMorph (N;PL)
  const uSet = uniPlurals.get(w);
  if (uSet && uSet.size > 0) {
    const arr = Array.from(uSet).filter((p) => lexiconWordSet.has(p));
    if (arr.length === 0) return null;
    arr.sort((a, b) => (wordCount.get(b) ?? 0) - (wordCount.get(a) ?? 0));
    const best = arr[0];
    const sgCnt = wordCount.get(w) ?? 0;
    const plCnt = wordCount.get(best) ?? 0;
    if (sgCnt >= 120 && plCnt / sgCnt < 0.015) return null;
    return best;
  }

  // 3. Regular plural, if that form is itself in the lexicon (`war`, `piano`, `church`)
  const p = pluralize.plural(w).toLowerCase();
  if (!p || p === w || !lexiconWordSet.has(p)) return null;
  const sgCnt = wordCount.get(w) ?? 0;
  const plCnt = wordCount.get(p) ?? 0;
  if (plCnt >= 15 && (sgCnt < 100 || plCnt / sgCnt >= 0.02)) {
    return p;
  }
  return null;
}

// Non-standard and double plurals (`persons`, `peoples`, `sheeps`, `mens`, `researches`): never suggested.
const PROTECTED_S_WORDS = new Set([
  'hers', 'ours', 'yours', 'theirs', 'its', 'his', 'news', 'means', 'goods',
  'maths', 'physics', 'economics', 'politics', 'ethics', 'statistics', 'series', 'species', 'aids',
]);
const MORPH_GHOST_SHIELD = new Set();

for (const [w] of sortedWords) {
  if (PROTECTED_S_WORDS.has(w)) continue;
  if (w.length < 4 || !w.endsWith('s') || w.endsWith('ss') || w.endsWith('ous') || w.endsWith('is') || w.endsWith('us') || w.endsWith('ics')) continue;

  const sg = pluralize.singular(w);
  if (!sg || sg === w || sg.length < 3) continue;

  const vInfo = wnVerb.get(sg);
  const nInfo = wnNoun.get(sg);
  const isSignificantVerb = vInfo && (vInfo.tagCnt >= 3 || (!nInfo && vInfo.synsets >= 1));
  if (isSignificantVerb) continue;

  const wCnt = wordCount.get(w) ?? 0;
  const sgCnt = wordCount.get(sg) ?? 0;

  const irregPl = irregularPlurals.get(sg)?.toLowerCase();
  // A second plural that is in real use (`indices`, `dwarves`, `agendas`) is not a mistake.
  if (irregPl && irregPl !== w && wCnt < 2000 && wCnt < 0.5 * (wordCount.get(irregPl) ?? 0)) {
    MORPH_GHOST_SHIELD.add(w);
    continue;
  }
  if (allIrregValues.has(sg) && !irregularPlurals.has(sg) && wCnt < 2000 && wCnt < 0.05 * sgCnt) {
    MORPH_GHOST_SHIELD.add(w);
    continue;
  }
  if ((uniUncountable.has(sg) || pluralize.plural(sg).toLowerCase() === sg) && wCnt < 50 && (sgCnt === 0 || wCnt / sgCnt < 0.02)) {
    MORPH_GHOST_SHIELD.add(w);
  }
}

// Verb paradigm table, noun plural table and the reverse map from inflected form to lemma.
const compiledVerbs = {};      // lemma -> [past, participle, thirdSingular, vbg, isPureVerb(0|1)]
const compiledPlurals = {};    // singular -> canonicalPlural
const inflectionToLemma = {};  // inflectedForm -> lemma
const pastVerbSet = new Set(); // unambiguous past-tense verb forms

for (const [w, freq] of sortedWords) {
  // 1. Noun plurals
  const pl = resolveCanonicalNounPlural(w);
  if (pl && lexiconWordSet.has(pl) && !MORPH_GHOST_SHIELD.has(pl)) {
    compiledPlurals[w] = pl;
    if (pl !== w && !inflectionToLemma[pl]) {
      inflectionToLemma[pl] = w;
    }
  }

  // 2. Verb paradigms
  let uv = unimorphVerbs.get(w);
  const vInfo = wnVerb.get(w);
  const nInfo = wnNoun.get(w);
  const adjInfo = wnAdj.get(w);

  // The UniMorph file lacks the inflections of some very common verbs (want, need, find, play, run ...):
  // fill them in from the irregular verbs and the regular rules, each form checked against the corpus.
  if (vInfo && vInfo.tagCnt >= 1 && (!uv || uv.pst.size === 0 || uv.prs3.size === 0 || uv.vbg.size === 0)) {
    uv = synthesizeVerbParadigm(w, uv);
  }

  // Nouns that are only rarely used as verbs (`person`, `child`, `tooth`) and function words that
  // Wiktionary lists as verbs (`and`, `but`, `yet`) are left out: a verb needs a WordNet verb entry.
  const isGenuineVerb =
    w === 'be' ||
    (uv &&
      uv.pst.size > 0 &&
      uv.prs3.size > 0 &&
      freq >= 360 &&
      Boolean(vInfo) &&
      (vInfo.tagCnt >= 1 || (!nInfo && !adjInfo && vInfo.synsets >= 1)));

  if (isGenuineVerb) {
    if (w === 'be') {
      compiledVerbs[w] = ['was', 'been', 'is', 'being', 1];
      pastVerbSet.add('was');
      pastVerbSet.add('were');
      continue;
    }
    const pst = pickBestInflectedForm(uv.pst, false);
    const ptcp = pickBestInflectedForm(uv.ptcp, true) || pst;
    const prs3 = pickBestInflectedForm(uv.prs3, false);
    const vbg = pickBestInflectedForm(uv.vbg, false);

    if (pst && ptcp && prs3) {
      // `isPureVerb` (the engine may re-inflect the word automatically): the word has no noun or adjective
      // entry in WordNet, or its SemCor verb count clearly dominates its noun and adjective counts.
      const nounTags = (nInfo?.tagCnt ?? 0) + (adjInfo?.tagCnt ?? 0);
      const verbTags = vInfo?.tagCnt ?? 0;
      const hasZeroNounSense = !nInfo && !adjInfo;
      const verbOverwhelminglyDominates =
        verbTags >= 6 && (nounTags === 0 ? (nInfo?.synsets ?? 0) <= 5 : verbTags >= nounTags * 3.5);
      const isPureVerb = (hasZeroNounSense || verbOverwhelminglyDominates) && w !== 'like' ? 1 : 0;

      compiledVerbs[w] = [pst, ptcp, prs3, vbg, isPureVerb];

      // Reverse links from each form to the lemma
      for (const inf of [pst, ptcp, prs3, vbg]) {
        if (inf && inf !== w && !inflectionToLemma[inf]) {
          inflectionToLemma[inf] = w;
        }
      }

      // A past form counts as a past-tense marker when it differs from the base (not `cost`, `put`, `cut`)
      // and is not also a common noun or adjective.
      if (pst !== w && !wnAdj.has(pst) && (wnNoun.get(pst)?.tagCnt ?? 0) <= 1) {
        pastVerbSet.add(pst);
      }
    }
  }
}

function resolveGloss(w) {
  if (zhMap.has(w)) return zhMap.get(w);
  if (regularFormOf.has(w) && zhMap.has(regularFormOf.get(w))) return zhMap.get(regularFormOf.get(w));
  // An inflected form means what its lemma means; the form itself already shows the tense / number.
  const lemma = inflectionToLemma[w];
  if (lemma && zhMap.has(lemma)) return zhMap.get(lemma);
  // quick -> quickly: the adjective's first sense as an adverb (快速的 -> 快速地).
  if (w.endsWith('ly') && w.length > 4 && zhMap.has(w.slice(0, -2))) {
    const adj = zhMap.get(w.slice(0, -2)).split('；').find((sense) => /^adj\./.test(sense));
    if (adj) return `adv. ${adj.replace(/^adj\.\s*/, '').replace(/的$/, '地')}`;
  }
  return '';
}

function inferPosBits(w, gloss) {
  let mask = posMaskMap.get(w) ?? 0;
  if (gloss) mask |= parsePosFlagsFromText(gloss);

  const vInfo = wnVerb.get(w);
  const nInfo = wnNoun.get(w);
  const adjInfo = wnAdj.get(w);
  const advInfo = wnAdv.get(w);

  // A part of speech counts only when it is attested in SemCor (not `mouse` as a verb or `knife` as an adjective).
  if (vInfo && ((vInfo.tagCnt ?? 0) >= 2 || (!nInfo && !adjInfo))) mask |= FLAG_POS_VERB;
  if (nInfo && ((nInfo.tagCnt ?? 0) >= 1 || (!vInfo && !adjInfo))) mask |= FLAG_POS_NOUN;
  if (adjInfo && ((adjInfo.tagCnt ?? 0) >= 2 || (!nInfo && !vInfo))) mask |= FLAG_POS_ADJ;
  if (advInfo && ((advInfo.tagCnt ?? 0) >= 2 || (!nInfo && !vInfo && !adjInfo))) mask |= FLAG_POS_ADV;
  if (allIrregValues.has(w)) mask |= FLAG_POS_NOUN;
  return mask;
}

const entries = [];
let cmuHitCount = 0;
let glossHitCount = 0;
let noSuggestCount = 0;
let posHitCount = 0;

for (const [w, freq] of sortedWords) {
  const arpabet = cmuDict[w];
  let cmuCoarse = '';
  let cmuAlt = '';
  let cmuFine = '';
  let startsWithVowel = /^[aeiou]/i.test(w);

  if (arpabet) {
    cmuHitCount++;
    const ph = arpabetToPhonetic(arpabet);
    cmuCoarse = ph.coarse;
    cmuAlt = ph.altCoarse === ph.coarse ? '' : ph.altCoarse;
    cmuFine = ph.fine;
    startsWithVowel = ph.startsWithVowel;

    const arpabet2 = cmuDict[`${w}(2)`];
    if (arpabet2 && !cmuAlt) {
      const ph2 = arpabetToPhonetic(arpabet2);
      if (ph2.coarse && ph2.coarse !== cmuCoarse) {
        cmuAlt = ph2.coarse;
      }
    }
  }

  if (BRITISH_ALT_COARSE[w] && BRITISH_ALT_COARSE[w] !== cmuCoarse) {
    cmuAlt = BRITISH_ALT_COARSE[w];
  }

  if (/^(uni|use|usu|util|euro|euphem|one|once)/.test(w)) startsWithVowel = false;
  if (/^(hour|honest|honor|honour|heir)/.test(w)) startsWithVowel = true;

  const gloss = normaliseGloss(resolveGloss(w));
  if (gloss) glossHitCount++;

  const isCore =
    w.length === 1 ||
    w.length === 2 ||
    (w.length === 3 ? freq >= 520 || slotFloor.has(w) || PASSTHROUGH_WORDS.has(w) : true);

  const isNoSuggest =
    MORPH_GHOST_SHIELD.has(w) ||
    PASSTHROUGH_WORDS.has(w);
  if (isNoSuggest) noSuggestCount++;

  const posBits = inferPosBits(w, gloss);
  if (posBits) posHitCount++;

  const flags =
    (isCore ? FLAG_CORE : 0) |
    (startsWithVowel ? FLAG_VOWEL : 0) |
    (isNoSuggest ? FLAG_NO_SUGGEST : 0) |
    posBits;

  entries.push([w, freq, cmuCoarse, cmuAlt, cmuFine, gloss, flags]);
}

// --- Known-token tiers ---------------------------------------------------------------------------
// The suggestion lexicon holds a few tens of thousands of words, but far more tokens are valid English
// (inflected forms, rare words, surnames). Typing one of them must never be "corrected". They are stored as three
// Bloom filters (no suggestions, no glosses - only "is this a real token, and how sure are we"):
//   tier 3 = certainly a word  : inflections of lexicon lemmas, tokens counted >= 20 times
//   tier 2 = probably a word   : WordNet lemmas, rarer counted tokens, inflections of those
//   tier 1 = name-like / doubtful: CMU-only entries (mostly surnames), counted tokens that look
//            like a misspelling of a far more frequent word (`wich` next to `which`)
const knownTier = new Map();
const setTier = (w, t) => {
  if (!w || lexiconWordSet.has(w) || w.length < 2 || !/^[a-z]+$/.test(w)) return;
  if ((knownTier.get(w) ?? 0) < t) knownTier.set(w, t);
};

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
// Doubled letters are what spelling most often gets wrong (`tommorow`, `occured`, `dissapointed`): the most
// frequent lexicon word for each spelling with its doubled letters collapsed.
const undoubledCount = new Map();
for (const w of lexiconWordSet) {
  const key = dedup(w);
  const c = wordCount.get(w) ?? 0;
  if (c > (undoubledCount.get(key) ?? 0)) undoubledCount.set(key, c);
}
function looksLikeMisspellingOfFrequentWord(w, count) {
  if (w.length < 3) return false;
  // A short or fairly common token needs a neighbour that is overwhelmingly more frequent.
  const need = Math.max(150, count * (w.length < 4 || count >= 40 ? 400 : 60));
  if (w.length >= 5 && (undoubledCount.get(dedup(w)) ?? 0) >= need) return true;
  const hit = (cand) => cand !== w && lexiconWordSet.has(cand) && (wordCount.get(cand) ?? 0) >= need;
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i);
    if (b && hit(a + b.slice(1))) return true; // extra letter
    if (b.length > 1 && hit(a + b[1] + b[0] + b.slice(2))) return true; // swapped letters
    for (const c of LETTERS) {
      if (b && hit(a + c + b.slice(1))) return true; // wrong letter
      if (hit(a + c + b)) return true; // missing letter
    }
  }
  return false;
}

// The regular plural of a lexicon noun is a word even when the counts do not have it.
for (const w of lexiconWordSet) {
  if (!((posMaskMap.get(w) ?? 0) & FLAG_POS_NOUN) || uniUncountable.has(w)) continue;
  const plural = pluralize.plural(w);
  // Only where the counts know the plural at all, however rarely: an unseen one may be a slip.
  if (plural !== w && seenCount.has(plural)) setTier(plural, 2);
}
// So is a counted token that is the regular plural of a base word or of its -er noun (`simplifications`,
// `funders`), wherever it was counted: a plural is not how a word gets misspelled.
for (const w of wordCount.keys()) {
  if (lexiconWordSet.has(w)) continue;
  const singular = pluralize.singular(w);
  if (singular === w || pluralize.plural(singular) !== w || uniUncountable.has(singular)) continue;
  if (isBaseWord(singular) || (singular.endsWith('er') && isFormOfKnownWord(singular))) setTier(w, 2);
}
for (const [w, c] of seenCount) {
  if (c < RARE || lexiconWordSet.has(w)) continue;
  if (looksLikeMisspellingOfFrequentWord(w, c)) setTier(w, 1);
  else setTier(w, c >= 20 ? 3 : 2);
}
// Recent vocabulary (`backend`, `mysql`) is missing from film subtitles. A token the written counts have
// often enough is probably a word too, unless it is one letter away from a far more frequent one.
for (const [w, c] of wordCount) {
  if (c < WRITTEN_ONLY || lexiconWordSet.has(w) || (seenCount.get(w) ?? 0) >= RARE) continue;
  setTier(w, looksLikeMisspellingOfFrequentWord(w, c) ? 1 : 2);
}
// A word that WordNet lists is a word. One letter away from a far more frequent word (`expansive`,
// `wether`) it stays in the middle tier: the engine alone leaves it, the sentence may still decide.
for (const m of [wnNoun, wnVerb, wnAdj, wnAdv]) {
  for (const w of m.keys()) setTier(w, looksLikeMisspellingOfFrequentWord(w, wordCount.get(w) ?? 0) ? 2 : 3);
}
// Programming vocabulary (`struct`, `nginx`) is rare in general text. The most used tags of Stack Overflow
// are words to the people who type them: kept as typed, never suggested.
for (const line of fs.readFileSync(path.join(RAW_DIR, 'stackoverflow-tags.tsv'), 'utf8').split('\n')) {
  const [tag] = line.split('\t');
  if (/^[a-z]{3,}$/.test(tag)) setTier(tag, 2);
}
for (const w of Object.keys(cmuDict)) setTier(w, 1);
{
  const lemmaTier = (l) => (lexiconWordSet.has(l) ? 3 : knownTier.get(l) ?? 0);
  const pending = [];
  for (const [lemma, forms] of uniAllForms) {
    const t = lemmaTier(lemma);
    if (t < 2) continue; // do not trust inflections of name-like / unattested lemmas
    for (const f of forms) pending.push([f, t]);
  }
  for (const [f, t] of pending) setTier(f, t);
}

// --- British spellings -----------------------------------------------------------------------------
// The lexicon and the frequency list are American. Without this, correct British text is "corrected"
// (`polarisation` -> polarization, `enrolment` -> enrollment). Every known word gets its British twin at
// the same tier (lexicon words: tier 3); the twins are only protected, never suggested.
const UK_OUR = ['color', 'favor', 'honor', 'labor', 'neighbor', 'behavior', 'flavor', 'humor', 'harbor', 'rumor',
  'vapor', 'endeavor', 'savior', 'odor', 'vigor', 'valor', 'armor', 'clamor', 'parlor', 'tumor', 'candor', 'rigor',
  'fervor', 'splendor', 'demeanor', 'misdemeanor', 'savor', 'succor', 'tremor', 'arbor', 'ardor', 'rancor'];
const UK_RE = ['center', 'meter', 'liter', 'theater', 'fiber', 'caliber', 'somber', 'luster', 'meager', 'specter',
  'saber', 'scepter', 'sepulcher', 'maneuver', 'kilometer', 'centimeter', 'millimeter', 'milliliter'];
const UK_L_VERBS = ['travel', 'cancel', 'model', 'label', 'signal', 'level', 'fuel', 'dial', 'counsel', 'marvel',
  'quarrel', 'total', 'equal', 'channel', 'tunnel', 'pedal', 'shovel', 'jewel', 'initial', 'rival', 'revel', 'grovel',
  'funnel', 'panel', 'parcel', 'barrel', 'chisel', 'duel', 'snivel', 'swivel', 'unravel', 'tinsel', 'towel', 'trowel'];
const UK_PAIRS = {
  enrollment: 'enrolment', enroll: 'enrol', fulfill: 'fulfil', fulfillment: 'fulfilment', skillful: 'skilful',
  willful: 'wilful', installment: 'instalment', judgment: 'judgement', program: 'programme', gray: 'grey',
  check: 'cheque', tire: 'tyre', curb: 'kerb', aluminum: 'aluminium', mom: 'mum', pajamas: 'pyjamas', plow: 'plough',
  draft: 'draught', aging: 'ageing', acknowledgment: 'acknowledgement', pediatric: 'paediatric', anemia: 'anaemia',
  estrogen: 'oestrogen', fetus: 'foetus', encyclopedia: 'encyclopaedia', artifact: 'artefact', cozy: 'cosy',
  donut: 'doughnut', licorice: 'liquorice', mold: 'mould', smolder: 'smoulder', sulfur: 'sulphur', skeptic: 'sceptic',
  skeptical: 'sceptical', story: 'storey', specialty: 'speciality', practice: 'practise', defense: 'defence',
  offense: 'offence', license: 'licence', pretense: 'pretence', catalog: 'catalogue', dialog: 'dialogue',
  analog: 'analogue', learned: 'learnt', dreamed: 'dreamt', spelled: 'spelt', burned: 'burnt', leaped: 'leapt',
  spoiled: 'spoilt', among: 'amongst', while: 'whilst', jewelry: 'jewellery', traveler: 'traveller',
  counselor: 'counsellor', marvelous: 'marvellous', woolen: 'woollen', gynecology: 'gynaecology', diarrhea: 'diarrhoea',
  leukemia: 'leukaemia', orthopedic: 'orthopaedic', maneuver: 'manoeuvre', mustache: 'moustache', math: 'maths',
  airplane: 'aeroplane', gram: 'gramme', ax: 'axe', omelet: 'omelette', inquiry: 'enquiry', inquire: 'enquire',
  tidbit: 'titbit', vise: 'vice', chili: 'chilli', yogurt: 'yoghurt', neighborhood: 'neighbourhood',
};
function britishTwins(w) {
  const out = [];
  let m;
  if ((m = /^(.{3,})iz(e|es|ed|ing|er|ers|ation|ations|able|ational)$/.exec(w))) out.push(`${m[1]}is${m[2]}`);
  if ((m = /^(.{3,})yz(e|es|ed|ing|er|ers)$/.exec(w))) out.push(`${m[1]}ys${m[2]}`);
  for (const base of UK_OUR) {
    if (w.startsWith(base) && !/^(ous|ific|iferous)/.test(w.slice(base.length))) out.push(`${base.slice(0, -2)}our${w.slice(base.length)}`);
  }
  for (const base of UK_RE) {
    if (w === base || w === `${base}s`) out.push(`${base.slice(0, -2)}re${w.slice(base.length)}`);
    if (w === `${base}ed`) out.push(`${base.slice(0, -2)}red`);
    if (w === `${base}ing`) out.push(`${base.slice(0, -2)}ring`);
  }
  for (const base of UK_L_VERBS) {
    if ((m = new RegExp(`^${base}(ed|ing|er|ers)$`).exec(w))) out.push(`${base}l${m[1]}`);
  }
  if (UK_PAIRS[w]) out.push(UK_PAIRS[w]);
  for (const [us, uk] of Object.entries(UK_PAIRS)) {
    if (w !== us && w.startsWith(us) && /^(s|es|ed|ing|d|ly)$/.test(w.slice(us.length)) && !uk.endsWith('t')) out.push(uk + w.slice(us.length));
  }
  return out;
}
{
  const twins = [];
  const consider = (w, tier) => { for (const t of britishTwins(w)) twins.push([t, tier]); };
  for (const w of lexiconWordSet) consider(w, 3);
  for (const [w, tier] of knownTier) if (tier >= 2) consider(w, tier);
  let added = 0;
  for (const [t, tier] of twins) {
    if (lexiconWordSet.has(t)) continue;
    if ((knownTier.get(t) ?? 0) < tier) { setTier(t, tier); added++; }
  }
  console.log(`British spellings protected: ${added}`);
}

// Shared with src/engine/known.ts - keep the two implementations identical.
function bloomHashPair(s) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 13;
  }
  h1 ^= h1 >>> 15;
  h1 = Math.imul(h1, 0x2c1b3c6d);
  h1 ^= h1 >>> 12;
  h2 ^= h2 >>> 15;
  h2 = Math.imul(h2, 0x297a2d39);
  h2 ^= h2 >>> 15;
  return [h1 >>> 0, (h2 >>> 0) | 1];
}
function buildBloom(words, bitsPerItem, k) {
  const m = Math.max(64, Math.ceil((words.length * bitsPerItem) / 8) * 8);
  const bytes = Buffer.alloc(m / 8);
  for (const w of words) {
    const [h1, h2] = bloomHashPair(w);
    for (let i = 0; i < k; i++) {
      const bit = (h1 + Math.imul(i, h2)) >>> 0;
      const idx = bit % m;
      bytes[idx >> 3] |= 1 << (idx & 7);
    }
  }
  return { m, k, n: words.length, bits: bytes.toString('base64') };
}
const tierWords = [[], [], []];
for (const [w, t] of knownTier) tierWords[t - 1].push(w);
const knownPayload = {
  // 18 bits per word, 12 hashes: about 0.02% false positives. A false positive is a typo that is silently
  // treated as a real word (no correction, no suggestion), so the table is deliberately generous. The top
  // tier also vouches for word forms the engine builds itself, so it gets 24 bits and 16 hashes (0.001%).
  tiers: [buildBloom(tierWords[0], 18, 12), buildBloom(tierWords[1], 18, 12), buildBloom(tierWords[2], 24, 16)],
  // Load-time self-check for the hash implementation: [token, tier] pairs that must test positive.
  samples: [1, 2, 3].flatMap((t) => tierWords[t - 1].slice(0, 4).map((w) => [w, t])),
  // Every other token the counts have: not vouched for as a word, but not made up on the spot either.
  attested: buildBloom(
    Array.from(wordCount.keys()).filter((w) => /^[a-z]+$/.test(w) && !lexiconWordSet.has(w) && !knownTier.has(w)),
    14,
    10
  ),
};

const payload = {
  meta: {
    version: 7,
    count: entries.length,
    cmuHits: cmuHitCount,
    glossHits: glossHitCount,
    posHits: posHitCount,
    noSuggestCount,
    verbParadigms: Object.keys(compiledVerbs).length,
    nounPlurals: Object.keys(compiledPlurals).length,
    brandCount: Object.keys(brandCasingMap).length,
  },
  brands: brandCasingMap,
  known: knownPayload,
  collocations,
  morphology: {
    verbs: compiledVerbs,
    plurals: compiledPlurals,
    inflectionToLemma,
    pastVerbs: Array.from(pastVerbSet),
  },
  entries,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(payload));

const sizeKB = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
console.log(
  `Known-token tiers: ${tierWords.map((t, i) => `T${i + 1}=${t.length}`).join(' ')} (bloom ${knownPayload.tiers.map((t) => `${(t.m / 8 / 1024).toFixed(0)}KB`).join(' + ')})`
);
console.log(
  `Built ${OUT_FILE}: ${entries.length} words, ${Object.keys(compiledVerbs).length} verb paradigms, ${Object.keys(compiledPlurals).length} noun plurals, ${MORPH_GHOST_SHIELD.size} non-standard plurals not suggested, ${sizeKB} KB`
);
