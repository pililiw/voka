export type MatchChannel =
  | 'exact'
  | 'brand'
  | 'alias'
  | 'prefix'
  | 'skeleton'
  | 'typo'
  | 'phonetic'
  | 'grammar'
  | 'prediction'
  | 'literal';

/** How many candidates the window shows. */
export const MAX_CANDIDATES = 5;

export const POS_FLAG_VERB = 8;
export const POS_FLAG_NOUN = 16;
export const POS_FLAG_ADJ = 32;
export const POS_FLAG_ADV = 64;

export interface LexiconEntry {
  id: number;
  word: string;
  canonicalCase?: string;
  freq: number;
  /** Phonetic codes of the pronunciation, from the coarsest to the finest (see phonetic.ts). */
  place: string;
  altPlace: string;
  coarse: string;
  altCoarse: string;
  fine: string;
  /** Coarse code derived from the spelling. */
  orthCoarse: string;
  /** Fine code derived from the spelling (same rules as for typed input), next to the pronunciation-based `fine`. */
  orthFine: string;
  gloss: string;
  isCore: boolean;
  startsWithVowel: boolean;
  noSuggest: boolean;
  posFlags: number;
}

export interface Candidate {
  /** As it will be committed (with its capitalisation). */
  word: string;
  /** Lower-case lexicon form. */
  rawWord: string;
  gloss: string;
  channel: MatchChannel;
  score: number;
  /** True for the candidate that reproduces the typed token exactly. */
  isLiteral?: boolean;
  /** Needs more letters than were typed (a completion): offered on Tab, never applied by Space. */
  isCompletion?: boolean;
  /** Committing this word also changes the article in front of it (`a apple` -> `an apple`). */
  prevWordFix?: { from: string; to: string };
  /** Scoring details, for the evaluation tools. */
  freq?: number;
  context?: number;
  cost?: number;
  /** Score as a correction of the whole typed token (frequency + context - cost); undefined for completions. */
  fixScore?: number;
}

export interface ContextSignal {
  prevWords: string[];
  lastWord: string;
  prev2Word: string;
  isSentenceStart: boolean;
  hasPastMarker: boolean;
  isThirdPersonSingularSubj: boolean;
  isVerbSlotAfterSubj: boolean;
  afterModalOrTo: boolean;
  afterHaveAux: boolean;
  afterDeterminerOrPrep: boolean;
  afterPluralQuantifier: boolean;
  afterDegreeAdv: boolean;
  afterCopulaEntity: boolean;
  afterArticleA: 'a' | 'an' | null;
  /** The previous sentence ended (`. ! ?` + whitespace) and the next word may be capitalised. */
  capitalizeNext: boolean;
  /** Clause-initial `the/my/this + singular noun` subject (`the user | my boss`), for 3rd-person agreement. */
  nounPhraseSubject: boolean;
  /** An explicit past-time expression is in the clause (`yesterday`, `last week`, `ago`). */
  explicitPastTime: boolean;
  /** `... sang a song and |`: the verb continues a past-tense clause after and / then. */
  coordAfterPast: boolean;
}

export interface EngineQueryResult {
  rawQuery: string;
  /** The token is code-like (digits, symbols, camelCase, ...) and is kept exactly as typed. */
  isCodeLiteral: boolean;
  context: ContextSignal;
  /** candidates[0] is always what Space commits. */
  candidates: Candidate[];
  /** Index of the candidate Tab commits (first one that differs from the typed token), or -1. */
  bestLongerCompletionIndex: number;
  /** False when there is nothing to choose (single candidate identical to the typed token). */
  showWindow?: boolean;
  /** Highest correction cost Space would accept for this token, for the evaluation tools. */
  fixBudget?: number;
}
