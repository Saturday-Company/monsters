# Connettori MCP senza blocchi (23/10/2026, D-163)

`packages/core/eval/context/run.ts`: il capo squadra su un modello vero di OpenRouter lavora su un server MCP finto
grande. Due casi: `anteiku` (Anteiku finto, 124 strumenti, elenchi lunghi: riepilogo dei clienti di Milano con
l'elenco completo, task del progetto «Sito web Rossi», crea la task «Chiamare Rossi per la revisione») e `github`
(server finto inglese, 93 strumenti tipo GitHub: riepilogo delle issue aperte con label bug, commenti della issue sul
redirect del login, crea la issue «Follow up on login redirect»). Metriche nuove: domande per tipo (`ask_user`,
`access`, `brake`), carte del freno sulle letture, chiamate a `access_request`, `ask_user`, `result_read`,
`tools_search`. `--instinct` accende Jev (il freno giudica come nell'app), `--dump` salva gli eventi.

## Prima (alpha.22, mattina del 23/10)

| modello | caso | esito | passi | token in | comportamento |
|---|---|---|---|---|---|
| gpt-oss-20b | demo vero (sola lettura) | ✗ | 7 | 44k | 3 `access_request`: «il servizio va abilitato per il progetto» |
| gpt-oss-20b | anteiku finto (2 corse) | ✗ ✗ | 4 | 34k | `ask_user` «l'URL della pagina clienti», poi risposta vuota |
| qwen3.7-flash | anteiku finto | ✓ | 13 | 285k | 4 `tools_search` prima di trovare gli strumenti |
| claude-haiku-5.5 | anteiku finto | ✓ | 23 | 700k | oltre 50 `result_read` (0,055 $) |

## Dopo, gruppo per gruppo

**Gruppo 1** (catalogo dei nomi nella carta, precarico per pertinenza, chiamata diretta, `access_request` «ce l'hai»):
- gpt-oss-20b: anteiku 1/3 al primo giro (precarico ancora rumoroso: `catalogo_crea`, `pagamenti_crea`), poi, con il
  precarico per parole del nome, 5/6 su due giri; github 3/3. Zero `ask_user` e zero carte d'accesso su tutti i giri
  dopo la correzione (una corsa ha chiamato 3 volte `access_request`: risposto «è già tuo», nessuna carta).
- qwen3.7-flash: 2/2, anteiku 189k (prima 285k). Haiku: 2/2, anteiku 433k (prima 700k), ancora 21 `result_read`.
- Carta: il catalogo di Anteiku costa circa 560 token (obiettivo ≤ 800), in una parte stabile del prompt.

**Gruppo 2** (freno solo dove serve, accesso per sé con un tocco), con l'istinto acceso:
- Nessuna carta del freno in 6 corse (letture, `anteiku_task_crea`, `create_issue`).
- Classificazione degli strumenti di Anteiku (una scrittura con argomenti normali): prima 43 senza carta, 64 al
  giudizio dell'istinto; dopo 91 senza carta, 16 all'istinto (decidi, chiudi, riapri, segna…), 13 cancellazioni,
  1 spesa (`segna_pagato`), 1 contatto (`task_commenta`). Su GitHub restano all'istinto gist, repository, review.
- gpt-oss: due risposte vuote del provider dopo il primo elenco (lo stesso guasto di stamattina, non nostro).

**Gruppo 3** (elenchi lunghi: pezzi proporzionati alla finestra, filtri nel risultato troncato, tetto di letture):

| modello | anteiku | github |
|---|---|---|
| claude-haiku-5.5 | ✓ 4 passi, 111k, 0,0055 $, 0 `result_read` | ✓ 4 passi, 76k |
| qwen3.7-flash | ✓ 6 passi, 103k | ✓ 5 passi, 77k |
| gpt-oss-20b (3 corse) | ✓ ✗ ✓ (58k-173k) | ✓ ✓ ✓ (78k-139k) |

Haiku sotto i 200k (obiettivo) con un decimo della spesa di prima.

**Gruppo 4** (Codex con `tools_search` e `tools_call`): provato solo con il Codex finto dei test (17 test nuovi);
la prova con Codex vero aspetta un ok esplicito (consuma la quota dell'abbonamento).

**Gruppo 5** (robustezza): 401 con rinnovo OAuth e un nuovo tentativo, gettone personale rifiutato e timeout erano
già corretti, ora con test (`mcp-resilience.test.ts`); una connessione caduta (`fetch failed`) finiva come «argomenti
sbagliati» e non si ricollegava: ora una lettura riprova una volta su una connessione nuova, una scrittura dice che
non si sa se è stata fatta, e dopo un 5xx la chiamata seguente apre una sessione nuova.

**Demo vera di Anteiku** (server MCP dell'azienda dimostrativa, gettone personale di un giorno, revocato a fine prova, sola
lettura: riepilogo dei clienti attivi, task aperte di Ferramenta Colli): gpt-oss-20b 2/2, qwen 1/1 (task trovate con
`clienti_leggi`; il criterio automatico l'aveva segnata ✗), Haiku 1/1. Zero `access_request`, zero `ask_user`, zero
carte del freno.

## Criteri del piano
- Zero `access_request` con carta e zero `ask_user` per strumenti presenti: sì.
- Task creata da tutti i modelli sul finto Anteiku (gpt-oss almeno 2/3): sì per gpt-oss (2/3 nell'ultimo giro, 5/6
  nei due giri prima), qwen e Haiku; gratuito: nemotron-3-ultra-550b:free 2/2 (anteiku in 5 passi, 80k; github 68k).
  nemotron-3-super-120b:free, il primo della catena gratuita dei mostri, risponde 404 a monte con entrambe le chiavi;
  laguna-s-2.1 e gemma-4-31b erano limitati a monte (429) per tutta la sera.
- Haiku < 200k token: sì (111k).
- Nessuna carta del freno su letture: sì.

## Note
- Parasail (un provider di gpt-oss su OpenRouter) risponde 502 quando gpt-oss chiama uno strumento che non era nella
  richiesta (`unexpected tokens remaining in message header: to=functions.…`): il precarico per pertinenza lo rende
  raro, ma la chiamata diretta di uno strumento non caricato resta fragile su quel provider.
- I passi contati dall'eval con `--instinct` includono le chiamate dell'istinto (righe da ~600 token).
- Spesa delle eval di oggi: 0,13 $ (chiave `OPENROUTER_PAID_API_KEY`).
- Risultati grezzi: `packages/core/eval/context/results/{g1,g1b,dbg2,g2,g3,demo}-*.json` (gitignored).
