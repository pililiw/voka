// Candidates for one or more tokens in a context:
//   bash eval/run.sh eval/query.ts <token>[,<token>...] ["text before the caret"]
// Per candidate: word [channel score fix=<score as a correction> cost freq context]; `budget` is the highest
// correction cost Space would accept for the token, `tab` the index of the candidate Tab takes.
import { engine } from './harness';

const [tokens, before = ''] = process.argv.slice(2);
if (!tokens) {
  console.error('usage: query.ts <token>[,<token>...] ["text before the caret"]');
  process.exit(2);
}
for (const q of tokens.split(',')) {
  const r = engine.query(q, before, 9);
  const rows = r.candidates.map(
    (c) =>
      `${c.word}[${c.channel} ${Math.round(c.score)}${c.fixScore !== undefined ? ` fix=${c.fixScore}` : ''}` +
      `${c.cost !== undefined ? ` cost=${c.cost} f=${c.freq} ctx=${c.context}` : ''}]`
  );
  console.log(`${q}  budget=${r.fixBudget ?? '-'}  tab=${r.bestLongerCompletionIndex}\n    ${rows.join('\n    ')}`);
}
