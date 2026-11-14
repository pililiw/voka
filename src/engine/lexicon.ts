import { KnownTokens, RawKnownPayload } from './known';
import { coarseToPlaceKey, spellingToPhonetic } from './phonetic';
import { LexiconEntry } from './types';

/** Likely next words after one word (bigrams) or two (trigrams), each with a confidence. */
export interface RawCollocations {
  bigrams: Record<string, [string, number][]>;
  trigrams: Record<string, [string, number][]>;
}

export interface RawMorphology {
  verbs: Record<string, [string, string, string, string, number]>; // lemma -> [past, participle, thirdSingular, presentParticiple, isPureVerb]
  plurals: Record<string, string>; // singular -> plural
  inflectionToLemma: Record<string, string>; // inflected form -> lemma
  pastVerbs: string[]; // unambiguous past-tense verb forms
}

/** `data/dict.json`, as written by scripts/build-dictionary.mjs. */
export interface RawDictPayload {
  meta: {
    version: number;
    count: number;
    brandCount?: number;
  };
  brands?: Record<string, string>;
  known?: RawKnownPayload;
  collocations?: RawCollocations;
  morphology?: RawMorphology;
  /** [word, freq, coarse, altCoarse, fine, gloss, flags] */
  entries: [string, number, string, string, string, string, number][];
  }

/**
 * Alias kinds:
 *  - contraction / shorthand / common_typo: high certainty, Space replaces the typed token.
 *  - abbrev: jargon or chat abbreviations people type on purpose (`repo`, `auth`, `ur`). The typed
 *    token stays first; the expansion is only offered (Tab / pick).
 */
export interface AliasEntry {
  target: string;
  gloss: string;
  kind: 'contraction' | 'shorthand' | 'common_typo' | 'abbrev';
}

