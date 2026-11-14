import {
  analyzeContext,
  computeContextBonus,
  isInflectionOfLemma,
} from './grammar';
import { BUILTIN_ALIASES, LexiconIndex } from './lexicon';
import { TokenShape, analyzeToken, looksLikePinyinName } from './tokens';
import {
  coarseToPlaceKey,
  damerauLevenshtein,
  initialLetterAnchorBonus,
  phonologicalDistance,
  phonologicalPrefixDistance,
  scoreSkeletonAbbreviation,
  spellingToPhonetic,
  weightedEslDistance,
} from './phonetic';
import {
  Candidate,
  MAX_CANDIDATES,
  ContextSignal,
  EngineQueryResult,
  LexiconEntry,
  MatchChannel,
  POS_FLAG_ADJ,
  POS_FLAG_ADV,
  POS_FLAG_NOUN,
  POS_FLAG_VERB,
} from './types';

// Function words: they say nothing about the topic of the sentence.
const STOP_CONTEXT_ANCHORS = new Set([
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'have', 'has', 'had', 'do', 'does', 'did',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'without', 'by', 'from', 'into', 'about', 'as',
  'and', 'or', 'but', 'so', 'if', 'when', 'while', 'than', 'then', 'not', 'no', 'very', 'quite',
  'can', 'cannot', 'could', 'will', 'would', 'should', 'must', 'may', 'might', 'just', 'also',
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'some', 'any', 'all', 'more', 'most',
]);

// Words that are easily confused with each other: typing one also offers the others.
const CONFUSABLE_HOMOPHONE_SIBLINGS: Record<string, string[]> = {
  complement: ['compliment'],
  compliment: ['complement'],
  complementary: ['complimentary'],
  complimentary: ['complementary'],
  affect: ['effect'],
  effect: ['affect'],
  principal: ['principle'],
  principle: ['principal'],
  stationary: ['stationery'],
  stationery: ['stationary'],
  discrete: ['discreet'],
  discreet: ['discrete'],
  statute: ['statue', 'stature'],
  statue: ['statute', 'stature'],
  elicit: ['illicit'],
  illicit: ['elicit'],
  eminent: ['imminent'],
  imminent: ['eminent'],
  ingenious: ['ingenuous'],
  ingenuous: ['ingenious'],
  adapt: ['adopt', 'adept'],
  adopt: ['adapt', 'adept'],
  perspective: ['prospective'],
  prospective: ['perspective'],
  precede: ['proceed'],
  proceed: ['precede'],
  thorough: ['through', 'though'],
  through: ['thorough', 'though'],
  though: ['through', 'thorough'],
  desert: ['dessert'],
  dessert: ['desert'],
  loose: ['lose'],
  lose: ['loose'],
  breath: ['breathe'],
  breathe: ['breath'],
  advice: ['advise'],
  advise: ['advice'],
  kernel: ['colonel'],
  colonel: ['kernel'],
  ankle: ['uncle'],
  uncle: ['ankle'],
  their: ['there', "they're"],
  there: ['their', "they're"],
  your: ["you're"],
  its: ["it's"],
  than: ['then'],
  then: ['than'],
};

/**
 * Score scale: 115 points = 10x word frequency (the scale of LexiconEntry.freq).
 *   candidate score  S(w) = freq(w) + context - cost(typed -> w)
 *   literal prior    L(q) = how plausible it is that the typed token is exactly what the user wants
 * Space replaces the typed token only when the best correction clearly beats both L(q) and the runner-up.
 * The numbers are tuned against the evaluation sets in eval/ (replay.ts, precision.ts, scenarios.ts);
 * change them only together with a run.
 */
export const TUNING = {
  typoUnit: 200,
  typoFirstLetter: 60,
  phonBase: 60,
  phonUnit: 300,
  phonOrthUnit: 40,
  phonLongerPenalty: 70,
  properNounPenalty: 60,
  skelBase: 70,
  skelUnit: 300,
  prefixBase: 40,
  prefixPerLetter: 22,
  exactBonus: 150,
  ctxScale: 5,
  collocationScale: 2.5,
  // Space decision: the best correction replaces the typed token when its cost is within
  //   allowed = decBias + decLen*len + decGap*lead + decFreq*(freq-550) + decSkel[full skeleton] - decCut*cut
  // `lead` = score lead over the best candidate of another word family (clamped), `cut` = how intentional the
  // typed token looks (attested somewhere / pinyin-shaped / two words glued together).
  // A long token landing near exactly one dictionary word is rarely a coincidence, a 4-letter one often is.
  decBias: -264,
  decLen: 34,
  decGap: 1.2,
  decFreq: 0.28,
  decSkel: 220,
  decTranspose: 180,
  decSound: 40,
  decCut: 1,
  cutTier: [0, 120, 999, 999],
  cutTitleCase: 150,
  cutPinyin: 300,
  cutCompound: 300,
  cutDerived: 400,
  transposeCost: 70,
  altWindow: 120,
  nearFixSlack: 150,
  // Keyboard slips (see keyboardSlips): the intended word must be very frequent - the shorter the typed
  // token the more so - the slip a likely one, and no other explanation may come close.
  slipMinFreq: [0, 0, 0, 760, 700, 620, 570, 530, 490] as number[], // by typed length; longer tokens use the last value
  slipMargin: [0, 0, 0, 140, 140, 115] as number[],
  slipMaxCost: 46,
  // Context may tip the balance between two readings but not decide it alone: on function words the
  // part-of-speech and topic signals are weak.
  slipCtxCap: 40,
  slipSecondSlip: 200,
  // A looser match is not applied over a plain slip that scores within this many points of it (or better).
  slipVetoSlack: 40,
  // A token that is attested somewhere as a rare name (`wil`, `arte`) needs a clearer lead.
  slipDoubtfulMargin: 20,
  minFixFreq: 430,
  minFixFreqLoose: 470,
  // ...and a word three or more letters away from what was typed has to be a common one.
  minFixFreqFar: 530,
  minFixScore: 150,
  maxFixCost: 400,
  familyEndingSlack: 80,
};

// Never re-inflected by the grammar rules, whatever a paradigm table claims (modals, function words).
const NEVER_INFLECT = new Set([
  'will', 'can', 'may', 'might', 'must', 'shall', 'should', 'would', 'could', 'and', 'but', 'or', 'yet', 'so',
  'if', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'to', 'up', 'not', 'no', 'yes', 'even', 'still', 'just',
  'well', 'back', 'down', 'out', 'off', 'over', 'be', 'am', 'is', 'are',
]);

// Very common verbs that also exist as nouns/adjectives but, right after he/she/it, are verbs.
const SAFE_AGREEMENT_VERBS = new Set([
  'like', 'work', 'need', 'want', 'look', 'love', 'help', 'use', 'live', 'mean', 'own', 'care', 'hope', 'wish',
  'feel', 'seem', 'show', 'talk', 'walk', 'run', 'play', 'start', 'stop', 'try', 'turn', 'move', 'change', 'plan',
  'miss', 'stay', 'wait', 'watch', 'call', 'ask', 'answer', 'matter', 'sound',
  'have', 'do', 'go', 'get', 'make', 'take', 'give', 'know', 'think', 'say', 'tell', 'see', 'come', 'keep',
]);

// Verbs that are safe to re-inflect after a singular noun subject (they do not form noun compounds).
const NP_SUBJECT_SAFE_VERBS = new Set([
  'want', 'need', 'like', 'know', 'think', 'say', 'tell', 'go', 'come', 'get', 'make', 'take', 'give', 'see',
  'keep', 'seem', 'become', 'bring', 'mean', 'feel', 'try', 'ask', 'have', 'do', 'love', 'hate', 'hope', 'prefer',
  'agree', 'believe', 'expect', 'require', 'provide', 'include', 'contain', 'allow', 'depend', 'exist', 'happen',
  'appear', 'remain', 'belong', 'decide', 'send', 'receive',
]);
const NP_DETERMINERS = new Set([
  'the', 'this', 'that', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'a', 'an', 'every', 'each',
]);
const NP_CLAUSE_STARTERS = new Set([
  'if', 'when', 'because', 'that', 'while', 'although', 'though', 'since', 'unless', 'once', 'whether', 'so',
  'but', 'think', 'thought', 'know', 'believe', 'hope', 'said', 'says', 'mean', 'means', 'sure',
]);
// Mass nouns that learners pluralise.
const UNCOUNTABLE_PLURALS = new Set([
  'informations', 'advices', 'furnitures', 'equipments', 'homeworks', 'knowledges', 'luggages', 'baggages',
  'softwares', 'hardwares', 'feedbacks', 'evidences', 'sceneries', 'machineries', 'jewelries', 'traffics',
  'musics', 'weathers', 'progresses',
]);
const NP_FUNCTION_HEADS = new Set(['who', 'whom', 'whose', 'which', 'what', 'that', 'there', 'here', 'one', 'ones', 'others', 'both', 'all', 'some', 'any', 'none', 'many', 'few', 'most', 'more', 'less']);
const NP_NOT_SINGULAR = new Set(['people', 'police', 'staff', 'cattle', 'folks', 'data', 'media', 'criteria', 'phenomena']);

