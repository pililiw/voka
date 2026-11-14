"""Convert the language model that scores candidate words to Core ML.

    python scripts/lm/convert.py              # write the model, the tokenizer and the test fixtures
    python scripts/lm/convert.py --compare    # also build every weight format and print size and error

Writes
    data/lm.mlpackage            Core ML model: token ids in, log-probabilities of the word tokens out
    data/lm-tokenizer.json       the model's tokenizer definition, unchanged
    tests/data/lm-fixtures.json  token ids and reference scores that the Swift tests must reproduce

The score of a word is log P(word | text before the caret) under a causal language model; `Reference`
below is the definition. The Core ML model evaluates one request in a single prediction of fixed shape:

    context_ids     int32 [1, CONTEXT]           BOS and the context tokens, right-aligned, padding before
    context_length  int32 [1]                    number of tokens in context_ids that are not padding
    word_ids        int32 [ROWS, WORD_TOKENS]    one word per row, padding after
    positions       int32 [TARGETS]              word tokens to score, as row * WORD_TOKENS + index
    log_probs       float [TARGETS]              log P(that token | context, earlier tokens of its word)

The context is encoded once and shared by all rows, and only TARGETS positions go through the vocabulary
projection, which is most of the cost. Attention is causal, so padding after a word cannot change the
positions before it; padding before the context is masked. `check_graph` asserts that this graph agrees
with the reference, which scores each word as one unpadded sequence.
"""
import argparse
import json
import random
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch
from torch import nn

MODEL_ID = "jhu-clsp/ettin-decoder-17m"
REVISION = "728fb5b6b3dc5916aa20829c027143ae8eca4eeb"

# The scoring contract, shared with macos/Sources/VokaCore/LanguageModel.swift.
CONTEXT_CHARS = 240   # code points of text before the caret that are read
CONTEXT_TOKENS = 32   # tokens of that text that are kept, not counting BOS

# Shape of one prediction. Typed words are one to five tokens long; twenty random letters are at most 15.
CONTEXT = 1 + CONTEXT_TOKENS
ROWS = 6              # words per request: up to five candidates and the typed token
WORD_TOKENS = 16      # longest word that can be scored
TARGETS = 32          # word tokens scored per request, over all rows

# Accepted difference from the float32 PyTorch scores when choosing a weight format.
TOLERANCE = 0.1
VARIANTS = ("float32", "float32-w16", "float32-w8", "float32-p8", "float16", "float16-w8")
DEFAULT_VARIANT = "float32-w16"

ROOT = Path(__file__).resolve().parents[2]


class Reference:
    """log P(word | before) with the PyTorch model, one unpadded sequence per word."""

    def __init__(self, model_id, revision):
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.tokenizer = AutoTokenizer.from_pretrained(model_id, revision=revision)
        self.model = AutoModelForCausalLM.from_pretrained(model_id, revision=revision).eval()
        self.bos = self.tokenizer.bos_token_id
        self.pad = self.tokenizer.pad_token_id
        if self.bos is None or self.pad is None:
            sys.exit(f"{model_id} has no BOS or padding token")

    def encode(self, text):
        return self.tokenizer.encode(text, add_special_tokens=False)

    def tokens(self, before, words):
        """(context ids starting with BOS, one id list per word)."""
        context = [self.bos] + self.encode(before.rstrip()[-CONTEXT_CHARS:])[-CONTEXT_TOKENS:]
        lead = " " if before.strip() else ""
        return context, [self.encode(lead + word) for word in words]

    @torch.no_grad()
    def score(self, before, words):
        context, word_ids = self.tokens(before, words)
        scores = []
        for ids in word_ids:
            logits = self.model(input_ids=torch.tensor([context + ids])).logits[0].double()
            log_probs = torch.log_softmax(logits, -1)
            scores.append(sum(float(log_probs[len(context) + k - 1, t]) for k, t in enumerate(ids)))
        return scores