export const BUILTIN_ALIASES: Record<string, AliasEntry> = {
  // Contractions
  dont: { target: "don't", gloss: 'do not 缩写', kind: 'contraction' },
  doesnt: { target: "doesn't", gloss: 'does not 缩写', kind: 'contraction' },
  didnt: { target: "didn't", gloss: 'did not 缩写', kind: 'contraction' },
  cant: { target: "can't", gloss: 'cannot 缩写', kind: 'contraction' },
  wont: { target: "won't", gloss: 'will not 缩写', kind: 'contraction' },
  wouldnt: { target: "wouldn't", gloss: 'would not 缩写', kind: 'contraction' },
  couldnt: { target: "couldn't", gloss: 'could not 缩写', kind: 'contraction' },
  shouldnt: { target: "shouldn't", gloss: 'should not 缩写', kind: 'contraction' },
  isnt: { target: "isn't", gloss: 'is not 缩写', kind: 'contraction' },
  arent: { target: "aren't", gloss: 'are not 缩写', kind: 'contraction' },
  wasnt: { target: "wasn't", gloss: 'was not 缩写', kind: 'contraction' },
  werent: { target: "weren't", gloss: 'were not 缩写', kind: 'contraction' },
  havent: { target: "haven't", gloss: 'have not 缩写', kind: 'contraction' },
  hasnt: { target: "hasn't", gloss: 'has not 缩写', kind: 'contraction' },
  hadnt: { target: "hadn't", gloss: 'had not 缩写', kind: 'contraction' },
  im: { target: "I'm", gloss: 'I am 缩写', kind: 'contraction' },
  ive: { target: "I've", gloss: 'I have 缩写', kind: 'contraction' },
  youre: { target: "you're", gloss: 'you are 缩写', kind: 'contraction' },
  youve: { target: "you've", gloss: 'you have 缩写', kind: 'contraction' },
  theyre: { target: "they're", gloss: 'they are 缩写', kind: 'contraction' },
  weve: { target: "we've", gloss: 'we have 缩写', kind: 'contraction' },
  thats: { target: "that's", gloss: 'that is 缩写', kind: 'contraction' },
  whats: { target: "what's", gloss: 'what is 缩写', kind: 'contraction' },
  lets: { target: "let's", gloss: 'let us 缩写', kind: 'abbrev' },

  theres: { target: "there's", gloss: 'there is 缩写', kind: 'contraction' },
  heres: { target: "here's", gloss: 'here is 缩写', kind: 'contraction' },
  whos: { target: "who's", gloss: 'who is 缩写', kind: 'contraction' },
  hes: { target: "he's", gloss: 'he is 缩写', kind: 'contraction' },
  shes: { target: "she's", gloss: 'she is 缩写', kind: 'contraction' },
  youll: { target: "you'll", gloss: 'you will 缩写', kind: 'contraction' },
  theyll: { target: "they'll", gloss: 'they will 缩写', kind: 'contraction' },
  theyve: { target: "they've", gloss: 'they have 缩写', kind: 'contraction' },
  youd: { target: "you'd", gloss: 'you would 缩写', kind: 'contraction' },
  wouldve: { target: "would've", gloss: 'would have 缩写', kind: 'contraction' },
  couldve: { target: "could've", gloss: 'could have 缩写', kind: 'contraction' },
  shouldve: { target: "should've", gloss: 'should have 缩写', kind: 'contraction' },
  aint: { target: "ain't", gloss: 'am/is/are not 口语缩写', kind: 'contraction' },

  // Chat abbreviations typed on purpose: kept as typed, expansion only offered
  ur: { target: 'your', gloss: 'pron. 你的 (口语缩写)', kind: 'abbrev' },
  cuz: { target: 'because', gloss: 'conj. 因为 (口语缩写)', kind: 'abbrev' },
  thru: { target: 'through', gloss: 'prep. 通过 (口语缩写)', kind: 'abbrev' },
  tho: { target: 'though', gloss: 'conj. 虽然 (口语缩写)', kind: 'abbrev' },
  ppl: { target: 'people', gloss: 'n. 人们 (口语缩写)', kind: 'abbrev' },
  abt: { target: 'about', gloss: 'prep. 关于 (口语缩写)', kind: 'abbrev' },
  bday: { target: 'birthday', gloss: 'n. 生日 (口语缩写)', kind: 'abbrev' },
  esp: { target: 'especially', gloss: 'adv. 尤其 (缩写)', kind: 'abbrev' },
  info: { target: 'information', gloss: 'n. 信息 (缩写)', kind: 'abbrev' },
  admin: { target: 'administrator', gloss: 'n. 管理员 (缩写)', kind: 'abbrev' },
  app: { target: 'application', gloss: 'n. 应用 (缩写)', kind: 'abbrev' },
  temp: { target: 'temporary', gloss: 'adj. 临时的 (缩写)', kind: 'abbrev' },
  misc: { target: 'miscellaneous', gloss: 'adj. 杂项 (缩写)', kind: 'abbrev' },
  max: { target: 'maximum', gloss: 'n. 最大值 (缩写)', kind: 'abbrev' },
  min: { target: 'minimum', gloss: 'n. 最小值 (缩写)', kind: 'abbrev' },
  avg: { target: 'average', gloss: 'n. 平均 (缩写)', kind: 'abbrev' },
  num: { target: 'number', gloss: 'n. 数字 (缩写)', kind: 'abbrev' },
  prev: { target: 'previous', gloss: 'adj. 上一个 (缩写)', kind: 'abbrev' },
  pic: { target: 'picture', gloss: 'n. 图片 (缩写)', kind: 'abbrev' },
  pics: { target: 'pictures', gloss: 'n. 图片 (缩写)', kind: 'abbrev' },

  // Shorthand
  tmrw: { target: 'tomorrow', gloss: 'n./adv. 明天 (简拼)', kind: 'shorthand' },
  tmr: { target: 'tomorrow', gloss: 'n./adv. 明天 (简拼)', kind: 'shorthand' },
  ystd: { target: 'yesterday', gloss: 'n./adv. 昨天 (简拼)', kind: 'shorthand' },
  pls: { target: 'please', gloss: 'adv./v. 请 (简拼)', kind: 'shorthand' },
  plz: { target: 'please', gloss: 'adv./v. 请 (简拼)', kind: 'shorthand' },
  thx: { target: 'thanks', gloss: 'n./int. 谢谢 (简拼)', kind: 'shorthand' },
  bc: { target: 'because', gloss: 'conj. 因为 (简拼)', kind: 'shorthand' },
  bcz: { target: 'because', gloss: 'conj. 因为 (简拼)', kind: 'shorthand' },
  wld: { target: 'would', gloss: 'aux. 将会；愿意 (简拼)', kind: 'shorthand' },
  shld: { target: 'should', gloss: 'aux. 应该 (简拼)', kind: 'shorthand' },
  cld: { target: 'could', gloss: 'aux. 能够；可以 (简拼)', kind: 'shorthand' },
  mgmt: { target: 'management', gloss: 'n. 管理；管理层 (简拼)', kind: 'abbrev' },
  approx: { target: 'approximately', gloss: 'adv. 大约 (简拼)', kind: 'abbrev' },
  govt: { target: 'government', gloss: 'n. 政府 (简拼)', kind: 'abbrev' },
  dept: { target: 'department', gloss: 'n. 部门；系 (简拼)', kind: 'abbrev' },
  intl: { target: 'international', gloss: 'adj. 国际的 (简拼)', kind: 'abbrev' },
  msg: { target: 'message', gloss: 'n. 消息 (简拼)', kind: 'abbrev' },

  // Common misspellings
  hte: { target: 'the', gloss: 'art. 这；那 (纠错)', kind: 'common_typo' },
  taht: { target: 'that', gloss: 'pron./conj. 那 (纠错)', kind: 'common_typo' },
  thsi: { target: 'this', gloss: 'pron. 这 (纠错)', kind: 'common_typo' },
  tihs: { target: 'this', gloss: 'pron. 这 (纠错)', kind: 'common_typo' },
  wiht: { target: 'with', gloss: 'prep. 和；用 (纠错)', kind: 'common_typo' },
  jsut: { target: 'just', gloss: 'adv. 只是；刚刚 (纠错)', kind: 'common_typo' },
  waht: { target: 'what', gloss: 'pron. 什么 (纠错)', kind: 'common_typo' },
  whta: { target: 'what', gloss: 'pron. 什么 (纠错)', kind: 'common_typo' },
  tehn: { target: 'then', gloss: 'adv. 然后 (纠错)', kind: 'common_typo' },
  yuo: { target: 'you', gloss: 'pron. 你 (纠错)', kind: 'common_typo' },
  yuor: { target: 'your', gloss: 'pron. 你的 (纠错)', kind: 'common_typo' },
  nad: { target: 'and', gloss: 'conj. 和；与 (纠错)', kind: 'common_typo' },
  thier: { target: 'their', gloss: 'pron. 他们的 (纠错)', kind: 'common_typo' },
  anser: { target: 'answer', gloss: 'n./v. 回答 (纠错)', kind: 'common_typo' },
  wich: { target: 'which', gloss: 'pron. 哪个 (纠错)', kind: 'common_typo' },
  becuase: { target: 'because', gloss: 'conj. 因为 (纠错)', kind: 'common_typo' },
  beacuse: { target: 'because', gloss: 'conj. 因为 (纠错)', kind: 'common_typo' },
  calender: { target: 'calendar', gloss: 'n. 日历 (纠错)', kind: 'common_typo' },
  truely: { target: 'truly', gloss: 'adv. 真正地 (纠错)', kind: 'common_typo' },
  begining: { target: 'beginning', gloss: 'n. 开始 (纠错)', kind: 'common_typo' },
  comming: { target: 'coming', gloss: 'v. 来 (纠错)', kind: 'common_typo' },
  writting: { target: 'writing', gloss: 'v./n. 写作 (纠错)', kind: 'common_typo' },
  refered: { target: 'referred', gloss: 'v. 提到 (纠错)', kind: 'common_typo' },
  prefered: { target: 'preferred', gloss: 'v. 更喜欢 (纠错)', kind: 'common_typo' },
  basicly: { target: 'basically', gloss: 'adv. 基本上 (纠错)', kind: 'common_typo' },
  publically: { target: 'publicly', gloss: 'adv. 公开地 (纠错)', kind: 'common_typo' },
  arguement: { target: 'argument', gloss: 'n. 论点；参数 (纠错)', kind: 'common_typo' },
  fourty: { target: 'forty', gloss: 'num. 四十 (纠错)', kind: 'common_typo' },
  nineth: { target: 'ninth', gloss: 'num. 第九 (纠错)', kind: 'common_typo' },
  teh: { target: 'the', gloss: 'art. 这；那 (纠错)', kind: 'common_typo' },
  adn: { target: 'and', gloss: 'conj. 和；与 (纠错)', kind: 'common_typo' },
  recieve: { target: 'receive', gloss: 'v. 收到；接收 (纠错)', kind: 'common_typo' },
  definately: { target: 'definitely', gloss: 'adv. 绝对；肯定地 (纠错)', kind: 'common_typo' },
  definatly: { target: 'definitely', gloss: 'adv. 绝对；肯定地 (纠错)', kind: 'common_typo' },
  seperate: { target: 'separate', gloss: 'adj./v. 分开；分离 (纠错)', kind: 'common_typo' },
  occured: { target: 'occurred', gloss: 'v. 发生(过去式 纠错)', kind: 'common_typo' },
  occurence: { target: 'occurrence', gloss: 'n. 发生；事件 (纠错)', kind: 'common_typo' },
  untill: { target: 'until', gloss: 'prep./conj. 直到 (纠错)', kind: 'common_typo' },
  wierd: { target: 'weird', gloss: 'adj. 奇怪的；怪异的 (纠错)', kind: 'common_typo' },
  alot: { target: 'a lot', gloss: '许多；大量 (纠错)', kind: 'common_typo' },
  enviroment: { target: 'environment', gloss: 'n. 环境 (纠错)', kind: 'common_typo' },
  goverment: { target: 'government', gloss: 'n. 政府 (纠错)', kind: 'common_typo' },
  acomodate: { target: 'accommodate', gloss: 'v. 容纳；适应 (纠错)', kind: 'common_typo' },
  accomodate: { target: 'accommodate', gloss: 'v. 容纳；适应 (纠错)', kind: 'common_typo' },
  necesary: { target: 'necessary', gloss: 'adj. 必要的 (纠错)', kind: 'common_typo' },
  nesesary: { target: 'necessary', gloss: 'adj. 必要的 (纠错)', kind: 'common_typo' },
  unecesary: { target: 'unnecessary', gloss: 'adj. 不必要的 (纠错)', kind: 'common_typo' },
  pronounciation: { target: 'pronunciation', gloss: 'n. 发音 (纠错)', kind: 'common_typo' },
  maintainance: { target: 'maintenance', gloss: 'n. 维护；保养 (纠错)', kind: 'common_typo' },
  priviledge: { target: 'privilege', gloss: 'n. 特权；荣幸 (纠错)', kind: 'common_typo' },
  independant: { target: 'independent', gloss: 'adj. 独立的 (纠错)', kind: 'common_typo' },
  existance: { target: 'existence', gloss: 'n. 存在 (纠错)', kind: 'common_typo' },
  acknowlege: { target: 'acknowledge', gloss: 'v. 承认；确认收到 (纠错)', kind: 'common_typo' },
  apreciate: { target: 'appreciate', gloss: 'v. 感激；欣赏 (纠错)', kind: 'common_typo' },
  wensday: { target: 'Wednesday', gloss: 'n. 星期三 (纠错)', kind: 'common_typo' },
};


