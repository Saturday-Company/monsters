# Blocchi disegnati in chat: Jev e modelli gratuiti (23/10/2026, D-162)

## Jev: «questa risposta si legge meglio disegnata?»
`packages/core/eval/instinct/ui-measure.ts`, domanda `needs_ui` (noul) di `triageRequest`, `jev-1.13.0`, due
ripetizioni per caso. 38 richieste etichettate a mano prima di misurare: 24 nette (12 da disegnare, 12 no, italiano e
inglese) e 14 di confine.

| | giuste | disegnate senza bisogno | mancate | precisione | richiamo |
|---|---|---|---|---|---|
| Jev ≥ 0,5 | 33/38 | 4 | 1 | 0,82 | 0,95 |
| Jev ≥ 0,3 | 34/38 | 4 | 0 | 0,83 | 1,00 |
| Jev ≥ 0,7 | 32/38 | 3 | 3 | 0,84 | 0,84 |
| parole della richiesta | 29/38 | 0 | 9 | 1,00 | 0,53 |

- Sulle 24 nette Jev 24/24, le parole 22/24 (la regola è stata scritta guardando questi casi: il suo numero è ottimista).
- Errori di Jev, tutti sui casi di confine: «Quanto costa Netflix?» (0,81), «Scrivi un report sui concorrenti da
  mandare al cliente» (0,82), «Fammi una ricerca su come funziona il forfettario» (0,72), «Analizza il sito di
  WitDesk» (0,59) disegnati senza bisogno; «Dove siamo con il lavoro per il cliente Rossi?» (0,43) mancato.
- Latenza mediana 150 ms (massimo 235 ms); differenza tra ripetizioni 0,006.
- Scelta: soglia 0,5, in OR con le parole. L'errore di Jev è quasi sempre allegare il manuale quando non serve:
  qualche centinaio di token, il mostro resta libero di non disegnare.

## Modelli gratuiti: il caso `confronta`
`pnpm --filter @monsters/core eval --case confronta` (catena gratuita di OpenRouter, app e utente in italiano), 4 giri:
- 3 giri con un blocco `ui` valido (`parseUiBlock`: radice, nessun errore): tabella dei piani e/o numeri chiave più
  confronto a colonne con l'opzione consigliata, prosa con la conclusione intorno.
- 1 giro senza blocco: il capo ha fatto prima una domanda all'utente (profili e budget) e ha risposto in prosa.
- Difetti visti nei blocchi validi: uno `Stat` con la variazione usata come nota («1-2 canali»); un `Option` con il
  `true` di «consigliata» finito dentro la lista dei punti. Il parser li accetta; da guardare se si ripetono.
- Risultati grezzi in `monsters-interno/packages/core/eval/results/ui-free*-2026-10-23*.json`.
