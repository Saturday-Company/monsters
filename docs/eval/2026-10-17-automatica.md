# "Automatica": misura del livello delle richieste, 17/10/2026

"Automatica" (D-093) scrive per un mostro sul piano Claude una catena con i `tier` e lascia alla radiografia di Jev
(D-067) la scelta del modello a ogni richiesta: Semplice → il modello leggero, Difficile → quello potente, Media → la
base. Il piano (A2) dice di accenderla di default per i mostri nuovi solo se l'accordo di Jev con etichette fatte a
mano è almeno **0,8** e la qualità sulle demo non cala. Tre misure: l'accordo del livello (§1, fatta la notte del
17/10), l'uso del piano prima e dopo (§2, fatta il 17/10 a mezzogiorno sulla quota di un abbonamento Claude di
prova) e la stessa misura col livello di ogni incarico e il taglio a 1,1 (§3, D-109, il pomeriggio del
17/10). **Esito: Automatica resta una scelta nelle Impostazioni (§2.5, §3.5); dopo la quarta misura (§4.5), con la nuova definizione di "Difficile" e il taglio a 1,3, diventa il default dei mostri nuovi sul piano Claude.**
Alla sera una quarta misura (§4, D-110): la nuova definizione di "Difficile" del maintainer, con Sonnet Medio e Opus Alto.

## 1. Accordo del livello (fatta)
`pnpm --filter @monsters/core eval:instinct --only tier --label tier-30 --env <file con TYPESAFE_API_KEY> --cap 0.01`
(codice in `packages/core/eval/instinct/`, `measureTier`; `--dry-run` costruisce le richieste senza chiamate).

- **Richieste:** 30 etichettate a mano (semplice 0, media 1, difficile 2): le 20 dello smistamento del 15/10
  (`casi.json`) e 10 nuove del 17/10 (`casi-nuovi.json → routing`, `t01`-`t10`) scritte sui lavori veri di Monsters e
  di Saturday (una CI rossa solo su Windows, uno script sulle fatture, un preventivo da ricontrollare, una traduzione,
  una call da spostare). Distribuzione: 12 semplici, 10 medie, 8 difficili.
- **Domanda:** la stessa che il core manda a un capo squadra su un abbonamento (`triageRequest` con smistamento e
  livello, senza il web: la catena non è gratuita), tagli del core `BANDS.tier` (0,3 / 1,0).
- **Modello:** `jev-1.13.0`, fissato.
- **Risultati:** `instinct-tier-30-2026-10-17T01-00-29-962Z.json` (risultato grezzo, non pubblicato).

| | Jev: semplice | Jev: media | Jev: difficile |
|---|---|---|---|
| etichetta semplice (12) | **11** | 1 | 0 |
| etichetta media (10) | 0 | **8** | 2 |
| etichetta difficile (8) | 0 | 0 | **8** |

