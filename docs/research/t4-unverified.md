# T4: facts read from primary sources

All sources were read on 2026-11-03 (UTC). "Primary" = the upstream repo/file/official page. Anything from a third-party repo, mirror or
package is marked second-hand. Statements marked "(my reading)" are my inference, not text from a source, and are not legal advice.

## A. Lichess open database

Source: https://database.lichess.org/ (read 2026-11-03).

- Licence: the page says database exports are released under CC0 and may be used for "commercial purpose", and that you can download,
  modify and redistribute them without asking permission. VERIFIED (page text).
- Redistribution of a small derived dataset (positions + evals, no names): the same page statement covers "modify and redistribute".
  I found no restriction on the page. I did NOT read lichess.org/terms-of-service or any privacy/GDPR text: NOT VERIFIED beyond the page.
- URL pattern (standard rated): `https://database.lichess.org/standard/lichess_db_standard_rated_YYYY-MM.pgn.zst` (plus `.torrent`).
  Seen as hrefs for 2013-01 and 2026-10; HTTP HEAD on 2013-01 returned 200 with 17,761,302 bytes, on 2026-10 200 with 30,982,323,881 bytes
  (about 31 GB). So full recent months are huge: stream with `zstdcat`/partial download (page says .zst can be partly decompressed).
- Clocks: the page says games contain `[%clk ...]` comments, to the second, "since April 2017"; centisecond `%clkc` is a separate
  2013-2021 export. VERIFIED. Sample on the page shows `{ [%eval 0.17] [%clk 0:00:30] }`.
