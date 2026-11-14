// Does Space fix what should be fixed and leave the rest alone? Uses the FIX and KEEP sets in sets.ts.
//   bash eval/run.sh eval/precision.ts [-v]
import { type } from './harness';

import { FIX, KEEP } from './sets';

const verbose = process.argv.includes('-v');
const commit = (q: string) => type(q + ' ', 'I use ').slice('I use '.length).trimEnd();

let fixOk = 0;
const fixBad: string[] = [];
for (const [q, want] of Object.entries(FIX)) {
  const got = commit(q);
  if (got.toLowerCase() === want) fixOk++;
  else fixBad.push(`  ${q.padEnd(12)} → ${got.padEnd(14)} want ${want}`);
}
let keepOk = 0;
const keepBad: string[] = [];
for (const q of KEEP) {
  const got = commit(q);
  if (got.toLowerCase() === q.toLowerCase()) keepOk++;
  else keepBad.push(`  ${q.padEnd(12)} → ${got}`);
}
if (verbose || fixBad.length < 40) console.log(`FIX misses (${fixBad.length}):\n${fixBad.join('\n')}`);
if (verbose || keepBad.length < 60) console.log(`KEEP violations (${keepBad.length}):\n${keepBad.join('\n')}`);
const nF = Object.keys(FIX).length;
console.log(`\nFIX  ${fixOk}/${nF} (${((100 * fixOk) / nF).toFixed(0)}%) corrected`);
console.log(`KEEP ${keepOk}/${KEEP.length} (${((100 * keepOk) / KEEP.length).toFixed(0)}%) left as typed`);
