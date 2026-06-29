# Memory pipeline probe

Run: 2026-06-29T14:30:47.886Z — live LLM: true — models: full=`gpt-5.4`, mini=`gpt-5.4-mini`

## Pipeline & method

Three LLM-decidable stages are exercised independently, each with its own model:
1. **Decision** — classify a message as extract / retrieve / ignore (LLM stand-in for the regex gate `hasExtractionSignal` / `shouldConsiderMemory`). Scored against 23 labelled prompts.
2. **Extraction** — the real `extractMemories` extractor (command lane, as used for user messages) turns an extract-gated message into memory operations.
3. **Storage** — an LLM reconciler decides each extracted candidate against the seed memories: `add` (new) vs `merge`/`ignore` (dedup). When the extractor abstains, the raw message is used as the candidate so the stage is always measurable on a gated extract. Scored on the expected add-vs-dedup outcome.

Configs isolate one downgrade each: **A→B = decision**, **B→C = extraction**, **C→D = storage** (D is all-mini, added to stress mini on the strict-JSON storage stage).

Every stage parses the model reply in tiers — **strict** (clean JSON), **salvaged** (code fences / prose / trailing commas stripped), or **failed** — so a small model wrapping its answer in extra text is recovered and *counted*, not silently scored as a wrong answer. See **Structured-output reliability** below.

| config | decision | extract | storage |
|--|--|--|--|
| A: all-full | `gpt-5.4` | `gpt-5.4` | `gpt-5.4` |
| B: mini-decision | `gpt-5.4-mini` | `gpt-5.4` | `gpt-5.4` |
| C: mini-decide+extract | `gpt-5.4-mini` | `gpt-5.4-mini` | `gpt-5.4` |
| D: all-mini | `gpt-5.4-mini` | `gpt-5.4-mini` | `gpt-5.4-mini` |

## Accuracy & speed by configuration

| config | decision acc | dec ms | ext ms | ext abst | store acc | store ms | e2e ms/turn | LLM calls | wall ms |
|--|--|--|--|--|--|--|--|--|--|
| regex baseline | 14/23 (61%) | ~0 | — | — | — | — | ~0 | 0 | — |
| A: all-full | 20/23 (87%) | 1452 | 1543 | 12/12 | 10/10 (100%) | 1528 | 3054 | 47 | 70237 |
| B: mini-decision | 20/23 (87%) | 1241 | 1304 | 12/12 | 10/10 (100%) | 1594 | 2753 | 47 | 63311 |
| C: mini-decide+extract | 20/23 (87%) | 1285 | 2545 | 12/12 | 10/10 (100%) | 1771 | 3536 | 47 | 81327 |
| D: all-mini | 20/23 (87%) | 1208 | 1802 | 11/12 | 10/10 (100%) | 1399 | 2878 | 47 | 66205 |

## Structured-output reliability (strict-JSON adherence)

How often each stage returned clean **strict** JSON vs needed **salvage** (stripping code fences / surrounding prose / trailing commas) vs **failed** outright. This is where small models like `gpt-5.4-mini` tend to slip by adding extra stuff around the JSON. The probe recovers salvageable replies (so format slips are not miscounted as wrong answers) and records the rate here.

| config | decision model | decision JSON (strict/salv/fail) | storage model | storage JSON (strict/salv/fail) |
|--|--|--|--|--|
| A: all-full | `gpt-5.4` | 23/0/0 | `gpt-5.4` | 12/0/0 |
| B: mini-decision | `gpt-5.4-mini` | 23/0/0 | `gpt-5.4` | 12/0/0 |
| C: mini-decide+extract | `gpt-5.4-mini` | 23/0/0 | `gpt-5.4` | 12/0/0 |
| D: all-mini | `gpt-5.4-mini` | 23/0/0 | `gpt-5.4-mini` | 12/0/0 |

## Decision label by prompt

`*` marks a mismatch vs the expected label.