- Surprise: only about 6% of games carry `[%eval ...]` (always from White's point of view). You cannot get evals for most positions
  from the PGN dumps.
- Better fit for "positions + evals": the same page offers `lichess_db_eval.jsonl.zst` (417,862,375 positions, Stockfish, last updated
  2026-11-02, same CC0 statement as it is a "database export"). Format: one JSON per line, `fen` has only pieces/side/castling/ep (no
  clocks), `evals[]` with `knodes`, `depth`, `pvs[].cp|mate|line`. The `line` is in UCI_Chess960 notation (castling written king-takes-rook,
  e.g. e1h1: check on import). Depths and node counts vary; page advises the highest-depth entry.
- PGNs contain usernames in `[White]`/`[Black]` (sample shows names); CC0 still applies. Elo tags are Glicko2 ratings.

Recommendation: CC0 is confirmed on the official page. Use `lichess_db_eval.jsonl.zst` for evaluations and a standard-rated month only
for human move frequencies; strip names/URLs from any shipped derivative anyway.

## B. Piece sets (lichess-org/lila `public/piece`)

Sources: https://github.com/lichess-org/lila/tree/master/public/piece (directory listing via GitHub API) and
https://github.com/lichess-org/lila/blob/master/COPYING.md (read 2026-11-03). lila itself is AGPL-3.0-or-later per COPYING.md; each
exception below is the per-folder table in that file.

- Layout: 43 directories. Each set is one SVG per piece, 12 files named `<colour><Piece>.svg` (`wK.svg`, `bQ.svg`, `wP.svg`...). Raw URL:
  `https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/<set>/<file>.svg`. `disguised` has 14 files. `monarchy` is
  WebP, not SVG. All others I checked are SVG.
- Latest commit touching the folder: 2026-09-29 (API).

Licences as listed in COPYING.md ("free" and "non-free" tables):

| Set | Author | Licence | GPL-3.0+/MIT concern |
|---|---|---|---|
| cburnett | Colin M.L. Burnett | GPLv2+ | fine for GPL-3.0+ (my reading) |
| mono | Duplessis, C. Burnett | GPLv2+ | fine |
| merida | Armando Hernandez Marroquin | GPLv2+ | fine |
| mpchess | Maxime Chupin | "GPL3v3+" (typo in file) | fine if GPL-3.0+ |
| chessnut | Alexis Luengas | Apache-2.0 | permissive, OK |
| fantasy, spatial, celtic | Maurizio Monge | MIT (upstream LICENSE read: MIT) | OK |
| rhosgfx | RhosGFX | CC0 1.0 | OK |
| kiwen-suwi, Firi (dir `firi`), totoy, papercut | neverRare, James Faure, Kosal Sen, N. Anzarov | CC BY 4.0 | attribution only |
| letter, pirouetti, pixel | usolando, pirouetti, therealqtpi | AGPLv3+ | AGPL: pulls network-copyleft |
| shapes | flugsio | CC BY-SA 4.0 | share-alike |
| **fresca, cardinal, icpieces, gioco, tatiana, staunty, dubrovny, maestro** | sadsnake1 | **CC BY-NC-SA 4.0** | **NC + SA: conflict** |
| **california, caliente, anarcandy, disguised, cooke, monarchy, minimal-warmth, horsey** | various | **CC BY-NC-SA 4.0** | **NC + SA: conflict** |
| **xkcd** | Randall Munroe | **CC BY-NC-SA 2.5** | **NC + SA: conflict** |
| alpha | Eric Bentzen | "free for personal non commercial use" | NC, conflict |
| chess7, companion, leipzig | Style-7, D. Brown, A. Hernandez | "freeware" only | not a free licence |
| shahi-ivory-brown | Tamer Karatekin | free use but non-derivative/non-modify | conflict |
| reillycraig, riohacha | | licence blank | no licence stated |
| governor | | no row in COPYING.md at all | NOT VERIFIED (no licence stated) |
| kosal | | no row; only `totoy` (Kosal Sen, CC BY 4.0) is listed | ambiguous, avoid |

Surprise: staunty, fresca and the other sadsnake1 sets, often suggested as lichess-look defaults, are NC-SA, so incompatible with a
GPL-3.0-or-later or MIT app. "chessnut" is fine (Apache-2.0); "merida" is GPLv2+ (not NC).

Attribution facts:
- cburnett: Wikimedia Commons file page (raw wikitext of File:Chess_klt45.svg, read 2026-11-03) lists author Cburnett with a triple
  licence GFDL / BSD / GPL. lila lists GPLv2+. COPYING.md prescribes no attribution wording itself; GPL requires keeping the copyright
  notice and licence text with distributed copies (my reading). Suggested text: "Chess pieces (cburnett set) by Colin M.L. Burnett,
  GPL-2.0-or-later, from lichess-org/lila public/piece/cburnett." I did not check whether the SVG files embed a licence comment
  (first 400 characters showed none).
- chessnut: upstream https://github.com/LexLuengas/chessnut-pieces has LICENSE.txt = standard Apache-2.0 text; its README only says to read the
  licence before use. Copyright holder line and any NOTICE file NOT VERIFIED. Keep the LICENSE text and credit "Chessnut by Alexis Luengas, Apache-2.0".

Recommendation: ship `cburnett` (GPLv2+, 12 SVGs, plain), with `chessnut` (Apache-2.0) as the second option. Do not ship anything NC/SA.

## C. Icons

- Lucide: https://github.com/lucide-icons/lucide/blob/main/LICENSE (read 2026-11-03). ISC, "Copyright (c) 2026 Lucide Icons and Contributors";
  condition: copyright and permission notice must appear in all copies. The same file adds an MIT licence, "Copyright (c) 2013-present
  Cole Bemis", for roughly 130 icons derived from Feather (list includes check, x, plus, search, clock, info, chevron-*, arrow-*, trash,
  download, lock, moon). VERIFIED. If you use any of those, also carry the Cole Bemis MIT notice.
- Tabler Icons: https://github.com/tabler/tabler-icons/blob/main/LICENSE: MIT, "Copyright (c) 2020-2026 Paweł Kuna"; notice must be kept in
  copies or substantial portions. VERIFIED.
- Both are compatible with GPL-3.0-or-later (my reading).

Recommendation: Lucide, with a THIRD-PARTY-NOTICES file holding the ISC text and the Feather MIT text. Attribution text: "Icons: Lucide
(ISC) and, for Feather-derived icons, Feather by Cole Bemis (MIT)."

## D. Maia-2

Sources: https://github.com/CSSLab/maia2 (main, files model.py, utils.py, inference.py, README.md), https://pypi.org/project/maia2/ via
the PyPI JSON API; the 0.11.0 sdist was unpacked in scratch and its model.py matches main (read 2026-11-03).

