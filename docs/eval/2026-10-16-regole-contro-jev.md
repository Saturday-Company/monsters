# "Solo regole" contro Jev, alla pari (16/10/2026, D-073)

Il giro vero della notte (`2026-10-16-giro-vero.md`) aveva lasciato aperto il confronto: le corse con le sole regole
erano capitate con OpenRouter lento e DuckDuckGo in CAPTCHA. Qui i due bracci girano **insieme, alla stessa ora**,
con le stesse richieste, la stessa ricerca a pagamento (D-071) e lo stesso codice (D-073 compreso).

```
pnpm --filter @monsters/core eval --case post-rhea --case recensioni --times 1 --search paid \
  --instinct rules|jev --label d073-regole|d073-jev --round d073-regole|d073-jev --budget 80 \
  --max-requests 40 --timeout-min 15 --keep <cartella>
```

Modelli gratuiti di OpenRouter (catena standard), squadra dell'onboarding (Bruno capo squadra, Rhea, Dione), ricerca
Parallel "fast" sulla chiave a pagamento. I due bracci partiti nello stesso minuto, in parallelo. Risultati in `d073-regole-*.json` (risultato grezzo, non pubblicato) e `d073-jev-*.json`, corse
tenute fuori dal repo.

**Limite da dire subito:** una corsa per caso e per braccio (le richieste gratuite del giorno non bastavano per
due). Le differenze di numero di richieste stanno dentro la variabilità dei modelli gratuiti (5-7 cambi di modello per
corsa in tutti e due i bracci).

## Richieste, passi, costo

| | post-rhea · regole | post-rhea · Jev | recensioni · regole | recensioni · Jev |
|---|---|---|---|---|
| esito | finita | finita | finita | finita |
| richieste ai modelli | 29 (Bruno 8, Rhea 11, Dione 5) | 37 (Bruno 13, Rhea 28 in 2 modelli, Dione 9) | 15 (Bruno 4, Rhea 11) | 19 (Bruno 7, Rhea 23*) |
| passi di Rhea per delega | 11 | 18 | 11 | 16 |
| durata | 514 s | 567 s | 225 s | 273 s |
| ricerche a pagamento | 5 (0,0052 $) | 9 (0,0094 $) | 20 (0,0210 $) | 20 (0,0210 $) |
| chiamate a Jev | – | 20 (0,0013 $) | – | 13 (0,0012 $) |
| cambi di modello | 5 | 7 | 0 | 2 |

\* le richieste per agente contano anche quelle fallite e riprovate su un altro modello.

Spesa del giro sulla chiave a pagamento: **0,057 $** di ricerche; Jev 0,0025 $ (credito TypeSafe). Con le misure
dell'istinto e le prove del freno, la spesa di D-073 resta sotto 0,07 $.

## Esiti della ricevuta

| | regole | Jev |
|---|---|---|
| post-rhea: Rhea | completato, **da verificare** (criteri senza giudice) | **in dubbio**: un vincolo su fonti "accessibili direttamente" a 0,37-0,50 |
| post-rhea: Dione | rimandata una volta dai conteggi in codice ("non era finito"), poi completato, da verificare | prima delega fallita (nessun modello raggiungibile), seconda rimandata una volta, finita al limite di passi, **in dubbio** (vincolo "125-150 caratteri" a 0,35) |
| recensioni: Rhea | completato, da verificare; **la nota l'ha scritta Bruno**, non Rhea (20 ricerche, tetto raggiunto) | **verificato** (nota di Rhea, criteri a 0,67-0,69) |
| note in italiano | 2/2 e 1/1 | 2/2 e 1/1 |
| link delle note che rispondono 200 | 8/8 e 0/1 | 5/5 e 5/12 (TripAdvisor e TheFork rispondono 403) |

## Domande all'utente, freno, testi tolti

- **Domande:** una sola domanda di gusto per braccio in post-rhea ("Quale variante preferisci…", 2 opzioni, decisa
  dalle regole: il gusto si chiede sempre). Con le regole Bruno ha provato una seconda domanda sulla variante di un
  altro post: rifiutata dal limite "una domanda per lavoro". Nessuna domanda nelle recensioni.
- **Schede del freno:** 0 in tutte e quattro le corse (nessuna azione che esce: solo ricerche e pagine, e nessun dato
  delle note verso siti mai visti).
- **Testi tolti:** 1, con Jev, ed era **un falso allarme nostro**: la pagina di una ricetta di Eataly letta di nuovo
  portava l'avviso di Monsters «You already read this page in this task: do not open it again…» (D-071) dentro i dati
  esterni; Jev l'ha letto, giustamente, come un ordine a un agente (0,90) e la pagina è sparita. Subito dopo Rhea è
  risultata "bloccata" (avviso, nessuna azione) e ha fatto 7 passi in più dell'altro braccio. **Corretto in D-073:** gli
  avvisi dei nostri strumenti stanno fuori da `<dati_esterni>` e fuori dal controllo delle iniezioni. Rigiocando su Jev
  i 7 risultati con avvisi delle corse tenute: con l'avviso 0,55-0,89 (2 su 7 sopra 0,85), senza 0,02-0,04; i risultati
  senza avvisi stanno tutti a 0,03-0,05.

## Cosa aggiunge Jev, onestamente

- **Rende verificabile la ricevuta.** Con le sole regole tutti i criteri scritti dal capo squadra restano "da
  verificare"; con Jev diventano ✓ o "in dubbio" (3 deleghe giudicate su 3). È l'unica differenza netta e costa
  ~0,001 $ a lavoro.
- **Gli altri usi qui non cambiano il lavoro:** il suggerimento di smistamento ("lavoro di squadra", "Rhea") ha
  detto quello che Bruno avrebbe fatto comunque; la scorciatoia è solo in prova; "gira a vuoto" ha dato un avviso;
  nessuna domanda in più o in meno (il gusto lo decidono le regole); nessuna scheda del freno in nessun braccio.
- **Non riduce le richieste:** con Jev 56 richieste contro 44. Una parte viene dal falso allarme (la pagina tolta,
  ora corretto) e dalla delega di Dione fallita per i modelli irraggiungibili; con una corsa per caso non si può dire
  quanto pesi il resto.
- **La qualità finale è simile:** note in italiano, post scritti da Dione in tutti e due i bracci (D-073 ha reso la
  lingua delle deleghe e "chi scrive" regole), ricerca sulle recensioni limitata dai siti che bloccano. Con le regole
  però nelle recensioni la nota l'ha scritta il capo squadra: la ricevuta lo dice solo come criterio mancante, e solo
  Jev l'avrebbe segnato come "non verificato".
- **Conclusione:** Jev oggi vale come giudice della ricevuta e come rete sui casi dubbi (freno, iniezioni), non come
  acceleratore. Per dire di più servono più corse per braccio (almeno 3 per caso) in un giorno con la quota gratuita
  piena, o un modello a pagamento economico per togliere il rumore dei cambi di modello.