class WordLogProbs(nn.Module):
    """The decoder with fixed shapes: attention masks and rotary tables are constants."""

    def __init__(self, lm):
        super().__init__()
        config = lm.config
        self.embeddings = lm.model.embeddings
        self.layers = lm.model.layers
        self.final_norm = lm.model.final_norm
        self.head = lm.lm_head
        self.decoder = lm.decoder
        self.heads = config.num_attention_heads
        self.head_dim = config.hidden_size // self.heads
        self.layer_types = list(config.layer_types)

        # Words sit at positions CONTEXT... and attend to the context and to their own earlier tokens.
        position = torch.arange(CONTEXT + WORD_TOKENS)
        distance = position[:, None] - position[None, :]
        blocked = {"full_attention": distance < 0,
                   "sliding_attention": (distance < 0) | (distance >= config.sliding_window)}
        for kind in sorted(set(self.layer_types)):
            mask = torch.zeros(len(position), len(position)).masked_fill(blocked[kind], -1e4)
            theta = config.rope_parameters[kind]["rope_theta"]
            inv_freq = 1.0 / (theta ** (torch.arange(0, self.head_dim, 2, dtype=torch.float) / self.head_dim))
            angle = position[:, None].float() * inv_freq[None, :]
            angle = torch.cat((angle, angle), dim=-1)
            self.register_buffer(f"{kind}_context_mask", mask[None, None, :CONTEXT, :CONTEXT])
            self.register_buffer(f"{kind}_word_mask", mask[None, None, CONTEXT:, :])
            self.register_buffer(f"{kind}_cos", angle.cos()[None, None])
            self.register_buffer(f"{kind}_sin", angle.sin()[None, None])
        self.register_buffer("slots", torch.arange(CONTEXT, dtype=torch.int32))

    def rotate(self, x, cos, sin):
        half = self.head_dim // 2
        return x * cos + torch.cat((-x[..., half:], x[..., :half]), dim=-1) * sin

    def split(self, x, rows, length):
        return x.view(rows, length, self.heads, self.head_dim).transpose(1, 2)

    def join(self, x, rows, length):
        return x.transpose(1, 2).reshape(rows, length, self.heads * self.head_dim)

    def attend(self, layer, kind, context, words, padding):
        attn = layer.attn
        cos, sin = getattr(self, f"{kind}_cos"), getattr(self, f"{kind}_sin")
        context_mask = getattr(self, f"{kind}_context_mask") + padding
        word_mask = getattr(self, f"{kind}_word_mask") + nn.functional.pad(padding, (0, WORD_TOKENS))

        q = self.rotate(self.split(attn.q_proj(context), 1, CONTEXT), cos[:, :, :CONTEXT], sin[:, :, :CONTEXT])
        k = self.rotate(self.split(attn.k_proj(context), 1, CONTEXT), cos[:, :, :CONTEXT], sin[:, :, :CONTEXT])
        v = self.split(attn.v_proj(context), 1, CONTEXT)
        weights = torch.softmax(torch.matmul(q, k.transpose(2, 3)) * attn.scaling + context_mask, dim=-1)
        context_out = attn.Wo(self.join(torch.matmul(weights, v), 1, CONTEXT))

        wq = self.rotate(self.split(attn.q_proj(words), ROWS, WORD_TOKENS), cos[:, :, CONTEXT:], sin[:, :, CONTEXT:])
        wk = self.rotate(self.split(attn.k_proj(words), ROWS, WORD_TOKENS), cos[:, :, CONTEXT:], sin[:, :, CONTEXT:])
        wv = self.split(attn.v_proj(words), ROWS, WORD_TOKENS)
        keys = torch.cat((k.expand(ROWS, -1, -1, -1), wk), dim=2)
        values = torch.cat((v.expand(ROWS, -1, -1, -1), wv), dim=2)
        weights = torch.softmax(torch.matmul(wq, keys.transpose(2, 3)) * attn.scaling + word_mask, dim=-1)
        words_out = attn.Wo(self.join(torch.matmul(weights, values), ROWS, WORD_TOKENS))
        return context_out, words_out

    def forward(self, context_ids, context_length, word_ids, positions):
        embed = lambda ids: self.embeddings.norm(self.embeddings.tok_embeddings(ids))
        context, words = embed(context_ids), embed(word_ids)
        padding = (self.slots < CONTEXT - context_length).float() * -1e4
        for layer, kind in zip(self.layers, self.layer_types):
            context_out, words_out = self.attend(layer, kind, layer.attn_norm(context), layer.attn_norm(words), padding)
            context, words = context + context_out, words + words_out
            context = context + layer.mlp(layer.mlp_norm(context))
            words = words + layer.mlp(layer.mlp_norm(words))
        # The state that predicts token k of a word: the last context token for k = 0, else token k - 1.
        last = context[:, CONTEXT - 1:, :].expand(ROWS, -1, -1)
        states = self.final_norm(torch.cat((last, words[:, : WORD_TOKENS - 1, :]), dim=1))
        states = torch.index_select(states.reshape(ROWS * WORD_TOKENS, -1), 0, positions)
        log_probs = torch.log_softmax(self.decoder(self.head(states)), dim=-1)
        targets = torch.index_select(word_ids.reshape(ROWS * WORD_TOKENS), 0, positions)
        return torch.gather(log_probs, 1, targets.unsqueeze(-1).long()).squeeze(-1)


