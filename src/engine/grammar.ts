import {
  ContextSignal,
  POS_FLAG_ADJ,
  POS_FLAG_ADV,
  POS_FLAG_NOUN,
  POS_FLAG_VERB,
} from './types';

/** Is `derived` an inflection of `base`? Decided by the paradigm table, then by the regular endings. */
export function isInflectionOfLemma(
  base: string,
  derived: string,
  inflectionToLemma?: Map<string, string>
): boolean {
  if (derived === base) return false;
  if (inflectionToLemma && inflectionToLemma.get(derived) === base) {
    return true;
  }
  if (derived.length <= base.length || !derived.startsWith(base.slice(0, Math.max(2, base.length - 1)))) {
    return false;
  }
  if (
    derived === base + 's' ||
    derived === base + 'es' ||
    derived === base + 'd' ||
    derived === base + 'ed' ||
    derived === base + 'ing'
  ) {
    return true;
  }
  if (base.endsWith('e') && derived === base.slice(0, -1) + 'ing') return true;
  const last = base[base.length - 1];
  if (derived === base + last + 'ed' || derived === base + last + 'ing') return true;
  return false;
}

const PAST_TIME_WORDS = new Set([
  'yesterday', 'ago', 'previously', 'earlier', 'formerly',
]);

const STRICT_NOMINATIVE_SUBJECTS = new Set([
  'i', 'he', 'she', 'we', 'they', 'who',
  'everyone', 'everybody', 'someone', 'somebody', 'nobody', 'anyone',
]);

const AMBIGUOUS_SUBJ_OBJ_PRONOUNS = new Set(['you', 'it']);

const VALID_WORDS_BEFORE_SUBJ_YOU_IT = new Set([
  'and', 'but', 'or', 'so', 'yet', 'because', 'if', 'when', 'whenever', 'while', 'though',
  'although', 'unless', 'until', 'since', 'once', 'whether', 'that', 'where', 'how', 'why',
  'yesterday', 'today', 'tomorrow', 'recently', 'earlier', 'previously', 'usually', 'normally',
  'think', 'thought', 'know', 'knew', 'believe', 'hope', 'said', 'says', 'mean', 'means', 'sure', 'glad',
]);

// After these the verb of the following clause stays bare: `I suggest he take it`, `made everyone cry`,
// `let her go`, `saw him leave`, `have everyone sign`, `insist that she be told`.
const BARE_VERB_GOVERNORS = new Set([
  'make', 'makes', 'made', 'making', 'let', 'lets', 'letting', 'help', 'helps', 'helped', 'helping',
  'see', 'sees', 'saw', 'seen', 'watch', 'watches', 'watched', 'hear', 'hears', 'heard', 'feel', 'felt',
  'have', 'has', 'had', 'having',
  'suggest', 'suggests', 'suggested', 'recommend', 'recommends', 'recommended', 'insist', 'insists', 'insisted',
  'demand', 'demands', 'demanded', 'request', 'requests', 'requested', 'propose', 'proposes', 'proposed',
  'require', 'requires', 'required', 'ask', 'asks', 'asked', 'prefer', 'prefers', 'preferred',
  'important', 'essential', 'vital', 'necessary', 'crucial',
]);

// `number 12 bus`, `room 3 key`, `version 2 release`: a label, not a count.
const NUMBER_LABELS = new Set([
  'number', 'no', 'room', 'page', 'line', 'version', 'chapter', 'step', 'level', 'route', 'gate', 'platform',
  'flight', 'bus', 'track', 'lane', 'phase', 'stage', 'type', 'class', 'grade', 'floor', 'table', 'figure',
  'section', 'item', 'option', 'day', 'week', 'year', 'season', 'episode', 'issue', 'ticket', 'top', 'iphone', 'ios',
]);

const THIRD_SINGULAR_PRONOUNS = new Set([
  'he', 'she', 'it', 'everyone', 'everybody', 'someone', 'somebody', 'nobody', 'anyone',
]);

const MODALS_AND_AUX = new Set([
  'to', 'will', 'would', 'can', 'cannot', 'could', 'should', 'must', 'may', 'might', 'shall',
  'do', 'does', 'did', "don't", "doesn't", "didn't", "won't", "wouldn't", "can't",
  "couldn't", "shouldn't", 'dont', 'doesnt', 'didnt', 'cant', 'wont', 'lets', "let's",
]);

const INTERROGATIVE_AUX = new Set([
  'do', 'does', 'did', 'will', 'would', 'can', 'cannot', 'could', 'should', 'shall', 'may', 'might',
  "don't", "doesn't", "didn't", "won't", "wouldn't", "can't", "couldn't", "shouldn't",
]);

