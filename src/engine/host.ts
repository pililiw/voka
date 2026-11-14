/**
 * Host bridge: the API a native shell (macOS InputMethodKit through JavaScriptCore) uses. Everything
 * crosses the boundary as plain values or JSON strings, so the native side only forwards keys and
 * applies the view that comes back.
 *
 *   Voka.init(dictJson)                                              -> '{"ok":true,"words":35200,...}'
 *   const sid = Voka.newSession()
 *   Voka.key(sid, 'a', shift, alt, ctrl, meta, textBeforeCaret, ctx) -> HostView JSON
 *   Voka.pick(sid, index, textBeforeCaret)                           -> HostView JSON (candidate clicked)
 *   Voka.flush(sid)                                                  -> HostView JSON (commit preedit as typed)
 *   Voka.rescore(sid, '{"word": logProb, ...}')                      -> HostView JSON (after scoring `view.lm`)
 *   Voka.setOptions('{"numberKeysPick": true}')                       (digits pick candidates; default true)
 *   Voka.restore(sid, textBeforeCaret)                               -> HostView JSON (undo the last correction)
 *   Voka.endSession(sid)
 *
 * Key names follow KeyboardEvent.key: one character, or Backspace / Enter / Tab / Escape / ArrowUp /
 * ArrowDown / ArrowLeft / ArrowRight / Delete / Home / End / PageUp / PageDown (anything else longer
 * than one character is treated as a navigation key).
 */
import { LexiconIndex, RawDictPayload } from './lexicon';
import { VokaEngine } from './ranker';
import { ImeSessionController, KeyActionResult } from './session';

export interface HostCandidate {
  word: string;
  gloss: string;
  /** Short badge, e.g. `a→an` when picking the candidate also changes the article before it. */
  hint: string;
}

export interface HostView {
  /** False: the input method did nothing, the application handles the key. */
  handled: boolean;
  /** True: apply deleteBack / commit, then also let the application handle the key. */
  passThrough: boolean;
  /** Characters of committed text to delete before the caret, applied before `commit`. */
  deleteBack: number;
  /** Text to insert (replaces the marked text); null = nothing to insert. */
  commit: string | null;
  /** Marked (underlined) text after this key; empty = none. */
  preedit: string;
  candidates: HostCandidate[];
  /** Highlighted candidate = what Space commits. */
  selected: number;
  /** The highlight was moved by the user: Enter and Tab confirm it. */
  explicitSelection: boolean;
  /** Candidate Tab commits, or -1. */
  tabIndex: number;
  /** Whether the candidate window should be visible. */
  show: boolean;
  /** The automatic change that was just made, if it can still be taken back. */
  correction: { original: string; replacement: string } | null;
  /** Words the shell may score with a language model and pass to `rescore`; null = nothing to score. */
  lm: string[] | null;
}

/** What the shell knows about the text around the caret. */
interface HostContext {
  hasSelection?: boolean;
  after?: string;
  /** False when the text before the caret could not be read reliably: nothing behind the caret is touched. */
  canReplaceBefore?: boolean;
}

export interface HostApi {
  version: string;
  init(dictJson: string): string;
  newSession(): number;
  endSession(sid: number): void;
  key(sid: number, key: string, shift: boolean, alt: boolean, ctrl: boolean, meta: boolean, before: string, contextJson?: string): string;
  pick(sid: number, index: number, before: string): string;
  flush(sid: number): string;
  reset(sid: number): void;
  restore(sid: number, before: string): string;
  rescore(sid: number, scoresJson: string): string;
  setOptions(optionsJson: string): void;
  lastError(): string;
}

export const HOST_VERSION = '1.0.0';