- Licence: MIT, "Copyright (c) 2024 CSSLab" (LICENSE file; README License section). VERIFIED. Weights licence: NOT stated anywhere I read
  (README License section only covers the repo). I did not download or inspect the weights.
- Surprise: README top banner says Maia-3 is recommended for new projects.
- Weights host: Google Drive, not GitHub or HF. `model.py` has `_MODEL_ASSETS` with `https://drive.google.com/uc?id=<fileid>` for
  `blitz` and `rapid`, downloaded with `gdown`, saved to `./maia2_models/{blitz,rapid}_model.pt`, SHA-256 pinned in code (rapid
  65aae846...e997, blitz 5090d5d0...44b2). Any `type` other than rapid/blitz raises ValueError. Drive quotas can break downloads (my reading);
  self-host the `.pt` if you must depend on it.
- Elo categories (`utils.create_elo_dict`, `map_to_category`): 11 buckets: `<1100` = 0, then 1100-1199 ... 1900-1999 (nine buckets), and
  `>=2000` = 10. No error outside the range: values below 1100 or at/above 2000 are clamped to the end buckets, so effective Elo
  resolution is 100 points across 1100-1999. README gives no range. VERIFIED from code.
- Call: `inference.inference_each(model, prepared, fen, elo_self, elo_oppo)`, with `prepared = inference.prepare()`. `elo_self` is the side to move,
  `elo_oppo` the other side.
- Returns `(move_probs, win_prob)`. `move_probs` is a dict, keys are UCI strings in real-board coordinates (black moves are mirrored back),
  values are probabilities for the side to move over legal moves only, rounded to 4 decimals, sorted descending. `win_prob` is from White's
  perspective (README: "White-perspective expected score", 0/0.5/1 = White loss/draw/win; code does `1 - x` when black is to move).
  Raises ValueError for positions with no legal moves.
- Python: PyPI `requires_python` `>=3.10,<3.13`, classifiers 3.10-3.12; latest 0.11.0 (2026-07-15); needs torch `>=2.8,<2.9`, numpy `>=2.1.3`.

Recommendation: usable offline only through Python and torch; treat the weights as licence-unknown and the Drive host as fragile. Prefer Maia-3.

## E. Maia-3 / Chessformer

- Official repo https://github.com/CSSLab/maia3: LICENSE is the GNU AGPL v3 text; README says it is inference code to run released weights as a
  UCI engine (Python). I did not confirm "or later" wording. VERIFIED (AGPL-3.0). Paper: "Chessformer" (arXiv 2605.19091, ICLR 2026).