const HAVE_AUX = new Set([
  'have', 'has', 'had', "haven't", "hasn't", "hadn't", "i've", "you've", "we've", "they've", 'ive', 'weve', 'theyve',
]);

const ADVERBS_BETWEEN_SUBJ_VERB = new Set([
  'always', 'often', 'usually', 'never', 'just', 'already', 'also', 'still',
  'really', 'definitely', 'actually', 'probably', 'simply', 'quickly', 'recently', 'sincerely',
]);

const DEGREE_INTENSIFIERS = new Set([
  'very', 'quite', 'extremely', 'fairly', 'rather', 'pretty', 'too', 'so', 'highly', 'completely', 'totally',
]);

const DETERMINERS_AND_PREPS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her',
  'its', 'our', 'their', 'some', 'any', 'no', 'every', 'each', 'another',
  'of', 'in', 'on', 'at', 'for', 'with', 'without', 'by', 'from', 'into', 'about',
  'after', 'before', 'under', 'over', 'between', 'through', 'during',
]);

// Quantifiers that are only followed by a plural count noun. Those that also take mass nouns
// (`some information`, `more advice`, `a lot of`) are left out on purpose.
const PLURAL_COUNT_QUANTIFIERS = new Set([
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'dozen', 'hundreds', 'thousands',
  'many', 'several', 'multiple', 'various', 'numerous', 'both', 'few', 'these', 'those', 'couple',
]);

// `a two bedroom flat`, `this five year plan`: a counted singular noun used as a modifier.
const CARDINALS = new Set(['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']);
const MODIFIER_LEADS = new Set(['a', 'an', 'per', 'every', 'each', 'this', 'that']);
const BE_FORMS = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'get', 'gets', 'got']);

const COPULAS = new Set(['is', 'are', 'was', 'were', "isn't", "aren't", "wasn't", "weren't"]);

const NO_CAP_AFTER_ABBREV =
  /^(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|sr|jr|st|no|fig|eq|approx|inc|ltd|co|corp|dept|est|ca|cf|al|ed|vol|pp|a\.m|p\.m)$/i;

/**
 * Should the next word be capitalised? Only after a finished sentence (`. ! ?` + whitespace) -
 * never at the start of an empty field (search boxes, terminals, chat one-liners), after an
 * abbreviation (`e.g.`), a single letter (`J.`), a bare number (`1.`) or an ellipsis.
 */
