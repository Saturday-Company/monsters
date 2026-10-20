# Compattazione C.3: riassunto dei messaggi più vecchi (16/10/2026)

Piano del 16/10, C.3 (D-082). Domanda: in una conversazione lunga il mostro ricorda ancora quello che gli hai detto
all'inizio, senza mai uscire dalla finestra del modello, e quanto costa?

## Come
- `packages/core/eval/compaction/run.ts` (`pnpm --filter @monsters/core eval:compaction --model <m> [--before]`): core
  vero su una cartella temporanea, squadra di onboarding, conversazione diretta con Rhea (web e note). 30 turni: 5 fatti
  all'inizio (nome del socio, budget 4.750 € IVA esclusa, bozze in elenco puntato, lancio il 12 marzo 2027, codice
  cliente RX-4471), 20 turni in mezzo (10 ricerche sul web, una nota, testi brevi), poi i 5 fatti chiesti di nuovo.
  Ricordato = la risposta contiene il dato giusto.
- **Prima** = stesso codice con `conversationSummary: false`: gli ultimi 12 turni, come prima di D-082.
  **Dopo** = riassunto oltre i 12 turni (tenuti gli ultimi 4), riscritto solo quando la soglia si riattraversa.
- Modelli (OpenRouter a pagamento): `qwen/qwen-2.5-7b-instruct` (finestra 32k, 0,10/0,20 $/M) e `qwen/qwen3.7-flash`
  (1M, 0,03/0,13 $/M). Spesa di tutte le prove, giri scartati compresi: ~0,22 $.

## Numeri (una corsa per riga)

| | Fatti ricordati | Picco sulla finestra | Ingresso in 30 turni | Per turno (ultimi 10) | Riassunti (chiamate) | Costo riassunti | Costo totale |
|---|---|---|---|---|---|---|---|
| 7B 32k, prima | **0/5** | 22,6% | 206.168 | 6.054 | – | – | 0,0220 $ |
| 7B 32k, dopo | **5/5** | 23,2% | 249.278 | 7.010 | 5 (5) | 13.482 token, 0,0018 $ | 0,0274 $ |
| flash 1M, prima | **2/5** | 0,9% | 518.427 | 11.033 | – | – | 0,0223 $ |
| flash 1M, dopo | **5/5** | 0,9% | 423.185 | 9.446 | 2 (5) | 22.782 token, 0,0021 $ | 0,0228 $ |

- **Prima** il 7B inventa: «Bruno» per il socio, «5000 euro, IVA inclusa», «15 ottobre», «Rossi123». Il flash ne
  ritrova 2 (preferenza e data) perché li aveva salvati in una nota e la cerca; per gli altri gira nel vault.
- **Dopo** tutti i fatti arrivano dal riassunto, quasi sempre in un passo. Sul 7B il riassunto costa ~+16% di
  ingresso per turno (il riassunto del 7B è prolisso); sul flash l'ingresso scende del 18% (meno passi a cercare).
- Mai fuori dalla finestra: nessun errore di contesto, picco 23% sul 32k. La guardia dentro il lavoro (maschera più
  forte, poi passi riassunti, poi compattazione d'emergenza sullo stesso modello) qui non è scattata: è provata nei
  test (`context-guard.test.ts`, finestra di 6.800-9.000 token con pagine da 7.000 caratteri).
- Su Claude Code: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` di 2.1.301 accetta solo `auto` o 100k-1M e consiglia `auto`;
  ogni lavoro è una sessione nuova con la conversazione nel prompt aggiunto (riassunto prima, 6.000 caratteri), quindi
  non lo impostiamo. Il riassunto per un mostro solo-abbonamento lo scrive Haiku via Claude Code (provato col binario
  finto, non con l'account vero).

## Cosa è venuto fuori durante le prove (già corretto)
- `qwen3.7-flash` pensa: con 1.000 token di uscita li spendeva tutti nel ragionamento e il riassunto usciva vuoto, o
  troncato a metà (una volta solo «Richieste e obiettivi»: i fatti persi, 4/5). Ora ragionamento spento su OpenRouter
  (`effort: none`) e 8.000 token di margine che non sono il tetto del testo, un riassunto troncato (`finishReason: length`) o lungo meno del 35% del
  precedente viene scartato e resta il vecchio, e dopo un errore si riprova solo dopo 4 turni nuovi.
- Il budget di OpenRouter conta anche le richieste a pagamento nel limite gratuito di 50 al giorno: la prima corsa del
  flash si è fermata al turno 14 («next slot in 22438 s»). Corretto dopo la review: le finestre di OpenRouter contano solo i modelli `:free`.

## Limiti
- Una corsa per configurazione; il 7B non usa quasi mai il web (1 ricerca su 10), il flash sì (8-10).
- Sul flash, prima di spegnere il ragionamento, 3 riassunti su 5 tentativi scartati (troncati o vuoti): nessun fatto perso.
- Non provati: compattazione per soglia del 75% con un modello vero (qui solo per turni), Claude Code con account vero.

## Dopo la review (16/10 sera)
Le corse sopra scrivevano il riassunto all'inizio del lavoro. Ora lo scrive dopo la risposta, per il messaggio
successivo, in background con 30 s al massimo (la misura aspetta che finisca prima del turno dopo, come farebbe chi
scrive); il riassunto arriva al mostro come dato in `<riassunto_precedente>` e, se copre lavori che hanno letto il
web o altri programmi, il lavoro che lo legge nasce contaminato. Il riassunto lo scrive solo il fornitore del primo
modello della catena; il costo non compare più nella ricevuta del turno (è fuori dal turno), resta in Consumi.
Ripetuta sul flash con il ragionamento spento (`reasoning: {effort: 'none', exclude: true}`; `low` era ignorato e un
riassunto bruciava 3.000 token pensando): **5/5 fatti**, 5 riassunti su 5 tentativi (prima 2 su 5), 10.552 token e
0,0007 $ di riassunti (prima 0,0021 $), 460.523 token in ingresso nei 30 turni. Un turno (il 12°) è fallito per un
errore del modello (`tool_calls[0].function.name` vuoto, rifiutato dal fornitore), non legato al riassunto.