export function createHost(): HostApi {
  let engine: VokaEngine | null = null;
  const sessions = new Map<number, ImeSessionController>();
  let nextId = 1;
  let lastError = '';
  let numberKeysPick = true;

  const idle = (handled: boolean, commit: string | null = null, passThrough = false): HostView => ({
    handled,
    passThrough,
    deleteBack: 0,
    commit,
    preedit: '',
    candidates: [],
    selected: 0,
    explicitSelection: false,
    tabIndex: -1,
    show: false,
    correction: null,
    lm: null,
  });

  const viewOf = (s: ImeSessionController, r: KeyActionResult): HostView => {
    const res = s.lastQueryResult;
    const show = Boolean(s.preedit && res && res.showWindow !== false && res.candidates.length > 0);
    return {
      handled: r.handled,
      passThrough: Boolean(r.passThrough),
      deleteBack: r.deleteBackChars ?? 0,
      commit: r.commitText ?? null,
      preedit: s.preedit,
      candidates:
        show && res
          ? res.candidates.map((c) => ({
              word: c.word,
              gloss: c.gloss,
              hint: c.prevWordFix ? `${c.prevWordFix.from}→${c.prevWordFix.to}` : '',
            }))
          : [],
      selected: show ? s.selectedIndex : 0,
      explicitSelection: show && s.selectionIsExplicit,
      tabIndex: show ? s.tabTargetIndex : -1,
      show,
      correction: s.lastCorrection,
      lm: show ? s.lmWords() : null,
    };
  };

  /** An engine error must never swallow what was typed: commit it as typed and step aside. */
  const safely = (sid: number, run: (s: ImeSessionController) => HostView): string => {
    const s = sessions.get(sid);
    if (!s || !engine) return JSON.stringify(idle(false));
    const typed = s.preedit;
    try {
      return JSON.stringify(run(s));
    } catch (err) {
      lastError = String((err as Error)?.stack ?? err);
      try {
        s.clearPreedit();
      } catch {
        // nothing more to do
      }
      return JSON.stringify(typed ? idle(true, typed, true) : idle(false));
    }
  };

  return {
    version: HOST_VERSION,

    init(dictJson: string): string {
      const t0 = Date.now();
      try {
        const payload = JSON.parse(dictJson) as RawDictPayload;
        const lexicon = new LexiconIndex(payload);
        engine = new VokaEngine(lexicon);
        sessions.clear();
        return JSON.stringify({
          ok: true,
          version: HOST_VERSION,
          words: lexicon.entries.length,
          knownTokens: lexicon.known.ok,
          ms: Date.now() - t0,
        });
      } catch (err) {
        engine = null;
        lastError = String((err as Error)?.stack ?? err);
        return JSON.stringify({ ok: false, version: HOST_VERSION, error: lastError });
      }
    },

    newSession(): number {
      if (!engine) return 0;
      const id = nextId++;
      const session = new ImeSessionController(engine);
      session.numberKeysPick = numberKeysPick;
      sessions.set(id, session);
      return id;
    },

    endSession(sid: number): void {
      sessions.delete(sid);
    },

    key(sid, key, shift, alt, ctrl, meta, before, contextJson): string {
      return safely(sid, (s) => {
        const context: HostContext = contextJson ? JSON.parse(contextJson) : {};
        return viewOf(
          s,
          s.handleKeyDown(
            { key, shiftKey: shift, altKey: alt, ctrlKey: ctrl, metaKey: meta },
            context.canReplaceBefore === false ? '' : before ?? '',
            Boolean(context.hasSelection),
            context.after ?? ''
          )
        );
      });
    },

    pick(sid, index, before): string {
      return safely(sid, (s) => viewOf(s, s.commitCandidateAt(index, ' ', before ?? '', true)));
    },

    flush(sid): string {
      return safely(sid, (s) => {
        const typed = s.preedit;
        s.clearPreedit();
        s.lastUndo = null;
        return idle(true, typed || null);
      });
    },

    reset(sid): void {
      const s = sessions.get(sid);
      if (!s) return;
      s.clearPreedit();
      s.lastUndo = null;
    },

    restore(sid, before): string {
      return safely(sid, (s) => viewOf(s, s.restoreLastCorrection(before ?? '')));
    },

    rescore(sid, scoresJson): string {
      return safely(sid, (s) => {
        s.applyLmScores(JSON.parse(scoresJson));
        const view = viewOf(s, { handled: true });
        return { ...view, lm: null };
      });
    },

    setOptions(optionsJson): void {
      try {
        const options = JSON.parse(optionsJson) as { numberKeysPick?: boolean };
        if (typeof options.numberKeysPick === 'boolean') numberKeysPick = options.numberKeysPick;
        for (const session of sessions.values()) session.numberKeysPick = numberKeysPick;
      } catch (err) {
        lastError = String((err as Error)?.stack ?? err);
      }
    },

    lastError(): string {
      return lastError;
    },
  };
}
