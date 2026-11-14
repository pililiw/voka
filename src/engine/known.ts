/**
 * Known-token tiers: valid tokens that are not in the suggestion lexicon (inflected forms, rare words,
 * surnames). Stored as three Bloom filters built by scripts/build-dictionary.mjs.
 *   tier 3 = certainly a word, tier 2 = probably a word, tier 1 = name-like / doubtful, 0 = unknown.
 * A token with a tier is never "corrected" lightly; see the Space decision in ranker.ts.
 */
export interface RawBloom {
  m: number;
  k: number;
  n: number;
  bits: string; // base64
}

export interface RawKnownPayload {
  tiers: RawBloom[];
  samples?: [string, number][];
  attested?: RawBloom;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let b64Lookup: Int16Array | null = null;

/** Dependency-free base64 decoder (JavaScriptCore has neither atob nor Buffer). */
export function decodeBase64(b64: string): Uint8Array {
  if (!b64Lookup) {
    b64Lookup = new Int16Array(128).fill(-1);
    for (let i = 0; i < B64.length; i++) b64Lookup[B64.charCodeAt(i)] = i;
  }
  let len = b64.length;
  while (len > 0 && b64.charCodeAt(len - 1) === 61 /* = */) len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < len; i++) {
    const v = b64Lookup[b64.charCodeAt(i) & 127];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

/** Must stay identical to bloomHashPair() in scripts/build-dictionary.mjs. */
function bloomHashPair(s: string): [number, number] {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 13;
  }
  h1 ^= h1 >>> 15;
  h1 = Math.imul(h1, 0x2c1b3c6d);
  h1 ^= h1 >>> 12;
  h2 ^= h2 >>> 15;
  h2 = Math.imul(h2, 0x297a2d39);
  h2 ^= h2 >>> 15;
  return [h1 >>> 0, (h2 >>> 0) | 1];
}

class Bloom {
  private readonly bytes: Uint8Array;
  private readonly m: number;
  private readonly k: number;

  constructor(raw: RawBloom) {
    this.bytes = decodeBase64(raw.bits);
    this.m = raw.m;
    this.k = raw.k;
  }

  public has(word: string): boolean {
    const [h1, h2] = bloomHashPair(word);
    for (let i = 0; i < this.k; i++) {
      const idx = ((h1 + Math.imul(i, h2)) >>> 0) % this.m;
      if ((this.bytes[idx >> 3] & (1 << (idx & 7))) === 0) return false;
    }
    return true;
  }
}

export class KnownTokens {
  private readonly tiers: Bloom[] = [];
  private readonly seen: Bloom | null = null;
  /** False when the payload is missing or failed its self-check (then every lookup returns 0). */
  public readonly ok: boolean;

  constructor(raw?: RawKnownPayload | null) {
    let ok = false;
    if (raw && Array.isArray(raw.tiers) && raw.tiers.length === 3) {
      try {
        for (const t of raw.tiers) this.tiers.push(new Bloom(t));
        if (raw.attested) this.seen = new Bloom(raw.attested);
        ok = (raw.samples ?? []).every(([w, t]) => this.tiers[t - 1].has(w));
      } catch {
        ok = false;
      }
    }
    this.ok = ok;
  }

  /** 0 = unknown, 1 = name-like / doubtful, 2 = probably a word, 3 = certainly a word. */
  public tier(word: string): 0 | 1 | 2 | 3 {
    if (!this.ok) return 0;
    if (this.tiers[2].has(word)) return 3;
    if (this.tiers[1].has(word)) return 2;
    if (this.tiers[0].has(word)) return 1;
    return 0;
  }

  /** The token occurs in text, as a word or not: a name, a foreign word, a common misspelling. */
  public attested(word: string): boolean {
    return this.ok && (this.tier(word) >= 1 || Boolean(this.seen?.has(word)));
  }
}
