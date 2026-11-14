/**
 * Phonetic codes and distances. A word (or a typed token) is described at three levels:
 *   1. `place`: consonants reduced to their place of articulation, used as an index key. Sounds that
 *      learners commonly confuse share a letter, so `komfort` and `comfort` get the same key:
 *        A = initial vowel         P = labials (b p f v w)   T = dentals (d t)       K = velars (g k)
 *        S = sibilants (s z)       J = affricates (ch j)     N = nasals (m n)        L = liquids (l r)
 *        H = initial h             Y = initial y
 *   2. `coarse` / `altCoarse`: the consonant sequence with voicing kept, and a common alternative reading.
 *   3. `fine`: consonants and vowel classes in order, compared with phonologicalDistance().
 * The codes of dictionary words come from their pronunciation (scripts/build-dictionary.mjs); typed
 * tokens are coded from their spelling by spellingToPhonetic().
 */

export interface PhoneticCode {
  place: string;
  coarse: string;
  altCoarse: string;
  fine: string;
  startsWithVowel: boolean;
  }

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

export function isVowelChar(ch: string): boolean {
  return VOWELS.has(ch);
}

function dedup(str: string): string {
  if (str.length <= 1) return str;
  let out = str[0];
  for (let i = 1; i < str.length; i++) {
    if (str[i] !== str[i - 1]) {
      out += str[i];
    }
  }
  return out;
}

/** Reduce a `coarse` key to its `place` key. */
export function coarseToPlaceKey(coarse: string): string {
  if (!coarse) return '';
  let out = '';
  for (let i = 0; i < coarse.length; i++) {
    switch (coarse[i]) {
      case 'A':
        out += 'A';
        break;
      case 'B':
      case 'P':
      case 'F':
      case 'V':
      case 'W':
        out += 'P';
        break;
      case 'D':
      case 'T':
        out += 'T';
        break;
      case 'G':
      case 'K':
        out += 'K';
        break;
      case 'Z':
      case 'S':
        out += 'S';
        break;
      case 'C':
      case 'J':
        out += 'J';
        break;
      case 'M':
      case 'N':
        out += 'N';
        break;
      case 'L':
      case 'R':
        out += 'L';
        break;
      case 'H':
        out += 'H';
        break;
      case 'Y':
        out += 'Y';
        break;
    }
  }
  return dedup(out);
}

/**
 * Phonetic code of a spelling: a real word, or the way a learner writes a word down by ear
 * (`fone`, `skool`, `igzajereit`).
 */