| expect | prompt | regex | A | B | C | D |
|--|--|--|--|--|--|--|
| extract | Remember that my dog is called Chopper. | extract | extract | extract | extract | extract |
| extract | My daughter Laija just turned 9. | extract | extract | extract | extract | extract |
| extract | From now on always reply in British Eng… | extract | extract | extract | extract | extract |
| extract | I prefer concise answers without preamb… | extract | extract | extract | extract | extract |
| extract | We deploy watai to resource group rg-wa… | extract | extract | extract | extract | extract |
| extract | Never use emojis in your responses. | extract | extract | extract | extract | extract |
| extract | I work as a staff engineer at a fintech. | extract | extract | extract | extract | extract |
| extract | Going forward, default Python examples … | ignore* | extract | extract | extract | extract |
| extract | Call me Sam, not Samuel. | ignore* | extract | extract | extract | extract |
| extract | I am allergic to peanuts, keep that in … | extract | extract | extract | extract | extract |
| retrieve | What's my dog's name? | extract* | retrieve | retrieve | retrieve | retrieve |
| retrieve | What do you know about me? | retrieve | retrieve | retrieve | retrieve | retrieve |
| retrieve | Which resource group do we deploy watai… | extract* | retrieve | retrieve | retrieve | retrieve |
| retrieve | How old is my daughter? | extract* | retrieve | retrieve | retrieve | retrieve |
| retrieve | Use my usual writing style for this ema… | retrieve | retrieve | retrieve | retrieve | retrieve |
| retrieve | What was the deploy target again? | extract* | retrieve | retrieve | retrieve | retrieve |
| retrieve | Summarize me in one line. | ignore* | ignore* | ignore* | ignore* | ignore* |
| ignore | What is the capital of France? | ignore | ignore | ignore | ignore | ignore |
| ignore | Translate "good morning" to Japanese. | ignore | ignore | ignore | ignore | ignore |
| ignore | Write a haiku about rain. | ignore | ignore | ignore | ignore | ignore |
| ignore | Fix this bug: TypeError on line 4. | ignore | ignore | ignore | ignore | ignore |
| ignore | I prefer the second option for this lay… | extract* | extract* | extract* | extract* | extract* |
| ignore | Always sort this list alphabetically. | extract* | extract* | extract* | extract* | extract* |

## Storage decision by extract prompt

Expected `dedup` when a seed already covers the fact, `new` when novel. The extractor abstained on most prompts (see `ext abst`), so storage usually judged the raw message. `skip` = the decision stage did not classify the prompt as extract. `*` = wrong.

| expect | prompt | A | B | C | D |
|--|--|--|--|--|--|
| dedup | Remember that my dog is called Chopper. | dedup | dedup | dedup | dedup |
| dedup | My daughter Laija just turned 9. | dedup | dedup | dedup | dedup |
| new | From now on always reply in British Eng… | new | new | new | new |
| dedup | I prefer concise answers without preamb… | dedup | dedup | dedup | dedup |
| dedup | We deploy watai to resource group rg-wa… | dedup | dedup | dedup | dedup |
| new | Never use emojis in your responses. | new | new | new | new |
| new | I work as a staff engineer at a fintech. | new | new | new | new |
| new | Going forward, default Python examples … | new | new | new | new |
| new | Call me Sam, not Samuel. | new | new | new | new |
| new | I am allergic to peanuts, keep that in … | new | new | new | new |

## Insights

- **Decision (A vs B — full vs mini; extraction+storage held full).** Accuracy 20/23 (87%) vs 20/23 (87%); regex baseline 14/23 (61%). Latency 1452ms vs 1241ms/call (1.2× faster on mini). Mini matched or beat the full model — the decision gate does not need the expensive model.
- **Extraction (B vs C — full vs mini; decision mini + storage full).** The real extractor abstained (no operation) on 12/12 gated prompts on full and 12/12 on mini — its minimal-reasoning selectivity dominates, so the model tier barely changes output. Latency 1304ms vs 2545ms/call.
- **Structured-output reliability — the mini JSON risk you flagged.** Decision JSON: full (A) 23 strict / 0 salvaged / 0 failed (of 23); mini (B) 23 strict / 0 salvaged / 0 failed (of 23). Storage JSON (the most format-heavy stage): full (A) 12 strict / 0 salvaged / 0 failed (of 12); mini (D, all-mini) 12 strict / 0 salvaged / 0 failed (of 12). "salvaged" = the model wrapped its answer in fences/prose/trailing commas the parser had to strip; "failed" = unrecoverable. The probe parses in tiers (strict → fence-strip + balanced-object scan + trailing-comma repair → fail), so a format slip is recovered and counted as salvaged instead of being silently scored as a wrong answer — and the salvage/fail counts make mini's "adds extra stuff" tendency visible.
- **Storage dedup.** Correct add-vs-dedup — A 10/10 (100%), B 10/10 (100%), C 10/10 (100%), D mini-storage 10/10 (100%). Mini on storage matched full on the dedup decision — weigh that against its JSON reliability above.
- **End-to-end.** Mean LLM time/turn — A 3054ms, B 2753ms, C 3536ms, D 2878ms; wall — A 70237ms, B 63311ms, C 81327ms, D 66205ms.
- **Recommendation.** Accuracy is equivalent across A–C (decision 20/23, storage 10/10); the call is cost + format reliability, not quality. On the gate, mini's decision JSON needed salvage or failed only 0 time(s) across 46 mini calls — reliable enough, so **mini decision is safe**. On storage (the strict `{"operations":[…]}` payload), mini slipped 0/12 time(s) this run, though that is the highest-risk spot. So keep **C: mini-decide+extract** as the cost-optimal default (mini decision + mini extraction) but **keep the full model on storage**, where a malformed operations array would silently drop or corrupt writes. The tiered parser is the safety net that makes mini usable on the cheaper stages.

---

Regenerate: `cd api && npm run probe` (reads `api/.env`).
