// Dump every word-level decision of the evaluation data as one JSON line, for fitting and checking the
// language-model rule (scripts/lm/fit_rule.py):
//   bash eval/run.sh eval/lm-instances.ts > scripts/lm/instances.jsonl
// An instance is one token about to be committed: the text before it, what was typed, what was meant,
// and the engine's candidates.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, engine } from './harness';
import { FIX, KEEP } from './sets';

const DIR = path.join(ROOT, 'tests/data/scenarios');
// The shell reads at most this much text before the caret.
const CONTEXT_CHARS = 90;
const CORE = /^([("']*)([A-Za-z]+(?:'[a-z]+)?)([)"'.,!?;:]*)$/;

function emit(src: string, typed: string[], intended: string[], from = 0): void {
  for (let i = from; i < typed.length; i++) {
    const mt = CORE.exec(typed[i]);
    const mi = CORE.exec(intended[i]);
    if (!mt || !mi) continue;
    const t = mt[2];
    const want = mi[2];
    const before = intended.slice(0, i).join(' ') + (i ? ' ' : '');
    const r = engine.query(t, before);
    if (r.candidates.length <= 1) continue;
    console.log(JSON.stringify({
      src, before: before.slice(-CONTEXT_CHARS), typed: t, want, typo: t.toLowerCase() !== want.toLowerCase(),
      tier: engine.lexicon.known.tier(t.toLowerCase()), inLex: engine.lexicon.exactMap.has(t.toLowerCase()),
      space: r.candidates[0].word,
      cands: r.candidates.map((c) => ({ w: c.word, ch: c.channel, s: Math.round(c.score), cost: c.cost ?? null, comp: Boolean(c.isCompletion) })),
    }));
  }
}

for (const line of fs.readFileSync(path.join(DIR, 'learner.tsv'), 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length !== 5) continue;
  const typed = f[3].split(' ');
  const intended = f[4].split(' ');
  if (typed.length === intended.length) emit('learner', typed, intended);
}
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort()) {
  for (const line of fs.readFileSync(path.join(DIR, file), 'utf8').split('\n').filter((l) => l.trim())) {
    const tokens = line.split(' ');
    emit('correct', tokens, tokens);
  }
}
for (const [wrong, right] of Object.entries(FIX)) emit('fix', ['I', 'use', wrong], ['I', 'use', right], 2);
for (const word of KEEP) emit('keep', ['I', 'use', word], ['I', 'use', word], 2);