export function spellingToPhonetic(raw: string): PhoneticCode {
  const s = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) {
    return { place: '', coarse: '', altCoarse: '', fine: '', startsWithVowel: false };
  }


  let w = s;
  if (/^(kn|gn|pn|ps|wr)/.test(w)) {
    w = w.slice(1);
  } else if (/^wh/.test(w)) {
    w = /^who/.test(w) ? 'h' + w.slice(2) : 'w' + w.slice(2);
  } else if (/^(honest|hour|heir|herb|honor|honour)/.test(w)) {
    w = w.slice(1);
  }

  let coarse = '';
  let altCoarse = '';
  let fine = '';
  let startsWithVowel = false;

  let i = 0;
  const n = w.length;

  while (i < n) {
    const ch = w[i];
    const next = w[i + 1] ?? '';
    const next2 = w[i + 2] ?? '';
    const prev = i > 0 ? w[i - 1] : '';
    const rem = w.slice(i);
    const isFirstSound = coarse.length === 0 && fine.length === 0;

    if (rem.startsWith('tion') || rem.startsWith('sion')) {
      const isZh = rem.startsWith('sion') && isVowelChar(prev);
      coarse += isZh ? 'JN' : 'SN';
      altCoarse += 'SN';
      fine += isZh ? 'jan' : 'san';
      i += 4;
      continue;
    }
    if (rem.startsWith('cious') || rem.startsWith('tious') || rem.startsWith('xious')) {
      if (rem.startsWith('xious')) {
        coarse += 'KS';
        altCoarse += 'KS';
        fine += 'ksas';
      } else {
        coarse += 'SS';
        altCoarse += 'CS';
        fine += 'sas';
      }
      i += 5;
      continue;
    }
    if (rem.startsWith('cial') || rem.startsWith('tial')) {
      coarse += 'SL';
      altCoarse += 'CL';
      fine += 'sal';
      i += 4;
      continue;
    }
    if (rem.startsWith('ture') && i > 0) {
      coarse += 'CR';
      altCoarse += 'TR';
      fine += 'cer';
      i += 4;
      continue;
    }
    if (rem.startsWith('ough')) {
      fine += 'u';
      i += 4;
      continue;
    }
    if (rem.startsWith('augh')) {
      fine += 'a';
      i += 4;
      continue;
    }
    if (rem.startsWith('eigh')) {
      if (isFirstSound) {
        startsWithVowel = true;
        coarse += 'A';
        altCoarse += 'A';
      }
      fine += 'e';
      i += 4;
      continue;
    }
    if (rem.startsWith('ight')) {
      if (isFirstSound) {
        startsWithVowel = true;
        coarse += 'A';
        altCoarse += 'A';
      }
      coarse += 'T';
      altCoarse += 'T';
      fine += 'ayt';
      i += 4;
      continue;
    }
    if (rem.startsWith('dge') || rem.startsWith('dgi') || rem.startsWith('dgy')) {
      coarse += 'J';
      altCoarse += 'J';
      fine += 'j';
      i += rem.startsWith('dge') && i + 3 === n ? 3 : 2;
      continue;
    }
    if (rem.startsWith('tch')) {
      coarse += 'C';
      altCoarse += 'S';
      fine += 'c';
      i += 3;
      continue;
    }
    if (rem.startsWith('sch')) {
      coarse += 'SK';
      altCoarse += 'S';
      fine += 'sk';
      i += 3;
      continue;
    }
    if (rem.startsWith('du') && isVowelChar(w[i + 2] ?? '') && i > 0) {
      // `du` + vowel is palatalised: schedule, module, educate, gradual.
      coarse += 'J';
      altCoarse += 'D';
      fine += 'ju';
      i += 2;
      continue;
    }
    if (rem.startsWith('que') && i + 3 === n) {
      coarse += 'K';
      altCoarse += 'K';
      fine += 'k';
      i += 3;
      continue;
    }

    // Vowels and vowel groups
    if (isVowelChar(ch)) {
      if (ch === 'y' && isFirstSound && isVowelChar(next)) {
        coarse += 'Y';
        altCoarse += 'A';
        fine += 'y';
        i += 1;
        continue;
      }

      if (ch === 'e' && i === n - 1 && fine.length > 0 && !isVowelChar(prev)) {
        i += 1;
        continue;
      }

      if (ch === 'e' && i === n - 2 && next === 'd' && i > 1 && prev !== 't' && prev !== 'd') {
        i += 1;
        continue;
      }

      if (isFirstSound) {
        startsWithVowel = true;
        coarse += 'A';
        altCoarse += 'A';
      }

      // Magic e: one vowel + one consonant + final silent e is long (`fone`, `note`, `make`, `time`, `rule`).
      if (
        (ch === 'o' || ch === 'a' || ch === 'u' || ch === 'i') &&
        next &&
        !isVowelChar(next) &&
        next !== 'r' &&
        next !== 'v' &&
        next2 === 'e' &&
        i + 2 === n - 1
      ) {
        fine += ch === 'i' ? 'ay' : ch === 'a' ? 'e' : 'u';
        i += 1;
        continue;
      }
      // `igh` = long i (light, night, high)
      if (ch === 'i' && next === 'g' && next2 === 'h') {
        fine += 'ay';
        i += 3;
        continue;
      }
      // Final y as the only vowel is long i (my, try, why)
      if (ch === 'y' && i === n - 1 && fine.length > 0 && !/[aeiouy]/.test(fine)) {
        fine += 'ay';
        i += 1;
        continue;
      }

      const pair = ch + next;
      // Three-letter vowel groups
      const tri = ch + next + next2;
      if (tri === 'eia' || tri === 'eio' || tri === 'aiu') {
        fine += 'ea';
        i += 3;
        continue;
      }

      if (pair === 'ai' || pair === 'ay') {
        fine += 'ay';
        i += 2;
        continue;
      }
      if (pair === 'ei' || pair === 'ey') {
        fine += 'e';
        i += 2;
        continue;
      }
      if (pair === 'ea' || pair === 'ee' || pair === 'ie') {
        // Two syllables (spontaneous, conscientious) as opposed to one long vowel (bee, keep, receive)
        if ((pair === 'ie' || pair === 'ea') && isVowelChar(next2)) {
          fine += 'i';
          i += 1;
        } else {
          fine += 'i';
          i += 2;
        }
        continue;
      }
      if (pair === 'oo' || pair === 'ou' || pair === 'ow' || pair === 'eu' || pair === 'ew' || pair === 'ui' || pair === 'ue') {
        fine += 'u';
        i += 2;
        continue;
      }
      if (pair === 'au' || pair === 'aw' || pair === 'oa') {
        fine += pair === 'oa' ? 'u' : 'a';
        i += 2;
        continue;
      }
      if (pair === 'er' || pair === 'ir' || pair === 'ur' || pair === 'or' || pair === 'ar') {
        coarse += 'R';
        altCoarse += isVowelChar(next2) ? 'R' : '';
        fine += ch === 'a' ? 'ar' : 'er';
        i += 2;
        continue;
      }

      // A lone `o` is ambiguous between the `a` class (hot, not) and the `u` class (go, photo): it gets its own
      // symbol that matches both cheaply (see phonologicalSubCost).
      if (ch === 'a') fine += 'a';
      else if (ch === 'o') fine += 'o';
      else if (ch === 'e') fine += 'e';
      else if (ch === 'i' || ch === 'y') fine += 'i';
      else fine += 'u';

      i += 1;
      continue;
    }

    // Collapse doubled consonants
    if (next === ch && ch !== 'c' && ch !== 'g') {
      i += 1;
      continue;
    }

    switch (ch) {
      case 'b':
        if ((prev === 'm' && i === n - 1) || next === 't') {
          i += 1;
          break;
        }
        coarse += 'B';
        altCoarse += 'B';
        fine += 'b';
        i += 1;
        break;

      case 'p':
        if (next === 'h') {
          coarse += 'F';
          altCoarse += 'F';
          fine += 'f';
          i += 2;
        } else {
          coarse += 'P';
          altCoarse += 'P';
          fine += 'p';
          i += 1;
        }
        break;

      case 'c':
        if (next === 'h') {
          coarse += 'C';
          altCoarse += 'K';
          fine += 'c';
          i += 2;
        } else if (next === 'k') {
          coarse += 'K';
          altCoarse += 'K';
          fine += 'k';
          i += 2;
        } else if (next === 'i' || next === 'e' || next === 'y') {
          if (prev === 's') {
            i += 1;
          } else {
            coarse += 'S';
            altCoarse += 'S';
            fine += 's';
            i += 1;
          }
        } else {
          coarse += 'K';
          altCoarse += 'K';
          fine += 'k';
          i += 1;
        }
        break;

      case 'k':
        coarse += 'K';
        altCoarse += 'K';
        fine += 'k';
        i += 1;
        break;

      case 'q':
        if (next === 'u') {
          coarse += 'KW';
          altCoarse += 'K';
          fine += 'kw';
          i += 2;
        } else {
          coarse += 'K';
          altCoarse += 'K';
          fine += 'k';
          i += 1;
        }
        break;

      case 'g':
        if (next === 'h') {
          if (isFirstSound) {
            coarse += 'G';
            altCoarse += 'G';
            fine += 'g';
          }
          i += 2;
        } else if (next === 'n' && i + 2 >= n - 1) {
          i += 1;
        } else if (next === 'u' && (next2 === 'a' || next2 === 'e' || next2 === 'i')) {
          coarse += 'G';
          altCoarse += 'G';
          fine += 'g';
          i += 2;
        } else if (next === 'e' || next === 'i' || next === 'y') {
          coarse += 'J';
          altCoarse += 'G';
          fine += 'j';
          i += 1;
        } else {
          coarse += 'G';
          altCoarse += 'G';
          fine += 'g';
          i += 1;
        }
        break;

      case 'j':
        coarse += 'J';
        altCoarse += 'J';
        fine += 'j';
        i += 1;
        break;

      case 'd':
        if (next === 'j') {
          coarse += 'J';
          altCoarse += 'J';
          fine += 'j';
          i += 2;
        } else {
          coarse += 'D';
          altCoarse += 'D';
          fine += 'd';
          i += 1;
        }
        break;

      case 't':
        if (next === 'h') {
          coarse += 'T';
          altCoarse += 'S';
          fine += 's';
          i += 2;
        } else if (prev === 's' && rem.startsWith('tle')) {
          i += 1;
        } else {
          coarse += 'T';
          altCoarse += 'T';
          fine += 't';
          i += 1;
        }
        break;

      case 's':
        if (next === 'h') {
          coarse += 'S';
          altCoarse += 'C';
          fine += 's';
          i += 2;
        } else {
          coarse += 'S';
          altCoarse += 'S';
          fine += 's';
          i += 1;
        }
        break;

      case 'z':
        if (next === 'h') {
          coarse += 'J';
          altCoarse += 'S';
          fine += 'j';
          i += 2;
        } else {
          coarse += 'S';
          altCoarse += 'S';
          fine += 'z';
          i += 1;
        }
        break;

      case 'x':
        if (isFirstSound) {
          coarse += 'S';
          altCoarse += 'S';
          fine += 'z';
        } else if (isVowelChar(next)) {
          // `x` between vowels is voiced (exact, examine, exist): GS as the alternative reading.
          coarse += 'KS';
          altCoarse += 'GS';
          fine += 'ks';
        } else {
          coarse += 'KS';
          altCoarse += 'KS';
          fine += 'ks';
        }
        i += 1;
        break;

      case 'f':
        coarse += 'F';
        altCoarse += 'F';
        fine += 'f';
        i += 1;
        break;

      case 'v':
        coarse += 'V';
        altCoarse += 'W';
        fine += 'v';
        i += 1;
        break;

      case 'w':
        if (isVowelChar(next)) {
          coarse += 'W';
          altCoarse += 'V';
          fine += 'w';
        }
        i += 1;
        break;

      case 'h':
        if (isFirstSound) {
          coarse += 'H';
          altCoarse += 'H';
          fine += 'h';
        }
        i += 1;
        break;

      case 'm':
        coarse += 'M';
        altCoarse += 'M';
        fine += 'm';
        i += 1;
        break;

      case 'n':
        if (next === 'g') {
          // Final `-ng` and `-nging` / `-nged` are a plain nasal (N). Inside a word (`hangri` hungry,
          // `finga` finger, `singel` single) the G is kept, in the primary or the alternative reading.
          const afterNg = w[i + 2] ?? '';
          if (afterNg === 'r' || afterNg === 'l' || afterNg === 'w') {
            coarse += 'NG';
            altCoarse += 'N';
            fine += 'ng';
          } else if (afterNg && isVowelChar(afterNg) && !rem.startsWith('nging') && !rem.startsWith('nged')) {
            coarse += 'N';
            altCoarse += 'NG';
            fine += 'n';
          } else {
            coarse += 'N';
            altCoarse += 'N';
            fine += 'n';
          }
          i += 2;
        } else {
          coarse += 'N';
          altCoarse += 'N';
          fine += 'n';
          i += 1;
        }
        break;

      case 'l':
        coarse += 'L';
        altCoarse += 'L';
        fine += 'l';
        i += 1;
        break;

      case 'r':
        coarse += 'R';
        altCoarse += 'R';
        fine += 'r';
        i += 1;
        break;

      default:
        i += 1;
        break;
    }
  }

  const dedupCoarse = dedup(coarse);
  return {
    place: coarseToPlaceKey(dedupCoarse),
    coarse: dedupCoarse,
    altCoarse: dedup(altCoarse),
    fine: dedup(fine),
    startsWithVowel,
  };
}

