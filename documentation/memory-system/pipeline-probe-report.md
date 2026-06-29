# Memory pipeline probe

Run: 2026-06-29T11:00:33.309Z — live LLM: false — gate accuracy 14/23

Gates are independent in the app: extraction (`hasExtractionSignal`) and retrieval (`shouldConsiderMemory`) both fire. `path` shows extract-first only for a single label.

| expect | path | ok | extGate | retGate | mems | tok(ms) | ext(ms) | ret(ms) | build(ms) | llm | llm(ms) | prompt |
|--|--|--|--|--|--|--|--|--|--|--|--|--|
| extract | extract | Y | Y | Y | 1 | 0.148 | 0.454 | 0.275 | 0.94 |  | 0 | Remember that my dog is called Chopper. |
| extract | extract | Y | Y | Y | 1 | 0.013 | 0.133 | 0.004 | 0.15 |  | 0 | My daughter Laija just turned 9. |
| extract | extract | Y | Y | N | 0 | 0.006 | 0.007 | 0.003 | 0.03 |  | 0 | From now on always reply in British English. |
| extract | extract | Y | Y | Y | 1 | 0.006 | 0.002 | 0.001 | 0.09 |  | 0 | I prefer concise answers without preamble. |
| extract | extract | Y | Y | Y | 1 | 0.004 | 0.003 | 0.002 | 0.07 |  | 0 | We deploy watai to resource group rg-watai-dev. |
| extract | extract | Y | Y | N | 0 | 0.004 | 0.002 | 0.002 | 0.02 |  | 0 | Never use emojis in your responses. |
| extract | extract | Y | Y | N | 0 | 0.008 | 0.002 | 0.001 | 0.02 |  | 0 | I work as a staff engineer at a fintech. |
| extract | ignore | N | N | N | 0 | 0.004 | 0.002 | 0.001 | 0.02 |  | 0 | Going forward, default Python examples to 3.12. |
| extract | ignore | N | N | N | 0 | 0.004 | 0.002 | 0.001 | 0.02 |  | 0 | Call me Sam, not Samuel. |
| extract | extract | Y | Y | N | 0 | 0.004 | 0.004 | 0.001 | 0.02 |  | 0 | I am allergic to peanuts, keep that in mind. |
| retrieve | extract | N | Y | Y | 1 | 0.002 | 0.002 | 0.003 | 0.06 |  | 0 | What's my dog's name? |
| retrieve | retrieve | Y | N | Y | 0 | 0.003 | 0.001 | 0.001 | 13.85 |  | 0 | What do you know about me? |
| retrieve | extract | N | Y | Y | 1 | 0.004 | 0.002 | 0.002 | 0.11 |  | 0 | Which resource group do we deploy watai to? |
| retrieve | extract | N | Y | Y | 1 | 0.003 | 0.002 | 0.001 | 0.07 |  | 0 | How old is my daughter? |
| retrieve | retrieve | Y | N | Y | 0 | 0.005 | 0.001 | 0.001 | 0.04 |  | 0 | Use my usual writing style for this email. |
| retrieve | extract | N | Y | Y | 0 | 0.004 | 0.001 | 0.001 | 0.04 |  | 0 | What was the deploy target again? |
| retrieve | ignore | N | N | N | 0 | 0.003 | 0.001 | 0.001 | 0.01 |  | 0 | Summarize me in one line. |
| ignore | ignore | Y | N | N | 0 | 0.003 | 0.001 | 0.001 | 0.01 |  | 0 | What is the capital of France? |
| ignore | ignore | Y | N | N | 0 | 0.004 | 0.001 | 0.001 | 0.01 |  | 0 | Translate "good morning" to Japanese. |
| ignore | ignore | Y | N | N | 0 | 0.002 | 0.001 | 0.001 | 0.01 |  | 0 | Write a haiku about rain. |
| ignore | ignore | Y | N | N | 0 | 0.003 | 0.001 | 0.001 | 0.01 |  | 0 | Fix this bug: TypeError on line 4. |
| ignore | extract | N | Y | Y | 0 | 0.004 | 0.001 | 0.001 | 0.05 |  | 0 | I prefer the second option for this layout. |
| ignore | extract | N | Y | N | 0 | 0.003 | 0.001 | 0.001 | 0.01 |  | 0 | Always sort this list alphabetically. |
