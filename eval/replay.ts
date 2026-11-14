// Behaviour spec: types every case in cases.ts through a session and reports the ones that fail.
//   bash eval/run.sh eval/replay.ts          summary and failures
//   bash eval/run.sh eval/replay.ts -v       every case
import { type } from './harness';

import { CASES, KNOWN_GAPS } from './cases';

const verbose = process.argv.includes('-v');
const byGroup = new Map<string, { pass: number; total: number }>();
const failures: string[] = [];
for (const [group, before, keys, ...accept] of CASES) {
  const out = type(keys, before).slice(before.length);
  const ok = accept.includes(out);
  const g = byGroup.get(group) ?? { pass: 0, total: 0 };
  g.total++;
  if (ok) g.pass++;
  byGroup.set(group, g);
  const line = `${ok ? '✓' : '✗'} ${group.padEnd(4)} ${JSON.stringify(before + keys).padEnd(34)} → ${JSON.stringify(before + out)}${ok ? '' : `   want ${accept.map((a) => JSON.stringify(before + a)).join(' | ')}`}`;
  if (!ok) failures.push(line);
  if (verbose) console.log(line);
}
if (!verbose) failures.forEach((l) => console.log(l));
console.log('\n' + [...byGroup].map(([g, s]) => `${g} ${s.pass}/${s.total}`).join('  ·  '));
const total = [...byGroup.values()].reduce((a, s) => ({ pass: a.pass + s.pass, total: a.total + s.total }), { pass: 0, total: 0 });
console.log(`TOTAL ${total.pass}/${total.total}`);
const closed = KNOWN_GAPS.filter(([, before, keys, ...accept]) => accept.includes(type(keys, before).slice(before.length)));
console.log(`known gaps: ${KNOWN_GAPS.length - closed.length} open${closed.length ? `, ${closed.length} now pass (move them to CASES)` : ''}`);
process.exit(total.pass === total.total ? 0 : 1);