export function shouldCapitalizeNext(textBeforeCaret: string): boolean {
  const m = textBeforeCaret.match(/([^\s]+)\s+$/);
  if (!m) return false;
  const core = m[1].replace(/["'”’)\]]+$/, '');
  if (/[!?]$/.test(core)) return true;
  if (!core.endsWith('.') || core.endsWith('..')) return false;
  const word = core.slice(0, -1).replace(/^[("'“‘\[]+/, '');
  if (word.length <= 1 || /^\d+$/.test(word)) return false;
  if (word.includes('.') && word.length <= 8 && !/\.[a-z]{2,}$/i.test(word)) return false; // U.N. / y.o. / A.L.A.M.
  if (NO_CAP_AFTER_ABBREV.test(word)) return false;
  return true;
}

/** Grammatical signals read from the clause in front of the caret. */
export function analyzeContext(
  textBeforeCaret: string,
  pastVerbSet?: Set<string>
): ContextSignal {
  const trimmed = textBeforeCaret.replace(/\s+$/, '');
  const capitalizeNext = shouldCapitalizeNext(textBeforeCaret);
  if (!trimmed || /[.!?]\s*$/.test(trimmed)) {
    return {
      capitalizeNext,
      nounPhraseSubject: false,
      explicitPastTime: false,
      coordAfterPast: false,
      prevWords: [],
      lastWord: '',
      prev2Word: '',
      isSentenceStart: true,
      hasPastMarker: false,
      isThirdPersonSingularSubj: false,
      isVerbSlotAfterSubj: false,
      afterModalOrTo: false,
      afterHaveAux: false,
      afterDeterminerOrPrep: false,
      afterPluralQuantifier: false,
      afterDegreeAdv: false,
      afterCopulaEntity: false,
      afterArticleA: null,
    };
  }

  // A bracket, colon or semicolon starts a new clause too: `the upstream bug (see ...` has no subject for `see`.
  const lastClauseRaw = trimmed.split(/[.!?\n;:()\[\]]/).pop() ?? trimmed;
  const rawCasedTokens = lastClauseRaw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, ''))
    .filter(Boolean)
    .slice(-14);

  const prevWords = rawCasedTokens.map((t) => t.toLowerCase());
  const lastWord = prevWords[prevWords.length - 1] ?? '';
  const prev2Word = prevWords[prevWords.length - 2] ?? '';
  const prev3Word = prevWords[prevWords.length - 3] ?? '';
  const clauseText = prevWords.join(' ');

  const explicitPastTime =
    prevWords.some((w) => PAST_TIME_WORDS.has(w)) ||
    /\blast\s+(night|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|time)\b/.test(clauseText) ||
    /\bthis\s+morning\b/.test(clauseText) ||
    /\bin\s+(19\d\d|20[01]\d|202[0-5])\b/.test(clauseText);

  let clauseHasPastVerb = false;
  for (let i = 0; i < prevWords.length - 1; i++) {
    const w = prevWords[i];
    if (w !== 'was' && w !== 'were' && w !== 'had' && pastVerbSet?.has(w)) {
      const prevTok = i > 0 ? prevWords[i - 1] : '';
      // Not a finite past verb after have (perfect), be (passive: `is stored`) or a determiner (`the stored data`).
      if (!HAVE_AUX.has(prevTok) && !BE_FORMS.has(prevTok) && !DETERMINERS_AND_PREPS.has(prevTok)) {
        clauseHasPastVerb = true;
        break;
      }
    }
  }

  const hasPastMarker = explicitPastTime || clauseHasPastVerb;

  const effectivePrev = ADVERBS_BETWEEN_SUBJ_VERB.has(lastWord) && prev2Word ? prev2Word : lastWord;
  const beforeEffectivePrev = ADVERBS_BETWEEN_SUBJ_VERB.has(lastWord) ? prev3Word : prev2Word;

  const afterModalOrTo = MODALS_AND_AUX.has(effectivePrev);
  const afterHaveAux = HAVE_AUX.has(effectivePrev);
  const afterDeterminerOrPrep = DETERMINERS_AND_PREPS.has(lastWord);
  // The quantifier must be the plain previous token (`many,` or `10-` or `1.23` do not count), and a counted
  // noun after `a/this + number` is a modifier (`a two bedroom flat`), not a plural.
  const rawLastToken = ((textBeforeCaret.match(/(\S+)\s+$/) ?? [])[1] ?? '').toLowerCase();
  const isNumber = /^\d{1,3}$/.test(rawLastToken) && rawLastToken !== '0' && rawLastToken !== '1';
  const usedAsModifier =
    ((isNumber || CARDINALS.has(rawLastToken)) && MODIFIER_LEADS.has(prev2Word)) ||
    (isNumber && NUMBER_LABELS.has(prev2Word));
  const afterPluralQuantifier =
    !usedAsModifier &&
    (isNumber ||
      (rawLastToken === lastWord &&
        (PLURAL_COUNT_QUANTIFIERS.has(lastWord) || (lastWord === 'of' && prev2Word === 'couple'))));
  const afterDegreeAdv = DEGREE_INTENSIFIERS.has(lastWord);

  const blockedByQuestionAux = INTERROGATIVE_AUX.has(beforeEffectivePrev);

  const isGenuineSubjectPronoun =
    STRICT_NOMINATIVE_SUBJECTS.has(effectivePrev) ||
    (AMBIGUOUS_SUBJ_OBJ_PRONOUNS.has(effectivePrev) &&
      (!beforeEffectivePrev || VALID_WORDS_BEFORE_SUBJ_YOU_IT.has(beforeEffectivePrev)));

  let hasInfinitiveInRecentWindow = false;
  const windowStart = Math.max(0, prevWords.length - 6);
  for (let k = windowStart; k < prevWords.length - 2; k++) {
    if (prevWords[k] === 'to' && !DETERMINERS_AND_PREPS.has(prevWords[k + 1])) {
      hasInfinitiveInRecentWindow = true;
      break;
    }
  }

  // `Did she go ahead and approve it`, `we could go and see`: with do-support or a modal in the clause the
  // coordinated verb is bare, whatever tense the clause is in.
  const clauseHasBareVerbAux = prevWords.some((w) => INTERROGATIVE_AUX.has(w));
  const isCoordAfterPast =
    hasPastMarker &&
    (lastWord === 'and' || lastWord === 'then') &&
    prevWords.length >= 2 &&
    !hasInfinitiveInRecentWindow &&
    !clauseHasBareVerbAux;

  const isVerbSlotAfterSubj =
    !afterModalOrTo &&
    !afterHaveAux &&
    !afterDeterminerOrPrep &&
    !blockedByQuestionAux &&
    (isGenuineSubjectPronoun || isCoordAfterPast);

  // The word in front of the subject decides whether its verb is finite at all.
  const governor = beforeEffectivePrev === 'that' ? (ADVERBS_BETWEEN_SUBJ_VERB.has(lastWord) ? prevWords[prevWords.length - 4] : prev3Word) : beforeEffectivePrev;
  const bareVerbClause = BARE_VERB_GOVERNORS.has(governor ?? '');
  // `Anyone know why?`, `Anybody have a charger?`: a question with its auxiliary dropped.
  const ellipticalQuestion =
    (effectivePrev === 'anyone' || effectivePrev === 'anybody') && !beforeEffectivePrev;
  const isThirdPersonSingularSubj =
    isVerbSlotAfterSubj &&
    !hasPastMarker &&
    !bareVerbClause &&
    !ellipticalQuestion &&
    THIRD_SINGULAR_PRONOUNS.has(effectivePrev);

  const prev2Cased = rawCasedTokens[rawCasedTokens.length - 2] ?? '';
  const afterCopulaEntity =
    COPULAS.has(lastWord) &&
    rawCasedTokens.length >= 2 &&
    prev2Cased[0] >= 'A' &&
    prev2Cased[0] <= 'Z';

  const afterArticleA: 'a' | 'an' | null =
    lastWord === 'a' ? 'a' : lastWord === 'an' ? 'an' : null;

  return {
    prevWords,
    lastWord,
    prev2Word,
    isSentenceStart: false,
    hasPastMarker,
    isThirdPersonSingularSubj,
    isVerbSlotAfterSubj,
    afterModalOrTo,
    afterHaveAux,
    afterDeterminerOrPrep,
    afterPluralQuantifier,
    afterDegreeAdv,
    afterCopulaEntity,
    afterArticleA,
    capitalizeNext,
    nounPhraseSubject: false,
    explicitPastTime,
    coordAfterPast: isCoordAfterPast,
  };
}

const COMPARATIVE_TRIGGERS = new Set([
  'more', 'less', 'better', 'worse', 'faster', 'slower', 'higher', 'lower',
  'bigger', 'smaller', 'easier', 'harder', 'rather', 'other', 'different',
]);

/** Points for how well `word` fits the grammatical slot at the caret (negative when it does not fit). */
export function computeContextBonus(word: string, ctx: ContextSignal, posFlags = 0): number {
  const last = ctx.lastWord;
  if (!last || ctx.afterCopulaEntity) return 0;

  if (word === 'affect') {
    if (ctx.afterModalOrTo || ['not', 'directly', 'negatively', 'significantly'].includes(last)) {
      return 42;
    }
    if (ctx.afterDeterminerOrPrep) return -35;
  }
  if (word === 'effect') {
    if (ctx.afterDeterminerOrPrep || ['side', 'positive', 'negative', 'main', 'into', 'take'].includes(last)) {
      return 42;
    }
  }
  if (word === 'than' && ctx.prevWords.some((w) => COMPARATIVE_TRIGGERS.has(w))) {
    return 45;
  }
  if (word === 'compliment' && ['nice', 'huge', 'great', 'pay', 'paid', 'sincere'].includes(last)) {
    return 30;
  }
  if (word === 'principle' && ['in', 'first', 'basic', 'core', 'fundamental', 'guiding'].includes(last)) {
    return 34;
  }

  if (posFlags !== 0) {
    const isVerb = (posFlags & POS_FLAG_VERB) !== 0;
    const isNoun = (posFlags & POS_FLAG_NOUN) !== 0;
    const isAdj = (posFlags & POS_FLAG_ADJ) !== 0;
    const isAdv = (posFlags & POS_FLAG_ADV) !== 0;

    // A word that can fill the slot gets the bonus even when it has other parts of speech too
    // (`my phone`: phone is noun+verb and must not lose to a noun-only look-alike).
    if (ctx.afterModalOrTo) {
      if (isVerb) {
        return !isNoun && !isAdj ? 26 : 16;
      }
      // `to` is also a preposition (`go to school`), so a noun after it is not out of place.
      if (last === 'to' && isNoun) {
        return 0;
      }
      if (isNoun || isAdj || isAdv) {
        return -24;
      }
    }

    if (ctx.afterDeterminerOrPrep) {
      if (isNoun || isAdj) {
        return isVerb ? 16 : 22;
      }
      if (isVerb) {
        return -26;
      }
    }

    if (ctx.afterDegreeAdv) {
      if (isAdj || isAdv) {
        return 28;
      }
      if (isNoun && !isAdj) {
        return -18;
      }
    }
  }

    return 0;
  }