export interface VerbParadigm {
  base: string;
  past: string;
  participle: string;
  thirdSingular: string;
  presentParticiple: string;
  isPureVerb: boolean;
}

/**
 * The dictionary in memory: entries by word, the morphology tables, and the indexes the fuzzy channels
 * search (phonetic place / coarse keys, first letters). Immutable after construction.
 */
export class LexiconIndex {
  public readonly entries: readonly LexiconEntry[];
  public readonly exactMap = new Map<string, LexiconEntry>();
  public readonly brandMap = new Map<string, string>();
  public readonly collocations: RawCollocations;
  public readonly verbParadigms = new Map<string, VerbParadigm>();
  public readonly nounPlurals = new Map<string, string>();
  public readonly inflectionToLemma = new Map<string, string>();
  public readonly pastVerbSet = new Set<string>();
  public readonly known: KnownTokens;
  public readonly alphaSorted: readonly LexiconEntry[];

  // Entry ids by place key: exact, with one consonant removed, and by 3- / 2-letter key prefix.
  public readonly placeExact = new Map<string, number[]>();
  public readonly placeSymDel1 = new Map<string, number[]>();
  public readonly placePrefix3 = new Map<string, number[]>();
  public readonly placePrefix2 = new Map<string, number[]>();

  // Entry ids by coarse key.
  public readonly coarseExact = new Map<string, number[]>();