/** First letter plus the following consonants, repeats collapsed (`zombie` -> `zmb`). */
export function buildConsonantSkeleton(word: string): string {
  const s = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return '';
  let out = s[0];
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (!VOWELS.has(ch) && ch !== out[out.length - 1]) {
      out += ch;
    }
  }
  return out;
}

/**
 * How well `query` works as an abbreviation of `word` with letters left out (`prsn` person, `zmbie`
 * zombie), in [0, 1]; 0 = not one. The letters must appear in order, and a word that ends where the
 * query ends scores higher than one with a further ending (`zombie` over `zombies`).
 */
export function scoreSkeletonAbbreviation(query: string, word: string): number {
  const q = query.toLowerCase();
  const w = word.toLowerCase();
  if (q.length < 3 || q.length >= w.length) return 0;
  if (q[0] !== w[0]) return 0;

  let wi = 1;
  let lastMatchedWi = 0;
  let matchedConsonants = isVowelChar(q[0]) ? 0 : 1;
  for (let qi = 1; qi < q.length; qi++) {
    const qc = q[qi];
    let found = false;
    while (wi < w.length) {
      if (w[wi] === qc) {
        found = true;
        lastMatchedWi = wi;
        if (!isVowelChar(qc)) matchedConsonants++;
        wi++;
        break;
      }
      wi++;
    }
    if (!found) return 0;
  }

  if (matchedConsonants < 2) return 0;

  const skel = buildConsonantSkeleton(w);
  const queryConsonantSkel = buildConsonantSkeleton(q);
  const coverage = Math.min(1.0, queryConsonantSkel.length / Math.max(skel.length, 1));
  const isExactSkeleton = skel === queryConsonantSkel;
  const isSkelPrefix = skel.startsWith(queryConsonantSkel);

  const trailingUnmatched = w.length - 1 - lastMatchedWi;
  const tightEndBonus =
    isExactSkeleton && trailingUnmatched === 0
      ? 0.22
      : trailingUnmatched === 0
      ? 0.1
      : trailingUnmatched === 1 && w.endsWith('e')
      ? 0.08
      : 0;

  return Math.min(1, coverage * 0.68 + (isSkelPrefix ? 0.14 : 0.04) + tightEndBonus);
}