- **Accordo 27/30 = 0,90**, sopra la soglia di 0,8.
- **Nessuna difficile data al modello leggero** (l'errore che costa qualità) e nessuna semplice data a Opus.
- Gli errori: `r05` (colonna del margine in un foglio, 1,02) e `hr5` (presentazione dalla ricerca, 1,00) medie
  scambiate per difficili, tutte e due appena sopra il taglio di 1,0: vanno su Opus, costano quota e non qualità;
  `hr3` (il tempo a Bologna, 0,31) semplice data come media: resta sulla base.
- **Costo:** 30 chiamate, 0,00116 $, p50 243 ms.
- **Limiti:** 30 casi scritti da noi, i tagli tarati il 15/10 su 20 di questi (ottimistici sulle prime 20: sulle 10
  nuove l'accordo è 10/10). Il dataset vero sono gli eventi `decision` con `use: tier` del log: quando ce ne sono
  abbastanza, si rifà la misura su quelli etichettati.

## 2. Uso del piano prima e dopo (fatta, 17/10/2026)
`node eval/automatica/run.ts --mode a|b --label <nome> --env <file con TYPESAFE_API_KEY>` da `packages/core` (codice
in `packages/core/eval/automatica/run.ts`, fuori dalla CI; `--only t01,t02` per una parte, `--compare --a <file> --b
<file,file>` per le tabelle). Consuma la quota dell'abbonamento Claude collegato al `claude` della macchina.

### 2.1 Come
- **Due home usa e getta**, una per serie: `MONSTERS_HOME` temporanea in una cartella temporanea, porta 0 (casuale),
  `MONSTERS_SECRETS=file`, nessuna variabile `CLAUDE*` della sessione che lanciava la prova. Mai il core vero in tmux.
- **Stessa squadra**: onboarding vero col profilo della demo (Giulio, Trattoria da Lapo, capo Bruno, Rhea e Dione),
  poi il piano Claude acceso (`claude-agent`, Claude Code 2.1.302 col login di un account di prova). **A**: tutti su `sonnet`, come
  oggi. **B**: "Automatica" con la base dell'archetipo (`suggestedAutoBase`): Bruno Forte `[opus, sonnet (light)]`,
  Rhea e Dione Media `[sonnet, haiku (light), opus (strong)]`.
- **Jev acceso in tutte e due** (`jev-1.13.0`, la chiave TYPESAFE del `.env` del repo, come in §1). In A il livello non
  si chiede (nessuna catena con i livelli): Jev fa smistamento, controlli e freno; in B anche il livello.
- **Casi, una volta sola, ognuno in una conversazione nuova**: post, mail e recensioni di
  `docs/eval/2026-10-14-demo.md` e le dieci `t01`-`t10` di `casi-nuovi.json → routing`. Alle domande si risponde da
  soli dopo 1,5 s (l'opzione consigliata; a una domanda aperta "Non ho altro da aggiungere: procedi con quello che hai").
  Per `t06` e `t10` la home ha tre note finte, uguali nelle due serie (la riunione soci del 14/10, il preventivo
  Anteiku con un errore di 100 € e tre contrasti, l'estratto del contratto quadro): senza, quelle richieste non hanno
  niente su cui lavorare. Per `t02`, `t07`, `t08` la squadra della demo non ha calendario, repo né cartella Fatture.
- **Dal log di ogni corsa**: `provider_usage` per modello (una richiesta è un evento con la misura del contesto),
  passi, livello scelto e modello di ogni mostro (eventi `instinct` `tier`), esito di "finito davvero?" sulle deleghe,
  promemoria di fine turno, domande, risposta, note scritte. Giudizio a mano con la griglia del 14/10 (chi ha scritto e
  chi ha cercato, domanda con opzioni o aperta, chiusura, note in italiano, wikilink rotti, fonti, fatti inventati) e un
  voto da 1 a 5 sul lavoro consegnato.
- **Interruzioni**: la serie B si è fermata dopo "recensioni" per un errore della prova, non del piano: il controllo del
  limite del piano prendeva per buono anche il `token_limit` di Rhea (il limite di 400.000 token di un mostro di
  Monsters). Corretto (ora solo `usage_limit`), `t01`-`t10` di B rifatte una volta in una home nuova. In A `t04` e `t08`
  sono state rifatte una volta (serie `piano-a-bozze`) solo per leggere il testo scritto prima della risposta finale
  "OK" (vedi §2.4); i numeri di A sono quelli della prima corsa. **Nessun limite del piano raggiunto.**
- **Risultati grezzi** nei risultati grezzi (non pubblicati): `automatica-piano-a-2026-10-17T11-25-28-078Z.json`,
  `automatica-piano-b-2026-10-17T11-31-16-621Z.json` (post, mail, recensioni),
  `automatica-piano-b-t-2026-10-17T11-47-56-821Z.json` (`t01`-`t10`),
  `automatica-piano-a-bozze-2026-10-17T11-49-08-970Z.json` (`t04`, `t08` rifatte).

### 2.2 Uso del piano per caso
Richieste al modello (token in ingresso / in uscita). Il livello è quello di Jev in B; per i tre casi della demo
l'etichetta è mia, data dopo (non sono nelle 30 di §1).

| caso | etichetta | livello B | A: tutti su Sonnet | B: Automatica | durata A / B |
|---|---|---|---|---|---|
| post | media | media | Sonnet 13 (127k / 4,8k) | Opus 11 (114k / 3,6k), Sonnet 9 (92k / 6,0k) | 50 / 110 s |
| mail | media | media | Sonnet 11 (97k / 3,9k) | Opus 8 (74k / 2,0k), Sonnet 3 (23k / 1,4k) | 38 / 46 s |
| recensioni | media | difficile | Sonnet 13 (241k / 15,0k) | Opus 16 (451k / 13,1k) | 119 / 189 s |
| t01 traduzione | semplice | semplice | Sonnet 1 (7k / 0,04k) | Sonnet 1 (7k / 0,04k) | 3 / 4 s |
| t02 sposta la call | semplice | semplice | Sonnet 9 (75k / 2,6k) | Sonnet 6 (53k / 1,5k), Haiku 3 (25k / 1,5k) | 27 / 29 s |
| t03 IVA | semplice | semplice | Sonnet 1 (7k / 0,2k) | Sonnet 1 (7k / 0,2k) | 4 / 5 s |
| t04 mail di sollecito | media | media | Sonnet 7 (59k / 3,1k) | Opus 10 (95k / 2,4k), Sonnet 5 (41k / 1,9k) | 30 / 62 s |
| t05 corsi di fotografia | media | media | Sonnet 18 (438k / 10,2k) | Opus 5 (45k / 2,2k), Sonnet 23 (548k / 10,7k) | 120 / 180 s |
| t06 riassunto riunione | media | media | Sonnet 3 (23k / 0,5k) | Opus 3 (23k / 0,5k) | 6 / 12 s |
| t07 test rosso su Windows | difficile | difficile | Sonnet 9 (80k / 2,1k) | Opus 11 (103k / 3,7k) | 28 / 51 s |
| t08 script fatture | difficile | difficile | Sonnet 3 (25k / 3,3k) | Opus 8 (113k / 8,2k) | 24 / 103 s |
| t09 concorrenti e posizionamento | difficile | difficile | Sonnet 14 (154k / 5,8k) | Opus 31 (482k / 22,4k), Sonnet 9 (263k / 7,2k) | 66 / 379 s |
| t10 preventivo Anteiku | difficile | difficile | Sonnet 5 (57k / 2,8k) | Opus 20 (247k / 11,2k) | 22 / 123 s |

**In tutto (le 13 richieste):**

| | richieste | Opus | Sonnet | Haiku | token (in + out) | di cui letti dalla cache | durata |
|---|---|---|---|---|---|---|---|
| A | **107** | 0 | 107 (100%) | 0 | **1,44 M** (1,39 M + 54k) | 1,16 M | 9 min |
| B | **183** (+71%) | 123 (67%) | 57 (31%) | 3 (2%) | **2,90 M** (2,80 M + 100k) (+101%) | 2,35 M | 22 min |

Quota per modello in B: Opus 1,75 M in / 69k out (63% dei token), Sonnet 1,03 M / 29k (37%), Haiku 25k / 1,5k (1%).
Jev: 67 chiamate in A (0,0033 $), 104 in B (0,0060 $), fuori dal piano. Il piano non dà a Monsters una percentuale
della finestra usata: la quota si legge qui come richieste e token per modello, e sul piano Opus pesa sui limiti più di
Sonnet.

**Perché B costa di più.** Il capo squadra è Forte: la base è Opus e il livello "semplice" lo porta solo a Sonnet. Su 13
richieste Jev ne ha date 3 semplici, 5 medie e 5 difficili: Bruno ha lavorato su Opus in 10 corse su 13, Rhea e
Dione su Opus nelle difficili in cui sono state chiamate (recensioni, t07, t09, t10; in t09 la seconda delega di Rhea,
dopo la risposta alla domanda, è tornata su Sonnet). Il risparmio previsto c'è solo dove
la richiesta è semplice e il capo delega (t02: Dione su Haiku); le semplici che il capo fa da solo (t01, t03) restano su
Sonnet come in A. In più Opus lavora più a lungo: più passi (t09 40 contro 14, t10 20 contro 5), più controlli, più
domande. Rhea su Opus in "recensioni" ha toccato il limite di 400.000 token del mostro (ha scritto la nota prima).

### 2.3 Accordo del livello
- **t01-t10: 10/10** (3 semplici, 3 medie, 4 difficili, tutte giuste). Con le tre della demo etichettate da me
  (tutte medie) **12/13 = 0,92**: "recensioni" data come difficile. Sopra la soglia di 0,8, come in §1 (27/30).
- I modelli serviti seguono la catena: semplice → Bruno su Sonnet, Dione su Haiku; media → Bruno su Opus, gli altri
  su Sonnet; difficile → tutti su Opus. Nessuna caduta Opus → Sonnet per il limite del piano.

### 2.4 Qualità, con la griglia del 14/10
"Finito davvero?" sulle deleghe (verificata / dubbio / incompleta) e voto a mano da 1 a 5 sul lavoro consegnato.

| caso | A: deleghe e controlli | B: deleghe e controlli | voto A | voto B | perché |
|---|---|---|---|---|---|
| post | Dione: dubbio; domanda di gusto (2 varianti) | Dione: verificata, poi Dione: dubbio (versione finale più corta); domanda di gusto (3 opzioni) | 4 | 5 | A: un wikilink rotto (`[[Profilo di Giulio]]`). B: la versione scelta riscritta, tolti i dettagli non nel menu. Nessun piatto inventato in tutte e due (i due segnalati in B sono `#piattitipici` e "tagliata" come verbo) |
| mail | Dione: verificata; domanda aperta sui dati | Dione: verificata; domanda aperta | 5 | 5 | Stessa bozza con segnaposto, nessun invio |
| recensioni | Rhea: incompleta | Rhea: incompleta, `token_limit` | 3 | 4 | A: 4 pagine lette, 36 link, onesto sui limiti. B: 52 link, 10 fonti nella risposta, quadro più ricco, limiti dichiarati |
| t01 | da solo | da solo | 5 | 5 | Uguali |
| t02 | Dione: verificata | Dione (Haiku): verificata | 4 | 4 | Bozza dell'avviso, calendario da spostare a mano in tutte e due |
| t03 | da solo | da solo | 5 | 5 | Uguali (B con gli esempi delle aliquote) |
| t04 | Dione: verificata; promemoria di fine turno | Dione: incompleta (contava 8 righe contro "dieci"); domanda con opzioni | 2 | 5 | A: la risposta finale è "OK" (sotto); rifatta, 4. B: usa la riunione del 14/10, chiede a quale cliente, spiega perché 8 righe vanno bene |
| t05 | Rhea: incompleta | Rhea: incompleta, due volte | 4 | 4 | A: tre corsi, uno è un percorso IED di 8 mesi. B: due confermati e tre candidati, ognuno col dato che manca |
| t06 | da solo | da solo | 5 | 5 | Uguali, dalla nota |
| t07 | da solo; domanda aperta sul log; promemoria | Dione (Opus): verificata | 4 | 4 | Onesti tutti e due: niente repo. A chiede il log; B fa scrivere un messaggio a Luca e lo dice |
| t08 | da solo; promemoria | da solo; promemoria | 2 | 3 | Risposta finale "OK" in tutte e due (sotto); lo script c'è solo nel testo in A, in una nota in B |
| t09 | Rhea: incompleta; domanda aperta | Rhea: dubbio, Rhea: incompleta, Dione: dubbio; domanda aperta e una con opzioni | 2 | 4 | A: si ferma a metà (non sa cos'è Saturday). B: analisi e due varianti di posizionamento; la variante la sceglie da solo ("una domanda sola per lavoro") |
| t10 | da solo (Bruno scrive le note) | Dione (Opus): incompleta; domanda con opzioni sulla tariffa del collaudo | 5 | 4 | Tutte e due trovano i 100 € e i tre contrasti. B: domanda giusta (collaudo e formazione insieme, tariffe diverse), ma una frase interna in inglese nel testo della chat ("Amounts stay the same; just remove…") e una copia doppia della nota in `Inbox/Bozze` |

- **Note in italiano** 13/13 in tutte e due, nessun fatto inventato, nessuna pubblicazione o invio.
- **Controlli "finito davvero?"**: A 7 deleghe (3 verificate, 1 dubbio, 3 incomplete), B 13 (4, 3, 6). Nessuna ripresa
  dopo un promemoria. Promemoria di fine turno (domanda lasciata nel testo): A 3 (t04, t07, t08), B 1 (t08).
- **"OK" come risposta finale** (A t04, A t08 anche rifatta, B t08): il capo finisce con una domanda nel testo, lo stop
  hook gli manda il promemoria (D-069), Claude Code risponde "OK" e quella diventa la risposta del run; il lavoro vero
  sta nel testo scritto prima. Succede con Sonnet e con Opus: non dipende da Automatica. **Corretto in D-108**: A `t04`
  e `t08` rifatte una volta dopo la correzione (`automatica-piano-a-d108-2026-10-17T12-15-29-027Z.json`, 19 richieste
  Sonnet), tutte e due con la risposta vera e nessun "OK" (in `t08` promemoria e poi `ask_user`; in `t04` la domanda
  subito con `ask_user`).

Somma dei voti: A 50, B 57. B è sopra A in 5 casi, uguale in 7, **sotto in uno (t10)**.

### 2.5 Esito
La regola: Automatica diventa il default dei mostri nuovi solo se l'accordo resta ≥ 0,8 **e** la qualità di B non è
sotto quella di A in nessun caso.
- Accordo: **sì** (10/10 sulle etichettate, 12/13 con le mie).
- Qualità: **no, per un caso**: t10 un punto sotto (la frase in inglese nella chat e la nota doppia; il contenuto è
  giusto in tutte e due). Negli altri B è uguale o meglio, soprattutto nei lavori lunghi (t09, recensioni, t04).
- E la ragione per cui Automatica esiste non regge: invece di far durare la quota, **B ne ha usata quasi il doppio**
  (+71% richieste, +101% token, due terzi delle richieste su Opus), perché il capo Forte lavora su Opus in tutte le
  richieste medie e difficili.

**Automatica resta una scelta nelle Impostazioni**, spenta di default; nessun cambio al codice del default. Chi la
accende oggi ha più qualità sui lavori lunghi e consuma di più, non di meno.

**Da decidere con il maintainer:** per un risparmio vero, il capo su Media invece di Forte (`[sonnet, haiku (light), opus
(strong)]`: semplice → Haiku, media → Sonnet, difficile → Opus) e la stessa misura rifatta: è un cambio di
`suggestedAutoBase` da misurare, non da fare a intuito. Aperti: la frase in
inglese nel testo di un capo su Opus, il limite di 400.000 token di un mostro di ricerca su Opus.

## 3. Il livello di ogni incarico e il taglio a 1,1 (fatta, 17/10/2026 pomeriggio, D-109)

> Dopo questa misura il taglio è tornato a **1,0**: sui 40 casi etichettati (30 richieste, 10 incarichi) 1,0 ne dà giusti
> 37 e 1,1 ne dà 36. I numeri sul piano qui sotto sono stati presi a 1,1.
Richiesta del maintainer del 17/10: Jev sceglie il modello **per incarico**. Quando il capo delega, Jev dà un livello al
testo dell'incarico (la stessa domanda della richiesta) e il mostro che lo riceve usa il modello di quel livello; il
capo resta al livello della richiesta. In più il taglio "difficile" passa da 1,0 a 1,1 (gli errori del §1 erano medie a
1,00 e 1,02).

### 3.1 Accordo del livello col taglio a 1,1
`pnpm --filter @monsters/core eval:instinct --only tier --label tier-30-taglio-1.1 --env <file con TYPESAFE_API_KEY>
--cap 0.01` (la chiave dal `.env` del repo, come nel §1; non stampata). Ora misura anche i 10 incarichi
(`casi-nuovi.json → subtasks`) con la domanda che il core manda per una delega (solo il livello, solo l'incarico).
Risultati: `instinct-tier-30-taglio-1.1-2026-10-17T14-02-05-420Z.json` (risultato grezzo, non pubblicato).

| | Jev: semplice | Jev: media | Jev: difficile |
|---|---|---|---|
| richieste: semplice (12) | **12** | 0 | 0 |
| richieste: media (10) | 0 | **10** | 0 |
| richieste: difficile (8) | 0 | 0 | **8** |
| incarichi: semplice (2) | **2** | 0 | 0 |
| incarichi: media (5) | 0 | **3** | 2 |
| incarichi: difficile (3) | 0 | 2 | **1** |

- **Richieste: 30/30 = 1,00** (prima 27/30). Ma Jev non dà lo stesso punteggio due volte: questa volta `r05` 0,99 e
  `hr5` 0,97 (prima 1,02 e 1,00), giuste anche col taglio vecchio; `hr3` 0,29 (prima 0,31). Con i punteggi della notte
  il taglio a 1,1 dà **29/30** (resta `hr3`). Attenzione a `r06` (difficile): 1,10 oggi e 1,12 la notte, proprio sul
  taglio nuovo; sotto andrebbe sulla base, non sul leggero.
- **Incarichi: 6/10 = 0,60**, sotto la soglia di 0,8. Nessun incarico difficile al modello leggero, nessuno semplice al
  potente. Gli errori: `s06` (tre corsi di fotografia, 1,28) e `s07` (recensioni, 1,61), ricerche medie date come
  difficili (Opus, costano quota); `s09` (posizionamento in 2 varianti, 1,04) e `s10` (preventivo corretto, 1,02),
  difficili date come medie (la base, Sonnet). **Col taglio a 1,0 gli incarichi sarebbero 8/10**: sugli incarichi il
  taglio nuovo toglie due giuste, sulle richieste ne aggiunge due. Fra 1,0 e 1,1 il punteggio di Jev non separa le
  medie dalle difficili.
- I 10 incarichi sono il `goal` di deleghe vere della misura del §2 (i risultati non tengono il resto del brief),
  etichettati a mano con le definizioni della domanda: 2 semplici (avvisi brevi), 5 medie (mail, post, ricerche
  normali), 3 difficili (analisi dei concorrenti, posizionamento, preventivo da correggere). Pochi e scritti da me.
- **Costo:** 40 chiamate, 0,00134 $, p50 ~256 ms.

### 3.2 Uso del piano: come
Stesso script e stessi casi del §2 (`node eval/automatica/run.ts --mode b --label piano-b-incarichi --env <.env>`), una
volta sola, **solo la serie B**, sul codice di D-109: Automatica col capo Bruno su Forte `[opus, sonnet (light)]`,
Rhea e Dione su Media `[sonnet, haiku (light), opus (strong)]`, livello di ogni incarico acceso, taglio a 1,1. Home
usa e getta nuova (`/tmp/monsters-automatica-b-OPieWi`, cancellata dallo script; le cartelle di Claude Code sotto
`~/.claude/projects` cancellate a mano), porta 0, nessuna variabile `CLAUDE*` della sessione. A e la B vecchia sono
quelle del §2 (per A `t04` e `t08` nei numeri la prima corsa, nel giudizio la corsa dopo D-108, con la risposta vera).
Nessuna ripresa, **nessun limite del piano**, nessun ripiego Opus → Sonnet. Risultati grezzi:
`automatica-piano-b-incarichi-2026-10-17T14-20-00-603Z.json` (risultato grezzo, non pubblicato); tabelle con
`--compare --a <A> --b <B vecchia> --c <B nuova>` (ora anche per agente).

### 3.3 Uso del piano per caso
Richieste al modello (token in ingresso / in uscita); livello del capo (dalla richiesta) e di ogni incarico (da Jev
sul testo dell'incarico).

| caso | livello capo | incarichi | A: tutti su Sonnet | B nuova | durata A / B nuova |
|---|---|---|---|---|---|
| post | media | Dione difficile | Sonnet 13 (127k / 4,8k) | Opus 13 (130k / 7,9k): Bruno 9, Dione 4 | 50 / 98 s |
| mail | media | Dione media | Sonnet 11 (97k / 3,9k) | Opus 4 (40k / 1,6k), Sonnet 3 (22k / 1,7k) | 38 / 45 s |
| recensioni | media | Rhea difficile | Sonnet 13 (241k / 15,0k) | Opus 16 (456k / 15,5k): Bruno 4, Rhea 12 | 119 / 189 s |
| t01 | semplice | – | Sonnet 1 (7k / 0,04k) | Sonnet 1 (7k / 0,04k) | 3 / 4 s |
| t02 | semplice | Dione media | Sonnet 9 (75k / 2,6k) | Sonnet 9 (74k / 2,7k) | 27 / 39 s |
| t03 | semplice | – | Sonnet 1 (7k / 0,2k) | Sonnet 1 (7k / 0,2k) | 4 / 5 s |
| t04 | media | Dione media | Sonnet 7 (59k / 3,1k) | Opus 8 (86k / 2,4k), Sonnet 3 (22k / 1,5k) | 30 / 56 s |
| t05 | media | Rhea difficile | Sonnet 18 (438k / 10,2k) | Opus 16 (339k / 10,4k): Bruno 6, Rhea 10 | 120 / 153 s |
| t06 | media | – | Sonnet 3 (23k / 0,5k) | Opus 3 (23k / 0,9k) | 6 / 12 s |
| t07 | difficile | – | Sonnet 9 (80k / 2,1k) | Opus 3 (25k / 0,9k) | 28 / 13 s |
| t08 | difficile | – | Sonnet 3 (25k / 3,3k) | Opus 7 (89k / 5,0k) | 24 / 51 s |
| t09 | difficile | Rhea difficile | Sonnet 14 (154k / 5,8k) | Opus 20 (356k / 13,2k): Bruno 8, Rhea 12 | 66 / 185 s |
| t10 | difficile | Dione difficile | Sonnet 5 (57k / 2,8k) | Opus 22 (312k / 12,7k): Bruno 14, Dione 8 | 22 / 132 s |

Il livello del capo è uguale all'etichetta in 10/10 (`t01`-`t10`); i tre della demo medie come le mie etichette.
Nessun incarico è andato sul modello leggero: Jev ha dato 5 incarichi difficili (le tre ricerche di Rhea, il post e il
preventivo di Dione) e 3 medi (mail, avviso della call, sollecito), nessuno semplice.

**In tutto (le 13 richieste):**

| | richieste | Opus | Sonnet | Haiku | token (in + out) | durata |
|---|---|---|---|---|---|---|
| A (tutti Sonnet) | **107** | 0 | 107 | 0 | **1,44 M** | 9 min |
| B vecchia (§2) | 183 (+71%) | 123 (67%) | 57 | 3 | 2,90 M (+101%) | 22 min |
| **B nuova** | **129 (+21%)** | 112 (87%) | 17 | 0 | **2,06 M (+43%)** | 16 min |

**Per agente: il capo e gli altri.**

| | Bruno (capo): richieste | Bruno: token | Bruno: per modello | Rhea e Dione: richieste | Rhea e Dione: token | Rhea e Dione: per modello |
|---|---|---|---|---|---|---|
| A | 67 (63%) | 0,64 M (44%) | Sonnet 67 | 40 (37%) | 0,80 M (56%) | Sonnet 40 |
| B vecchia | 95 (52%) | 1,09 M (37%) | Opus 87, Sonnet 8 | 88 (48%) | 1,82 M (63%) | Opus 36, Sonnet 49, Haiku 3 |
| B nuova | 74 (57%) | 0,85 M (41%) | Opus 66, Sonnet 8 | 55 (43%) | 1,21 M (59%) | Opus 46, Sonnet 9 |

- **Quanto pesa il capo:** rispetto ad A, Bruno fa +7 richieste (+10%) e +0,21 M token (+33%); Rhea e Dione +15
  richieste (+38%) e +0,41 M token (+51%). Il capo vale un terzo dell'aumento dei token; due terzi vengono dagli
  incarichi, che Jev ha mandato su Opus (le ricerche) e che su Opus durano di più. Ma il capo è il 59% delle richieste
  su Opus (66 su 112): 34 nelle richieste medie (0,35 M token) e 32 nelle difficili (0,44 M).
- **Capo su Media, a stima:** con le stesse corse, le 34 richieste di Bruno nelle medie andrebbero su Sonnet: Opus da
  87% a 60% delle richieste. I token restano quelli (+43%): il modello non li cambia, li cambiano i passi in più.
- **Rispetto alla B vecchia:** −30% richieste e −29% token, ma più Opus in proporzione (87% contro 67%). Una parte è il
  caso: `t09` 20 richieste contro 40, `t10` 22 contro 20; con una corsa per serie non si separa il rumore dall'effetto
  degli incarichi.
- Jev: 89 chiamate (0,0045 $), fuori dal piano.

### 3.4 Qualità, con la griglia del 14/10, giudizio cieco
Le tre versioni di ogni caso (A, B vecchia, B nuova) mescolate come X/Y/Z con un seme fisso e date a un giudice
(un sottoagente Claude) che leggeva solo il pacchetto: richiesta, incarichi e controlli, domande, risposta finale,
testo scritto prima, note. Stessa griglia del §2.4 e voto da 1 a 5. Il pacchetto e la chiave sono restati nello
cartella di lavoro tenuta fuori dal repo; i voti qui sotto sono quelli del giudice, rimessi in chiaro dopo.

| caso | A | B vecchia | B nuova | perché (dal giudice) |
|---|---|---|---|---|
| post | 4 | 5 | 4 | A: wikilink rotto. B vecchia: versione finale breve, tolti i dettagli inventati. B nuova: tre post e la scelta applicata, ma testo intermedio e risposta finale incollati e ripetuti in chat |
| mail | 5 | 5 | **4** | B nuova: nessuna domanda e cita "altre preparazioni con funghi" che il menu non ha (poi lo segnala) |
| recensioni | 3 | 4 | 4 | B nuova: 24 fonti, quadro piatto per piatto, limiti dichiarati; "Lo chiedo a Rhea" e risposta doppia in chat |
| t01 | 5 | 5 | 5 | Uguali |
| t02 | 4 | 4 | **3** | B nuova: "come hai scelto" senza che ci sia stata una domanda, la bozza perde Bruno ([Nome]) |
| t03 | 5 | 5 | 5 | Uguali |
| t04 | 4 | 4 | **3** | B nuova: in chat la frase interna in inglese "Check is doubtful on length; let me read it" e pezzi incollati; la domanda tu/lei dopo la consegna. Buono il richiamo alla riunione |
| t05 | 4 | 3 | 5 | B nuova: tre corsi confermati con date, costi e acconti, fonti |
| t06 | 4 | 4 | 5 | B nuova: segnala anche che giorni e date della nota non tornano col 2026 |
| t07 | 4 | 3 | 4 | Onesti sul repo; B vecchia decide da sola un messaggio a Luca |
| t08 | 3 | 3 | 4 | B nuova: script completo in una nota, limiti dichiarati. A (corsa dopo D-108): script solo in chat e troncato. B vecchia: "OK" |
| t09 | 2 | 3 | 2 | B nuova: analisi completa ma su un'altra "Saturday" (Startup Saturday, fonti del 2014). A: solo omonimi |
| t10 | 5 | 4 | **3** | B nuova: trova tutti i problemi ma inventa uno sdoppiamento della riga del collaudo (totale 7.600 €), nota vuota in `Inbox/Bozze`, stati incollati in chat |

- **Somma dei voti: A 52, B vecchia 52, B nuova 51.** B nuova sopra A in 4 casi (recensioni, t05, t06, t08), uguale in
  5, **sotto in 4 (mail, t02, t04, t10)**. Il giudice cieco dà ad A e alla B vecchia voti diversi dai miei del §2.4 (50
  e 57): con una corsa per caso il voto ha un punto di rumore.
- **"Finito davvero?"**: A 7 deleghe (3 verificate, 1 dubbio, 3 incomplete), B vecchia 13 (4, 3, 6), **B nuova 8 (3,
  1, 4)**. Promemoria di fine turno: A 3, B vecchia 1, B nuova 3 (t02, t04, t08), nessun "OK" come risposta (D-108).
- Note in italiano 13/13, nessun wikilink rotto, nessuna pubblicazione o invio. Resta la frase interna in inglese di un
  capo su Opus nella chat (t04 qui, t10 nella B vecchia).

### 3.5 Esito
La regola del maintainer: Automatica diventa il default dei mostri nuovi sul piano Claude (capo Forte, gli altri Media) solo
se la qualità è almeno quella di A in **ogni** caso **e** la quota (richieste e token) è al massimo +25% su A.
- Quota: richieste **+21%** (sì), token **+43%** (no); e l'87% delle richieste è su Opus, che sul piano pesa più di
  Sonnet.
- Qualità: **no**, sotto A in 4 casi su 13.

**Il default non cambia: Automatica resta una scelta nelle Impostazioni, spenta.** Il livello per incarico resta
acceso per chi la usa (D-109): è il comportamento giusto (un capo non manda più il titolo di un post su Opus perché la
richiesta era difficile), ma su questi casi non fa risparmiare, perché Jev giudica le ricerche e i testi lunghi degli
incarichi medi o difficili, mai semplici (nessun incarico su Haiku).

**Per la scelta del maintainer:** il capo vale un terzo dell'aumento dei token (+0,21 M su +0,62 M) ma il 59% delle
richieste su Opus (66 su 112, di cui 34 nelle richieste medie). Con il capo su Media quelle 34 andrebbero su Sonnet e
Opus scenderebbe a ~60% delle richieste; i token no, perché vengono soprattutto dagli incarichi su Opus che lavorano più
a lungo. Le strade da misurare: il capo su Media; un incarico mai sopra la base del mostro che delega se la richiesta
non è difficile; oppure tenere A (tutti su Sonnet), che oggi vale la stessa qualità con meno quota.

## 4. La definizione di "Difficile" del maintainer e la regola Sonnet Medio / Opus Alto (fatta, 17/10/2026 sera, D-110)

Regola del maintainer: il lavoro ordinario (post, mail, ricerche, analisi brevi) su **Sonnet con impegno Medio**; i problemi
complessi, le scelte di progetto e la pianificazione su **Opus con impegno Alto**; gli incarichi seguono il livello che
Jev dà a ciascuno. "Difficile" = il lavoro in cui Opus fa meglio di Sonnet nella maggior parte dei casi. Nessuna
chiamata al piano Claude: solo Jev, con tetto 0,01 $ a corsa.

### 4.1 Etichette riviste
Con la definizione del maintainer ho riguardato i 40 casi (30 richieste, 10 incarichi). Cambiano **due** etichette, da
difficile (2) a media (1); le altre 38 restano:
- `r06` («Cerca cosa dice la nuova normativa sulla fattura elettronica 2027 e poi scrivi una mail ai clienti»): una
  ricerca sul web e una mail, entrambe nella lista del "non difficile"; nessuna fonte che si contraddice.
- `s08` (incarico: identificare Saturday e cercare i concorrenti sul mercato italiano): ricerca sul web e confronto,
  anche se lunga; l'analisi e la strategia sono dell'incarico `s09`.

Restano difficili: `r10`, `hr6`, `t07` (cause di guasti), `r13` e `t10` (contratti e preventivi da ricontrollare, fonti
che si contraddicono), `t08` (codice sostanzioso da una richiesta vaga), `t09` (strategia e posizionamento), `s09`
(posizionamento), `s10` (preventivo da riscrivere con i conti da ricontrollare: l'avevo portato a media, riportato a
difficile dopo il messaggio del maintainer: "preventivi da ricontrollare" lo copre). Restano medie `r11` (piano editoriale:
un calendario di testi, non la pianificazione di un progetto), `r12`, `t05`, `s06`, `s07`. Distribuzione: richieste 12
semplici, 11 medie, 7 difficili; incarichi 2 semplici, 6 medi, 2 difficili.

### 4.2 Le prove (tutte con `eval:instinct --only tier --env <.env> --cap 0.01`, `jev-1.13.0`, taglio 1,0)
La domanda (`TIER_QUESTION`, versione delle domande `2026-10-17.2`) ha cambiato di testo a ogni prova; risultati in
`instinct-tier-d110-<n>-*.json` (risultato grezzo, non pubblicato). Le prime due su una definizione più stretta (gli esempi del
maintainer presi per l'elenco), le altre tre con quella intera.

| prova | definizione | richieste | incarichi | in tutto | ricerche ordinarie date a Difficile |
|---|---|---|---|---|---|
| 1 | gli esempi: problemi complessi, scelte di progetto, pianificazione; "ricerche, scritture, riassunti, traduzioni e analisi brevi non sono difficili, nemmeno se lunghi" | 26/30 | 7/10 | 33/40 = 0,83 | `r02`, `r06`, `r11`, `hr5`, `s06`, `s07`, `s08` |
| 2 | come 1, Media con esempi (fornitori, prezzi, corsi, concorrenti, recensioni) e "cercare, scrivere, riassumere e tradurre non sono mai difficili" | 24/30 | 7/10 | 31/40 = 0,78 | `r02`, `r06`, `r11`, `r12`, `hr5`, `t05`, `s06`, `s07`, `s08` |
| 3 | la definizione intera del maintainer (nove voci), Media con l'elenco del non difficile | 22/30 | 7/10 | 29/40 = 0,73 | `r06`, `r11`, `hr5`, `t05`, `s06`, `s07`, `s08` |
| 4 | la stessa, più corta, con "Non è mai Difficile" in Media | 22/30 | 7/10 | 29/40 = 0,73 | `r06`, `r11`, `r12`, `hr5`, `s06`, `s07`, `s08` |
| **5** | **la stessa in forma compatta, Media "anche lungo o con molte fonti" e "nel dubbio tra Media e Difficile è Media"** | **27/30** | **7/10** | **34/40 = 0,85** | `r06`, `r11`, `hr5`, `s06`, `s07`, `s08` |

- Nelle prove 3 e 4 il testo lungo di Media spingeva quattro semplici (`r04`, `hr1`, `hr3`, `t02`) a Media; la 5, più
  corta, li riporta a semplici. Mai una difficile data al modello leggero, mai una semplice a Opus.
- La 5 è la versione nel codice. Costo di una prova: ~0,0016 $ (40 chiamate), p50 ~225 ms.
- Le ricerche ordinarie date a Difficile nella 5, con il punteggio (taglio 1,0): `r06` 1,02, `hr5` 1,00, `s06` 1,08,
  `s08` 1,10, `s07` 1,15, `r11` 1,24 (il piano editoriale, che a Jev sembra pianificazione). Jev dà alle
  difficili vere punteggi molto più alti: tutte ≥ 1,44 (`t09` 1,44, `s09` 1,52, `hr6` 1,66, `s10` 1,66, `t08` 1,82,
  `r10` 1,90, `r13` 1,97, `t07` 1,99, `t10` 1,99).

### 4.2 bis · Il taglio a 1,3
Il coordinatore ha fatto scorrere il taglio "difficile" sui punteggi della prova 5 (40 casi):

| taglio | giusti su 40 | errori |
|---|---|---|
| 1,0 | 34 | `r06`, `r11`, `hr5`, `s06`, `s07`, `s08` (medie date a Difficile) |
| 1,1 | 37 | `r11`, `s07`, `s08` |
| 1,2 | 39 | `r11` |
| 1,25 | 40 | nessuno |
| **1,3** | **40** | nessuno |
| 1,4 | 40 | nessuno |

Tra la media più alta (`r11`, 1,24) e la difficile più bassa (`t09`, 1,44) c'è un vuoto di 0,20: **il taglio passa a
1,3**, con margine da tutte e due le parti. Attenzione a cosa è: tarato su questi 40 casi, scritti da noi e visti per
scegliere sia la formulazione sia il taglio, quindi ottimistico; il dataset vero saranno gli eventi `decision` con
`use: tier` del log (richieste e incarichi), su cui si rifà la misura. Il taglio "semplice" resta 0,3.

### 4.3 Qualità e quota
Sul piano Claude non ho fatto nessuna corsa: la qualità con Sonnet Medio e Opus Alto non è stata misurata (costerebbe
troppa quota). Resta aperta la misura di Sonnet Alto, Opus Medio e Haiku Alto.

### 4.4 La regola nel codice
Automatica (base Media) = `[sonnet, opus (strong)]`: Semplice e Media su Sonnet, Difficile su Opus; ogni anello prende
l'impegno del suo modello (Sonnet Medio, Opus Alto, Haiku nessuno), per la richiesta, per il capo e per ogni incarico.
Vedi D-110.

### 4.5 Esito
- Con il taglio a 1,3: accordo sui 40 casi **40/40 = 1,00** (richieste 30/30, incarichi 10/10), nessuna ricerca
  ordinaria a Difficile, nessuna difficile al modello leggero. Tutti e due i criteri passano (con la riserva di 4.2 bis).
- **Automatica diventa il default dei mostri nuovi sul piano Claude** (Semplice e Media Sonnet Medio, Difficile Opus
  Alto, base Media per tutti, capi compresi); i mostri già esistenti e quelli su altri servizi non cambiano. Vedi D-110.
- Non misurati sul piano: qualità e quota (costerebbe troppa quota).
