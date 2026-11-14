/**
 * Optional language-model evidence for the word being typed. The shell may score the candidates with
 * a language model (log P(word | text before)) and pass the scores back. The model can only add a
 * correction where the engine was not sure enough to make one, and it reorders the suggestions; it never
 * takes back a correction the engine makes, and it has no say over known words.
 */
import { LM_RULE } from './lm-rule';
import { VokaEngine } from './ranker';
import { Candidate, EngineQueryResult } from './types';

const MISSING = -60;

const isTyped = (c: Candidate, typed: string) => c.word.toLowerCase() === typed.toLowerCase();

/** The words to score, or null when the model has no say: known words, tokens the engine corrects itself. */
export function lmWords(engine: VokaEngine, result: EngineQueryResult | null, typed: string): string[] | null {
  if (!result || result.showWindow === false || result.candidates.length < 2 || !/^[A-Za-z]+$/.test(typed)) return null;
  const q = typed.toLowerCase();
  if (engine.lexicon.exactMap.has(q) || engine.lexicon.known.tier(q) >= 3) return null;
  if (!isTyped(result.candidates[0], typed)) return null;
  // A shorthand the engine knows (`mgmt`) is typed on purpose: Tab expands it, Space keeps it.
  if (result.candidates.some((c) => c.channel === 'alias')) return null;
  const words = result.candidates.map((c) => c.word);
  if (!result.candidates.some((c) => isTyped(c, typed))) words.push(typed);
  return words;
}

/** Reorder the candidates so that the first one is what Space should commit, given the model's scores. */
export function applyLm(engine: VokaEngine, result: EngineQueryResult, typed: string, scores: Record<string, number>): EngineQueryResult {
  const R = LM_RULE;
  const lp = (w: string) => scores[w] ?? MISSING;
  const alts = result.candidates.filter((c) => !isTyped(c, typed) && !c.isCompletion && c.channel !== 'literal');
  const typedCand = result.candidates.find((c) => isTyped(c, typed));
  if (alts.length === 0 || !typedCand) return result;
  const combined = (c: Candidate) => c.score / R.scoreScale + R.lmWeight * lp(c.word);
  const best = alts.reduce((a, b) => (combined(b) > combined(a) ? b : a));
  const others = alts.filter((c) => c !== best).map(combined);
  const x = [
    1,
    lp(best.word) - lp(typed),
    (best.cost ?? 150) / 100,
    (best.score - typedCand.score) / 100,
    engine.lexicon.known.tier(typed.toLowerCase()),
    Math.min(typed.length, 12) / 10,
    others.length ? Math.min(6, combined(best) - Math.max(...others)) : 6,
    best.channel === 'phonetic' ? 1 : 0,
    best.channel === 'typo' ? 1 : 0,
  ];
  const z = x.reduce((sum, v, i) => sum + ((v - R.mean[i]) / R.scale[i]) * R.weights[i], 0);
  const replace = z >= R.threshold;
  const rest = result.candidates.filter((c) => c !== best && c !== typedCand);
  const candidates = replace ? [best, typedCand, ...rest] : [typedCand, best, ...rest];
  return { ...result, candidates, bestLongerCompletionIndex: candidates.findIndex((c) => !isTyped(c, typed)) };
}
