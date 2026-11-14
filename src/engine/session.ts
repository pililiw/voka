import { applyLm, lmWords } from './rerank';
import { VokaEngine } from './ranker';
import { Candidate, EngineQueryResult, MAX_CANDIDATES } from './types';

/** What the last automatic change replaced, so that it can be taken back. */
export interface UndoRecord {
  rawToken: string;
  rawInput: string;
  committedText: string;
  prevWordReplaced?: {
    originalSuffix: string;
    replacedSuffix: string;
  };
}

export interface KeyActionResult {
  /** False: the key is not for the input method; the application handles it. */
  handled: boolean;
  /** Apply `deleteBackChars` / `commitText`, then let the application handle the key as well. */
  passThrough?: boolean;
  deleteBackChars?: number;
  commitText?: string;
}

const CJK_PUNCT_MAP: Record<string, string> = {
  '，': ',',
  '。': '.',
  '？': '?',
  '！': '!',
  '；': ';',
  '：': ':',
  '、': ',',
  '（': '(',
  '）': ')',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
};

const URL_SCHEMES = new Set([
  'http', 'https', 'ftp', 'sftp', 'ssh', 'git', 'file', 'mailto', 'ws', 'wss', 'tel', 'sms', 'data', 'localhost',
]);

/** Common terms with a digit after letters: while one of them is being typed, digits are text. */
const DIGIT_TERMS = `mp3 mp4 gpt3 gpt4 gpt5 ipv4 ipv6 md5 sha256 base64 utf8 h264 h265 x86 x64 web2 web3 b2b b2c p2p
  covid19 win10 win11 ps4 ps5 f1 f2 f12 a4 b12 g20 g7 v1 v2 v3 q1 q2 q3 q4 h1 h2 top10 top100`.split(/\s+/);

/** One typing session: the word being composed, its candidates, and what each key does to them. */
export class ImeSessionController {
  public readonly engine: VokaEngine;

  public preedit = '';
  /** Whether a digit typed while candidates are shown picks the candidate with that number. */
  public numberKeysPick = true;
  public selectedIndex = 0;
  /** The user moved the highlight (arrows): Tab and Enter then mean "this one". */
  public selectionIsExplicit = false;
  public lastQueryResult: EngineQueryResult | null = null;
  public lastUndo: UndoRecord | null = null;

  /** The last commit ended with a space the user did not type (Tab / pick): closing punctuation eats it. */
  private autoSpace = false;
  /** The preedit continues a token that is already in the document (`3|pm`, `example.|com`): no lookups. */
  private literalMode = false;

  constructor(engine: VokaEngine) {
    this.engine = engine;
  }

  /** The candidate Tab commits, or -1. */
  public get tabTargetIndex(): number {
    if (!this.preedit || !this.lastQueryResult || this.literalMode) return -1;
    return this.selectionIsExplicit ? this.selectedIndex : this.lastQueryResult.bestLongerCompletionIndex;
  }

  public get lastCorrection(): { original: string; replacement: string } | null {
    const u = this.lastUndo;
    if (!u || this.preedit || !u.rawToken) return null;
    return {
      original: (u.prevWordReplaced?.originalSuffix ?? '') + u.rawInput,
      replacement: (u.prevWordReplaced?.replacedSuffix ?? '') + u.committedText,
    };
  }

  /** Put back what was typed before the last automatic change, if the text is still as it was left. */
  public restoreLastCorrection(textBeforeCaret: string): KeyActionResult {
    const correction = this.lastCorrection;
    this.lastUndo = null;
    this.autoSpace = false;
    if (!correction || !textBeforeCaret.endsWith(correction.replacement)) return { handled: false };
    return { handled: true, deleteBackChars: correction.replacement.length, commitText: correction.original };
  }

  public clearPreedit(): void {
    this.preedit = '';
    this.selectedIndex = 0;
    this.selectionIsExplicit = false;
    this.lastQueryResult = null;
    this.literalMode = false;
  }

  /** Result for a token that is committed exactly as typed (no candidate window). */
  private literalResult(raw: string, textBeforeCaret: string): EngineQueryResult {
    const base = this.engine.query('', textBeforeCaret);
    const literal: Candidate = {
      word: raw,
      rawWord: raw.toLowerCase(),
      gloss: '',
      channel: 'literal',
      score: 1000,
      isLiteral: true,
    };
    return { ...base, rawQuery: raw, candidates: [literal], bestLongerCompletionIndex: -1, showWindow: false };
  }