const COMPOUND_PREFIXES = new Set([
  'un', 're', 'non', 'pre', 'de', 'dis', 'mis', 'over', 'under', 'sub', 'multi', 'anti', 'co', 'auto', 'micro',
  'macro', 'meta', 'mono', 'poly', 'semi', 'super', 'inter', 'intra', 'trans', 'cross', 'self', 'up', 'down',
  'out', 'off', 'on', 'back',
]);

/** One hypothesis for what the user meant. Costs are on the score scale; lower is better. */
interface Hyp {
  rawWord: string;
  display: string;
  gloss: string;
  channel: MatchChannel;
  /** Cheapest way to reach this word, completions included (ranking in the candidate list). */
  rankCost: number;
  /** Cheapest way to reach it as a correction of the whole typed token (Infinity = only a completion / suggestion). */
  fixCost: number;
  freq: number;
  /** Context points: grammatical slot, collocation, unprompted ending. */
  ctx: number;
  /** The word completes a collocation with the previous words. */
  collocation?: boolean;
  /** Certain enough to replace the typed token on Space. */
  high: boolean;
  /** Overrides the computed score (aliases, grammar promotions). */
  fixedScore?: number;
  startsWithVowel?: boolean;
  canonical?: string;
  posFlags: number;
  mayAutoCap: boolean;
  completion?: boolean;
  /** Especially trustworthy kinds of correction: two swapped neighbouring letters / an exact sound match. */
  strong?: 'transpose' | 'sound';
}

const DERIVATION_SUFFIXES = [
  'ically', 'ally', 'ly', 'ers', 'er', 'ness', 'less', 'able', 'ish', 'ful', 'ism', 'ists', 'ist', 'ized', 'izes',
  'izing', 'ize', 'ised', 'ise', 'like', 'wise',
];

// --- Keyboard slips -------------------------------------------------------------------------------
// The commonest real typing errors are single slips of the hand on short, very frequent words
// (`anf` and, `whn` when, `wil` will, `beeteen` between). They are judged by how the hand slips, not
// by how the result sounds: a neighbouring key, two letters swapped, a letter doubled or dropped.
// Keyboard rows with their horizontal offset (QWERTY).
const KEY_ROWS: [string, number][] = [['qwertyuiop', 0], ['asdfghjkl', 0.25], ['zxcvbnm', 0.75]];
const KEY_NEIGHBOURS: Record<string, string> = (() => {
  const pos: Record<string, [number, number]> = {};
  KEY_ROWS.forEach(([row, shift], y) => [...row].forEach((c, i) => (pos[c] = [i + shift, y])));
  const out: Record<string, string> = {};
  for (const a of Object.keys(pos)) {
    out[a] = Object.keys(pos)
      .filter((b) => {
        if (a === b) return false;
        const dx = Math.abs(pos[a][0] - pos[b][0]);
        const dy = Math.abs(pos[a][1] - pos[b][1]);
        return dy === 0 ? dx === 1 : dy === 1 && dx <= 1.1;
      })
      .join('');
  }
  return out;
})();
const SLIP_LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const SLIP_VOWELS = 'aeiou';
const SOUND_TWINS: Record<string, string> = { p: 'fb', f: 'pv', b: 'vp', v: 'bwf', w: 'v', l: 'r', r: 'l', j: 'zy', y: 'j', z: 'js', s: 'zc', c: 'ks', k: 'c' };

/**
 * Every string one hand slip away from `q`, with how unlikely that slip is in score points
 * (115 points = ten times less likely). The first letter is rarely the one that goes wrong.
 */
export function keyboardSlips(q: string): Map<string, number> {
  const out = new Map<string, number>();
  const put = (w: string, likelihood: number, atStart: boolean) => {
    if (w === q || w.length < 2) return;
    const cost = -115 * Math.log10(likelihood * (atStart ? 0.3 : 1));
    const prev = out.get(w);
    if (prev === undefined || cost < prev) out.set(w, cost);
  };
  const near = (a: string | undefined, b: string | undefined) => Boolean(a && b && KEY_NEIGHBOURS[a]?.includes(b));
  for (let i = 0; i < q.length; i++) {
    const head = q.slice(0, i);
    const ch = q[i];
    const tail = q.slice(i + 1);
    // two neighbouring letters typed in the wrong order
    if (i + 1 < q.length && ch !== q[i + 1]) put(head + q[i + 1] + ch + q.slice(i + 2), i === 0 ? 0.6 : 1, false);
    // the key next to the intended one
    for (const c of KEY_NEIGHBOURS[ch] ?? '') put(head + c + tail, 0.8, i === 0);
    // one vowel for another: not a slip of the hand but just as common (`thay` they, `definate`)
    if (SLIP_VOWELS.includes(ch)) for (const c of SLIP_VOWELS) if (c !== ch) put(head + c + tail, 0.5, i === 0);
    // sounds that many languages do not tell apart (`pinish` finish, `bery` very, `probrem` problem)
    for (const c of SOUND_TWINS[ch] ?? '') put(head + c + tail, 0.5, false);
    // a letter too many: doubled, brushed on the way to / from a neighbouring key, or a final -e added
    // out of habit (`probleme`, `restaurante`)
    const extra =
      ch === q[i - 1] || ch === q[i + 1] ? 0.8
      : near(ch, q[i - 1]) || near(ch, q[i + 1]) ? 0.5
      : ch === 'e' && i === q.length - 1 ? 0.5
      : 0.1;
    put(head + tail, extra, i === 0);
  }
  // a letter missing (most often one of a double)
  for (let i = 0; i <= q.length; i++) {
    for (const c of SLIP_LETTERS) {
      const doubled = c === q[i - 1] || c === q[i];
      put(q.slice(0, i) + c + q.slice(i), doubled ? 0.9 : 0.5, i === 0 && !doubled);
    }
  }
  return out;
}

/** Edit distance with swaps of neighbouring letters counted once. */
function plainEditDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/** `lenght` / `length`: same letters, exactly two neighbours swapped. */
function isAdjacentTransposition(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (i >= a.length - 1 || a[i] !== b[i + 1] || a[i + 1] !== b[i]) return false;
  return a.slice(i + 2) === b.slice(i + 2);
}

/** Collapse spelling variants of the same sound before comparing letters (`ph`=`f`, `ck`=`k`, silent `k`/`w`/`gh`). */
function normalizeDigraphs(word: string): string {
  return word
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'kw')
    .replace(/wh/g, 'w')
    .replace(/^kn/, 'n')
    .replace(/^wr/, 'r')
    .replace(/mb$/, 'm')
    .replace(/ght/g, 't')
    .replace(/tion/g, 'shon')
    .replace(/(.)\1/g, '$1');
}