// Bonus for a matching first letter. A rare first letter (z, q, x, j) says more about the intended word
// than a common one (s, c, p, t), so it is worth more.
const INITIAL_CHAR_ENTROPY_BONUS: Record<string, number> = {
  z: 36,
  q: 34,
  x: 34,
  j: 28,
  v: 26,
  k: 24,
  y: 24,
  w: 20,
  g: 18,
  b: 17,
  f: 17,
  h: 17,
  l: 17,
  m: 16,
  n: 16,
  d: 16,
  r: 16,
  u: 16,
  p: 14,
  t: 14,
  c: 13,
  s: 12,
  a: 13,
  e: 14,
  i: 14,
  o: 14,
};

export function initialLetterAnchorBonus(qFirst: string, wFirst: string): number {
  if (!qFirst || !wFirst) return 0;
  if (qFirst === wFirst) {
    return INITIAL_CHAR_ENTROPY_BONUS[qFirst] ?? 15;
  }
  // Initial vowels are interchangeable when a word is spelled by ear (`egzample` example, `enuf` enough):
  // no penalty.
  if (VOWELS.has(qFirst) && VOWELS.has(wFirst) && qFirst !== 'y' && wFirst !== 'y') {
    return 4;
  }
  // Initials that spell the same sound (ph / f, c / k, c / s, g / j)
  const pair = qFirst < wFirst ? qFirst + wFirst : wFirst + qFirst;
  if (pair === 'ck' || pair === 'cs' || pair === 'fp' || pair === 'gj' || pair === 'sz') {
    return pair === 'sz' ? -6 : 6;
  }
  return -14;
}