  public refreshCandidates(textBeforeCaret: string): void {
    this.selectedIndex = 0;
    this.selectionIsExplicit = false;
    if (!this.preedit) {
      this.lastQueryResult = null;
      return;
    }
    if (this.literalMode) {
      this.lastQueryResult = this.literalResult(this.preedit, textBeforeCaret);
      return;
    }
    const result = this.engine.query(this.preedit, textBeforeCaret);
    this.lastQueryResult = { ...result, candidates: result.candidates.slice(0, MAX_CANDIDATES) };
  }

  /** Words the shell may score with a language model for the word being typed, or null. */
  public lmWords(): string[] | null {
    if (!this.preedit || this.literalMode || this.selectionIsExplicit) return null;
    return lmWords(this.engine, this.lastQueryResult, this.preedit);
  }

  /** Take the model's scores for the current candidates into account. */
  public applyLmScores(scores: Record<string, number>): void {
    if (!this.lastQueryResult || !this.lmWords()) return;
    this.lastQueryResult = applyLm(this.engine, this.lastQueryResult, this.preedit, scores);
  }

  /** False when the digit belongs to the token (`gpt4`, `ipv6`) or would pick what Space commits anyway. */
  private digitPicks(index: number, digit: string): boolean {
    const candidates = this.lastQueryResult?.candidates ?? [];
    const typed = this.preedit.toLowerCase();
    if (index === this.selectedIndex && candidates[index]?.word.toLowerCase() === typed) return false;
    const token = typed + digit;
    return !DIGIT_TERMS.some((term) => term.startsWith(token));
  }

  public commitCandidateAt(
    index: number,
    suffix: string,
    textBeforeCaret: string,
    explicitUserPick = false
  ): KeyActionResult {
    if (!this.preedit || !this.lastQueryResult) return { handled: false };

    const cand: Candidate | undefined =
      this.lastQueryResult.candidates[index] ?? this.lastQueryResult.candidates[0];
    if (!cand) {
      const raw = this.preedit;
      this.clearPreedit();
      return { handled: true, commitText: raw + suffix };
    }

    const rawInput = this.preedit;
    let deleteBackChars = 0;
    let commitPrefix = '';
    let prevWordReplaced: UndoRecord['prevWordReplaced'];

    // `a apple` -> `an apple`: the article right before the word follows the word.
    if (cand.prevWordFix) {
      const m = textBeforeCaret.match(new RegExp(`(\\b)(${cand.prevWordFix.from})(\\s+)$`, 'i'));
      if (m) {
        const originalSuffix = m[2] + m[3];
        const wasCapitalised = m[2][0] === m[2][0].toUpperCase();
        const fixed = wasCapitalised
          ? cand.prevWordFix.to[0].toUpperCase() + cand.prevWordFix.to.slice(1)
          : cand.prevWordFix.to;
        const replacedSuffix = fixed + m[3];
        deleteBackChars = originalSuffix.length;
        commitPrefix = replacedSuffix;
        prevWordReplaced = { originalSuffix, replacedSuffix };
      }
    }

    const commitText = commitPrefix + cand.word + suffix;
    const isChanged = cand.word !== rawInput || Boolean(prevWordReplaced);

    this.autoSpace = explicitUserPick && suffix === ' ';
    this.lastUndo =
      isChanged && !explicitUserPick
        ? { rawToken: rawInput, rawInput: rawInput + suffix, committedText: cand.word + suffix, prevWordReplaced }
        : null;

    this.clearPreedit();
    return { handled: true, deleteBackChars, commitText };
  }

  /** Commit the preedit exactly as typed (optionally followed by `suffix`). */
  private commitRaw(suffix = '', passThrough = false): KeyActionResult {
    const raw = this.preedit;
    this.lastUndo = null;
    this.autoSpace = false;
    this.clearPreedit();
    return { handled: true, passThrough, commitText: raw + suffix };
  }

  /** Commit what Space would commit (the highlighted candidate), followed by `suffix`. */
  private commitChosen(suffix: string, textBeforeCaret: string): KeyActionResult {
    if (this.literalMode || !this.lastQueryResult) return this.commitRaw(suffix);
    return this.commitCandidateAt(this.selectedIndex, suffix, textBeforeCaret, this.selectionIsExplicit);
  }