- Official Hugging Face cards (https://huggingface.co/UofTCSSLab/Maia3-79M, also served as MaiaChess/Maia3-*):
  79M card says "License: AGPLv3"; 5M and 23M cards say "CC BY 4.0 (paper); see repo for code/weights license". So the cards are not
  uniform, but they point to the repo, which is AGPL-3.0. HF API metadata carries no licence tag for these official repos.
  Practical reading: treat all Maia-3 weights as AGPL-3.0 (my reading).
- Surprise: the `maia3-js` npm package is labelled MIT while shipping AGPL-derived weights.
- `maia3-js` (https://www.npmjs.com/package/maia3-js, registry JSON and tarball read): version 0.2.0 (2026-07-29; 0.1.0 was 2026-05-26), licence MIT, maintainer
  `cemoss17`, no `repository` field in npm metadata. I could not tie it to CSSLab, so treat it as third-party. Tarball: 102 files, 22,858,835 bytes
  unpacked, bundles `models/maia3_5m.onnx` (22,550,022 bytes); `23m` and `79m` are downloaded on first use from HF `cemoss17/maia3-onnx`
  (92.6 MB and 313.3 MB per its file listing).
- API (from its README): `new Maia3({variant:"5m"|"23m"|"79m", executionProviders?, ...})`, `await load()`, `await predict({fen, selfElo, oppoElo?,
  priorFens?|priorMoves?, topK?...})` returning `bestMove` (UCI), `moves` (Map of legal UCI to probability), `candidates` with per-move WDL, `wdl` in
  side-to-move frame. Entry points `maia3-js` (Node) and `maia3-js/web`. Peer deps `onnxruntime-node`/`onnxruntime-web`; dependency `chess.js`.
- WASM/WebGPU: its README says only "ONNX Runtime under the hood" with `executionProviders` pass-through. It does not claim WebGPU or WASM:
  NOT VERIFIED for maia3-js. Latency: README says K=5 candidate scoring is "~5x10ms on CPU" (the author's own claim, no benchmark read).
  `predict` runs extra forward passes for candidates, so one call is several inferences.
- HF ONNX conversions (second-hand: none is by CSSLab):
  - `bqrio/maia3-onnx`: license agpl-3.0, base_model UofTCSSLab/Maia3-79M; fp16/fp32; sizes: 5M 10.8/21.0 MB, 23M 45.8/91.0 MB, 79M 156/312 MB;
    README says runs in onnxruntime-web (wasm or WebGPU).
  - `cstr/maia3-onnx-int32`: agpl-3.0; int32 Elo inputs for Safari; 22/92/313 MB. Its README claims `cemoss17/maia3-onnx` once carried a
    self-declared MIT tag.
  - `Andy108/prepforge-maia3`: agpl-3.0 (fp16 onnx plus stockfish wasm).
  - `cemoss17/maia3-onnx`: no licence tag in HF metadata, README is the maia3-js README (MIT). `TonyRotella/maia3-79m-onnx`: no licence, no README.
  So the "AGPL-3.0" report is right for the conversions that declare one; upstream is AGPL-3.0 in the repo, and its HF cards are
  AGPLv3 (79M) or "see repo" (5M, 23M): no difference in substance.

Recommendation: if you ship Maia-3 weights or a browser ONNX build, the AGPL-3.0 terms apply to them (my reading); a GPL-3.0-or-later app is
AGPL-compatible but the combined work must then also satisfy AGPL network terms. Do not rely on the MIT label of `maia3-js` for the weights.

## F. matilda-uci and Maia-1

- `matilda-uci` (https://github.com/GarryChess/matilda-uci, GitHub API + README read): GPL-3.0; created 2026-06-27; last commit on default branch 2026-07-22
  (merge of PR #8), last push 2026-07-31; release v0.2.0 (2026-07-22); 3 stars; PyPI `matilda-uci` 0.2.0, GPL text. It is a Python UCI engine: Maia-3 (23M,
  frozen) proposes up to 16 candidate moves, a trained re-ranker blends in engine features (Stockfish or Lc0, expects `stockfish` on PATH or `--no-engine`);
  focus is 2500+ Elo play; legacy `--backend maia2`. It downloads Maia-3 weights from HF at first run. Not usable in a browser as is; young project.
- Maia-1 (https://github.com/CSSLab/maia-chess): GPL-3.0 (LICENSE file, GitHub licence field, README "available under the GPL License"); last push 2026-05-24.
  Weights: nine `maia-1100` ... `maia-1900` `.pb.gz` files in `maia_weights/` (about 1.25-1.33 MB each) and release v1.0 (2021-01-14, 9 assets). README: run with
  lc0 and `go nodes 1`. A separate weights licence is NOT stated (so GPL-3.0 repo licence is all that is written).
- lc0 (https://github.com/LeelaChessZero/lc0): GPL-3.0; source tree has `src/tools/leela2onnx.cc`, so you can convert the `.pb.gz` yourself. I did not run it.
- Third-party ONNX conversions (second-hand): `shermansiu/maia-1100..1900` (model.onnx about 3.5 MB, card gpl-3.0 / gpl-3.0-or-later, provenance
  noted from the official release); `cstr/maia-chess-onnx-opset15` (gpl-3.0 tag, opset 15 for ORT Web); `lczerolens/maia-1100..1900` (no licence metadata,
  no README). All are about 3.5 MB per Elo level, small enough for a browser.

Recommendation: for a browser-only trainer, Maia-1 ONNX (about 3.5 MB per level, GPL-3.0) is the cleanest licence fit; verify by converting the official `.pb.gz`
with `leela2onnx` rather than trusting a third-party file. Skip matilda-uci.

## Claim table

| Claim | Status | URL |
|---|---|---|
| Lichess DB exports are CC0, redistribution allowed | VERIFIED | https://database.lichess.org/ |
| Lichess ToS/privacy view of derived data | NOT VERIFIED (not read) | https://lichess.org/terms-of-service |
| Standard rated URL pattern `standard/lichess_db_standard_rated_YYYY-MM.pgn.zst` | VERIFIED | https://database.lichess.org/ |
| `[%clk]` present since 2017-04; only ~6% of games have `[%eval]` | VERIFIED | https://database.lichess.org/ |
| Eval dump `lichess_db_eval.jsonl.zst`, Chess960 UCI lines | VERIFIED | https://database.lichess.org/ |
| Piece sets one SVG per piece (`wK.svg`) | VERIFIED | https://github.com/lichess-org/lila/tree/master/public/piece |
| cburnett/merida GPLv2+, chessnut Apache-2.0, staunty/fresca CC BY-NC-SA 4.0 | VERIFIED | https://github.com/lichess-org/lila/blob/master/COPYING.md |
| governor, kosal, reillycraig, riohacha licence | NOT VERIFIED (no licence row) | https://github.com/lichess-org/lila/blob/master/COPYING.md |
| cburnett triple licence on Commons | VERIFIED | https://commons.wikimedia.org/wiki/File:Chess_klt45.svg |
| Chessnut Apache-2.0 text, no copyright line read | VERIFIED / NOT VERIFIED | https://github.com/LexLuengas/chessnut-pieces |
| Lucide ISC (+ Feather MIT, Cole Bemis) | VERIFIED | https://github.com/lucide-icons/lucide/blob/main/LICENSE |
| Tabler MIT, Paweł Kuna | VERIFIED | https://github.com/tabler/tabler-icons/blob/main/LICENSE |
| Maia-2 repo MIT | VERIFIED | https://github.com/CSSLab/maia2/blob/main/LICENSE |
| Maia-2 weights on Google Drive via gdown, SHA-256 pinned | VERIFIED | https://github.com/CSSLab/maia2/blob/main/maia2/model.py |
| Maia-2 weights licence | NOT VERIFIED (not stated) | https://github.com/CSSLab/maia2 |
| Maia-2 Elo buckets `<1100`, 1100-1999 by 100, `>=2000`, clamped | VERIFIED | https://github.com/CSSLab/maia2/blob/main/maia2/utils.py |
| `inference_each` arg order and return (UCI dict, White-perspective score) | VERIFIED | https://github.com/CSSLab/maia2/blob/main/maia2/inference.py |
| Maia-2 Python 3.10-3.12 | VERIFIED | https://pypi.org/project/maia2/ |
| Maia-3 repo AGPL-3.0 | VERIFIED | https://github.com/CSSLab/maia3 |
| Maia-3 HF cards: 79M AGPLv3, 5M/23M "see repo" | VERIFIED | https://huggingface.co/UofTCSSLab/Maia3-79M |
| maia3-js MIT, 0.2.0, 22.9 MB, bundled 5M ONNX | VERIFIED | https://registry.npmjs.org/maia3-js |
| maia3-js WebGPU/WASM support, latency | NOT VERIFIED (README: ORT only; "~5x10ms CPU" is author claim) | https://registry.npmjs.org/maia3-js |
| bqrio/cstr/Andy108 ONNX conversions AGPL-3.0, WebGPU claim | SECOND-HAND | https://huggingface.co/bqrio/maia3-onnx |
| cemoss17 ONNX has MIT label (README), no HF licence tag | SECOND-HAND | https://huggingface.co/cemoss17/maia3-onnx |
| matilda-uci GPL-3.0, last commit 2026-07-22, Stockfish-based | VERIFIED | https://github.com/GarryChess/matilda-uci |
| Maia-1 repo GPL-3.0, weights `.pb.gz` for lc0 | VERIFIED | https://github.com/CSSLab/maia-chess |
| Maia-1 ONNX conversions (GPL-3.0 tag) | SECOND-HAND | https://huggingface.co/shermansiu/maia-1100 |
| lc0 GPL-3.0, has leela2onnx tool | VERIFIED | https://github.com/LeelaChessZero/lc0 |
