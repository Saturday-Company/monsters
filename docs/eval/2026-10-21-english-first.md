# English first: the English prompts against the Italian ones (21/10/2026, D-153)

The first `post` run of wave 3 (free models, Italian profile and request with the English prompts) put the English
family well behind the Italian one: the tone asked with `ask_user` 1/3 (IT 3/3), a question left in plain text 2/3
(IT 0/3), invented dishes 3/3 (IT 0/3). This round measures the English family the way an English user meets it,
reviews it rule by rule against the Italian one and measures it again.

## Setup

```
pnpm --filter @monsters/core eval --case post --times 3 --lang en --models paid --keep <dir>
```

- **The English user** (`--lang en`, new `--user`, default the same as `--lang`): the same trattoria, the profile and
  the request in English ("Prepare 3 Instagram posts about the restaurant’s new autumn menu"), the monsters writing
  in English. The dishes keep their Italian names, as on a real menu. `--lang en --user it` gives back the setup of
  the first run.
- **Paid twins of the free chain** (`--models paid`, `OPENROUTER_PAID_API_KEY`): `poolside/laguna-s-2.1`, then
  `nvidia/nemotron-3-super-120b-a12b`. Laguna first because it is the model that served the run above: the free
  Nemotron answered 404 at every first request, so every agent fell back to the free Laguna. A first Italian series
  on the paid Nemotron (3 runs, 0.068 $) never asked about taste at all, in Italian too: a different model, not a
  baseline for this comparison. On the paid chain there were no fallbacks.
- A paid chain is not a free one for the core (`isFreeChain`): the monsters get the full toolset. Both families
  run the same way, so the comparison holds; the absolute numbers are not those of the free tier.
- Two series of 3 per arm, at the same time for IT and EN. Questions answered with the recommended option.
- Metric fixed on the way: "invented dishes" counted substrings ("anatra" inside `#toscanatradizionale`) and the
  English gloss of a given dish ("tortelli di zucca, pumpkin ravioli"). Now a dish word counts where a word starts
  and a gloss of a dish in the menu does not; every run below is rescored with the new rule (`--rescore`).
  "Notes in the language" checks the writing language of the run, not Italian.

## Numbers

| arm | runs | tone with `ask_user` | ends with a `?` in plain text | invented dishes | notes in the writing language | requests per run | cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IT, Italian prompts | 6 | **6/6** | 1/6 | 1/6 (tagliatelle, in a joke) | 6/6 | 10.3 | 0.022 $ |
| EN before (wave 3) | 6 | 5/6 | 3/6 | 0/6 | 6/6 | 11.2 | 0.024 $ |
| EN after, fix 1 | 6 | 4/6 | 2/6 | 0/6 | 6/6 | 11.0 | 0.018 $ |
| EN after, fix 2 | 10 | 8/10 | 4/10 | 2/10 (porcini, schiacciata) | 9/10 (a MEMORY.md "mixed") | 9.3 | 0.030 $ |

Total spend of the round: about 0.18 $ (the paid Nemotron series included). One run of "fix 2" was stopped by the
request budget of the ledger after its question (counted, since the question had been asked).

- **With the realistic English user the gap is much smaller than in the first run.** The invented dishes of that
  run do not come back (0/6 before the fixes): they came from the mix of Italian facts and English prompts, and
  partly from the metric. Both families still make up other facts now and then (an address, a phone number,
  opening hours: not counted by the metric), in Italian as in English.
- **Taste.** The miss in English is always the same: the lead asks the writer for "3 different angles" instead of 2
  variants, or lists the variants in its reply and stops ("When you’ve picked, I’ll show you the captions") without
  `ask_user`. Italian never did it in 6 runs. After the fixes the variants are asked for every time; the choice is
  still left in the text in 2 runs out of 10.
- **Plain-text questions** in English are almost all closing offers ("Want me to tweak anything before you
  post?"), a habit of English prose, or a question inside the post copy itself ("Which one will you try first?",
  a false positive of the metric). None blocks the work; the stop hook catches the ones that would.
- With 6-10 runs per arm the differences that remain are within the noise of the model. No metric is clearly worse
  in English after the fixes; the residual one to watch is the choice left in the text without `ask_user`.

## What changed in the English family

The Italian family did not move (its hashes are pinned). The English one was read line by line against it:

- **AGENTS.md of the lead, the project lead and the monsters**: rules in the imperative ("Handle simple requests
  yourself", "Make the reversible choices… yourself") where the Italian present ("le fai tu") had read as a
  description in English; "you have 2 variants … written" (read as "you have them") became "have the writer write
  2 variants … then ask {user} with ask_user which one they prefer"; "never with a question in the text" became
  "never as a question or a list of options in your reply"; "{user}’s facts … come from the profile" became "Facts
  about {user}’s own work … come only from the profile or the vault"; the "when it is done" of the brief is now the
  “done when” the brief shows; the tone line adds "no closing offers or questions". Same lines, placeholders,
  sections and tools as the Italian (the structure test).
- The wave-3 English templates are kept as `legacy`: an English AGENTS.md written by them and never edited is
  rendered again with the new ones when the team loads.
- **Stop hook** (`final-question.prompts.ts`): "You asked a question in plain text… otherwise the plain-text
  question is fine as it is: reply only OK." The old English reminder is still recognised in a log.
- **Dione**: "you don’t make up facts that aren’t in them" (the notes), not "that aren’t there".
- Checked and left as they were (faithful already): the reminders of `run-agent` and `run-harness`, the done-check,
  the stuck and route hints, the gate and the instinct's questions, the descriptions of `delegate` and `ask_user`
  (English prose in both families), `profilo.md`, the team proposal.

## Also in this round

- The onboarding starts the monsters' writing language on the app's language (`defaultWritingLanguage` in
  `@monsters/shared`): an English app no longer starts on Italian. A system language the app has no words for
  (Spanish, French, German) still goes first, as in audit 2.12.

## Open

- The choice left in the reply without `ask_user` (2/10 in English): a check in code (a list of variants at the end
  of the lead's reply without a question, like the stop hook for a `?`) would cover both families.
- Facts about the user's business made up by the writer (address, phone, hours), in both languages: not measured
  yet; worth a metric of its own.
- Repeat on the free chain when the free Nemotron answers again, and on Haiku.
