"""Fit the rule that decides when the language model may add a correction (src/engine/lm-rule.ts).

    bash eval/run.sh eval/lm-instances.ts > scripts/lm/instances.jsonl
    python scripts/lm/fit_rule.py

The rule only applies to tokens that are not known words and that the engine itself leaves as typed
(see src/engine/rerank.ts). It is a logistic model over the language model's log-probability gap and the
engine's own evidence; a correction is added when its score reaches THRESHOLD.
"""
import json, os, sys, zlib
import numpy as np
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = 'jhu-clsp/ettin-decoder-17m'
REVISION = '728fb5b6b3dc5916aa20829c027143ae8eca4eeb'  # the revision scripts/lm/convert.py converts
# The evaluation data in this repository is cleaner than what people really type: in cross-validation
# a threshold of 0 still looks precise. On real misspelling corpora (not redistributable, so not part
# of this repository) wrong corrections become frequent below 0.75; the threshold stays above that.
THRESHOLD = 1.0
LM_WEIGHT, SCORE_SCALE, MISSING = 1.0, 60.0, -60.0
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

rows = [json.loads(line) for line in open(os.path.join(HERE, 'instances.jsonl'))]
in_scope = lambda r: (not r['inLex'] and r['tier'] < 3 and r['typed'].isalpha()
                      and r['space'].lower() == r['typed'].lower() and len(r['cands']) > 1)
rows = [r for r in rows if in_scope(r)]

tok = AutoTokenizer.from_pretrained(MODEL, revision=REVISION)
model = AutoModelForCausalLM.from_pretrained(MODEL, revision=REVISION).eval()
bos = tok.bos_token_id if tok.bos_token_id is not None else tok.eos_token_id

@torch.no_grad()
def log_probs(before, words):
    ctx = [bos] + tok.encode(before.rstrip()[-240:], add_special_tokens=False)[-32:]
    pieces = [tok.encode((' ' if before.strip() else '') + w, add_special_tokens=False) for w in words]
    n = len(ctx) + max(len(p) for p in pieces)
    ids = torch.zeros((len(pieces), n), dtype=torch.long)
    mask = torch.zeros_like(ids)
    for i, p in enumerate(pieces):
        ids[i, :len(ctx) + len(p)] = torch.tensor(ctx + p)
        mask[i, :len(ctx) + len(p)] = 1
    lp = torch.log_softmax(model(input_ids=ids, attention_mask=mask).logits.float(), -1)
    return {w: float(sum(lp[i, len(ctx) + k - 1, p[k]] for k in range(len(p)))) for i, (w, p) in enumerate(zip(words, pieces))}

def features(r):
    words = [c['w'] for c in r['cands']]
    lp = log_probs(r['before'], words + ([] if r['typed'] in words else [r['typed']]))
    typed = lambda c: c['w'].lower() == r['typed'].lower()
    alts = [c for c in r['cands'] if not typed(c) and not c['comp'] and c['ch'] != 'literal']
    if not alts:
        return None
    combined = lambda c: c['s'] / SCORE_SCALE + LM_WEIGHT * lp.get(c['w'], MISSING)
    best = max(alts, key=combined)
    others = [combined(c) for c in alts if c is not best]
    typed_score = next((c['s'] for c in r['cands'] if typed(c)), 400)
    x = [1.0,
         lp[best['w']] - lp.get(r['typed'], MISSING),
         (best['cost'] if best['cost'] is not None else 150) / 100.0,
         (best['s'] - typed_score) / 100.0,
         float(r['tier']),
         min(len(r['typed']), 12) / 10.0,
         min(6.0, combined(best) - max(others)) if others else 6.0,
         float(best['ch'] == 'phonetic'),
         float(best['ch'] == 'typo')]
    return x, float(r['typo'] and best['w'].lower() == r['want'].lower())

data = [(r, f) for r in rows for f in [features(r)] if f]
X = np.array([f[0] for _, f in data]); y = np.array([f[1] for _, f in data])
fold = np.array([zlib.crc32((r['before'] + r['typed']).encode()) % 5 for r, _ in data])

def fit(X, y):
    mean, scale = X.mean(0), X.std(0) + 1e-9
    mean[0], scale[0] = 0.0, 1.0
    Z = (X - mean) / scale
    w = np.where(y == 1, 1.0, 5.0)          # a wrong correction costs more than a missed one
    b = np.zeros(X.shape[1])
    for _ in range(5000):
        p = 1 / (1 + np.exp(-Z @ b))
        b -= 0.3 * ((Z.T @ ((p - y) * w)) / w.sum() + 1e-3 * b)
    return mean, scale, b

cv = np.zeros(len(y))
for k in range(5):
    mean, scale, b = fit(X[fold != k], y[fold != k])
    cv[fold == k] = ((X[fold == k] - mean) / scale) @ b
typos = np.array([r['typo'] for r, _ in data])
threshold = THRESHOLD
chosen = cv >= threshold
print(f'best alternative is the intended word for {int(y.sum())} of {int(typos.sum())} misspellings')
print(f'{len(y)} tokens the engine leaves as typed ({int(typos.sum())} misspelled, {int((~typos).sum())} correct)')
for t in [3, 2, 1.5, 1, 0.5, 0]:
    c = cv >= t
    print(f'  threshold {t:4}: {int((c & (y == 1)).sum()):3} corrected to the intended word, {int((c & typos & (y == 0)).sum())} to another word, {int((c & ~typos).sum())} correct tokens changed')
print(f'cross-validated at threshold {threshold:.2f}: {int((chosen & (y == 1)).sum())} corrected to the intended word, '
      f'{int((chosen & typos & (y == 0)).sum())} to another word, {int((chosen & ~typos).sum())} correct tokens changed')

mean, scale, b = fit(X, y)
fmt = lambda v: '[' + ', '.join(f'{x:.4f}' for x in v) + ']'
open(os.path.join(ROOT, 'src/engine/lm-rule.ts'), 'w').write(f"""// Generated by scripts/lm/fit_rule.py. Do not edit.
export const LM_RULE = {{
  model: '{MODEL}',
  lmWeight: {LM_WEIGHT},
  scoreScale: {SCORE_SCALE},
  threshold: {threshold:.2f},
  mean: {fmt(mean)},
  scale: {fmt(scale)},
  weights: {fmt(b)},
}};
""")
print('wrote src/engine/lm-rule.ts')