def pack(reference, before, words):
    """Model inputs for one request and the token count of each word."""
    context, word_ids = reference.tokens(before, words)
    lengths = [len(ids) for ids in word_ids]
    if len(words) > ROWS or max(lengths) > WORD_TOKENS or sum(lengths) > TARGETS:
        raise ValueError(f"request does not fit {ROWS} words, {WORD_TOKENS} tokens a word, {TARGETS} in all: {words}")
    context_ids = np.full((1, CONTEXT), reference.pad, dtype=np.int32)
    context_ids[0, CONTEXT - len(context):] = context
    rows = np.full((ROWS, WORD_TOKENS), reference.pad, dtype=np.int32)
    positions = np.zeros(TARGETS, dtype=np.int32)
    used = 0
    for row, ids in enumerate(word_ids):
        rows[row, : len(ids)] = ids
        positions[used: used + len(ids)] = row * WORD_TOKENS + np.arange(len(ids))
        used += len(ids)
    inputs = {"context_ids": context_ids, "context_length": np.array([len(context)], dtype=np.int32),
              "word_ids": rows, "positions": positions}
    return inputs, lengths


def unpack(log_probs, lengths):
    ends = np.cumsum(lengths)
    return [float(np.sum(log_probs[end - n: end], dtype=np.float64)) for n, end in zip(lengths, ends)]


def check_graph(reference, wrapper, cases):
    """The fixed-shape graph must agree with the unpadded reference."""
    worst = 0.0
    with torch.no_grad():
        for case in cases:
            inputs, lengths = pack(reference, case["before"], case["words"])
            got = unpack(wrapper(*(torch.from_numpy(v) for v in inputs.values())).numpy(), lengths)
            worst = max(worst, max(abs(a - b) for a, b in zip(got, case["scores"])))
    if worst > 1e-3:
        sys.exit(f"the fixed-shape graph differs from the reference by {worst:.4f}")
    return worst


def float16_storage_pass():
    """A graph pass that stores float32 weights as float16; they are widened again when the model loads."""
    from coremltools.converters.mil import Builder as mb
    from coremltools.converters.mil.mil.passes.graph_pass import AbstractGraphPass
    from coremltools.converters.mil.mil.passes.helper import block_context_manager
    from coremltools.converters.mil.mil.passes.pass_registry import register_pass

    @register_pass(namespace="common", override=True)
    class store_weights_as_float16(AbstractGraphPass):
        def apply(self, prog):
            for function in prog.functions.values():
                self.rewrite(function)

        @block_context_manager
        def rewrite(self, block):
            for op in list(block.operations):
                value = op.outputs[0].val if op.op_type == "const" else None
                if not isinstance(value, np.ndarray) or value.dtype != np.float32 or value.size < 2048:
                    continue
                stored = mb.constexpr_cast(source_val=value.astype(np.float16), output_dtype="fp32",
                                           before_op=op, name=op.name + "_float16")
                block.replace_uses_of_var_after_op(anchor_op=op, old_var=op.outputs[0], new_var=stored,
                                                   no_check_var_types=True)
                block.remove_ops([op])

    return "common::store_weights_as_float16"