  // Entry ids by first letter and by first two letters, most frequent first.
  public readonly firstCharEntries = new Map<string, number[]>();
  public readonly first2CharEntries = new Map<string, number[]>();

  constructor(payload: RawDictPayload) {
    // Null-prototype maps: typed words are used as keys, and `constructor` / `toString` must not hit Object.prototype.
    const bare = <T>(o: Record<string, T> | undefined): Record<string, T> =>
      Object.assign(Object.create(null) as Record<string, T>, o ?? {});
    this.collocations = {
      bigrams: bare(payload.collocations?.bigrams),
      trigrams: bare(payload.collocations?.trigrams),
    };
    for (const [k, v] of Object.entries(payload.brands ?? {})) {
      this.brandMap.set(k.toLowerCase(), v);
    }
    this.known = new KnownTokens(payload.known);

    if (payload.morphology) {
      for (const [lemma, [past, participle, thirdSingular, presentParticiple, isPure]] of Object.entries(
        payload.morphology.verbs ?? {}
      )) {
        this.verbParadigms.set(lemma, {
          base: lemma,
          past,
          participle,
          thirdSingular,
          presentParticiple,
          isPureVerb: isPure === 1,
        });
      }
      for (const [sg, pl] of Object.entries(payload.morphology.plurals ?? {})) {
        this.nounPlurals.set(sg, pl);
      }
      for (const [inf, lem] of Object.entries(payload.morphology.inflectionToLemma ?? {})) {
        this.inflectionToLemma.set(inf, lem);
      }
      for (const pv of payload.morphology.pastVerbs ?? []) {
        this.pastVerbSet.add(pv);
      }
    }

    const rawList = payload.entries;
    const builtEntries = new Array<LexiconEntry>(rawList.length);

    for (let id = 0; id < rawList.length; id++) {
      const [word, freq, cmuCoarse, cmuAlt, cmuFine, gloss, flags] = rawList[id];
      const orth = spellingToPhonetic(word);

      const coarse = cmuCoarse || orth.coarse;
      const altCoarse = cmuAlt || orth.altCoarse;
      const fine = cmuFine || orth.fine;
      const place = coarseToPlaceKey(coarse);
      const altPlace = altCoarse ? coarseToPlaceKey(altCoarse) : '';
      const noSuggest = (flags & 4) !== 0;

      const entry: LexiconEntry = {
        id,
        word,
        canonicalCase: this.brandMap.get(word),
        freq,
        place,
        altPlace,
        coarse,
        altCoarse,
        fine,
        orthCoarse: orth.coarse,
        orthFine: orth.fine,
        gloss,
        isCore: (flags & 1) !== 0,
        startsWithVowel: (flags & 2) !== 0,
        noSuggest,
        posFlags: flags & (8 | 16 | 32 | 64),
      };

      builtEntries[id] = entry;
      this.exactMap.set(word, entry);

      if (!noSuggest) {
        this.indexCoreEntry(entry);
      }
    }

    this.entries = builtEntries;
    this.alphaSorted = builtEntries
      .filter((e) => Boolean(e) && !e.noSuggest)
      .sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));

  }

  private indexCoreEntry(entry: LexiconEntry): void {
    const id = entry.id;
    const { word, place, altPlace, coarse, altCoarse, orthCoarse } = entry;
    const orthPlace = coarseToPlaceKey(orthCoarse);

    // Coarse keys
    for (const cKey of new Set([coarse, altCoarse, orthCoarse])) {
      if (cKey) this.pushUnique(this.coarseExact, cKey, id);
    }

    // Place keys. The buckets are capped; entries arrive most frequent first, so the cap drops rare words.
    for (const pKey of new Set([place, altPlace, orthPlace])) {
      if (!pKey) continue;
      this.pushUnique(this.placeExact, pKey, id);
      if (pKey.length >= 2) this.pushCapped(this.placePrefix2, pKey.slice(0, 2), id, 380);
      if (pKey.length >= 3) this.pushCapped(this.placePrefix3, pKey.slice(0, 3), id, 520);

      // One-consonant-short keys. Keys of length 2 are indexed too so that a key of one consonant can reach a word of two.
      if (pKey.length >= 2) {
        const seenDel = new Set<string>();
        for (let k = 0; k < pKey.length; k++) {
          const del = pKey.slice(0, k) + pKey.slice(k + 1);
          if (del.length >= 1 && !seenDel.has(del)) {
            seenDel.add(del);
            this.pushCapped(this.placeSymDel1, del, id, del.length === 1 ? 320 : 220);
          }
        }
      }
    }

    // First letters
    if (word.length >= 1) {
      this.pushCapped(this.firstCharEntries, word[0], id, 1600);
    }
    if (word.length >= 2) {
      this.pushCapped(this.first2CharEntries, word.slice(0, 2), id, 420);
    }
  }

  private pushUnique(map: Map<string, number[]>, key: string, id: number): void {
    if (!key) return;
    const arr = map.get(key);
    if (!arr) {
      map.set(key, [id]);
    } else if (arr[arr.length - 1] !== id) {
      arr.push(id);
    }
  }

  private pushCapped(map: Map<string, number[]>, key: string, id: number, cap: number): void {
    const arr = map.get(key);
    if (!arr) {
      map.set(key, [id]);
    } else if (arr.length < cap && arr[arr.length - 1] !== id) {
      arr.push(id);
    }
  }

  /** Suggestible words that start with `prefix` (and are longer), most frequent first. */
  public findPrefixMatches(prefix: string, limit = 24): LexiconEntry[] {
    const p = prefix.toLowerCase();
    if (!p) return [];

    let lo = 0;
    let hi = this.alphaSorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.alphaSorted[mid].word < p) lo = mid + 1;
      else hi = mid;
    }

    const matched: LexiconEntry[] = [];
    for (let i = lo; i < this.alphaSorted.length; i++) {
      const entry = this.alphaSorted[i];
      if (!entry.word.startsWith(p)) break;
      if (entry.word !== p && !entry.noSuggest) {
        matched.push(entry);
      }
    }

    matched.sort((a, b) => b.freq - a.freq);
    return matched.slice(0, limit);
  }
}
