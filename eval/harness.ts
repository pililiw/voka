// Shared helpers: load the dictionary, simulate typing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LexiconIndex, RawDictPayload } from '../src/engine/lexicon';
import { VokaEngine } from '../src/engine/ranker';
import { ImeSessionController } from '../src/engine/session';

// .devout/eval/harness.js -> repository root
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const payload = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/dict.json'), 'utf8')) as RawDictPayload;
export const engine = new VokaEngine(new LexiconIndex(payload));

const KEY_NAMES: Record<string, string> = {
  '⌫': 'Backspace', '⏎': 'Enter', '⇥': 'Tab', '⎋': 'Escape',
  '→': 'ArrowRight', '←': 'ArrowLeft', '↓': 'ArrowDown', '↑': 'ArrowUp',
};

/**
 * Type `keys` into a document that already contains `doc`.
 * Special keys: ⌫ Backspace, ⏎ Enter, ⇥ Tab, ⎋ Escape, arrows, and ⌥<digit> for Option+digit.
 * Unhandled printable keys are inserted like the host app would. A still-open preedit is shown as ⟦…⟧.
 */
export function type(keys: string, doc = ''): string {
  const s = new ImeSessionController(engine);
  const chars = [...keys];
  for (let i = 0; i < chars.length; i++) {
    let key = KEY_NAMES[chars[i]] ?? chars[i];
    let altKey = false;
    if (chars[i] === '⌥' && i + 1 < chars.length) { altKey = true; key = chars[++i]; }
    const r = s.handleKeyDown({ key, altKey }, doc, false);
    if (r.handled) {
      if (r.deleteBackChars) doc = doc.slice(0, doc.length - r.deleteBackChars);
      if (r.commitText) doc += r.commitText;
    }
    if ((!r.handled || r.passThrough) && !altKey) {
      // The host application handles the key itself.
      if (key.length === 1) doc += key;
      else if (key === 'Backspace') doc = doc.slice(0, -1);
      else if (key === 'Enter') doc += '\n';
      else if (key === 'Tab') doc += '\t';
    }
  }
  return doc + (s.preedit ? `⟦${s.preedit}⟧` : '');
}

export function candidates(query: string, before = '', n = 8): string {
  return engine
    .query(query, before)
    .candidates.slice(0, n)
    .map((c) => `${c.word}[${c.channel} ${Math.round(c.score)}]`)
    .join('  ');
}
