// Export the parity file:  bash eval/run.sh eval/export-parity.ts  ->  tests/data/parity.json
// Each item is { before, keys, expect }, where `expect` is the document this build produces. The bundled
// engine must reproduce it exactly on Node (eval/host-smoke.cjs) and in JavaScriptCore (npm run macos:test).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, type } from './harness';
import { CASES, KNOWN_GAPS } from './cases';
import { FIX, KEEP, PHON } from './sets';

const items: { before: string; keys: string; expect: string }[] = [];
const add = (before: string, keys: string) => items.push({ before, keys, expect: type(keys, before) });
for (const [, before, keys] of [...CASES, ...KNOWN_GAPS]) add(before, keys);
for (const q of Object.keys(FIX)) add('I use ', q + ' ');
for (const q of Object.keys(PHON)) add('', q + ' ');
for (const q of KEEP) add('I use ', q + ' ');

const SCENARIOS = path.join(ROOT, 'tests/data/scenarios');
const lines = (f: string) => fs.readFileSync(path.join(SCENARIOS, f), 'utf8').split('\n').filter((l) => l.trim());
for (const f of fs.readdirSync(SCENARIOS).filter((f) => f.endsWith('.txt')).sort()) {
  lines(f).forEach((line, i) => { if (i % 3 === 0) add('', line + ' '); });
}
lines('learner.tsv').forEach((l, i) => {
  const typed = l.split('\t')[3];
  if (typed && i % 2 === 0) add('', typed + ' ');
});
add('', 'teh quick brown fox jumsp over thier lazy dog. i think gpt4 is well-known and he want a apple ');
add('Yesterday I ', 'go to school and buyed⌫⌫⌫⌫⌫⌫buy some book. ');
add('', 'recom⇥hello⎋ world⏎');
fs.writeFileSync(path.join(ROOT, 'tests/data/parity.json'), JSON.stringify(items, null, 0) + '\n');
console.log(`parity.json: ${items.length} items`);
