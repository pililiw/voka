# Language model

Voka scores the candidates for an unknown token with a small causal language model,
[`jhu-clsp/ettin-decoder-17m`](https://huggingface.co/jhu-clsp/ettin-decoder-17m) (MIT, 17M parameters).
The app runs it on the CPU through Core ML; nothing leaves the machine.

`convert.py` builds everything the app and the tests need from the published model:

```sh
python3 -m venv .venv && .venv/bin/pip install -r scripts/lm/requirements.txt
.venv/bin/python scripts/lm/convert.py
```

| Output | Contents |
|---|---|
| `data/lm.mlpackage` | The Core ML model. `macos/scripts/build_app.sh` compiles it into the app as `lm.mlmodelc`. |
| `data/lm-tokenizer.json` | The model's `tokenizer.json`, unchanged; read by the Swift tokenizer. |
| `tests/data/lm-fixtures.json` | Token ids and PyTorch scores for about 60 requests; the Swift tests must reproduce them. |

The model revision is pinned in the script. The first run downloads it from Hugging Face; with the model
in the local cache, `HF_HUB_OFFLINE=1` keeps the run offline.

## What the Core ML model computes

A score is log P(word | text before the caret): the sum of the log-probabilities of the word's tokens
after the last 32 tokens of the text. One prediction scores up to six words of up to 16 tokens each
(32 word tokens in all). The context is encoded once and shared by the words, and only the scored
positions go through the vocabulary projection. The script checks this graph against the plain PyTorch
model on every fixture before converting it.

## Weight formats

`convert.py --compare` builds each format and reports the largest difference from the float32 PyTorch
scores over the fixtures, evaluated on the CPU:

| Variant | Size | Max error | Best word differs |
|---|---|---|---|
| `float32` | 67.9 MB | 0.0001 | 0 |
| `float32-w16` (shipped) | 34.1 MB | 0.018 | 0 |
| `float32-w8` | 17.6 MB | 1.41 | 2 |
| `float32-p8` | 17.3 MB | 1.01 | 1 |
| `float16` | 34.1 MB | 0.19 | 0 |
| `float16-w8` | 17.4 MB | 1.41 | 2 |

The shipped variant stores the weights as float16 and computes in float32. Computing in float16 is no
smaller and less accurate on the CPU, and 8-bit weights change which word scores best.

The engine's rule for using the scores (`src/engine/lm-rule.ts`) is fitted to this model. After changing
the model or the way a request is built, regenerate the fixtures and refit the rule.

## The decision rule

`fit_rule.py` fits when a score difference is enough to add a correction. It reads the decisions of the
evaluation data, scores them with the PyTorch model and writes `src/engine/lm-rule.ts`:

```sh
bash eval/run.sh eval/lm-instances.ts > scripts/lm/instances.jsonl
.venv/bin/python scripts/lm/fit_rule.py
```

It prints, by cross-validation, how many misspellings the rule corrects and how many tokens it changes
wrongly at several thresholds. Sentences that must come out right with the model are listed in
`tests/data/lm-cases.json` and typed through the real model by the Swift tests.