def convert(wrapper, reference, variant):
    import coremltools as ct
    import coremltools.optimize.coreml as cto

    precision, _, weights = variant.partition("-")
    shapes = {"context_ids": (1, CONTEXT), "context_length": (1,), "word_ids": (ROWS, WORD_TOKENS), "positions": (TARGETS,)}
    example = tuple(torch.zeros(shape, dtype=torch.int32) for shape in shapes.values())
    example[1][0] = 1
    pipeline = ct.PassPipeline.DEFAULT
    if weights == "w16":
        pipeline.append_pass(float16_storage_pass())
    model = ct.convert(
        torch.jit.trace(wrapper, example),
        convert_to="mlprogram",
        minimum_deployment_target=ct.target.macOS13,
        compute_precision=ct.precision.FLOAT16 if precision == "float16" else ct.precision.FLOAT32,
        pass_pipeline=pipeline,
        inputs=[ct.TensorType(name=name, shape=shape, dtype=np.int32) for name, shape in shapes.items()],
        outputs=[ct.TensorType(name="log_probs", dtype=np.float32)],
    )
    if weights == "w8":
        config = cto.OptimizationConfig(global_config=cto.OpLinearQuantizerConfig(mode="linear_symmetric"))
        model = cto.linear_quantize_weights(model, config)
    elif weights == "p8":
        config = cto.OptimizationConfig(global_config=cto.OpPalettizerConfig(mode="kmeans", nbits=8))
        model = cto.palettize_weights(model, config)
    model.short_description = f"Log-probabilities of candidate word tokens; {MODEL_ID} ({variant})"
    model.license = "MIT"
    model.user_defined_metadata.update({
        "source_model": MODEL_ID, "source_revision": REVISION,
        "bos_token_id": str(reference.bos), "pad_token_id": str(reference.pad),
    })
    return model


def evaluate(package, reference, cases):
    """(largest score difference, requests whose best word differs) on the CPU, where the app runs the model."""
    import coremltools as ct

    model = ct.models.MLModel(str(package), compute_units=ct.ComputeUnit.CPU_ONLY)
    worst, flips = 0.0, 0
    for case in cases:
        inputs, lengths = pack(reference, case["before"], case["words"])
        got = unpack(model.predict(inputs)["log_probs"], lengths)
        worst = max(worst, max(abs(a - b) for a, b in zip(got, case["scores"])))
        flips += int(np.argmax(got) != int(np.argmax(case["scores"])))
    return worst, flips


def directory_size(path):
    return sum(f.stat().st_size for f in Path(path).rglob("*") if f.is_file())