const FINE_VOWEL_CHARS = new Set(['a', 'e', 'i', 'u', 'y', 'o']);

/**
 * Cost of hearing or writing sound `a` for sound `b` (symbols of the `fine` code). Sounds that differ
 * in one feature (voicing, m / n, l / r, v / w, neighbouring sibilants, vowel quality) are cheap;
 * unrelated consonants, and a vowel against a consonant, cost more than a full edit.
 */
export function phonologicalSubCost(a: string, b: string): number {
  if (a === b) return 0;
  const va = FINE_VOWEL_CHARS.has(a);
  const vb = FINE_VOWEL_CHARS.has(b);
  if (va && vb) {
    // `a` is what the user typed, `b` the target sound.
    if (a === 'o' || b === 'o') return (a === 'o' ? b : a) === 'a' || (a === 'o' ? b : a) === 'u' ? 0.08 : 0.28;
    if (a === 'u' && b === 'a') return 0.12; // short u: cut, fun, enuf
    if ((a === 'e' && b === 'i') || (a === 'i' && b === 'e')) return 0.18; // unstressed e / i
    return 0.28;
  }
  if (va !== vb) return 1.15;

  const pair = a < b ? a + b : b + a;
  switch (pair) {
    // Voiced / voiceless pairs
    case 'bp':
    case 'dt':
    case 'gk':
    case 'fv':
    case 'sz':
    case 'cj':
      return 0.2;
    // Nasals
    case 'mn':
      return 0.22;
    // Labial glide
    case 'vw':
    case 'bw':
      return 0.25;
    // Liquids (`pararel` parallel)
    case 'lr':
    case 'ln':
      return 0.26;
    // Sibilants, affricates and soft g / c
    case 'cs':
    case 'js':
    case 'jz':
    case 'gj':
    case 'ck':
      return 0.32;
    // Flapped t / d and neighbouring dentals
    case 'dl':
    case 'dr':
    case 'lt':
    case 'rt':
    case 'ds':
    case 'st':
      return 0.38;
    default:
      return 1.15;
  }
}