function capitalize(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * Casing of a candidate. Whatever capital letters the user typed are kept; only all-lowercase input
 * gets brand casing (`github` -> `GitHub`) or sentence-initial capitalisation.
 */
function applyCasing(
  word: string,
  rawBase: string,
  shape: TokenShape,
  ctx: ContextSignal,
  canonicalBrand: string | undefined,
  mayAutoCap: boolean
): string {
  if (word.startsWith("I'") || word === 'i') {
    return 'I' + word.slice(1);
  }
  const sameWord = word.toLowerCase() === rawBase.toLowerCase();

  if (shape.casing === 'lower') {
    const suppressBrand = word === 'google' && ctx.afterModalOrTo;
    if (canonicalBrand && !suppressBrand) return canonicalBrand;
    if (mayAutoCap && ctx.capitalizeNext && /^[a-z]/.test(word)) {
      return capitalize(word);
    }
    return word;
  }

  if (sameWord) return rawBase;
  if (canonicalBrand && canonicalBrand[0].toLowerCase() === word[0].toLowerCase()) {
    return capitalize(canonicalBrand);
  }
  return capitalize(word);
}

/**
 * Context points against an ending the user did not type: when the token shows no sign of `-s`, `-ed`
 * or `-ing`, the base form is preferred to its inflection (`zombie` over `zombies`, `comfort` over
 * `comforting`) unless the context asks for a plural or a past form. Positive for a plural that the
 * context does ask for.
 */
function computeUnpromptedSuffixPenalty(
  query: string,
  word: string,
  lexicon: LexiconIndex,
  ctx: ContextSignal,
  posFlags: number
): number {
  if (word.length <= 3 || query === word) return 0;

  const baseLemma = lexicon.inflectionToLemma.get(word);

  // `word` is the plural of `baseLemma`.
  if (baseLemma && lexicon.nounPlurals.get(baseLemma) === word) {
    if (ctx.afterPluralQuantifier) {
      // The plural gets the bonus only when an -s / -z was typed; otherwise the singular wins and is
      // pluralised from the table afterwards (`person` -> `people`).
      if ((posFlags & POS_FLAG_NOUN) !== 0 && (query.endsWith('s') || query.endsWith('z'))) {
        return +26;
      }
      return -12;
    } else if (word.endsWith('s') && !query.endsWith('s') && !query.endsWith('z')) {
      return -24;
    }
  } else if (
    word.endsWith('s') &&
    word.length > 4 &&
    !word.endsWith('ss') &&
    !word.endsWith('ous') &&
    !word.endsWith('is') &&
    !word.endsWith('us') &&
    !query.endsWith('s') &&
    !query.endsWith('z') &&
    !ctx.afterPluralQuantifier &&
    baseLemma
  ) {
    return -24;
  }

  // -ing, when the token does not end in n / g
  if (word.endsWith('ing') && word.length > 5 && !query.endsWith('n') && !query.endsWith('g') && baseLemma) {
    return -28;
  }

  // -ed, when the token does not end in d / t and the context is not past or perfect
  if (
    word.endsWith('ed') &&
    word.length > 4 &&
    !query.endsWith('d') &&
    !query.endsWith('t') &&
    !ctx.hasPastMarker &&
    !ctx.afterHaveAux &&
    baseLemma
  ) {
    return -24;
  }

  return 0;
}

/**
 * The candidate engine. For a typed token and the text before it, each channel (alias, exact word,
 * grammar, prefix, skeleton, spelling slip, sound match) proposes hypotheses. They are scored as
 * frequency + context - cost, and the Space decision picks the one that replaces the typed token, if
 * any. Stateless: a result depends only on the arguments and the lexicon.
 */
export class VokaEngine {
  public readonly lexicon: LexiconIndex;

  constructor(lexicon: LexiconIndex) {
    this.lexicon = lexicon;
  }

  /** Words that commonly follow the previous one or two words, with their confidence. */
  private getClosedSetCollocationBoosts(ctx: ContextSignal): Map<string, number> {
    const map = new Map<string, number>();
    if (!ctx.lastWord || ctx.afterCopulaEntity) return map;

    if (ctx.prev2Word) {
      const triKey = `${ctx.prev2Word} ${ctx.lastWord}`;
      for (const [w, conf] of this.lexicon.collocations.trigrams[triKey] ?? []) {
        map.set(w.toLowerCase(), conf * 0.9);
      }
    }

    for (const [w, conf] of this.lexicon.collocations.bigrams[ctx.lastWord] ?? []) {
      const key = w.toLowerCase();
      if (!map.has(key)) {
        map.set(key, conf * 0.85);
      }
    }

    return map;
  }

  /** Tier of a token that is not in the lexicon (0-3), with a fallback for regular -s forms of known stems. */
  private knownTier(q: string): number {
    const lex = this.lexicon;
    let t: number = lex.known.tier(q);
    if (t >= 2 || q.length < 4 || !q.endsWith('s') || q.endsWith('ss')) return t;
    const stems = [q.slice(0, -1)];
    if (q.endsWith('es')) stems.push(q.slice(0, -2));
    if (q.endsWith('ies')) stems.push(q.slice(0, -3) + 'y');
    for (const s of stems) {
      if (s.length < 3) continue;
      if (lex.exactMap.has(s)) {
        // Only the attested plural / 3rd-person form counts (`childs`, `informations` stay suspicious).
        if (lex.nounPlurals.get(s) === q || lex.verbParadigms.get(s)?.thirdSingular === q) t = Math.max(t, 3);
      } else if (lex.known.tier(s) >= 2) {
        t = Math.max(t, 2);
      }
    }
    return t;
  }

  /**
   * Is the token two known words glued together?
   *   2 = two common words of 4+ letters each (`countrywide`, `leaderboard`): certainly intentional
   *   1 = a productive prefix + a word (`unexported`, `reusing`) or a shorter pair (`upvote`)
   *   0 = no
   */
  private compoundStrength(q: string): 0 | 1 | 2 {
    const n = q.length;
    if (n < 6) return 0;
    const lex = this.lexicon;
    const common = (w: string, minFreq: number): boolean => {
      const e = lex.exactMap.get(w);
      return Boolean(e && e.isCore && !e.noSuggest && e.freq >= minFreq);
    };
    let strength: 0 | 1 | 2 = 0;
    for (let i = 2; i <= n - 3; i++) {
      const left = q.slice(0, i);
      const right = q.slice(i);
      if (COMPOUND_PREFIXES.has(left) && (common(right, 480) || lex.known.tier(right) === 3)) {
        strength = 1;
        continue;
      }
      if (i < 3 || !common(right, 480) || !common(left, 480)) continue;
      if (i >= 4 && right.length >= 4 && common(left, 520) && common(right, 520)) return 2;
      strength = 1;
    }
    return strength;
  }

  /**
   * Clause-initial `determiner (+ adjective) + singular noun` right before the caret: `the user |`,
   * `my new boss |`, `I think the server |`. Deliberately narrow - anything else needs a parser.
   */
  private detectNounPhraseSubject(ctx: ContextSignal): boolean {
    if (ctx.hasPastMarker || ctx.isSentenceStart) return false;
    const w = ctx.prevWords;
    const k = w.length;
    if (k < 2) return false;
    const lex = this.lexicon;
    const noun = w[k - 1];
    const nounEntry = lex.exactMap.get(noun);
    if (!nounEntry || (nounEntry.posFlags & POS_FLAG_NOUN) === 0 || noun.length < 3) return false;
    if (NP_NOT_SINGULAR.has(noun) || NEVER_INFLECT.has(noun) || lex.inflectionToLemma.has(noun)) return false;
    // `patients who need`: a relative pronoun or other function word is not the head of a noun phrase.
    if (STOP_CONTEXT_ANCHORS.has(noun) || NP_FUNCTION_HEADS.has(noun)) return false;
    if (noun.endsWith('s') && !/(ss|us|is)$/.test(noun)) return false;
    let d = k - 2;
    if (!NP_DETERMINERS.has(w[d])) {
      const adj = lex.exactMap.get(w[d]);
      if (!adj || (adj.posFlags & POS_FLAG_ADJ) === 0 || d === 0 || lex.inflectionToLemma.has(w[d])) return false;
      d -= 1;
      if (!NP_DETERMINERS.has(w[d])) return false;
    }
    return d === 0 || NP_CLAUSE_STARTERS.has(w[d - 1]);
  }

  /** The correct form when `q` is a regular inflection of a word that does not inflect that way. */
  private overRegularised(q: string, wantParticiple: boolean): string | null {
    const lex = this.lexicon;
    if (UNCOUNTABLE_PLURALS.has(q)) {
      for (const cut of [1, 2, 3]) {
        const base = cut === 3 ? q.slice(0, -3) + 'y' : q.slice(0, -cut);
        if (lex.exactMap.has(base)) return base;
      }
    }
    if (q.endsWith('ed') && q.length >= 4) {
      const stems = [q.slice(0, -2), q.slice(0, -1)];
      if (q[q.length - 3] === q[q.length - 4]) stems.push(q.slice(0, -3)); // runned
      for (const stem of stems) {
        const p = lex.verbParadigms.get(stem);
        if (!p || !p.past) continue;
        const regular = new Set([stem + 'ed', stem + 'd', stem + stem[stem.length - 1] + 'ed', stem.replace(/y$/, 'ied')]);
        if (regular.has(p.past)) continue;
        const form = wantParticiple && p.participle ? p.participle : p.past;
        if (form !== q) return form;
      }
    }
    if (q.endsWith('s') && q.length >= 4) {
      for (const stem of [q.slice(0, -1), q.slice(0, -2)]) {
        const pl = lex.nounPlurals.get(stem);
        if (!pl || pl === q) continue;
        const regular = pl === stem + 's' || pl === stem + 'es' || pl === stem.replace(/y$/, 'ies');
        if (!regular && q === stem + 's') return pl; // childs, mans, womans, foots, tooths
        if (regular && q === stem + 'es' && pl === stem + 's') return pl; // monthes
      }
    }
    return null;
  }

  /** `scheduler`, `numerically`, `flavoury`: a common word plus a productive suffix. */
  private isDerivedFromKnown(q: string): boolean {
    const lex = this.lexicon;
    const solid = (stem: string): boolean => {
      if (stem.length < 4) return false;
      const e = lex.exactMap.get(stem);
      return Boolean(e && e.isCore && !e.noSuggest && e.freq >= 450);
    };
    for (const suffix of DERIVATION_SUFFIXES) {
      if (q.length < suffix.length + 4 || !q.endsWith(suffix)) continue;
      const stem = q.slice(0, -suffix.length);
      if (solid(stem) || solid(stem + 'e')) return true;
    }
    // `backfills`, `sidecars`: the plural / third person of a word that is in the lexicon.
    if (q.endsWith('s') && !q.endsWith('ss') && q.length >= 7) {
      const e = lex.exactMap.get(q.slice(0, -1));
      if (e && !e.noSuggest && (e.posFlags === 0 || (e.posFlags & (POS_FLAG_NOUN | POS_FLAG_VERB)) !== 0)) return true;
    }
    // `inexorably`, `visibly`: -able / -ible adjectives make their adverbs this way.
    if (/[ai]bly$/.test(q) && q.length >= 8 && lex.exactMap.has(q.slice(0, -1) + 'e')) return true;
    // `rubbery`, `sedimenty`, `flavoury`: noun + y. Not after l (`actualy`, `finaly` are misspellings of -ally).
    if (q.endsWith('y') && q.length >= 7 && !q.endsWith('ly')) {
      const stem = q.slice(0, -1);
      const e = lex.exactMap.get(stem);
      if (solid(stem) && e && (e.posFlags & POS_FLAG_NOUN) !== 0) return true;
    }
    return false;
  }

  /**
   * How intentional an out-of-lexicon token looks (score points taken off the correction allowance;
   * 999 = never corrected): attested somewhere, capitalised, pinyin-shaped, derived from or glued together
   * out of known words, or stretched for emphasis (`sooo`).
   */
  private intentCut(q: string, tier: number, titleCase: boolean): number {
    const T = TUNING;
    if (/(.)\1\1/.test(q)) return 999;
    let compound = this.compoundStrength(q);
    // `backfills`, `bookmarked`: an inflected compound is as intentional as the compound itself.
    if (compound < 2) {
      const base = /(s|ed|ing)$/.exec(q);
      if (base) compound = Math.max(compound, this.compoundStrength(q.slice(0, -base[1].length))) as 0 | 1 | 2;
    }
    if (compound === 2) return 999;
    let cut = T.cutTier[tier] ?? 999;
    if (titleCase) cut += T.cutTitleCase;
    if (looksLikePinyinName(q)) cut += T.cutPinyin;
    if (compound === 1) cut += T.cutCompound;
    if (this.isDerivedFromKnown(q)) cut += T.cutDerived;
    return cut;
  }

  /** Candidates for the token `rawQuery`, typed after `textBeforeCaret`. candidates[0] is what Space commits. */
  public query(rawQuery: string, textBeforeCaret = '', limit = MAX_CANDIDATES): EngineQueryResult {
    const T = TUNING;
    const lex = this.lexicon;
    const context = analyzeContext(textBeforeCaret, lex.pastVerbSet);
    context.nounPhraseSubject = this.detectNounPhraseSubject(context);

    if (!rawQuery) {
      return { rawQuery: '', isCodeLiteral: false, context, candidates: [], bestLongerCompletionIndex: -1, showWindow: false };
    }

    const typedCandidate = (word: string, score: number): Candidate => ({
      word,
      rawWord: word.toLowerCase(),
      gloss: '',
      channel: 'literal',
      score,
      isLiteral: word === rawQuery,
    });

    const shape = analyzeToken(rawQuery);
    if (shape.literal) {
      const word = shape.canonical ?? rawQuery;
      return {
        rawQuery,
        isCodeLiteral: Boolean(shape.codeLike),
        context,
        candidates: [typedCandidate(word, 1000)],
        bestLongerCompletionIndex: -1,
        showWindow: word !== rawQuery,
      };
    }

    const rawBase = shape.base;
    const q = rawBase.toLowerCase();
    const n = q.length;
    const hasTail = shape.tail.length > 0;
    const qPhon = spellingToPhonetic(q);
    const qAltPlace = qPhon.altCoarse ? coarseToPlaceKey(qPhon.altCoarse) : '';
    const collocationBoosts = this.getClosedSetCollocationBoosts(context);
    const hyps = new Map<string, Hyp>();

    const contextFor = (rawWord: string, posFlags: number) => {
      const slot = computeContextBonus(rawWord, context, posFlags);
      const col = collocationBoosts.get(rawWord) ?? 0;
      const collocation = col > 0 && rawWord.startsWith(q) ? col : 0;
      const morph = rawWord === q ? 0 : computeUnpromptedSuffixPenalty(q, rawWord, lex, context, posFlags);
      return {
        points: Math.round((slot + morph) * T.ctxScale + collocation * T.collocationScale),
        collocation: collocation > 0 && rawWord !== q,
      };
    };

    // Add a lexicon word as a hypothesis, or lower the costs of the one that is already there.
    const offer = (
      entry: LexiconEntry,
      channel: MatchChannel,
      rankCost: number,
      fixCost: number,
      completion = false
    ): Hyp => {
      let h = hyps.get(entry.word);
      if (!h) {
        const c = contextFor(entry.word, entry.posFlags);
        h = {
          rawWord: entry.word,
          display: entry.word,
          gloss: entry.gloss,
          channel,
          rankCost,
          fixCost,
          freq: entry.freq,
          ctx: c.points,
          collocation: c.collocation,
          high: false,
          startsWithVowel: entry.startsWithVowel,
          canonical: entry.canonicalCase,
          posFlags: entry.posFlags,
          mayAutoCap: entry.posFlags !== 0,
          completion,
        };
        hyps.set(entry.word, h);
      } else {
        if (rankCost < h.rankCost) {
          h.rankCost = rankCost;
          h.channel = channel;
          h.completion = completion;
        }
        if (fixCost < h.fixCost) h.fixCost = fixCost;
      }
      return h;
    };

    // Add a hypothesis with a fixed score (aliases, grammar forms); the highest fixed score wins.
    const offerSpecial = (
      display: string,
      gloss: string,
      channel: MatchChannel,
      fixedScore: number,
      high: boolean,
      entry?: LexiconEntry
    ): Hyp => {
      const rawWord = display.toLowerCase();
      const prev = hyps.get(rawWord);
      if (prev && (prev.fixedScore ?? -Infinity) >= fixedScore) return prev;
      const h: Hyp = {
        rawWord,
        display,
        gloss,
        channel,
        rankCost: 0,
        fixCost: Infinity,
        freq: entry?.freq ?? 700,
        ctx: 0,
        high,
        fixedScore,
        startsWithVowel: entry ? entry.startsWithVowel : /^[aeiou]/i.test(display),
        canonical: entry?.canonicalCase,
        posFlags: entry?.posFlags ?? 0,
        mayAutoCap: true,
      };
      hyps.set(rawWord, h);
      return h;
    };

    // --- Channel 0: aliases (contractions, chat shorthand, classic misspellings, jargon abbreviations) ---
    const alias =
      !hasTail && Object.prototype.hasOwnProperty.call(BUILTIN_ALIASES, q) ? BUILTIN_ALIASES[q] : undefined;
    let aliasHyp: Hyp | null = null;
    if (alias) {
      let target = alias.target;
      let gloss = alias.gloss;
      // `dont` follows the tense and the subject: didn't / doesn't.
      if (q === 'dont') {
        if (context.hasPastMarker && context.isVerbSlotAfterSubj) {
          target = "didn't";
          gloss = '过去式 (did not)';
        } else if (context.isThirdPersonSingularSubj || context.nounPhraseSubject) {
          target = "doesn't";
          gloss = '第三人称单数 (does not)';
        }
      }
      const targetEntry = lex.exactMap.get(target.toLowerCase());
      aliasHyp = offerSpecial(
        target,
        targetEntry?.gloss || gloss,
        'alias',
        alias.kind === 'abbrev' ? 1500 : 2000,
        alias.kind !== 'abbrev',
        targetEntry
      );
    }

    // --- Channel 1: the typed word itself + easily confused siblings ---
    const exactEntry = lex.exactMap.get(q);

    // --- A regular ending put on an irregular word (`goed` went, `buyed` bought, `childs` children,
    // `monthes` months, `informations` information): the intention is not in doubt. ---
    if (!aliasHyp && !exactEntry && !hasTail && shape.casing !== 'upper') {
      const repaired = this.overRegularised(q, context.afterHaveAux);
      const repairedEntry = repaired ? lex.exactMap.get(repaired) : undefined;
      if (repaired && repairedEntry && !repairedEntry.noSuggest) {
        aliasHyp = offerSpecial(repaired, repairedEntry.gloss, 'grammar', 2000, true, repairedEntry);
      }
    }
    let exactHyp: Hyp | null = null;
    if (exactEntry) {
      const hasBrand = Boolean(
        exactEntry.canonicalCase &&
          !(exactEntry.word === 'google' && context.afterModalOrTo)
      );
      exactHyp = offer(exactEntry, hasBrand ? 'brand' : 'exact', 0, Infinity);
      const siblings = Object.prototype.hasOwnProperty.call(CONFUSABLE_HOMOPHONE_SIBLINGS, q)
        ? CONFUSABLE_HOMOPHONE_SIBLINGS[q]
        : undefined;
      for (const sib of siblings ?? []) {
        const sibEntry = lex.exactMap.get(sib);
        if (sibEntry && !sibEntry.noSuggest) {
          offer(sibEntry, 'phonetic', 120, Infinity);
        } else if (sib.includes("'")) {
          offerSpecial(
            sib,
            sib === "they're" ? 'they are 缩写' : sib === "you're" ? 'you are 缩写' : 'it is 缩写',
            'phonetic',
            exactEntry.freq - 100,
            false
          );
        }
      }
    }

    const tier = exactEntry ? 4 : this.knownTier(q);
    const runFuzzy = !exactEntry && tier < 3 && n >= 3;

    // --- Channel 1b: verb tense / agreement from the paradigm table ---
    let grammarHigh: Hyp | null = null;
    if (n >= 2 && !hasTail) {
      const baseCandidate = exactEntry?.word ?? (alias?.kind === 'common_typo' ? alias.target : null);
      const baseEntry = baseCandidate ? lex.exactMap.get(baseCandidate) : undefined;
      const forms =
        baseCandidate && baseEntry && (baseEntry.posFlags & POS_FLAG_VERB) !== 0 && !NEVER_INFLECT.has(baseCandidate)
          ? lex.verbParadigms.get(baseCandidate)
          : undefined;
      if (baseCandidate && baseEntry && forms) {
        const baseGloss = exactEntry?.gloss?.split('；')[0] || 'v.';
        // Words that are mainly verbs may be re-inflected automatically; noun/adjective look-alikes
        // (`still`, `even`, `last`, `open`) only get a suggestion.
        const verbLike =
          forms.isPureVerb ||
          SAFE_AGREEMENT_VERBS.has(baseCandidate) ||
          (baseEntry.posFlags & (POS_FLAG_ADJ | POS_FLAG_ADV)) === 0;
        // `auto`: applied on Space; otherwise only offered.
        const add = (form: string, glossSuffix: string, auto: boolean) => {
          if (!form) return;
          const e = lex.exactMap.get(form);
          const h = offerSpecial(
            form,
            e?.gloss || `${baseGloss} (${glossSuffix})`,
            'grammar',
            auto ? 1900 : 1400,
            auto,
            e
          );
          if (auto) grammarHigh = h;
        };
        if (context.afterHaveAux && forms.participle !== baseCandidate) {
          add(forms.participle, '过去分词', forms.isPureVerb);
        } else if (context.isVerbSlotAfterSubj && context.hasPastMarker && forms.past !== baseCandidate) {
          // Automatic only with an explicit time expression (`yesterday I go`) or a coordinated past verb
          // (`she sang and leave`); a past verb somewhere earlier in the sentence proves nothing.
          const anchored = context.explicitPastTime || context.coordAfterPast;
          add(forms.past, '过去式', anchored && forms.isPureVerb);
        } else if (
          (context.isThirdPersonSingularSubj || context.nounPhraseSubject) &&
          forms.thirdSingular !== baseCandidate
        ) {
          // `he saw`, `she found`, `it cost`: the typed word may already be a past form - leave it alone.
          const maybePast =
            lex.pastVerbSet.has(baseCandidate) ||
            lex.inflectionToLemma.has(baseCandidate) ||
            forms.past === baseCandidate;
          // After a noun subject (`the user want`) a noun/verb word may just be the next noun of a compound
          // (`the user input`), so only unmistakable verbs are re-inflected automatically there.
          const safe = context.isThirdPersonSingularSubj
            ? verbLike
            : forms.isPureVerb || NP_SUBJECT_SAFE_VERBS.has(baseCandidate);
          add(forms.thirdSingular, '三单形式', safe && !maybePast);
        }
      }
    }

    // --- Channel 2: prefix completion (Tab only - never chosen by Space) ---
    let hasStrongPrefix = false;
    if (n === 1 && collocationBoosts.size > 0) {
      for (const lw of collocationBoosts.keys()) {
        if (!lw.startsWith(q) || lw === q) continue;
        const entry = lex.exactMap.get(lw);
        if (!entry || entry.noSuggest) continue;
        offer(entry, 'prediction', 30, Infinity, true);
      }
    }
    if (n >= 2 && !hasTail) {
      const prefixMatches = lex.findPrefixMatches(q, 22);
      if (prefixMatches.length > 0 && prefixMatches[0].freq >= 500) hasStrongPrefix = true;
      for (const entry of prefixMatches) {
        if (entry.noSuggest) continue;
        const missing = entry.word.length - n;
        let cost = T.prefixBase + T.prefixPerLetter * Math.min(missing, 8);
        if (exactEntry?.isCore && n >= 3 && isInflectionOfLemma(q, entry.word, lex.inflectionToLemma)) {
          cost += 60;
        }
        offer(entry, 'prefix', cost, Infinity, true);
      }
    }

    // --- Channel 3: consonant skeleton (`prsn`, `zmbie`) ---
    if (runFuzzy && n <= 10) {
      const bucket = lex.firstCharEntries.get(q[0]) ?? [];
      for (let i = 0; i < bucket.length; i++) {
        const entry = lex.entries[bucket[i]];
        if (!entry || entry.noSuggest) continue;
        if (entry.word.length <= n || entry.word.startsWith(q)) continue;
        const skel = scoreSkeletonAbbreviation(q, entry.word);
        if (skel < 0.56) continue;
        const cost = T.skelBase + T.skelUnit * (1 - skel);
        const isFullSkeleton = skel >= 0.9 && n >= 4;
        offer(entry, 'skeleton', cost, isFullSkeleton ? cost : Infinity, !isFullSkeleton);
      }
    }

    // --- Channel 4: spelling slips (weighted edit distance) ---
    if (runFuzzy) {
      const maxCost = n >= 7 ? 2.6 : 1.9;
      const ids = new Set<number>();
      for (const id of lex.first2CharEntries.get(q.slice(0, 2)) ?? []) ids.add(id);
      for (const id of lex.first2CharEntries.get(q[1] + q[0]) ?? []) ids.add(id);
      const first1 = lex.firstCharEntries.get(q[0]) ?? [];
      const scanCap = Math.min(first1.length, 900);
      for (let i = 0; i < scanCap; i++) ids.add(first1[i]);
      const qVowelCount = countFineVowels(qPhon.fine);

      for (const id of ids) {
        const entry = lex.entries[id];
        if (!entry || entry.noSuggest || entry.word === q) continue;
        if (Math.abs(entry.word.length - n) > 3) continue;
        const wDist = weightedEslDistance(q, entry.word, maxCost);
        if (wDist > maxCost) continue;
        // Two swapped neighbours or a missing / extra doubled letter: the most reliable kinds of slip.
        const transposed =
          n >= 5 && (isAdjacentTransposition(q, entry.word) || q.replace(/(.)\1/g, '$1') === entry.word.replace(/(.)\1/g, '$1'));
        let cost = transposed ? T.transposeCost : T.typoUnit * wDist;
        if (entry.word[0] !== q[0]) cost += T.typoFirstLetter;
        if (hasStrongPrefix && entry.word.length <= n && wDist >= 1.2) cost += 60;
        if (n >= 5 && qVowelCount > countFineVowels(entry.fine)) cost += 50;
        const phonDist = phonologicalDistance(qPhon.fine, entry.fine, 2.2);
        if (phonDist <= 0.25) cost -= 40;
        else if (phonDist <= 0.65) cost -= 20;
        if (entry.canonicalCase) cost += T.properNounPenalty;
        cost = Math.max(20, cost);
        const h = offer(entry, 'typo', cost, cost);
        if (transposed) h.strong = 'transpose';
      }
    }

    // --- Channel 5: spelled by ear (phonological distance on the fine phonetic code) ---
    if (runFuzzy && (qPhon.place.length >= 2 || (n >= 4 && qPhon.place.length === 1))) {
      const phoneticIds = new Set<number>();
      const queryPlaceKeys = new Set([qPhon.place, qAltPlace].filter(Boolean));
      const qOrthNorm = normalizeDigraphs(q);
      for (const pk of queryPlaceKeys) {
        for (const id of lex.placeExact.get(pk) ?? []) phoneticIds.add(id);
        if (pk.length >= 1) {
          for (const id of lex.placeSymDel1.get(pk) ?? []) phoneticIds.add(id);
          if (pk.length >= 3) {
            for (let k = 0; k < pk.length; k++) {
              const del = pk.slice(0, k) + pk.slice(k + 1);
              if (del.length >= 2) {
                for (const id of lex.placeExact.get(del) ?? []) phoneticIds.add(id);
              }
            }
          }
        }
      }
      for (const ck of [qPhon.coarse, qPhon.altCoarse]) {
        if (ck) {
          for (const id of lex.coarseExact.get(ck) ?? []) phoneticIds.add(id);
        }
      }
      if (n >= 4 && qPhon.place.length >= 3) {
        for (const pk of queryPlaceKeys) {
          if (pk.length >= 3) {
            for (const id of lex.placePrefix3.get(pk.slice(0, 3)) ?? []) phoneticIds.add(id);
          }
        }
      } else if (n >= 4 && qPhon.place.length === 2) {
        for (const id of lex.placePrefix2.get(qPhon.place) ?? []) phoneticIds.add(id);
      }

      const maxPhonCost = n <= 4 ? 0.65 : n <= 6 ? 1.25 : 1.95;
      const qVowels = countFineVowels(qPhon.fine);

      for (const id of phoneticIds) {
        const entry = lex.entries[id];
        if (!entry || entry.noSuggest || entry.word === q) continue;

        const dPlace = Math.min(
          damerauLevenshtein(qPhon.place, entry.place, 2),
          entry.altPlace ? damerauLevenshtein(qPhon.place, entry.altPlace, 2) : 99,
          qAltPlace ? damerauLevenshtein(qAltPlace, entry.place, 2) : 99
        );
        const dCoarse = Math.min(
          damerauLevenshtein(qPhon.coarse, entry.coarse, 2),
          entry.altCoarse ? damerauLevenshtein(qPhon.coarse, entry.altCoarse, 2) : 99,
          qPhon.altCoarse ? damerauLevenshtein(qPhon.altCoarse, entry.coarse, 2) : 99
        );
        const initBonus = initialLetterAnchorBonus(q[0], entry.word[0]);

        let matchedFull = false;
        if (dPlace <= 1 && Math.abs(entry.word.length - n) <= 5) {
          // Compare against the dictionary pronunciation and against the code the word's own spelling
          // yields under the typed-input rules (`fone` and `phone` spell the same sound).
          const primaryDist = Math.min(
            phonologicalDistance(qPhon.fine, entry.fine, maxPhonCost),
            entry.orthFine !== entry.fine
              ? phonologicalDistance(qPhon.fine, entry.orthFine, maxPhonCost) + 0.05
              : 99
          );
          const vocalizedFinalL =
            qVowels >= 1 &&
            Boolean(entry.altCoarse) &&
            entry.altCoarse.endsWith('L') &&
            (qPhon.coarse + 'L' === entry.altCoarse || qPhon.altCoarse + 'L' === entry.altCoarse) &&
            /[auo]$/.test(qPhon.fine);
          const strictAltMatch =
            (qVowels >= Math.max(1, countFineVowels(entry.fine) - 1) &&
              Boolean(
                entry.altCoarse &&
                  (qPhon.coarse === entry.altCoarse || qPhon.altCoarse === entry.altCoarse)
              )) ||
            vocalizedFinalL;
          const dist = strictAltMatch ? Math.min(primaryDist, 0.32) : primaryDist;

          if (dist <= maxPhonCost) {
            matchedFull = true;
            let cost = T.phonBase + T.phonUnit * dist + (16 - initBonus) * 1.5;
            if (entry.fine.length < qPhon.fine.length - 1) cost += 90;
            else if (n >= 5 && qVowels > countFineVowels(entry.fine)) cost += 55;
            if (!(dCoarse === 0 || strictAltMatch)) cost += dPlace === 0 ? 15 : 30;
            // Spelling by ear simplifies; it rarely adds letters. `lenght` is not an attempt at `lent`.
            if (n - entry.word.length >= 2) cost += T.phonLongerPenalty * (n - entry.word.length - 1);
            // Letter similarity backs up an imperfect sound match (`familar`: familiar, not family). A perfect
            // sound match needs no such backing - respelling by ear is far from the real spelling by nature.
            const orthWeight = Math.max(0.15, Math.min(1, (dist - 0.15) / 0.45));
            cost +=
              T.phonOrthUnit * orthWeight * Math.min(5, weightedEslDistance(qOrthNorm, normalizeDigraphs(entry.word), 4));
            // Names and brands are rarely what a misspelling was aiming at.
            if (entry.canonicalCase) cost += T.properNounPenalty;
            cost = Math.max(20, cost);
            const h = offer(entry, 'phonetic', cost, cost);
            if (dist <= 0.12 && !h.strong) h.strong = 'sound';
          }
        }

        const isPlacePrefix =
          n >= 4 &&
          entry.word.length >= n + 2 &&
          entry.fine.length > qPhon.fine.length &&
          (entry.place.startsWith(qPhon.place) ||
            (entry.altPlace.length >= 3 && entry.altPlace.startsWith(qPhon.place)) ||
            (qAltPlace.length >= 3 && entry.place.startsWith(qAltPlace)));
        if (!matchedFull && isPlacePrefix) {
          const maxPrefixCost = n <= 5 ? 0.65 : 1.15;
          const prefixDist = phonologicalPrefixDistance(qPhon.fine, entry.fine, maxPrefixCost);
          if (prefixDist <= maxPrefixCost) {
            const missing = Math.min(8, entry.word.length - n);
            const cost =
              T.phonBase + T.prefixBase + T.prefixPerLetter * missing + T.phonUnit * prefixDist + (16 - initBonus) * 1.5;
            offer(entry, 'phonetic', cost, Infinity, true);
          }
        }
      }
    }

    // Words one hand slip away: offered as suggestions here; the Space decision below may promote one.
    const slips = new Map<string, number>();
    let slipStrings = new Map<string, number>();
    // (a capitalised token only at the start of a sentence: elsewhere the capital says "name")
    if (!exactEntry && n >= 3 && n <= 14 && (shape.casing === 'lower' || (shape.casing === 'title' && context.isSentenceStart))) {
      slipStrings = keyboardSlips(q);
      for (const [word, cost] of slipStrings) {
        const entry = lex.exactMap.get(word);
        if (!entry || entry.noSuggest) continue;
        slips.set(word, cost);
        if (!hyps.has(word)) offer(entry, 'typo', 200 + cost, Infinity);
      }
    }

    const scoreOf = (h: Hyp): number =>
      h.fixedScore ?? h.freq + h.ctx - h.rankCost + (h.rawWord === q ? T.exactBonus : 0);
    const fixScoreOf = (h: Hyp): number => h.freq + h.ctx - h.fixCost;

    let ordered = Array.from(hyps.values()).sort((a, b) => scoreOf(b) - scoreOf(a));
    /** The correction that almost made it: it leads the suggestions (so Tab takes it). */
    let nearFix: Hyp | null = null;
    const lemmaOf = (w: string) => lex.inflectionToLemma.get(w) ?? w;
    /** Same word family: inflections of one lemma, or one is a short derivation of the other (-ly, -s, -ed, -al). */
    const sameFamily = (a: string, b: string): boolean => {
      if (lemmaOf(a) === lemmaOf(b)) return true;
      const min = Math.min(a.length, b.length);
      let common = 0;
      while (common < min && a[common] === b[common]) common++;
      return common >= Math.max(4, min - 2);
    };

    // `form` is `base` with a regular ending. The known-token filter is probabilistic, and many strings one
    // slip away from the typed token are tried against it; a form must also be built like an inflection.
    const INFLECTION_ENDINGS = new Set(['s', 'es', 'd', 'ed', 'ing', 'ly', 'er', 'est']);
    const isInflectionOf = (form: string, base: string): boolean => {
      const stems = [base];
      if (base.endsWith('e')) stems.push(base.slice(0, -1)); // making
      if (base.endsWith('y')) stems.push(`${base.slice(0, -1)}i`); // tried, happily
      if (base.length > 2) stems.push(base + base[base.length - 1]); // stopped
      return stems.some((stem) => form.startsWith(stem) && INFLECTION_ENDINGS.has(form.slice(stem.length)));
    };

    // --- Space decision: which hypothesis (if any) replaces the typed token ---
    const cut = exactEntry ? Infinity : this.intentCut(q, tier, shape.casing === 'title');
    let budget = -Infinity;
    let primary: Hyp | null = null;
    if (aliasHyp && aliasHyp.high) {
      primary = aliasHyp;
    } else if (exactEntry) {
      primary = grammarHigh;
    } else if (n >= 4 && tier < 3 && !(shape.casing === 'title' && !context.isSentenceStart)) {
      const eligible = ordered
        .filter((h) => h.fixCost < Infinity)
        .sort((a, b) => fixScoreOf(b) - fixScoreOf(a));
      let best = eligible[0];
      if (best) {
        // Inside one word family the typed ending decides which form was meant:
        // `containg` -> containing (not contain), `studens` -> students, `particulary` -> particularly.
        const head = best;
        const lastCh = q[n - 1];
        const swapped = head.strong
          ? undefined
          : eligible.find((h) => h !== head && h.strong === 'transpose' && sameFamily(h.rawWord, head.rawWord));
        if (swapped) {
          // `jumsp`: the swapped-letters reading (jumps) beats the shorter family member (jump).
          best = swapped;
        } else if (head.rawWord[head.rawWord.length - 1] !== lastCh) {
          const sibling = eligible.find(
            (h) =>
              h !== head &&
              h.rawWord[h.rawWord.length - 1] === lastCh &&
              h.fixCost <= head.fixCost + T.familyEndingSlack &&
              sameFamily(h.rawWord, head.rawWord)
          );
          if (sibling) best = sibling;
        }
        // The form one hand slip away is the one that was typed: `comea` is `comes` (a next to s), not
        // `come` with a stray letter; `bottlencks` is `bottlenecks`, not `bottleneck`.
        {
          const costOf = (h: Hyp) => slips.get(h.rawWord) ?? Infinity;
          let closest = best;
          for (const [word] of slips) {
            const h = hyps.get(word);
            if (!h || h === best || !sameFamily(h.rawWord, best.rawWord)) continue;
            if (costOf(h) < costOf(closest)) closest = h;
          }
          // (the typed ending still counts: `happend` ends like happened, `respone` like response)
          const endsAsTyped = (h: Hyp) => h.rawWord[h.rawWord.length - 1] === q[n - 1];
          if (endsAsTyped(best) && !endsAsTyped(closest)) closest = best;
          if (closest !== best && costOf(closest) <= T.slipMaxCost && costOf(closest) + 20 <= costOf(best)) {
            if (closest.fixCost === Infinity) closest.fixCost = best.fixCost;
            best = closest;
          } else if (costOf(best) > T.slipMaxCost) {
            // The same for an inflected form that is a real word but has no lexicon entry of its own.
            let form = '';
            let formCost = Infinity;
            for (const [word, cost] of slipStrings) {
              if (cost >= formCost || cost > T.slipMaxCost || cost + 60 > costOf(best)) continue;
              if (lex.exactMap.has(word) || lex.known.tier(word) < 3 || !sameFamily(word, best.rawWord)) continue;
              if (!isInflectionOf(word, best.rawWord) && !isInflectionOf(word, lemmaOf(best.rawWord))) continue;
              form = word;
              formCost = cost;
            }
            if (form) {
              const base = best;
              const h = offerSpecial(form, base.gloss, 'typo', scoreOf(base), false);
              h.fixedScore = undefined;
              h.freq = base.freq;
              h.ctx = base.ctx;
              h.rankCost = base.rankCost;
              h.fixCost = base.fixCost;
              h.posFlags = base.posFlags;
              slips.set(form, formCost);
              best = h;
            }
          }
        }
        // The runner-up must be a real alternative explanation: another word family, and not far more
        // expensive to reach than the best one (a frequent word reached by a strained match does not count).
        const second = eligible.find(
          (h) =>
            h !== best &&
            h !== head &&
            h.fixCost <= best.fixCost + T.altWindow &&
            !sameFamily(h.rawWord, best.rawWord)
        );
        const gap = second ? fixScoreOf(best) - fixScoreOf(second) : Infinity;
        const freq = Math.max(best.freq, head.freq);
        const lead = Math.max(-100, Math.min(400, gap));
        budget =
          T.decBias +
          T.decLen * Math.min(n, 12) +
          T.decGap * lead +
          T.decFreq * (freq - 550) +
          (best.channel === 'skeleton' ? T.decSkel : 0) +
          (best.strong === 'transpose' ? T.decTranspose : best.strong === 'sound' ? T.decSound : 0) -
          T.decCut * cut;
        // A word one plain slip away from what was typed is a standing objection to a looser match:
        // `plesent` is `pleasant` with a letter missing before it is `present`, and `consisiting` is
        // `consisting` long before it is `concertina`. Then nothing is replaced; Tab offers the slip.
        const slipStanding = (h: Hyp) => h.freq + h.ctx - (slips.get(h.rawWord) ?? Infinity);
        const chosenFix = best;
        // The chosen word is judged by its own best explanation: as a plain slip if it is one, otherwise as
        // a looser match that costs at least as much as the number of separate slips it would take
        // (`roughyl` is one swap from `roughly` and five edits from `really`).
        const edits = plainEditDistance(q, chosenFix.rawWord);
        // (a doubled letter, a neighbouring key or a swap that gives a common word outweighs a sound match:
        // `bookk` is `book`, not `back`)
        let nearCertainSlip = false;
        for (const [word, cost] of slips) {
          const h = hyps.get(word);
          if (h && h !== chosenFix && cost <= 12 && h.freq >= 560) nearCertainSlip = true;
        }
        // ...unless it is an exact sound match: spelling by ear (`rili` really, `tumoro` tomorrow) is far
        // from the target letter by letter and still exactly what was meant.
        const looseStanding =
          chosenFix.freq +
          chosenFix.ctx -
          (chosenFix.strong === 'sound' && !nearCertainSlip ? chosenFix.fixCost : Math.max(chosenFix.fixCost, 100 * (edits - 1)));
        const chosenStanding = Math.max(looseStanding, slipStanding(chosenFix));
        // For the order of suggestions (as opposed to replacing on Space) context keeps its full say:
        const chosenStandingAsSuggestion = Math.max(fixScoreOf(chosenFix), slipStanding(chosenFix));
        let slipRival: Hyp | null = null;
        for (const word of slips.keys()) {
          const h = hyps.get(word);
          if (!h || h === chosenFix || lemmaOf(h.rawWord) === lemmaOf(chosenFix.rawWord)) continue;
          // The typed ending is evidence too: `respone` ends like `response`, not like `respond`.
          if (chosenFix.rawWord[chosenFix.rawWord.length - 1] === q[n - 1] && h.rawWord[h.rawWord.length - 1] !== q[n - 1]) continue;
          if (slipStanding(h) >= chosenStanding - T.slipVetoSlack && (!slipRival || slipStanding(h) > slipStanding(slipRival))) {
            slipRival = h;
          }
        }
        // A rare word is a weak magnet: an unknown token next to it is as likely to be another rare word,
        // a name or a foreign term (`tonkotsu` is not `tonkatsu`, `mansaf` is not `massif`). Such a target is
        // only applied when the slip is unmistakable (swapped letters, same sound, a neighbouring key).
        const unmistakable = Boolean(best.strong) || (slips.get(best.rawWord) ?? Infinity) <= 12;
        // A token that occurs in text is not a spelling by ear: it is only replaced by a word close to it
        // (`poroshenko` is not `precinct`). The far word is still what Tab offers.
        const farFromAttested = lex.known.attested(q) && !unmistakable && edits >= 3;
        const wouldAccept =
          !farFromAttested &&
          best.fixCost <= Math.min(budget, T.maxFixCost) &&
          freq >= (unmistakable ? T.minFixFreq : edits >= 3 ? T.minFixFreqFar : T.minFixFreqLoose) &&
          fixScoreOf(best) >= T.minFixScore;
        // Even when nothing would be replaced, a likely slip that clearly outscores the looser match is
        // the better thing for Tab to offer.
        const slipLeads =
          slipRival !== null &&
          (slips.get(slipRival.rawWord) ?? Infinity) <= T.slipMaxCost &&
          slipStanding(slipRival) >= chosenStandingAsSuggestion + T.slipVetoSlack;
        if (wouldAccept && slipRival) {
          nearFix = slipRival;
        } else if (wouldAccept) {
          primary = best;
        } else if (slipLeads) {
          nearFix = slipRival;
        } else if (
          best.fixCost <= budget + (hasStrongPrefix ? T.nearFixSlack / 4 : T.nearFixSlack) &&
          best.fixCost <= T.maxFixCost
        ) {
          nearFix = best;
        }
        // An unfinished word is not a misspelling: when what was typed is the beginning of a word from
        // another family that scores at least as well as the best correction (`to recom`: recommend vs the
        // sound-alike reckon), Space keeps it as typed and the completion is what Tab takes.
        const chosen = best;
        const completionRival = ordered.find(
          (h) =>
            h.completion &&
            h.channel === 'prefix' &&
            !sameFamily(h.rawWord, chosen.rawWord) &&
            scoreOf(h) >= fixScoreOf(chosen)
        );
        if (completionRival) {
          primary = null;
          nearFix = null;
        }
      }
    }

    // --- An obvious slip of the hand on a very frequent word ---
    if (
      !primary &&
      slips.size > 0 &&
      !exactEntry &&
      !(aliasHyp && aliasHyp.high) &&
      tier <= 1 &&
      cut <= (T.cutTier[tier] ?? 0)
    ) {
      const at = (table: number[]) => table[Math.min(n, table.length - 1)];
      const ctxOf = (h: Hyp) => Math.max(-T.slipCtxCap, Math.min(T.slipCtxCap, h.ctx));
      const slipScore = (h: Hyp) => h.freq + ctxOf(h) - (slips.get(h.rawWord) ?? Infinity);
      const pool = Array.from(hyps.values()).filter((h) => h.rawWord !== q);
      let best: Hyp | null = null;
      for (const h of pool) {
        if ((slips.get(h.rawWord) ?? Infinity) > T.slipMaxCost) continue; // unlikely slips are rivals, not candidates
        if (h.rawWord.length < 3) continue; // `opn` is open, `wde` is wide: never down to a two-letter word
        if (!best || slipScore(h) > slipScore(best)) best = h;
      }
      if (best && best.freq >= at(T.slipMinFreq)) {
        const chosen = best;
        // Every other reading of the token counts against it, by its own best explanation.
        let rival = -Infinity;
        for (const h of pool) {
          // (No word-family exemption here: `ther` is as much `there` / `their` as it is `the`.)
          if (h === chosen) continue;
          // A reading that needs more than one slip is far less likely than its sound-alike or
          // letter-distance cost suggests (`wil` is `will`, not `well`).
          const r = Math.max(
            slips.has(h.rawWord) ? slipScore(h) : -Infinity,
            h.fixCost < Infinity ? h.freq + ctxOf(h) - Math.max(h.fixCost, T.slipSecondSlip) : -Infinity
          );
          if (r > rival) rival = r;
        }
        // An unfinished word is not a slip either (`tomo` is tomorrow cut short, not `too`).
        const unfinished = pool.some(
          (h) => h !== chosen && h.completion && h.channel === 'prefix' && h.freq + ctxOf(h) - h.rankCost >= slipScore(chosen) - at(T.slipMargin)
        );
        // Strong evidence from the sentence for another reading is an objection even when that reading is
        // further away letter by letter (`ate a sweet dezert`: dessert, although desert is one key off).
        const contextObjection = pool.some(
          (h) =>
            h !== chosen &&
            h.fixCost < Infinity &&
            h.ctx - chosen.ctx >= 90 &&
            fixScoreOf(h) >= slipScore(chosen) - 60
        );
        if (!unfinished && !contextObjection && slipScore(chosen) - rival >= at(T.slipMargin) + (tier === 1 ? T.slipDoubtfulMargin : 0)) {
          chosen.fixCost = Math.min(chosen.fixCost, 50 + (slips.get(chosen.rawWord) ?? 0));
          chosen.channel = 'typo';
          primary = chosen;
          nearFix = null;
        } else {
          // Not sure enough to replace - but the likeliest slip is what Tab should offer, ahead of a
          // sound-alike or of a much rarer word that merely starts the same way (`noe`: now, not noel).
          const completionBest = pool.reduce(
            (m, h) => (h.completion && h.channel === 'prefix' ? Math.max(m, h.freq + ctxOf(h) - h.rankCost) : m),
            -Infinity
          );
          if (!nearFix && slipScore(chosen) >= completionBest + 60) nearFix = chosen;
        }
      }
    }

    // --- Noun plural after a plural quantifier (`many person` -> `people`), paradigm table only ---
    if (context.afterPluralQuantifier && !hasTail) {
      const top = primary ?? exactHyp;
      const plural = top ? lex.nounPlurals.get(top.rawWord) : undefined;
      if (top && plural && plural !== top.rawWord) {
        const pluralEntry = lex.exactMap.get(plural);
        if (pluralEntry && !pluralEntry.noSuggest) {
          const topEntry = lex.exactMap.get(top.rawWord);
          const isFuzzyInput = top.rawWord !== q;
          const isNoun = Boolean(topEntry && (topEntry.posFlags & POS_FLAG_NOUN) !== 0 && top.rawWord.length >= 3);
          const unambiguousCountNoun =
            !lex.verbParadigms.has(top.rawWord) &&
            (topEntry ? (topEntry.posFlags & (POS_FLAG_ADJ | POS_FLAG_ADV)) === 0 : true) &&
            (pluralEntry.posFlags & POS_FLAG_NOUN) !== 0;
          // `both` is also `both X and Y`, where X stays singular: only irregular plurals are safe there.
          const regularPlural = plural === top.rawWord + 's' || plural === top.rawWord + 'es';
          // A singular noun after a quantifier is very often a modifier (`many customer support tickets`,
          // `those user accounts`), and the next word is not known yet. Only an irregular plural
          // (`two child` -> children) is applied; a regular one is only offered as a suggestion (Tab).
          // Text that is already committed is never changed afterwards on a guess about grammar.
          const promote =
            isNoun &&
            !regularPlural &&
            (isFuzzyInput || unambiguousCountNoun);
          const ph = offerSpecial(
            plural,
            pluralEntry.gloss || top.gloss,
            'grammar',
            promote ? 1950 : 1400,
            promote,
            pluralEntry
          );
          if (promote) primary = ph;
          else if (!ordered.includes(ph)) ordered.unshift(ph);
        }
      }
    }

    // Order of the suggestions for a token that is not a word:
    //   1. the correction that almost qualified, 2. completions of the typed prefix (it was probably cut
    //   short on purpose - `tomo`: tomorrow, not the sound-alike `time`), 3. everything else by score.
    if (!exactEntry) {
      const rank = (h: Hyp): number =>
        scoreOf(h) + (h === nearFix ? 2000 : h.completion && h.channel === 'prefix' ? 1000 : 0);
      ordered = ordered.slice().sort((a, b) => rank(b) - rank(a));
    }

    // --- Assemble the list: [what Space commits, the typed token if it was replaced, other suggestions...] ---
    const toCandidate = (h: Hyp): Candidate => {
      const word = applyCasing(h.display, rawBase, shape, context, h.canonical, h.mayAutoCap) + shape.tail;
      let prevWordFix: Candidate['prevWordFix'];
      const isAcronym = Boolean(h.canonical && /^[A-Z]{2,}s?$/.test(h.canonical));
      // `a is`, `a in`: a letter / variable called `a`, not an article in front of a noun phrase.
      const isFunctionWord = STOP_CONTEXT_ANCHORS.has(h.rawWord) || h.rawWord.length <= 2;
      if (context.afterArticleA && h.startsWithVowel !== undefined && !isAcronym && !isFunctionWord) {
        if (context.afterArticleA === 'a' && h.startsWithVowel) {
          prevWordFix = { from: 'a', to: 'an' };
        } else if (context.afterArticleA === 'an' && !h.startsWithVowel) {
          prevWordFix = { from: 'an', to: 'a' };
        }
      }
      return {
        word,
        rawWord: h.rawWord,
        gloss: h.gloss,
        channel: h.collocation ? 'prediction' : h.channel,
        score: Math.round(scoreOf(h) * 10) / 10,
        isLiteral: word === rawQuery,
        isCompletion: Boolean(h.completion),
        prevWordFix,
        freq: h.freq,
        context: h.ctx,
        cost: Math.round(h.rankCost),
        fixScore: h.fixCost < Infinity ? Math.round(fixScoreOf(h)) : undefined,
      };
    };

    const out: Candidate[] = [];
    const seen = new Set<string>();
    const push = (c: Candidate) => {
      if (out.length < limit && !seen.has(c.word)) {
        seen.add(c.word);
        out.push(c);
      }
    };

    const exactCand = exactHyp ? toCandidate(exactHyp) : null;
    const typedCand =
      exactCand && exactCand.word === rawQuery
        ? exactCand
        : typedCandidate(rawQuery, 400);

    const first = primary ? toCandidate(primary) : exactCand ?? typedCand;
    push(first);
    if (first.word !== rawQuery) push(typedCand);
    for (const h of ordered) {
      if (out.length >= limit) break;
      if (h.rawWord === q && !exactHyp) continue;
      push(toCandidate(h));
    }

    return {
      rawQuery,
      isCodeLiteral: false,
      context,
      candidates: out,
      bestLongerCompletionIndex: out.findIndex((c) => c.word !== rawQuery),
      // Shown whenever there is something to tell: another candidate, or the meaning of the typed word.
      showWindow: out.length > 1 || (out.length === 1 && (out[0].word !== rawQuery || out[0].gloss !== '')),
      fixBudget: Number.isFinite(budget) ? Math.round(budget) : undefined,
    };
  }
}

function countFineVowels(fine: string): number {
  let c = 0;
  for (let i = 0; i < fine.length; i++) {
    const ch = fine[i];
    if (ch === 'a' || ch === 'e' || ch === 'i' || ch === 'u' || ch === 'o') c++;
  }
  return c;
}
