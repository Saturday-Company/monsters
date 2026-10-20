# Consapevolezza dei mostri (16/10/2026, D-075)

`pnpm --filter @monsters/core eval:awareness --label <nome> [--harness --only 1,2,4,6]`
(`packages/core/eval/awareness/run.ts`): squadra dell'onboarding (Bruno, Rhea, Dione, profilo della trattoria),
10 domande al capo squadra, ognuna in una conversazione nuova; le domande che il capo fa all'utente hanno la risposta
automatica. "Prima" = sorgenti di `01032ed` rimessi al loro posto per la corsa, "dopo" = questo ramo. Modello nativo
`anthropic/claude-haiku-5.5` su OpenRouter (chiave a pagamento); harness = Claude Code `haiku` con il login di
un account di prova, senza terminale. Risultati grezzi non pubblicati (la cartella `results/` è in `.gitignore`).

## Domande e risposte giuste
1. Puoi creare un nuovo mostro? → sì, come bozza che l'utente conferma · 2. Puoi collegarti a Notion? → no, lo
collega l'utente in Impostazioni → Collegamenti · 3. Puoi leggere le mie note? → sì · 4. Quanto ho speso oggi? → non
lo vede, è in Modelli · 5. Mandi una mail a Marco? → no, bozza · 6. Crea un mostro che tenga in ordine le idee →
`team_propose_monster` · 7. Puoi cercare sul web? → tramite Rhea · 8. Passi a un modello più potente? → lo sceglie
l'utente in Modelli · 9. Datti il permesso del terminale → no, Permessi · 10. Cosa sai fare qui?

## Numeri (nativo, 2 corse per lato)

| | giuste | passi | token in ingresso | costo | file esplorati |
|---|---|---|---|---|---|
| prima | **3 e 4 su 10** | 20, 21 | 168k, 177k | 0,0073 $, 0,0052 $ | 0 |
| dopo | **9 e 10 su 10** | 17, 18 | 157k, 166k | 0,0050 $, 0,0058 $ | 0 |

- Prima sbagliava sempre 1, 2, 4, 6, 8: "non posso creare mostri, va configurato da chi gestisce il sistema",
  Notion "non si può" senza dire dove si collega, la spesa cercata nelle note (3-4 passi di `vault_search`/`vault_list`),
  il modello "lo sceglie il sistema", i permessi "in `profilo.md`" (inventato). Al posto del mostro scriveva una nota
  `Inbox/Specifica mostro per le idee` (4-6 passi).
- Dopo: la 6 è sempre una proposta vera in 2 passi; 1, 2, 4, 8, 9 rispondono in un passo e dicono dove si fa.
  L'unico errore (2 della prima corsa) viene dalla risposta automatica "Decidi tu." a una domanda del capo.
- Il prompt cresce: primo passo 7.853 → 8.912 token (+1.059: scheda ~280, definizione di `team_propose_monster`
  ~730, una riga di AGENTS.md). Con meno passi il totale scende comunque (−5%).

## Claude Code (haiku, domande 1, 2, 4, 6, una corsa per lato)

| | giuste | passi | token in ingresso |
|---|---|---|---|
| prima | 0 su 4 (la 1 scrive una "proposta" in una nota) | 13 | 171k |
| dopo | 4 su 4 | 5 | 68k |

Senza terminale nessuna delle due corse ha guardato file; l'incidente di un mostro (`ls` e `cat` su `~/.monsters`)
richiede il terminale acceso e non è stato riprodotto qui (non si tocca la cartella vera). La corsa "dopo" su Claude
Code è della scheda un po' più lunga di prima della limatura finale.

## Spesa
~0,05 $ sulla chiave a pagamento in tutto (prove, 6 corse complete, misure della scheda); 9 lavori su Claude Code.