/**
 * Weighted edit distance between two `fine` codes: what was typed (`qFine`) against a word's code.
 * Dropped final stops, vocalised l / r and inserted or
 * missing weak vowels are cheap; unrelated consonants are expensive. Returns more than `maxCost` as
 * soon as the distance is known to exceed it.
 */
export function phonologicalDistance(qFine: string, rawTFine: string, maxCost = 2.8): number {
  if (qFine === rawTFine) return 0;
  // A final l written as a vowel.
  const darkLVocalized =
    qFine.length >= 3 &&
    /[auo]$/.test(qFine) &&
    /[aeiu]l$/.test(rawTFine) &&
    rawTFine.length >= 4;
  const tFine = darkLVocalized ? rawTFine.slice(0, -1) : rawTFine;
  const darkLPenalty = darkLVocalized ? 0.14 : 0;

  const la = qFine.length;
  const lb = tFine.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  if (Math.abs(la - lb) > Math.ceil(maxCost * 2) + 2) return maxCost + 1;

  let prev = new Float32Array(lb + 1);
  let curr = new Float32Array(lb + 1);

  for (let j = 1; j <= lb; j++) {
    const cb = tFine[j - 1];
    const cost = FINE_VOWEL_CHARS.has(cb) ? 0.38 : 0.85;
    prev[j] = prev[j - 1] + cost;
  }

  for (let i = 1; i <= la; i++) {
    const ca = qFine[i - 1];
    curr[0] = prev[0] + (FINE_VOWEL_CHARS.has(ca) ? 0.38 : 0.9);
    let rowMin = curr[0];

    for (let j = 1; j <= lb; j++) {
      const cb = tFine[j - 1];
      const sub = phonologicalSubCost(ca, cb);

      // Leaving out a sound of the word: cheap for a vowel or glide, a final stop, or l / r after a vowel.
      let omitTargetCost = 0.95;
      if (FINE_VOWEL_CHARS.has(cb) || cb === 'w' || cb === 'h') {
        omitTargetCost = 0.35;
      } else if (j === lb && (cb === 't' || cb === 'd' || cb === 'k' || cb === 'p')) {
        omitTargetCost = 0.26;
      } else if ((cb === 'l' || cb === 'r') && j > 1 && FINE_VOWEL_CHARS.has(tFine[j - 2])) {
        omitTargetCost = 0.32;
      }

      // An extra sound in what was typed: cheap for a vowel or glide, g after n, or r after a vowel.
      let extraQueryCost = 0.95;
      if (FINE_VOWEL_CHARS.has(ca) || ca === 'w' || ca === 'h') {
        extraQueryCost = 0.36;
      } else if (ca === 'g' && i > 1 && qFine[i - 2] === 'n') {
        extraQueryCost = 0.22;
      } else if (ca === 'r' && i > 1 && FINE_VOWEL_CHARS.has(qFine[i - 2])) {
        extraQueryCost = 0.32;
      }

      const val = Math.min(
        prev[j - 1] + sub,
        curr[j - 1] + omitTargetCost,
        prev[j] + extraQueryCost
      );
      curr[j] = val;
      if (val < rowMin) rowMin = val;
    }

    if (rowMin > maxCost) return maxCost + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[lb] + darkLPenalty;
}

/**
 * Distance of `qFine` to the best-matching beginning of `tFine`, for words that were both spelled by
 * ear and left unfinished (`fiziolo`, `antrepr`).
 */
export function phonologicalPrefixDistance(qFine: string, tFine: string, maxCost = 1.6): number {
  const la = qFine.length;
  const lb = tFine.length;
  if (la === 0 || lb === 0) return maxCost + 1;

  let prev = new Float32Array(lb + 1);
  let curr = new Float32Array(lb + 1);

  for (let j = 1; j <= lb; j++) {
    prev[j] = prev[j - 1] + (FINE_VOWEL_CHARS.has(tFine[j - 1]) ? 0.38 : 0.85);
  }

  for (let i = 1; i <= la; i++) {
    const ca = qFine[i - 1];
    curr[0] = prev[0] + (FINE_VOWEL_CHARS.has(ca) ? 0.38 : 0.9);
    let rowMin = curr[0];

    for (let j = 1; j <= lb; j++) {
      const cb = tFine[j - 1];
      const sub = phonologicalSubCost(ca, cb);
      const omitTarget = FINE_VOWEL_CHARS.has(cb) ? 0.35 : cb === 'l' || cb === 'r' ? 0.35 : 0.9;
      const extraQuery = FINE_VOWEL_CHARS.has(ca) ? 0.36 : 0.9;
      const val = Math.min(prev[j - 1] + sub, curr[j - 1] + omitTarget, prev[j] + extraQuery);
      curr[j] = val;
      if (val < rowMin) rowMin = val;
    }

    const tmp = prev;
    prev = curr;
    curr = tmp;
    if (rowMin > maxCost) return maxCost + 1;
  }

  let bestCost = maxCost + 1;
  const minJ = Math.max(2, la - 2);
  const maxJ = Math.min(lb, la + 3);
  for (let j = minJ; j <= maxJ; j++) {
    if (prev[j] < bestCost) bestCost = prev[j];
  }

  return bestCost;
}

/** Edit distance with swaps of neighbouring characters; returns `maxDist + 1` once it is exceeded. */
export function damerauLevenshtein(a: string, b: string, maxDist = 3): number {
  const la = a.length;
  const lb = b.length;
  if (a === b) return 0;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const prevPrev = new Uint16Array(lb + 1);
  const prev = new Uint16Array(lb + 1);
  const curr = new Uint16Array(lb + 1);

  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);

    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      let val = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);

      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        val = Math.min(val, prevPrev[j - 2] + 1);
      }

      curr[j] = val;
      if (val < rowMin) rowMin = val;
    }

    if (rowMin > maxDist) return maxDist + 1;

    prevPrev.set(prev);
    prev.set(curr);
  }

  return prev[lb];
}

