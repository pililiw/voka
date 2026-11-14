# Contributing

Voka is built to move quickly: small, focused changes are easier to review and release than large
ones. Bug reports with the exact keys typed, the text before the caret and the result are the most useful
contribution. Pull requests are welcome; for anything larger than a fix, open an issue first.

## Setup

Requirements: macOS 13 or later, Node 22, and the Xcode Command Line Tools to build. Running the Swift tests
needs Xcode.

```bash
npm install
```

```bash
npm test
```

```bash
npm run macos:test
```

```bash
npm run macos:install
```

`macos:install` builds Voka and installs it for the current user: the input method to
`~/Library/Input Methods` and its Applications entry to `~/Applications`. Uninstall a copy installed
from the package first; two copies of an input method cannot coexist.

## Changing engine behaviour

The engine is `src/engine/` (TypeScript). The macOS app runs the same code in JavaScriptCore and only
forwards keys and draws the candidate window.

1. Describe the behaviour as cases in `eval/cases.ts` (text before the caret, keys, accepted results).
2. Make the change, then check that nothing else moved:

   ```bash
   npm run eval
   ```

   `replay.ts` must pass every case; in `precision.ts` the KEEP set must stay at 100 %; in the scenario
   report, unexpected changes to correct text must not go up.
3. Regenerate the parity file and check the bundle against it:

   ```bash
   bash eval/run.sh eval/export-parity.ts && npm run build:engine && node eval/host-smoke.cjs
   ```

Two rules decide most questions: correct English is never changed, and an automatic replacement
must be something the typist would agree with without looking.

## Language model

`data/lm.mlpackage` is a Core ML conversion of a small causal language model; `scripts/lm/` has the
conversion script and its requirements. The shell scores the engine's candidates with it and the
engine decides with `src/engine/rerank.ts`. The decision rule (`src/engine/lm-rule.ts`) is generated:

```bash
bash eval/run.sh eval/lm-instances.ts > scripts/lm/instances.jsonl
```

```bash
.venv/bin/python scripts/lm/fit_rule.py
```

(`scripts/lm/README.md` describes the Python environment.)

The model may only add a correction for a token that is not a known word and that the engine leaves
as typed. Keep it that way: a change that lets it alter real words or undo the engine's corrections
needs evidence beyond the files in `tests/data`.

## Dictionary

`data/dict.json` is a compiled artefact and is checked in. It is built by
`scripts/build-dictionary.mjs` from third-party sources that are not redistributed here (see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) and from the meanings in `scripts/lexicon/`. To fix a
meaning, edit `scripts/lexicon/glosses.zh-Hans.tsv` and say so in the pull request.

Rebuilding the dictionary (`npm run build:dict`) needs three files in `scripts/raw/`, which is not
tracked: `unimorph.eng.tsv` (the file `eng` from [unimorph/eng](https://github.com/unimorph/eng)),
`stackoverflow-tags.tsv` (tag and question count per line, tab-separated: the 2,500 most popular tags
from the [Stack Exchange API](https://api.stackexchange.com/docs/tags), `site=stackoverflow`,
`sort=popular`) and `word-counts.tsv`, which `node scripts/build-word-counts.mjs <subtitles.txt> <wordfreq.txt>` derives
from the English list of [FrequencyWords](https://github.com/hermitdave/FrequencyWords) and an export
of [wordfreq](https://github.com/rspeer/wordfreq); the script's header says how to get both. The other
sources are npm packages installed by `npm install`.

Licences of the files that are not source code: `data/dict.json` is distributed under CC BY-SA 4.0
(its inflection tables are adapted from UniMorph and its word frequencies from wordfreq and
FrequencyWords), `data/lm.mlpackage` under the MIT License of the model, and `data/lm-tokenizer.json`
under the Apache License 2.0. By contributing meanings you agree that they are compiled into
the dictionary. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) is written
for users and ships inside the application; it names sources, not files, so it only changes when a
source changes.

## Releases

1. Set the version in `package.json` and the two `Info.plist` files in `macos/Resources` (also raise
   `CFBundleVersion`).
2. `npm test`, `npm run macos:test`, `npm run eval`.
3. `npm run macos:package` builds a universal `Voka-<version>.pkg`. With `VOKA_SIGN_IDENTITY`,
   `VOKA_INSTALLER_IDENTITY` and `VOKA_NOTARY_PROFILE` set (see the top of
   `macos/scripts/package.sh`) it is signed with a Developer ID, notarized and stapled.
4. Install the package on a clean user account and go through the Voka window once.
5. Tag `v<version>` and publish a GitHub release with the package and its SHA-256. What changed is
   written in the release notes; there is no changelog file.
