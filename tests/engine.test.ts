import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { LexiconIndex, RawDictPayload } from '../src/engine/lexicon';
import { VokaEngine } from '../src/engine/ranker';
import { ImeSessionController } from '../src/engine/session';

let engine: VokaEngine;

beforeAll(() => {
  const dictPath = path.join(process.cwd(), 'data/dict.json');
  const payload = JSON.parse(fs.readFileSync(dictPath, 'utf8')) as RawDictPayload;
  const lexicon = new LexiconIndex(payload);
  engine = new VokaEngine(lexicon);
});

function simulateTyping(
  session: ImeSessionController,
  sequence: string[],
  initialDoc = ''
): string {
  let doc = initialDoc;
  for (const key of sequence) {
    const res = session.handleKeyDown({ key }, doc, false);
    if (res.handled && (res.deleteBackChars || res.commitText !== undefined)) {
      if (res.deleteBackChars) {
        doc = doc.slice(0, doc.length - res.deleteBackChars);
      }
      if (res.commitText) {
        doc += res.commitText;
      }
    } else if (!res.handled && key.length === 1) {
      doc += key;
    }
  }
  return doc;
}

describe('engine', () => {
  it('applies irregular plurals after a quantifier and leaves regular, zero-plural and mass nouns alone', () => {
    const session = new ImeSessionController(engine);

    expect(simulateTyping(session, [...'person '], 'There are two ')).toBe('There are two people ');
    expect(simulateTyping(session, [...'prsn '], 'There are many ')).toBe('There are many people ');
    expect(simulateTyping(session, [...'child '], 'They have three ')).toBe(
      'They have three children '
    );
    expect(simulateTyping(session, [...'mouse '], 'Caught several ')).toBe('Caught several mice ');
    expect(simulateTyping(session, [...'tooth '], 'Brushed both ')).toBe('Brushed both teeth ');
    expect(simulateTyping(session, [...'criterion '], 'Meet these ')).toBe('Meet these criteria ');
    expect(simulateTyping(session, [...'phenomenon '], 'Observed two ')).toBe(
      'Observed two phenomena '
    );
    expect(simulateTyping(session, [...'knife '], 'Bought two ')).toBe('Bought two knives ');
    // A regular plural is not applied: after a quantifier a singular noun is very often a modifier
    // (`many zombie movies`, `many customer support tickets`), and committed text is never changed
    // afterwards. The plural is what Tab offers while the noun is being typed.
    expect(simulateTyping(session, [...'zmbie '], 'Killed many ')).toBe('Killed many zombie ');
    expect(simulateTyping(session, [...'zmbie in '], 'Killed many ')).toBe('Killed many zombie in ');
    expect(simulateTyping(session, [...'zmbie movies '], 'Watched many ')).toBe('Watched many zombie movies ');
    expect(engine.query('book', 'I have two ').candidates.map((c) => c.word)).toContain('books');

    // Plural nouns are not pluralised again.
    expect(simulateTyping(session, [...'people '], 'There are many ')).toBe(
      'There are many people '
    );
    expect(engine.query('person', 'There are two ').candidates.map((c) => c.rawWord)).not.toContain(
      'persons'
    );

    // Zero-plural and mass nouns never get an -s.
    expect(simulateTyping(session, [...'sheep '], 'Saw many ')).toBe('Saw many sheep ');
    expect(simulateTyping(session, [...'aircraft '], 'Built three ')).toBe('Built three aircraft ');
    expect(simulateTyping(session, [...'information '], 'Found many ')).toBe(
      'Found many information '
    );
    expect(simulateTyping(session, [...'equipment '], 'Bought several ')).toBe(
      'Bought several equipment '
    );
    expect(simulateTyping(session, [...'furniture '], 'Moved many ')).toBe('Moved many furniture ');

    // An adjective before the noun is not a noun.
    expect(simulateTyping(session, [...'good '], 'There are many ')).toBe('There are many good ');
    expect(simulateTyping(session, [...'open '], 'Left two ')).toBe('Left two open ');
  });

  it('picks past tense or past participle from the context, with the right spelling', () => {
    const session = new ImeSessionController(engine);

    expect(simulateTyping(session, [...'sing '], 'Yesterday she ')).toBe('Yesterday she sang ');
    expect(simulateTyping(session, [...'sing '], 'She has ')).toBe('She has sung ');

    expect(simulateTyping(session, [...'write '], 'Yesterday I ')).toBe('Yesterday I wrote ');
    expect(simulateTyping(session, [...'write '], 'I have ')).toBe('I have written ');

    expect(simulateTyping(session, [...'choose '], 'Yesterday we ')).toBe('Yesterday we chose ');
    expect(simulateTyping(session, [...'choose '], 'We have ')).toBe('We have chosen ');

    expect(simulateTyping(session, [...'forbid '], 'He has ')).toBe('He has forbidden ');
    expect(engine.query('freeze', 'The lake has ').candidates.map((c) => c.word)).toContain(
      'frozen'
    );
    expect(engine.query('freeze', 'Yesterday it ').candidates.map((c) => c.word)).toContain(
      'froze'
    );
    expect(engine.query('lead', 'Yesterday she ').candidates.map((c) => c.word)).toContain('led');

    // Consonant doubling and -ck- spellings.
    expect(simulateTyping(session, [...'occur '], 'Yesterday it ')).toBe('Yesterday it occurred ');
    expect(simulateTyping(session, [...'refer '], 'Yesterday he ')).toBe('Yesterday he referred ');
    expect(simulateTyping(session, [...'achieve '], 'She has ')).toBe('She has achieved ');
    expect(engine.query('panic', 'Yesterday they ').candidates.map((c) => c.word)).toContain(
      'panicked'
    );

    // A verb coordinated with a past-tense verb is past too.
    expect(simulateTyping(session, [...'leave '], 'She sang a song and ')).toBe(
      'She sang a song and left '
    );
  });

  it('finds the intended word from a spelling by sound', () => {
    expect(engine.query('zmbie').candidates[0].word).toBe('zombie');
    expect(engine.query('komfort').candidates[0].word).toBe('comfort');
    expect(engine.query('hangri').candidates[0].word).toBe('hungry');

    const cases: [string, string][] = [
      ['katastrofi', 'catastrophe'],
      ['igzajereit', 'exaggerate'],
      ['skeduel', 'schedule'],
    ];
    for (const [q, expected] of cases) {
      expect(engine.query(q).candidates[0].word, `query "${q}"`).toBe(expected);
    }
  });

  it('never replaces a real word, and lets the context order the suggestions behind it', () => {
    // `resit` is a real word (to sit an exam again), and real words are never replaced on Space.
    // After a noun-phrase opener it stays first and context only orders the suggestions behind it
    // (`receipt` must be among them); after a modal the verb reading `resist` is certain enough to lead.
    const keep = engine.query('resit', 'Please keep the ');
    expect(keep.candidates[0].word).toBe('resit');
    expect(keep.candidates.slice(1, 4).map((c) => c.word)).toContain('receipt');
    expect(engine.query('resit', 'She cannot ').candidates[0].word).toBe('resist');
  });

  it('leaves correct sentences as typed', () => {
    const session = new ImeSessionController(engine);
    expect(simulateTyping(session, [...'I like to visit japan in april '])).toBe(
      'I like to visit Japan in April '
    );
    expect(simulateTyping(session, [...'Yesterday I saw you go '])).toBe(
      'Yesterday I saw you go '
    );
    expect(simulateTyping(session, [...'Did he really go '])).toBe('Did he really go ');
  });
});
