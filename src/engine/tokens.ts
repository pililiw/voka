/**
 * Token shape analysis: decides what part of a typed token may be looked up / corrected at all.
 * Rule of thumb: anything that carries explicit user intent (capitals, digits, symbols, apostrophes)
 * is kept exactly as typed.
 */

export type TokenCasing = 'lower' | 'title' | 'upper' | 'mixed';

export interface TokenShape {
  /** True when the token must be committed verbatim and gets no suggestions. */
  literal: boolean;
  /** Literal because it looks like code / a path / an identifier (a following `.` stays inside the token). */
  codeLike?: boolean;
  /** For literal tokens with one safe normalisation (`i'm` -> `I'm`). */
  canonical?: string;
  /** Letters to resolve (original casing). Empty for literal tokens. */
  base: string;
  /** Suffix re-attached verbatim after resolving `base`: `'s`, `'`. */
  tail: string;
  casing: TokenCasing;
}

const SYMBOL_CHARS = /[_/.@:\\~=+$%&*<>\[\]{}|^`#]/;

// Contractions that are complete words of their own. Typed exactly (any case) they are never touched.
const CONTRACTIONS = new Set(
  (
    "isn't aren't wasn't weren't don't doesn't didn't can't couldn't won't wouldn't shouldn't haven't hasn't " +
    "hadn't mustn't needn't ain't shan't mightn't daren't oughtn't " +
    "i'm i've i'll i'd you're you've you'll you'd he's he'll he'd she's she'll she'd it's it'll it'd " +
    "we're we've we'll we'd they're they've they'll they'd that's that'll that'd there's there'll there'd " +
    "here's what's what're what'll what'd who's who'll who'd who've who're where's where'd when's why's why'd " +
    "how's how'd how're let's o'clock y'all ma'am c'mon ne'er e'er ol' should've could've would've might've " +
    "must've this'll these're those're"
  ).split(' ')
);

export function casingOf(raw: string): TokenCasing {
  if (raw === raw.toLowerCase()) return 'lower';
  if (raw.length >= 2 && raw === raw.toUpperCase()) return 'upper';
  if (raw[0] !== raw[0].toLowerCase() && raw.slice(1) === raw.slice(1).toLowerCase()) return 'title';
  return 'mixed';
}

function literal(casing: TokenCasing, canonical?: string, codeLike = false): TokenShape {
  return { literal: true, canonical, codeLike, base: '', tail: '', casing };
}

export function analyzeToken(raw: string): TokenShape {
  const casing = raw ? casingOf(raw) : 'lower';
  if (!raw) return literal(casing);

  const first = raw[0];
  // Commands, mentions, flags, identifiers with digits, paths and domains.
  if (first === '/' || first === '@' || first === '#' || first === '-') return literal(casing, undefined, true);
  if (/[0-9]/.test(raw) || SYMBOL_CHARS.test(raw)) return literal(casing, undefined, true);
  // Non-English letters and hyphenated compounds.
  if (/[^A-Za-z'’-]/.test(raw) || raw.includes('-')) return literal(casing);

  const norm = raw.replace(/’/g, "'");
  if (norm.includes("'")) {
    const lower = norm.toLowerCase();
    if (CONTRACTIONS.has(lower)) {
      // `i'm` -> `I'm`; everything else exactly as typed.
      const fixed = /^i'/.test(norm) ? 'I' + raw.slice(1) : raw;
      return literal(casing, fixed !== raw ? fixed : undefined);
    }
    const m = norm.match(/^([A-Za-z]+)('s|'S|')$/);
    if (m && m[1].length >= 2) {
      const base = raw.slice(0, m[1].length);
      return { literal: false, base, tail: raw.slice(m[1].length), casing: casingOf(base) };
    }
    return literal(casing);
  }

  // Acronyms and camelCase.
  if ((raw.length >= 2 && casing === 'upper') || casing === 'mixed') return literal(casing);
  return { literal: false, base: raw, tail: '', casing };
}

// ------------------------------------------------------------------------------------------------
// Pinyin: Chinese names and places typed in Latin letters must survive. Only tokens that carry a
// distinctly Chinese syllable are protected - plain consonant-vowel strings are also how
// English is spelled by ear, so those go through the normal confidence check.
// ------------------------------------------------------------------------------------------------
const PINYIN_SYLLABLES = new Set(
  (
    'a ai an ang ao e ei en eng er o ou ' +
    'ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ' +
    'pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu ' +
    'ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu ' +
    'fa fan fang fei fen feng fo fou fu ' +
    'da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo ' +
    'ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo ' +
    'na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nuo nv nve nue ' +
    'la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lv lve lue ' +
    'ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ' +
    'ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo ' +
    'ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo ' +
    'ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ' +
    'qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ' +
    'xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ' +
    'zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo ' +
    'cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ' +
    'sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo ' +
    'ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo ' +
    'za zai zan zang zao ze zei zen zeng zi zong zou zu zuan zui zun zuo ' +
    'ca cai can cang cao ce cen ceng ci cong cou cu cuan cui cun cuo ' +
    'sa sai san sang sao se sen seng si song sou su suan sui sun suo ' +
    'ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun ' +
    'wa wai wan wang wei wen weng wo wu'
  ).split(' ')
);

function isDistinctPinyinSyllable(s: string): boolean {
  if (s.length < 2) return false;
  if (s.startsWith('zh') || s[0] === 'x' || s[0] === 'q') return true;
  return /(iao|ian|iang|iong|uang|uai|ua|uo|ui|iu|ao|ei|ue|ve)$/.test(s);
}

/**
 * True when `word` (lowercase letters) splits completely into pinyin syllables and at least one of them
 * is distinctly Chinese, or the token is a reduplicated syllable (`fangfang`, `lingling`).
 */
export function looksLikePinyinName(word: string): boolean {
  const n = word.length;
  if (n < 3 || n > 18) return false;
  // dp[i] = best state for the prefix of length i: -1 unreachable, 0 reachable, 1 reachable with a distinct syllable
  const dp = new Int8Array(n + 1).fill(-1);
  const count = new Int8Array(n + 1);
  dp[0] = 0;
  for (let i = 0; i < n; i++) {
    if (dp[i] < 0) continue;
    for (let len = 1; len <= 6 && i + len <= n; len++) {
      const syl = word.slice(i, i + len);
      if (!PINYIN_SYLLABLES.has(syl)) continue;
      const state = dp[i] === 1 || isDistinctPinyinSyllable(syl) ? 1 : 0;
      const j = i + len;
      if (state > dp[j] || (state === dp[j] && count[i] + 1 < count[j])) {
        dp[j] = state;
        count[j] = count[i] + 1;
      }
    }
  }
  if (dp[n] < 0) return false;
  if (dp[n] === 1) return count[n] >= 2 || n >= 4;
  if (n % 2 === 0 && n >= 4) {
    const half = word.slice(0, n / 2);
    if (word === half + half && PINYIN_SYLLABLES.has(half)) return true;
  }
  return false;
}
