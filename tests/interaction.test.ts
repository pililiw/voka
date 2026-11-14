import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createHost, HostApi, HostView } from '../src/engine/host';

let host: HostApi;
beforeAll(() => {
  host = createHost();
  host.init(fs.readFileSync('data/dict.json', 'utf8'));
});

function key(sid: number, value: string, before = '', shift = false, context = {}): HostView {
  return JSON.parse(host.key(sid, value, shift, false, false, false, before, JSON.stringify(context)));
}
function word(sid: number, value: string, context = {}): HostView {
  let view!: HostView;
  for (const c of value) view = key(sid, c, '', false, context);
  return view;
}

describe('host API', () => {
  it('commits the same correction at whitespace and closing punctuation', () => {
    for (const delimiter of [' ', '.', ',', '!', '?', ';', ':', ')', '"']) {
      const sid = host.newSession();
      word(sid, 'bhvr');
      expect(key(sid, delimiter).commit).toBe('behavior' + delimiter);
      host.endSession(sid);
    }
  });
  it('keeps a domain literal when letters follow a dot', () => {
    const sid = host.newSession();
    word(sid, 'bhvr');
    let doc = key(sid, '.').commit!;
    for (const c of 'com ') {
      const v = key(sid, c, doc);
      if (v.deleteBack) doc = doc.slice(0, -v.deleteBack);
      if (v.commit) doc += v.commit;
    }
    expect(doc).toBe('bhvr.com ');
  });
  it('normalizes Chinese punctuation through the same boundary handling without adding spaces', () => {
    for (const [typed, suffix] of [['。', '.'], ['，', ','], ['！', '!'], ['？', '?']]) {
      const sid = host.newSession();
      word(sid, 'bhvr');
      expect(key(sid, typed).commit).toBe('behavior' + suffix);
    }
  });
  it('leaves Backspace and selected-text deletion to the application after a correction', () => {
    for (const hasSelection of [false, true]) {
      const sid = host.newSession();
      word(sid, 'bhvr');
      const doc = key(sid, ' ').commit!;
      const v = key(sid, 'Backspace', doc, false, { hasSelection });
      expect(v.handled).toBe(false);
      expect(v.deleteBack).toBe(0);
      expect(v.correction).toBe(null);
    }
  });
  it('restores a correction explicitly, preserving its delimiter, exactly once', () => {
    const sid = host.newSession();
    word(sid, 'bhvr');
    const v = key(sid, '.');
    expect(v.correction).toEqual({ original: 'bhvr.', replacement: 'behavior.' });
    const restore = JSON.parse(host.restore(sid, 'behavior.')) as HostView;
    expect(restore.commit).toBe('bhvr.');
    expect(restore.deleteBack).toBe(9);
    expect(JSON.parse(host.restore(sid, 'bhvr.')).handled).toBe(false);
  });
  it('rejects restoration when the document suffix no longer matches', () => {
    const sid = host.newSession();
    word(sid, 'bhvr');
    key(sid, ' ');
    expect(JSON.parse(host.restore(sid, 'other text')).handled).toBe(false);
  });
  it('passes Shift+Tab and text-navigation keys through after preserving the preedit', () => {
    for (const [name, shift] of [['Tab', true], ['ArrowLeft', true], ['ArrowRight', true],
      ['ArrowUp', true], ['ArrowDown', true]] as const) {
      const sid = host.newSession();
      word(sid, 'manag');
      const v = key(sid, name, '', shift);
      expect(v.commit).toBe('manag');
      expect(v.passThrough).toBe(true);
    }
  });
  it('moves the highlight with Left / Right, as with Up / Down', () => {
    const sid = host.newSession();
    word(sid, 'manag');
    let v = key(sid, 'ArrowRight');
    expect(v.commit).toBeNull();
    expect(v.preedit).toBe('manag');
    expect(v.selected).toBe(1);
    expect(v.explicitSelection).toBe(true);
    v = key(sid, 'ArrowRight');
    expect(v.selected).toBe(2);
    v = key(sid, 'ArrowLeft');
    expect(v.selected).toBe(1);
    expect(key(sid, ' ').commit).toBe(`${v.candidates[1].word} `);
  });
  it('resets a browsed candidate after more typing, and reports the actual Tab target', () => {
    const sid = host.newSession();
    word(sid, 'manag');
    key(sid, 'ArrowDown');
    let v = key(sid, 'ArrowDown');
    expect(v.candidates[v.selected].word).toBe('manager');
    expect(v.tabIndex).toBe(v.selected);
    v = key(sid, 'e');
    expect(v.selected).toBe(0);
    expect(key(sid, ' ').commit).toBe('manage ');
  });
  it('Enter while composing confirms the typed letters and is consumed; the next Enter belongs to the application', () => {
    const normal = host.newSession();
    word(normal, 'hello');
    const enter = key(normal, 'Enter');
    expect(enter.commit).toBe('hello');
    expect(enter.handled).toBe(true);
    expect(enter.passThrough).toBe(false);
    expect(enter.preedit).toBe('');
    // nothing is being composed any more: this Enter is the application's (send / new line)
    expect(key(normal, 'Enter', 'hello').handled).toBe(false);
    // shorthand is expanded on Space but Enter keeps it exactly as typed
    const shorthand = host.newSession();
    word(shorthand, 'thx');
    expect(key(shorthand, 'Enter').commit).toBe('thx');
    const expanded = host.newSession();
    word(expanded, 'thx');
    expect(key(expanded, ' ').commit).toBe('thanks ');
    const selected = host.newSession();
    word(selected, 'manag');
    key(selected, 'ArrowDown');
    const confirm = key(selected, 'Enter');
    expect(confirm.commit).toBe('manage');
    expect(confirm.passThrough).toBe(false);
  });
  it('confirms an explicit choice of the original first candidate instead of completing a different word', () => {
    const sid = host.newSession();
    word(sid, 'manag');
    key(sid, 'ArrowUp');
    const v = key(sid, 'ArrowDown');
    expect(v.selected).toBe(0);
    expect(v.explicitSelection).toBe(true);
    expect(v.tabIndex).toBe(0);
    expect(key(sid, 'Enter').passThrough).toBe(false);
  });
  it('keeps the window open on a complete word to show its meaning, and hides it when there is nothing to tell', () => {
    const sid = host.newSession();
    const whole = word(sid, 'fairly');
    expect(whole.show).toBe(true);
    expect(whole.candidates.map((c) => c.word)).toEqual(['fairly']);
    expect(whole.candidates[0].gloss).not.toBe('');
    expect(whole.tabIndex).toBe(-1);
    expect(key(sid, ' ').commit).toBe('fairly ');
    expect(word(host.newSession(), 'gpt4').show).toBe(false);
    expect(word(host.newSession(), 'xqzvk').show).toBe(false);
  });
  it('lets language-model scores decide what Space commits for an unknown token, and only then', () => {
    const before = 'Because of the bad ';
    const typeWord = (text: string) => {
      const sid = host.newSession();
      let v!: HostView;
      for (const c of text) v = key(sid, c, before);
      return { sid, v };
    };
    const plain = typeWord('wether');
    expect(plain.v.lm).toContain('weather');
    expect(key(plain.sid, ' ', before).commit).toBe('wether ');

    const scored = typeWord('wether');
    const scores = Object.fromEntries(scored.v.lm!.map((w) => [w, w === 'weather' ? -2 : w === 'wether' ? -22 : -12]));
    const view: HostView = JSON.parse(host.rescore(scored.sid, JSON.stringify(scores)));
    expect(view.candidates[0].word).toBe('weather');
    expect(key(scored.sid, ' ', before).commit).toBe('weather ');

    // Weak evidence changes nothing.
    const weak = typeWord('wether');
    host.rescore(weak.sid, JSON.stringify(Object.fromEntries(weak.v.lm!.map((w) => [w, -10]))));
    expect(key(weak.sid, ' ', before).commit).toBe('wether ');
    // A known word is never offered to the model.
    expect(typeWord('weather').v.lm).toBeNull();
  });
  it('picks a candidate with its number, unless the digit is part of the token or the option is off', () => {
    const typeAll = (text: string) => {
      const sid = host.newSession();
      let out = '';
      for (const c of text) {
        const v = key(sid, c);
        if (v.handled && v.commit) out += v.commit;
        if (!v.handled || v.passThrough) out += c;
      }
      return out + ((JSON.parse(host.flush(sid)) as HostView).commit ?? '');
    };
    const second = word(host.newSession(), 'manag').candidates[1].word;
    expect(typeAll('manag2')).toContain(`${second} `);
    expect(typeAll('gpt4 ')).toBe('gpt4 ');
    expect(typeAll('user1 ')).toBe('user1 ');
    host.setOptions(JSON.stringify({ numberKeysPick: false }));
    expect(typeAll('manag2 ')).toBe('manag2 ');
    host.setOptions(JSON.stringify({ numberKeysPick: true }));
  });
  it('preserves Shift+Enter even while browsing candidates', () => {
    const sid = host.newSession();
    word(sid, 'manag');
    key(sid, 'ArrowDown');
    const v = key(sid, 'Enter', '', true);
    expect(v.commit).toBe('manag');
    expect(v.passThrough).toBe(true);
  });
  it('protects replacements of selected text and insertion at the start of an existing word', () => {
    for (const context of [{ hasSelection: true }, { after: 'r' }]) {
      const sid = host.newSession();
      word(sid, 'teh', context);
      expect(key(sid, ' ', '', false, context).commit).toBe('teh ');
    }
  });
  it('does not use unavailable context for grammar or backward replacement', () => {
    const sid = host.newSession();
    for (const c of 'apple') key(sid, c, 'a ', false, { canReplaceBefore: false });
    const v = key(sid, ' ', 'a ', false, { canReplaceBefore: false });
    expect(v.deleteBack).toBe(0);
    expect(v.commit).toBe('apple ');
  });
});