def learner_requests(count):
    """Requests from tests/data/scenarios/learner.tsv: the typed and the intended word after the intended text."""
    rows = [line.split("\t") for line in (ROOT / "tests/data/scenarios/learner.tsv").read_text("utf-8").splitlines()]
    rng = random.Random(17)
    requests = []
    for row in rows[:: max(1, len(rows) // count)]:
        typed, intended = row[3].split(" "), row[4].split(" ")
        if len(typed) != len(intended):
            continue
        differing = [i for i, (a, b) in enumerate(zip(typed, intended)) if a.lower() != b.lower() and a.isalpha() and b.isalpha()]
        if not differing:
            continue
        i = rng.choice(differing)
        others = sorted({w for w in intended if w.isalpha() and w not in (typed[i], intended[i])})
        words = [intended[i]] + rng.sample(others, min(len(others), rng.randint(0, ROWS - 2))) + [typed[i]]
        requests.append({"before": "".join(w + " " for w in intended[:i]), "words": words})
    return requests[:count]


def edge_requests():
    news = (ROOT / "tests/data/scenarios/news.txt").read_text("utf-8").splitlines()
    long_text = " ".join(news[:6]) + " "
    return [
        {"before": "", "words": ["Hello", "Helo", "hello"]},
        {"before": "   \n", "words": ["weather", "wether"]},
        {"before": "Because of the bad ", "words": ["weather", "whether", "wether"]},
        # The request the engine makes for `wether` here; scripts/readme/hero.mjs replays it.
        {"before": "Because of the bad ", "words": ["wether", "whether", "weather", "with", "which"]},
        {"before": "Because of the bad", "words": ["weather", "wether"]},
        {"before": long_text, "words": ["government", "goverment", "governor", "govern", "governed", "governing"]},
        {"before": long_text[:239] + " ", "words": ["the", "teh"]},
        {"before": "Le café près de l'église était fermé, so we ", "words": ["went", "want", "wnet"]},
        {"before": "Zöe and Amélie said the naïve plan was ", "words": ["fine", "fien"]},
        {"before": "我昨天去了北京。Yesterday I ", "words": ["visited", "visted", "vistied"]},
        {"before": "Спасибо! Thank you very ", "words": ["much", "mcuh", "mush"]},
        {"before": "That was so funny 😂😂 I can't ", "words": ["believe", "beleive", "belief"]},
        {"before": "Family trip 👨‍👩‍👧‍👦🇨🇦 we are ", "words": ["leaving", "leavign"]},
        {"before": "😀" * 300 + " ", "words": ["ok", "okay"]},
        {"before": "I think they ", "words": ["don't", "dont", "doesn't", "won't"]},
        {"before": "It is my ", "words": ["sister's", "sisters", "sister’s"]},
        {"before": "He typed ", "words": ["qzxvkjwpfhgbnmtrlcds", "something"]},
        {"before": long_text, "words": ["qzxvkjwpfhgbnmtrlcds", "question", "quiz", "quite", "quick", "queue"]},
        # A full context and a word of WORD_TOKENS tokens: the only shape that reaches the sliding-window limit.
        {"before": long_text, "words": ["fpwgmxvgxmfwbqgnzxnhqk", "few"]},
        {"before": "Line one\n\tindented    line with  spaces\r\nand then ", "words": ["more", "moer"]},
        {"before": "The answer is 42.5% (see https://example.com/a_b?c=d) or ", "words": ["less", "les"]},
        {"before": "trailing spaces   ", "words": ["here", "hear"]},
        {"before": "x", "words": ["a"]},
    ]


def tokenizer_texts():
    return [
        "", " ", "  ", "a b", "a  b", "a   b", " " * 30 + "x", "tab\there", "line\n\nbreak", "end ",
        "don't we'll I'm they've he'd it's you're 'tis", "DON'T", "rock'n'roll", "it’s",
        "naïve café Zöe", "각 한국어", "ﬁne Ångström", "日本語のテキスト", "العربية שלום",
        "😀 👍🏽 👨‍👩‍👧‍👦 🇯🇵", "x​y", "a b c", "1,250.00 2026-12-03 v1.2.3", "~/Downloads/contract-final.pdf",
        "[MASK] and  [MASK]", "a[SEP]b [CLS] [PAD] [UNK] [unused3]", "<|endoftext|> <|padding|>", "|||EMAIL_ADDRESS||| x",
        "[mask] [MASK", "supercalifragilisticexpialidocious", "ę́́", "\x00\x01\x7f", "﻿bom", "\U000e0041\U0010ffff",
    ]


def build_fixtures(reference):
    cases = []
    for request in learner_requests(44) + edge_requests():
        context, word_ids = reference.tokens(request["before"], request["words"])
        cases.append({**request, "context_ids": context, "word_ids": word_ids,
                      "scores": [round(s, 4) for s in reference.score(request["before"], request["words"])]})
    return {
        "model": MODEL_ID,
        "tokenizer": [{"text": text, "ids": reference.encode(text)} for text in tokenizer_texts()],
        "cases": cases,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--variant", default=DEFAULT_VARIANT, choices=VARIANTS,
                        help="compute precision, then how weights are stored: w16 float16, w8 8-bit linear, "
                             "p8 8-bit palette (default: %(default)s)")
    parser.add_argument("--compare", action="store_true", help="build every variant and print its size and error")
    args = parser.parse_args()

    from huggingface_hub import hf_hub_download

    reference = Reference(MODEL_ID, REVISION)
    wrapper = WordLogProbs(reference.model).eval()
    fixtures = build_fixtures(reference)
    cases = fixtures["cases"]
    print(f"{len(cases)} requests; the fixed-shape graph differs from the reference by at most "
          f"{check_graph(reference, wrapper, cases):.1e}")

    with tempfile.TemporaryDirectory() as scratch:
        for variant in VARIANTS if args.compare else [args.variant]:
            package = Path(scratch) / f"{variant}.mlpackage"
            convert(wrapper, reference, variant).save(str(package))
            error, flips = evaluate(package, reference, cases)
            print(f"{variant:12} {directory_size(package) / 1e6:5.1f} MB   max error {error:.4f}   "
                  f"best word differs in {flips} requests")
            if variant != args.variant:
                continue
            if error > TOLERANCE or flips:
                sys.exit(f"{variant} is outside the tolerance of {TOLERANCE}")
            target = ROOT / "data/lm.mlpackage"
            shutil.rmtree(target, ignore_errors=True)
            shutil.copytree(package, target)
            for file in target.rglob("*"):
                file.chmod(0o755 if file.is_dir() else 0o644)

    shutil.copyfile(hf_hub_download(MODEL_ID, "tokenizer.json", revision=REVISION), ROOT / "data/lm-tokenizer.json")
    with open(ROOT / "tests/data/lm-fixtures.json", "w", encoding="utf-8") as out:
        json.dump(fixtures, out, ensure_ascii=False, indent=1)
        out.write("\n")
    print("wrote data/lm.mlpackage, data/lm-tokenizer.json, tests/data/lm-fixtures.json")


if __name__ == "__main__":
    main()