  /** Is a word started right after `textBeforeCaret` the continuation of a token that is already there? */
  private static continuesToken(textBeforeCaret: string): boolean {
    if (!textBeforeCaret) return false;
    const prev = textBeforeCaret[textBeforeCaret.length - 1];
    if (/\s/.test(prev)) return false;
    if (/[(\[{"'“‘*—–…¿¡>]/.test(prev)) return false;
    if (prev.charCodeAt(0) > 0x2e7f) return false; // CJK text directly followed by an English word
    return true;
  }

  public handleKeyDown(
    e: {
      key: string;
      shiftKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
      altKey?: boolean;
    },
    textBeforeCaret: string,
    hasSelection = false,
    textAfterCaret = ''
  ): KeyActionResult {
    const { key } = e;

    // Shortcuts never belong to the input method: keep what was typed and get out of the way.
    if (e.metaKey || e.ctrlKey) {
      this.autoSpace = false;
      if (this.preedit) return this.commitRaw('', true);
      this.lastUndo = null;
      return { handled: false };
    }

    if (e.altKey) {
      // Option+digit picks a candidate.
      if (this.preedit && /^[1-9]$/.test(key) && this.lastQueryResult) {
        const idx = Number(key) - 1;
        if (idx < this.lastQueryResult.candidates.length) {
          return this.commitCandidateAt(idx, ' ', textBeforeCaret, true);
        }
      }
      // Option+Delete discards the word being typed.
      if (this.preedit && key === 'Backspace') {
        this.clearPreedit();
        this.lastUndo = null;
        return { handled: true };
      }
      if (this.preedit) return this.commitRaw('', true);
      return { handled: false };
    }

    // A digit picks the candidate with that number, unless it is part of what is being typed.
    if (this.numberKeysPick && this.preedit && /^[1-9]$/.test(key) && !e.shiftKey) {
      const index = Number(key) - 1;
      const res = this.lastQueryResult;
      if (res && res.showWindow !== false && index < res.candidates.length && this.digitPicks(index, key)) {
        return this.commitCandidateAt(index, ' ', textBeforeCaret, true);
      }
    }

    // Chinese punctuation typed by habit behaves like its ASCII counterpart.
    if (Object.prototype.hasOwnProperty.call(CJK_PUNCT_MAP, key)) {
      const ascii = CJK_PUNCT_MAP[key];
      const result = this.handleKeyDown({ ...e, key: ascii }, textBeforeCaret, hasSelection, textAfterCaret);
      return result.handled ? result : { handled: true, commitText: ascii };
    }

    // Escape keeps what was typed and closes the candidates.
    if (key === 'Escape') {
      return this.preedit ? this.commitRaw() : { handled: false };
    }

    // Backspace edits the word being composed; committed text belongs to the application.
    if (key === 'Backspace') {
      this.autoSpace = false;
      if (this.preedit) {
        this.preedit = this.preedit.slice(0, -1);
        if (!this.preedit) this.clearPreedit();
        else this.refreshCandidates(textBeforeCaret);
        return { handled: true };
      }
      this.lastUndo = null;
      return { handled: false };
    }

    // Arrows move the highlight along the candidate row.
    const forward = key === 'ArrowDown' || key === 'ArrowRight';
    const backward = key === 'ArrowUp' || key === 'ArrowLeft';
    if (!e.shiftKey && this.preedit && (forward || backward)) {
      const count = this.lastQueryResult?.candidates.length ?? 0;
      if (count > 1 && this.lastQueryResult?.showWindow !== false) {
        this.selectedIndex = (this.selectedIndex + (forward ? 1 : count - 1)) % count;
        this.selectionIsExplicit = true;
        return { handled: true };
      }
    }
    // Any other navigation / editing key (Home, End, Delete, arrows without candidates, Shift+arrows).
    if (key.length > 1 && key !== 'Tab' && key !== 'Enter') {
      this.autoSpace = false;
      if (this.preedit) return this.commitRaw('', true);
      this.lastUndo = null;
      return { handled: false };
    }

    // Tab takes the suggestion: the highlighted candidate after browsing, otherwise the first candidate
    // that differs from what was typed. With nothing to take, Tab keeps its meaning in the application.
    if (key === 'Tab') {
      if (this.preedit) {
        const res = this.lastQueryResult;
        const target = this.tabTargetIndex;
        if (!e.shiftKey && res && target >= 0 && target < res.candidates.length) {
          return this.commitCandidateAt(target, ' ', textBeforeCaret, true);
        }
        return this.commitRaw('', true);
      }
      this.autoSpace = false;
      this.lastUndo = null;
      return { handled: false };
    }

    // Space commits the highlighted candidate.
    if (key === ' ') {
      if (!this.preedit) {
        this.lastUndo = null;
        this.autoSpace = false;
        return { handled: false };
      }
      return this.commitChosen(' ', textBeforeCaret);
    }

    // Enter confirms the letters exactly as typed and is consumed; after
    // browsing it confirms the highlighted candidate. Shift+Enter confirms and reaches the application.
    if (key === 'Enter') {
      this.autoSpace = false;
      if (!this.preedit) {
        this.lastUndo = null;
        return { handled: false };
      }
      if (!e.shiftKey && this.selectionIsExplicit) {
        return this.commitCandidateAt(this.selectedIndex, '', textBeforeCaret, true);
      }
      return this.commitRaw('', Boolean(e.shiftKey));
    }

    // From here on `key` is a single printable character.

    // Closing punctuation right after an automatically added space: `word |` + `.` -> `word.`
    if (!this.preedit && this.autoSpace && /^[.,!?;:)\]}]$/.test(key) && textBeforeCaret.endsWith(' ')) {
      this.autoSpace = false;
      this.lastUndo = null;
      return { handled: true, deleteBackChars: 1, commitText: key };
    }

    // Digits are text (`gpt4`, `mp3`).
    if (/^[0-9]$/.test(key) && this.preedit) {
      this.preedit += key;
      this.refreshCandidates(textBeforeCaret);
      return { handled: true };
    }

    const isLetter = /^[a-zA-Z]$/.test(key);

    // `Google.` + `c`: a domain or file name is being typed - take the correction back and continue raw.
    if (
      !this.preedit &&
      isLetter &&
      this.lastUndo &&
      this.lastUndo.rawInput.endsWith('.') &&
      textBeforeCaret.endsWith(this.lastUndo.committedText)
    ) {
      const undo = this.lastUndo;
      this.lastUndo = null;
      this.autoSpace = false;
      this.preedit = undo.rawInput + key;
      this.refreshCandidates(textBeforeCaret.slice(0, textBeforeCaret.length - undo.committedText.length));
      return { handled: true, deleteBackChars: undo.committedText.length, commitText: '' };
    }

    // Letters, and characters that belong inside a token.
    const isLeadingSpecial = !this.preedit && (key === '-' || key === '/' || key === '@' || key === '#' || key === '~');
    const isInnerSymbol =
      this.preedit.length > 0 && (key === "'" || key === '’' || key === '_' || key === '/' || key === '@');
    if (isLetter || isLeadingSpecial || isInnerSymbol) {
      if (!this.preedit) {
        this.literalMode =
          hasSelection || ImeSessionController.continuesToken(textBeforeCaret) || /^[a-zA-Z0-9_]/.test(textAfterCaret);
      }
      this.lastUndo = null;
      this.autoSpace = false;
      this.preedit += key;
      this.refreshCandidates(textBeforeCaret);
      return { handled: true };
    }

    if (!this.preedit) {
      // A character typed outside a word (digit, punctuation, symbol): the application inserts it.
      this.lastUndo = null;
      this.autoSpace = false;
      return { handled: false };
    }

    const codeLike = this.literalMode || Boolean(this.lastQueryResult?.isCodeLiteral);

    // A hyphenated compound (`well-known`, `redis-cli`) is kept exactly as typed: the part before the
    // hyphen is committed raw and the parts after it continue the token.
    if (key === '-') {
      if (codeLike) {
        this.preedit += key;
        this.refreshCandidates(textBeforeCaret);
        return { handled: true };
      }
      return this.commitRaw('-');
    }

    // A dot stays inside numbers and code-like tokens; otherwise it ends the word.
    if (key === '.') {
      if (/[0-9]/.test(this.preedit) || Boolean(this.lastQueryResult?.isCodeLiteral)) {
        this.preedit += key;
        this.refreshCandidates(textBeforeCaret);
        return { handled: true };
      }
      return this.commitChosen('.', textBeforeCaret);
    }

    // `https:` and friends: a URL follows, keep the scheme exactly as typed.
    if (key === ':' && URL_SCHEMES.has(this.preedit.toLowerCase())) {
      return this.commitRaw(key);
    }

    // Closing punctuation ends the word like Space does; anything else (brackets, operators) keeps it raw.
    if (/^[,!?;:)\]}"”]$/.test(key)) {
      return this.commitChosen(key, textBeforeCaret);
    }
    return this.commitRaw(key);
  }
}