/**
 * Letter-level edit distance in which the usual spelling slips are cheap: a doubled or missing double
 * letter, one vowel for another, a confusable consonant pair, two swapped neighbours.
 */
export function weightedEslDistance(query: string, target: string, maxCost = 3.6): number {
  const a = query.toLowerCase();
  const b = target.toLowerCase();
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > Math.ceil(maxCost) + 1) return maxCost + 1;

  const dpPrevPrev = new Float32Array(lb + 1);
  const dpPrev = new Float32Array(lb + 1);
  const dpCurr = new Float32Array(lb + 1);

  for (let j = 0; j <= lb; j++) {
    dpPrev[j] = j === 0 ? 0 : dpPrev[j - 1] + (j > 1 && b[j - 1] === b[j - 2] ? 0.35 : 1.0);
  }

  for (let i = 1; i <= la; i++) {
    const delCost = i > 1 && a[i - 1] === a[i - 2] ? 0.35 : 1.0;
    dpCurr[0] = dpPrev[0] + delCost;
    let rowMin = dpCurr[0];
    const ca = a[i - 1];

    for (let j = 1; j <= lb; j++) {
      const cb = b[j - 1];
      let subCost = 1.0;
      if (ca === cb) {
        subCost = 0;
      } else if (VOWELS.has(ca) && VOWELS.has(cb)) {
        subCost = 0.45;
      } else if (isConfusableConsonantPair(ca, cb)) {
        subCost = 0.52;
      }

      const insCost = j > 1 && cb === b[j - 2] ? 0.35 : VOWELS.has(cb) ? 0.72 : 1.0;
      const dCost = i > 1 && ca === a[i - 2] ? 0.35 : VOWELS.has(ca) ? 0.72 : 1.0;

      let val = Math.min(dpPrev[j - 1] + subCost, dpCurr[j - 1] + insCost, dpPrev[j] + dCost);

      if (i > 1 && j > 1 && ca === b[j - 2] && a[i - 2] === cb) {
        val = Math.min(val, dpPrevPrev[j - 2] + 0.55);
      }

      dpCurr[j] = val;
      if (val < rowMin) rowMin = val;
    }

    if (rowMin > maxCost) return maxCost + 1;

    dpPrevPrev.set(dpPrev);
    dpPrev.set(dpCurr);
  }

  return dpPrev[lb];
}

function isConfusableConsonantPair(a: string, b: string): boolean {
  const x = a < b ? a + b : b + a;
  return (
    x === 'bp' ||
    x === 'dt' ||
    x === 'gk' ||
    x === 'fv' ||
    x === 'cs' ||
    x === 'ck' ||
    x === 'sz' ||
    x === 'gj' ||
    x === 'lr' ||
    x === 'vw' ||
    x === 'kq' ||
    x === 'mn'
  );
}
