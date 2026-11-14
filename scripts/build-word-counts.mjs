// Derive scripts/raw/word-counts.tsv, the word frequencies the dictionary is built from. The table is a
// build input like the other files in scripts/raw: it is not tracked, and only the compiled dictionary,
// with its acknowledgements, is distributed.
//
//   node scripts/build-word-counts.mjs <subtitles.txt> <wordfreq.txt>
//
// subtitles.txt  "word count" per line: the English list of https://github.com/hermitdave/FrequencyWords
//                (content/2018/en/en_full.txt, counted on OpenSubtitles 2018; CC BY-SA 4.0).
// wordfreq.txt   "word frequency" per line, exported from https://github.com/rspeer/wordfreq (data CC BY-SA 4.0):
//                python -c "import wordfreq as w; [print(x, w.word_frequency(x, 'en', 'large')) for x in w.iter_wordlist('en', 'large')]"
//
// Output columns: word, count, seen. Both are occurrences per 50 million words, the scale the thresholds
// in build-dictionary.mjs are written for.
//   count  how common the word is: the larger of the two sources, so that neither everyday speech
//          (subtitles) nor written and recent vocabulary (wordfreq) is undervalued.
//   seen   how often it occurs in subtitles. Only this says that a token is a word at all: wordfreq
//          also counts social media text, where misspellings are frequent.
import fs from 'node:fs';
import path from 'node:path';

const [subtitles, wordfreq] = process.argv.slice(2);
if (!subtitles || !wordfreq) {
  console.error('usage: node scripts/build-word-counts.mjs <subtitles.txt> <wordfreq.txt>');
  process.exit(2);
}
const PER = 50_000_000;

/** word -> occurrences per PER words, for plain words (letters, at most one apostrophe inside). */
function load(file) {
  const rows = [];
  let total = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [word, n] = line.split(' ');
    const value = Number(n);
    if (!word || !Number.isFinite(value)) continue;
    total += value;
    if (/^[a-z]+(?:'[a-z]+)?$/.test(word)) rows.push([word, value]);
  }
  return new Map(rows.map(([word, value]) => [word, (value * PER) / total]));
}

const spoken = load(subtitles);
const mixed = load(wordfreq);
const out = [];
for (const word of new Set([...spoken.keys(), ...mixed.keys()])) {
  const seen = Math.round(spoken.get(word) ?? 0);
  const count = Math.round(Math.max(spoken.get(word) ?? 0, mixed.get(word) ?? 0));
  // Rarer than this, a word that subtitles have never seen tells the build nothing.
  if (seen >= 1 || count >= 4) out.push([word, count, seen]);
}
out.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
const file = path.join(process.cwd(), 'scripts/raw/word-counts.tsv');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, out.map((row) => row.join('\t')).join('\n') + '\n');
console.log(`${file}: ${out.length} words`);
